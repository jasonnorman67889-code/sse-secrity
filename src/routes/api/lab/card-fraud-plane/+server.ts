import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs } from '$lib/server/db/schema';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';

type CardFraudLabRequest = {
	userId?: string;
	nodeId?: string;
	campaignId?: string;
	merchantPattern?: string;
	timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json().catch(() => ({}))) as CardFraudLabRequest;

	if (!payload.userId || !payload.nodeId) {
		return json({ error: 'userId and nodeId are required' }, { status: 400 });
	}

	const campaignId = payload.campaignId ?? 'simulation-campaign-441';

	const [event] = await db
		.insert(identityLogs)
		.values({
			userId: payload.userId,
			type: 'card_verification_scam',
			nodeId: payload.nodeId,
			metadata: JSON.stringify({
				telemetry_only: true,
				simulation: true,
				plane: 'card-fraud-lab',
				patternType: 'bin_enumeration',
				pattern: payload.merchantPattern ?? 'BIN-ENUM-441',
				campaignId
			}),
			timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
		})
		.returning();

	const threatBus = await evaluateFinancialThreatBus({
		userId: payload.userId,
		nodeId: payload.nodeId,
		plane: 'card',
		signal: 'card_verification_scam',
		campaignId
	});

	return json({ event, threatBus, mode: 'isolated-lab', telemetry_only: true }, { status: 201 });
};
