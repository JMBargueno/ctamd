import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runInteractivePrompt } from '../../src/cli/interactive.js';

function captureStream(): { stream: PassThrough; read: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return {
    stream,
    read: () => Buffer.concat(chunks).toString('utf8'),
  };
}

describe('runInteractivePrompt', () => {
  it('guides the user through consortium, town OD search, date, time, and sort', async () => {
    const input = new PassThrough();
    const output = captureStream();

    input.end('3\n1\ngranada\narmilla\n2026-11-28\n09:30\ny\n');

    const result = await runInteractivePrompt({
      input,
      output: output.stream,
      now: new Date(2026, 10, 25, 8, 0, 0),
      matchNucleos: async (_cId, q) => {
        if (q === 'granada') {
          return [{ id: '202', municipioId: '1', zoneId: 'A', name: 'Granada' }];
        }
        return [{ id: '176', municipioId: '2', zoneId: 'B', name: 'Armilla' }];
      },
      matchStops: async () => [],
    });

    expect(result.consortium.id).toBe(3);
    expect(result.mode).toBe('nucleo');
    expect(result.originId).toBe('202');
    expect(result.destinationId).toBe('176');
    expect(result.afterSeconds).toBe(9 * 3600 + 30 * 60);
    expect(result.sortByDuration).toBe(true);
  });
});
