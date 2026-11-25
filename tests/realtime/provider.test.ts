import { describe, expect, it } from 'vitest';
import { CtanClient } from '../../src/api/client.js';
import { type ArrivalProvider, ArrivalProviderRegistry } from '../../src/realtime/provider.js';
import type { ConsortiumId, StopServicesResult } from '../../src/types.js';

describe('ArrivalProviderRegistry', () => {
  it('chains multi-hour CTAN scheduled windows and deduplicates overlapping services', async () => {
    const client = new CtanClient({
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes('08:00')) {
          return new Response(
            JSON.stringify({
              horaIni: '2026-11-25 08:00',
              horaFin: '2026-11-25 09:00',
              servicios: [
                {
                  idLinea: '10',
                  servicio: '08:15',
                  linea: 'M-110',
                  nombre: 'M-110 Malaga',
                  sentido: '1',
                  destino: 'TORREMOLINOS',
                  tipo: '0',
                },
                {
                  idLinea: '10',
                  servicio: '08:55',
                  linea: 'M-110',
                  nombre: 'M-110 Malaga',
                  sentido: '1',
                  destino: 'TORREMOLINOS',
                  tipo: '0',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            horaIni: '2026-11-25 09:00',
            horaFin: '2026-11-25 10:00',
            servicios: [
              {
                idLinea: '10',
                servicio: '08:55',
                linea: 'M-110',
                nombre: 'M-110 Malaga',
                sentido: '1',
                destino: 'TORREMOLINOS',
                tipo: '0',
              },
              {
                idLinea: '10',
                servicio: '09:15',
                linea: 'M-110',
                nombre: 'M-110 Malaga',
                sentido: '1',
                destino: 'TORREMOLINOS',
                tipo: '0',
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const registry = new ArrivalProviderRegistry(client);
    const { result, warnings } = await registry.fetchStopServices(4, '100', {
      startDateTime: new Date(2026, 10, 25, 8, 0, 0),
      hours: 2,
      now: new Date(2026, 10, 25, 8, 5, 0),
    });

    expect(warnings).toEqual([]);
    expect(result.source).toBe('scheduled');
    expect(result.services.map((s) => s.departureTime)).toEqual(['08:15', '08:55', '09:15']);
    expect(result.windowStart).toBe('2026-11-25 08:00');
    expect(result.windowEnd).toBe('2026-11-25 10:00');
  });

  it('prefers matching custom realtime SAE providers and falls back cleanly on error', async () => {
    const client = new CtanClient({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            horaIni: '2026-11-25 08:00',
            horaFin: '2026-11-25 09:00',
            servicios: [
              {
                idLinea: '10',
                servicio: '08:20',
                linea: '1011',
                nombre: 'M-101A Test',
                sentido: '1',
                destino: 'SEVILLA',
                tipo: '0',
              },
            ],
          }),
          { status: 200 },
        ),
    });

    let fail = false;
    const mockSaeProvider: ArrivalProvider = {
      name: 'mock-sevilla-sae',
      source: 'realtime',
      supports: (id: ConsortiumId) => id === 1,
      fetchStopServices: async (consorcioId, stopId): Promise<StopServicesResult> => {
        if (fail) {
          throw new Error('SAE timeout');
        }
        return {
          consorcioId,
          stopId,
          stopCode: stopId,
          stopName: 'Plaza de Armas',
          nucleoName: 'Sevilla',
          lat: 37.391,
          lon: -6.003,
          windowStart: '2026-11-25 08:00',
          windowEnd: '2026-11-25 09:00',
          fetchedAt: new Date().toISOString(),
          stale: false,
          source: 'realtime',
          providerName: 'mock-sevilla-sae',
          services: [
            {
              lineId: '10',
              lineCode: '1011',
              displayCode: 'M-101A',
              lineName: 'M-101A',
              lineColor: '#ff0000',
              direction: 1,
              destination: 'SEVILLA',
              departureTime: '08:12',
              departureSeconds: 8 * 3600 + 12 * 60,
              etaMinutes: 4,
              stopType: 'normal',
              source: 'realtime',
              distanceMeters: 420,
              vehicle: '#512',
            },
          ],
        };
      },
    };

    const registry = new ArrivalProviderRegistry(client, [mockSaeProvider]);
    const liveRes = await registry.fetchStopServices(1, '3023');
    expect(liveRes.result.source).toBe('realtime');
    expect(liveRes.result.services[0]?.vehicle).toBe('#512');

    fail = true;
    const fallbackRes = await registry.fetchStopServices(1, '3023', {
      now: new Date(2026, 10, 25, 8, 0, 0),
    });
    expect(fallbackRes.result.source).toBe('scheduled');
    expect(fallbackRes.warnings[0]).toContain('falling back to CTAN scheduled departures');
  });
});
