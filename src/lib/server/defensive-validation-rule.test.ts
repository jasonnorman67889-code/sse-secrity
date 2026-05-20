import { describe, expect, it } from 'vitest';
import {
    DEFENSIVE_SPAM_VALIDATION_RULE_ID,
    isDefensiveSpamValidationTriggered
} from './defensive-validation-rule';

describe('defensive_spam_validation rule', () => {
    it('triggers when simulated click and elevated identity risk are both present', () => {
        expect(DEFENSIVE_SPAM_VALIDATION_RULE_ID).toBe('defensive_spam_validation');
        expect(isDefensiveSpamValidationTriggered(true, true)).toBe(true);
    });

    it('does not trigger when simulated click is absent', () => {
        expect(isDefensiveSpamValidationTriggered(false, true)).toBe(false);
    });

    it('does not trigger when identity risk is not elevated', () => {
        expect(isDefensiveSpamValidationTriggered(true, false)).toBe(false);
    });
});
