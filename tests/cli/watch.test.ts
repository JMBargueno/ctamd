import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { watchStopServices } from '../../src/cli/watch.js';
import type { StopServicesResult } from '../../src/types.js';

function captureStream(): { stream: PassThrough; read: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return {
    stream,
    read: () => Buffer.concat(chunks).toString('utf8'),
  };
}

function sampleServices(etaMinutes = 4): StopServicesResult {
  return {
    consorcioId: 1,
    stopId: '3023',
    stopCode: '3023',
    stopName: 'Plaza de Armas',
    nucleoName: 'Sevilla',
    lat: 37.391,
    lon: -6.003,
    windowStart: '2026-11-25 14:00',
    windowEnd: '2026-11-25 15:00',
    fetchedAt: '2026-11-25T14:00:00.000Z',
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
        departureTime: '14:09',
        departureSeconds: 14 * 3600 + 9 * 60,
        etaMinutes,
        stopType: 'normal',
        source: 'scheduled',
        distanceMeters: null,
        vehicle: null,
      },
    ],
  };
}

describe('watchStopServices', () => {
  it('renders TTY frames with Last updated timestamp, countdown ticks, and restores cursor on abort', async () => {
    const out = captureStream();
    const err = captureStream();
    const controller = new AbortController();
    let calls = 0;

    await watchStopServices({
      stopCode: '3023',
      intervalSec: 2,
      isTTY: true,
      stdout: out.stream,
      stderr: err.stream,
      signal: controller.signal,
      nowFn: () => new Date(2026, 10, 25, 14, 5, 9),
      sleepFn: async () => undefined,
      fetchServices: async () => {
        calls += 1;
        if (calls >= 2) {
          controller.abort();
        }
        return sampleServices(4);
      },
    });

    const text = out.read();
    expect(text).toContain('\x1b[?25l');
    expect(text).toContain('Last updated: 14:05:09');
    expect(text).toContain('Next refresh in 2s (Ctrl+C to stop)...');
    expect(text).toContain('Next refresh in 1s (Ctrl+C to stop)...');
    expect(text).toContain('\x1b[?25h');
    expect(err.read()).toBe('');
  });

  it('recovers from transient errors and streams NDJSON in --json mode', async () => {
    const out = captureStream();
    const err = captureStream();
    let calls = 0;

    await watchStopServices({
      stopCode: '3023',
      intervalSec: 15,
      useJson: true,
      isTTY: false,
      stdout: out.stream,
      stderr: err.stream,
      maxIterations: 2,
      sleepFn: async () => undefined,
      fetchServices: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('Upstream hiccup');
        }
        return sampleServices(2);
      },
    });

    expect(err.read()).toContain('[WARN] Refresh failed for stop #3023: Upstream hiccup');
    const lines = out.read().trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as StopServicesResult;
    expect(parsed.stopId).toBe('3023');
    expect(parsed.services[0]?.etaMinutes).toBe(2);
  });
});
