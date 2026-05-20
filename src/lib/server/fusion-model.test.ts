import { describe, expect, it } from 'vitest';
import {
    FUSION_TRIGGER_THRESHOLD,
    evaluateSpamIdentityFusion
} from './fusion-model';

describe('spam identity fusion model', () => {
    it('produces explainable reasons for bypasses and new device', () => {
        const spamAt = new Date('2026-05-19T10:00:00Z');
        const identityAt = new Date('2026-05-19T10:04:00Z');

        const fusion = evaluateSpamIdentityFusion({
            spamTimestamp: spamAt,
            identityTimestamp: identityAt,
            sourceNode: 'Node-LA-01',
            targetNode: 'Node-LDN-01',
            identityMetadata: {
                bypassCount: 3,
                newDevice: true
            }
        });

        expect(fusion.score).toBeGreaterThanOrEqual(FUSION_TRIGGER_THRESHOLD);
        expect(fusion.summary).toContain('3 bypasses');
        expect(fusion.summary).toContain('1 new device');
        expect(fusion.reasons.some((reason) => reason.key === 'auth_bypass')).toBe(true);
        expect(fusion.reasons.some((reason) => reason.key === 'new_device')).toBe(true);
    });

    it('decays score when signals are outside the fusion window', () => {
        const spamAt = new Date('2026-05-19T10:00:00Z');
        const identityAt = new Date('2026-05-19T11:10:00Z');

        const fusion = evaluateSpamIdentityFusion({
            spamTimestamp: spamAt,
            identityTimestamp: identityAt,
            sourceNode: 'Node-LA-01',
            targetNode: 'Node-LDN-01',
            identityMetadata: {}
        });

        expect(fusion.reasons.some((reason) => reason.key === 'window_decay')).toBe(true);
        expect(fusion.triggered).toBe(false);
    });
});
