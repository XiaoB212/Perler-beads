import type { BeadColor } from './types';
import { rgbToHex } from './color';

/** 由 HSL 生成 hex，便于批量构造色卡 */
function hsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

interface Family {
  code: string;
  name: string;
  hue: number;
  sat: number;
  /** 12 级明度梯度 */
  lights: number[];
  satScale?: number[];
}

const LIGHTS = [0.14, 0.22, 0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78, 0.86, 0.92, 0.97];

function buildFamilyPalette(brand: string, families: Family[]): BeadColor[] {
  const out: BeadColor[] = [];
  for (const f of families) {
    f.lights.forEach((l, i) => {
      const s = (f.satScale?.[i] ?? f.sat) as number;
      out.push({
        id: `${brand}-${f.code}${i + 1}`,
        brand,
        code: `${f.code}${i + 1}`,
        name: `${f.name} ${i + 1}`,
        hex: hsl(f.hue, s, l),
      });
    });
  }
  return out;
}

const MARD_FAMILIES: Family[] = [
  { code: 'A', name: '绯红', hue: 352, sat: 0.78, lights: LIGHTS },
  { code: 'B', name: '橘橙', hue: 24, sat: 0.85, lights: LIGHTS },
  { code: 'C', name: '柠黄', hue: 48, sat: 0.9, lights: LIGHTS },
  { code: 'D', name: '青竹', hue: 96, sat: 0.62, lights: LIGHTS },
  { code: 'E', name: '松绿', hue: 152, sat: 0.6, lights: LIGHTS },
  { code: 'F', name: '湖蓝', hue: 196, sat: 0.72, lights: LIGHTS },
  { code: 'G', name: '群青', hue: 228, sat: 0.7, lights: LIGHTS },
  { code: 'H', name: '罗兰', hue: 282, sat: 0.55, lights: LIGHTS },
  { code: 'J', name: '大地', hue: 20, sat: 0.42, lights: LIGHTS },
  { code: 'K', name: '雾灰', hue: 220, sat: 0.08, lights: LIGHTS },
];

const ARTKAL_FAMILIES: Family[] = [
  { code: 'S', name: '红', hue: 356, sat: 0.8, lights: LIGHTS },
  { code: 'C', name: '橙', hue: 28, sat: 0.86, lights: LIGHTS },
  { code: 'Y', name: '黄', hue: 52, sat: 0.92, lights: LIGHTS },
  { code: 'G', name: '绿', hue: 128, sat: 0.66, lights: LIGHTS },
  { code: 'T', name: '青', hue: 178, sat: 0.62, lights: LIGHTS },
  { code: 'B', name: '蓝', hue: 212, sat: 0.74, lights: LIGHTS },
  { code: 'P', name: '紫', hue: 268, sat: 0.58, lights: LIGHTS },
  { code: 'N', name: '中性', hue: 30, sat: 0.16, lights: LIGHTS },
];

const PERLER_FAMILIES: Family[] = [
  { code: 'P', name: 'Red', hue: 358, sat: 0.8, lights: LIGHTS },
  { code: 'O', name: 'Orange', hue: 26, sat: 0.88, lights: LIGHTS },
  { code: 'Y', name: 'Yellow', hue: 50, sat: 0.92, lights: LIGHTS },
  { code: 'G', name: 'Green', hue: 140, sat: 0.62, lights: LIGHTS },
  { code: 'B', name: 'Blue', hue: 214, sat: 0.72, lights: LIGHTS },
  { code: 'V', name: 'Violet', hue: 276, sat: 0.55, lights: LIGHTS },
  { code: 'N', name: 'Neutral', hue: 210, sat: 0.07, lights: LIGHTS },
];

const HAMA_FAMILIES: Family[] = [
  { code: '0', name: '红', hue: 354, sat: 0.76, lights: LIGHTS },
  { code: '1', name: '橙', hue: 30, sat: 0.84, lights: LIGHTS },
  { code: '2', name: '黄', hue: 54, sat: 0.9, lights: LIGHTS },
  { code: '3', name: '绿', hue: 132, sat: 0.6, lights: LIGHTS },
  { code: '4', name: '蓝', hue: 208, sat: 0.7, lights: LIGHTS },
  { code: '5', name: '紫', hue: 272, sat: 0.5, lights: LIGHTS },
];

/** 内置基础 32 色（极简配色，适合入门） */
const BASIC_HEX: [string, string][] = [
  ['白', '#FFFFFF'],
  ['奶白', '#F7F0E4'],
  ['浅灰', '#D8DCE3'],
  ['灰', '#9AA3B2'],
  ['深灰', '#5C6577'],
  ['黑', '#1B1F2A'],
  ['米黄', '#F3D9A4'],
  ['黄', '#FFD43B'],
  ['橙黄', '#FFA726'],
  ['橘', '#FF7A1A'],
  ['砖红', '#E23B2E'],
  ['正红', '#D8202A'],
  ['玫红', '#E8407A'],
  ['粉', '#FFB3C7'],
  ['浅粉', '#FFD9E2'],
  ['紫红', '#A4246B'],
  ['紫', '#7C4DFF'],
  ['浅紫', '#C3B0FF'],
  ['深蓝', '#1E3A8A'],
  ['蓝', '#2563EB'],
  ['天蓝', '#4FC3F7'],
  ['浅蓝', '#BFE6FF'],
  ['青', '#14B8A6'],
  ['薄荷', '#8DE8C8'],
  ['墨绿', '#14532D'],
  ['绿', '#22A552'],
  ['草绿', '#7CD44B'],
  ['浅绿', '#C8F0A8'],
  ['咖', '#6B4423'],
  ['浅咖', '#B98A5E'],
  ['肤色', '#F6C9A8'],
  ['深肤', '#D08C63'],
];

export const BUILTIN_PALETTES: Record<string, BeadColor[]> = {
  mard: buildFamilyPalette('mard', MARD_FAMILIES),
  artkal: buildFamilyPalette('artkal', ARTKAL_FAMILIES),
  perler: buildFamilyPalette('perler', PERLER_FAMILIES),
  hama: buildFamilyPalette('hama', HAMA_FAMILIES),
  basic: BASIC_HEX.map(([name, hex], i) => ({
    id: `basic-${i + 1}`,
    brand: '基础',
    code: String(i + 1).padStart(2, '0'),
    name,
    hex,
  })),
};

export const BRAND_LABEL: Record<string, string> = {
  mard: 'MARD 迈尔德',
  artkal: 'Artkal',
  perler: 'Perler',
  hama: 'Hama',
  basic: '基础 32 色',
};

export function palettePreset(key: string): BeadColor[] {
  const src = BUILTIN_PALETTES[key] ?? BUILTIN_PALETTES.mard;
  return src.map((c) => ({ ...c }));
}
