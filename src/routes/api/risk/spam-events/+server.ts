import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { spamEvents } from '$lib/server/db/schema';
import { evaluateSpamIdentityCorrelation } from '$lib/server/correlation-engine';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';

type SpamEventRequest = {
    userId?: string;
    nodeId?: string;
    urlClicked?: boolean;
    campaignId?: string | null;
    timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
    const payload = (await request.json()) as SpamEventRequest;

    if (!payload.userId || !payload.nodeId) {
        return json({ error: 'userId and nodeId are required' }, { status: 400 });
    }

    const [event] = await db
        .insert(spamEvents)
        .values({
            userId: payload.userId,
            nodeId: payload.nodeId,
            urlClicked: Boolean(payload.urlClicked),
            campaignId: payload.campaignId ?? null,
            timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
        })
        .returning();

    const correlation = await evaluateSpamIdentityCorrelation(payload.userId);
    const threatBus = await evaluateFinancialThreatBus({
        userId: payload.userId,
        nodeId: payload.nodeId,
        plane: 'email',
        signal: 'credential_phish',
        campaignId: payload.campaignId ?? undefined
    });

    return json({ event, correlation, threatBus }, { status: 201 });
};
