import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { spamEvents } from '$lib/server/db/schema';
import { evaluateSpamIdentityCorrelation } from '$lib/server/correlation-engine';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';

type EmailSpamEventRequest = {
    userId?: string;
    nodeId?: string;
    domain?: string;
    campaignId?: string | null;
    signal?: string;
    urlClicked?: boolean;
    telemetryOnly?: boolean;
    timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
    const payload = (await request.json()) as EmailSpamEventRequest;

    if (!payload.userId || !payload.nodeId) {
        return json({ error: 'userId and nodeId are required' }, { status: 400 });
    }

    const signal = payload.signal ?? 'credential_phish';
    const campaignId = payload.campaignId ?? `simulation-campaign:${payload.domain ?? 'unknown-domain'}`;
    const telemetryOnly = payload.telemetryOnly ?? true;

    const [event] = await db
        .insert(spamEvents)
        .values({
            userId: payload.userId,
            nodeId: payload.nodeId,
            urlClicked: payload.urlClicked ?? true,
            campaignId,
            timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
        })
        .returning();

    const correlation = await evaluateSpamIdentityCorrelation(payload.userId);
    const threatBus = await evaluateFinancialThreatBus({
        userId: payload.userId,
        nodeId: payload.nodeId,
        plane: 'email',
        signal,
        campaignId: campaignId ?? undefined
    });

    return json({ event, correlation, threatBus, telemetry_only: telemetryOnly }, { status: 201 });
};
