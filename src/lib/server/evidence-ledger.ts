import crypto from 'node:crypto';
import { prisma } from '$lib/server/prisma';

const GENESIS_BLOCK = 'GENESIS_BLOCK';
const SECRET_KEY = process.env.LEDGER_SECRET || 'your-sovereign-secret';

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

function buildEventPayload(event: {
    id: string;
    timestamp: Date;
    actorId: string;
    action: string;
    workstationId: string;
    biometricType: string | null;
    riskScore: number;
    locationData: unknown;
}) {
    return {
        id: event.id,
        timestamp: event.timestamp.toISOString(),
        actorId: event.actorId,
        action: event.action,
        workstationId: event.workstationId,
        biometricType: event.biometricType,
        riskScore: event.riskScore,
        locationData: event.locationData
    };
}

function hashPayload(payload: unknown, previousHash: string): string {
    const dataToSign = `${canonicalize(payload)}|${previousHash}`;
    return crypto.createHmac('sha256', SECRET_KEY).update(dataToSign).digest('hex');
}

/**
 * Commits an identity event to the append-only evidence ledger.
 */
export async function commitToLedger(identityEventId: string) {
    const event = await prisma.identityEvent.findUnique({
        where: { id: identityEventId }
    });

    if (!event) {
        throw new Error(`Identity event not found: ${identityEventId}`);
    }

    const lastEntry = await prisma.evidenceLedger.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    const previousHash = lastEntry ? lastEntry.payloadHash : GENESIS_BLOCK;
    const payload = buildEventPayload(event);
    const payloadHash = hashPayload(payload, previousHash);

    return prisma.evidenceLedger.create({
        data: {
            eventId: identityEventId,
            payloadHash,
            previousHash,
            signature: 'signed-by-sovereign-ca',
            verified: true
        }
    });
}

export async function verifyLedgerChain() {
    const entries = await prisma.evidenceLedger.findMany({
        include: { event: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

    const issues: string[] = [];

    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const expectedPrevious = index === 0 ? GENESIS_BLOCK : entries[index - 1].payloadHash;

        if (entry.previousHash !== expectedPrevious) {
            issues.push(
                `Chain mismatch at index ${index} (entry ${entry.id}): expected previousHash ${expectedPrevious}, got ${entry.previousHash}`
            );
            continue;
        }

        const payload = buildEventPayload(entry.event);
        const expectedHash = hashPayload(payload, entry.previousHash);

        if (entry.payloadHash !== expectedHash) {
            issues.push(
                `Payload hash mismatch at index ${index} (entry ${entry.id}): expected ${expectedHash}, got ${entry.payloadHash}`
            );
        }
    }

    return {
        ok: issues.length === 0,
        totalEntries: entries.length,
        issues
    };
}
