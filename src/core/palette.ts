import type { BeadColor } from './types';
import { PALETTE_DATA } from './palette-data';

/**
 * 内置色卡。
 *
 * 数据来自 pindou-color-data 开源色卡数据集（MIT 许可，Copyright (c) 2026 HansBug），
 * 由 scripts/gen-palettes.mjs 抓取并生成中文色名，落到 palette-data.ts。
 * 色卡文件随站点一起打包，运行时不联网，全部数据在本地。
 * 之前这里是用 HSL 公式现造的假色板，色号对不上任何一家的真实色卡，
 * 现在换成 9 套真实体系 + 一套极简基础色。
 */

/** 品牌 key 的展示顺序：国内常用在前，进口体系在后 */
export const PALETTE_KEYS = [
  'mard291',
  'coco291',
  'manman278',
  'mixiaowo290',
  'panpan289',
  'artkal418',
  'artkal197',
  'artkal221',
  'youken174',
  'basic',
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];

/** 极简基础 32 色：不依赖品牌，适合快速画小图 */
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

const BASIC_PALETTE: BeadColor[] = BASIC_HEX.map(([name, hex], i) => ({
  id: `basic-${i + 1}`,
  brand: '基础',
  code: String(i + 1).padStart(2, '0'),
  name,
  hex,
}));

export const BUILTIN_PALETTES: Record<string, BeadColor[]> = {
  ...Object.fromEntries(
    Object.entries(PALETTE_DATA).map(([key, data]) => [
      key,
      data.colors.map((c) => ({ ...c })),
    ]),
  ),
  basic: BASIC_PALETTE,
};

export const BRAND_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PALETTE_DATA).map(([key, data]) => [key, data.label])),
  basic: '基础 32 色',
};

/** 旧工程 / 旧代码里的短 key 映射到新色卡，保证历史图纸还能打开 */
const ALIASES: Record<string, string> = {
  mard: 'mard291',
  coco: 'coco291',
  manman: 'manman278',
  mixiaowo: 'mixiaowo290',
  panpan: 'panpan289',
  artkal: 'artkal418',
  youken: 'youken174',
  // 数据源里没有 Perler / Hama 的真实色卡，不冒充：
  // 旧工程里这两个 key 一律回落到默认色卡，并在界面上一律不出现。
  perler: 'mard291',
  hama: 'basic',
};

export const DEFAULT_PALETTE_KEY = 'mard291';

export function resolvePaletteKey(key: string | undefined | null): string {
  if (!key) return DEFAULT_PALETTE_KEY;
  if (BUILTIN_PALETTES[key]) return key;
  const alias = ALIASES[key];
  if (alias && BUILTIN_PALETTES[alias]) return alias;
  return DEFAULT_PALETTE_KEY;
}

export function palettePreset(key: string): BeadColor[] {
  const src = BUILTIN_PALETTES[resolvePaletteKey(key)] ?? BASIC_PALETTE;
  return src.map((c) => ({ ...c }));
}

/** 色卡总数，用于界面上显示「9 套真实色卡 / 2449 色」之类的统计 */
export function totalPaletteColors(): number {
  return Object.values(BUILTIN_PALETTES).reduce((n, p) => n + p.length, 0);
}
