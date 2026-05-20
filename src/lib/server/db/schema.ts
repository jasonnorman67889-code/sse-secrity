import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Identity Audit Pipeline: The live feed.
export const identityEvents = sqliteTable('identity_events', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	timestamp: integer('timestamp', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
	actorId: text('actor_id').notNull(),
	action: text('action').notNull(),
	workstationId: text('workstation_id').notNull(),
	biometricType: text('biometric_type'),
	riskScore: real('risk_score').default(0.0),
	locationData: text('location_data')
});

// Evidence Ledger: Immutable chain-of-trust entries.
export const evidenceLedger = sqliteTable('evidence_ledger', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	eventId: text('event_id')
		.notNull()
		.references(() => identityEvents.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
	payloadHash: text('payload_hash').notNull(),
	previousHash: text('previous_hash').notNull(),
	signature: text('signature').notNull(),
	verified: integer('verified', { mode: 'boolean' }).default(false)
});

// Spam telemetry for correlation (Spam Plane).
export const spamEvents = sqliteTable('spam_events', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('user_id').notNull(),
	nodeId: text('node_id').notNull(),
	urlClicked: integer('url_clicked', { mode: 'boolean' }).notNull().default(false),
	campaignId: text('campaign_id'),
	timestamp: integer('timestamp', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`)
});

// Identity behavior logs for impossible-travel and related detections (Identity Plane).
export const identityLogs = sqliteTable('identity_logs', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('user_id').notNull(),
	type: text('type').notNull(),
	nodeId: text('node_id').notNull(),
	metadata: text('metadata'),
	timestamp: integer('timestamp', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`)
});

export * from './auth.schema';
