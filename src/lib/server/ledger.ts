import crypto from 'node:crypto';
import { db } from './db';
import { evidenceLedger, identityEvents } from './db/schema';
import { asc, desc, eq } from 'drizzle-orm';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const SECRET_KEY = process.env.LEDGER_SECRET || 'sovereign-audit-key';
const GENESIS = 'GENESIS';

export type ChainHealth = {
    ok: boolean;
    totalEntries: number;
    verifiedEntries: number;
    lastHash: string | null;
    issues: string[];
};

function canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item)).join(',')}]`;
    }

    const objectValue = value as Record<string, unknown>;
    const sortedKeys = Object.keys(objectValue).sort();
    return `{${sortedKeys
        .map((key) => `${JSON.stringify(key)}:${canonicalize(objectValue[key])}`)
        .join(',')}}`;
}

export async function secureCommit(eventData: typeof identityEvents.$inferInsert) {
    const [newEvent] = await db.insert(identityEvents).values(eventData).returning();

    if (!newEvent) {
        throw new Error('Failed to insert identity event');
    }

    const lastEntry = await db.query.evidenceLedger.findFirst({
        orderBy: [desc(evidenceLedger.createdAt), desc(evidenceLedger.id)]
    });
    const previousHash = lastEntry ? lastEntry.payloadHash : GENESIS;

    const currentHash = hashPayload(
        buildEventPayload({
            id: newEvent.id,
            timestamp: newEvent.timestamp,
            actorId: newEvent.actorId,
            action: newEvent.action,
            workstationId: newEvent.workstationId,
            biometricType: newEvent.biometricType,
            riskScore: newEvent.riskScore,
            locationData: newEvent.locationData
        }),
        previousHash
    );

    const [ledgerEntry] = await db
        .insert(evidenceLedger)
        .values({
            eventId: newEvent.id,
            payloadHash: currentHash,
            previousHash,
            signature: 'hardware-signed-v1',
            verified: true
        })
        .returning();

    if (!ledgerEntry) {
        throw new Error('Failed to insert evidence ledger entry');
    }

    const chainHealth = await verifyChainHealth();

    await redis.publish(
        'biometric-stream',
        JSON.stringify({
            ...newEvent,
            payloadHash: ledgerEntry.payloadHash,
            signature: ledgerEntry.signature,
            signatureFormat: 'placeholder',
            nodeId: newEvent.workstationId,
            proof: ledgerEntry.payloadHash,
            chainHealth
        })
    );

    return { newEvent, ledgerEntry };
}

function buildEventPayload(event: {
    id: string;
    timestamp: Date | null;
    actorId: string;
    action: string;
    workstationId: string;
    biometricType: string | null;
    riskScore: number | null;
    locationData: string | null;
}) {
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

function hashPayload(payload: unknown, previousHash: string): string {
    const dataToHash = `${canonicalize(payload)}|${previousHash}`;
    return crypto.createHmac('sha256', SECRET_KEY).update(dataToHash).digest('hex');
}

export async function verifyChainHealth(): Promise<ChainHealth> {
    const rows = await db
        .select({
            ledgerId: evidenceLedger.id,
            payloadHash: evidenceLedger.payloadHash,
            previousHash: evidenceLedger.previousHash,
            verified: evidenceLedger.verified,
            createdAt: evidenceLedger.createdAt,
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

    const issues: string[] = [];

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

    const verifiedEntries = rows.filter((row) => row.verified).length;
    const lastHash = rows.length > 0 ? rows[rows.length - 1].payloadHash : null;

    return {
        ok: issues.length === 0,
        totalEntries: rows.length,
        verifiedEntries,
        lastHash,
        issues
    };
}
