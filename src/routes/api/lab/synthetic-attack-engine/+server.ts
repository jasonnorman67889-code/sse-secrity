import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs, spamEvents } from '$lib/server/db/schema';
import { evaluateSpamIdentityCorrelation } from '$lib/server/correlation-engine';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';
import { randomUUID } from 'node:crypto';

type SyntheticAttackEngineRequest = {
	userId?: string;
	sourceNode?: string;
	targetNode?: string;
	scenarioId?: string;
};

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json().catch(() => ({}))) as SyntheticAttackEngineRequest;

	const userId = payload.userId ?? `lab-user-${randomUUID().slice(0, 10)}`;
	const sourceNode = payload.sourceNode ?? 'Node-LA-01';
	const targetNode = payload.targetNode ?? 'Node-SGP-01';
	const scenarioId = payload.scenarioId ?? `synthetic-scenario-${randomUUID().slice(0, 8)}`;
	const campaignId = `simulation-${scenarioId}`;
	const startedAt = Date.now();

	await db.insert(spamEvents).values({
		userId,
		nodeId: sourceNode,
		urlClicked: true,
		campaignId,
		timestamp: new Date(startedAt)
	});

	const emailPlane = await evaluateFinancialThreatBus({
		userId,
		nodeId: sourceNode,
		plane: 'email',
		signal: 'credential_phish',
		campaignId
	});

	await db.insert(identityLogs).values({
		userId,
		type: 'otp_forwarding_attempt',
		nodeId: targetNode,
		metadata: JSON.stringify({
			telemetry_only: true,
			simulation: true,
			plane: 'login-threat-lab',
			fakePortal: 'FakePortal',
			bypassCount: 3,
			campaignId
		}),
		timestamp: new Date(startedAt + 30_000)
	});

	const loginPlane = await evaluateFinancialThreatBus({
		userId,
		nodeId: targetNode,
		plane: 'login',
		signal: 'otp_forwarding_attempt',
		campaignId
	});

	await db.insert(identityLogs).values({
		userId,
		type: 'otp_harvest',
		nodeId: targetNode,
		metadata: JSON.stringify({
			telemetry_only: true,
			simulation: true,
			plane: 'banking-phish-lab',
			bankBrand: 'GlobalTrust Bank',
			campaignId
		}),
		timestamp: new Date(startedAt + 55_000)
	});

	const bankPlane = await evaluateFinancialThreatBus({
		userId,
		nodeId: targetNode,
		plane: 'bank',
		signal: 'otp_harvest',
		campaignId
	});

	await db.insert(identityLogs).values({
		userId,
		type: 'card_verification_scam',
		nodeId: sourceNode,
		metadata: JSON.stringify({
			telemetry_only: true,
			simulation: true,
			plane: 'card-fraud-lab',
			patternType: 'bin_enumeration',
			pattern: 'BIN-ENUM-LAB',
			campaignId
		}),
		timestamp: new Date(startedAt + 80_000)
	});

	const cardPlane = await evaluateFinancialThreatBus({
		userId,
		nodeId: sourceNode,
		plane: 'card',
		signal: 'card_verification_scam',
		campaignId
	});

	const correlation = await evaluateSpamIdentityCorrelation(userId);
	const baselineMs = Number(process.env.SCC_CONTAINMENT_BASELINE_MS || '90000');
	const containmentLatencyMs = cardPlane.simulation?.timeToContainmentMs ?? null;

	const benchmark = {
		aiSentinelTriggered: correlation.triggered,
		detectionAccuracy: correlation.triggered ? 1 : 0,
		containmentLatencyMs,
		baselineMs,
		meetsContainmentBaseline:
			typeof containmentLatencyMs === 'number' ? containmentLatencyMs <= baselineMs : false,
		soarAutomationSpeed:
			typeof containmentLatencyMs === 'number' ? Math.max(0, baselineMs - containmentLatencyMs) : 0
	};

	return json(
		{
			telemetry_only: true,
			mode: 'isolated-defensive-validation',
			scenarioId,
			campaignId,
			userId,
			benchmark,
			phases: {
				emailPlane,
				loginPlane,
				bankPlane,
				cardPlane
			},
			continuity: cardPlane.continuity,
			correlation
		},
		{ status: 201 }
	);
};
