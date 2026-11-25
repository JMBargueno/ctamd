import { describe, expect, it } from 'vitest';
import { CtamdValidationError } from '../src/api/errors.js';
import {
  CONSORTIUMS,
  findNearestConsortiums,
  getConsortiumById,
  resolveConsortium,
} from '../src/consortiums.js';

describe('consortiums registry', () => {
  it('contains all 9 official Andalusian consortia', () => {
    expect(CONSORTIUMS).toHaveLength(9);
    expect(CONSORTIUMS.map((c) => c.shortCode)).toEqual([
      'CTAS',
      'CMTBC',
      'CTMGR',
      'CTMAM',
      'CTMCG',
      'CTAL',
      'CTJA',
      'CTCO',
      'CTHU',
    ]);
  });

  it('resolves by numeric ID, short code, web domain, URL, and accented city names', () => {
    expect(resolveConsortium(1).shortCode).toBe('CTAS');
    expect(resolveConsortium('3').shortCode).toBe('CTMGR');
    expect(resolveConsortium('ctas.es').id).toBe(1);
    expect(resolveConsortium('https://www.ctagr.es/').id).toBe(3);
    expect(resolveConsortium('ctmam').id).toBe(4);
    expect(resolveConsortium('Málaga').id).toBe(4);
    expect(resolveConsortium('Cádiz').id).toBe(2);
    expect(resolveConsortium('algeciras').id).toBe(5);
    expect(resolveConsortium('almeria').id).toBe(6);
    expect(resolveConsortium('jaén').id).toBe(7);
    expect(resolveConsortium('córdoba').id).toBe(8);
    expect(resolveConsortium('huelva').id).toBe(9);
  });

  it('throws validation errors for unknown or empty consortium inputs', () => {
    expect(() => resolveConsortium('')).toThrow(CtamdValidationError);
    expect(() => resolveConsortium('madrid')).toThrow(CtamdValidationError);
    expect(() => resolveConsortium(99)).toThrow(CtamdValidationError);
    expect(getConsortiumById(99)).toBeUndefined();
  });

  it('auto-detects nearest consortiums from GPS coordinates', () => {
    const granada = findNearestConsortiums(37.1773, -3.5986);
    expect(granada[0]?.consortium.id).toBe(3);
    expect(granada[0]?.withinRadius).toBe(true);

    const malaga = findNearestConsortiums(36.623, -4.501);
    expect(malaga[0]?.consortium.id).toBe(4);

    const sevilla = findNearestConsortiums(37.391, -6.003);
    expect(sevilla[0]?.consortium.id).toBe(1);
  });
});
