export type AutonomousSocDecision = {
    confidenceScore: number;
    mlAnomaly: number;
    graphRisk: number;
    threatIntelRisk: number;
    businessImpactRisk: number;
    recommendedAction: 'monitor' | 'step_up_auth' | 'isolate_sessions';
    requiresHumanApproval: boolean;
    rationale: string;
};

export type SocPromptIntent =
    | {
          type: 'isolate_impossible_travel';
          hours: number;
      }
    | {
          type: 'blast_radius';
          userId: string;
      }
    | {
          type: 'unknown';
      };

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

export function parseSocPrompt(prompt: string): SocPromptIntent {
    const normalized = prompt.toLowerCase();
    const hoursMatch = normalized.match(/last\s+(\d+)\s+hour/);
    const hours = clamp(Number(hoursMatch?.[1] ?? 2), 1, 72);

    if (normalized.includes('impossible travel') && normalized.includes('isolate')) {
        return {
            type: 'isolate_impossible_travel',
            hours
        };
    }

    const userMatch = normalized.match(/user[-_ ]?([a-z0-9-]+)/);
    if (normalized.includes('blast radius') && userMatch?.[1]) {
        const userId = `user-${userMatch[1].replace(/^user-/, '')}`;
        return {
            type: 'blast_radius',
            userId
        };
    }

    return {
        type: 'unknown'
    };
}

export function computeAutonomousSocDecision(
    mlAnomaly: number,
    graphRisk: number,
    threatIntelRisk: number,
    businessImpactRisk: number
): AutonomousSocDecision {
    const confidenceScore = clamp(
        Math.round(mlAnomaly * 0.3 + graphRisk * 0.35 + threatIntelRisk * 0.2 + businessImpactRisk * 0.15),
        0,
        100
    );

    if (confidenceScore >= 75) {
        return {
            confidenceScore,
            mlAnomaly,
            graphRisk,
            threatIntelRisk,
            businessImpactRisk,
            recommendedAction: 'isolate_sessions',
            requiresHumanApproval: false,
            rationale: 'High-confidence blended signal across ML, graph, and threat intel.'
        };
    }

    if (confidenceScore >= 52) {
        return {
            confidenceScore,
            mlAnomaly,
            graphRisk,
            threatIntelRisk,
            businessImpactRisk,
            recommendedAction: 'step_up_auth',
            requiresHumanApproval: true,
            rationale: 'Moderate confidence; enforce step-up controls with analyst confirmation.'
        };
    }

    return {
        confidenceScore,
        mlAnomaly,
        graphRisk,
        threatIntelRisk,
        businessImpactRisk,
        recommendedAction: 'monitor',
        requiresHumanApproval: true,
        rationale: 'Low confidence; preserve telemetry and continue observation.'
    };
}
