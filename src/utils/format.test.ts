import { formatBytes } from './format';

describe('formatBytes', () => {
    it('returns 0 B for zero', () => {
        expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes under 1 KB', () => {
        expect(formatBytes(512)).toBe('512 B');
    });

    it('formats KB', () => {
        expect(formatBytes(1024)).toBe('1 KB');
    });

    it('formats MB', () => {
        expect(formatBytes(1024 * 1024)).toBe('1 MB');
    });

    it('formats GB', () => {
        expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('rounds to 2 decimal places', () => {
        expect(formatBytes(1500)).toBe('1.46 KB');
    });
});
