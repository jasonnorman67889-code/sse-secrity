import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs } from '$lib/server/db/schema';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';

type BankingPhishLabRequest = {
    userId?: string;
    nodeId?: string;
    campaignId?: string;
    bankBrand?: string;
    timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
    const payload = (await request.json().catch(() => ({}))) as BankingPhishLabRequest;

    if (!payload.userId || !payload.nodeId) {
        return json({ error: 'userId and nodeId are required' }, { status: 400 });
    }

    const campaignId = payload.campaignId ?? 'simulation-campaign-441';

    const [event] = await db
        .insert(identityLogs)
        .values({
            userId: payload.userId,
            type: 'otp_harvest',
            nodeId: payload.nodeId,
            metadata: JSON.stringify({
                telemetry_only: true,
                simulation: true,
                plane: 'banking-phish-lab',
                bankBrand: payload.bankBrand ?? 'GlobalTrust Bank',
                campaignId
            }),
            timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
        })
        .returning();

    const threatBus = await evaluateFinancialThreatBus({
        userId: payload.userId,
        nodeId: payload.nodeId,
        plane: 'bank',
        signal: 'otp_harvest',
        campaignId
    });

    return json({ event, threatBus, mode: 'isolated-lab', telemetry_only: true }, { status: 201 });
};
