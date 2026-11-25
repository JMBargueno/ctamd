import { describe, expect, it } from 'vitest';
import {
  colorizeLineLabel,
  detectColorLevel,
  liftDarkRgb,
  parseHexColor,
  rgbToAnsi256,
  stripAnsi,
} from '../../src/format/colors.js';

describe('Terminal colors', () => {
  it('respects NO_COLOR, FORCE_COLOR, and TTY capabilities', () => {
    expect(detectColorLevel({ NO_COLOR: '1' } as NodeJS.ProcessEnv, true)).toBe(0);
    expect(detectColorLevel({ FORCE_COLOR: '3' } as NodeJS.ProcessEnv, false)).toBe(3);
    expect(detectColorLevel({ COLORTERM: 'truecolor' } as NodeJS.ProcessEnv, true)).toBe(3);
    expect(detectColorLevel({} as NodeJS.ProcessEnv, false)).toBe(0);
  });

  it('parses hex colors, lifts dark colors, and formats ANSI badges cleanly', () => {
    expect(parseHexColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHexColor('#f0a')).toEqual({ r: 255, g: 0, b: 170 });
    expect(liftDarkRgb(0, 0, 0)).toEqual({ r: 0, g: 200, b: 220 });
    expect(rgbToAnsi256(255, 0, 0)).toBe(196);

    const colored = colorizeLineLabel('M-101A', '#00a86b', 3);
    expect(colored).toContain('38;2;0;168;107');
    expect(stripAnsi(colored)).toBe('M-101A');
    const lifted = colorizeLineLabel('M-101A', '#ff0000', 3);
    expect(lifted).toContain('38;2;255;44;44');
    expect(colorizeLineLabel('M-101A', '#ff0000', 0)).toBe('M-101A');
  });
});
