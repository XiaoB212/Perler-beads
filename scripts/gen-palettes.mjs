/**
 * 由 HansBug/pindou-color-data 的真实色卡数据生成 src/core/palette-data.ts
 *
 *   node scripts/gen-palettes.mjs
 *
 * 数据源（CC BY 4.0，见仓库 LICENSE）：
 *   MARD 221/291、COCO 291、漫漫家 278、咪小窝 290、盼盼家 289、
 *   优肯/Artkal C197、M221、C+M 418、优肯 174。
 * 原始数据只有色号与 HEX，没有色名，这里按 Lab 色度 + 色相族自动生成中文色名。
 */

const SETS = [
  { key: 'mard291', src: 'mard-291-github', brand: 'MARD', label: 'MARD 291 色' },
  { key: 'coco291', src: 'coco-291', brand: 'COCO', label: 'COCO 291 色' },
  { key: 'manman278', src: 'manman-278', brand: '漫漫', label: '漫漫家 278 色' },
  { key: 'mixiaowo290', src: 'mixiaowo-290', brand: '咪小窝', label: '咪小窝 290 色' },
  { key: 'panpan289', src: 'panpan-289', brand: '盼盼', label: '盼盼家 289 色' },
  { key: 'artkal418', src: 'artkal-c197-m221-418-official', brand: 'Artkal', label: 'Artkal 418 色' },
  { key: 'artkal197', src: 'artkal-c-197-official', brand: 'Artkal', label: 'Artkal C 197 色' },
  { key: 'artkal221', src: 'artkal-m-221-official', brand: 'Artkal', label: 'Artkal M 221 色' },
  { key: 'youken174', src: 'youken-public-174', brand: '优肯', label: '优肯 174 色' },
];

const BASE = 'https://cdn.jsdelivr.net/gh/HansBug/pindou-color-data@main';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function srgbToLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB → CIELab（D65） */
function rgbToLab(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  let x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  let y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  let z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** 色相角（0–360），由 Lab 的 a/b 得到 */
function labHue(lab) {
  const h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  return (h + 360) % 360;
}

/** 色相角（HSL 色轮，0=红 60=黄 120=绿 180=青 240=蓝 300=品红） */
function hslHue(r, g, b) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
  else if (max === G) h = ((B - R) / d + 2) * 60;
  else h = ((R - G) / d + 4) * 60;
  return h;
}

/**
 * 中文色名 = 明度前缀 + 色相词。
 *
 * 色相用 HSL 色轮（0=红 60=黄 120=绿 240=蓝），符合直觉；
 * 但明度与彩度用 CIELab —— HSL 的饱和度对浅奶油色会给出 0.8，
 * 会把 #FAF5CD 误判成"柠黄"，而它其实是米黄。
 * 名称允许重复（同色相不同明度都叫"淡黄"），不做族内编号 ——
 * 编号会产生"青竹 20"这种明显错位的叫法，比重复更难接受。
 */
function colorName(hex) {
  const [r, g, b] = hexToRgb(hex);
  const lab = rgbToLab(r, g, b);
  const L = lab[0];
  const chroma = Math.hypot(lab[1], lab[2]);
  const hue = hslHue(r, g, b);

  // 无彩色
  if (chroma < 6) {
    if (L >= 97) return '纯白';
    if (L >= 88) return '本白';
    if (L >= 72) return '浅灰';
    if (L >= 55) return '中灰';
    if (L >= 36) return '深灰';
    if (L >= 20) return '炭黑';
    return '墨黑';
  }
  // 高明度 + 低彩度 = 米白系
  if (L >= 88 && chroma < 26) {
    if (hue >= 45 && hue < 95) return '米黄';
    if (hue >= 330 || hue < 45) return '米白';
    return '月白';
  }
  // 极暗
  if (L < 18) return chroma < 26 ? '墨黑' : `暗${hueName(hue)}`;
  const tone = L >= 86 ? '淡' : L >= 70 ? '浅' : L >= 44 ? '' : L >= 28 ? '深' : '暗';
  return tone + hueName(hue);
}

function hueName(h) {
  if (h < 6 || h >= 348) return '绯红';
  if (h < 18) return '朱红';
  if (h < 32) return '橘橙';
  if (h < 44) return '橙黄';
  if (h < 52) return '琥珀';
  if (h < 62) return '柠黄';
  if (h < 85) return '黄绿';
  if (h < 110) return '青竹';
  if (h < 140) return '草绿';
  if (h < 160) return '松绿';
  if (h < 178) return '青碧';
  if (h < 196) return '湖蓝';
  if (h < 215) return '天青';
  if (h < 240) return '群青';
  if (h < 258) return '靛蓝';
  if (h < 280) return '罗兰';
  if (h < 300) return '紫藤';
  if (h < 320) return '品红';
  return '玫红';
}

/** 色号自然序：先按字母前缀，再按数字 */
function codeKey(code) {
  const prefix = code.replace(/[0-9]/g, '');
  const num = parseInt(code.replace(/\D/g, ''), 10) || 0;
  return { prefix, num, raw: code };
}

function cmpCode(a, b) {
  const ka = codeKey(a);
  const kb = codeKey(b);
  if (ka.prefix !== kb.prefix) return ka.prefix < kb.prefix ? -1 : 1;
  if (ka.num !== kb.num) return ka.num - kb.num;
  return ka.raw < kb.raw ? -1 : 1;
}

function build(set, colors) {
  const named = colors.map((c) => {
    const hex = c.hex.toUpperCase();
    return { code: c.code, hex, name: colorName(hex) };
  });
  named.sort((a, b) => cmpCode(a.code, b.code));

  return named.map((d) => ({
    id: `${set.key}-${d.code}`,
    brand: set.brand,
    code: d.code,
    name: d.name,
    hex: d.hex,
  }));
}

const out = {};
for (const set of SETS) {
  const res = await fetch(`${BASE}/${set.src}/colors.json`);
  if (!res.ok) throw new Error(`${set.src}: HTTP ${res.status}`);
  const json = await res.json();
  out[set.key] = { label: set.label, brand: set.brand, colors: build(set, json.colors) };
  const names = new Set(out[set.key].colors.map((c) => c.name));
  console.log(
    `${set.key.padEnd(12)} ${String(out[set.key].colors.length).padStart(4)} 色  ${String(names.size).padStart(2)} 种名称  ${set.label}`,
  );
}

const header = `// 本文件由 scripts/gen-palettes.mjs 自动生成，请勿手工编辑。
// 色卡数据随站点一起打包，运行时不联网。
// 重新生成：node scripts/gen-palettes.mjs

export interface PaletteData {
  label: string;
  brand: string;
  colors: { id: string; brand: string; code: string; name: string; hex: string }[];
}

/**
 * 紧凑存储：每套色卡是一段「色号 色名 HEX」逐行文本，加载时解析成对象。
 * 2449 个色号如果都写成对象字面量，主包会多出 170 KB；写成文本只要 50 KB，
 * gzip 后不到 15 KB，且同一族色的重复色名压缩率极高。
 */
function parse(key: string, brand: string, rows: string) {
  return rows
    .trim()
    .split('\\n')
    .map((line) => {
      const [code, name, hex] = line.trim().split(/\\s+/);
      return { id: \`\${key}-\${code}\`, brand, code, name, hex };
    });
}

interface RawPalette {
  label: string;
  brand: string;
  rows: string;
}

const RAW: Record<string, RawPalette> = {
`;

const chunks = [];
for (const [key, val] of Object.entries(out)) {
  const rows = val.colors.map((c) => `      ${c.code} ${c.name} ${c.hex}`).join('\n');
  chunks.push(
    `  ${key}: {\n    label: ${JSON.stringify(val.label)},\n    brand: ${JSON.stringify(val.brand)},\n    rows: \`\n${rows}\n    \`,\n  },`,
  );
}

const footer = `};

export const PALETTE_DATA: Record<string, PaletteData> = Object.fromEntries(
  Object.entries(RAW).map(([key, p]) => [
    key,
    { label: p.label, brand: p.brand, colors: parse(key, p.brand, p.rows) },
  ]),
);
`;

const fs = await import('node:fs');
fs.writeFileSync('src/core/palette-data.ts', `${header}${chunks.join('\n')}\n${footer}`, 'utf8');
console.log('\n写入 src/core/palette-data.ts');
