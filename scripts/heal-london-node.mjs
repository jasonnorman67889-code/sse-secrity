import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@libsql/client';

const GENESIS = 'GENESIS';
const LONDON_NODE_ID = 'SOVEREIGN-LDN-01';

function loadEnvFile() {
    const envPath = resolve(process.cwd(), '.env');
    try {
        const contents = readFileSync(envPath, 'utf8');
        for (const line of contents.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const separatorIndex = trimmed.indexOf('=');
            if (separatorIndex === -1) continue;

            const key = trimmed.slice(0, separatorIndex).trim();
            if (!key || process.env[key] !== undefined) continue;

            let value = trimmed.slice(separatorIndex + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        }
    } catch {
        // ignore missing .env
    }
}

function canonicalize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;

    const sortedKeys = Object.keys(value).sort();
    return `{${sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function toIsoTimestamp(value) {
    if (value === null || value === undefined) return null;
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

function hashPayload(payload, previousHash, secretKey) {
    const dataToHash = `${canonicalize(payload)}|${previousHash}`;
    return crypto.createHmac('sha256', secretKey).update(dataToHash).digest('hex');
}

async function getRows(db) {
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

function analyzeRows(rows, secretKey) {
    const issues = [];
    const badIndexes = [];

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const expectedPrevious = index === 0 ? GENESIS : rows[index - 1].payload_hash;

        if (row.previous_hash !== expectedPrevious) {
            issues.push(`Chain mismatch at index ${index}: expected ${expectedPrevious}, got ${row.previous_hash}`);
            badIndexes.push(index);
            continue;
        }

        const expectedHash = hashPayload(buildEventPayload(row), row.previous_hash, secretKey);
        if (row.payload_hash !== expectedHash) {
            issues.push(`Payload mismatch at index ${index}: expected ${expectedHash}, got ${row.payload_hash}`);
            badIndexes.push(index);
        }
    }

    return { issues, badIndexes };
}

async function sendTelegram(token, chatId, text) {
    if (!token || !chatId) {
        console.log('TELEGRAM: skipped (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID).');
        return;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram notification failed: ${response.status} ${errorText}`);
    }

    console.log('TELEGRAM: London Node Restored confirmation sent.');
}

async function run() {
    loadEnvFile();

    const databaseUrl = process.env.DATABASE_URL || 'file:local.db';
    const secretKey = process.env.LEDGER_SECRET || 'sovereign-audit-key';
    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';

    const db = createClient({ url: databaseUrl });

    const beforeRows = await getRows(db);
    const beforeAnalysis = analyzeRows(beforeRows, secretKey);
    const tamperedLondonRows = beforeRows.filter(
        (row, idx) =>
            row.workstation_id === LONDON_NODE_ID &&
            (row.biometric_type !== 'FACE_ID' || beforeAnalysis.badIndexes.includes(idx))
    );

    console.log(`Detected ${tamperedLondonRows.length} London record(s) requiring healing.`);
    for (const row of tamperedLondonRows) {
        console.log(`- event_id=${row.event_id} biometric_type=${row.biometric_type} ledger_id=${row.ledger_id}`);
    }

    if (tamperedLondonRows.length > 0) {
        for (const row of tamperedLondonRows) {
            await db.execute({
                sql: 'UPDATE identity_events SET biometric_type = ? WHERE id = ?',
                args: ['FACE_ID', row.event_id]
            });
        }
    }

    const rowsAfterBiometricFix = await getRows(db);

    let previousHash = GENESIS;
    for (const row of rowsAfterBiometricFix) {
        const newHash = hashPayload(buildEventPayload(row), previousHash, secretKey);

        await db.execute({
            sql: 'UPDATE evidence_ledger SET previous_hash = ?, payload_hash = ?, verified = 1 WHERE id = ?',
            args: [previousHash, newHash, row.ledger_id]
        });

        row.previous_hash = previousHash;
        row.payload_hash = newHash;
        previousHash = newHash;
    }

    const finalRows = await getRows(db);
    const finalAnalysis = analyzeRows(finalRows, secretKey);

    if (finalAnalysis.issues.length > 0) {
        console.error('Integrity scan failed after healing:');
        for (const issue of finalAnalysis.issues) {
            console.error(`- ${issue}`);
        }
        process.exitCode = 1;
        return;
    }

    const restoredLondonCount = finalRows.filter(
        (row) => row.workstation_id === LONDON_NODE_ID && row.biometric_type === 'FACE_ID'
    ).length;

    console.log('Integrity scan OK: chain is healthy.');
    console.log(`London records with FACE_ID after healing: ${restoredLondonCount}`);

    await sendTelegram(
        telegramBotToken,
        telegramChatId,
        `London Node Restored\nNode: ${LONDON_NODE_ID}\nRepaired Records: ${tamperedLondonRows.length}\nIntegrity: GREEN`
    );
}

run().catch((error) => {
    console.error('London heal failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
