import { describe, expect, it } from 'vitest';
import {
    CORRELATION_WINDOW_MINUTES,
    isSpamIdentityCorrelationTriggered
} from './correlation-rule';

describe('spam_identity_001 correlation rule', () => {
    it('triggers when impossible travel is inside the 30-minute window', () => {
        const spam = new Date('2026-05-19T10:00:00Z');
        const travel = new Date('2026-05-19T10:24:00Z');

        expect(isSpamIdentityCorrelationTriggered(spam, travel)).toBe(true);
    });

    it('does not trigger when impossible travel is outside the window', () => {
        const spam = new Date('2026-05-19T10:00:00Z');
        const travel = new Date('2026-05-19T10:45:01Z');

        expect(isSpamIdentityCorrelationTriggered(spam, travel)).toBe(false);
    });

    it('supports custom windows for policy tuning', () => {
        const spam = new Date('2026-05-19T10:00:00Z');
        const travel = new Date('2026-05-19T10:12:00Z');

        expect(isSpamIdentityCorrelationTriggered(spam, travel, 10)).toBe(false);
        expect(isSpamIdentityCorrelationTriggered(spam, travel, CORRELATION_WINDOW_MINUTES)).toBe(true);
    });
});
