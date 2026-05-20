import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs, spamEvents } from '$lib/server/db/schema';
import { evaluateSpamIdentityCorrelation } from '$lib/server/correlation-engine';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';
import { randomUUID } from 'node:crypto';

type Replay118Request = {
    userId?: string;
    sourceNode?: string;
    targetNode?: string;
};

type ReplayStep = {
    stepId: string;
    phase: string;
    label: string;
    nodeId: string;
    timestamp: string;
    trustScore: number;
    arcState: 'amber' | 'red' | 'shield';
};

export const POST: RequestHandler = async ({ request }) => {
    const payload = (await request.json().catch(() => ({}))) as Replay118Request;

    const userId = payload.userId ?? `replay-118-${randomUUID().slice(0, 10)}`;
    const sourceNode = payload.sourceNode ?? 'Node-LA-01';
    const targetNode = payload.targetNode ?? 'Node-SGP-01';
    const start = Date.now();
    const campaignId = 'simulation-operational-crisis-118';
    const timeline: ReplayStep[] = [];

    await db.insert(spamEvents).values({
        userId,
        nodeId: sourceNode,
        urlClicked: true,
        campaignId,
        timestamp: new Date(start)
    });

    const delivery = await evaluateFinancialThreatBus({
        userId,
        nodeId: sourceNode,
        plane: 'email',
        signal: 'credential_phish',
        campaignId
    });

    timeline.push({
        stepId: 'delivery',
        phase: 'Email/Direct Spam Plane',
        label: 'Synthetic lateral spam propagation initiated',
        nodeId: sourceNode,
        timestamp: new Date(start).toISOString(),
        trustScore: delivery.trustScore,
        arcState: 'amber'
    });

    await db.insert(identityLogs).values({
        userId,
        type: 'otp_forwarding_attempt',
        nodeId: targetNode,
        metadata: JSON.stringify({
            telemetry_only: true,
            simulation: true,
            bypassCount: 4,
            campaignId
        }),
        timestamp: new Date(start + 50_000)
    });

    await db.insert(identityLogs).values({
        userId,
        type: 'impossible_travel',
        nodeId: targetNode,
        metadata: JSON.stringify({
            telemetry_only: true,
            simulation: true,
            source: sourceNode,
            target: targetNode,
            bypassCount: 4,
            newDevice: true,
            campaignId
        }),
        timestamp: new Date(start + 72_000)
    });

    const detection = await evaluateFinancialThreatBus({
        userId,
        nodeId: targetNode,
        plane: 'login',
        signal: 'otp_forwarding_attempt',
        campaignId
    });

    timeline.push({
        stepId: 'detection',
        phase: 'Login Threat Plane',
        label: 'Geo-velocity anomaly validated by AI Sentinel',
        nodeId: targetNode,
        timestamp: new Date(start + 72_000).toISOString(),
        trustScore: detection.trustScore,
        arcState: 'red'
    });

    await db.insert(identityLogs).values({
        userId,
        type: 'otp_harvest',
        nodeId: targetNode,
        metadata: JSON.stringify({
            telemetry_only: true,
            simulation: true,
            bankBrand: 'GlobalTrust Bank',
            campaignId
        }),
        timestamp: new Date(start + 95_000)
    });

    await db.insert(identityLogs).values({
        userId,
        type: 'card_verification_scam',
        nodeId: sourceNode,
        metadata: JSON.stringify({
            telemetry_only: true,
            simulation: true,
            patternType: 'bin_enumeration',
            pattern: 'BIN-ENUM-118',
            campaignId
        }),
        timestamp: new Date(start + 128_000)
    });

    const containment = await evaluateFinancialThreatBus({
        userId,
        nodeId: sourceNode,
        plane: 'card',
        signal: 'card_verification_scam',
        campaignId
    });

    timeline.push({
        stepId: 'containment',
        phase: 'Fraud Defense Plane',
        label: 'SOAR isolation preserves global strategic equilibrium',
        nodeId: sourceNode,
        timestamp: new Date(start + 128_000).toISOString(),
        trustScore: containment.readinessMetric?.postMitigationTrust ?? containment.trustScore,
        arcState: 'shield'
    });

    const correlation = await evaluateSpamIdentityCorrelation(userId);

    return json(
        {
            replayId: 118,
            telemetry_only: true,
            campaignId,
            userId,
            timeline,
            bottleneckStep: 'detection',
            bottleneckReason: 'Geo-velocity and device drift required dual-plane confirmation before containment escalation.',
            timeToContainmentMs: 128_000,
            continuity: containment.continuity,
            phases: {
                delivery,
                detection,
                containment
            },
            correlation
        },
        { status: 201 }
    );
};
