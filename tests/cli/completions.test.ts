import { describe, expect, it } from 'vitest';
import { CtamdValidationError } from '../../src/api/errors.js';
import { generateCompletionScript, SUPPORTED_SHELLS } from '../../src/cli/completions.js';

describe('Shell completions', () => {
  it('generates completion scripts for bash, zsh, fish, and powershell', () => {
    for (const shell of SUPPORTED_SHELLS) {
      const script = generateCompletionScript(shell);
      expect(script).toContain('ctamd');
      expect(script).toContain('consortiums');
      expect(script).toContain('fares');
      expect(script).toContain('ctagr.es');
    }
  });

  it('rejects unsupported shells', () => {
    expect(() => generateCompletionScript('cmd')).toThrow(CtamdValidationError);
  });
});
