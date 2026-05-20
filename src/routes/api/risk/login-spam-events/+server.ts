import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs } from '$lib/server/db/schema';
import { evaluateSpamIdentityCorrelation } from '$lib/server/correlation-engine';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';

type LoginSpamEventRequest = {
    userId?: string;
    nodeId?: string;
    signal?: string;
    fakePortal?: string | null;
    otpForwarding?: boolean;
    bypassCount?: number;
    telemetryOnly?: boolean;
    timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
    const payload = (await request.json()) as LoginSpamEventRequest;

    if (!payload.userId || !payload.nodeId) {
        return json({ error: 'userId and nodeId are required' }, { status: 400 });
    }

    const signal = payload.signal ?? 'otp_forwarding_attempt';
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
                fakePortal: payload.fakePortal ?? 'FakePortal',
                otpForwarding: payload.otpForwarding ?? true,
                bypassCount: payload.bypassCount ?? 1
            }),
            timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
        })
        .returning();

    const correlation = await evaluateSpamIdentityCorrelation(payload.userId);
    const threatBus = await evaluateFinancialThreatBus({
        userId: payload.userId,
        nodeId: payload.nodeId,
        plane: 'login',
        signal
    });

    return json({ event, correlation, threatBus, telemetry_only: telemetryOnly }, { status: 201 });
};
