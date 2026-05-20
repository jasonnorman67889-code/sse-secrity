import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyChainHealth } from '$lib/server/ledger';

export const GET: RequestHandler = async () => {
    const health = await verifyChainHealth();
    return json(health, { status: health.ok ? 200 : 409 });
};
