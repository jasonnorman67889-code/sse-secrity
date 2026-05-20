import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs } from '$lib/server/db/schema';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';

type BankPhishEventRequest = {
	userId?: string;
	nodeId?: string;
	signal?: string;
	bankBrand?: string;
	otpHarvested?: boolean;
	telemetryOnly?: boolean;
	timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json()) as BankPhishEventRequest;

	if (!payload.userId || !payload.nodeId) {
		return json({ error: 'userId and nodeId are required' }, { status: 400 });
	}

	const signal = payload.signal ?? 'otp_harvest';
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
				bankBrand: payload.bankBrand ?? 'GlobalTrust Bank',
				otpHarvested: payload.otpHarvested ?? true
			}),
			timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
		})
		.returning();

	const threatBus = await evaluateFinancialThreatBus({
		userId: payload.userId,
		nodeId: payload.nodeId,
		plane: 'bank',
		signal
	});

	return json({ event, threatBus, telemetry_only: telemetryOnly }, { status: 201 });
};
