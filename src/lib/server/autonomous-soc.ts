import { db } from '$lib/server/db';
import { identityLogs, spamEvents } from '$lib/server/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import Redis from 'ioredis';
import {
	computeAutonomousSocDecision,
	parseSocPrompt,
	type AutonomousSocDecision
} from './autonomous-soc-logic';

export { computeAutonomousSocDecision, parseSocPrompt } from './autonomous-soc-logic';

const AUTONOMOUS_WINDOW_HOURS = Number(process.env.SOC_AUTONOMOUS_WINDOW_HOURS || '2');
let redis: Redis | null = null;

function getRedisClient() {
	if (!redis) {
		redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
			maxRetriesPerRequest: 1,
			enableOfflineQueue: false
		});
	}

	return redis;
}

type JsonRecord = Record<string, unknown>;

export type AutonomousSocInput = {
	userId: string;
	nodeId: string;
	signal: string;
	anomalyScore: number;
	ipAddress?: string;
	geoName?: string;
	metadata?: JsonRecord;
	telemetryOnly?: boolean;
};

export type AutonomousSocAnalysis = {
	telemetry_only: true;
	tier1: {
		classification: 'likely_false_positive' | 'suspicious' | 'critical';
		summary: string;
		noiseReduced: boolean;
	};
	tier2: {
		source: 'neo4j' | 'sqlite_fallback';
		blastRadius: number;
		lateralMovementPaths: Array<{ sourceNode: string; targetNode: string; riskScore: number }>;
		finding: string;
	};
	tier3: {
		hypotheses: string[];
		globalThreatIntel: {
			source: string;
			indicator: string;
			reputation: 'low' | 'medium' | 'high';
			risk: number;
		};
	};
	responder: AutonomousSocDecision;
};

export type SocChatResult = {
	prompt: string;
	summary: string;
	suggestedAction: string;
	users?: string[];
	graph?: {
		userId: string;
		blastRadius: number;
		finding: string;
	};
	decision?: AutonomousSocDecision;
};

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function parseMetadata(metadata: string | null): JsonRecord {
	if (!metadata) {
		return {};
	}

	try {
		const parsed = JSON.parse(metadata) as JsonRecord;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function normalizeAnomalyScore(raw: number) {
	if (!Number.isFinite(raw)) {
		return 0;
	}

	// Isolation forest can emit negative scores; normalize to 0-100 risk.
	if (raw >= -1 && raw <= 1) {
		return clamp(Math.round(((raw + 1) / 2) * 100), 0, 100);
	}

	return clamp(Math.round(raw), 0, 100);
}

function inferThreatIntel(indicator: string, note = '') {
	const normalizedIndicator = indicator.toLowerCase();
	const normalizedNote = note.toLowerCase();

	const privateIpPrefixes = ['10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.'];
	if (privateIpPrefixes.some((prefix) => normalizedIndicator.startsWith(prefix))) {
		return {
			source: 'stix-taxii-sim',
			indicator,
			reputation: 'low' as const,
			risk: 15
		};
	}

	if (
		normalizedNote.includes('vpn') ||
		normalizedNote.includes('exit node') ||
		normalizedNote.includes('tor') ||
		normalizedNote.includes('bulletproof')
	) {
		return {
			source: 'stix-taxii-sim',
			indicator,
			reputation: 'high' as const,
			risk: 82
		};
	}

	return {
		source: 'stix-taxii-sim',
		indicator,
		reputation: 'medium' as const,
		risk: 48
	};
}

async function queryNeo4jGraph(userId: string) {
	const baseUrl = process.env.NEO4J_HTTP_URL || 'http://localhost:7474';
	const neoUser = process.env.NEO4J_USER || 'neo4j';
	const neoPass = process.env.NEO4J_PASSWORD || 'password';

	const auth = `Basic ${Buffer.from(`${neoUser}:${neoPass}`).toString('base64')}`;

	const body = {
		statements: [
			{
				statement:
					'MATCH (u:User {id: $userId}) OPTIONAL MATCH (u)--(n) RETURN count(DISTINCT n) AS relatedNodes',
				parameters: { userId }
			},
			{
				statement:
					'MATCH (u:User {id: $userId})-[:EXPOSED_AT]->(s)-[r:PIVOT_ATTEMPT]->(t) RETURN s.id AS sourceNode, t.id AS targetNode, coalesce(r.riskScore, 0) AS riskScore ORDER BY riskScore DESC LIMIT 12',
				parameters: { userId }
			}
		]
	};

	const response = await fetch(`${baseUrl}/db/neo4j/tx/commit`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: auth
		},
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		throw new Error(`Neo4j HTTP ${response.status}`);
	}

	const payload = (await response.json()) as {
		results?: Array<{ data?: Array<{ row?: unknown[] }> }>;
	};

	const relatedNodes = Number(payload.results?.[0]?.data?.[0]?.row?.[0] ?? 0);
	const paths = (payload.results?.[1]?.data ?? [])
		.map((entry) => entry.row ?? [])
		.map((row) => ({
			sourceNode: String(row[0] ?? 'unknown'),
			targetNode: String(row[1] ?? 'unknown'),
			riskScore: Number(row[2] ?? 0)
		}));

	return {
		source: 'neo4j' as const,
		blastRadius: clamp(relatedNodes, 0, 999),
		lateralMovementPaths: paths,
		graphRisk: clamp(Math.round(relatedNodes * 12 + paths.length * 6), 0, 100),
		finding:
			paths.length > 0
				? `Graph relationships show ${paths.length} lateral paths across ${relatedNodes} related entities.`
				: 'Graph has limited connected pivots for this user.'
	};
}

async function querySqliteGraphFallback(userId: string) {
	const earliest = new Date(Date.now() - AUTONOMOUS_WINDOW_HOURS * 60 * 60 * 1000);

	const recentSpams = await db
		.select()
		.from(spamEvents)
		.where(and(eq(spamEvents.userId, userId), gte(spamEvents.timestamp, earliest)))
		.orderBy(desc(spamEvents.timestamp))
		.limit(60);

	const recentIdentities = await db
		.select()
		.from(identityLogs)
		.where(and(eq(identityLogs.userId, userId), gte(identityLogs.timestamp, earliest)))
		.orderBy(desc(identityLogs.timestamp))
		.limit(120);

	const pathMap = new Map<string, { sourceNode: string; targetNode: string; riskScore: number }>();
	const pivotCandidates = recentIdentities.filter((event) => event.type === 'impossible_travel');

	for (const pivot of pivotCandidates) {
		const md = parseMetadata(pivot.metadata);
		const sourceNode = String(md.source ?? recentSpams[0]?.nodeId ?? pivot.nodeId ?? 'unknown');
		const targetNode = String(md.target ?? pivot.nodeId ?? 'unknown');
		const riskScore = clamp(Number(md.bypassCount ?? 2) * 10 + (md.newDevice ? 20 : 0), 20, 95);
		const key = `${sourceNode}->${targetNode}`;

		if (!pathMap.has(key)) {
			pathMap.set(key, { sourceNode, targetNode, riskScore });
		}
	}

	const lateralMovementPaths = Array.from(pathMap.values());
	const nodes = new Set<string>();

	for (const event of recentSpams) {
		nodes.add(event.nodeId);
	}
	for (const event of recentIdentities) {
		nodes.add(event.nodeId);
	}

	const blastRadius = nodes.size + lateralMovementPaths.length;
	const graphRisk = clamp(Math.round(blastRadius * 9 + lateralMovementPaths.length * 8), 0, 100);

	return {
		source: 'sqlite_fallback' as const,
		blastRadius,
		lateralMovementPaths,
		graphRisk,
		finding:
			lateralMovementPaths.length > 0
				? `Fallback graph inferred ${lateralMovementPaths.length} lateral pivots over ${blastRadius} entities.`
				: `Fallback graph detected no confirmed lateral pivots for ${userId}.`
	};
}

export async function investigateIdentityGraph(userId: string) {
	try {
		return await queryNeo4jGraph(userId);
	} catch {
		return await querySqliteGraphFallback(userId);
	}
}

function buildHypotheses(input: AutonomousSocInput, graphFinding: string, intelRisk: number) {
	const hypotheses = [
		`Potential session hijack chain anchored on signal ${input.signal}.`,
		`Graph context: ${graphFinding}`
	];

	if (intelRisk >= 70) {
		hypotheses.push(
			'Indicator resembles known hostile infrastructure and should be prioritized for containment.'
		);
	} else {
		hypotheses.push(
			'Indicator currently ambiguous; monitor for recurrence across high-privilege users.'
		);
	}

	if (input.geoName) {
		hypotheses.push(
			`Geo-velocity outlier anchored to ${input.geoName} requires cross-region policy validation.`
		);
	}

	return hypotheses;
}

export async function runAutonomousSocAnalysis(
	input: AutonomousSocInput
): Promise<AutonomousSocAnalysis> {
	const mlAnomaly = normalizeAnomalyScore(input.anomalyScore);
	const graph = await investigateIdentityGraph(input.userId);

	const indicator =
		input.ipAddress ?? String(input.metadata?.ipAddress ?? input.metadata?.ip ?? 'unknown');
	const intel = inferThreatIntel(
		indicator,
		`${input.geoName ?? ''} ${String(input.metadata?.note ?? '')}`
	);

	const privileged = Boolean(
		input.metadata?.financeAdmin || input.metadata?.highPrivilege || false
	);
	const businessImpactRisk = clamp(
		(privileged ? 72 : 45) + (graph.blastRadius > 4 ? 12 : 0),
		0,
		100
	);

	const decision = computeAutonomousSocDecision(
		mlAnomaly,
		graph.graphRisk,
		intel.risk,
		businessImpactRisk
	);

	const tier1Classification: AutonomousSocAnalysis['tier1']['classification'] =
		decision.confidenceScore >= 75
			? 'critical'
			: decision.confidenceScore >= 45
				? 'suspicious'
				: 'likely_false_positive';

	const result: AutonomousSocAnalysis = {
		telemetry_only: true,
		tier1: {
			classification: tier1Classification,
			summary: `Tier 1 triage labeled this anomaly as ${tier1Classification} with confidence ${decision.confidenceScore}%.`,
			noiseReduced: tier1Classification === 'likely_false_positive'
		},
		tier2: {
			source: graph.source,
			blastRadius: graph.blastRadius,
			lateralMovementPaths: graph.lateralMovementPaths,
			finding: graph.finding
		},
		tier3: {
			hypotheses: buildHypotheses(input, graph.finding, intel.risk),
			globalThreatIntel: intel
		},
		responder: decision
	};

	try {
		await getRedisClient().publish(
			'biometric-stream',
			JSON.stringify({
				actorId: 'autonomous-soc-analyst',
				action: 'AUTONOMOUS_SOC_ANALYSIS',
				nodeId: input.nodeId,
				timestamp: new Date().toISOString(),
				riskScore: decision.confidenceScore,
				telemetry_only: true,
				soc: result,
				containment: {
					status: decision.recommendedAction === 'monitor' ? 'monitoring' : 'pending',
					actions:
						decision.recommendedAction === 'isolate_sessions'
							? ['Tier 3 Responder: isolate sessions', 'Tier 3 Responder: revoke tokens']
							: decision.recommendedAction === 'step_up_auth'
								? ['Tier 3 Responder: enforce step-up MFA']
								: []
				}
			})
		);
	} catch {
		// Redis can be unavailable in local test/dev shells. Analysis output still returns to caller.
	}

	return result;
}

async function isolateImpossibleTravelUsers(hours: number) {
	const earliest = new Date(Date.now() - hours * 60 * 60 * 1000);
	const events = await db
		.select()
		.from(identityLogs)
		.where(and(eq(identityLogs.type, 'impossible_travel'), gte(identityLogs.timestamp, earliest)))
		.orderBy(desc(identityLogs.timestamp))
		.limit(400);

	const users = Array.from(new Set(events.map((event) => event.userId))).slice(0, 50);

	return {
		users,
		eventCount: events.length
	};
}

export async function runSocNaturalLanguageCommand(prompt: string): Promise<SocChatResult> {
	const intent = parseSocPrompt(prompt);

	if (intent.type === 'isolate_impossible_travel') {
		const isolation = await isolateImpossibleTravelUsers(intent.hours);
		const suggestedAction =
			isolation.users.length > 0
				? `Prepare containment for ${isolation.users.length} users with impossible travel in last ${intent.hours}h.`
				: `No users found with impossible travel in last ${intent.hours}h.`;

		return {
			prompt,
			summary: `Natural Language SOC query completed using telemetry window ${intent.hours}h (events=${isolation.eventCount}).`,
			suggestedAction,
			users: isolation.users
		};
	}

	if (intent.type === 'blast_radius') {
		const graph = await investigateIdentityGraph(intent.userId);
		return {
			prompt,
			summary: `Graph investigation completed for ${intent.userId}.`,
			suggestedAction:
				graph.blastRadius >= 6
					? 'Escalate to Tier 3 responder and enforce immediate isolation workflow.'
					: 'Maintain Tier 2 monitoring and collect additional telemetry.',
			graph: {
				userId: intent.userId,
				blastRadius: graph.blastRadius,
				finding: graph.finding
			}
		};
	}

	return {
		prompt,
		summary:
			'Command not recognized as a remediation action. Use isolation or blast radius prompts.',
		suggestedAction:
			'Try: "Isolate all users showing impossible travel in the last 2 hours" or "Show blast radius for user-1042".'
	};
}
