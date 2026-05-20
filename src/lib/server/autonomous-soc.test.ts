import { describe, expect, it } from 'vitest';
import { computeAutonomousSocDecision, parseSocPrompt } from './autonomous-soc-logic';

describe('autonomous SOC decision matrix', () => {
	it('recommends isolate_sessions for high blended confidence', () => {
		const decision = computeAutonomousSocDecision(90, 88, 82, 75);

		expect(decision.confidenceScore).toBeGreaterThanOrEqual(75);
		expect(decision.recommendedAction).toBe('isolate_sessions');
		expect(decision.requiresHumanApproval).toBe(false);
	});

	it('recommends step_up_auth for medium confidence', () => {
		const decision = computeAutonomousSocDecision(58, 52, 45, 50);

		expect(decision.confidenceScore).toBeGreaterThanOrEqual(52);
		expect(decision.confidenceScore).toBeLessThan(75);
		expect(decision.recommendedAction).toBe('step_up_auth');
		expect(decision.requiresHumanApproval).toBe(true);
	});

	it('recommends monitor for low confidence', () => {
		const decision = computeAutonomousSocDecision(15, 20, 25, 30);

		expect(decision.confidenceScore).toBeLessThan(52);
		expect(decision.recommendedAction).toBe('monitor');
		expect(decision.requiresHumanApproval).toBe(true);
	});
});

describe('SOC natural language parser', () => {
	it('parses impossible travel isolation intent with custom window', () => {
		const intent = parseSocPrompt(
			'Isolate all users showing impossible travel in the last 6 hours'
		);

		expect(intent).toEqual({
			type: 'isolate_impossible_travel',
			hours: 6
		});
	});

	it('parses blast radius intent for specific user', () => {
		const intent = parseSocPrompt('Show blast radius for user-1042');

		expect(intent).toEqual({
			type: 'blast_radius',
			userId: 'user-1042'
		});
	});

	it('falls back to unknown for unsupported commands', () => {
		const intent = parseSocPrompt('Tell me a joke about SOC dashboards');

		expect(intent).toEqual({
			type: 'unknown'
		});
	});
});
