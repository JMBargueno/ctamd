import { describe, expect, it } from 'vitest';
import { isDateInPlannerRange, matchesFrequencyOnDate } from '../../src/utils/frequency.js';

describe('matchesFrequencyOnDate', () => {
  // 2026-11-25 is Wednesday, 2026-11-28 is Saturday, 2026-11-29 is Sunday
  const wednesday = new Date(2026, 10, 25);
  const friday = new Date(2026, 10, 27);
  const saturday = new Date(2026, 10, 28);
  const sunday = new Date(2026, 10, 29);

  it('evaluates Sevilla acronyms (LV, SA, DF, SADF, LVSDF)', () => {
    expect(matchesFrequencyOnDate('LV', 'Lunes a Viernes', wednesday)).toBe(true);
    expect(matchesFrequencyOnDate('LV', 'Lunes a Viernes', saturday)).toBe(false);
    expect(matchesFrequencyOnDate('LV', 'Lunes a Viernes', wednesday, { isHoliday: true })).toBe(
      false,
    );
    expect(matchesFrequencyOnDate('SA', 'Sábados', saturday)).toBe(true);
    expect(matchesFrequencyOnDate('DF', 'Domingos y Festivos', sunday)).toBe(true);
    expect(
      matchesFrequencyOnDate('DF', 'Domingos y Festivos', wednesday, { isHoliday: true }),
    ).toBe(true);
    expect(matchesFrequencyOnDate('SADF', 'Sábados, Domingos y Festivos', saturday)).toBe(true);
  });

  it('evaluates Granada 8-char bitmasks (LMXJV---, -----S--, ------D-, LMXJVS--)', () => {
    expect(matchesFrequencyOnDate('LMXJV---', 'LABORABLE', wednesday)).toBe(true);
    expect(matchesFrequencyOnDate('LMXJV---', 'LABORABLE', saturday)).toBe(false);
    expect(matchesFrequencyOnDate('-----S--', 'SÁBADO', saturday)).toBe(true);
    expect(matchesFrequencyOnDate('-----S--', 'SÁBADO', sunday)).toBe(false);
    expect(matchesFrequencyOnDate('------D-', 'DOMINGO', sunday)).toBe(true);
    expect(matchesFrequencyOnDate('LMXJVS--', 'LUNES A SÁBADO', friday)).toBe(true);
    expect(matchesFrequencyOnDate('LMXJVS--', 'LUNES A SÁBADO', sunday)).toBe(false);
    expect(
      matchesFrequencyOnDate('LMXJVSDF', 'DIARIO Y FESTIVO', wednesday, { isHoliday: true }),
    ).toBe(true);
  });

  it('evaluates Malaga custom lowercase codes and filters obsolete/special events', () => {
    expect(matchesFrequencyOnDate('slab', 'Sábados laborables', saturday)).toBe(true);
    expect(matchesFrequencyOnDate('slab', 'Sábados laborables', wednesday)).toBe(false);
    expect(matchesFrequencyOnDate('df', 'Domingos y festivos', sunday)).toBe(true);
    expect(matchesFrequencyOnDate('diari', 'Diario', wednesday)).toBe(true);
    expect(matchesFrequencyOnDate('k', 'Martes Santo obsoleto\u0000', wednesday)).toBe(false);
    expect(matchesFrequencyOnDate('FerRV', 'Feria de Rincón de la Victoria', wednesday)).toBe(
      false,
    );
    expect(
      matchesFrequencyOnDate('24dic', '24 de Diciembre (Nochebuena)', new Date(2026, 11, 24)),
    ).toBe(true);
    expect(matchesFrequencyOnDate('24dic', '24 de Diciembre (Nochebuena)', wednesday)).toBe(false);
  });

  it('evaluates Cadiz, Almeria, Jaen, Cordoba and Huelva variants', () => {
    expect(matchesFrequencyOnDate('L-V', 'Lunes a viernes laborables', wednesday)).toBe(true);
    expect(matchesFrequencyOnDate('S-D-F', 'Sábados, domingos y festivos', sunday)).toBe(true);
    expect(matchesFrequencyOnDate('LVL', 'LUNES A VIERNES LABORABLES', friday)).toBe(true);
    expect(
      matchesFrequencyOnDate('DO FE', 'DOMINGOS Y FESTIVOS', wednesday, { isHoliday: true }),
    ).toBe(true);
    expect(matchesFrequencyOnDate('LJL', 'LUNES A JUEVES LABORABLES', friday)).toBe(false);
    expect(matchesFrequencyOnDate('LJL', 'LUNES A JUEVES LABORABLES', wednesday)).toBe(true);
  });

  it('checks planner date bounds accurately', () => {
    expect(isDateInPlannerRange('2026-09-01', '2027-06-30', wednesday)).toBe(true);
    expect(isDateInPlannerRange('2027-07-01', '2027-08-31', wednesday)).toBe(false);
  });
});
