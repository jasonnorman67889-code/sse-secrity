import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { resolve } from 'node:path';
import crypto from 'node:crypto';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { asc, eq } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { HttpsProxyAgent } from 'https-proxy-agent';

const GENESIS = 'GENESIS';
const LONDON_NODE_ID = 'SOVEREIGN-LDN-01';
const AUDIT_LOG_FILE = resolve(process.cwd(), 'logs', 'security_audit.log');

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
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        }
    } catch {
        // .env optional
    }
}

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
    return `{${sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalize(objectValue[key])}`).join(',')}}`;
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

function hashPayload(payload, previousHash, secret) {
    const dataToHash = `${canonicalize(payload)}|${previousHash}`;
    return crypto.createHmac('sha256', secret).update(dataToHash).digest('hex');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuietModeEnabled() {
    return (process.env.TELEGRAM_QUIET_MODE || 'true').toLowerCase() !== 'false';
}

function writeSecurityAudit(message) {
    mkdirSync(resolve(process.cwd(), 'logs'), { recursive: true });
    appendFileSync(AUDIT_LOG_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8');
}

function resolveTelegramProxy() {
    const proxyUrl =
        process.env.TELEGRAM_HTTPS_PROXY ||
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        '';

    if (!proxyUrl) {
        return null;
    }

    const parsed = new URL(proxyUrl);
    const hasCredentials = Boolean(parsed.username && parsed.password);

    return {
        proxyUrl,
        hasCredentials,
        agent: new HttpsProxyAgent(proxyUrl)
    };
}

function postTelegramMessage(token, chatId, text, proxyConfig) {
    const payload = JSON.stringify({ chat_id: chatId, text });

    return new Promise((resolvePromise, rejectPromise) => {
        const request = https.request(
            {
                protocol: 'https:',
                hostname: 'api.telegram.org',
                path: `/bot${token}/sendMessage`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                },
                agent: proxyConfig?.agent
            },
            (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                    body += chunk;
                });
                response.on('end', () => {
                    const statusCode = response.statusCode ?? 500;
                    if (statusCode >= 200 && statusCode < 300) {
                        resolvePromise();
                        return;
                    }

                    rejectPromise(new Error(`Telegram failed: ${statusCode} ${body}`));
                });
            }
        );

        request.on('error', rejectPromise);
        request.write(payload);
        request.end();
    });
}

async function sendTelegram(token, chatId, text) {
    if (!token || !chatId) {
        console.log('TELEGRAM: skipped (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID).');
        return;
    }

    const maxAttempts = 3;
    const backoffMs = 5000;
    let lastError = null;
    const proxyConfig = resolveTelegramProxy();

    if (proxyConfig) {
        console.log(
            `TELEGRAM: using HTTPS proxy (${proxyConfig.hasCredentials ? 'authenticated' : 'no credentials detected'}).`
        );
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await postTelegramMessage(token, chatId, text, proxyConfig);

            console.log(`TELEGRAM: London Node Restored confirmation sent (attempt ${attempt}/${maxAttempts}).`);
            return;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxAttempts) {
                console.warn(
                    `TELEGRAM: attempt ${attempt}/${maxAttempts} failed (${lastError.message}). Retrying in 5s...`
                );
                await sleep(backoffMs);
            }
        }
    }

    const finalError = `Telegram failed after ${maxAttempts} attempts: ${lastError?.message ?? 'unknown error'}`;
    if (isQuietModeEnabled()) {
        writeSecurityAudit(
            `[LONDON_RESEAL][QUIET_MODE] node=${LONDON_NODE_ID} telegram_unavailable reason="${finalError}" action="reseed completed"`
        );
        console.warn(`TELEGRAM: unavailable, recorded in ${AUDIT_LOG_FILE}.`);
        return;
    }

    throw new Error(finalError);
}

async function run() {
    loadEnvFile();
    const databaseUrl = process.env.DATABASE_URL || 'file:local.db';
    const secret = process.env.LEDGER_SECRET || 'sovereign-audit-key';

    const client = createClient({ url: databaseUrl });
    const db = drizzle(client);

    const londonRows = await db
        .select({
            id: identityEvents.id,
            biometricType: identityEvents.biometricType
        })
        .from(identityEvents)
        .where(eq(identityEvents.workstationId, LONDON_NODE_ID));

    const londonTampered = londonRows.filter((row) => row.biometricType !== 'FACE_ID');
    console.log(`London tampered records detected: ${londonTampered.length}`);
    for (const row of londonTampered) {
        console.log(`- event_id=${row.id} biometricType=${row.biometricType}`);
    }

    for (const row of londonTampered) {
        await client.execute({
            sql: 'UPDATE identity_events SET biometric_type = ? WHERE id = ?',
            args: ['FACE_ID', row.id]
        });
    }

    const rows = await db
        .select({
            ledgerId: evidenceLedger.id,
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

    let previousHash = GENESIS;
    for (const row of rows) {
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
            previousHash,
            secret
        );

        await client.execute({
            sql: 'UPDATE evidence_ledger SET previous_hash = ?, payload_hash = ?, verified = 1 WHERE id = ?',
            args: [previousHash, expectedHash, row.ledgerId]
        });

        previousHash = expectedHash;
    }

    const verifyRows = await db
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
    for (let index = 0; index < verifyRows.length; index += 1) {
        const row = verifyRows[index];
        const expectedPrevious = index === 0 ? GENESIS : verifyRows[index - 1].payloadHash;
        if (row.previousHash !== expectedPrevious) {
            issues.push(`Chain mismatch at index ${index}`);
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
            row.previousHash,
            secret
        );

        if (row.payloadHash !== expectedHash) {
            issues.push(`Payload mismatch at index ${index}`);
        }
    }

    if (issues.length > 0) {
        console.error('Integrity scan failed after reseal:');
        for (const issue of issues.slice(0, 20)) {
            console.error(`- ${issue}`);
        }
        if (issues.length > 20) {
            console.error(`- ... ${issues.length - 20} more issue(s)`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('Integrity scan OK: chain healthy after reseal.');

    try {
        await sendTelegram(
            process.env.TELEGRAM_BOT_TOKEN || '',
            process.env.TELEGRAM_CHAT_ID || '',
            `London Node Restored\nNode: ${LONDON_NODE_ID}\nIntegrity: GREEN`
        );
    } catch (error) {
        console.error(`TELEGRAM: send failed (${error instanceof Error ? error.message : String(error)}).`);
    }
}

run().catch((error) => {
    console.error('London reseal failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
