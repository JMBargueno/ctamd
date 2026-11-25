import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { CtanClient } from '../../src/api/client.js';
import { CacheStore } from '../../src/cache/store.js';
import { normalizeNearbyArgv, runCli } from '../../src/cli/program.js';
import { FavoritesStore } from '../../src/config/favorites.js';
import { UserConfigStore } from '../../src/config/settings.js';
import { Ctamd } from '../../src/ctamd.js';
import type { ConsortiumCatalog, NetworkTopology } from '../../src/types.js';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop()!, { recursive: true, force: true }).catch(() => undefined);
  }
});

function captureStream(): { stream: PassThrough; read: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return {
    stream,
    read: () => Buffer.concat(chunks).toString('utf8'),
  };
}

function makeSeedCatalog(consorcioId: 1 | 3): ConsortiumCatalog {
  if (consorcioId === 3) {
    return {
      schemaVersion: 1,
      consorcioId: 3,
      syncedAt: new Date().toISOString(),
      lang: 'ES',
      lines: {
        '1047': {
          id: '1047',
          code: '0160',
          displayCode: '0160',
          name: '0160 Granada - Armilla - Alhendín',
          modeId: '1',
          mode: 'Bus',
          operators: ['ALSA'],
          hasNews: true,
          color: '#00a86b',
          isCircular: false,
          directions: [],
        },
      },
      stops: {
        '501': {
          id: '501',
          code: '501',
          name: 'Rotonda Neptuno',
          nucleoId: '202',
          nucleoName: 'Granada',
          municipioId: '1',
          municipioName: 'Granada',
          zoneId: 'A',
          lat: 37.177,
          lon: -3.598,
          modes: 'Bus',
          lines: [],
        },
      },
      nucleos: {
        '202': { id: '202', municipioId: '1', zoneId: 'A', name: 'Granada' },
        '176': { id: '176', municipioId: '2', zoneId: 'B', name: 'Armilla' },
      },
      municipios: {
        '1': { id: '1', name: 'Granada' },
        '2': { id: '2', name: 'Armilla' },
      },
      zones: { A: { id: 'A', name: 'ZONA A', color: '#ffcccc' } },
      modes: { '1': { id: '1', description: 'Bus', observations: 'Bus' } },
      frequencies: {
        '1': { id: '1', acronym: 'LMXJV---', name: 'LABORABLE' },
      },
      interurbanFares: [
        { jumps: 0, singleTicketEur: 1.6, cardEur: 0.9 },
        { jumps: 1, singleTicketEur: 1.85, cardEur: 1.05 },
      ],
      urbanFares: [],
    };
  }

  return {
    schemaVersion: 1,
    consorcioId: 1,
    syncedAt: new Date().toISOString(),
    lang: 'ES',
    lines: {
      '446': {
        id: '446',
        code: '1552',
        displayCode: 'M-155',
        name: 'M-155 Sevilla - Mairena del Aljarafe',
        modeId: '1',
        mode: 'Bus',
        operators: ['DAMAS'],
        hasNews: false,
        color: '#00a86b',
        isCircular: false,
        directions: [],
      },
      '250': {
        id: '250',
        code: '1750',
        displayCode: 'M-175',
        name: 'M-175 Albaida - Sevilla',
        modeId: '1',
        mode: 'Bus',
        operators: ['DAMAS'],
        hasNews: false,
        color: '#00a86b',
        isCircular: false,
        directions: [],
      },
    },
    stops: {
      '3023': {
        id: '3023',
        code: '3023',
        name: 'Plaza de Armas',
        nucleoId: '3225',
        nucleoName: 'Sevilla',
        municipioId: '1',
        municipioName: 'Sevilla',
        zoneId: 'A',
        lat: 37.391,
        lon: -6.003,
        modes: 'Bus',
        lines: [{ lineId: '446', code: '1552', displayCode: 'M-155', color: '#00a86b' }],
      },
      '3287': {
        id: '3287',
        code: '3287',
        name: 'Ciudad Expo',
        nucleoId: '3196',
        nucleoName: 'Mairena del Aljarafe',
        municipioId: '2',
        municipioName: 'Mairena del Aljarafe',
        zoneId: 'B',
        lat: 37.35,
        lon: -6.05,
        modes: 'Bus',
        lines: [{ lineId: '446', code: '1552', displayCode: 'M-155', color: '#00a86b' }],
      },
    },
    nucleos: {
      '3225': { id: '3225', municipioId: '1', zoneId: 'A', name: 'Sevilla' },
      '3196': { id: '3196', municipioId: '2', zoneId: 'B', name: 'Mairena del Aljarafe' },
    },
    municipios: {
      '1': { id: '1', name: 'Sevilla' },
      '2': { id: '2', name: 'Mairena del Aljarafe' },
    },
    zones: { A: { id: 'A', name: 'ZONA A', color: '#ffcccc' } },
    modes: { '1': { id: '1', description: 'Bus', observations: 'Bus' } },
    frequencies: { '1': { id: '1', acronym: 'LV', name: 'Lunes a Viernes' } },
    interurbanFares: [
      { jumps: 0, singleTicketEur: 1.55, cardEur: 0.61 },
      { jumps: 1, singleTicketEur: 1.75, cardEur: 0.99 },
    ],
    urbanFares: [],
  };
}

function makeSeedTopology(catalog: ConsortiumCatalog): NetworkTopology {
  return {
    schemaVersion: 1,
    consorcioId: catalog.consorcioId,
    syncedAt: new Date().toISOString(),
    lines: catalog.lines,
    stops: catalog.stops,
    lineStops: {
      '446:1': [
        {
          id: '3023',
          code: '3023',
          name: 'Plaza de Armas',
          nucleoId: '3225',
          zoneId: 'A',
          lat: 37.391,
          lon: -6.003,
          direction: 1,
          order: 1,
          distanceMeters: 0,
          modes: 'Bus',
          startTime: null,
          endTime: null,
        },
        {
          id: '3287',
          code: '3287',
          name: 'Ciudad Expo',
          nucleoId: '3196',
          zoneId: 'B',
          lat: 37.35,
          lon: -6.05,
          direction: 1,
          order: 2,
          distanceMeters: 7500,
          modes: 'Bus',
          startTime: null,
          endTime: null,
        },
      ],
    },
  };
}

function createMockClient(): CtanClient {
  return new CtanClient({
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes('/horarios_origen_destino')) {
        return new Response(
          JSON.stringify({
            bloques: [
              { nombre: 'Lineas', color: '#ffffff', tipo: '1' },
              { nombre: 'Pz. Armas (Sevilla)', color: '#FFCCCC', tipo: '1' },
              { nombre: 'Mairena del Aljarafe', color: '#CCFFCC', tipo: '1' },
              { nombre: 'Frecuencia', color: '#ffffff', tipo: '1' },
            ],
            horario: [
              {
                idlinea: '446',
                codigo: '1552',
                horas: ['09:30', '10:05'],
                dias: 'LV',
                observaciones: '',
              },
            ],
            frecuencias: [{ idfrecuencia: '1', acronimo: 'LV', nombre: 'Lunes a Viernes' }],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/calculo_saltos')) {
        return new Response(JSON.stringify({ calculo_saltos: { saltos: '1', error: '' } }), {
          status: 200,
        });
      }
      if (u.includes('/paradas/3023/servicios')) {
        return new Response(
          JSON.stringify({
            horaIni: '2026-11-25 09:00',
            horaFin: '2026-11-25 10:00',
            servicios: [
              {
                idParada: '3023',
                idLinea: '250',
                servicio: '09:12',
                nombre: 'M-175 Albaida - Sevilla',
                linea: '1750',
                sentido: '1',
                destino: 'SEVILLA',
                tipo: '0',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/lineas/446/paradas')) {
        return new Response(
          JSON.stringify({
            paradas: [
              {
                idParada: '3023',
                idLinea: '446',
                idNucleo: '3225',
                idZona: 'A',
                nombre: 'Plaza de Armas',
                latitud: '37.391',
                longitud: '-6.003',
                sentido: '1',
                orden: 1,
                modos: 'Bus',
              },
              {
                idParada: '3287',
                idLinea: '446',
                idNucleo: '3196',
                idZona: 'B',
                nombre: 'Ciudad Expo',
                latitud: '37.35',
                longitud: '-6.05',
                sentido: '1',
                orden: 2,
                modos: 'Bus',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/lineas/446')) {
        return new Response(
          JSON.stringify({
            idLinea: '446',
            codigo: '1552',
            nombre: 'M-155 Sevilla - Mairena del Aljarafe',
            modo: 'Bus',
            operadores: 'DAMAS',
            color: '00a86b',
            tieneIda: 1,
            tieneVuelta: 1,
            pmr: 'Adaptada',
          }),
          { status: 200 },
        );
      }
      if (u.includes('/puntos_venta')) {
        return new Response(
          JSON.stringify({
            puntosVenta: [
              {
                idComercio: '99',
                idTipo: '1',
                tipo: 'Estanco',
                idNucleo: '3196',
                nucleo: 'Mairena del Aljarafe',
                idMunicipio: '2',
                municipio: 'Mairena del Aljarafe',
                direccion: 'AVDA DE LOS DESCUBRIMIENTOS 10',
                latitud: '37.349',
                longitud: '-6.051',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/Consorcios/3/noticias')) {
        return new Response(
          JSON.stringify({
            noticias: [
              {
                idNoticia: '1',
                idCategoria: '1',
                categoria: 'Incidencias',
                titulo: 'Aviso Granada L-0160',
                resumen: 'Cambio de parada',
                fechaInicio: '2026-11-25',
                fechafin: '2026-11-28',
                lineas: '1047, ',
                novedad: '1',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/noticias')) {
        return new Response('', { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    },
  });
}

describe('CLI normalizeNearbyArgv', () => {
  it('places negative GPS coordinates after -- while preserving flags', () => {
    expect(
      normalizeNearbyArgv([
        'node',
        'ctamd',
        'nearby',
        '37.391',
        '-6.003',
        '-c',
        'sevilla',
        '-r',
        '800',
      ]),
    ).toEqual(['node', 'ctamd', 'nearby', '-c', 'sevilla', '-r', '800', '--', '37.391', '-6.003']);
  });
});

describe('CLI end-to-end commands', () => {
  it('supports consortiums, use, OD search, stop services, lines, line, towns, fares, nearby, points, alerts, fav, and offline stop estimates', async () => {
    const cacheDir = await makeTempDir('ctamd-cli-cache-');
    const configDir = await makeTempDir('ctamd-cli-cfg-');
    const cache = new CacheStore(cacheDir);
    const sevCatalog = makeSeedCatalog(1);
    const graCatalog = makeSeedCatalog(3);
    await cache.saveCatalog(sevCatalog);
    await cache.saveCatalog(graCatalog);
    await cache.saveTopology(makeSeedTopology(sevCatalog));

    const client = createMockClient();
    const favoritesStore = new FavoritesStore(configDir);
    const configStore = new UserConfigStore(configDir);
    const now = new Date(2026, 10, 25, 9, 0, 0);

    const run = async (args: string[]) => {
      const stdout = captureStream();
      const stderr = captureStream();
      const code = await runCli(['node', 'ctamd', ...args], {
        createCtamd: () => new Ctamd({ cache, client }),
        favoritesStore,
        configStore,
        stdout: stdout.stream,
        stderr: stderr.stream,
        nowFn: () => now,
        env: {},
        configureExitOverride: true,
        manageProcessExitCode: false,
      });
      return { code, out: stdout.read(), err: stderr.read() };
    };

    // 1. consortiums + use
    const consRes = await run(['consortiums']);
    expect(consRes.code).toBe(0);
    expect(consRes.out).toContain('CTAS');
    expect(consRes.out).toContain('CTMGR');

    const useRes = await run(['use', 'ctas.es']);
    expect(useRes.code).toBe(0);
    expect(useRes.out).toContain('Área de Sevilla');

    // 2. Town-to-town OD search using saved default consortium
    const odRes = await run(['-f', 'sevilla', '-t', 'mairena del aljarafe', '--json']);
    expect(odRes.code).toBe(0);
    const odJson = JSON.parse(odRes.out);
    expect(odJson.journeys).toHaveLength(1);
    expect(odJson.journeys[0].displayCode).toBe('M-155');
    expect(odJson.fare.jumps).toBe(1);
    expect(odJson.fare.cardEur).toBe(0.99);

    // 3. Stop-to-stop offline topology estimate
    const estRes = await run(['-f', '3023', '-t', '3287', '--by', 'stop', '--estimate']);
    expect(estRes.code).toBe(0);
    expect(estRes.out).toContain('M-155');
    expect(estRes.out).toContain('Offline estimates');

    // 4. Stop upcoming departures
    const stopRes = await run(['stop', '3023']);
    expect(stopRes.code).toBe(0);
    expect(stopRes.out).toContain('M-175');
    expect(stopRes.out).toContain('09:12');

    // 5. lines, line, towns, fares, points, alerts
    const linesRes = await run(['lines', '--mode', 'bus']);
    expect(linesRes.code).toBe(0);
    expect(linesRes.out).toContain('M-155');

    const lineRes = await run(['line', 'M-155']);
    expect(lineRes.code).toBe(0);
    expect(lineRes.out).toContain('Plaza de Armas');

    const townsRes = await run(['towns', 'mairena']);
    expect(townsRes.code).toBe(0);
    expect(townsRes.out).toContain('Mairena del Aljarafe');

    const faresRes = await run(['fares', 'sevilla', 'mairena del aljarafe']);
    expect(faresRes.code).toBe(0);
    expect(faresRes.out).toContain('0.99 €');

    const pointsRes = await run(['points', '--near', '37.35,-6.05']);
    expect(pointsRes.code).toBe(0);
    expect(pointsRes.out).toContain('Estanco');

    const alertsRes = await run(['-c', 'ctagr.es', 'alerts']);
    expect(alertsRes.code).toBe(0);
    expect(alertsRes.out).toContain('Aviso Granada L-0160');

    // 6. nearby with GPS auto-detection across provinces
    const nearbyGra = await run(['nearby', '37.177', '-3.598', '-r', '500']);
    expect(nearbyGra.code).toBe(0);
    expect(nearbyGra.out).toContain('CTMGR');
    expect(nearbyGra.out).toContain('Rotonda Neptuno');

    // 7. fav add/list/rm
    const favAdd = await run(['fav', 'add', 'casa', '3023', '-c', 'sevilla']);
    expect(favAdd.code).toBe(0);
    const favList = await run(['fav', 'list']);
    expect(favList.out).toContain('casa');
    const favRm = await run(['fav', 'rm', 'casa']);
    expect(favRm.code).toBe(0);

    // 8. Missing consortium error when cleared and no -c
    await configStore.clearDefaultConsortiumId();
    const missingCons = await run(['lines']);
    expect(missingCons.code).toBe(1);
    expect(missingCons.err).toContain('No consortium specified');
  });
});
