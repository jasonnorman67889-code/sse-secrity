// @ts-nocheck
import crypto from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@libsql/client';
import Redis from 'ioredis';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

const GENESIS = 'GENESIS';
const LOOP_MS = 15_000;
const DEGRADE_DAMPENING_MS = 2_000;
const DEGRADE_CONSECUTIVE_THRESHOLD = 2;
const CACHE_FILE = resolve(process.cwd(), 'scripts', '.sentinel-golden-cache.json');
const AUDIT_LOG_FILE = resolve(process.cwd(), 'logs', 'sentinel_audit.log');

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

function hashPayload(payload, previousHash, secret) {
	const dataToHash = `${canonicalize(payload)}|${previousHash}`;
	return crypto.createHmac('sha256', secret).update(dataToHash).digest('hex');
}

function toIsoTimestamp(value) {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return value.toISOString();

	const raw = typeof value === 'number' ? value : Number(value);
	if (Number.isNaN(raw)) return null;

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

function sleep(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function isQuietModeEnabled() {
	return (process.env.TELEGRAM_QUIET_MODE || 'true').toLowerCase() !== 'false';
}

function writeSecurityAudit(message) {
	mkdirSync(resolve(process.cwd(), 'logs'), { recursive: true });
	appendFileSync(AUDIT_LOG_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8');
}

function resolveTelegramProxy() {
	// Use PROXY_URL from .env for authenticated proxy tunnel
	const proxyUrl =
		process.env.PROXY_URL ||
		process.env.TELEGRAM_HTTPS_PROXY ||
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		'';

	if (!proxyUrl) {
		return null;
	}

	let hasCredentials = false;
	try {
		const parsed = new URL(proxyUrl);
		hasCredentials = Boolean(parsed.username && parsed.password);
	} catch {
		// ignore parse errors, agent will throw if invalid
	}

	return {
		proxyUrl,
		hasCredentials,
		agent: new HttpsProxyAgent(proxyUrl)
	};
}

async function postTelegramMessage(token, chatId, text, proxyConfig) {
	const url = `https://api.telegram.org/bot${token}/sendMessage`;
	const response = await fetch(url, {
		method: 'POST',
		body: JSON.stringify({ chat_id: chatId, text }),
		headers: {
			'Content-Type': 'application/json'
		},
		// Critical line: explicit authenticated proxy tunnel for Node.js
		agent: proxyConfig?.agent
	});

	const body = await response.text();
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		parsed = null;
	}

	if (!response.ok) {
		throw new Error(`Telegram failed: ${response.status} ${body}`);
	}

	if (parsed && parsed.ok === false) {
		throw new Error(`Telegram failed: ${parsed.description || body}`);
	}
}

function loadGoldenCache() {
	if (!existsSync(CACHE_FILE)) {
		return {};
	}

	try {
		const raw = readFileSync(CACHE_FILE, 'utf8');
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') {
			return {};
		}
		return parsed;
	} catch {
		return {};
	}
}

function saveGoldenCache(cache) {
	writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

async function getJoinedRows(db) {
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

function verifyRows(rows, secret) {
	const issues = [];
	const tamperedRows = [];

	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		const expectedPrevious = index === 0 ? GENESIS : rows[index - 1].payload_hash;

		if (row.previous_hash !== expectedPrevious) {
			issues.push(
				`Chain mismatch at index ${index}: expected ${expectedPrevious}, got ${row.previous_hash}`
			);
			continue;
		}

		const expectedHash = hashPayload(buildEventPayload(row), row.previous_hash, secret);
		if (row.payload_hash !== expectedHash) {
			issues.push(
				`Payload mismatch at index ${index}: expected ${expectedHash}, got ${row.payload_hash}`
			);
			tamperedRows.push(row);
		}
	}

	return {
		ok: issues.length === 0,
		totalEntries: rows.length,
		verifiedEntries: rows.filter((row) => Boolean(row.verified)).length,
		lastHash: rows.length > 0 ? rows[rows.length - 1].payload_hash : null,
		issues,
		tamperedRows
	};
}

async function sendTelegramAlert(token, chatId, nodeId) {
	if (!token || !chatId) {
		console.log('SENTINEL: Telegram disabled (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID).');
		return false;
	}

	const text = `Sentinel Action: Drift detected at Node ${nodeId} - Auto-Reverted to Golden Record.`;
	const proxyConfig = resolveTelegramProxy();

	try {
		if (proxyConfig) {
			console.log(
				`SENTINEL: Telegram using HTTPS proxy (${proxyConfig.hasCredentials ? 'authenticated' : 'no credentials detected'}).`
			);
		}
		await postTelegramMessage(token, chatId, text, proxyConfig);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isQuietModeEnabled()) {
			writeSecurityAudit(
				`[SENTINEL][QUIET_MODE] node=${nodeId} telegram_unavailable reason="${message}" action="auto-heal preserved"`
			);
			console.warn(`SENTINEL: Telegram unavailable, recorded in ${AUDIT_LOG_FILE}.`);
			return false;
		}

		throw error;
	}

	return true;
}

async function publishAutoHealPulse(redis, row, chainHealth) {
	await redis.publish(
		'biometric-stream',
		JSON.stringify({
			actorId: 'sovereign-sentinel',
			action: 'AUTO_HEAL_REVERT',
			nodeId: row.workstation_id,
			workstationId: row.workstation_id,
			biometricType: row.biometric_type,
			timestamp: new Date().toISOString(),
			payloadHash: row.payload_hash,
			signature: 'sentinel-auto-heal',
			signatureFormat: 'placeholder',
			proof: row.payload_hash,
			autoHeal: true,
			chainHealth
		})
	);
}

function snapshotFromRow(row) {
	return {
		actor_id: row.actor_id,
		action: row.action,
		workstation_id: row.workstation_id,
		biometric_type: row.biometric_type,
		risk_score: row.risk_score,
		location_data: row.location_data,
		timestamp: row.timestamp
	};
}

function getMode() {
	const args = new Set(process.argv.slice(2));
	return {
		bootstrap: args.has('--bootstrap'),
		allowTaintedBootstrap: args.has('--allow-tainted-bootstrap')
	};
}

function collectVerifiableRows(rows, secret) {
	const verifiableRows = [];
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		const expectedPrevious = index === 0 ? GENESIS : rows[index - 1].payload_hash;
		if (row.previous_hash !== expectedPrevious) {
			continue;
		}

		const expectedHash = hashPayload(buildEventPayload(row), row.previous_hash, secret);
		if (row.payload_hash === expectedHash) {
			verifiableRows.push(row);
		}
	}
	return verifiableRows;
}

function createGraceState() {
	return {
		activeSinceMs: null,
		consecutiveUnresolvedCycles: 0,
		degraded: false
	};
}

function resetGraceState(grace) {
	grace.activeSinceMs = null;
	grace.consecutiveUnresolvedCycles = 0;
	grace.degraded = false;
}

function resolveEffectiveHealth(state, rawHealth, preHealHadMismatch) {
	const now = Date.now();
	const grace = state.integrityGrace;

	if (!rawHealth.ok) {
		if (grace.activeSinceMs === null) {
			grace.activeSinceMs = now;
			grace.consecutiveUnresolvedCycles = 1;
		} else {
			grace.consecutiveUnresolvedCycles += 1;
		}

		const elapsedMs = now - grace.activeSinceMs;
		const persistentMismatch = grace.consecutiveUnresolvedCycles > DEGRADE_CONSECUTIVE_THRESHOLD;
		const dampeningElapsed = elapsedMs >= DEGRADE_DAMPENING_MS;
		const shouldDegrade = persistentMismatch && dampeningElapsed;

		if (shouldDegrade && !grace.degraded) {
			console.error(
				`SENTINEL: RED alert triggered | unresolvedCycles=${grace.consecutiveUnresolvedCycles} | elapsedMs=${elapsedMs}`
			);
		}

		grace.degraded = shouldDegrade;

		if (grace.degraded) {
			return {
				...rawHealth,
				ok: false,
				graceWindow: {
					active: true,
					unresolvedCycles: grace.consecutiveUnresolvedCycles,
					elapsedMs,
					dampeningMs: DEGRADE_DAMPENING_MS,
					thresholdCycles: DEGRADE_CONSECUTIVE_THRESHOLD
				}
			};
		}

		return {
			...rawHealth,
			ok: true,
			issues: [],
			graceWindow: {
				active: true,
				unresolvedCycles: grace.consecutiveUnresolvedCycles,
				elapsedMs,
				dampeningMs: DEGRADE_DAMPENING_MS,
				thresholdCycles: DEGRADE_CONSECUTIVE_THRESHOLD
			}
		};
	}

	if (preHealHadMismatch && !grace.degraded) {
		const elapsedMs = grace.activeSinceMs === null ? 0 : now - grace.activeSinceMs;
		console.log(
			`SENTINEL: Soft Recovery | healedWithinGraceWindow=true | elapsedMs=${elapsedMs} | unresolvedCycles=${grace.consecutiveUnresolvedCycles || 1}`
		);
		writeSecurityAudit(
			`[SENTINEL][SOFT_RECOVERY] healedWithinGraceWindow=true elapsedMs=${elapsedMs} unresolvedCycles=${grace.consecutiveUnresolvedCycles || 1}`
		);
	}

	resetGraceState(grace);
	return {
		...rawHealth,
		ok: true,
		issues: [],
		graceWindow: {
			active: false,
			unresolvedCycles: 0,
			elapsedMs: 0,
			dampeningMs: DEGRADE_DAMPENING_MS,
			thresholdCycles: DEGRADE_CONSECUTIVE_THRESHOLD
		}
	};
}

async function runBootstrap(state, allowTaintedBootstrap) {
	const rows = await getJoinedRows(state.db);
	const health = verifyRows(rows, state.secret);

	if (!health.ok && !allowTaintedBootstrap) {
		console.error(
			`SENTINEL: bootstrap refused because integrity is not fully green (issues=${health.issues.length}).`
		);
		console.error(
			'SENTINEL: run with --allow-tainted-bootstrap to seed cache only from verifiable rows.'
		);
		process.exitCode = 1;
		return;
	}

	const sourceRows = health.ok ? rows : collectVerifiableRows(rows, state.secret);
	const newCache = {};
	for (const row of sourceRows) {
		newCache[row.event_id] = snapshotFromRow(row);
	}

	saveGoldenCache(newCache);

	console.log(
		`SENTINEL: bootstrap complete | cached=${Object.keys(newCache).length} | total=${rows.length} | issues=${health.issues.length}`
	);

	if (!health.ok && allowTaintedBootstrap) {
		console.warn(
			`SENTINEL: tainted bootstrap used. ${rows.length - sourceRows.length} row(s) were excluded from golden cache.`
		);
	}
}

async function healRowFromGolden(db, row, goldenRecord) {
	await db.execute({
		sql: `
            UPDATE identity_events
            SET
                actor_id = ?,
                action = ?,
                workstation_id = ?,
                biometric_type = ?,
                risk_score = ?,
                location_data = ?,
                timestamp = ?
            WHERE id = ?
        `,
		args: [
			goldenRecord.actor_id,
			goldenRecord.action,
			goldenRecord.workstation_id,
			goldenRecord.biometric_type,
			goldenRecord.risk_score,
			goldenRecord.location_data,
			goldenRecord.timestamp,
			row.event_id
		]
	});
}

async function runSentinelCycle(state) {
	await updateBaseline(state); // Ensure baseline is updated before verification

	const rows = await getJoinedRows(state.db);
	const health = verifyRows(rows, state.secret);

	// Log health details for debugging
	console.log(
		`SENTINEL: Integrity check | ok=${health.ok} | totalEntries=${health.totalEntries} | issues=${health.issues.length}`
	);

	const preHealHadMismatch = !health.ok;

	if (!health.ok) {
		console.warn(`SENTINEL: Integrity issues detected. Issues count: ${health.issues.length}`);
	}

	let changedCache = false;

	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		const expectedPrevious = index === 0 ? GENESIS : rows[index - 1].payload_hash;

		const expectedHash = hashPayload(buildEventPayload(row), expectedPrevious, state.secret);
		if (row.previous_hash === expectedPrevious && row.payload_hash === expectedHash) {
			const snapshot = snapshotFromRow(row);
			const existing = state.goldenCache[row.event_id];
			if (JSON.stringify(existing) !== JSON.stringify(snapshot)) {
				state.goldenCache[row.event_id] = snapshot;
				changedCache = true;
			}
		}
	}

	const healedRows = [];
	const missingGoldenRows = [];

	for (const row of health.tamperedRows) {
		const golden = state.goldenCache[row.event_id];
		if (!golden) {
			missingGoldenRows.push(row);
			continue;
		}

		console.warn(`[Sentinel] Drift detected at Index ${row.ledger_id}.`);
		console.warn('[Sentinel] Reverting to Golden Record...');

		await healRowFromGolden(state.db, row, golden);
		healedRows.push({
			...row,
			workstation_id: golden.workstation_id,
			biometric_type: golden.biometric_type
		});
	}

	if (changedCache) {
		saveGoldenCache(state.goldenCache);
	}

	if (missingGoldenRows.length > 0) {
		const sampleIds = missingGoldenRows
			.slice(0, 5)
			.map((row) => row.event_id)
			.join(', ');
		console.warn(
			`SENTINEL: ${missingGoldenRows.length} tampered row(s) lack golden records and could not be auto-healed. Sample event IDs: ${sampleIds}`
		);
	}

	if (healedRows.length === 0) {
		const effectiveHealth = resolveEffectiveHealth(state, health, preHealHadMismatch);
		const stamp = new Date().toISOString();
		console.log(
			`${stamp} SENTINEL: scan complete | entries=${health.totalEntries} | rawIssues=${health.issues.length} | effectiveOk=${effectiveHealth.ok}`
		);
		return;
	}

	const rowsAfterHeal = await getJoinedRows(state.db);
	const postHealHealth = verifyRows(rowsAfterHeal, state.secret);
	const effectivePostHealHealth = resolveEffectiveHealth(state, postHealHealth, preHealHadMismatch);

	for (const healed of healedRows) {
		const nodeId = healed.workstation_id || 'UNKNOWN';
		try {
			const delivered = await sendTelegramAlert(state.telegramToken, state.telegramChatId, nodeId);
			if (delivered) {
				console.log(`SENTINEL: Telegram alert sent for node ${nodeId}.`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`SENTINEL: Telegram alert failed for node ${nodeId}: ${message}`);
		}
	}

	for (const healed of healedRows) {
		await publishAutoHealPulse(state.redis, healed, {
			ok: effectivePostHealHealth.ok,
			totalEntries: effectivePostHealHealth.totalEntries,
			verifiedEntries: effectivePostHealHealth.verifiedEntries,
			lastHash: effectivePostHealHealth.lastHash,
			issues: effectivePostHealHealth.issues,
			graceWindow: effectivePostHealHealth.graceWindow
		});

		const nodeId = healed.workstation_id || 'UNKNOWN';
		console.log(
			`[Sentinel] Node ${nodeId} restored. Integrity: ${effectivePostHealHealth.ok ? '100%' : 'DEGRADED'}`
		);
	}

	const stamp = new Date().toISOString();
	console.log(
		`${stamp} SENTINEL: auto-heal applied | healed=${healedRows.length} | postHealOk=${postHealHealth.ok} | effectiveOk=${effectivePostHealHealth.ok}`
	);

	if (!postHealHealth.ok) {
		console.error('SENTINEL: Post-heal integrity still has issues.');
	}
}

async function updateBaseline(state) {
	const rows = await getJoinedRows(state.db);
	const health = verifyRows(rows, state.secret);

	for (const row of rows) {
		if (!state.goldenCache[row.event_id] && row.verified) {
			console.log(`SENTINEL: Creating Golden Record for event_id=${row.event_id}`);
			state.goldenCache[row.event_id] = snapshotFromRow(row);
		}
	}

	saveGoldenCache(state.goldenCache);
	console.log(
		`SENTINEL: Baseline updated | totalGoldenRecords=${Object.keys(state.goldenCache).length} | entries=${health.totalEntries} | issues=${health.issues.length}`
	);
	if (!health.ok) {
		console.warn('SENTINEL: Baseline refresh completed while integrity is degraded.');
	}
}

async function main() {
	loadEnvFile();
	const mode = getMode();

	const databaseUrl = process.env.DATABASE_URL || 'file:local.db';
	const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

	const state = {
		db: createClient({ url: databaseUrl }),
		redis: new Redis(redisUrl),
		secret: process.env.LEDGER_SECRET || 'sovereign-audit-key',
		telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
		telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
		goldenCache: loadGoldenCache(),
		integrityGrace: createGraceState()
	};

	if (mode.bootstrap) {
		await runBootstrap(state, mode.allowTaintedBootstrap);
		state.redis.disconnect();
		return;
	}

	console.log('SENTINEL: autonomous defense worker started (interval: 15s).');

	while (true) {
		try {
			await runSentinelCycle(state);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`SENTINEL: cycle failed: ${message}`);
		}

		await sleep(LOOP_MS);
	}
}

main().catch((error) => {
	console.error(
		'SENTINEL: fatal startup error:',
		error instanceof Error ? error.message : String(error)
	);
	process.exitCode = 1;
});
