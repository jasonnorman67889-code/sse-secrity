import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { secureCommit } from '$lib/server/ledger';

type IdentityEventRequest = {
    actorId?: string;
    action?: string;
    workstationId?: string;
    biometricType?: string | null;
    riskScore?: number;
    locationData?: unknown;
    timestamp?: string;
};

export const POST: RequestHandler = async ({ request }) => {
    const payload = (await request.json()) as IdentityEventRequest;

    if (!payload.actorId || !payload.action || !payload.workstationId) {
        return json(
            {
                error: 'actorId, action, and workstationId are required'
            },
            { status: 400 }
        );
    }

    const locationData =
        payload.locationData === undefined ? null : JSON.stringify(payload.locationData);

    const eventData = {
        actorId: payload.actorId,
        action: payload.action,
        workstationId: payload.workstationId,
        biometricType: payload.biometricType ?? null,
        riskScore: typeof payload.riskScore === 'number' ? payload.riskScore : 0,
        locationData,
        timestamp: payload.timestamp ? new Date(payload.timestamp) : undefined
    };

    const { newEvent, ledgerEntry } = await secureCommit(eventData);

    return json({ event: newEvent, ledgerEntry }, { status: 201 });
};
