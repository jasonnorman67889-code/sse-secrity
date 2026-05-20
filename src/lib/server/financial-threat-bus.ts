import { db } from '$lib/server/db';
import { identityLogs, spamEvents } from '$lib/server/db/schema';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import {
    DEFENSIVE_SPAM_VALIDATION_RULE_ID,
    isDefensiveSpamValidationTriggered
} from '$lib/server/defensive-validation-rule';

export type FinancialPlane = 'email' | 'login' | 'bank' | 'card';

export type FinancialBusInput = {
    userId: string;
    nodeId: string;
    plane: FinancialPlane;
    signal: string;
    campaignId?: string;
};

type ParsedIdentityLog = {
    id: string;
    type: string;
    nodeId: string;
    timestamp: Date | null;
    metadata: Record<string, unknown>;
};

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const BUS_WINDOW_MINUTES = Number(process.env.FINANCIAL_BUS_WINDOW_MINUTES || '90');
const GLOBAL_COMMAND_NODES = ['Node-LA-01', 'Node-LDN-01', 'Node-SGP-01', 'Node-FRA-01', 'Node-SAO-01'];
const CONTAINMENT_BASELINE_MS = Number(process.env.SCC_CONTAINMENT_BASELINE_MS || '90000');
const adversaryMemory = new Map<string, Set<string>>();
const adaptivePolicyState = new Map<
    string,
    {
        samples: number[];
        trustThreshold: number;
        refined: boolean;
        lastRefinedAt: string | null;
    }
>();

function parseMetadata(value: string | null): Record<string, unknown> {
    if (!value) {
        return {};
    }

    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
        return {};
    } catch {
        return {};
    }
}

function toBool(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'y'].includes(value.toLowerCase());
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    return false;
}

function toNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function trustForecast(delivery: boolean, entry: boolean, takeover: boolean, monetization: boolean) {
    if (delivery && !entry) {
        return { nextLikelyStep: 'otp_forwarding_attempt', confidence: 0.64 };
    }
    if (entry && !takeover) {
        return { nextLikelyStep: 'otp_harvest', confidence: 0.72 };
    }
    if (takeover && !monetization) {
        return { nextLikelyStep: 'card_verification_scam', confidence: 0.79 };
    }
    if (monetization) {
        return { nextLikelyStep: 'fraud_burst_containment', confidence: 0.91 };
    }

    return { nextLikelyStep: 'credential_phish', confidence: 0.45 };
}

function inferPlaneLabel(plane: FinancialPlane, signal: string): string {
    const labels: Record<FinancialPlane, string> = {
        email: `Delivery: ${signal}`,
        login: `Entry: ${signal}`,
        bank: `Takeover: ${signal}`,
        card: `Monetization: ${signal}`
    };

    return labels[plane];
}

function registerAdversaryMemory(
    nodeId: string,
    monetizationLog: ParsedIdentityLog | undefined
): { pattern: string | null; hardeningTargets: string[] } {
    if (!monetizationLog) {
        return { pattern: null, hardeningTargets: [] };
    }

    const patternType = String(
        monetizationLog.metadata.patternType ?? monetizationLog.metadata.pattern ?? monetizationLog.type
    );
    const bankBrand = String(monetizationLog.metadata.bankBrand ?? monetizationLog.metadata.brand ?? 'generic');
    const pattern = `${patternType}:${bankBrand}`;

    const priorNodes = adversaryMemory.get(pattern) ?? new Set<string>();
    priorNodes.add(nodeId);
    adversaryMemory.set(pattern, priorNodes);

    const hardeningTargets = GLOBAL_COMMAND_NODES.filter((candidate) => !priorNodes.has(candidate));
    return { pattern, hardeningTargets };
}

function getAutonomousPlaybooks(entry: boolean, takeover: boolean, monetization: boolean): string[] {
    const actions: string[] = [];

    if (entry) {
        actions.push('Account Takeover: Revoke sessions');
        actions.push('Account Takeover: Force password reset');
        actions.push('Account Takeover: Disable OAuth grants');
    }

    if (takeover) {
        actions.push('Banking Fraud: Freeze transfer');
        actions.push('Banking Fraud: Hold beneficiary');
        actions.push('Banking Fraud: Step-up MFA');
    }

    if (monetization) {
        actions.push('Card Fraud: Suspend card');
        actions.push('Card Fraud: Block merchant pattern');
        actions.push('Card Fraud: Notify customer');
    }

    return actions;
}

function inferSimulationArcState(
    delivery: boolean,
    detectionTriggered: boolean,
    mitigationTriggered: boolean
): 'idle' | 'amber' | 'red' | 'shield' {
    if (mitigationTriggered) {
        return 'shield';
    }

    if (detectionTriggered) {
        return 'red';
    }

    if (delivery) {
        return 'amber';
    }

    return 'idle';
}

function getAdaptivePolicy(nodeId: string) {
    return (
        adaptivePolicyState.get(nodeId) ?? {
            samples: [] as number[],
            trustThreshold: 45,
            refined: false,
            lastRefinedAt: null as string | null
        }
    );
}

function evolveAdaptivePolicy(nodeId: string, latencyMs: number | null, mitigationTriggered: boolean) {
    const state = getAdaptivePolicy(nodeId);

    if (mitigationTriggered && typeof latencyMs === 'number') {
        state.samples.push(latencyMs);
        if (state.samples.length > 20) {
            state.samples.shift();
        }

        const averageLatency =
            state.samples.length === 0
                ? CONTAINMENT_BASELINE_MS
                : Math.round(state.samples.reduce((sum, value) => sum + value, 0) / state.samples.length);

        const previousThreshold = state.trustThreshold;
        if (averageLatency > CONTAINMENT_BASELINE_MS) {
            const pressure = Math.ceil((averageLatency - CONTAINMENT_BASELINE_MS) / 20_000);
            state.trustThreshold = clamp(45 + pressure * 2, 45, 70);
        } else {
            state.trustThreshold = Math.max(45, state.trustThreshold - 1);
        }

        state.refined = state.trustThreshold !== previousThreshold;
        state.lastRefinedAt = state.refined ? new Date().toISOString() : state.lastRefinedAt;
    } else {
        state.refined = false;
    }

    adaptivePolicyState.set(nodeId, state);

    const averageLatency =
        state.samples.length === 0
            ? CONTAINMENT_BASELINE_MS
            : Math.round(state.samples.reduce((sum, value) => sum + value, 0) / state.samples.length);

    return {
        trustThreshold: state.trustThreshold,
        refined: state.refined,
        baselineMs: CONTAINMENT_BASELINE_MS,
        averageContainmentMs: averageLatency,
        lastRefinedAt: state.lastRefinedAt
    };
}

export async function evaluateFinancialThreatBus(input: FinancialBusInput) {
    const now = new Date();
    const earliest = new Date(now.getTime() - BUS_WINDOW_MINUTES * 60_000);

    const [latestSpam] = await db
        .select()
        .from(spamEvents)
        .where(
            and(
                eq(spamEvents.userId, input.userId),
                eq(spamEvents.urlClicked, true),
                gte(spamEvents.timestamp, earliest)
            )
        )
        .orderBy(desc(spamEvents.timestamp))
        .limit(1);

    const rawLogs = await db
        .select()
        .from(identityLogs)
        .where(
            and(
                eq(identityLogs.userId, input.userId),
                gte(identityLogs.timestamp, earliest),
                inArray(identityLogs.type, [
                    'otp_forwarding_attempt',
                    'fake_portal_hit',
                    'impossible_travel',
                    'otp_harvest',
                    'card_verification_scam',
                    'bin_enumeration'
                ])
            )
        )
        .orderBy(desc(identityLogs.timestamp))
        .limit(120);

    const logs: ParsedIdentityLog[] = rawLogs.map((log) => ({
        id: log.id,
        type: log.type,
        nodeId: log.nodeId,
        timestamp: log.timestamp,
        metadata: parseMetadata(log.metadata)
    }));

    const entryLog = logs.find((log) => ['otp_forwarding_attempt', 'fake_portal_hit'].includes(log.type));
    const takeoverLog = logs.find((log) => log.type === 'otp_harvest');
    const monetizationLog = logs.find((log) => ['card_verification_scam', 'bin_enumeration'].includes(log.type));
    const impossibleTravelLog = logs.find((log) => log.type === 'impossible_travel');

    const delivery = Boolean(latestSpam);
    const entry = Boolean(entryLog);
    const takeover = Boolean(takeoverLog);
    const monetization = Boolean(monetizationLog);
    const sequenceDetected = delivery && entry && takeover && monetization;

    const simulatedClick =
        delivery &&
        ['simulation', 'synthetic', 'replay', 'lab', 'campaign-441'].some((token) =>
            String(latestSpam?.campaignId ?? '')
                .toLowerCase()
                .includes(token)
        );

    const bypassCount = logs.reduce((sum, log) => {
        return sum + toNumber(log.metadata.bypassCount ?? log.metadata.mfaBypassCount);
    }, 0);

    const newDeviceSeen = logs.some((log) => toBool(log.metadata.newDevice ?? log.metadata.firstSeenDevice));
    const identityRiskScore = clamp(
        (entry ? 20 : 0) +
            (impossibleTravelLog ? 30 : 0) +
            Math.min(25, bypassCount * 5) +
            (newDeviceSeen ? 15 : 0),
        0,
        100
    );
    const identityRiskElevated = identityRiskScore >= 40;
    const defensiveValidationTriggered = isDefensiveSpamValidationTriggered(
        simulatedClick,
        identityRiskElevated
    );

    const fraudIndicators = clamp(
        (entry ? 20 : 0) +
            (impossibleTravelLog ? 20 : 0) +
            (takeover ? 25 : 0) +
            (monetization ? 30 : 0) +
            Math.min(15, bypassCount * 3) +
            (newDeviceSeen ? 10 : 0),
        0,
        100
    );

    const propagationRisk = clamp((delivery ? 15 : 0) + (sequenceDetected ? 20 : 0), 0, 40);
    const behavioralIntegrity = 100;
    const trustScore = clamp(behavioralIntegrity - (fraudIndicators + propagationRisk), 0, 100);

    const trustDelta = trustScore - 100;
    const forecast = trustForecast(delivery, entry, takeover, monetization);
    const { pattern, hardeningTargets } = registerAdversaryMemory(input.nodeId, monetizationLog);

    const detectionTriggered = sequenceDetected || defensiveValidationTriggered;
    const initialAdaptivePolicy = getAdaptivePolicy(input.nodeId);
    const mitigationTriggered = detectionTriggered || trustScore <= initialAdaptivePolicy.trustThreshold;
    const autonomousPlaybooks = mitigationTriggered
        ? getAutonomousPlaybooks(entry, takeover, monetization)
        : [];
    const restoredTrust = mitigationTriggered ? Math.max(8, Math.round((100 - trustScore) * 0.55)) : 0;
    const postMitigationTrust = clamp(trustScore + restoredTrust, 0, 100);
    const readinessPercent = Math.round((postMitigationTrust / 100) * 100);
    const timeToContainmentMs = latestSpam?.timestamp
        ? Math.max(0, now.getTime() - latestSpam.timestamp.getTime())
        : null;
    const adaptivePolicy = evolveAdaptivePolicy(input.nodeId, timeToContainmentMs, mitigationTriggered);
    const detectionZones = Array.from(
        new Set([
            input.nodeId,
            ...(delivery ? [latestSpam?.nodeId] : []),
            ...(entryLog ? [entryLog.nodeId] : []),
            ...(takeoverLog ? [takeoverLog.nodeId] : []),
            ...(monetizationLog ? [monetizationLog.nodeId] : [])
        ].filter((node): node is string => Boolean(node)))
    );
    const simulationArcState = inferSimulationArcState(delivery, detectionTriggered, mitigationTriggered);
    const equilibriumScore = clamp(
        100 - Math.round((fraudIndicators + propagationRisk) * 0.4) + (mitigationTriggered ? 18 : 0),
        0,
        100
    );

    const payload = {
        actorId: 'financial-threat-bus',
        action: mitigationTriggered ? 'FINANCIAL_AUTONOMOUS_RECOVERY' : 'FINANCIAL_THREAT_BUS_UPDATE',
        nodeId: input.nodeId,
        timestamp: now.toISOString(),
        riskScore: 100 - trustScore,
        planeSignal: {
            plane: input.plane,
            label: inferPlaneLabel(input.plane, input.signal),
            signal: input.signal,
            campaignId: input.campaignId ?? latestSpam?.campaignId ?? null
        },
        financialSequence: {
            campaignId: input.campaignId ?? latestSpam?.campaignId ?? null,
            delivery,
            entry,
            takeover,
            monetization,
            sequenceDetected,
            eventWindowMinutes: BUS_WINDOW_MINUTES
        },
        validation: {
            ruleId: DEFENSIVE_SPAM_VALIDATION_RULE_ID,
            simulatedClick,
            identityRiskScore,
            identityRiskElevated,
            triggered: defensiveValidationTriggered
        },
        simulation: {
            mode: 'synthetic',
            telemetry_only: true,
            arcState: simulationArcState,
            detectionZones,
            timeToContainmentMs
        },
        metaSentinel: {
            trustScore,
            trustDelta,
            behavioralIntegrity,
            fraudIndicators,
            propagationRisk,
            formula: 'trust_score = behavioral_integrity - (fraud_indicators + propagation_risk)',
            forecast,
            adaptivePolicy,
            readinessMetric: {
                restoredTrust,
                postMitigationTrust,
                readinessPercent
            },
            institutionalMemory: {
                pattern,
                hardeningTargets
            },
            mitigationTriggered,
            autonomousPlaybooks
        },
        continuity: {
            fraudBurst: sequenceDetected,
            entityIsolation: mitigationTriggered ? 'isolated' : 'monitoring',
            globalStrategicEquilibrium: equilibriumScore >= 70 ? 'stable' : 'degraded',
            equilibriumScore
        },
        containment: mitigationTriggered
            ? {
                  status: 'engaged',
                  actions: autonomousPlaybooks
              }
            : {
                  status: 'monitoring',
                  actions: []
              }
    };

    await redis.publish('biometric-stream', JSON.stringify(payload));

    return {
        ...payload.financialSequence,
        trustScore,
        trustDelta,
        forecast,
        adaptivePolicy,
        continuity: payload.continuity,
        readinessMetric: payload.metaSentinel.readinessMetric,
        mitigationTriggered,
        autonomousPlaybooks,
        institutionalMemory: payload.metaSentinel.institutionalMemory,
        containmentValidation: payload.validation,
        simulation: payload.simulation
    };
}
