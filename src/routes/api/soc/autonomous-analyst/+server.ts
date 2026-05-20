import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runAutonomousSocAnalysis, type AutonomousSocInput } from '$lib/server/autonomous-soc';
import { db } from '$lib/server/db';
import { identityLogs } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';

type AutonomousSocRequest = Partial<AutonomousSocInput>;

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json().catch(() => ({}))) as AutonomousSocRequest;

	const [latestIdentity] = await db
		.select()
		.from(identityLogs)
		.orderBy(desc(identityLogs.timestamp))
		.limit(1);

	const userId = payload.userId ?? latestIdentity?.userId ?? 'soc-sim-user-001';
	const nodeId = payload.nodeId ?? latestIdentity?.nodeId ?? 'Node-LA-01';

	const analysis = await runAutonomousSocAnalysis({
		userId,
		nodeId,
		signal: payload.signal ?? latestIdentity?.type ?? 'impossible_travel',
		anomalyScore: payload.anomalyScore ?? 71,
		ipAddress: payload.ipAddress,
		geoName: payload.geoName,
		metadata: payload.metadata,
		telemetryOnly: true
	});

	return json(
		{
			userId,
			nodeId,
			analysis
		},
		{ status: 200 }
	);
};
