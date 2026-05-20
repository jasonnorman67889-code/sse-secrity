import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { asc, eq } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile() {
    const envPath = resolve(process.cwd(), '.env');
    try {
        const raw = readFileSync(envPath, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf('=');
            if (idx === -1) continue;
            const key = trimmed.slice(0, idx).trim();
            if (!key || process.env[key] !== undefined) continue;
            let value = trimmed.slice(idx + 1).trim();
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        }
    } catch {
        // .env optional
    }
}

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL || 'file:local.db';
const client = createClient({ url: databaseUrl });
const db = drizzle(client);
const GENESIS = 'GENESIS';
const SECRET_KEY = process.env.LEDGER_SECRET || 'sovereign-audit-key';

const identityEvents = sqliteTable('identity_events', {
    id: text('id').primaryKey(),
    timestamp: integer('timestamp', { mode: 'timestamp' }),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    workstationId: text('workstation_id').notNull(),
    biometricType: text('biometric_type'),
    riskScore: real('risk_score'),
    locationData: text('location_data')
});

const evidenceLedger = sqliteTable('evidence_ledger', {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }),
    payloadHash: text('payload_hash').notNull(),
    previousHash: text('previous_hash').notNull(),
    signature: text('signature').notNull(),
    verified: integer('verified', { mode: 'boolean' })
});

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

function buildEventPayload(event) {
    return {
        id: event.id,
        timestamp: event.timestamp ? event.timestamp.toISOString() : null,
        actorId: event.actorId,
        action: event.action,
        workstationId: event.workstationId,
        biometricType: event.biometricType,
        riskScore: event.riskScore ?? 0,
        locationData: event.locationData
    };
}

function hashPayload(payload, previousHash) {
    const dataToHash = `${canonicalize(payload)}|${previousHash}`;
    return crypto.createHmac('sha256', SECRET_KEY).update(dataToHash).digest('hex');
}

async function verifyLedgerChain() {
    const rows = await db
        .select({
            payloadHash: evidenceLedger.payloadHash,
            previousHash: evidenceLedger.previousHash,
            eventId: identityEvents.id,
            timestamp: identityEvents.timestamp,
            actorId: identityEvents.actorId,
            action: identityEvents.action,
            workstationId: identityEvents.workstationId,
            biometricType: identityEvents.biometricType,
            riskScore: identityEvents.riskScore,
            locationData: identityEvents.locationData
        })
        .from(evidenceLedger)
        .innerJoin(identityEvents, eq(evidenceLedger.eventId, identityEvents.id))
        .orderBy(asc(evidenceLedger.createdAt), asc(evidenceLedger.id));

    const issues = [];

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const expectedPrevious = index === 0 ? GENESIS : rows[index - 1].payloadHash;

        if (row.previousHash !== expectedPrevious) {
            issues.push(
                `Chain mismatch at index ${index}: expected ${expectedPrevious}, got ${row.previousHash}`
            );
            continue;
        }

        const expectedHash = hashPayload(
            buildEventPayload({
                id: row.eventId,
                timestamp: row.timestamp,
                actorId: row.actorId,
                action: row.action,
                workstationId: row.workstationId,
                biometricType: row.biometricType,
                riskScore: row.riskScore,
                locationData: row.locationData
            }),
            row.previousHash
        );

        if (row.payloadHash !== expectedHash) {
            issues.push(
                `Payload mismatch at index ${index}: expected ${expectedHash}, got ${row.payloadHash}`
            );
        }
    }

    return {
        ok: issues.length === 0,
        totalEntries: rows.length,
        issues
    };
}

async function run() {
    try {
        const result = await verifyLedgerChain();

        if (result.ok) {
            console.log(`Ledger verified. Entries checked: ${result.totalEntries}`);
            process.exitCode = 0;
            return;
        }

        console.error('TAMPER DETECTED');
        for (const issue of result.issues) {
            console.error(`- ${issue}`);
        }

        process.exitCode = 1;
    } catch (error) {
        console.error('Verification failed with runtime error:', error);
        process.exitCode = 1;
    }
}

run();
