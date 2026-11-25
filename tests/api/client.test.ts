import { describe, expect, it } from 'vitest';
import {
  CtanClient,
  extractDisplayLineCode,
  normalizeHexColor,
  parseApiNumber,
  parseRetryAfterMs,
} from '../../src/api/client.js';
import { CtamdApiError } from '../../src/api/errors.js';

describe('CtanClient helpers', () => {
  it('extracts public line display codes when codigo is purely numeric', () => {
    expect(
      extractDisplayLineCode(
        '1011',
        'M-101A Circular Bormujos - Castilleja - Tomares - S Juan A - Mairena (sent A)',
      ),
    ).toBe('M-101A');
    expect(extractDisplayLineCode('1674', 'M-167 Villanueva-Sevilla')).toBe('M-167');
    expect(extractDisplayLineCode('B-042', 'B-042 Cádiz - Puerto Real')).toBe('B-042');
    expect(extractDisplayLineCode('C-1', 'C-1 Málaga Circular')).toBe('C-1');
  });

  it('parses decimal edge cases and hex colors cleanly', () => {
    expect(parseApiNumber('.6100000')).toBeCloseTo(0.61);
    expect(parseApiNumber('1.5500000')).toBeCloseTo(1.55);
    expect(parseApiNumber('')).toBeNull();
    expect(normalizeHexColor('ff0000')).toBe('#ff0000');
    expect(normalizeHexColor('#F7E519')).toBe('#f7e519');
    expect(normalizeHexColor('invalid')).toBeNull();
    expect(parseRetryAfterMs('12')).toBe(12_000);
  });
});

describe('CtanClient HTTP resilience', () => {
  it('handles HTTP 204 and empty 200 bodies gracefully (e.g. tarifas_urbanas / noticias)', async () => {
    const client = new CtanClient({
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes('tarifas_urbanas')) {
          return new Response(null, { status: 204 });
        }
        if (u.includes('noticias')) {
          return new Response('', { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      },
    });

    expect(await client.fetchUrbanFares(1)).toEqual([]);
    expect(await client.fetchNews(1)).toEqual([]);
  });

  it('returns null on HTTP 400 error JSON for horarios_origen_destino and rejects HTML error pages', async () => {
    const client = new CtanClient({
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes('horarios_origen_destino')) {
          return new Response(JSON.stringify({ error: 'No se encuentran los datos' }), {
            status: 400,
          });
        }
        return new Response('<html><title>404</title></html>', { status: 200 });
      },
    });

    expect(await client.fetchOdSchedule(1, '1', '2')).toBeNull();
    await expect(client.fetchLines(1)).rejects.toThrow(CtamdApiError);
  });

  it('normalizes stop correspondences, sentinel saltos, line details, and stop services', async () => {
    const requestedUrls: string[] = [];
    const client = new CtanClient({
      fetchImpl: async (url) => {
        const u = String(url);
        requestedUrls.push(u);
        if (u.includes('/paradas/2565/servicios')) {
          return new Response(
            JSON.stringify({
              horaIni: '2026-11-25 06:53',
              horaFin: '2026-11-25 07:53',
              servicios: [
                {
                  idParada: '2565',
                  idLinea: '441',
                  servicio: '07:12',
                  nombre: 'M-167 Villanueva - Sevilla',
                  linea: '1674',
                  sentido: '1',
                  destino: 'SEVILLA',
                  tipo: '0',
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (u.includes('/paradas/2565')) {
          return new Response(
            JSON.stringify({
              idParada: '2565',
              idNucleo: '3179',
              idMunicipio: '23',
              idZona: 'C',
              nombre: '1 SEMAFORO',
              latitud: '37.3831',
              longitud: '-6.1218',
              municipio: 'ESPARTINAS',
              nucleo: 'ESPARTINAS',
              correspondecias: 'Correspondencia con: 1020,1661,',
            }),
            { status: 200 },
          );
        }
        if (u.includes('/saltos')) {
          return new Response(
            JSON.stringify({
              saltos: [
                { origen: '--', destino: '--', saltos: '-1' },
                { origen: 'A', destino: 'B', saltos: '1' },
              ],
            }),
            { status: 200 },
          );
        }
        if (u.includes('/noticias')) {
          return new Response(
            JSON.stringify({
              noticias: [
                {
                  idNoticia: '9',
                  titulo: 'Bono Infantil',
                  lineas: null,
                  categoria: 'General',
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (u.includes('/lineas/259')) {
          return new Response(
            JSON.stringify({
              idLinea: '259',
              codigo: '1011',
              nombre: 'M-101A Circular\u00a0Aljarafe',
              modo: 'Bus',
              operadores: 'DAMAS S.A, ',
              color: 'ff0000',
              tieneIda: 1,
              tieneVuelta: 0,
              pmr: 1,
              polilinea: [[37.37, -6.08]],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      },
    });

    const stop = await client.fetchStopDetail(1, '2565');
    expect(stop.correspondencesRaw).toEqual(['1020', '1661']);

    const jumps = await client.fetchZoneJumps(1);
    expect(jumps).toEqual([{ originZone: 'A', destinationZone: 'B', jumps: 1 }]);

    const detail = await client.fetchLineDetail(1, '259');
    expect(detail.displayCode).toBe('M-101A');
    expect(detail.color).toBe('#ff0000');
    expect(detail.isCircular).toBe(true);
    expect(detail.operators).toEqual(['DAMAS S.A']);

    const svc = await client.fetchStopServices(1, '2565', new Date(2026, 10, 25, 6, 53, 0), {
      now: new Date(2026, 10, 25, 6, 53, 0),
    });
    expect(requestedUrls.some((u) => u.includes('horaIni=25-11-2026+06:53'))).toBe(true);
    expect(svc.services[0]?.displayCode).toBe('M-167');
    expect(svc.services[0]?.etaMinutes).toBe(19);

    const news = await client.fetchNews(1);
    expect(news[0]?.lines).toEqual([]);
  });

  it('retries transient 429 and fails fast when Retry-After exceeds maxRetryWaitMs', async () => {
    const client = new CtanClient({
      maxRetries: 2,
      maxRetryWaitMs: 1_000,
      sleepImpl: async () => undefined,
      fetchImpl: async () => new Response(null, { status: 429, headers: { 'Retry-After': '30' } }),
    });

    await expect(client.fetchLines(1)).rejects.toMatchObject({ statusCode: 429 });
  });
});
