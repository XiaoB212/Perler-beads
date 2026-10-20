import jsPDF from 'jspdf';
import type { BeadColor, PatternDoc, ProjectFile } from './types';
import { readableTextColor } from './color';
import { rleDecode, rleDecodeU8, rleEncode } from './rle';
import { downloadBlob, downloadText, safeFileName } from './util';
import { blobToBytes, buildZip, textToBytes } from './zip';
import { getDefaultPrice } from './cost';
import { PEGBOARD_PRESETS } from './board';
import { qrPixelSize, qrSvgGroup, renderQrCanvas } from './qr';

export interface RenderOptions {
  cellSize: number;
  grid: boolean;
  coords: boolean;
  background: string | null;
  holes: boolean;
  showCodes: boolean;
  dimUnplaced: boolean;
  title?: string;
  /** 分板导出：每 boardSize 格切一块实体板；0 = 不分板 */
  boardSize?: number;
  /** 板与板之间的空隙，单位是「格宽」 */
  boardGap?: number;
  /** 按进度上色：已拼的按真实颜色画，未拼的淡化，导出时一眼看出拼到哪 */
  progressStyle?: 'none' | 'placed';
  /** 在图下方附一条色号用量表（色块 + 色号 + 颗数） */
  legend?: boolean;
  /** 底部水印，默认带项目名与地址 */
  watermark?: boolean;
  watermarkText?: string;
  watermarkUrl?: string;
  /** SVG 打开时铺满窗口并居中显示 */
  fitWindow?: boolean;
  /** 豆子形状：方格（默认）或圆格 */
  shape?: 'square' | 'circle';
  /**
   * 在导出件上印一张二维码。分享链接动辄几百上千字符，扫码比复制粘贴稳，
   * 所以导出件默认带一张指向项目的二维码。
   */
  qr?: boolean;
  /** 二维码内容，默认就是水印地址 */
  qrText?: string;
}

/** 默认水印文案与地址，导出面板里可以改 */
export const DEFAULT_WATERMARK_TEXT = '本图纸由 XiaoB212 的 Perler-beads 生成';
export const DEFAULT_WATERMARK_URL = 'https://xiaob212.github.io/Perler-beads/';

export const DEFAULT_RENDER: RenderOptions = {
  cellSize: 24,
  grid: true,
  coords: true,
  background: '#ffffff',
  holes: true,
  showCodes: false,
  dimUnplaced: false,
  boardSize: 0,
  boardGap: 1.2,
  legend: true,
  watermark: true,
  watermarkText: DEFAULT_WATERMARK_TEXT,
  watermarkUrl: DEFAULT_WATERMARK_URL,
  fitWindow: true,
  shape: 'square',
  qr: true,
};

/** 色号用量：按颗数从多到少排，跳过色板里没用到的项 */
export function usageRows(doc: PatternDoc): { color: BeadColor; count: number }[] {
  const map = new Map<number, number>();
  for (let i = 0; i < doc.cells.length; i++) {
    const v = doc.cells[i];
    if (!v) continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([v, count]) => ({ color: doc.palette[v - 1], count }))
    .filter((r) => r.color)
    .sort((a, b) => b.count - a.count);
}

/** 用量表排版：按可用宽度决定列数，返回列宽、行高与总高（单位与传入一致） */
function legendMetrics(rows: number, availW: number, scale = 1) {
  const minCol = 132 * scale;
  const cols = Math.max(1, Math.min(8, Math.floor(availW / minCol)));
  const colW = availW / Math.max(1, cols);
  const rowH = 27 * scale;
  const headH = rows > 0 ? 30 * scale : 0;
  return { cols, colW, rowH, headH, height: headH + Math.ceil(rows / cols) * rowH + 10 * scale };
}

/**
 * 用量表 / 水印的缩放系数。
 *
 * 以前只按「单格像素」算，并且夹在 1.6 以内。问题是 SVG 在浏览器里是铺满窗口打开的：
 * 一张 6000px 宽的图会被缩到 0.13 倍，底部那颗数在屏幕上只剩一两像素，用户根本看不清
 * （「svg 的那个数量在最下面太小了，看不清数量，我弄的这个应该是 68946 格」）。
 *
 * 所以除了单格像素，还要让缩放跟着「整张图有多宽」一起长 —— 这样用量表始终占整图
 * 大约十分之一的宽度，缩到窗口里也读得清。小图取两者较大值，行为和以前一致。
 */
function legendScaleFor(cs: number, bodyW: number, minScale: number, maxCellScale: number): number {
  const byCell = Math.max(minScale, Math.min(maxCellScale, cs / 18));
  const byImage = Math.min(40, bodyW / 900);
  return Math.max(byCell, byImage);
}

/** 水印占用的高度 */
function watermarkHeight(scale = 1) {
  return 24 * scale;
}

/**
 * 市面常见拼豆板尺寸（5mm 豆）。
 * 直接复用 board.ts 的 PEGBOARD_PRESETS，避免「导出面板列 8 档、设置里列 12 档」
 * 这种同一个概念两套数据源的老毛病。
 */
export const BOARD_PRESETS: { value: number; label: string }[] = PEGBOARD_PRESETS.map((p) => ({
  value: p.value,
  label: p.note ? `${p.label} ${p.note}` : p.label,
}));

/** 分板后的坐标偏移（单位：格） */
function boardOffsets(count: number, boardSize: number, gap: number) {
  const bs = boardSize > 0 ? boardSize : 0;
  const offsets = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    offsets[i] = bs ? i + Math.floor(i / bs) * gap : i;
  }
  const last = count > 0 ? offsets[count - 1] : 0;
  return { offsets, span: last + 1 };
}

/** 分板布局：返回每格在「格坐标系」里的位置，以及整张图占多少格 */
export function boardLayout(doc: PatternDoc, boardSize = 0, gap = 1.2) {
  const xs = boardOffsets(doc.width, boardSize, gap);
  const ys = boardOffsets(doc.height, boardSize, gap);
  return {
    x: xs.offsets,
    y: ys.offsets,
    spanX: xs.span,
    spanY: ys.span,
    boardSize,
    cols: boardSize > 0 ? Math.ceil(doc.width / boardSize) : 1,
    rows: boardSize > 0 ? Math.ceil(doc.height / boardSize) : 1,
  };
}

/** 板编号：A1、A2 … 按行优先 */
export function boardLabel(col: number, row: number) {
  return `${String.fromCharCode(65 + (row % 26))}${col + 1}`;
}

/**
 * 网格线的位置（单位：格）。
 *
 * 这里必须和格子的坐标用同一套 lay.x / lay.y —— 之前网格线是按「均匀 1 格」画的，
 * 而分板时格子之间还夹着 1.2 格的板缝，于是第 2 块板往后的线全都比格子偏一点，
 * 用户看到的就是「方格偏差」「网格线偏了」。3×3 板时第 64 格那条线偏了 28.8px。
 *
 * 返回的每个值都是某条竖线的格坐标；板与板之间的缝隙里没有线（缝隙本身要留白）。
 */
export function gridLinePositions(count: number, boardSize: number, gap: number): number[] {
  if (count <= 0) return [];
  const { offsets } = boardOffsets(count, boardSize, gap);
  const seen = new Set<number>();
  const out: number[] = [];
  const push = (v: number) => {
    const k = Math.round(v * 1000) / 1000;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  // 每格要画「左边界 + 右边界」两条线。只画左边界的话，每块板的最后一列/行
  // 就没有收边线，看上去像少画了一块板（用户说的「导出缺 A1 板」就是这个）。
  for (let i = 0; i < count; i++) {
    push(offsets[i]);
    push(offsets[i] + 1);
  }
  out.sort((a, b) => a - b);
  return out;
}

/** 每 5 格加深的线（同样要跟着板缝走，否则又会错位） */
export function gridStrongPositions(count: number, boardSize: number, gap: number, step = 5): number[] {
  if (count <= 0 || step <= 0) return [];
  const { offsets } = boardOffsets(count, boardSize, gap);
  const out: number[] = [];
  if (boardSize > 0) {
    // 分板时：每块板从自己的起点数 5 / 10 / 15 …，板边界单独画，避免线穿板
    for (let start = 0; start < count; start += boardSize) {
      const end = Math.min(count, start + boardSize);
      out.push(offsets[start]);
      for (let o = step; o < end - start; o += step) out.push(offsets[start + o]);
    }
    out.push(offsets[count - 1] + 1);
  } else {
    for (let i = 0; i <= count; i += step) out.push(i);
  }
  return out;
}

function inkFor(hex: string): string {
  return readableTextColor(hex);
}

/**
 * 一张图的全部排版数字（纯计算，不建 canvas）。
 *
 * 抽出来的原因：以前 cellSize 直接决定画布尺寸，用量表 / 抬头 / 水印这些「固定像素」
 * 是不跟着缩的，所以先按单边 16384 算出「安全单格」，真实画布却比它大得多 ——
 * 147×147 格、单格 128 时会算出 16377×20237（3.3 亿像素），Chrome 直接分配失败，
 * canvas.toBlob 回调里拿到 null，于是「点了下载、开始下载、却永远没有文件」。
 * 现在渲染前先量一次尺寸，超预算就把单格压下来重新量，直到真的放得下。
 */
export interface PatternLayout {
  cs: number;
  bs: number;
  gap: number;
  lay: ReturnType<typeof boardLayout>;
  spanW: number;
  spanH: number;
  padTopBase: number;
  padLeft: number;
  pad: number;
  headH: number;
  padTop: number;
  gridW: number;
  gridH: number;
  padRight: number;
  padBottom: number;
  bodyW: number;
  detailed: boolean;
  rows: { color: BeadColor; count: number }[];
  legendScale: number;
  leg: ReturnType<typeof legendMetrics> | null;
  wmH: number;
  qrText: string;
  qrMod: number;
  qrPx: number;
  footH: number;
  w: number;
  h: number;
}

export function patternLayout(doc: PatternDoc, opts: RenderOptions, cellSize: number): PatternLayout {
  const cs = Math.max(0.35, cellSize);
  const bs = opts.boardSize ?? 0;
  const gap = opts.boardGap ?? 1.2;
  const lay = boardLayout(doc, bs, gap);
  const spanW = lay.spanX;
  const spanH = lay.spanY;
  const padTopBase = opts.coords ? Math.max(18, cs * 1.1) : 6;
  const padLeft = opts.coords ? Math.max(20, cs * 1.2) : 6;
  const pad = 8;
  // 带标题时在最上面留一条抬头，用来标明这是哪一块板（一板一页导出用）
  const headH = opts.title ? Math.max(28, cs * 1.8) : 0;
  const padTop = headH + padTopBase;
  const gridW = spanW * cs;
  const gridH = spanH * cs;
  // 左右、上下留白对称，图纸落在画面正中间，不贴左上角
  const padRight = Math.max(pad, padLeft);
  const padBottom = Math.max(pad, padTopBase);
  const bodyW = padLeft + gridW + padRight;

  // 缩略图尺寸下（cs < 6）用量表会挤成一团，直接不画
  const detailed = cs >= 6;
  const rows = opts.legend && detailed ? usageRows(doc) : [];
  const legendScale = legendScaleFor(cs, bodyW, 0.55, 1.35);
  const leg = opts.legend && detailed ? legendMetrics(rows.length, bodyW - pad * 2, legendScale) : null;
  const wmH = opts.watermark && detailed ? watermarkHeight(legendScale) : 0;
  // 二维码：塞在右下角，跟水印同一行。链接几百上千字符时扫码比复制粘贴可靠得多。
  const qrText = opts.qrText || opts.watermarkUrl || DEFAULT_WATERMARK_URL;
  const qrMod = Math.max(2, Math.round(2 * legendScale));
  const qrPx = opts.qr && detailed ? qrPixelSize(qrText, qrMod, 2) : 0;
  const footH = Math.max(wmH, qrPx);

  return {
    cs, bs, gap, lay, spanW, spanH, padTopBase, padLeft, pad, headH, padTop,
    gridW, gridH, padRight, padBottom, bodyW, detailed, rows, legendScale, leg,
    wmH, qrText, qrMod, qrPx, footH,
    w: bodyW,
    h: padTop + gridH + padBottom + (leg ? leg.height : 0) + footH,
  };
}

/**
 * 把单格像素压到一个真能画出来的尺寸。
 * 单边 16384 是 Chrome 的硬上限；总面积再压到 3200 万（≈128MB 位图），
 * 超过这个量级 toBlob 会静默失败，反而更糟。
 */
export const MAX_EXPORT_EDGE = 16384;
export const MAX_EXPORT_AREA = 32_000_000;

export function fitCellSize(
  doc: PatternDoc,
  opts: RenderOptions,
  want: number,
  maxEdge = MAX_EXPORT_EDGE,
  maxArea = MAX_EXPORT_AREA,
): number {
  let cs = Math.max(0.35, want);
  for (let i = 0; i < 12; i++) {
    const g = patternLayout(doc, opts, cs);
    const k = Math.min(1, maxEdge / Math.max(1, g.w), maxEdge / Math.max(1, g.h), Math.sqrt(maxArea / Math.max(1, g.w * g.h)));
    if (k >= 0.999) return cs;
    const next = Math.max(0.35, cs * k * 0.985);
    if (Math.abs(next - cs) < 0.01) return next;
    cs = next;
  }
  return cs;
}

/** 主渲染：把图纸画到 canvas（可选底部用量表与水印） */
export function renderPatternCanvas(doc: PatternDoc, opts: RenderOptions): HTMLCanvasElement {
  const cs = fitCellSize(doc, opts, Math.max(0.35, opts.cellSize));
  return renderPatternCanvasAt(doc, opts, cs);
}

/** 按指定单格渲染（调用方已经算好尺寸时用，避免重复测量） */
export function renderPatternCanvasAt(doc: PatternDoc, opts: RenderOptions, cellSize: number): HTMLCanvasElement {
  const { width, height, cells, palette } = doc;
  const L = patternLayout(doc, opts, cellSize);
  const {
    cs, bs, gap, lay, spanW, spanH, padTopBase, padLeft, pad, headH, padTop,
    gridW, gridH, padRight, padBottom, bodyW, detailed, rows, legendScale, leg,
    qrText, qrMod, qrPx, footH, w, h,
  } = L;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d')!;
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }

  // 抬头：一板一页导出时标明这是哪一块板，打印出来好对号
  if (opts.title && headH > 0) {
    const ts = Math.max(13, Math.min(Math.round(cs * 0.95), 30));
    ctx.font = `700 ${ts}px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#12141d';
    ctx.fillText(opts.title, padLeft, headH * 0.55 + ts * 0.36);
    ctx.strokeStyle = 'rgba(20,24,30,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, headH - 1.5);
    ctx.lineTo(w - padRight, headH - 1.5);
    ctx.stroke();
  }

  // 格子底色
  const progressMode = opts.progressStyle === 'placed';
  const roundCell = opts.shape === 'circle';
  const beadR = (cs / 2) * 0.94;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const v = cells[idx];
      if (!v) continue;
      const c = palette[v - 1];
      if (!c) continue;
      const px = padLeft + lay.x[x] * cs;
      const py = padTop + lay.y[y] * cs;
      // 未拼的按 22% 透明度画，已拼的保持原色，扫一眼就知道拼到哪
      const done = !progressMode || doc.progress[idx] === 1;
      ctx.globalAlpha = done ? 1 : 0.22;
      ctx.fillStyle = c.hex;
      if (roundCell) {
        ctx.beginPath();
        ctx.arc(px + cs / 2, py + cs / 2, beadR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(px, py, cs, cs);
      }
      ctx.globalAlpha = 1;
      if (opts.holes && cs >= 9 && !(opts.showCodes && cs >= 9)) {
        ctx.beginPath();
        ctx.arc(px + cs / 2, py + cs / 2, Math.max(0.8, cs * 0.13), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.62)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.14)';
        ctx.lineWidth = Math.max(0.4, cs * 0.03);
        ctx.stroke();
      }
      if (opts.showCodes && cs >= 9 && done) {
        // 色号直接印在豆子颜色上，不垫底色块、也不描边。
        // 描边版在 9~14px 的小字上会糊成一团（用户反馈「看起来模糊」），
        // 所以只保留填充，字色按豆子亮度在深墨/白之间取其一。
        const fs = Math.min(cs * 0.5, (cs * 0.88) / Math.max(1, c.code.length * 0.62), 15);
        if (fs >= 4.6) {
          ctx.font = `600 ${fs.toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // 对齐整数像素，避免 Canvas 对小字号做灰度插值
          const cx = Math.round(px + cs / 2);
          const cy = Math.round(py + cs / 2);
          ctx.fillStyle = readableTextColor(c.hex);
          ctx.fillText(c.code, cx, cy);
        }
      }
    }
  }

  // 网格线
  if (opts.grid) {
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const gx of gridLinePositions(width, bs, gap)) {
      const px = padLeft + gx * cs;
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, padTop + gridH);
    }
    for (const gy of gridLinePositions(height, bs, gap)) {
      const py = padTop + gy * cs;
      ctx.moveTo(padLeft, py);
      ctx.lineTo(padLeft + gridW, py);
    }
    ctx.stroke();
  }

  // 分板：只在板与板的接缝画一条稍深的细线，板号用低调的灰字。
  // 以前每块板都描一圈橙色框 + 橙色板号，256 块板时整张图像铺满橙色网格，
  // 用户直接说「人家 81 块板就那么好看了，我们 256 块板就这样」。
  if (bs > 0) {
    ctx.strokeStyle = 'rgba(40,44,54,0.42)';
    ctx.lineWidth = Math.max(1, cs * 0.06);
    ctx.beginPath();
    for (let rx = 1; rx < lay.cols; rx++) {
      const px = padLeft + rx * (bs + gap) * cs - (gap * cs) / 2;
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, padTop + gridH);
    }
    for (let ry = 1; ry < lay.rows; ry++) {
      const py = padTop + ry * (bs + gap) * cs - (gap * cs) / 2;
      ctx.moveTo(padLeft, py);
      ctx.lineTo(padLeft + gridW, py);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(40,44,54,0.62)';
    ctx.lineWidth = Math.max(1.2, cs * 0.08);
    ctx.strokeRect(padLeft, padTop, gridW, gridH);

    // 板号：只在格够大时画，灰色小字，压在豆子上也读得清
    const bfs = Math.max(8, Math.min(13, cs * 0.5));
    if (bfs >= 8 && cs >= 7) {
      ctx.font = `600 ${bfs.toFixed(1)}px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (let ry = 0; ry < lay.rows; ry++) {
        for (let rx = 0; rx < lay.cols; rx++) {
          const px = padLeft + rx * (bs + gap) * cs + 2;
          const py = padTop + ry * (bs + gap) * cs + 1.5;
          const label = boardLabel(rx, ry);
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,0.72)';
          ctx.strokeText(label, px, py);
          ctx.fillStyle = 'rgba(60,64,74,0.72)';
          ctx.fillText(label, px, py);
        }
      }
    }
  } else if (opts.grid) {
    // 每 5 格加深（同样跟着 lay 走，分板时也能对齐）
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (const gx of gridStrongPositions(width, bs, gap)) {
      const px = padLeft + gx * cs;
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, padTop + gridH);
    }
    for (const gy of gridStrongPositions(height, bs, gap)) {
      const py = padTop + gy * cs;
      ctx.moveTo(padLeft, py);
      ctx.lineTo(padLeft + gridW, py);
    }
    ctx.stroke();
  }

  // 坐标
  if (opts.coords) {
    const fs = Math.max(7, Math.min(11, cs * 0.62));
    ctx.font = `500 ${fs}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let x = 0; x < width; x++) {
      if (x % 5 !== 0) continue;
      const px = padLeft + lay.x[x] * cs + cs / 2;
      ctx.fillText(String(x + 1), px, headH + padTopBase / 2 + 1);
    }
    ctx.textAlign = 'right';
    for (let y = 0; y < height; y++) {
      if (y % 5 !== 0) continue;
      const py = padTop + lay.y[y] * cs + cs / 2;
      ctx.fillText(String(y + 1), padLeft - 4, py);
    }
  }

  // 用量表：色块里写色号 + 颗数
  let cursorY = padTop + gridH + pad;
  if (leg && rows.length) {
    const total = rows.reduce((s, r) => s + r.count, 0);
    const s = legendScale;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.font = `600 ${Math.round(13 * s)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
    ctx.fillText('色号用量', pad, cursorY + 12 * s);
    ctx.font = `500 ${Math.round(11 * s)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.textAlign = 'right';
    ctx.fillText(`${rows.length} 色 · ${total} 颗`, w - pad, cursorY + 12 * s);
    cursorY += leg.headH;

    rows.forEach(({ color, count }, i) => {
      const col = i % leg.cols;
      const line = Math.floor(i / leg.cols);
      const x = pad + col * leg.colW;
      const y = cursorY + line * leg.rowH;
      // 色块要够大，色号才印得清
      const sw = 34 * s;
      const sh = 20 * s;
      ctx.fillStyle = color.hex;
      ctx.fillRect(x, y, sw, sh);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x + 0.4, y + 0.4, sw - 0.8, sh - 0.8);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 色号亮度自适应：浅色豆子用深字，深色豆子用白字
      ctx.fillStyle = inkFor(color.hex);
      ctx.font = `700 ${Math.round(11 * s)}px ui-monospace, monospace`;
      ctx.fillText(color.code, x + sw / 2, y + sh / 2 + 0.4);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.font = `600 ${Math.round(13 * s)}px ui-monospace, monospace`;
      ctx.fillText(`${count}`, x + sw + 6 * s, y + sh / 2 + 0.4);
    });
    cursorY += Math.ceil(rows.length / leg.cols) * leg.rowH + 8 * s;
  }

  // 水印：只留署名文字，地址交给右下角的二维码
  if (opts.watermark && detailed) {
    const s = legendScale;
    const text = opts.watermarkText || DEFAULT_WATERMARK_TEXT;
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(pad, cursorY + 2);
    ctx.lineTo(w - pad, cursorY + 2);
    ctx.stroke();
    // 二维码占右边一块，文字就别铺到它身上
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.font = `400 ${Math.round(8.4 * s)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
    ctx.fillText(text, pad, cursorY + footH * 0.42);
  }

  // 二维码：右下角一枚，扫码就能打开项目 / 分享的图纸
  if (qrPx > 0 && footH > 0) {
    const qr = renderQrCanvas(qrText, { moduleSize: qrMod, margin: 2 });
    if (qr) ctx.drawImage(qr, w - pad - qrPx, cursorY + (footH - qrPx) / 2);
  }

  // 用量表 / 水印区域在缩略图尺寸下会被压得看不清，干脆不画
  return canvas;
}

/**
 * 粗算安全单格（只知道格子数、不知道排版时用）。
 * 真正的渲染还会用 fitCellSize 按实际排版再收一次，这里只是个保守的起步值。
 */
export function safeCellSize(width: number, height: number, want: number, pad = 64): number {
  const byEdge = Math.min(MAX_EXPORT_EDGE / Math.max(1, width), MAX_EXPORT_EDGE / Math.max(1, height));
  const byArea = Math.sqrt(MAX_EXPORT_AREA / Math.max(1, width * height));
  return Math.max(0.5, Math.min(want, byEdge, byArea, (MAX_EXPORT_EDGE - pad) / Math.max(1, Math.max(width, height))));
}

/** canvas → PNG blob，带兜底：超大画布上 toBlob 可能既不回调也不报错 */
function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (b: Blob | null) => {
      if (done) return;
      done = true;
      resolve(b);
    };
    try {
      canvas.toBlob((b) => finish(b), 'image/png');
    } catch {
      finish(null);
    }
    setTimeout(() => finish(null), 20000);
  });
}

export interface PngResult {
  width: number;
  height: number;
  bytes: number;
  cellSize: number;
}

/**
 * 导出 PNG。
 *
 * 以前这里是「算个安全单格 → 画 → toBlob 里 if (blob) 才下载」，画布超限时 toBlob
 * 回调拿到 null，于是用户看到浏览器开始下载、却永远没有文件，也没有任何提示。
 * 现在：先按真实排版压尺寸 → 失败就把分辨率降一档重试 → 还失败就抛出能给用户看的错误。
 */
export async function exportPNG(doc: PatternDoc, opts: RenderOptions): Promise<PngResult> {
  let cs = fitCellSize(doc, opts, Math.max(0.35, opts.cellSize));
  let canvas = renderPatternCanvasAt(doc, opts, cs);
  let blob = await canvasToPngBlob(canvas);
  if (!blob) {
    cs = Math.max(0.35, cs * 0.6);
    canvas = renderPatternCanvasAt(doc, opts, cs);
    blob = await canvasToPngBlob(canvas);
  }
  if (!blob) {
    throw new Error(`画布 ${canvas.width}×${canvas.height} 太大，浏览器生成不了这张图片，请把单格像素调小一点`);
  }
  downloadBlob(blob, `${safeFileName(doc.name)}.png`);
  return { width: canvas.width, height: canvas.height, bytes: blob.size, cellSize: cs };
}

export function buildSVG(doc: PatternDoc, opts: RenderOptions): string {
  const { width, height, cells, palette } = doc;
  // 排版数字全部走和 PNG 同一个 patternLayout：以前 SVG 自己算一套
  // （padding 写死 22/26、用量表缩放 0.8~1.6），同一个设置导出来
  // 色号、坐标、用量表的位置和 PNG / PDF 预览对不上。
  const L = patternLayout(doc, opts, Math.max(2, opts.cellSize));
  const { cs, bs, gap, lay, spanW, spanH, padLeft, pad, headH, padTop, gridW, gridH, padRight, padBottom } = L;
  const rows = L.rows;
  const s = L.legendScale;
  const leg = L.leg;
  const qrText = L.qrText;
  const qrPx = L.qrPx;
  const footH = L.footH;
  const w = L.w;
  const h = L.h;
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  // fitWindow：直接用百分比宽高，浏览器打开就按窗口铺满并居中，不再贴在左上角
  if (opts.fitWindow) {
    out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" font-family="ui-monospace, Menlo, monospace">`,
    );
    out.push(
      `<style>html,body{margin:0;height:100%;background:#fff}svg{display:block}</style>`,
    );
  } else {
    out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="ui-monospace, Menlo, monospace">`,
    );
  }
  out.push(`<title>${escapeXml(opts.title || doc.name)}</title>`);
  if (opts.background) out.push(`<rect width="${w}" height="${h}" fill="${opts.background}"/>`);
  // 抬头：和 PNG 一样，一板一张时标明这是哪一块板
  if (opts.title && headH > 0) {
    const ts = Math.max(13, Math.min(Math.round(cs * 0.95), 30));
    out.push(`<g id="head">`);
    out.push(
      `<text x="${padLeft}" y="${(headH * 0.55 + ts * 0.36).toFixed(2)}" font-size="${ts}" font-weight="700" fill="#12141d" font-family="'PingFang SC','Microsoft YaHei','Noto Sans SC',system-ui,sans-serif">${escapeXml(opts.title)}</text>`,
    );
    out.push(
      `<line x1="${padLeft}" y1="${headH - 1.5}" x2="${w - padRight}" y2="${headH - 1.5}" stroke="rgba(20,24,30,0.22)" stroke-width="1"/>`,
    );
    out.push(`</g>`);
  }
  out.push(`<g id="cells">`);
  const progressModeSvg = opts.progressStyle === 'placed';
  const roundCell = opts.shape === 'circle';
  const rad = (cs / 2) * 0.94;
  /**
   * 按「色号 + 是否已拼」分组，每组合并成一条 <path>。
   * 以前是每颗豆子一个 <rect>：6.9 万格就是 6.9 万个节点、11MB 的 SVG，
   * 浏览器一打开就卡。合并之后同样的图只剩几十条 path，体积降到几百 KB。
   */
  const cellGroups = new Map<string, { fill: string; op: number; d: string[] }>();
  const holeGroups = new Map<number, string[]>();
  const codeTexts: string[] = [];
  const f2 = (n: number) => Number(n.toFixed(2));
  // 中孔/圆格半径保留一位小数就够了：6.9 万格时能省下 1MB 多，肉眼看不出来
  const fr = (n: number) => Number(n.toFixed(1));
  const circlePath = (cx: number, cy: number, r: number) =>
    `M${f2(cx - r)} ${f2(cy)}a${fr(r)} ${fr(r)} 0 1 0 ${fr(2 * r)} 0a${fr(r)} ${fr(r)} 0 1 0 ${fr(-2 * r)} 0`;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const v = cells[idx];
      if (!v) continue;
      const c = palette[v - 1];
      if (!c) continue;
      const px = padLeft + lay.x[x] * cs;
      const py = padTop + lay.y[y] * cs;
      // 按进度上色：已拼保持原色，未拼淡化
      const done = !progressModeSvg || doc.progress[idx] === 1;
      const key = v + ':' + (done ? 1 : 0);
      let g = cellGroups.get(key);
      if (!g) {
        g = { fill: c.hex, op: done ? 1 : 0.22, d: [] };
        cellGroups.set(key, g);
      }
      g.d.push(roundCell ? circlePath(px + cs / 2, py + cs / 2, rad) : `M${px} ${py}h${cs}v${cs}h${-cs}z`);

      if (opts.holes && cs >= 8 && !(opts.showCodes && cs >= 9)) {
        const o = done ? 0.62 : 0.14;
        const arr = holeGroups.get(o);
        const p = circlePath(px + cs / 2, py + cs / 2, cs * 0.13);
        if (arr) arr.push(p);
        else holeGroups.set(o, [p]);
      }
      if (opts.showCodes && cs >= 9 && done) {
        // 纯填充，不做描边：小字号描边会糊成一团，用户反馈「看起来很模糊」
        const fs = Math.min(cs * 0.5, (cs * 0.88) / Math.max(1, c.code.length * 0.62), 15);
        if (fs >= 4.6) {
          codeTexts.push(
            `<text x="${f2(px + cs / 2)}" y="${f2(py + cs / 2 + fs * 0.34)}" text-anchor="middle" font-size="${fs.toFixed(1)}" font-weight="600" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" fill="${inkFor(c.hex)}">${escapeXml(c.code)}</text>`,
          );
        }
      }
    }
  }
  for (const g of cellGroups.values()) {
    const op = g.op === 1 ? '' : ` fill-opacity="${g.op}"`;
    out.push(`<path d="${g.d.join('')}" fill="${g.fill}"${op}/>`);
  }
  // 中孔在所有豆子之上，否则会被后画的豆子盖掉
  for (const [o, arr] of holeGroups) {
    out.push(`<path d="${arr.join('')}" fill="#ffffff" fill-opacity="${o}"/>`);
  }
  out.push(`</g>`);
  if (codeTexts.length) {
    out.push(`<g id="codes">`);
    // 不要用 out.push(...codeTexts)：6 万多个色号时展开参数会直接
    // "Maximum call stack size exceeded"，导出面板只弹一句「导出失败，请重试」
    for (const t of codeTexts) out.push(t);
    out.push(`</g>`);
  }
  if (opts.grid) {
    out.push(`<g id="grid" stroke="rgba(0,0,0,0.18)" stroke-width="0.5">`);
    // 线坐标跟着 lay.x / lay.y 走，分板时才不会错位
    for (const gx of gridLinePositions(width, bs, gap)) {
      const px = padLeft + gx * cs;
      out.push(`<line x1="${px.toFixed(2)}" y1="${padTop}" x2="${px.toFixed(2)}" y2="${(padTop + gridH).toFixed(2)}"/>`);
    }
    for (const gy of gridLinePositions(height, bs, gap)) {
      const py = padTop + gy * cs;
      out.push(`<line x1="${padLeft}" y1="${py.toFixed(2)}" x2="${(padLeft + spanW * cs).toFixed(2)}" y2="${py.toFixed(2)}"/>`);
    }
    out.push(`</g>`);
  }
  // 分板：只在接缝画细线 + 灰色板号（同 PNG 的克制画法）
  if (bs > 0) {
    out.push(`<g id="boards" fill="none" stroke="rgba(40,44,54,0.42)" stroke-width="${Math.max(1, cs * 0.06).toFixed(2)}">`);
    for (let rx = 1; rx < lay.cols; rx++) {
      const px = padLeft + rx * (bs + gap) * cs - (gap * cs) / 2;
      out.push(`<line x1="${px}" y1="${padTop}" x2="${px}" y2="${padTop + gridH}"/>`);
    }
    for (let ry = 1; ry < lay.rows; ry++) {
      const py = padTop + ry * (bs + gap) * cs - (gap * cs) / 2;
      out.push(`<line x1="${padLeft}" y1="${py}" x2="${padLeft + spanW * cs}" y2="${py}"/>`);
    }
    out.push(`</g>`);
    out.push(
      `<rect x="${padLeft}" y="${padTop}" width="${spanW * cs}" height="${gridH}" fill="none" stroke="rgba(40,44,54,0.62)" stroke-width="${Math.max(1.2, cs * 0.08).toFixed(2)}"/>`,
    );
    const bfs = Math.max(8, Math.min(13, cs * 0.5));
    if (cs >= 7) {
      out.push(
        `<g id="board-labels" font-size="${bfs.toFixed(1)}" font-weight="600" paint-order="stroke" stroke="#ffffff" stroke-opacity="0.72" stroke-width="3">`,
      );
      for (let ry = 0; ry < lay.rows; ry++) {
        for (let rx = 0; rx < lay.cols; rx++) {
          const px = padLeft + rx * (bs + gap) * cs + 2;
          const py = padTop + ry * (bs + gap) * cs + 1.5 + bfs;
          out.push(`<text x="${px}" y="${py}" fill="rgba(60,64,74,0.72)">${boardLabel(rx, ry)}</text>`);
        }
      }
      out.push(`</g>`);
    }
  }
  if (opts.coords) {
    out.push(`<g id="coords" fill="rgba(0,0,0,0.55)" font-size="${Math.max(7, Math.min(11, cs * 0.62))}">`);
    for (let x = 0; x < width; x++) {
      if (x % 5 !== 0) continue;
      out.push(
        `<text x="${padLeft + lay.x[x] * cs + cs / 2}" y="${padTop / 2 + 4}" text-anchor="middle">${x + 1}</text>`,
      );
    }
    for (let y = 0; y < height; y++) {
      if (y % 5 !== 0) continue;
      out.push(
        `<text x="${padLeft - 4}" y="${padTop + lay.y[y] * cs + cs / 2 + 4}" text-anchor="end">${y + 1}</text>`,
      );
    }
    out.push(`</g>`);
  }
  // 用量表：色块里直接写色号 + 颗数
  let cursorY = padTop + gridH + padBottom;
  if (leg && rows.length) {
    const total = rows.reduce((acc, r) => acc + r.count, 0);
    out.push(`<g id="legend">`);
    out.push(
      `<text x="${pad}" y="${cursorY + 12 * s}" font-size="${13 * s}" font-weight="600" fill="rgba(0,0,0,0.82)" font-family="'PingFang SC','Microsoft YaHei',system-ui,sans-serif">色号用量</text>`,
    );
    out.push(
      `<text x="${w - pad}" y="${cursorY + 12 * s}" font-size="${11 * s}" fill="rgba(0,0,0,0.5)" text-anchor="end">${rows.length} 色 · ${total} 颗</text>`,
    );
    cursorY += leg.headH;
    rows.forEach(({ color, count }, i) => {
      const col = i % leg.cols;
      const line = Math.floor(i / leg.cols);
      const x = pad + col * leg.colW;
      const y = cursorY + line * leg.rowH;
      // 色块放大到能印清色号
      const sw = 34 * s;
      const sh = 20 * s;
      out.push(
        `<rect x="${x}" y="${y}" width="${sw}" height="${sh}" fill="${color.hex}" stroke="rgba(0,0,0,0.2)" stroke-width="0.8"/>`,
      );
      // 色号写在色块里，字色按亮度反转
      out.push(
        `<text x="${x + sw / 2}" y="${y + sh / 2 + 4 * s}" font-size="${11 * s}" font-weight="700" font-family="ui-monospace,monospace" fill="${inkFor(color.hex)}" text-anchor="middle">${escapeXml(color.code)}</text>`,
      );
      out.push(
        `<text x="${x + sw + 6 * s}" y="${y + sh / 2 + 4 * s}" font-size="${13 * s}" font-weight="600" font-family="ui-monospace,monospace" fill="rgba(0,0,0,0.7)">${count}</text>`,
      );
    });
    out.push(`</g>`);
    cursorY += Math.ceil(rows.length / leg.cols) * leg.rowH + 8 * s;
  }
  // 水印：只留一行署名文字。地址不再重复印在纸上 —— 右下角的二维码
  // 扫一下就能打开同一个地址，印一串字符既占地方又容易被裁掉。
  if (opts.watermark) {
    const text = opts.watermarkText || DEFAULT_WATERMARK_TEXT;
    out.push(`<g id="watermark">`);
    out.push(
      `<line x1="${pad}" y1="${cursorY + 2}" x2="${w - pad}" y2="${cursorY + 2}" stroke="rgba(0,0,0,0.12)" stroke-width="0.7"/>`,
    );
    out.push(
      `<text x="${pad}" y="${cursorY + footH * 0.4}" font-size="${8.4 * s}" fill="rgba(0,0,0,0.5)" font-family="'PingFang SC','Microsoft YaHei',system-ui,sans-serif">${escapeXml(text)}</text>`,
    );
    out.push(`</g>`);
  }
  // 二维码：右下角，扫码直接打开项目 / 分享的图纸
  if (qrPx > 0) {
    const group = qrSvgGroup(qrText, w - pad - qrPx, cursorY + (footH - qrPx) / 2, qrPx, {
      moduleSize: Math.max(2, Math.round(2 * s)),
      margin: 2,
    });
    if (group) out.push(group);
  }
  out.push(`</svg>`);
  return out.join('\n');
}

export function exportSVG(doc: PatternDoc, opts: RenderOptions): { bytes: number } {
  const svg = buildSVG(doc, opts);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `${safeFileName(doc.name)}.svg`);
  return { bytes: blob.size };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);
}

export interface PdfOptions extends RenderOptions {
  pageSize: 'a4' | 'letter';
  orientation: 'portrait' | 'landscape' | 'auto';
  /**
   * single = 整张图纸缩放进一张纸（分板时画出板框与板号）
   * boards = 一块实体板一页，按板尺寸放大，可 1:1 打印
   */
  layout: 'single' | 'boards';
  withHeader: boolean;
}

export const DEFAULT_PDF: Omit<PdfOptions, 'title'> = {
  ...DEFAULT_RENDER,
  pageSize: 'a4',
  orientation: 'auto',
  layout: 'single',
  withHeader: true,
  cellSize: 16,
  // 图纸默认就印色号：用户拿到 PDF 是要照着拼的，没色号等于废纸
  showCodes: true,
};

function usageOf(doc: PatternDoc) {
  const map = new Map<number, number>();
  for (let i = 0; i < doc.cells.length; i++) {
    const v = doc.cells[i];
    if (!v) continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return map;
}

/**
 * jsPDF 内置的 helvetica 不含中文，直接 pdf.text 会输出乱码。
 * 含非 ASCII 的字符串先用 canvas 画成图片再贴进 PDF，保证中文正常。
 */
function pdfTextSafe(
  pdf: jsPDF,
  text: string,
  xMm: number,
  yMm: number,
  opts: { sizeMm: number; bold?: boolean; color?: [number, number, number]; align?: 'left' | 'right' | 'center' },
): number {
  const { sizeMm, bold = false, color = [24, 24, 32], align = 'left' } = opts;
  if (!/[^\x00-\x7f]/.test(text)) {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(sizeMm * 2.8346);
    pdf.setTextColor(color[0], color[1], color[2]);
    pdf.text(text, xMm, yMm, { align });
    return pdf.getTextWidth(text);
  }
  // 1mm ≈ 6px，保证打印清晰
  const px = 6;
  const fontPx = Math.max(10, sizeMm * px * 1.28);
  const pad = 4;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `${bold ? 600 : 400} ${fontPx}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
  const tw = Math.ceil(probe.measureText(text).width);
  const cw = tw + pad * 2;
  const ch = Math.ceil(fontPx * 1.5);
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d')!;
  ctx.font = probe.font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  ctx.fillText(text, pad, ch / 2);
  const wMm = cw / px;
  const hMm = ch / px;
  let x = xMm;
  if (align === 'right') x = xMm - wMm;
  else if (align === 'center') x = xMm - wMm / 2;
  pdf.addImage(cv.toDataURL('image/png'), 'PNG', x, yMm - hMm * 0.78, wMm, hMm);
  // 返回实际占位宽度（不含右侧留白），调用方可以紧跟着排下一段文字
  return tw / px;
}

/** 在 PDF 上按分板布局画整张图纸（含板框与板号） */
function pdfDrawPattern(
  pdf: jsPDF,
  doc: PatternDoc,
  opts: PdfOptions,
  cell: number,
  gridX: number,
  gridY: number,
  lay: ReturnType<typeof boardLayout>,
  bounds?: { x0: number; x1: number; y0: number; y1: number },
) {
  const bs = lay.boardSize;
  const gap = opts.boardGap ?? 1.2;
  const x0 = bounds ? bounds.x0 : 0;
  const x1 = bounds ? bounds.x1 : doc.width;
  const y0 = bounds ? bounds.y0 : 0;
  const y1 = bounds ? bounds.y1 : doc.height;
  // 局部坐标原点：一板一页时减去这块板的偏移
  const ox = lay.x[x0] ?? 0;
  const oy = lay.y[y0] ?? 0;

  const progressModePdf = opts.progressStyle === 'placed';
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * doc.width + x;
      const v = doc.cells[idx];
      if (!v) continue;
      const c = doc.palette[v - 1];
      if (!c) continue;
      const { r, g, b } = hexRgb(c.hex);
      const px = gridX + (lay.x[x] - ox) * cell;
      const py = gridY + (lay.y[y] - oy) * cell;
      const done = !progressModePdf || doc.progress[idx] === 1;
      pdf.setFillColor(r, g, b);
      if (opts.shape === 'circle') {
        pdf.circle(px + cell / 2, py + cell / 2, cell * 0.47, 'F');
      } else {
        pdf.rect(px, py, cell, cell, 'F');
      }
      if (!done) {
        // 未拼的盖一层白纱，打印出来明显比已拼的淡
        pdf.setFillColor(255, 255, 255);
        pdf.setGState(new (pdf as any).GState({ opacity: 0.72 }));
        if (opts.shape === 'circle') pdf.circle(px + cell / 2, py + cell / 2, cell * 0.47, 'F');
        else pdf.rect(px, py, cell, cell, 'F');
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));
      }
      if (opts.holes && cell >= 2.4 && !(opts.showCodes && cell >= 2.8)) {
        // 豆子中间那个孔。PNG / SVG 早就有这个开关，PDF 以前直接忽略了它
        // （面板上勾着「豆子中孔」，导出来的 PDF 却没有孔），现在补齐。
        pdf.setFillColor(255, 255, 255);
        pdf.setGState(new (pdf as any).GState({ opacity: 0.62 }));
        pdf.circle(px + cell / 2, py + cell / 2, Math.max(0.12, cell * 0.13), 'F');
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));
      }
      if (opts.showCodes && cell >= 2.8 && done) {
        const fs = Math.min(cell * 0.46, 3.4);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(fs * 2.83);
        const ink = readableTextColor(c.hex);
        pdf.setTextColor(ink === '#12141d' ? 27 : 255, ink === '#12141d' ? 29 : 255, ink === '#12141d' ? 33 : 255);
        pdf.text(c.code, px + cell / 2, py + cell / 2 + fs * 0.34, { align: 'center' });
      }
    }
  }

  const cw = x1 - x0;
  const chh = y1 - y0;

  if (opts.grid) {
    pdf.setDrawColor(205, 205, 212);
    pdf.setLineWidth(0.1);
    // 线必须跟着 lay.x / lay.y 走：分板时格子之间有板缝，
    // 按均匀 1 格画会让第 2 块板之后的线逐格偏移（用户说的「格子线偏差」）。
    const gxList = gridLinePositions(doc.width, bs, gap);
    for (const gx of gxList) {
      const px = gridX + (gx - ox) * cell;
      if (px < gridX - 0.5 || px > gridX + cw * cell + 0.5) continue;
      pdf.line(px, gridY, px, gridY + chh * cell);
    }
    const gyList = gridLinePositions(doc.height, bs, gap);
    for (const gy of gyList) {
      const py = gridY + (gy - oy) * cell;
      if (py < gridY - 0.5 || py > gridY + chh * cell + 0.5) continue;
      pdf.line(gridX, py, gridX + cw * cell, py);
    }
  }

  // 每 5 格加粗（同样走 lay 坐标）
  if (opts.grid && bs === 0) {
    pdf.setDrawColor(130, 130, 142);
    pdf.setLineWidth(0.26);
    for (const gx of gridStrongPositions(doc.width, 0, gap)) {
      if (gx < x0 || gx > x1) continue;
      const px = gridX + (gx - ox) * cell;
      pdf.line(px, gridY, px, gridY + chh * cell);
    }
    for (const gy of gridStrongPositions(doc.height, 0, gap)) {
      if (gy < y0 || gy > y1) continue;
      const py = gridY + (gy - oy) * cell;
      pdf.line(gridX, py, gridX + cw * cell, py);
    }
  }

  // 分板：接缝细线 + 灰色板号（不再逐块描橙色框）
  if (bs > 0) {
    if (opts.grid) {
      pdf.setDrawColor(78, 82, 94);
      pdf.setLineWidth(0.22);
      for (let rx = 1; rx < lay.cols; rx++) {
        const px = gridX + (rx * (bs + gap) * cell - (gap * cell) / 2) - (ox * cell);
        if (px < gridX - 0.5 || px > gridX + cw * cell + 0.5) continue;
        pdf.line(px, gridY, px, gridY + chh * cell);
      }
      for (let ry = 1; ry < lay.rows; ry++) {
        const py = gridY + (ry * (bs + gap) * cell - (gap * cell) / 2) - (oy * cell);
        if (py < gridY - 0.5 || py > gridY + chh * cell + 0.5) continue;
        pdf.line(gridX, py, gridX + cw * cell, py);
      }
    }
    pdf.setDrawColor(78, 82, 94);
    pdf.setLineWidth(0.3);
    pdf.rect(gridX, gridY, cw * cell, chh * cell, 'S');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(Math.max(4.5, Math.min(8, cell * 0.5)));
    pdf.setTextColor(96, 100, 112);
    for (let ry = 0; ry < lay.rows; ry++) {
      for (let rx = 0; rx < lay.cols; rx++) {
        const bx0 = rx * bs;
        const by0 = ry * bs;
        if (bx0 >= x1 || by0 >= y1 || bx0 + bs <= x0 || by0 + bs <= y0) continue;
        const px = gridX + (lay.x[bx0] - ox) * cell + 0.7;
        const py = gridY + (lay.y[by0] - oy) * cell + Math.max(2.6, cell * 0.55);
        if (cell < 2.2) continue;
        pdf.text(boardLabel(rx, ry), px, py);
      }
    }
  } else {
    pdf.setDrawColor(90, 90, 102);
    pdf.setLineWidth(0.4);
    pdf.rect(gridX, gridY, cw * cell, chh * cell, 'S');
  }

  // 坐标：每 5 格一个数字
  if (opts.coords) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(Math.max(3.2, Math.min(6, cell * 0.5)));
    pdf.setTextColor(105, 105, 120);
    for (let x = x0; x < x1; x++) {
      if (x % 5 !== 0) continue;
      pdf.text(String(x + 1), gridX + (lay.x[x] - ox) * cell + cell / 2, gridY - 1.1, { align: 'center' });
    }
    for (let y = y0; y < y1; y++) {
      if (y % 5 !== 0) continue;
      pdf.text(String(y + 1), gridX - 1.1, gridY + (lay.y[y] - oy) * cell + cell / 2 + 0.9, { align: 'right' });
    }
  }
}

/** 页脚：署名 + 页码 + 二维码 */
function pdfFooter(pdf: jsPDF, opts: PdfOptions, pw: number, ph: number, margin: number, pageText?: string) {
  const footY = ph - margin + 1;
  // 水印只留署名一行：地址不再印在纸上，右下角的二维码扫一下就是同一个地址。
  if (opts.watermark) {
    const text = opts.watermarkText || DEFAULT_WATERMARK_TEXT;
    pdfTextSafe(pdf, text, margin, footY, { sizeMm: 2.3, color: [150, 150, 164] });
  }
  // 二维码：塞在页脚右端。链接动辄几百上千字符，PDF 里又不可能让人手抄，
  // 二维码是唯一能真的用起来的分享方式。
  const qrText = opts.qrText || opts.watermarkUrl || DEFAULT_WATERMARK_URL;
  const qrSize = 15;
  let qrDrawn = false;
  if (opts.qr) {
    const qr = renderQrCanvas(qrText, { moduleSize: 3, margin: 2 });
    if (qr) {
      const qx = pw - margin - qrSize;
      const qy = footY - qrSize + 3;
      try {
        pdf.addImage(qr.toDataURL('image/png'), 'PNG', qx, qy, qrSize, qrSize);
        pdf.link(qx, qy, qrSize, qrSize, { url: qrText });
        qrDrawn = true;
      } catch {
        // 极少数情况下 canvas 拿不到 2d context，静默跳过，不影响主图
      }
    }
  }
  // 页码：和 PNG / SVG 一样只留必要的页码，不再多印一行「Perler Studio」
  if (pageText) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    pdf.setTextColor(150, 150, 165);
    pdf.text(pageText, pw - margin - (qrDrawn ? qrSize + 4 : 0), footY + 0.6, { align: 'right' });
  }
}

/** PDF 页面几何：导出与预览共用同一套数字，保证「预览即所得」 */
export interface PdfPageGeometry {
  pw: number;
  ph: number;
  margin: number;
  top: number;
  coordPad: number;
  coordTop: number;
  bottom: number;
  cell: number;
  gridX: number;
  gridY: number;
}

function pdfPageSize(pageSize: 'a4' | 'letter', orientation: 'portrait' | 'landscape'): [number, number] {
  const a4: [number, number] = [210, 297];
  const letter: [number, number] = [215.9, 279.4];
  const [w, h] = pageSize === 'letter' ? letter : a4;
  return orientation === 'portrait' ? [w, h] : [h, w];
}

function pdfSingleGeometry(
  doc: PatternDoc,
  opts: PdfOptions,
  pw: number,
  ph: number,
  margin: number,
  spanW: number,
  spanH: number,
  legendH = 0,
): PdfPageGeometry {
  let top = margin;
  if (opts.withHeader) top += 13;
  const coordPad = opts.coords ? 6 : 1.5;
  const coordTop = opts.coords ? 3.6 : 0.6;
  const bottom = 6;
  const availW = pw - margin * 2 - coordPad;
  const availH = ph - top - margin - bottom - coordTop - legendH;
  const cell = Math.max(0.4, Math.min(availW / spanW, availH / spanH));
  // 两个方向都居中：图纸铺在纸张正中间，不贴着页头或左边
  const leftover = Math.max(0, availH - spanH * cell);
  const leftoverX = Math.max(0, availW - spanW * cell);
  const gridY = top + coordTop + leftover / 2;
  const gridX = margin + coordPad + leftoverX / 2;
  return { pw, ph, margin, top, coordPad, coordTop, bottom, cell, gridX, gridY };
}

/** 单页用量表排版（单位 mm） */
function pdfLegendMetrics(rows: number, availW: number) {
  // 颗数紧跟色块后，一列只需要「色块 + 3 位数」的宽度，可以排得更密
  const cols = Math.max(1, Math.min(6, Math.floor(availW / 46)));
  const colW = availW / cols;
  const rowH = 5.4;
  const headH = rows > 0 ? 7 : 0;
  return { cols, colW, rowH, headH, height: headH + Math.ceil(rows / cols) * rowH };
}

/** 在 PDF 同一页里画色号用量表（每色一颗数），返回占用高度 */
function pdfDrawLegend(pdf: jsPDF, doc: PatternDoc, x: number, y: number, availW: number, title = '色号用量'): number {
  const rows = usageRows(doc);
  if (!rows.length) return 0;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const m = pdfLegendMetrics(rows.length, availW);
  pdfTextSafe(pdf, title, x, y + 5, { sizeMm: 4, bold: true, color: [40, 40, 52] });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(120, 120, 136);
  pdf.text(`${rows.length} 色 · ${total} 颗`, x + availW, y + 5, { align: 'right' });

  rows.forEach(({ color, count }, i) => {
    const col = i % m.cols;
    const line = Math.floor(i / m.cols);
    const cx = x + col * m.colW;
    const cy = y + m.headH + line * m.rowH + 0.5;
    const { r, g, b } = hexRgb(color.hex);
    // 色块比例跟 PNG / SVG 里的用量表一致（34 : 20），色号直接写在色块里
    const sw = 7.2;
    const sh = 4.2;
    pdf.setFillColor(r, g, b);
    pdf.setDrawColor(170, 170, 182);
    pdf.setLineWidth(0.15);
    pdf.rect(cx, cy, sw, sh, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.1);
    const ink = readableTextColor(color.hex);
    const [ir, ig, ib] = ink === '#12141d' ? [27, 29, 33] : [255, 255, 255];
    pdf.setTextColor(ir, ig, ib);
    pdf.text(color.code, cx + sw / 2, cy + sh / 2 + 0.95, { align: 'center' });
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.6);
    pdf.setTextColor(50, 50, 64);
    // 颗数紧跟在色块右边，不要右对齐到列宽末尾——那样中间会空出一大段
    pdf.text(`${count}`, cx + sw + 2.4, cy + sh / 2 + 0.95, { align: 'left' });
  });
  return m.height;
}

/** 一张纸装下整张图纸：标题 + 坐标 + 板框 */
function pdfSinglePage(pdf: jsPDF, doc: PatternDoc, opts: PdfOptions, pw: number, ph: number, margin: number) {
  const bs = opts.boardSize ?? 0;
  const gap = opts.boardGap ?? 1.2;
  const lay = boardLayout(doc, bs, gap);

  if (opts.withHeader) {
    pdfTextSafe(pdf, doc.name || 'Perler Pattern', margin, margin + 4, { sizeMm: 4.2, bold: true });
    const beads = totalBeads(doc);
    const boardInfo = bs > 0 ? ` · 共 ${lay.cols * lay.rows} 块板，每块 ${bs}×${bs} 格` : '';
    pdfTextSafe(
      pdf,
      `${doc.width} × ${doc.height} 格 · ${beads} 颗 · ${doc.palette.length} 色${boardInfo}`,
      margin,
      margin + 9,
      { sizeMm: 2.6, color: [110, 110, 125] },
    );
  }

  const legendH = opts.legend ? pdfLegendMetrics(usageRows(doc).length, pw - margin * 2).height + 3 : 0;
  const g = pdfSingleGeometry(doc, opts, pw, ph, margin, lay.spanX, lay.spanY, legendH);
  pdfDrawPattern(pdf, doc, opts, g.cell, g.gridX, g.gridY, lay);
  // 色号用量表贴在图纸下方，同一页里看得见每色用了多少颗
  if (opts.legend && legendH > 0) {
    const legendY = Math.min(g.gridY + lay.spanY * g.cell + 5, ph - margin - g.bottom - legendH);
    pdfDrawLegend(pdf, doc, margin, legendY, pw - margin * 2);
  }
  pdfFooter(pdf, opts, pw, ph, margin);
}

/** 从图纸里裁一块子图（预览分板 / 分块页用），palette 与进度保持不变 */
function subDoc(doc: PatternDoc, x0: number, y0: number, w: number, h: number): PatternDoc {
  const cells = new Uint16Array(w * h);
  // 进度也要跟着切：只切 cells 的话 progress 还是整张图的长度，
  // 后面按下标取进度会错位，分板导出会把「已拼」打到别的格子上。
  const progress = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy >= doc.height) break;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx >= doc.width) break;
      const si = sy * doc.width + sx;
      const di = y * w + x;
      cells[di] = doc.cells[si];
      progress[di] = doc.progress[si];
    }
  }
  return { ...doc, width: w, height: h, cells, progress };
}

/**
 * 色号能印清楚的最小单格尺寸。
 * canvas / SVG 用像素，PDF 用毫米 —— 低于这个值色号会糊成一片，
 * 与其画出来看不清，不如提前告诉用户「切成一块板一页」。
 */
export const CODE_MIN_PX = 13;
export const CODE_MIN_MM = 3;

/** 一板一页时单格的最大尺寸（mm）：5mm 豆子按 1:1 印出来就能直接压在纸上对照 */
export const CELL_1TO1_MM = 5.6;

export interface CellAdvice {
  /** 每格实际占多少：png / svg 是像素，pdf 是毫米 */
  size: number;
  unit: 'px' | 'mm';
  /** 色号是否印得清 */
  legible: boolean;
  /** 这块图纸一共几块板 */
  boards: number;
  /** 想看清色号，一整张至少要拆成几页 */
  suggestPages: number;
  /** 给用户看的一句话 */
  hint: string;
}

/**
 * 预估当前导出设置下每格有多大、色号能不能看清。
 * 导出面板用它提前给建议，而不是等用户导完发现满屏小点。
 */
export function cellAdvice(
  doc: PatternDoc,
  fmt: 'png' | 'svg' | 'pdf',
  o: {
    cellSize?: number;
    layout?: 'single' | 'boards';
    boardSize?: number;
    pageSize?: 'a4' | 'letter';
    orientation?: 'portrait' | 'landscape' | 'auto';
    coords?: boolean;
  } = {},
): CellAdvice {
  const bs = Math.max(4, o.boardSize || doc.pegboard || 29);
  const lay = boardLayout(doc, bs, 0);
  const boards = lay.cols * lay.rows;

  if (fmt === 'png' || fmt === 'svg') {
    const size = safeCellSize(doc.width, doc.height, o.cellSize ?? 24);
    const legible = size >= CODE_MIN_PX;
    const want = Math.max(doc.width, doc.height) / CODE_MIN_PX;
    return {
      size: Math.round(size * 10) / 10,
      unit: 'px',
      legible,
      boards,
      suggestPages: want <= 1 ? 1 : Math.ceil(want / bs),
      hint: legible
        ? `每格约 ${size.toFixed(0)}px，色号印得清`
        : `每格只剩 ${size.toFixed(0)}px，色号印不下；把「单格像素」调到 ${CODE_MIN_PX} 以上，或者用「一板一页」按板导出`,
    };
  }

  const orientation: 'portrait' | 'landscape' =
    o.orientation && o.orientation !== 'auto' ? o.orientation : doc.width > doc.height ? 'landscape' : 'portrait';
  const [pw, ph] = pdfPageSize(o.pageSize ?? 'a4', orientation);
  const margin = 10;
  const coordPad = o.coords ? 6 : 1.5;
  const availW = pw - margin * 2 - coordPad;

  if (o.layout === 'boards') {
    // 一板一页：格子大小按「完整一块板」算，和 pdfBoardPages 一致
    const availH = ph - margin * 2 - (o.coords ? 3.6 : 0.6) - 26;
    const cell = Math.max(0.4, Math.min(availW / bs, availH / bs));
    const legible = cell >= CODE_MIN_MM;
    return {
      size: Math.round(cell * 10) / 10,
      unit: 'mm',
      legible,
      boards,
      suggestPages: boards,
      hint: legible
        ? `一板一页：每格约 ${cell.toFixed(1)}mm，色号清楚，每页标好是哪一块板`
        : `一板一页每格约 ${cell.toFixed(1)}mm，还是偏小；把「拼豆板尺寸」调小一些（比如 15 或 29）会更清楚`,
    };
  }

  const availH = ph - margin * 2 - 26;
  const cell = Math.max(0.2, Math.min(availW / doc.width, availH / doc.height));
  const legible = cell >= CODE_MIN_MM;
  const suggest = Math.max(1, Math.ceil(doc.width / Math.max(1, Math.floor(availW / CODE_MIN_MM))));
  return {
    size: Math.round(cell * 10) / 10,
    unit: 'mm',
    legible,
    boards,
    suggestPages: suggest,
    hint: legible
      ? `整张一页：每格约 ${cell.toFixed(1)}mm，色号看得清`
      : `整张一页每格只有 ${cell.toFixed(1)}mm，色号完全印不出来；改成「一板一页」，${boards} 块板分 ${boards} 页，每格能到 ${Math.min(availW / bs, availH / bs).toFixed(1)}mm`,
  };
}

/** 一板一页导出 PNG：每块板一个文件，文件名和图上都标明是哪一块 */
export async function exportBoardImagesPNG(doc: PatternDoc, opts: RenderOptions) {
  const bs = Math.max(4, opts.boardSize || doc.pegboard || 29);
  const lay = boardLayout(doc, bs, 0);
  const total = lay.cols * lay.rows;
  let index = 0;
  for (let ry = 0; ry < lay.rows; ry++) {
    for (let rx = 0; rx < lay.cols; rx++) {
      index++;
      const x0 = rx * bs;
      const y0 = ry * bs;
      const w = Math.min(doc.width, x0 + bs) - x0;
      const h = Math.min(doc.height, y0 + bs) - y0;
      const sub = subDoc(doc, x0, y0, w, h);
      const label = boardLabel(rx, ry);
      const cellSize = safeCellSize(w, h, opts.cellSize);
      const canvas = renderPatternCanvas(sub, {
        ...opts,
        cellSize,
        // 单块板不再画板格线，整页就是这一块
        boardSize: 0,
        title: `板 ${label} · 第 ${index}/${total} 块 · 第 ${y0 + 1}-${y0 + h} 行 / 第 ${x0 + 1}-${x0 + w} 列`,
      });
      const blob = await canvasToPngBlob(canvas);
      // 以前这里 !blob 就静默 continue，用户看到「已开始下载」却少了几块板
      if (!blob) continue;
      downloadBlob(blob, `${safeFileName(doc.name)}_板${label}_${index}of${total}.png`);
    }
  }
  return { files: total };
}

/** 一板一页导出 SVG：每块板一个 svg 文件 */
export function exportBoardImagesSVG(doc: PatternDoc, opts: RenderOptions) {
  const bs = Math.max(4, opts.boardSize || doc.pegboard || 29);
  const lay = boardLayout(doc, bs, 0);
  const total = lay.cols * lay.rows;
  let index = 0;
  for (let ry = 0; ry < lay.rows; ry++) {
    for (let rx = 0; rx < lay.cols; rx++) {
      index++;
      const x0 = rx * bs;
      const y0 = ry * bs;
      const w = Math.min(doc.width, x0 + bs) - x0;
      const h = Math.min(doc.height, y0 + bs) - y0;
      const label = boardLabel(rx, ry);
      const sub = subDoc(doc, x0, y0, w, h);
      const svg = buildSVG(sub, {
        ...opts,
        boardSize: 0,
        fitWindow: false,
        title: `板 ${label} · 第 ${index}/${total} 块 · 第 ${y0 + 1}-${y0 + h} 行 / 第 ${x0 + 1}-${x0 + w} 列`,
      });
      downloadBlob(
        new Blob([svg], { type: 'image/svg+xml' }),
        `${safeFileName(doc.name)}_板${label}_${index}of${total}.svg`,
      );
    }
  }
  return { files: total };
}

/** 一块板的子图（预览、打包都要用），index 超出范围时返回 null */
function boardSlice(doc: PatternDoc, boardSize: number, col: number, row: number) {
  const bs = Math.max(4, boardSize || doc.pegboard || 29);
  const cols = Math.ceil(doc.width / bs);
  const rows = Math.ceil(doc.height / bs);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  const x0 = col * bs;
  const y0 = row * bs;
  const w = Math.min(doc.width, x0 + bs) - x0;
  const h = Math.min(doc.height, y0 + bs) - y0;
  return {
    sub: subDoc(doc, x0, y0, w, h),
    x0,
    y0,
    w,
    h,
    label: boardLabel(col, row),
    index: row * cols + col + 1,
    total: cols * rows,
  };
}

/** 分板预览：把第 col/row 块板单独渲染成一张图，用于导出面板里逐块翻看 */
export function renderBoardCanvas(
  doc: PatternDoc,
  opts: RenderOptions,
  col: number,
  row: number,
  maxPx = 460,
): HTMLCanvasElement | null {
  const slice = boardSlice(doc, opts.boardSize ?? 0, col, row);
  if (!slice) return null;
  const want = Math.max(3, Math.min(opts.cellSize || 24, Math.floor(maxPx / Math.max(slice.w, slice.h))));
  return renderPatternCanvas(slice.sub, {
    ...opts,
    cellSize: want,
    boardSize: 0,
    coords: false,
    title: undefined,
  });
}

/** 一块板的 SVG 文本（打包用） */
function boardSvg(
  doc: PatternDoc,
  opts: RenderOptions,
  boardSize: number,
  col: number,
  row: number,
): { name: string; svg: string } | null {
  const slice = boardSlice(doc, boardSize, col, row);
  if (!slice) return null;
  const svg = buildSVG(slice.sub, {
    ...opts,
    boardSize: 0,
    fitWindow: false,
    title: `板 ${slice.label} · 第 ${slice.index}/${slice.total} 块 · 第 ${slice.y0 + 1}-${slice.y0 + slice.h} 行 / 第 ${slice.x0 + 1}-${slice.x0 + slice.w} 列`,
  });
  return { name: `板${slice.label}_${slice.index}of${slice.total}.svg`, svg };
}

/**
 * 一板一张打包成一个 .zip。
 *
 * 之前一板一张是「一块板触发一次下载」，9 块板就是 9 个文件同时涌进下载目录，
 * 浏览器还会拦「多文件下载」。改成一个压缩包，用户拿到的是一个文件，
 * 解压就是整整齐齐一堆按板号命名的图。
 */
export async function exportBoardZip(
  doc: PatternDoc,
  opts: RenderOptions,
  format: 'png' | 'svg',
): Promise<{ files: number; bytes: number }> {
  const bs = Math.max(4, opts.boardSize || doc.pegboard || 29);
  const lay = boardLayout(doc, bs, 0);
  const entries: { name: string; data: Uint8Array }[] = [];

  if (format === 'svg') {
    for (let ry = 0; ry < lay.rows; ry++) {
      for (let rx = 0; rx < lay.cols; rx++) {
        const item = boardSvg(doc, opts, bs, rx, ry);
        if (item) entries.push({ name: item.name, data: textToBytes(item.svg) });
      }
    }
  } else {
    let index = 0;
    const total = lay.cols * lay.rows;
    for (let ry = 0; ry < lay.rows; ry++) {
      for (let rx = 0; rx < lay.cols; rx++) {
        index++;
        const slice = boardSlice(doc, bs, rx, ry);
        if (!slice) continue;
        const cellSize = safeCellSize(slice.w, slice.h, opts.cellSize);
        const canvas = renderPatternCanvas(slice.sub, {
          ...opts,
          cellSize,
          boardSize: 0,
          title: `板 ${slice.label} · 第 ${index}/${total} 块 · 第 ${slice.y0 + 1}-${slice.y0 + slice.h} 行 / 第 ${slice.x0 + 1}-${slice.x0 + slice.w} 列`,
        });
        const blob = await canvasToPngBlob(canvas);
        if (!blob) continue;
        entries.push({ name: `板${slice.label}_${index}of${total}.png`, data: await blobToBytes(blob) });
      }
    }
  }

  // 附一份用量清单，解压的人不用再回来找
  if (entries.length) {
    entries.push({ name: '用量清单.csv', data: textToBytes('\ufeff' + csvText(doc)) });
  }

  const zip = buildZip(entries);
  downloadBlob(zip, `${safeFileName(doc.name)}_一板一张_${entries.length - 1}块.zip`);
  return { files: entries.length - 1, bytes: zip.size };
}


export interface PdfPreviewOptions extends PdfOptions {
  /** 第几页（从 0 开始），默认第 1 页 */
  page?: number;
}

/**
 * PDF 纸张预览：把「一张纸」真实画出来，几何与 exportPDF 完全一致。
 * 返回的 canvas 就是最终 PDF 页面的样子（白纸 + 标题 + 图纸 + 坐标 + 用量表）。
 */
export function renderPdfPreviewCanvas(doc: PatternDoc, opts: PdfPreviewOptions): HTMLCanvasElement {
  const autoOrient: 'portrait' | 'landscape' = doc.width > doc.height ? 'landscape' : 'portrait';
  const orientation = opts.orientation === 'auto' ? autoOrient : opts.orientation;
  const [pw, ph] = pdfPageSize(opts.pageSize, orientation);
  const margin = 12;
  const page = Math.max(0, opts.page ?? 0);

  const pxPerMm = Math.min(3.2, 760 / pw);
  const W = Math.round(pw * pxPerMm);
  const H = Math.round(ph * pxPerMm);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const M = (v: number) => v * pxPerMm;

  // 页头文字
  const drawHeader = (title: string, sub: string) => {
    if (!opts.withHeader) return;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#181820';
    ctx.font = `600 ${Math.round(M(4.2) * 1.28)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
    ctx.fillText(title, M(margin), M(margin + 4));
    ctx.fillStyle = '#6e6e7d';
    ctx.font = `400 ${Math.round(M(2.6) * 1.28)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
    ctx.fillText(sub, M(margin), M(margin + 9));
  };

  let pattern: HTMLCanvasElement;
  let subject: PatternDoc = doc;
  let gridXmm: number;
  let gridYmm: number;
  let cellMm: number;
  let boardWmm = 0;
  let legendDoc: PatternDoc = doc;
  let legendTitle = '色号用量';
  let legendYmm = 0;
  let legendH = 0;
  let pageText: string | undefined;
  // 预览里用量表、水印、二维码都由页面层单独画（和 exportPDF 一样），图案绘制本身不画它们。
  // title 也必须清掉：renderPatternCanvas 带 title 时会在图案顶部留一条抬头，
  // 而页面层已经画了 doc.name —— 不清就会「一张纸上印两个文件名」，
  // 并且整块图案被这条抬头往下顶 28px，和坐标/板框全部错位。
  const patOnly = { ...opts, legend: false, watermark: false, qr: false, title: undefined };

  if (opts.layout === 'single') {
    const bs = opts.boardSize ?? 0;
    const lay = boardLayout(doc, bs, opts.boardGap ?? 1.2);
    legendH = opts.legend ? pdfLegendMetrics(usageRows(doc).length, pw - margin * 2).height + 3 : 0;
    const g = pdfSingleGeometry(doc, opts, pw, ph, margin, lay.spanX, lay.spanY, legendH);
    const boardInfo = bs > 0 ? ` · 共 ${lay.cols * lay.rows} 块板，每块 ${bs}×${bs} 格` : '';
    drawHeader(
      doc.name || 'Perler Pattern',
      `${doc.width} × ${doc.height} 格 · ${totalBeads(doc)} 颗 · ${doc.palette.length} 色${boardInfo}`,
    );
    gridXmm = g.gridX;
    gridYmm = g.gridY;
    cellMm = g.cell;
    legendYmm = Math.min(ph - margin - g.bottom - legendH, gridYmm + lay.spanY * g.cell + 5);
  } else {
    // 与 pdfBoardPages 用同一套几何：单格封 5.6mm 上限，下面留出本板用量表的位置
    const bs = Math.max(4, opts.boardSize || doc.pegboard || 29);
    const lay = boardLayout(doc, bs, 0);
    const total = lay.cols * lay.rows;
    const idx = Math.min(page, total - 1);
    const rx = idx % lay.cols;
    const ry = Math.floor(idx / lay.cols);
    const x0 = rx * bs;
    const y0 = ry * bs;
    const x1 = Math.min(doc.width, x0 + bs);
    const y1 = Math.min(doc.height, y0 + bs);
    subject = subDoc(doc, x0, y0, x1 - x0, y1 - y0);
    legendDoc = subject;
    legendTitle = '本板色号用量';
    pageText = `${idx + 1} / ${total}`;

    let top = margin;
    drawHeader(
      `${doc.name || 'Perler Pattern'} · 板 ${boardLabel(rx, ry)}`,
      `${doc.width} × ${doc.height} 格 · 板 ${idx + 1}/${total} · 第 ${y0 + 1}-${y1} 行，第 ${x0 + 1}-${x1} 列`,
    );
    if (opts.withHeader) top += 12.5;

    const coordPad = opts.coords ? 6 : 1.5;
    const coordTop = opts.coords ? 3.6 : 0.6;
    const bottom = 6;
    const availW = pw - margin * 2 - coordPad;
    legendH = opts.legend ? pdfLegendMetrics(usageRows(subject).length, pw - margin * 2).height + 4 : 0;
    const usableH = ph - top - margin - bottom - coordTop;
    cellMm = Math.max(0.4, Math.min(availW / bs, (usableH - legendH) / bs, CELL_1TO1_MM));
    boardWmm = bs * cellMm;
    const blockH = boardWmm + legendH;
    gridXmm = margin + coordPad + Math.max(0, (availW - boardWmm) / 2);
    gridYmm = top + coordTop + Math.max(0, (usableH - blockH) / 2);
    legendYmm = gridYmm + boardWmm + 4;
  }

  // 图纸：用 patternLayout 的真实留白对齐页面网格原点。
  // 以前这里写死 padTop=max(18,…)/padLeft=max(20,…)，和 renderPatternCanvas 内部
  // 又套了一层 title 抬头后的留白不一致，图一大就整体偏移。
  const cellPx = Math.max(1, cellMm * pxPerMm);
  const patOpts = { ...patOnly, cellSize: cellPx, background: null };
  const L = patternLayout(subject, patOpts, cellPx);
  pattern = renderPatternCanvasAt(subject, patOpts, cellPx);
  const originX = M(gridXmm) - L.padLeft;
  const originY = M(gridYmm) - L.padTop;
  ctx.drawImage(pattern, originX, originY);

  // 一板一页：板框与拼装三角标记，和 exportPDF 完全一致
  if (opts.layout === 'boards' && boardWmm > 0) {
    ctx.strokeStyle = '#606470';
    ctx.lineWidth = Math.max(1, M(0.4));
    ctx.strokeRect(M(gridXmm), M(gridYmm), M(boardWmm), M(boardWmm));
    ctx.fillStyle = 'rgba(140,144,156,0.85)';
    const tri = Math.min(3, cellMm * 0.5);
    const midX = M(gridXmm + boardWmm / 2);
    const midY = M(gridYmm + boardWmm / 2);
    const left = M(gridXmm);
    const right = M(gridXmm + boardWmm);
    const topY = M(gridYmm);
    const botY = M(gridYmm + boardWmm);
    const t = M(tri);
    const layB = boardLayout(doc, Math.max(4, opts.boardSize || doc.pegboard || 29), 0);
    const idxB = Math.min(page, layB.cols * layB.rows - 1);
    const rxB = idxB % layB.cols;
    const ryB = Math.floor(idxB / layB.cols);
    const tri2 = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.closePath();
      ctx.fill();
    };
    if (rxB > 0) tri2(left, midY, left - t, midY - t, left - t, midY + t);
    if (rxB < layB.cols - 1) tri2(right, midY, right + t, midY - t, right + t, midY + t);
    if (ryB > 0) tri2(midX, topY, midX - t, topY - t, midX + t, topY - t);
    if (ryB < layB.rows - 1) tri2(midX, botY, midX - t, botY + t, midX + t, botY + t);
  }

  // 色号用量表：单页统计全图，一板一页只统计这一块板 —— 和 PNG / SVG 的用量表同一种排版
  if (opts.legend && legendH > 0) {
    drawPdfLegendOnCanvas(ctx, legendDoc, margin, legendYmm, pw - margin * 2, M, legendTitle);
  }

  // 页脚：署名 + 页码 + 二维码。
  // 「打印请选『实际大小 / 100%』」「Perler Studio」、50mm 校准尺和一长串地址都去掉了：
  // 用户在 PNG / SVG 里看到什么，PDF 就不再额外多印东西。
  const footY = M(ph - margin + 1);

  // 水印：只留署名一行，地址交给二维码
  if (opts.watermark) {
    const text = opts.watermarkText || DEFAULT_WATERMARK_TEXT;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8b8b99';
    ctx.font = `400 ${Math.round(M(2.4) * 1.3)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
    ctx.fillText(text, M(margin), footY);
  }

  // 二维码：右下角，和导出件保持同一位置，预览里就能看见
  const qrText = opts.qrText || opts.watermarkUrl || DEFAULT_WATERMARK_URL;
  const qrSizePx = 15;
  let qrDrawn = false;
  if (opts.qr) {
    const qr = renderQrCanvas(qrText, { moduleSize: 3, margin: 2 });
    if (qr) {
      const qx = M(pw - margin - qrSizePx);
      const qy = M(ph - margin + 1 - qrSizePx + 3);
      ctx.drawImage(qr, qx, qy, M(qrSizePx), M(qrSizePx));
      qrDrawn = true;
    }
  }
  if (pageText) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9696a5';
    ctx.font = `400 ${Math.round(M(2.3) * 1.3)}px ui-monospace, monospace`;
    ctx.fillText(pageText, M(pw - margin - (qrDrawn ? qrSizePx + 4 : 0)), footY + M(0.6));
    ctx.textAlign = 'left';
  }

  return canvas;
}

/** 预览里的用量表：几何完全照搬 pdfDrawLegend，保证预览和导出的 PDF 长得一样 */
function drawPdfLegendOnCanvas(
  ctx: CanvasRenderingContext2D,
  doc: PatternDoc,
  x: number,
  y: number,
  availW: number,
  M: (v: number) => number,
  title: string,
): number {
  const rows = usageRows(doc);
  if (!rows.length) return 0;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const m = pdfLegendMetrics(rows.length, availW);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#282834';
  ctx.font = `600 ${Math.max(9, Math.round(M(4) * 1.28))}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
  ctx.fillText(title, M(x), M(y + 5));
  ctx.textAlign = 'right';
  ctx.fillStyle = '#787888';
  ctx.font = `400 ${Math.max(8, Math.round(M(2.4) * 1.28))}px ui-monospace, monospace`;
  ctx.fillText(`${rows.length} 色 · ${total} 颗`, M(x + availW), M(y + 5));

  rows.forEach(({ color, count }, i) => {
    const col = i % m.cols;
    const line = Math.floor(i / m.cols);
    const cx = x + col * m.colW;
    const cy = y + m.headH + line * m.rowH + 0.5;
    const sw = 7.2;
    const sh = 4.2;
    ctx.fillStyle = color.hex;
    ctx.fillRect(M(cx), M(cy), M(sw), M(sh));
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(M(cx), M(cy), M(sw), M(sh));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = readableTextColor(color.hex);
    ctx.font = `700 ${Math.max(6, Math.round(M(2.5) * 1.28))}px ui-monospace, monospace`;
    ctx.fillText(color.code, M(cx + sw / 2), M(cy + sh / 2) + 0.5);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#32323f';
    ctx.font = `700 ${Math.max(6, Math.round(M(2.7) * 1.28))}px ui-monospace, monospace`;
    ctx.fillText(String(count), M(cx + sw + 2.4), M(cy + sh / 2) + 0.5);
  });
  ctx.textBaseline = 'alphabetic';
  return m.height;
}

/** 一块板一页：按板尺寸放大，可 1:1 打印后逐块拼装 */
function pdfBoardPages(pdf: jsPDF, doc: PatternDoc, opts: PdfOptions, pw: number, ph: number, margin: number) {
  const bs = Math.max(4, opts.boardSize || doc.pegboard || 29);
  const lay = boardLayout(doc, bs, 0);
  const total = lay.cols * lay.rows;
  let pageIndex = 0;

  for (let ry = 0; ry < lay.rows; ry++) {
    for (let rx = 0; rx < lay.cols; rx++) {
      if (pageIndex > 0) pdf.addPage();
      pageIndex++;
      const x0 = rx * bs;
      const y0 = ry * bs;
      const x1 = Math.min(doc.width, x0 + bs);
      const y1 = Math.min(doc.height, y0 + bs);
      const cw = x1 - x0;
      const chh = y1 - y0;
      const label = boardLabel(rx, ry);

      let top = margin;
      if (opts.withHeader) {
        pdfTextSafe(pdf, `${doc.name || 'Perler Pattern'} · 板 ${label}`, margin, top + 4, {
          sizeMm: 4,
          bold: true,
        });
        pdfTextSafe(
          pdf,
          `${doc.width} × ${doc.height} 格 · 板 ${pageIndex}/${total} · 第 ${y0 + 1}-${y1} 行，第 ${x0 + 1}-${x1} 列`,
          margin,
          top + 8.6,
          { sizeMm: 2.4, color: [110, 110, 125] },
        );
        top += 12.5;
      }

      const coordPad = opts.coords ? 6 : 1.5;
      const coordTop = opts.coords ? 3.6 : 0.6;
      const bottom = 6;
      const availW = pw - margin * 2 - coordPad;
      // 这一页的用量表只统计这块板：用户翻到哪一页，就该知道这一页要拼哪些色、各多少颗
      const sub = subDoc(doc, x0, y0, cw, chh);
      const legendH = opts.legend ? pdfLegendMetrics(usageRows(sub).length, pw - margin * 2).height + 4 : 0;
      const usableH = ph - top - margin - bottom - coordTop;
      // 关键：cell 一律按「完整一块板」算，边缘残缺板不放大，
      // 否则每页格子大小不同，打印后拼装对不上。
      // 再封一个 5.6mm 的上限（5mm 豆子 1:1）：以前没有上限，一整块板会把纸铺满，
      // 既没有地方印用量，也白白浪费纸。
      const cell = Math.max(0.4, Math.min(availW / bs, (usableH - legendH) / bs, CELL_1TO1_MM));
      const boardW = bs * cell;
      const blockH = boardW + legendH;
      // 图纸 + 用量表作为一个整体居中，不贴左上角
      const gridX = margin + coordPad + Math.max(0, (availW - boardW) / 2);
      const gridY = top + coordTop + Math.max(0, (usableH - blockH) / 2);

      // 只画这块板：把整图坐标裁剪到板范围
      pdfDrawPattern(pdf, doc, { ...opts, boardSize: 0 }, cell, gridX, gridY, lay, {
        x0,
        x1,
        y0,
        y1,
      });

      // 板框固定按整块板画，残缺处留白，方便对位。
      // 用中性灰而不是橙色：一板一页要打印出来照着拼，橙色框会抢豆子颜色的注意力。
      pdf.setDrawColor(96, 100, 112);
      pdf.setLineWidth(0.4);
      pdf.rect(gridX, gridY, boardW, boardW, 'S');

      // 拼装对位标记：板边缘中点的小三角
      const edgeW = boardW;
      const edgeH = boardW;
      pdf.setFillColor(140, 144, 156);
      const tri = Math.min(3, cell * 0.5);
      const midX = gridX + edgeW / 2;
      const midY = gridY + edgeH / 2;
      if (rx > 0) pdf.triangle(gridX, midY, gridX - tri, midY - tri, gridX - tri, midY + tri, 'F');
      if (rx < lay.cols - 1) pdf.triangle(gridX + edgeW, midY, gridX + edgeW + tri, midY - tri, gridX + edgeW + tri, midY + tri, 'F');
      if (ry > 0) pdf.triangle(midX, gridY, midX - tri, gridY - tri, midX + tri, gridY - tri, 'F');
      if (ry < lay.rows - 1) pdf.triangle(midX, gridY + edgeH, midX - tri, gridY + edgeH + tri, midX + tri, gridY + edgeH + tri, 'F');

      // 这一页要用多少颗：跟 PNG / SVG 的用量表一个样子
      if (legendH > 0) {
        pdfDrawLegend(pdf, sub, margin, gridY + boardW + 4, pw - margin * 2, '本板色号用量');
      }

      pdfFooter(pdf, opts, pw, ph, margin, `${pageIndex} / ${total}`);
    }
  }
}

/** 导出 PDF：默认整张图纸一页装下；也可一板一页 */
export function exportPDF(doc: PatternDoc, opts: PdfOptions): { pages: number } {
  const autoOrient: 'portrait' | 'landscape' = doc.width > doc.height ? 'landscape' : 'portrait';
  const orientation = opts.orientation === 'auto' ? autoOrient : opts.orientation;
  const pdf = new jsPDF({ orientation, unit: 'mm', format: opts.pageSize });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 12;

  if (opts.layout === 'single') {
    pdfSinglePage(pdf, doc, opts, pw, ph, margin);
  } else {
    pdfBoardPages(pdf, doc, opts, pw, ph, margin);
  }

  pdf.save(`${safeFileName(doc.name)}.pdf`);
  return { pages: pdf.getNumberOfPages() };
}

function hexRgb(hex: string) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** 用量清单的 CSV 文本（导出 CSV 和打包进 zip 都用这一份，避免两套口径） */
export function csvText(doc: PatternDoc): string {
  const usage = usageOf(doc);
  const defaultPrice = getDefaultPrice();
  const rows: string[] = ['品牌,色号,色名,HEX,数量,已拼,剩余,单价(元/千颗),金额(元),库存(颗),需补货(颗)'];
  const entries = Array.from(usage.entries()).sort((a, b) => b[1] - a[1]);
  let totalAmount = 0;
  let totalRestock = 0;
  for (const [v, count] of entries) {
    const c = doc.palette[v - 1];
    if (!c) continue;
    let placed = 0;
    for (let i = 0; i < doc.cells.length; i++) if (doc.cells[i] === v && doc.progress[i]) placed++;
    const unitPrice = typeof c.price === 'number' && c.price >= 0 ? c.price : defaultPrice;
    const amount = (count / 1000) * unitPrice;
    const stock = Math.max(0, Math.floor(c.stock ?? 0));
    const restock = Math.max(0, count - stock);
    totalAmount += amount;
    totalRestock += restock;
    rows.push(
      [c.brand, c.code, c.name, c.hex, count, placed, count - placed, unitPrice.toFixed(2), amount.toFixed(2), stock, restock].join(
        ',',
      ),
    );
  }
  const total = Array.from(usage.values()).reduce((a, b) => a + b, 0);
  rows.push(['合计', '', '', '', total, '', '', '', totalAmount.toFixed(2), '', totalRestock].join(','));
  return rows.join('\n');
}

export function exportCSV(doc: PatternDoc) {
  // 加 BOM 便于 Excel 识别中文
  downloadText('\ufeff' + csvText(doc), `${safeFileName(doc.name)}-用量.csv`, 'text/csv');
}

export function buildProject(doc: PatternDoc): ProjectFile {
  return {
    format: 'perler-studio',
    version: 1,
    exportedAt: Date.now(),
    name: doc.name,
    width: doc.width,
    height: doc.height,
    pegboard: doc.pegboard,
    notes: doc.notes,
    palette: doc.palette,
    cells: rleEncode(doc.cells),
    progress: rleEncode(doc.progress),
  };
}

export function exportProject(doc: PatternDoc) {
  downloadText(JSON.stringify(buildProject(doc)), `${safeFileName(doc.name)}.perler.json`);
}

export function parseProject(text: string): PatternDoc | null {
  try {
    const p = JSON.parse(text) as ProjectFile;
    if (p.format !== 'perler-studio') return null;
    if (!p.width || !p.height || !Array.isArray(p.palette)) return null;
    const len = p.width * p.height;
    return {
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
      name: p.name || '导入的图纸',
      width: p.width,
      height: p.height,
      cells: rleDecode(p.cells, len),
      progress: rleDecodeU8(p.progress, len),
      palette: p.palette,
      pegboard: p.pegboard || 29,
      notes: p.notes || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export function docToThumb(doc: PatternDoc, size = 120): string {
  const canvas = renderPatternCanvas(doc, {
    ...DEFAULT_RENDER,
    cellSize: Math.max(1, Math.min(8, Math.floor(size / Math.max(doc.width, doc.height)))),
    coords: false,
    grid: false,
    holes: false,
    background: '#ffffff',
  });
  return canvas.toDataURL('image/png');
}

export function paletteUsageCount(doc: PatternDoc): Map<number, number> {
  return usageOf(doc);
}

export function totalBeads(doc: PatternDoc): number {
  let n = 0;
  for (let i = 0; i < doc.cells.length; i++) if (doc.cells[i]) n++;
  return n;
}

export function placedBeads(doc: PatternDoc): number {
  let n = 0;
  for (let i = 0; i < doc.cells.length; i++) if (doc.cells[i] && doc.progress[i]) n++;
  return n;
}

export type { BeadColor };
