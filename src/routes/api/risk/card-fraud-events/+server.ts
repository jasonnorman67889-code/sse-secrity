import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs } from '$lib/server/db/schema';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';

type CardFraudEventRequest = {
	userId?: string;
	nodeId?: string;
	signal?: string;
	merchantPattern?: string;
	panCaptured?: boolean;
	cvvCaptured?: boolean;
	binEnumeration?: boolean;
	telemetryOnly?: boolean;
	timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json()) as CardFraudEventRequest;

	if (!payload.userId || !payload.nodeId) {
		return json({ error: 'userId and nodeId are required' }, { status: 400 });
	}

	const signal = payload.signal ?? 'card_verification_scam';
	const telemetryOnly = payload.telemetryOnly ?? true;

	const [event] = await db
		.insert(identityLogs)
		.values({
			userId: payload.userId,
			type: signal,
			nodeId: payload.nodeId,
			metadata: JSON.stringify({
				telemetry_only: telemetryOnly,
				simulation: true,
				panCaptured: payload.panCaptured ?? true,
				cvvCaptured: payload.cvvCaptured ?? true,
				patternType: payload.binEnumeration ? 'bin_enumeration' : 'merchant_pattern',
				pattern: payload.merchantPattern ?? 'FRAUD-BURST-001'
			}),
			timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
		})
		.returning();

	const threatBus = await evaluateFinancialThreatBus({
		userId: payload.userId,
		nodeId: payload.nodeId,
		plane: 'card',
		signal
	});

	return json({ event, threatBus, telemetry_only: telemetryOnly }, { status: 201 });
};
