import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import Redis from 'ioredis';

const databaseUrl = process.env.DATABASE_URL ? process.env.DATABASE_URL : 'file:local.db';
const redisUrl = process.env.REDIS_URL ? process.env.REDIS_URL : 'redis://localhost:6379';
const secretKey = process.env.LEDGER_SECRET ? process.env.LEDGER_SECRET : 'sovereign-audit-key';
const GENESIS = 'GENESIS';

const db = createClient({ url: databaseUrl });
const redis = new Redis(redisUrl);

function canonicalize(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item)).join(',')}]`;
    }

    const objectValue = value;
    const sortedKeys = Object.keys(objectValue).sort();
    return `{${sortedKeys
        .map((key) => `${JSON.stringify(key)}:${canonicalize(objectValue[key])}`)
        .join(',')}}`;
}

function toIsoTimestamp(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const raw = typeof value === 'number' ? value : Number(value);
    const millis = raw < 1_000_000_000_000 ? raw * 1000 : raw;
    return new Date(millis).toISOString();
}

function buildEventPayload(event) {
    return {
        id: event.id,
        timestamp: toIsoTimestamp(event.timestamp),
        actorId: event.actor_id,
        action: event.action,
        workstationId: event.workstation_id,
        biometricType: event.biometric_type,
        riskScore: event.risk_score ?? 0,
        locationData: event.location_data
    };
}

function hashPayload(payload, previousHash) {
    const dataToHash = `${canonicalize(payload)}|${previousHash}`;
    return crypto.createHmac('sha256', secretKey).update(dataToHash).digest('hex');
}

async function ensureSeedRecord() {
    const countResult = await db.execute('SELECT COUNT(*) AS c FROM evidence_ledger');
    const count = Number(countResult.rows[0]?.c ?? 0);

    if (count > 0) {
        return;
    }

    const id = randomUUID();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const event = {
        id,
        timestamp: nowSeconds,
        actor_id: 'chaos-seed-01',
        action: 'BIOMETRIC_SUCCESS',
        workstation_id: 'CHAOS-WS-01',
        biometric_type: 'FINGERPRINT',
        risk_score: 0.05,
        location_data: JSON.stringify({ lat: 34.0522, lon: -118.2437 })
    };

    await db.execute({
        sql: 'INSERT INTO identity_events (id, timestamp, actor_id, action, workstation_id, biometric_type, risk_score, location_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [
            event.id,
            event.timestamp,
            event.actor_id,
            event.action,
            event.workstation_id,
            event.biometric_type,
            event.risk_score,
            event.location_data
        ]
    });

    const payloadHash = hashPayload(buildEventPayload(event), GENESIS);

    await db.execute({
        sql: 'INSERT INTO evidence_ledger (id, event_id, created_at, payload_hash, previous_hash, signature, verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [randomUUID(), event.id, nowSeconds, payloadHash, GENESIS, 'seed-signature', 1]
    });

    console.log('Seeded initial identity_events + evidence_ledger row for chaos test.');
}

async function tamperLatestIdentityEvent() {
    const latest = await db.execute(
        'SELECT id, biometric_type FROM identity_events ORDER BY timestamp DESC, id DESC LIMIT 1'
    );

    if (!latest.rows.length) {
        throw new Error('No identity_events rows found after seeding.');
    }

    const row = latest.rows[0];

    await db.execute({
        sql: 'UPDATE identity_events SET biometric_type = ? WHERE id = ?',
        args: ['UNAUTHORIZED_ACCESS', row.id]
    });

    console.log(
        `Tampered latest identity_events row: ${row.id} (${row.biometric_type ?? 'NULL'} -> UNAUTHORIZED_ACCESS)`
    );

    return row.id;
}

async function verifyChainHealth() {
    const result = await db.execute(`
        SELECT
            l.id AS ledger_id,
            l.payload_hash,
            l.previous_hash,
            l.verified,
            l.created_at,
            e.id AS event_id,
            e.timestamp,
            e.actor_id,
            e.action,
            e.workstation_id,
            e.biometric_type,
            e.risk_score,
            e.location_data
        FROM evidence_ledger l
        INNER JOIN identity_events e ON l.event_id = e.id
        ORDER BY l.created_at ASC, l.id ASC
    `);

    const rows = result.rows;
    const issues = [];

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const expectedPrevious = index === 0 ? GENESIS : rows[index - 1].payload_hash;

        if (row.previous_hash !== expectedPrevious) {
            issues.push(
                `Chain mismatch at index ${index}: expected ${expectedPrevious}, got ${row.previous_hash}`
            );
            continue;
        }

        const expectedHash = hashPayload(
            buildEventPayload({
                id: row.event_id,
                timestamp: row.timestamp,
                actor_id: row.actor_id,
                action: row.action,
                workstation_id: row.workstation_id,
                biometric_type: row.biometric_type,
                risk_score: row.risk_score,
                location_data: row.location_data
            }),
            row.previous_hash
        );

        if (row.payload_hash !== expectedHash) {
            issues.push(
                `Payload mismatch at index ${index}: expected ${expectedHash}, got ${row.payload_hash}`
            );
        }
    }

    return {
        ok: issues.length === 0,
        totalEntries: rows.length,
        verifiedEntries: rows.filter((row) => Number(row.verified) === 1).length,
        lastHash: rows.length ? String(rows[rows.length - 1].payload_hash) : null,
        issues
    };
}

async function publishBreachPulse(chainHealth) {
    const payload = {
        id: `chaos-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actorId: 'chaos-runner',
        action: 'CHAOS_TAMPER_DETECTED',
        workstationId: 'CHAOS-WS-01',
        biometricType: 'UNAUTHORIZED_ACCESS',
        riskScore: 1,
        locationData: { lat: 34.0522, lon: -118.2437 },
        chainHealth
    };

    const subscribers = await redis.publish('biometric-stream', JSON.stringify(payload));
    console.log(`Published breach pulse to biometric-stream (subscribers: ${subscribers}).`);
}

async function run() {
    try {
        await ensureSeedRecord();
        await tamperLatestIdentityEvent();
        const chainHealth = await verifyChainHealth();

        console.log('Chain health after tamper:', JSON.stringify(chainHealth));

        if (chainHealth.ok) {
            throw new Error('Chaos test failed: chain health is still OK after tampering.');
        }

        await publishBreachPulse(chainHealth);

        console.log('CHAOS TEST COMPLETE: Integrity breach detected and broadcast to HUD stream.');
    } finally {
        redis.disconnect();
    }
}

run().catch((error) => {
    console.error('CHAOS TEST FAILED:', error.message);
    process.exitCode = 1;
});
