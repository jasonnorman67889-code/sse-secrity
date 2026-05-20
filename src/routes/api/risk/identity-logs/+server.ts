import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs } from '$lib/server/db/schema';
import { evaluateSpamIdentityCorrelation } from '$lib/server/correlation-engine';
import { evaluateFinancialThreatBus, type FinancialPlane } from '$lib/server/financial-threat-bus';

type IdentityLogRequest = {
	userId?: string;
	type?: string;
	nodeId?: string;
	metadata?: unknown;
	timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json()) as IdentityLogRequest;

	if (!payload.userId || !payload.type || !payload.nodeId) {
		return json({ error: 'userId, type, and nodeId are required' }, { status: 400 });
	}

	const [event] = await db
		.insert(identityLogs)
		.values({
			userId: payload.userId,
			type: payload.type,
			nodeId: payload.nodeId,
			metadata: payload.metadata === undefined ? null : JSON.stringify(payload.metadata),
			timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
		})
		.returning();

	const correlation = await evaluateSpamIdentityCorrelation(payload.userId);
	const normalizedType = payload.type.toLowerCase();
	const inferredPlane: FinancialPlane =
		normalizedType === 'otp_harvest'
			? 'bank'
			: normalizedType === 'card_verification_scam' || normalizedType === 'bin_enumeration'
				? 'card'
				: 'login';
	const threatBus = await evaluateFinancialThreatBus({
		userId: payload.userId,
		nodeId: payload.nodeId,
		plane: inferredPlane,
		signal: payload.type
	});

	return json({ event, correlation, threatBus }, { status: 201 });
};
