import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@libsql/client';
import Redis from 'ioredis';

function loadEnvFile() {
    const envPath = resolve(process.cwd(), '.env');

    try {
        const contents = readFileSync(envPath, 'utf8');
        for (const line of contents.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const separatorIndex = trimmed.indexOf('=');
            if (separatorIndex === -1) {
                continue;
            }

            const key = trimmed.slice(0, separatorIndex).trim();
            if (!key || process.env[key] !== undefined) {
                continue;
            }

            let value = trimmed.slice(separatorIndex + 1).trim();
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }

            process.env[key] = value;
        }
    } catch {
        // Ignore when .env is missing; environment variables may be provided externally.
    }
}

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL ? process.env.DATABASE_URL : 'file:local.db';
const redisUrl = process.env.REDIS_URL ? process.env.REDIS_URL : 'redis://localhost:6379';
const secretKey = process.env.LEDGER_SECRET ? process.env.LEDGER_SECRET : 'sovereign-audit-key';
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN : '';
const telegramChatId = process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID : '';
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

function buildEventPayload(row) {
    return {
        id: row.event_id,
        timestamp: toIsoTimestamp(row.timestamp),
        actorId: row.actor_id,
        action: row.action,
        workstationId: row.workstation_id,
        biometricType: row.biometric_type,
        riskScore: row.risk_score ?? 0,
        locationData: row.location_data
    };
}

function hashPayload(payload, previousHash) {
    const dataToHash = `${canonicalize(payload)}|${previousHash}`;
    return crypto.createHmac('sha256', secretKey).update(dataToHash).digest('hex');
}

async function getRows() {
    const result = await db.execute(`
        SELECT
            l.id AS ledger_id,
            l.event_id,
            l.payload_hash,
            l.previous_hash,
            l.verified,
            l.created_at,
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

    return result.rows;
}

function analyzeRows(rows) {
    const issues = [];
    let firstBadIndex = -1;

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const expectedPrevious = index === 0 ? GENESIS : rows[index - 1].payload_hash;

        if (row.previous_hash !== expectedPrevious) {
            issues.push(
                `Chain mismatch at index ${index}: expected ${expectedPrevious}, got ${row.previous_hash}`
            );
            if (firstBadIndex === -1) {
                firstBadIndex = index;
            }
            continue;
        }

        const expectedHash = hashPayload(buildEventPayload(row), row.previous_hash);
        if (row.payload_hash !== expectedHash) {
            issues.push(
                `Payload mismatch at index ${index}: expected ${expectedHash}, got ${row.payload_hash}`
            );
            if (firstBadIndex === -1) {
                firstBadIndex = index;
            }
        }
    }

    return { issues, firstBadIndex };
}

async function verifyChainHealth() {
    const rows = await getRows();
    const { issues } = analyzeRows(rows);

    return {
        ok: issues.length === 0,
        totalEntries: rows.length,
        verifiedEntries: rows.filter((row) => Number(row.verified) === 1).length,
        lastHash: rows.length ? String(rows[rows.length - 1].payload_hash) : null,
        issues
    };
}

async function sendTelegramIntegrityRestored(chainHealth, isolatedNodes) {
    if (!telegramBotToken || !telegramChatId) {
        console.log('TELEGRAM: skipped (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID).');
        return;
    }

    const lines = [
        'System Integrity Restored',
        `Status: ${chainHealth.ok ? 'GREEN' : 'DEGRADED'}`,
        `Entries: ${chainHealth.totalEntries}`,
        `Verified Entries: ${chainHealth.verifiedEntries}`,
        `Last Hash: ${chainHealth.lastHash ?? 'NONE'}`,
        `Isolated Nodes: ${isolatedNodes.length ? isolatedNodes.join(', ') : 'NONE'}`
    ];

    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: telegramChatId,
            text: lines.join('\n')
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram notification failed: ${response.status} ${errorText}`);
    }

    console.log('TELEGRAM: System Integrity Restored alert sent.');
}

async function publishHealedMessage(chainHealth, isolatedNodes) {
    const subscribers = await redis.publish(
        'biometric-stream',
        JSON.stringify({
            id: `healed-${Date.now()}`,
            timestamp: new Date().toISOString(),
            actorId: 'soc-healer',
            action: 'HEALED',
            workstationId: isolatedNodes[0] ?? 'SOC-ORCHESTRATOR',
            biometricType: 'RECOVERY_OPERATION',
            riskScore: 0,
            message: 'System Integrity Restored',
            locationData: { lat: 34.0522, lon: -118.2437 },
            chainHealth,
            isolatedNodes
        })
    );

    console.log(`HUD HEALED broadcast sent. Active subscribers: ${subscribers}.`);
}

async function run() {
    try {
        const rows = await getRows();
        const { issues, firstBadIndex } = analyzeRows(rows);

        if (firstBadIndex === -1) {
            const healthy = await verifyChainHealth();
            console.log('HEALING: chain already healthy, no restoration needed.');
            try {
                await sendTelegramIntegrityRestored(healthy, []);
            } catch (error) {
                console.error(
                    `TELEGRAM: failed to send integrity-restored alert (${error instanceof Error ? error.message : 'unknown error'}).`
                );
            }
            await publishHealedMessage(healthy, []);
            return;
        }

        const compromisedRows = rows.slice(firstBadIndex);
        const compromisedNodes = [
            ...new Set(compromisedRows.map((row) => String(row.workstation_id ?? 'UNKNOWN')))
        ];

        console.log('ISOLATION: compromised nodes identified:', compromisedNodes.join(', '));

        const compromisedLedgerIds = compromisedRows.map((row) => row.ledger_id);
        const compromisedEventIds = compromisedRows.map((row) => row.event_id);

        // Restoration policy: rollback from first invalid link to preserve prefix integrity.
        for (const ledgerId of compromisedLedgerIds) {
            await db.execute({ sql: 'DELETE FROM evidence_ledger WHERE id = ?', args: [ledgerId] });
        }
        for (const eventId of compromisedEventIds) {
            await db.execute({ sql: 'DELETE FROM identity_events WHERE id = ?', args: [eventId] });
        }

        console.log(
            `RESTORATION: removed ${compromisedLedgerIds.length} ledger entries and ${compromisedEventIds.length} identity events from compromised segment.`
        );

        const chainHealth = await verifyChainHealth();
        if (!chainHealth.ok) {
            throw new Error(
                `RE-VALIDATION FAILED: chain still compromised after rollback: ${chainHealth.issues.join(' | ')}`
            );
        }

        console.log('RE-VALIDATION: chain healthy (GREEN).');
        try {
            await sendTelegramIntegrityRestored(chainHealth, compromisedNodes);
        } catch (error) {
            console.error(
                `TELEGRAM: failed to send integrity-restored alert (${error instanceof Error ? error.message : 'unknown error'}).`
            );
        }
        await publishHealedMessage(chainHealth, compromisedNodes);
    } finally {
        redis.disconnect();
    }
}

run().catch((error) => {
    console.error('HEALING FAILED:', error.message);
    process.exitCode = 1;
});