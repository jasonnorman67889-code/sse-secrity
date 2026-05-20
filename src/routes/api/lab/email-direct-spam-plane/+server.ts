import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { spamEvents } from '$lib/server/db/schema';
import { evaluateSpamIdentityCorrelation } from '$lib/server/correlation-engine';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';

type EmailDirectSpamLabRequest = {
	userId?: string;
	nodeId?: string;
	campaignId?: string;
	domain?: string;
	urlClicked?: boolean;
	timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json().catch(() => ({}))) as EmailDirectSpamLabRequest;

	if (!payload.userId || !payload.nodeId) {
		return json({ error: 'userId and nodeId are required' }, { status: 400 });
	}

	const campaignId = payload.campaignId ?? 'simulation-campaign-441';

	const [event] = await db
		.insert(spamEvents)
		.values({
			userId: payload.userId,
			nodeId: payload.nodeId,
			urlClicked: payload.urlClicked ?? true,
			campaignId: `${campaignId}:${payload.domain ?? 'direct-mail-lab'}`,
			timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
		})
		.returning();

	const correlation = await evaluateSpamIdentityCorrelation(payload.userId);
	const threatBus = await evaluateFinancialThreatBus({
		userId: payload.userId,
		nodeId: payload.nodeId,
		plane: 'email',
		signal: 'credential_phish',
		campaignId
	});

	return json(
		{ event, correlation, threatBus, mode: 'isolated-lab', telemetry_only: true },
		{ status: 201 }
	);
};
