import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs, spamEvents } from '$lib/server/db/schema';
import { evaluateSpamIdentityCorrelation } from '$lib/server/correlation-engine';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';
import { randomUUID } from 'node:crypto';

type RealityReplayRequest = {
    userId?: string;
    sourceNode?: string;
    targetNode?: string;
};

export const POST: RequestHandler = async ({ request }) => {
    const payload = (await request.json().catch(() => ({}))) as RealityReplayRequest;

    const userId = payload.userId ?? `replay-991-${randomUUID().slice(0, 10)}`;
    const sourceNode = payload.sourceNode ?? 'Node-LA-01';
    const targetNode = payload.targetNode ?? 'Node-LDN-01';
    const now = new Date();

    const [deliveryEvent] = await db
        .insert(spamEvents)
        .values({
            userId,
            nodeId: sourceNode,
            urlClicked: true,
            campaignId: 'simulation-campaign-991',
            timestamp: now
        })
        .returning();

    const deliveryBus = await evaluateFinancialThreatBus({
        userId,
        nodeId: sourceNode,
        plane: 'email',
        signal: 'credential_phish',
        campaignId: 'simulation-campaign-991'
    });

    const [entryEvent] = await db
        .insert(identityLogs)
        .values({
            userId,
            type: 'otp_forwarding_attempt',
            nodeId: targetNode,
            metadata: JSON.stringify({
                telemetry_only: true,
                simulation: true,
                fakePortal: 'FakePortal',
                otpForwarding: true,
                bypassCount: 3,
                newDevice: true
            }),
            timestamp: new Date(now.getTime() + 30_000)
        })
        .returning();

    const [travelEvent] = await db
        .insert(identityLogs)
        .values({
            userId,
            type: 'impossible_travel',
            nodeId: targetNode,
            metadata: JSON.stringify({
                telemetry_only: true,
                simulation: true,
                source: sourceNode,
                target: targetNode,
                bypassCount: 3,
                newDevice: true
            }),
            timestamp: new Date(now.getTime() + 45_000)
        })
        .returning();

    const entryBus = await evaluateFinancialThreatBus({
        userId,
        nodeId: targetNode,
        plane: 'login',
        signal: 'otp_forwarding_attempt'
    });

    const [takeoverEvent] = await db
        .insert(identityLogs)
        .values({
            userId,
            type: 'otp_harvest',
            nodeId: targetNode,
            metadata: JSON.stringify({
                telemetry_only: true,
                simulation: true,
                bankBrand: 'GlobalTrust Bank',
                otpHarvested: true
            }),
            timestamp: new Date(now.getTime() + 60_000)
        })
        .returning();

    const takeoverBus = await evaluateFinancialThreatBus({
        userId,
        nodeId: targetNode,
        plane: 'bank',
        signal: 'otp_harvest'
    });

    const [monetizationEvent] = await db
        .insert(identityLogs)
        .values({
            userId,
            type: 'card_verification_scam',
            nodeId: sourceNode,
            metadata: JSON.stringify({
                telemetry_only: true,
                simulation: true,
                panCaptured: true,
                cvvCaptured: true,
                patternType: 'bin_enumeration',
                pattern: 'BIN-ENUM-991',
                bankBrand: 'GlobalTrust Bank'
            }),
            timestamp: new Date(now.getTime() + 90_000)
        })
        .returning();

    const monetizationBus = await evaluateFinancialThreatBus({
        userId,
        nodeId: sourceNode,
        plane: 'card',
        signal: 'card_verification_scam'
    });

    const correlation = await evaluateSpamIdentityCorrelation(userId);

    const autonomousRecoveryVerified =
        monetizationBus.mitigationTriggered && monetizationBus.autonomousPlaybooks.length >= 3;

    return json(
        {
            campaignId: 'simulation-campaign-991',
            telemetry_only: true,
            userId,
            timeline: {
                deliveryEvent,
                entryEvent,
                travelEvent,
                takeoverEvent,
                monetizationEvent
            },
            phases: {
                delivery: deliveryBus,
                entry: entryBus,
                takeover: takeoverBus,
                monetization: monetizationBus
            },
            correlation,
            autonomousRecoveryVerified,
            continuity: monetizationBus.continuity
        },
        { status: 201 }
    );
};
