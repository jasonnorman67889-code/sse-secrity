import { CORRELATION_WINDOW_MINUTES } from './correlation-rule';

export const FUSION_MODEL_VERSION = 'spam_identity_fusion_v1';
export const FUSION_TRIGGER_THRESHOLD = 66;

export type FusionReason = {
	key: string;
	label: string;
	points: number;
	detail: string;
};

export type FusionEvaluation = {
	modelVersion: string;
	score: number;
	threshold: number;
	triggered: boolean;
	reasons: FusionReason[];
	summary: string;
	features: {
		bypassCount: number;
		newDevice: boolean;
		firstSeenDevice: boolean;
		impossibleTravel: boolean;
		sequenceMinutes: number;
	};
};

export type FusionInput = {
	spamTimestamp: Date;
	identityTimestamp: Date;
	sourceNode: string;
	targetNode: string;
	identityMetadata?: unknown;
};

function toObject(value: unknown): Record<string, unknown> {
	if (typeof value === 'string') {
		try {
			return JSON.parse(value) as Record<string, unknown>;
		} catch {
			return {};
		}
	}

	if (value && typeof value === 'object') {
		return value as Record<string, unknown>;
	}

	return {};
}

function toNumber(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function toBoolean(value: unknown): boolean {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'string') {
		return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
	}
	if (typeof value === 'number') {
		return value !== 0;
	}
	return false;
}

function pushReason(reasons: FusionReason[], reason: FusionReason) {
	if (reason.points !== 0) {
		reasons.push(reason);
	}
}

function buildSummary(reasons: FusionReason[]): string {
	if (reasons.length === 0) {
		return 'No elevated fusion factors.';
	}

	const priority = ['auth_bypass', 'new_device', 'impossible_travel', 'spam_click'];
	const selected: FusionReason[] = [];

	for (const key of priority) {
		const reason = reasons.find((item) => item.key === key);
		if (reason) {
			selected.push(reason);
		}
		if (selected.length >= 3) {
			break;
		}
	}

	if (selected.length < 3) {
		const fallback = reasons
			.slice()
			.sort((a, b) => b.points - a.points)
			.filter((reason) => !selected.some((picked) => picked.key === reason.key));

		for (const reason of fallback) {
			selected.push(reason);
			if (selected.length >= 3) {
				break;
			}
		}
	}

	const top = selected.map((reason) => reason.label);

	return top.join(' + ');
}

export function evaluateSpamIdentityFusion(input: FusionInput): FusionEvaluation {
	const metadata = toObject(input.identityMetadata);
	const sequenceMinutes =
		Math.abs(input.identityTimestamp.getTime() - input.spamTimestamp.getTime()) / 60_000;
	const bypassCount = Math.max(
		0,
		Math.round(
			toNumber(
				metadata.bypassCount ??
					metadata.bypass_count ??
					metadata.mfaBypassCount ??
					metadata.mfa_bypass_count
			)
		)
	);
	const newDevice = toBoolean(metadata.newDevice ?? metadata.new_device);
	const firstSeenDevice = toBoolean(metadata.firstSeenDevice ?? metadata.first_seen_device);

	const reasons: FusionReason[] = [];

	pushReason(reasons, {
		key: 'spam_click',
		label: 'spam click',
		points: 24,
		detail: 'User clicked a known spam campaign link.'
	});

	pushReason(reasons, {
		key: 'impossible_travel',
		label: 'impossible travel',
		points: 24,
		detail: 'Identity plane reported impossible travel.'
	});

	if (bypassCount > 0) {
		pushReason(reasons, {
			key: 'auth_bypass',
			label: `${bypassCount} bypasses`,
			points: Math.min(24, bypassCount * 6),
			detail: `Detected ${bypassCount} authentication bypass events.`
		});
	}

	if (newDevice) {
		pushReason(reasons, {
			key: 'new_device',
			label: '1 new device',
			points: 12,
			detail: 'Login occurred from a new device fingerprint.'
		});
	}

	if (firstSeenDevice) {
		pushReason(reasons, {
			key: 'first_seen_device',
			label: 'first-seen device',
			points: 10,
			detail: 'Device has no previous trust history.'
		});
	}

	if (sequenceMinutes <= 10) {
		pushReason(reasons, {
			key: 'rapid_sequence',
			label: 'rapid sequence',
			points: 10,
			detail: `Spam and identity anomalies occurred within ${sequenceMinutes.toFixed(1)} minutes.`
		});
	}

	if (input.sourceNode !== input.targetNode) {
		pushReason(reasons, {
			key: 'cross_node_pivot',
			label: 'cross-node pivot',
			points: 8,
			detail: `Observed pivot from ${input.sourceNode} to ${input.targetNode}.`
		});
	}

	if (sequenceMinutes > CORRELATION_WINDOW_MINUTES) {
		pushReason(reasons, {
			key: 'window_decay',
			label: 'window decay',
			points: -25,
			detail: `Signals exceeded ${CORRELATION_WINDOW_MINUTES} minute fusion window.`
		});
	}

	const rawScore = reasons.reduce((sum, reason) => sum + reason.points, 0);
	const score = Math.max(0, Math.min(100, rawScore));

	return {
		modelVersion: FUSION_MODEL_VERSION,
		score,
		threshold: FUSION_TRIGGER_THRESHOLD,
		triggered: score >= FUSION_TRIGGER_THRESHOLD,
		reasons,
		summary: buildSummary(reasons),
		features: {
			bypassCount,
			newDevice,
			firstSeenDevice,
			impossibleTravel: true,
			sequenceMinutes
		}
	};
}
