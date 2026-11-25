import { describe, expect, it } from 'vitest';
import { CONSORTIUMS } from '../../src/consortiums.js';
import { stripAnsi } from '../../src/format/colors.js';
import {
  formatAlerts,
  formatConsortiumsTable,
  formatFaresTable,
  formatOdTimetable,
  formatStopServicesTable,
} from '../../src/format/tables.js';
import type { FaresSummary, OdScheduleResult, StopServicesResult } from '../../src/types.js';

describe('Table formatters', () => {
  it('formats consortiums table with default marker', () => {
    const out = stripAnsi(formatConsortiumsTable(CONSORTIUMS, 3));
    expect(out).toContain('CTAS');
    expect(out).toContain('CTMGR');
    expect(out).toContain('ctmam.es');
    expect(out).toContain('(default)');
  });

  it('formats OD timetable with fare info, checkpoints, and notes', () => {
    const res: OdScheduleResult = {
      consorcioId: 1,
      originNucleo: { id: '3225', municipioId: '1', zoneId: 'A', name: 'Sevilla' },
      destinationNucleo: {
        id: '3196',
        municipioId: '2',
        zoneId: 'B',
        name: 'Mairena del Aljarafe',
      },
      date: '2026-11-25',
      totalAvailable: 1,
      originBlocks: ['Sevilla'],
      destinationBlocks: ['Mairena'],
      frequencies: [],
      fare: {
        consorcioId: 1,
        originNucleoId: '3225',
        originNucleoName: 'Sevilla',
        destinationNucleoId: '3196',
        destinationNucleoName: 'Mairena del Aljarafe',
        jumps: 1,
        error: null,
        singleTicketEur: 1.75,
        cardEur: 0.99,
      },
      journeys: [
        {
          lineId: '446',
          lineCode: '1552',
          displayCode: 'M-155',
          lineName: 'M-155 Sevilla - Almensilla',
          lineColor: '#00a86b',
          mode: 'Bus',
          originBlock: 'Pz. Armas',
          destinationBlock: 'Mairena',
          departureTime: '07:00',
          arrivalTime: '07:35',
          departureSeconds: 7 * 3600,
          arrivalSeconds: 7 * 3600 + 35 * 60,
          durationSeconds: 35 * 60,
          frequencyAcronym: 'LV',
          frequencyDescription: 'Lunes a Viernes',
          observations: '',
          originCheckpoints: [{ blockName: 'Pz. Armas', time: '07:00' }],
          destinationCheckpoints: [{ blockName: 'Mairena', time: '07:35' }],
        },
      ],
    };

    const text = stripAnsi(formatOdTimetable(res));
    expect(text).toContain('TIMETABLE');
    expect(text).toContain('1 jump | Single: 1.75 € | Card: 0.99 €');
    expect(text).toContain('M-155');
    expect(text).toContain('07:00');
    expect(text).toContain('07:35');
  });

  it('formats stop services table (scheduled vs realtime) and fares/alerts cleanly', () => {
    const svc: StopServicesResult = {
      consorcioId: 1,
      stopId: '3023',
      stopCode: '3023',
      stopName: 'Plaza de Armas',
      nucleoName: 'Sevilla',
      lat: 37.391,
      lon: -6.003,
      windowStart: '2026-11-25 06:54',
      windowEnd: '2026-11-25 07:54',
      fetchedAt: '2026-11-25T06:54:00.000Z',
      stale: false,
      source: 'scheduled',
      providerName: 'ctan-scheduled',
      services: [
        {
          lineId: '250',
          lineCode: '1750',
          displayCode: 'M-175',
          lineName: 'M-175 Albaida - Sevilla',
          lineColor: '#00a86b',
          direction: 1,
          destination: 'SEVILLA',
          departureTime: '06:56',
          departureSeconds: 6 * 3600 + 56 * 60,
          etaMinutes: 2,
          stopType: 'normal',
          source: 'scheduled',
          distanceMeters: null,
          vehicle: null,
        },
      ],
    };
    const svcOut = stripAnsi(formatStopServicesTable(svc));
    expect(svcOut).toContain('[CTAS] Stop #3023 — Plaza de Armas (Sevilla)');
    expect(svcOut).toContain('CTAN Official Schedule');
    expect(svcOut).toContain('M-175');
    expect(svcOut).toContain('2 min');

    const fares: FaresSummary = {
      consorcioId: 2,
      interurban: [{ jumps: 0, singleTicketEur: 1.55, cardEur: 0.61 }],
      urban: [{ name: 'Cádiz', tuEur: 0.27, userPriceEur: 0.77 }],
      jumpCalculation: null,
    };
    const fareOut = stripAnsi(formatFaresTable(fares));
    expect(fareOut).toContain('1.55 €');
    expect(fareOut).toContain('Cádiz');

    const alertOut = stripAnsi(
      formatAlerts(
        [
          {
            id: '1',
            consorcioId: 3,
            categoryId: '1',
            category: 'Incidencias',
            title: 'Obras L-360',
            subtitle: '',
            summary: 'Cambio provisional de parada',
            body: '',
            startDate: '2026-11-23',
            endDate: '2026-11-27',
            lines: ['360'],
            isNew: true,
          },
        ],
        3,
      ),
    );
    expect(alertOut).toContain('Obras L-360');
  });
});
