import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDevBuild } from './is-dev-build';

describe('isDevBuild', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('NODE_ENV=production の場合だけ false を返す', () => {
    vi.stubGlobal('process', { env: { NODE_ENV: 'production' } });
    expect(isDevBuild()).toBe(false);
    vi.stubGlobal('process', { env: { NODE_ENV: 'development' } });
    expect(isDevBuild()).toBe(true);
  });

  it('process が存在しない、または不正な形なら安全側の true を返す', () => {
    vi.stubGlobal('process', undefined);
    expect(isDevBuild()).toBe(true);
    vi.stubGlobal('process', { env: null });
    expect(isDevBuild()).toBe(true);
  });
});
