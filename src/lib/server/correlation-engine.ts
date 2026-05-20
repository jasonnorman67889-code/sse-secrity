import { db } from '$lib/server/db';
import { identityLogs, spamEvents } from '$lib/server/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import Redis from 'ioredis';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
	CORRELATION_RULE_ID,
	CORRELATION_WINDOW_MINUTES,
	isSpamIdentityCorrelationTriggered
} from '$lib/server/correlation-rule';
import { evaluateSpamIdentityFusion, type FusionEvaluation } from '$lib/server/fusion-model';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

type SoarContext = {
	userId: string;
	sourceNode: string;
	targetNode: string;
	riskScore: number;
	spamEventId: string;
	identityLogId: string;
	fusion: FusionEvaluation;
};

type GraphWriteJob = SoarContext & { enqueuedAt: number };

const graphWriteQueue: GraphWriteJob[] = [];
let graphWriteWorkerActive = false;
const GRAPH_QUEUE_MAX = Number(process.env.CORRELATION_GRAPH_QUEUE_MAX || '500');

function resolveTelegramProxy() {
	const proxyUrl = process.env.PROXY_URL || process.env.TELEGRAM_HTTPS_PROXY || '';
	if (!proxyUrl) return null;
	return new HttpsProxyAgent(proxyUrl);
}

async function sendTelegramSoarAlert(context: SoarContext) {
	const token = process.env.TELEGRAM_BOT_TOKEN;
	const chatId = process.env.TELEGRAM_CHAT_ID;
	if (!token || !chatId) {
		return;
	}

	const message = [
		'\ud83d\udea8 Omni-SOC Correlation Triggered',
		`rule=${CORRELATION_RULE_ID}`,
		`user=${context.userId}`,
		`path=${context.sourceNode} -> ${context.targetNode}`,
		`risk=${context.riskScore}`,
		`why=${context.fusion.summary}`
	].join('\n');

	await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ chat_id: chatId, text: message }),
		// Proxy is optional and only applied when configured.
		agent: resolveTelegramProxy()
	} as RequestInit);
}

async function revokeUserSessions(userId: string) {
	// Session storage is not yet configured in this repository.
	console.warn(
		`[SOAR] Session revocation requested for ${userId}, but no session store is configured.`
	);
}

async function publishCorrelationToNeo4j(context: SoarContext) {
	const baseUrl = process.env.NEO4J_HTTP_URL || 'http://localhost:7474';
	const user = process.env.NEO4J_USER || 'neo4j';
	const password = process.env.NEO4J_PASSWORD || 'password';

	const statement = {
		statements: [
			{
				statement: `
                    MERGE (u:User {id: $userId})
                    MERGE (s:Node {id: $sourceNode})
                    MERGE (t:Node {id: $targetNode})
                    MERGE (u)-[:EXPOSED_AT]->(s)
                    MERGE (s)-[r:PIVOT_ATTEMPT {ruleId: $ruleId}]->(t)
                    SET r.riskScore = $riskScore,
                        r.classification = 'Likely Account Takeover',
                        r.explainSummary = $explainSummary,
                        r.lastSeenAt = datetime()
                `,
				parameters: {
					userId: context.userId,
					sourceNode: context.sourceNode,
					targetNode: context.targetNode,
					ruleId: CORRELATION_RULE_ID,
					riskScore: context.riskScore,
					explainSummary: context.fusion.summary
				}
			}
		]
	};

	const authHeader = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

	try {
		await fetch(`${baseUrl}/db/neo4j/tx/commit`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: authHeader
			},
			body: JSON.stringify(statement)
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[SOAR] Neo4j graph publish failed: ${message}`);
	}
}

function enqueueGraphWrite(context: SoarContext) {
	if (graphWriteQueue.length >= GRAPH_QUEUE_MAX) {
		graphWriteQueue.shift();
		console.warn('[SOAR] Graph queue at capacity, dropping oldest write job.');
	}

	// Queue write jobs so Neo4j latency cannot block SSE emission.
	graphWriteQueue.push({ ...context, enqueuedAt: Date.now() });
	void drainGraphWriteQueue();
}

export function getGraphQueueState() {
	return {
		depth: graphWriteQueue.length,
		workerActive: graphWriteWorkerActive,
		queueMax: GRAPH_QUEUE_MAX
	};
}

async function drainGraphWriteQueue() {
	if (graphWriteWorkerActive) {
		return;
	}

	graphWriteWorkerActive = true;
	try {
		while (graphWriteQueue.length > 0) {
			const next = graphWriteQueue.shift();
			if (!next) {
				continue;
			}
			await publishCorrelationToNeo4j(next);
		}
	} finally {
		graphWriteWorkerActive = false;
		if (graphWriteQueue.length > 0) {
			void drainGraphWriteQueue();
		}
	}
}

export async function triggerSOAR(context: SoarContext) {
	console.log(`[SOAR] Containing user ${context.userId}. risk=${context.riskScore}`);

	// Keep graph writes off the request/SSE critical path.
	enqueueGraphWrite(context);

	await redis.publish(
		'biometric-stream',
		JSON.stringify({
			actorId: 'sovereign-correlation-engine',
			action: 'SPAM_IDENTITY_CORRELATED',
			nodeId: context.sourceNode,
			timestamp: new Date().toISOString(),
			riskScore: context.riskScore,
			fusion: {
				modelVersion: context.fusion.modelVersion,
				score: context.fusion.score,
				threshold: context.fusion.threshold,
				summary: context.fusion.summary,
				reasons: context.fusion.reasons,
				features: context.fusion.features
			},
			spamExposure: {
				userId: context.userId,
				nodeId: context.sourceNode,
				severity: 'high'
			},
			attackPath: {
				sourceNode: context.sourceNode,
				targetNode: context.targetNode,
				classification: 'Likely Account Takeover',
				ruleId: CORRELATION_RULE_ID,
				severity: 'critical'
			},
			soar: {
				status: 'contained',
				spamEventId: context.spamEventId,
				identityLogId: context.identityLogId
			},
			why: {
				summary: context.fusion.summary,
				reasons: context.fusion.reasons
			}
		})
	);

	void Promise.allSettled([sendTelegramSoarAlert(context), revokeUserSessions(context.userId)]);
}

export async function evaluateSpamIdentityCorrelation(userId: string) {
	const now = new Date();
	const earliest = new Date(now.getTime() - CORRELATION_WINDOW_MINUTES * 60 * 1000);

	const [spamEvent] = await db
		.select()
		.from(spamEvents)
		.where(
			and(
				eq(spamEvents.userId, userId),
				eq(spamEvents.urlClicked, true),
				gte(spamEvents.timestamp, earliest)
			)
		)
		.orderBy(desc(spamEvents.timestamp))
		.limit(1);

	const [travelEvent] = await db
		.select()
		.from(identityLogs)
		.where(
			and(
				eq(identityLogs.userId, userId),
				eq(identityLogs.type, 'impossible_travel'),
				gte(identityLogs.timestamp, earliest)
			)
		)
		.orderBy(desc(identityLogs.timestamp))
		.limit(1);

	if (!spamEvent || !travelEvent || !spamEvent.timestamp || !travelEvent.timestamp) {
		return { triggered: false };
	}

	const fusion = evaluateSpamIdentityFusion({
		spamTimestamp: spamEvent.timestamp,
		identityTimestamp: travelEvent.timestamp,
		sourceNode: spamEvent.nodeId,
		targetNode: travelEvent.nodeId,
		identityMetadata: travelEvent.metadata
	});

	if (!isSpamIdentityCorrelationTriggered(spamEvent.timestamp, travelEvent.timestamp)) {
		return { triggered: false, fusion };
	}

	if (!fusion.triggered) {
		return {
			triggered: false,
			fusion
		};
	}

	const context: SoarContext = {
		userId,
		sourceNode: spamEvent.nodeId,
		targetNode: travelEvent.nodeId,
		riskScore: fusion.score,
		spamEventId: spamEvent.id,
		identityLogId: travelEvent.id,
		fusion
	};

	await triggerSOAR(context);

	return {
		triggered: true,
		ruleId: CORRELATION_RULE_ID,
		riskScore: context.riskScore,
		sourceNode: context.sourceNode,
		targetNode: context.targetNode,
		fusion,
		why: {
			summary: fusion.summary,
			reasons: fusion.reasons
		}
	};
}
