import { nearestInPalette, rgbToLab, buildPaletteLab, type PaletteLab } from './color';
import type { BeadColor } from './types';
import { EMPTY } from './types';

export interface QuantizeOptions {
  width: number;
  height: number;
  /** 最大颜色数（0 = 不限制，使用全部色板） */
  maxColors: number;
  /** 抖动强度 0~1 */
  dither: number;
  /** 抖动算法：无 / Floyd–Steinberg / 有序（Bayer 8×8） */
  ditherMode: 'none' | 'fs' | 'ordered';
  /** 采样：单点 / 3x3 平均 */
  sample: 'point' | 'average';
  brightness: number;
  contrast: number;
  saturation: number;
  /** 去掉接近纯白的背景（转为空格） */
  transparentWhite: boolean;
  /** 白色阈值 0~255 */
  whiteThreshold: number;
  /** 只保留色板中前 N 种被使用的颜色 */
  palette: BeadColor[];
  /** 边缘增强（让轮廓更清晰） */
  edgeBoost: number;
}

export const DEFAULT_QUANTIZE: Omit<QuantizeOptions, 'width' | 'height' | 'palette'> = {
  maxColors: 24,
  dither: 0.55,
  ditherMode: 'fs',
  sample: 'average',
  brightness: 1,
  contrast: 1,
  saturation: 1,
  transparentWhite: false,
  whiteThreshold: 246,
  edgeBoost: 0,
};

function adjust(r: number, g: number, b: number, brightness: number, contrast: number, saturation: number) {
  let rr = (r - 128) * contrast + 128;
  let gg = (g - 128) * contrast + 128;
  let bb = (b - 128) * contrast + 128;
  rr *= brightness;
  gg *= brightness;
  bb *= brightness;
  const gray = 0.299 * rr + 0.587 * gg + 0.114 * bb;
  rr = gray + (rr - gray) * saturation;
  gg = gray + (gg - gray) * saturation;
  bb = gray + (bb - gray) * saturation;
  return [Math.max(0, Math.min(255, rr)), Math.max(0, Math.min(255, gg)), Math.max(0, Math.min(255, bb))];
}

/**
 * 从源图像采样出 width*height 的 RGB 数组。
 *
 * `fit` 决定画布比例和图片比例不一致时怎么办：
 * - `stretch`（默认）：直接拉满，会变形
 * - `cover`：等比放大后居中裁掉多余部分，不变形（按板子拼的时候用这个，
 *   因为画布格子数由「板数 × 单板格数」锁死，不能为了迁就图片比例改格子数）
 */
export function sampleImage(
  img: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  width: number,
  height: number,
  sample: 'point' | 'average',
  fit: 'stretch' | 'cover' = 'stretch',
): Uint8ClampedArray {
  const sw = 'naturalWidth' in img ? img.naturalWidth || img.width : img.width;
  const sh = 'naturalHeight' in img ? img.naturalHeight || img.height : img.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = sample === 'average';
  ctx.imageSmoothingQuality = 'high';

  let sx = 0;
  let sy = 0;
  let ssw = sw;
  let ssh = sh;
  if (fit === 'cover' && sw > 0 && sh > 0) {
    const dstRatio = width / height;
    const srcRatio = sw / sh;
    if (srcRatio > dstRatio) {
      ssw = sh * dstRatio;
      sx = (sw - ssw) / 2;
    } else {
      ssh = sw / dstRatio;
      sy = (sh - ssh) / 2;
    }
  }
  ctx.drawImage(img as CanvasImageSource, sx, sy, ssw, ssh, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

/** k-means 选择代表色（Lab 空间） */
function kmeansCenters(samples: Float32Array, k: number, iterations = 8): number[][] {
  const n = samples.length / 3;
  if (n === 0 || k <= 0) return [];
  // k-means++ 初始化
  const centers: number[][] = [];
  const firstIdx = Math.floor(Math.random() * n);
  centers.push([samples[firstIdx * 3], samples[firstIdx * 3 + 1], samples[firstIdx * 3 + 2]]);
  const dist2 = new Float64Array(n).fill(Infinity);
  while (centers.length < k) {
    const c = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d =
        (samples[i * 3] - c[0]) ** 2 + (samples[i * 3 + 1] - c[1]) ** 2 + (samples[i * 3 + 2] - c[2]) ** 2;
      if (d < dist2[i]) dist2[i] = d;
      sum += dist2[i];
    }
    if (sum <= 0) break;
    let r = Math.random() * sum;
    let pick = 0;
    for (let i = 0; i < n; i++) {
      r -= dist2[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    centers.push([samples[pick * 3], samples[pick * 3 + 1], samples[pick * 3 + 2]]);
  }
  // Lloyd 迭代
  for (let it = 0; it < iterations; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d =
          (samples[i * 3] - centers[c][0]) ** 2 +
          (samples[i * 3 + 1] - centers[c][1]) ** 2 +
          (samples[i * 3 + 2] - centers[c][2]) ** 2;
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      sums[bi][0] += samples[i * 3];
      sums[bi][1] += samples[i * 3 + 1];
      sums[bi][2] += samples[i * 3 + 2];
      sums[bi][3] += 1;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c][3] > 0) {
        centers[c][0] = sums[c][0] / sums[c][3];
        centers[c][1] = sums[c][1] / sums[c][3];
        centers[c][2] = sums[c][2] / sums[c][3];
      }
    }
  }
  return centers;
}

export interface QuantizeResult {
  cells: Uint16Array;
  palette: BeadColor[];
  usedCount: number;
}

/**
 * 将图像量化为拼豆图纸。
 * 策略：先在 Lab 空间用 k-means 求出图像的代表色（控制颜色数量），
 * 再把每个代表色映射到实际色板最接近的色号，最后逐格映射。
 */
export function quantizeImage(
  data: Uint8ClampedArray,
  opts: QuantizeOptions,
): QuantizeResult {
  const { width, height } = opts;
  const total = width * height;
  const rgb = new Float32Array(total * 3);
  const alpha = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    let [r, g, b] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    const a = data[i * 4 + 3];
    // 透明像素按白底处理
    if (a < 255) {
      const t = a / 255;
      r = r * t + 255 * (1 - t);
      g = g * t + 255 * (1 - t);
      b = b * t + 255 * (1 - t);
    }
    const [rr, gg, bb] = adjust(r, g, b, opts.brightness, opts.contrast, opts.saturation);
    rgb[i * 3] = rr;
    rgb[i * 3 + 1] = gg;
    rgb[i * 3 + 2] = bb;
    alpha[i] = a;
  }

  // 背景判定：只把「和画布边缘连通的白色」当背景。
  // 旧写法把所有够白的像素都判成空格，结果人物脸上的高光、白衣服、
  // 眼睛反光全被挖成洞——这就是用户说的「中间还是会有不显示色号的部分」。
  const isBg = new Uint8Array(total);
  if (opts.transparentWhite) {
    const thr = opts.whiteThreshold;
    const cand = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      const r = rgb[i * 3];
      const g = rgb[i * 3 + 1];
      const b = rgb[i * 3 + 2];
      if (r >= thr && g >= thr && b >= thr) cand[i] = 1;
    }
    // 从四条边向内做连通扩散，只有连到边上的白才算背景
    const stack: number[] = [];
    const push = (x: number, y: number) => {
      const i = y * width + x;
      if (cand[i] && !isBg[i]) {
        isBg[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < width; x++) {
      push(x, 0);
      push(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      push(0, y);
      push(width - 1, y);
    }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i / width) | 0;
      if (x > 0) push(x - 1, y);
      if (x < width - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < height - 1) push(x, y + 1);
    }
  }

  const palette = opts.palette;
  const pl: PaletteLab = buildPaletteLab(palette);
  const cells = new Uint16Array(total);
  if (!palette.length) return { cells, palette, usedCount: 0 };

  let validCount = 0;
  for (let i = 0; i < total; i++) if (!isBg[i]) validCount++;
  if (!validCount) return { cells, palette, usedCount: 0 };

  const maxColors = Math.max(1, Math.min(opts.maxColors || palette.length, palette.length));

  // 若颜色上限 >= 色板容量，直接逐格匹配（最准）
  const useDirect = maxColors >= palette.length;

  // 1) 图像代表色（Lab 空间）——只有需要 k-means 降色时才付这份钱。
  //    之前无论走不走 k-means 都要给每个像素转一次 Lab，纯属白干。
  let centers: number[][] = [];
  if (!useDirect) {
    const valid: number[] = [];
    for (let i = 0; i < total; i++) if (!isBg[i]) valid.push(i);
    const labSamples = new Float32Array(valid.length * 3);
    for (let k = 0; k < valid.length; k++) {
      const i = valid[k];
      const lab = rgbToLab({ r: rgb[i * 3], g: rgb[i * 3 + 1], b: rgb[i * 3 + 2] });
      labSamples[k * 3] = lab.l;
      labSamples[k * 3 + 1] = lab.a;
      labSamples[k * 3 + 2] = lab.b;
    }
    centers = kmeansCenters(labSamples, maxColors, 6);
  }
  // 代表色 -> 色板下标
  const centerPaletteIdx = centers.map((c) => nearestInPalette({ l: c[0], a: c[1], b: c[2] }, pl));

  // 抖动：Floyd–Steinberg，在 RGB 空间按最近色板色做误差扩散
  const buf = new Float32Array(rgb);
  const dither = opts.dither;
  const used = new Set<number>();

  /**
   * 逐格找色号。这是整条链路最热的地方，所以：
   * - 不再每个像素拼一次 hex 字符串再 parse 回来（rgbToLab 直接吃整数）；
   * - 按量化后的 RGB 做缓存：平均采样后的图大片同色，命中率极高，
   *   照片里重复色也比想象中多。
   */
  const cache = new Map<number, number>();
  const nearest = (r: number, g: number, b: number): number => {
    const ri = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
    const gi = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
    const bi = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    const key = (ri << 16) | (gi << 8) | bi;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const lab = rgbToLab({ r: ri, g: gi, b: bi });
    let idx: number;
    if (useDirect) {
      idx = nearestInPalette(lab, pl);
    } else {
      // 先找最近代表色，再映射到色板
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = (lab.l - centers[c][0]) ** 2 + (lab.a - centers[c][1]) ** 2 + (lab.b - centers[c][2]) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      idx = centerPaletteIdx[best] ?? 0;
    }
    cache.set(key, idx);
    return idx;
  };

  // BAYER 8×8：有序抖动（不扩散误差，图案稳定不「流水」）
  const BAYER8 = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];
  const mode = opts.ditherMode ?? 'fs';
  const useOrdered = mode === 'ordered' && opts.dither > 0.01;
  const useFS = mode === 'fs' && opts.dither > 0.01;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (isBg[i]) continue;
      let r = buf[i * 3];
      let g = buf[i * 3 + 1];
      let b = buf[i * 3 + 2];
      if (useOrdered) {
        // 阈值偏移：把 0~63 的矩阵归一化到 -0.5~0.5，再按强度放大
        const t = (BAYER8[y & 7][x & 7] / 63 - 0.5) * 255 * 0.5 * opts.dither;
        r += t;
        g += t;
        b += t;
      }
      const idx = nearest(r, g, b);
      cells[i] = idx + 1;
      used.add(idx);
      if (useFS) {
        const pr = parseInt(palette[idx].hex.slice(1, 3), 16);
        const pg = parseInt(palette[idx].hex.slice(3, 5), 16);
        const pb = parseInt(palette[idx].hex.slice(5, 7), 16);
        const er = (r - pr) * opts.dither;
        const eg = (g - pg) * opts.dither;
        const eb = (b - pb) * opts.dither;
        const spread = (nx: number, ny: number, f: number) => {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
          const j = ny * width + nx;
          buf[j * 3] += er * f;
          buf[j * 3 + 1] += eg * f;
          buf[j * 3 + 2] += eb * f;
        };
        spread(x + 1, y, 7 / 16);
        spread(x - 1, y + 1, 3 / 16);
        spread(x, y + 1, 5 / 16);
        spread(x + 1, y + 1, 1 / 16);
      }
    }
  }

  // 压缩色板：只保留被使用的颜色，保持原顺序
  const keep = Array.from(used).sort((a, b) => a - b);
  if (keep.length === 0) return { cells: new Uint16Array(total), palette: [], usedCount: 0 };
  const remap = new Map<number, number>();
  const newPalette: BeadColor[] = keep.map((oldIdx, newIdx) => {
    remap.set(oldIdx, newIdx);
    return palette[oldIdx];
  });
  for (let i = 0; i < total; i++) {
    if (cells[i] > 0) cells[i] = (remap.get(cells[i] - 1) ?? 0) + 1;
  }
  return { cells, palette: newPalette, usedCount: keep.length };
}

export { EMPTY };
