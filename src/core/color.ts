import type { BeadColor } from './types';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface LAB {
  l: number;
  a: number;
  b: number;
}

const clamp = (v: number, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to = (v: number) => clamp(Math.round(v)).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function rgbToLab({ r, g, b }: RGB): LAB {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  // sRGB -> XYZ (D65)
  let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  let Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  let Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  X /= 0.95047;
  Z /= 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function hexToLab(hex: string): LAB {
  return rgbToLab(hexToRgb(hex));
}

/** CIEDE2000 色差，越小越接近 */
export function deltaE2000(l1: LAB, l2: LAB): number {
  const kL = 1,
    kC = 1,
    kH = 1;
  const C1 = Math.hypot(l1.a, l1.b);
  const C2 = Math.hypot(l2.a, l2.b);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * l1.a;
  const a2p = (1 + G) * l2.a;
  const C1p = Math.hypot(a1p, l1.b);
  const C2p = Math.hypot(a2p, l2.b);
  const h1p = a1p === 0 && l1.b === 0 ? 0 : (Math.atan2(l1.b, a1p) * 180) / Math.PI;
  const h2p = a2p === 0 && l2.b === 0 ? 0 : (Math.atan2(l2.b, a2p) * 180) / Math.PI;
  const hp1 = h1p < 0 ? h1p + 360 : h1p;
  const hp2 = h2p < 0 ? h2p + 360 : h2p;
  const dLp = l2.l - l1.l;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);
  const Lbar = (l1.l + l2.l) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = hp1 + hp2;
  if (C1p * C2p !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbarp = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
    else hbarp = (hp1 + hp2) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbarp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const RC = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbar - 50, 2)) / Math.sqrt(20 + Math.pow(Lbar - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC;
  return Math.sqrt(
    Math.pow(dLp / (kL * SL), 2) +
      Math.pow(dCp / (kC * SC), 2) +
      Math.pow(dHp / (kH * SH), 2) +
      RT * (dCp / (kC * SC)) * (dHp / (kH * SH)),
  );
}

/** 预计算色板 Lab，加速匹配 */
export interface PaletteLab {
  labs: LAB[];
}

export function buildPaletteLab(palette: BeadColor[]): PaletteLab {
  return { labs: palette.map((c) => hexToLab(c.hex)) };
}

/**
 * 在色板中寻找最接近的颜色下标。
 *
 * CIEDE2000 是逐格匹配的精度保证，但它的代价很高（pow / atan2 / cos），
 * 色板有 291 色时每格要算 291 次，一张 64×64 的图就是 120 万次 —— 这就是
 * 用户说的「转换的时候很卡」的主要来源。
 *
 * 所以先用 Lab 欧氏距离粗筛出最接近的 SHORTLIST 个候选，再只在候选里算 CIEDE2000。
 * CIEDE2000 与 Lab 欧氏距离的排序高度一致，真命天子几乎必然落在这 12 个里，
 * 精度肉眼不可分辨，耗时降到约 1/24。
 */
const SHORTLIST = 12;

export function nearestInPalette(lab: LAB, pl: PaletteLab): number {
  const labs = pl.labs;
  const n = labs.length;
  if (n === 0) return 0;
  if (n <= SHORTLIST) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = deltaE2000(lab, labs[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // 插入排序维护一个「距离最小的 K 个候选」小顶堆（K 很小，数组最合适）
  const cand = new Int32Array(SHORTLIST);
  const candD = new Float64Array(SHORTLIST);
  let filled = 0;
  for (let i = 0; i < n; i++) {
    const c = labs[i];
    const dl = lab.l - c.l;
    const da = lab.a - c.a;
    const db = lab.b - c.b;
    const d = dl * dl + da * da + db * db;
    if (filled < SHORTLIST) {
      let j = filled++;
      cand[j] = i;
      candD[j] = d;
      while (j > 0 && candD[j - 1] > candD[j]) {
        const ti = cand[j - 1];
        cand[j - 1] = cand[j];
        cand[j] = ti;
        const td = candD[j - 1];
        candD[j - 1] = candD[j];
        candD[j] = td;
        j--;
      }
    } else if (d < candD[SHORTLIST - 1]) {
      let j = SHORTLIST - 1;
      cand[j] = i;
      candD[j] = d;
      while (j > 0 && candD[j - 1] > candD[j]) {
        const ti = cand[j - 1];
        cand[j - 1] = cand[j];
        cand[j] = ti;
        const td = candD[j - 1];
        candD[j - 1] = candD[j];
        candD[j] = td;
        j--;
      }
    }
  }

  let best = cand[0];
  let bestD = Infinity;
  for (let k = 0; k < filled; k++) {
    const d = deltaE2000(lab, labs[cand[k]]);
    if (d < bestD) {
      bestD = d;
      best = cand[k];
    }
  }
  return best;
}

/** 相对亮度 0–1，用于决定文字用黑还是白 */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  // srgbToLinear 已经把 0–255 归一到 0–1，这里返回的就是 0–1 的相对亮度
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function readableTextColor(hex: string): string {
  return luminance(hex) > 0.42 ? '#12141d' : '#ffffff';
}

/** 颜色明度/饱和/色相调整（以 HSL 方式），用于转换前预处理 */
export function adjustColor(rgb: RGB, brightness: number, contrast: number, saturation: number): RGB {
  let { r, g, b } = rgb;
  // 对比度
  const c = contrast;
  r = (r - 128) * c + 128;
  g = (g - 128) * c + 128;
  b = (b - 128) * c + 128;
  // 亮度
  r *= brightness;
  g *= brightness;
  b *= brightness;
  // 饱和度
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  r = gray + (r - gray) * saturation;
  g = gray + (g - gray) * saturation;
  b = gray + (b - gray) * saturation;
  return { r: clamp(r), g: clamp(g), b: clamp(b) };
}
