import { contrastRatio, parseColor, toHex, toHslString, toOklchString, toRgbString } from '@/features/tools/lib/color';
import type { Answer } from '@/lib/omnibox/types';

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(?:rgba?|hsla?)\([^()]+\)$/i;

/** `#ff8800`, `#f80`, `rgb(255, 136, 0)`, `hsl(30 100% 50%)` → a swatch with every format ready to copy. */
export function colorAnswer(input: string): Answer | null {
  const text = input.trim();
  if (!HEX.test(text) && !FUNC.test(text)) return null;
  const c = parseColor(text);
  if (!c) return null;
  const hex = toHex(c);
  const rgb = toRgbString(c);
  const hsl = toHslString(c);
  const oklch = toOklchString(c);
  const onWhite = contrastRatio({ ...c, a: 1 }, { r: 255, g: 255, b: 255, a: 1 });
  const onBlack = contrastRatio({ ...c, a: 1 }, { r: 0, g: 0, b: 0, a: 1 });
  return {
    kind: 'color',
    expression: text,
    value: hex.toUpperCase(),
    copy: hex,
    swatch: rgb,
    mono: true,
    caption: `${onWhite.toFixed(1)}:1 on white · ${onBlack.toFixed(1)}:1 on black`,
    rows: [
      { label: 'HEX', value: hex, copy: hex },
      { label: 'RGB', value: rgb, copy: rgb },
      { label: 'HSL', value: hsl, copy: hsl },
      { label: 'OKLCH', value: oklch, copy: oklch },
    ],
  };
}
