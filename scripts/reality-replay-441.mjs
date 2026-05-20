const BASE_URL = process.env.SCC_BASE_URL || 'http://localhost:5173';

async function run() {
	const response = await fetch(`${BASE_URL}/api/risk/reality-replay/441`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({})
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Replay 441 failed: ${response.status} ${body}`);
	}

	const payload = await response.json();
	console.log('[REPLAY-441] replayId:', payload.replayId);
	console.log('[REPLAY-441] campaignId:', payload.campaignId);
	console.log('[REPLAY-441] timelineSteps:', payload.timeline?.length ?? 0);
	console.log('[REPLAY-441] bottleneck:', payload.bottleneckStep);
	console.log('[REPLAY-441] ttcMs:', payload.timeToContainmentMs);
	console.log('[REPLAY-441] correlationTriggered:', payload.correlation?.triggered === true);

	if (!Array.isArray(payload.timeline) || payload.timeline.length < 3) {
		throw new Error('Replay timeline is incomplete.');
	}

	if (!payload.correlation?.triggered) {
		throw new Error('Replay #441 did not trigger correlation validation.');
	}

	console.log('[REPLAY-441] PASS');
}

run().catch((error) => {
	console.error('[REPLAY-441] FAIL:', error.message);
	process.exitCode = 1;
});
