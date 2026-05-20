const BASE_URL = process.env.SCC_BASE_URL || 'http://localhost:5173';
const MAX_RESPONSE_MS = Number(process.env.CORRELATION_MAX_RESPONSE_MS || '2000');

async function post(path, body) {
    const startedAt = Date.now();
    const response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const elapsedMs = Date.now() - startedAt;
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${path} failed: ${response.status} ${text}`);
    }

    return {
        elapsedMs,
        payload: JSON.parse(text)
    };
}

async function run() {
    const userId = `smoke-correlation-${crypto.randomUUID().slice(0, 8)}`;
    const sourceNode = 'Node-LA-01';
    const targetNode = 'Node-LDN-01';

    await post('/api/risk/spam-events', {
        userId,
        nodeId: sourceNode,
        urlClicked: true,
        campaignId: 'smoke-correlation',
        timestamp: new Date().toISOString()
    });

    const identity = await post('/api/risk/identity-logs', {
        userId,
        type: 'impossible_travel',
        nodeId: targetNode,
        metadata: {
            source: sourceNode,
            target: targetNode,
            bypassCount: 3,
            newDevice: true
        },
        timestamp: new Date().toISOString()
    });

    const correlation = identity.payload?.correlation;
    if (!correlation?.triggered) {
        throw new Error('Expected triggered correlation but received non-triggered response.');
    }

    if (!correlation.fusion || !correlation.why) {
        throw new Error('Triggered correlation must contain both fusion and why payloads.');
    }

    if (!Array.isArray(correlation.why.reasons) || typeof correlation.why.summary !== 'string') {
        throw new Error('Why payload is malformed on triggered correlation response.');
    }

    if (identity.elapsedMs > MAX_RESPONSE_MS) {
        throw new Error(
            `Correlation response exceeded latency budget (${identity.elapsedMs}ms > ${MAX_RESPONSE_MS}ms), queue may be blocking.`
        );
    }

    console.log('[SMOKE] triggered=', correlation.triggered);
    console.log('[SMOKE] fusion.score=', correlation.fusion.score);
    console.log('[SMOKE] why.summary=', correlation.why.summary);
    console.log('[SMOKE] latencyMs=', identity.elapsedMs);
    console.log('[SMOKE] PASS');
}

run().catch((error) => {
    console.error('[SMOKE] FAIL:', error.message);
    process.exitCode = 1;
});
