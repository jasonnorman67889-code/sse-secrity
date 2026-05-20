import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs } from '$lib/server/db/schema';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';

type LoginThreatLabRequest = {
	userId?: string;
	nodeId?: string;
	campaignId?: string;
	bypassCount?: number;
	timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json().catch(() => ({}))) as LoginThreatLabRequest;

	if (!payload.userId || !payload.nodeId) {
		return json({ error: 'userId and nodeId are required' }, { status: 400 });
	}

	const campaignId = payload.campaignId ?? 'simulation-campaign-441';

	const [event] = await db
		.insert(identityLogs)
		.values({
			userId: payload.userId,
			type: 'otp_forwarding_attempt',
			nodeId: payload.nodeId,
			metadata: JSON.stringify({
				telemetry_only: true,
				simulation: true,
				plane: 'login-threat-lab',
				fakePortal: 'FakePortal',
				bypassCount: payload.bypassCount ?? 2,
				campaignId
			}),
			timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
		})
		.returning();

	const threatBus = await evaluateFinancialThreatBus({
		userId: payload.userId,
		nodeId: payload.nodeId,
		plane: 'login',
		signal: 'otp_forwarding_attempt',
		campaignId
	});

	return json({ event, threatBus, mode: 'isolated-lab', telemetry_only: true }, { status: 201 });
};
