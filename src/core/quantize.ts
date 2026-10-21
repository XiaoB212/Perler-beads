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
  /**
   * 逐格遮罩（长度 width*height）：1 保留、0 抠掉。
   * 被抠掉的格子既不算颗粒、也不参与配色，用来「框选内容、去掉多余的板子」。
   */
  mask?: Uint8Array;
  /**
   * 去掉零散单颗：四面邻居都是同一个色号时，把它并进去。
   * 照片抖动之后总会留下一些孤零零的杂色点，一颗一颗挑豆子时最烦这些，
   * 而且它们正是「看起来和原图差很多」的颗粒感来源。
   */
  speckle?: boolean;
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
  speckle: true,
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

/** 源图上的裁剪框（单位：源图像素） */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 按「目标宽高比 + 缩放 + 中心点」算出要采样的源图矩形。
 *
 * 这是导入时「选哪一块为中心」的实现：中心点用 0~1 的归一化坐标，
 * zoom=1 表示刚好铺满目标比例（也就是原来的 cover 行为），zoom>1 是放大裁得更小，
 * zoom<1 只在图片比目标比例更扁时才有意义（会露出空白边）。
 */
export function cropRectFor(
  srcW: number,
  srcH: number,
  aspect: number,
  zoom = 1,
  cx = 0.5,
  cy = 0.5,
): CropRect {
  if (!srcW || !srcH) return { x: 0, y: 0, w: srcW, h: srcH };
  const z = Math.max(1, zoom);
  // 先按目标比例取出最大的框，再除以 zoom
  let w = srcW;
  let h = srcW / aspect;
  if (h > srcH) {
    h = srcH;
    w = srcH * aspect;
  }
  w /= z;
  h /= z;
  let x = cx * srcW - w / 2;
  let y = cy * srcH - h / 2;
  // 不让框跑出图片
  x = Math.min(Math.max(0, x), Math.max(0, srcW - w));
  y = Math.min(Math.max(0, y), Math.max(0, srcH - h));
  return { x, y, w, h };
}

/**
 * 从源图像采样出 width*height 的 RGB 数组。
 *
 * `fit` 决定画布比例和图片比例不一致时怎么办：
 * - `stretch`（默认）：直接拉满，会变形
 * - `cover`：等比放大后居中裁掉多余部分，不变形（按板子拼的时候用这个，
 *   因为画布格子数由「板数 × 单板格数」锁死，不能为了迁就图片比例改格子数）
 *
 * 传了 `crop` 就只采那一块（用户手选的区域），此时忽略 `fit`。
 */
export function sampleImage(
  img: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  width: number,
  height: number,
  sample: 'point' | 'average',
  fit: 'stretch' | 'cover' = 'stretch',
  crop?: CropRect,
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
  if (crop && crop.w > 0 && crop.h > 0) {
    sx = crop.x;
    sy = crop.y;
    ssw = crop.w;
    ssh = crop.h;
  } else if (fit === 'cover' && sw > 0 && sh > 0) {
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

/**
 * 一键抠图：从四边往里做连通填充，把和边缘颜色接近的一整片判成背景。
 *
 * 和 quantizeImage 里只认「白色」不同，这里认的是「边缘那圈是什么颜色」——
 * 拍在桌上的玩偶、截图带浅灰底，都能一键抠掉，不用手动一点点涂。
 */
export function backgroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 26,
  /** 当前保留区域（1=保留）：它的边界也会成为扩散起点 */
  keep?: Uint8Array,
): Uint8Array {
  const total = width * height;
  const mask = new Uint8Array(total).fill(1);
  if (!total) return mask;

  // 四条边上取样，取出现最多的颜色当「背景色」
  const bucket = new Map<number, number>();
  const add = (i: number) => {
    const key = ((data[i * 4] >> 3) << 10) | ((data[i * 4 + 1] >> 3) << 5) | (data[i * 4 + 2] >> 3);
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    add(x);
    add((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    add(y * width);
    add(y * width + width - 1);
  }
  let bestKey = 0;
  let bestCount = -1;
  for (const [k, v] of bucket) {
    if (v > bestCount) {
      bestCount = v;
      bestKey = k;
    }
  }
  const br = ((bestKey >> 10) & 31) << 3;
  const bg = ((bestKey >> 5) & 31) << 3;
  const bb = (bestKey & 31) << 3;
  const tol2 = tolerance * tolerance * 3;

  const near = (i: number) => {
    const dr = data[i * 4] - br;
    const dg = data[i * 4 + 1] - bg;
    const db = data[i * 4 + 2] - bb;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  const seen = new Uint8Array(total);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (seen[i] || !near(i)) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  // 用户划了选区时，选区的边界也算起点：只吃掉和框边相连的背景，
  // 被人物围住的那一块留着 —— 免得把人物内部挖出没有色号的洞。
  if (keep && keep.length === total) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!keep[i]) continue;
        const onEdge =
          (x > 0 && !keep[i - 1]) ||
          (x < width - 1 && !keep[i + 1]) ||
          (y > 0 && !keep[i - width]) ||
          (y < height - 1 && !keep[i + width]);
        if (onEdge) seed(i);
      }
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    mask[i] = 0;
    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (y > 0) seed(i - width);
    if (y < height - 1) seed(i + width);
  }
  return mask;
}


/**
 * 魔棒：从点下去的那一格开始，把和它颜色接近且连通的区域整片标出来。
 *
 * 和 backgroundMask 的区别是「种子点由用户点」——一键抠背景只认四边那圈颜色，
 * 抠完背景后小面积色块留在里面的那一块，就得靠魔棒去点它。
 * 返回 1=命中（该抠掉/该补回），0=没碰到。
 */
export function magicWandMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance = 26,
  diagonal = false,
  /** true=只吃和落点连通的那一片（默认）；false=全图同色都吃，不管连不连 */
  contiguous = true,
): Uint8Array {
  const total = width * height;
  const out = new Uint8Array(total);
  const sx = Math.max(0, Math.min(width - 1, Math.floor(seedX)));
  const sy = Math.max(0, Math.min(height - 1, Math.floor(seedY)));
  if (!total) return out;

  const sr = data[(sy * width + sx) * 4];
  const sg = data[(sy * width + sx) * 4 + 1];
  const sb = data[(sy * width + sx) * 4 + 2];
  const tol2 = tolerance * tolerance * 3;
  const near = (i: number) => {
    const dr = data[i * 4] - sr;
    const dg = data[i * 4 + 1] - sg;
    const db = data[i * 4 + 2] - sb;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  const start = sy * width + sx;
  if (!near(start)) {
    out[start] = 1;
    return out;
  }

  // 不连续模式：整张图扫一遍，颜色接近的都算命中。
  // 用途是「图里另有几个一样的白点 / 同色零碎块」—— 一个个点太啰嗦。
  if (!contiguous) {
    for (let i = 0; i < total; i++) if (near(i)) out[i] = 1;
    return out;
  }
  const seen = new Uint8Array(total);
  const stack: number[] = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    out[i] = 1;
    const x = i % width;
    const y = (i / width) | 0;
    // 只走 4 邻域：对角连通会让魔棒顺着斜向细缝漏出去，整张图被吃掉
    if (x > 0 && !seen[i - 1] && near(i - 1)) {
      seen[i - 1] = 1;
      stack.push(i - 1);
    }
    if (x < width - 1 && !seen[i + 1] && near(i + 1)) {
      seen[i + 1] = 1;
      stack.push(i + 1);
    }
    if (y > 0 && !seen[i - width] && near(i - width)) {
      seen[i - width] = 1;
      stack.push(i - width);
    }
    if (y < height - 1 && !seen[i + width] && near(i + width)) {
      seen[i + width] = 1;
      stack.push(i + width);
    }
    if (diagonal) {
      const cand = [i - width - 1, i - width + 1, i + width - 1, i + width + 1];
      for (const j of cand) {
        if (j < 0 || j >= total) continue;
        if (Math.abs((j % width) - x) !== 1) continue;
        if (seen[j] || !near(j)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return out;
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

  // 背景判定：只把「和画布边缘 / 选区边界连通、而且是一整块够大的白色」当背景。
  // 1) 旧写法把所有够白的像素都判成空格 → 人物脸上的高光、白衣服、眼睛反光
  //    全被挖成洞，这就是「中间还是会有不显示色号的部分」。
  // 2) 只做连通扩散还不够：缩图时白背景会顺着细缝渗进图案内部，形成一条条白脉，
  //    把整块图案蛀空。所以先给候选白做连通块标记，只有「从边界能走到、且面积
  //    不小于总面积 0.05%」的块才算背景，细白脉会被当成普通像素去配色。
  // 3) 用户框选之后，「选区边界」也算扩散起点：框内的白底只要挨着框边就会被吃掉，
  //    而被人围住的白（脸、手、白衣服）留着 —— 既有「框内全部有颜色」，
  //    又不会把框里整片白都算成豆子。
  const mask0 = opts.mask && opts.mask.length === total ? opts.mask : null;

  // 带透明通道的图（在抠图网站导出透明 PNG 再拖进来）直接算抠掉。
  // 用户不需要为了「透明背景」再手动框选一次。
  let alphaCut = false;
  for (let i = 0; i < total; i++) {
    if (alpha[i] < 128) {
      alphaCut = true;
      break;
    }
  }
  let mask = mask0;
  if (alphaCut) {
    const m = mask0 ? new Uint8Array(mask0) : new Uint8Array(total).fill(1);
    for (let i = 0; i < total; i++) if (alpha[i] < 128) m[i] = 0;
    mask = m;
  }

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
    const seeds = new Uint8Array(total);
    const seedAt = (i: number) => {
      if (cand[i]) seeds[i] = 1;
    };
    for (let x = 0; x < width; x++) {
      seedAt(x);
      seedAt((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      seedAt(y * width);
      seedAt(y * width + width - 1);
    }
    if (mask) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (!mask[i]) continue;
          const onSelEdge =
            (x > 0 && !mask[i - 1]) ||
            (x < width - 1 && !mask[i + 1]) ||
            (y > 0 && !mask[i - width]) ||
            (y < height - 1 && !mask[i + width]);
          if (onSelEdge) seedAt(i);
        }
      }
    }
    const minArea = Math.max(6, Math.floor(total * 0.0005));
    const seen = new Uint8Array(total);
    const stack: number[] = [];
    const region: number[] = [];
    for (let s = 0; s < total; s++) {
      if (!seeds[s] || seen[s]) continue;
      region.length = 0;
      stack.length = 0;
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        region.push(i);
        const x = i % width;
        const y = (i / width) | 0;
        if (x > 0 && cand[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
        if (x < width - 1 && cand[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
        if (y > 0 && cand[i - width] && !seen[i - width]) { seen[i - width] = 1; stack.push(i - width); }
        if (y < height - 1 && cand[i + width] && !seen[i + width]) { seen[i + width] = 1; stack.push(i + width); }
      }
      if (region.length >= minArea) {
        for (const i of region) isBg[i] = 1;
      }
    }
  }

  const palette = opts.palette;
  const pl: PaletteLab = buildPaletteLab(palette);
  const cells = new Uint16Array(total);
  if (!palette.length) return { cells, palette, usedCount: 0 };

  // 用户手抠的范围优先于自动白底：抠掉的格子既不配色也不算颗数
  if (mask) {
    for (let i = 0; i < total; i++) if (!mask[i]) isBg[i] = 1;
  }

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

  // 去零散单颗：四面邻居都是同一个色号时并过去。
  // 抖动留下的孤立点最费眼、也最吃豆子，清两遍就基本干净了。
  if (opts.speckle) {
    const nb = [0, 0, 0, 0];
    for (let pass = 0; pass < 2; pass++) {
      let changed = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;
          const c = cells[i];
          if (!c) continue;
          nb[0] = cells[i - 1];
          nb[1] = cells[i + 1];
          nb[2] = cells[i - width];
          nb[3] = cells[i + width];
          if (!nb[0] || nb[0] !== nb[1] || nb[0] !== nb[2] || nb[0] !== nb[3]) continue;
          if (nb[0] === c) continue;
          cells[i] = nb[0];
          changed++;
        }
      }
      if (!changed) break;
    }
    used.clear();
    for (let i = 0; i < total; i++) if (cells[i] > 0) used.add(cells[i] - 1);
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
