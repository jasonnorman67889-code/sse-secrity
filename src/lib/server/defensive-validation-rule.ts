export const DEFENSIVE_SPAM_VALIDATION_RULE_ID = 'defensive_spam_validation';

export function isDefensiveSpamValidationTriggered(
	simulatedClick: boolean,
	identityRiskElevated: boolean
): boolean {
	return simulatedClick && identityRiskElevated;
}
