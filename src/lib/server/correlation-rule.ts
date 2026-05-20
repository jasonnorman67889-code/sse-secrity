export const CORRELATION_RULE_ID = 'spam_identity_001';
export const CORRELATION_WINDOW_MINUTES = 30;

export function isSpamIdentityCorrelationTriggered(
	spamTimestamp: Date,
	identityTimestamp: Date,
	windowMinutes = CORRELATION_WINDOW_MINUTES
): boolean {
	const diffMinutes = Math.abs(identityTimestamp.getTime() - spamTimestamp.getTime()) / 60000;
	return diffMinutes <= windowMinutes;
}
