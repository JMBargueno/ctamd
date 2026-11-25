import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UserConfigStore } from '../../src/config/settings.js';

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

describe('UserConfigStore', () => {
  it('persists and clears defaultConsortiumId atomically', async () => {
    const dir = await makeTempDir('ctamd-config-');
    const store = new UserConfigStore(dir);

    expect(await store.getDefaultConsortiumId()).toBeUndefined();
    await store.setDefaultConsortiumId(3);
    expect(await store.getDefaultConsortiumId()).toBe(3);

    await store.clearDefaultConsortiumId();
    expect(await store.getDefaultConsortiumId()).toBeUndefined();
  });
});
