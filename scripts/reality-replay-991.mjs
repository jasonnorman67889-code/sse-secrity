const BASE_URL = process.env.SCC_BASE_URL || 'http://localhost:5173';

async function run() {
	const response = await fetch(`${BASE_URL}/api/risk/reality-replay/991`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({})
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Replay API failed: ${response.status} ${body}`);
	}

	const payload = await response.json();
	const verified = Boolean(payload.autonomousRecoveryVerified);

	console.log('[REPLAY-991] campaignId:', payload.campaignId);
	console.log('[REPLAY-991] userId:', payload.userId);
	console.log('[REPLAY-991] correlationTriggered:', payload.correlation?.triggered === true);
	console.log('[REPLAY-991] finalTrustScore:', payload.phases?.monetization?.trustScore ?? 'n/a');
	console.log(
		'[REPLAY-991] mitigationTriggered:',
		payload.phases?.monetization?.mitigationTriggered
	);
	console.log('[REPLAY-991] autonomousRecoveryVerified:', verified);

	if (!verified) {
		throw new Error('Autonomous recovery loop did not verify for campaign #991.');
	}

	console.log('[REPLAY-991] PASS');
}

run().catch((error) => {
	console.error('[REPLAY-991] FAIL:', error.message);
	process.exitCode = 1;
});
