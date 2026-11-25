import { describe, expect, it } from 'vitest';
import { parseOdSchedule, partitionOdBlocks } from '../../src/routing/odParser.js';
import type { Line } from '../../src/types.js';

describe('OD Schedule Parser', () => {
  it('dynamically partitions Origin vs Destination blocks across different consortium palettes', () => {
    const granadaBlocks = [
      { name: 'Lineas', color: '#ffffff', type: '1' },
      { name: 'Estación Autobuses', color: '#ffffbf', type: '1' },
      { name: 'Granada', color: '#ffffbf', type: '1' },
      { name: 'Armilla', color: '#ffedae', type: '1' },
      { name: 'Alhendín', color: '#ffedae', type: '1' },
      { name: 'Frecuencia', color: '#ffffff', type: '1' },
      { name: 'Observaciones', color: '#ffffff', type: '1' },
    ];
    const partitioned = partitionOdBlocks(granadaBlocks, 4);
    expect(partitioned.originIndices).toEqual([0, 1]);
    expect(partitioned.destIndices).toEqual([2, 3]);
    expect(partitioned.timeBlockNames).toEqual([
      'Estación Autobuses',
      'Granada',
      'Armilla',
      'Alhendín',
    ]);
  });

  it('filters OD trips by date frequency, handles midnight rollover, and enriches line metadata', () => {
    const linesById: Record<string, Line> = {
      '446': {
        id: '446',
        code: '1552',
        displayCode: 'M-155',
        name: 'M-155 Sevilla - Almensilla',
        modeId: '1',
        mode: 'Bus',
        operators: ['DAMAS'],
        hasNews: false,
        color: '#00a86b',
        isCircular: false,
        directions: [],
      },
      '308': {
        id: '308',
        code: '1521',
        displayCode: 'M-152',
        name: 'M-152 Sevilla - Palomares',
        modeId: '1',
        mode: 'Bus',
        operators: ['DAMAS'],
        hasNews: false,
        color: '#00a86b',
        isCircular: false,
        directions: [],
      },
    };

    const raw = {
      bloques: [
        { name: 'Lineas', color: '#ffffff', type: '1' },
        { name: 'Pz. Armas (Sevilla)', color: '#ffcccc', type: '1' },
        { name: 'Sevilla', color: '#ffcccc', type: '1' },
        { name: 'Mairena del Aljarafe', color: '#ccffcc', type: '1' },
        { name: 'Frecuencia', color: '#ffffff', type: '1' },
      ],
      horario: [
        {
          lineId: '308',
          code: '1521',
          times: ['06:35', '--', '06:57'],
          frequencyAcronym: 'SA',
          observations: '',
        },
        {
          lineId: '446',
          code: '1552',
          times: ['--', '23:50', '00:15'],
          frequencyAcronym: 'LV',
          observations: 'Last service',
        },
      ],
      frequencies: [
        { id: '1', acronym: 'LV', name: 'Lunes a Viernes' },
        { id: '2', acronym: 'SA', name: 'Sábados' },
      ],
    };

    // Wednesday 2026-11-25
    const wednesday = new Date(2026, 10, 25);
    const parsed = parseOdSchedule(raw, {
      date: wednesday,
      linesById,
    });

    expect(parsed.journeys).toHaveLength(1);
    const trip = parsed.journeys[0]!;
    expect(trip.displayCode).toBe('M-155');
    expect(trip.originBlock).toBe('Sevilla');
    expect(trip.destinationBlock).toBe('Mairena del Aljarafe');
    expect(trip.departureTime).toBe('23:50');
    expect(trip.arrivalTime).toBe('00:15');
    expect(trip.durationSeconds).toBe(25 * 60);
    expect(trip.observations).toBe('Last service');

    // "--freq all" returns Saturday trip too
    const allFreqs = parseOdSchedule(raw, {
      date: wednesday,
      freqFilter: 'all',
      linesById,
    });
    expect(allFreqs.journeys).toHaveLength(2);
  });
});
