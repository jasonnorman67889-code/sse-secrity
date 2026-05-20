const BASE_URL = process.env.SCC_BASE_URL || 'http://localhost:5173';

async function run() {
	const response = await fetch(`${BASE_URL}/api/risk/reality-replay/118`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({})
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Replay 118 failed: ${response.status} ${body}`);
	}

	const payload = await response.json();
	console.log('[REPLAY-118] replayId:', payload.replayId);
	console.log('[REPLAY-118] campaignId:', payload.campaignId);
	console.log('[REPLAY-118] telemetry_only:', payload.telemetry_only === true);
	console.log('[REPLAY-118] bottleneck:', payload.bottleneckStep);
	console.log('[REPLAY-118] ttcMs:', payload.timeToContainmentMs);
	console.log('[REPLAY-118] equilibrium:', payload.continuity?.globalStrategicEquilibrium ?? 'n/a');

	if (!payload.telemetry_only) {
		throw new Error('Replay #118 payload missing telemetry_only flag.');
	}

	if (!Array.isArray(payload.timeline) || payload.timeline.length < 3) {
		throw new Error('Replay #118 timeline is incomplete.');
	}

	console.log('[REPLAY-118] PASS');
}

run().catch((error) => {
	console.error('[REPLAY-118] FAIL:', error.message);
	process.exitCode = 1;
});
