import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { identityLogs, spamEvents } from '$lib/server/db/schema';
import { evaluateSpamIdentityCorrelation } from '$lib/server/correlation-engine';
import { evaluateFinancialThreatBus } from '$lib/server/financial-threat-bus';
import { randomUUID } from 'node:crypto';

type ReplayRequest = {
	userId?: string;
	sourceNode?: string;
	targetNode?: string;
};

type ReplayStep = {
	stepId: string;
	label: string;
	phase: string;
	nodeId: string;
	timestamp: string;
	trustScore: number;
	arcState: 'amber' | 'red' | 'shield';
};

export const POST: RequestHandler = async ({ request }) => {
	const payload = (await request.json().catch(() => ({}))) as ReplayRequest;

	const userId = payload.userId ?? `replay-441-${randomUUID().slice(0, 10)}`;
	const sourceNode = payload.sourceNode ?? 'Node-LA-01';
	const targetNode = payload.targetNode ?? 'Node-LDN-01';
	const start = Date.now();
	const timeline: ReplayStep[] = [];

	const [deliveryEvent] = await db
		.insert(spamEvents)
		.values({
			userId,
			nodeId: sourceNode,
			urlClicked: true,
			campaignId: 'simulation-campaign-441',
			timestamp: new Date(start)
		})
		.returning();

	const delivery = await evaluateFinancialThreatBus({
		userId,
		nodeId: sourceNode,
		plane: 'email',
		signal: 'simulated_click',
		campaignId: 'simulation-campaign-441'
	});

	timeline.push({
		stepId: 'delivery',
		label: 'Synthetic click delivered',
		phase: 'Email Delivery',
		nodeId: sourceNode,
		timestamp: new Date(start).toISOString(),
		trustScore: delivery.trustScore,
		arcState: 'amber'
	});

	const [entryEvent] = await db
		.insert(identityLogs)
		.values({
			userId,
			type: 'otp_forwarding_attempt',
			nodeId: targetNode,
			metadata: JSON.stringify({
				telemetry_only: true,
				simulation: true,
				fakePortal: 'FakePortal',
				bypassCount: 3,
				campaignId: 'simulation-campaign-441'
			}),
			timestamp: new Date(start + 70_000)
		})
		.returning();

	const [travelEvent] = await db
		.insert(identityLogs)
		.values({
			userId,
			type: 'impossible_travel',
			nodeId: targetNode,
			metadata: JSON.stringify({
				telemetry_only: true,
				simulation: true,
				source: sourceNode,
				target: targetNode,
				bypassCount: 3,
				newDevice: true,
				campaignId: 'simulation-campaign-441'
			}),
			timestamp: new Date(start + 95_000)
		})
		.returning();

	const entry = await evaluateFinancialThreatBus({
		userId,
		nodeId: targetNode,
		plane: 'login',
		signal: 'otp_forwarding_attempt',
		campaignId: 'simulation-campaign-441'
	});

	timeline.push({
		stepId: 'entry',
		label: 'Credential theft simulation detected',
		phase: 'Login Threat',
		nodeId: targetNode,
		timestamp: new Date(start + 95_000).toISOString(),
		trustScore: entry.trustScore,
		arcState: 'red'
	});

	const [takeoverEvent] = await db
		.insert(identityLogs)
		.values({
			userId,
			type: 'otp_harvest',
			nodeId: targetNode,
			metadata: JSON.stringify({
				telemetry_only: true,
				simulation: true,
				bankBrand: 'GlobalTrust Bank',
				campaignId: 'simulation-campaign-441'
			}),
			timestamp: new Date(start + 120_000)
		})
		.returning();

	const takeover = await evaluateFinancialThreatBus({
		userId,
		nodeId: targetNode,
		plane: 'bank',
		signal: 'otp_harvest',
		campaignId: 'simulation-campaign-441'
	});

	const [cardEvent] = await db
		.insert(identityLogs)
		.values({
			userId,
			type: 'card_verification_scam',
			nodeId: sourceNode,
			metadata: JSON.stringify({
				telemetry_only: true,
				simulation: true,
				patternType: 'bin_enumeration',
				pattern: 'BIN-ENUM-441',
				bankBrand: 'GlobalTrust Bank',
				campaignId: 'simulation-campaign-441'
			}),
			timestamp: new Date(start + 145_000)
		})
		.returning();

	const monetization = await evaluateFinancialThreatBus({
		userId,
		nodeId: sourceNode,
		plane: 'card',
		signal: 'card_verification_scam',
		campaignId: 'simulation-campaign-441'
	});

	timeline.push({
		stepId: 'containment',
		label: 'Containment validation workflow completed',
		phase: 'SOAR Recovery',
		nodeId: sourceNode,
		timestamp: new Date(start + 145_000).toISOString(),
		trustScore: monetization.readinessMetric?.postMitigationTrust ?? monetization.trustScore,
		arcState: 'shield'
	});

	const correlation = await evaluateSpamIdentityCorrelation(userId);
	const timeToContainmentMs = 145_000;

	return json(
		{
			replayId: 441,
			telemetry_only: true,
			userId,
			campaignId: 'simulation-campaign-441',
			timeline,
			bottleneckStep: 'entry',
			bottleneckReason:
				'Identity risk elevation consumed 70s before impossible-travel confirmation.',
			timeToContainmentMs,
			correlation,
			phases: {
				delivery,
				entry,
				takeover,
				monetization
			},
			events: {
				deliveryEvent,
				entryEvent,
				travelEvent,
				takeoverEvent,
				cardEvent
			}
		},
		{ status: 201 }
	);
};
