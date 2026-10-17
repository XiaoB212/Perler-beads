import jsPDF from 'jspdf';
import type { BeadColor, PatternDoc, ProjectFile } from './types';
import { readableTextColor } from './color';
import { rleDecode, rleDecodeU8, rleEncode } from './rle';
import { downloadBlob, downloadText, safeFileName } from './util';
import { getDefaultPrice } from './cost';

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
  const cols = Math.max(1, Math.min(6, Math.floor(availW / minCol)));
  const colW = availW / Math.max(1, cols);
  const rowH = 27 * scale;
  const headH = rows > 0 ? 30 * scale : 0;
  return { cols, colW, rowH, headH, height: headH + Math.ceil(rows / cols) * rowH + 10 * scale };
}

/** 水印占用的高度 */
function watermarkHeight(scale = 1) {
  return 24 * scale;
}

/** 市面常见拼豆板尺寸（5mm 豆） */
export const BOARD_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: '不分板' },
  { value: 10, label: '10 × 10' },
  { value: 14, label: '14 × 14 小板' },
  { value: 15, label: '15 × 15' },
  { value: 20, label: '20 × 20' },
  { value: 28, label: '28 × 28' },
  { value: 29, label: '29 × 29 大板' },
  { value: 48, label: '48 × 48' },
];

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

function inkFor(hex: string): string {
  return readableTextColor(hex);
}

/** 主渲染：把图纸画到 canvas（可选底部用量表与水印） */
export function renderPatternCanvas(doc: PatternDoc, opts: RenderOptions): HTMLCanvasElement {
  const { width, height, cells, palette } = doc;
  // 允许小于 1px 的格宽：超大画布的缩略图只能靠亚像素缩小才画得下
  const cs = Math.max(0.35, opts.cellSize);
  const bs = opts.boardSize ?? 0;
  const gap = opts.boardGap ?? 1.2;
  const lay = boardLayout(doc, bs, gap);
  const spanW = lay.spanX;
  const spanH = lay.spanY;
  const padTop = opts.coords ? Math.max(18, cs * 1.1) : 6;
  const padLeft = opts.coords ? Math.max(20, cs * 1.2) : 6;
  const pad = 8;
  const gridW = spanW * cs;
  const gridH = spanH * cs;
  // 左右、上下留白对称，图纸落在画面正中间，不贴左上角
  const padRight = Math.max(pad, padLeft);
  const padBottom = Math.max(pad, padTop);
  const bodyW = padLeft + gridW + padRight;

  // 缩略图尺寸下（cs < 6）用量表会挤成一团，直接不画
  const detailed = cs >= 6;
  const rows = opts.legend && detailed ? usageRows(doc) : [];
  const legendScale = Math.max(0.55, Math.min(1.35, cs / 18));
  const leg = opts.legend && detailed ? legendMetrics(rows.length, bodyW - pad * 2, legendScale) : null;
  const wmH = opts.watermark && detailed ? watermarkHeight(legendScale) : 0;

  const w = bodyW;
  const h = padTop + gridH + padBottom + (leg ? leg.height : 0) + wmH;

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
    for (let x = 0; x < spanW; x++) {
      const px = padLeft + x * cs;
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, padTop + gridH);
    }
    for (let y = 0; y < spanH; y++) {
      const py = padTop + y * cs;
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
    // 每 5 格加深（不分板时才画，分板时由板框代替）
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 5) {
      const px = padLeft + x * cs;
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, padTop + height * cs);
    }
    for (let y = 0; y <= height; y += 5) {
      const py = padTop + y * cs;
      ctx.moveTo(padLeft, py);
      ctx.lineTo(padLeft + width * cs, py);
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
      ctx.fillText(String(x + 1), px, padTop / 2 + 1);
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

  // 水印：项目名 + 可点击地址
  if (opts.watermark && detailed) {
    const s = legendScale;
    const text = opts.watermarkText || DEFAULT_WATERMARK_TEXT;
    const url = opts.watermarkUrl || DEFAULT_WATERMARK_URL;
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(pad, cursorY + 2);
    ctx.lineTo(w - pad, cursorY + 2);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.font = `400 ${Math.round(8.4 * s)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
    ctx.fillText(text, pad, cursorY + wmH * 0.62);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.font = `400 ${Math.round(8 * s)}px ui-monospace, monospace`;
    ctx.fillText(url.replace(/^https?:\/\//, ''), w - pad, cursorY + wmH * 0.62);
  }

  // 用量表 / 水印区域在缩略图尺寸下会被压得看不清，干脆不画
  return canvas;
}

/**
 * 浏览器 canvas 的安全边界：单边 16384、总面积约 2.68 亿像素（Chrome 实测）。
 * 5000×5000 的图纸按默认 24px/格 会算出 12 万像素宽，必然失败，必须先把 cellSize 压下来。
 */
const CANVAS_MAX_EDGE = 16384;
const CANVAS_MAX_AREA = 240_000_000;

export function safeCellSize(width: number, height: number, want: number, pad = 64): number {
  const byEdge = Math.min(CANVAS_MAX_EDGE / Math.max(1, width), CANVAS_MAX_EDGE / Math.max(1, height));
  const byArea = Math.sqrt(CANVAS_MAX_AREA / Math.max(1, width * height));
  return Math.max(0.5, Math.min(want, byEdge, byArea, (CANVAS_MAX_EDGE - pad) / Math.max(1, Math.max(width, height))));
}

export async function exportPNG(doc: PatternDoc, opts: RenderOptions) {
  const cellSize = safeCellSize(doc.width, doc.height, opts.cellSize);
  const canvas = renderPatternCanvas(doc, { ...opts, cellSize });
  await new Promise<void>((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${safeFileName(doc.name)}.png`);
      resolve();
    }, 'image/png');
  });
}

export function buildSVG(doc: PatternDoc, opts: RenderOptions): string {
  const { width, height, cells, palette } = doc;
  const cs = Math.max(2, opts.cellSize);
  const bs = opts.boardSize ?? 0;
  const gap = opts.boardGap ?? 1.2;
  const lay = boardLayout(doc, bs, gap);
  const spanW = lay.spanX;
  const spanH = lay.spanY;
  const padTop = opts.coords ? 22 : 8;
  const padLeft = opts.coords ? 26 : 8;
  const pad = 8;
  // 四边留白对称，图纸落在正中间
  const padRight = Math.max(pad, padLeft);
  const padBottom = Math.max(pad, padTop);
  const bodyW = padLeft + spanW * cs + padRight;
  const gridH = spanH * cs;

  // 用量表与水印
  const rows = opts.legend ? usageRows(doc) : [];
  const s = Math.max(0.8, Math.min(1.6, cs / 18));
  const leg = opts.legend ? legendMetrics(rows.length, bodyW - pad * 2, s) : null;
  const wmH = opts.watermark ? watermarkHeight(s) : 0;

  const w = bodyW;
  const h = padTop + gridH + padBottom + (leg ? leg.height : 0) + wmH;
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
  out.push(`<g id="cells">`);
  const progressModeSvg = opts.progressStyle === 'placed';
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
      const op = done ? '' : ' fill-opacity="0.22"';
      if (opts.shape === 'circle') {
        const r = (cs / 2) * 0.94;
        out.push(
          `<circle cx="${(px + cs / 2).toFixed(2)}" cy="${(py + cs / 2).toFixed(2)}" r="${r.toFixed(2)}" fill="${c.hex}"${op}/>`,
        );
      } else {
        out.push(`<rect x="${px}" y="${py}" width="${cs}" height="${cs}" fill="${c.hex}"${op}/>`);
      }
      if (opts.holes && cs >= 8 && !(opts.showCodes && cs >= 9)) {
        out.push(
          `<circle cx="${px + cs / 2}" cy="${py + cs / 2}" r="${(cs * 0.13).toFixed(2)}" fill="#ffffff" fill-opacity="${done ? 0.62 : 0.14}"/>`,
        );
      }
      if (opts.showCodes && cs >= 9 && done) {
        // 纯填充，不做描边：小字号描边会糊成一团，用户反馈「看起来很模糊」
        const fs = Math.min(cs * 0.5, (cs * 0.88) / Math.max(1, c.code.length * 0.62), 15);
        if (fs >= 4.6) {
          out.push(
            `<text x="${(px + cs / 2).toFixed(2)}" y="${(py + cs / 2 + fs * 0.34).toFixed(2)}" text-anchor="middle" font-size="${fs.toFixed(1)}" font-weight="600" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" fill="${inkFor(c.hex)}">${escapeXml(c.code)}</text>`,
          );
        }
      }
    }
  }
  out.push(`</g>`);
  if (opts.grid) {
    out.push(`<g id="grid" stroke="rgba(0,0,0,0.18)" stroke-width="0.5">`);
    for (let x = 0; x <= spanW; x++) {
      const px = padLeft + x * cs;
      out.push(`<line x1="${px}" y1="${padTop}" x2="${px}" y2="${padTop + spanH * cs}"/>`);
    }
    for (let y = 0; y <= spanH; y++) {
      const py = padTop + y * cs;
      out.push(`<line x1="${padLeft}" y1="${py}" x2="${padLeft + spanW * cs}" y2="${py}"/>`);
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
  // 水印：项目名 + 可点击地址
  if (opts.watermark) {
    const text = opts.watermarkText || DEFAULT_WATERMARK_TEXT;
    const url = opts.watermarkUrl || DEFAULT_WATERMARK_URL;
    out.push(`<g id="watermark">`);
    out.push(
      `<line x1="${pad}" y1="${cursorY + 2}" x2="${w - pad}" y2="${cursorY + 2}" stroke="rgba(0,0,0,0.12)" stroke-width="0.7"/>`,
    );
    out.push(
      `<text x="${pad}" y="${cursorY + wmH * 0.68}" font-size="${8.4 * s}" fill="rgba(0,0,0,0.5)" font-family="'PingFang SC','Microsoft YaHei',system-ui,sans-serif">${escapeXml(text)}</text>`,
    );
    // 用 <a> 包住整段（署名 + 地址），SVG 在浏览器里打开可以直接点开项目。
    // 不再用蓝色、不再加下划线，整段同色，和图纸本身保持安静。
    out.push(
      `<a href="${escapeXml(url)}" target="_blank" rel="noopener"><text x="${pad}" y="${cursorY + wmH * 0.68}" font-size="${8.4 * s}" fill="rgba(0,0,0,0.38)" font-family="'PingFang SC','Microsoft YaHei',system-ui,sans-serif">${escapeXml(text)}  ${escapeXml(url.replace(/^https?:\/\//, ''))}</text></a>`,
    );
    out.push(`</g>`);
  }
  out.push(`</svg>`);
  return out.join('\n');
}

export function exportSVG(doc: PatternDoc, opts: RenderOptions) {
  const svg = buildSVG(doc, opts);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${safeFileName(doc.name)}.svg`);
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
   * tile   = 按每页格数分块
   */
  layout: 'single' | 'boards' | 'tile';
  maxCellsPerPage: number;
  withLegend: boolean;
  withHeader: boolean;
  /** 页脚打印 50mm 校准标尺，用来确认打印没有缩放 */
  calibration: boolean;
}

export const DEFAULT_PDF: Omit<PdfOptions, 'title'> = {
  ...DEFAULT_RENDER,
  pageSize: 'a4',
  orientation: 'auto',
  layout: 'single',
  maxCellsPerPage: 32,
  withLegend: false,
  withHeader: true,
  calibration: true,
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
      if (opts.showCodes && cell >= 2.8 && done) {
        // 色号直接印在豆子上，不垫白底块
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
    for (let x = 0; x <= cw; x++) {
      const px = gridX + x * cell;
      pdf.line(px, gridY, px, gridY + chh * cell);
    }
    for (let y = 0; y <= chh; y++) {
      const py = gridY + y * cell;
      pdf.line(gridX, py, gridX + cw * cell, py);
    }
  }

  // 每 5 格加粗（不分板时才需要，分板时由板框代替）
  if (opts.grid && bs === 0) {
    pdf.setDrawColor(130, 130, 142);
    pdf.setLineWidth(0.26);
    for (let x = 0; x <= cw; x += 5) {
      const px = gridX + x * cell;
      pdf.line(px, gridY, px, gridY + chh * cell);
    }
    for (let y = 0; y <= chh; y += 5) {
      const py = gridY + y * cell;
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

/** 页脚：50mm 校准标尺 + 打印提示 */
function pdfFooter(pdf: jsPDF, opts: PdfOptions, pw: number, ph: number, margin: number, pageText?: string) {
  const footY = ph - margin + 1;
  if (opts.calibration) {
    const mm = 50;
    const rx = margin;
    pdf.setDrawColor(60, 60, 72);
    pdf.setLineWidth(0.35);
    pdf.line(rx, footY, rx + mm, footY);
    pdf.line(rx, footY - 1.6, rx, footY + 1.6);
    pdf.line(rx + mm, footY - 1.6, rx + mm, footY + 1.6);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(90, 90, 105);
    pdf.text('50 mm', rx + mm / 2, footY - 2, { align: 'center' });
    pdfTextSafe(pdf, '打印请选「实际大小 / 100%」，并关闭「适合页面」', rx + mm + 5, footY + 0.6, {
      sizeMm: 2.3,
      color: [90, 90, 105],
    });
  }
  // 水印：一行淡灰小字 + 项目地址，和署名同一行、同一种灰，不加蓝、不加下划线，不抢眼。
  if (opts.watermark) {
    const text = opts.watermarkText || DEFAULT_WATERMARK_TEXT;
    const url = opts.watermarkUrl || DEFAULT_WATERMARK_URL;
    const wmY = opts.calibration ? footY - 5.4 : footY;
    const textW = pdfTextSafe(pdf, text, margin, wmY, { sizeMm: 2.3, color: [150, 150, 164] });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(150, 150, 164);
    const short = url.replace(/^https?:\/\//, '');
    // 地址直接接在署名后面、同一种淡灰（不加蓝、不加下划线），但仍然是一个可点的链接——
    // 用户明确要求「导出的 PDF 能直接点击跳转」，所以必须走 textWithLink 而不是 text。
    pdf.textWithLink(short, margin + textW + 2, wmY, { url, align: 'left' });
  }
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.setTextColor(150, 150, 165);
  if (pageText) pdf.text(pageText, pw - margin - 18, footY + 0.6, { align: 'right' });
  pdf.text('Perler Studio', pw - margin, footY + 0.6, { align: 'right' });
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
  const bottom = opts.calibration ? 13 : 6;
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
function pdfDrawLegend(pdf: jsPDF, doc: PatternDoc, x: number, y: number, availW: number): number {
  const rows = usageRows(doc);
  if (!rows.length) return 0;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const m = pdfLegendMetrics(rows.length, availW);
  pdfTextSafe(pdf, '色号用量', x, y + 5, { sizeMm: 4, bold: true, color: [40, 40, 52] });
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
    // 色号直接写在色块里，够大才看得清
    const sw = 12;
    const sh = 4.4;
    pdf.setFillColor(r, g, b);
    pdf.setDrawColor(170, 170, 182);
    pdf.setLineWidth(0.15);
    pdf.rect(cx, cy, sw, sh, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    const ink = readableTextColor(color.hex);
    const [ir, ig, ib] = ink === '#12141d' ? [27, 29, 33] : [255, 255, 255];
    pdf.setTextColor(ir, ig, ib);
    pdf.text(color.code, cx + sw / 2, cy + sh / 2 + 1.05, { align: 'center' });
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(50, 50, 64);
    // 颗数紧跟在色块右边，不要右对齐到列宽末尾——那样中间会空出一大段
    pdf.text(`${count}`, cx + sw + 2.6, cy + sh / 2 + 1.05, { align: 'left' });
  });
  return m.height;
}

/** 一张纸装下整张图纸：标题 + 坐标 + 板框 + 校准标尺 */
function pdfSinglePage(pdf: jsPDF, doc: PatternDoc, opts: PdfOptions, pw: number, ph: number, margin: number) {
  const bs = opts.boardSize ?? 0;
  const gap = opts.boardGap ?? 1.2;
  const lay = boardLayout(doc, bs, gap);

  if (opts.withHeader) {
    pdfTextSafe(pdf, doc.name || 'Perler Pattern', margin, margin + 4, { sizeMm: 4.2, bold: true });
    const beads = totalBeads(doc);
    const boardInfo = bs > 0 ? ` · ${lay.cols}×${lay.rows} 块 ${bs}×${bs} 板` : '';
    pdfTextSafe(
      pdf,
      `${doc.width} × ${doc.height} 格 · ${beads} 颗 · ${doc.palette.length} 色${boardInfo}`,
      margin,
      margin + 9,
      { sizeMm: 2.6, color: [110, 110, 125] },
    );
  }

  const g = pdfSingleGeometry(
    doc,
    opts,
    pw,
    ph,
    margin,
    lay.spanX,
    lay.spanY,
    opts.legend ? pdfLegendMetrics(usageRows(doc).length, pw - margin * 2).height + 3 : 0,
  );
  pdfDrawPattern(pdf, doc, opts, g.cell, g.gridX, g.gridY, lay);
  // 色号用量表贴在图纸下方，同一页里看得见每色用了多少颗
  if (opts.legend) {
    const legendY = Math.min(ph - margin - g.bottom - 20, g.gridY + lay.spanY * g.cell + 5);
    pdfDrawLegend(pdf, doc, margin, legendY, pw - margin * 2);
  }
  pdfFooter(pdf, opts, pw, ph, margin);
}

/** 从图纸里裁一块子图（预览分板 / 分块页用），palette 与进度保持不变 */
function subDoc(doc: PatternDoc, x0: number, y0: number, w: number, h: number): PatternDoc {
  const cells = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy >= doc.height) break;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx >= doc.width) break;
      cells[y * w + x] = doc.cells[sy * doc.width + sx];
    }
  }
  return { ...doc, width: w, height: h, cells };
}

export interface PdfPreviewOptions extends PdfOptions {
  /** 第几页（从 0 开始），默认第 1 页 */
  page?: number;
}

/**
 * PDF 纸张预览：把「一张纸」真实画出来，几何与 exportPDF 完全一致。
 * 返回的 canvas 就是最终 PDF 页面的样子（白纸 + 标题 + 图纸 + 坐标 + 校准尺）。
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
  let gridXmm: number;
  let gridYmm: number;
  let cellMm: number;
  // 预览里用量表与水印由页面层单独画（和 exportPDF 一样），图案绘制本身不画它们
  const patOnly = { ...opts, legend: false, watermark: false };
  let legendSpanMm = 0;

  if (opts.layout === 'single') {
    const bs = opts.boardSize ?? 0;
    const lay = boardLayout(doc, bs, opts.boardGap ?? 1.2);
    const legendH = opts.legend ? pdfLegendMetrics(usageRows(doc).length, pw - margin * 2).height + 3 : 0;
    const g = pdfSingleGeometry(doc, opts, pw, ph, margin, lay.spanX, lay.spanY, legendH);
    const boardInfo = bs > 0 ? ` · ${lay.cols}×${lay.rows} 块 ${bs}×${bs} 板` : '';
    drawHeader(
      doc.name || 'Perler Pattern',
      `${doc.width} × ${doc.height} 格 · ${totalBeads(doc)} 颗 · ${doc.palette.length} 色${boardInfo}`,
    );
    pattern = renderPatternCanvas(doc, { ...patOnly, cellSize: Math.max(1, M(g.cell)), background: null });
    gridXmm = g.gridX;
    gridYmm = g.gridY;
    cellMm = g.cell;
    legendSpanMm = lay.spanY * g.cell;
  } else if (opts.layout === 'boards') {
    const bs = Math.max(4, opts.boardSize || doc.pegboard || 29);
    const lay = boardLayout(doc, bs, 0);
    const total = lay.cols * lay.rows;
    const idx = Math.min(page, total - 1);
    const rx = idx % lay.cols;
    const ry = Math.floor(idx / lay.cols);
    const x0 = rx * bs;
    const y0 = ry * bs;
    const part = subDoc(doc, x0, y0, bs, bs);

    let top = margin;
    drawHeader(
      `${doc.name || 'Perler Pattern'} · 板 ${boardLabel(rx, ry)}`,
      `${doc.width} × ${doc.height} 格 · 板 ${idx + 1}/${total} · 第 ${y0 + 1}-${Math.min(doc.height, y0 + bs)} 行，第 ${x0 + 1}-${Math.min(doc.width, x0 + bs)} 列`,
    );
    if (opts.withHeader) top += 12.5;

    const coordPad = opts.coords ? 6 : 1.5;
    const coordTop = opts.coords ? 3.6 : 0.6;
    const bottom = opts.calibration ? 13 : 6;
    cellMm = Math.max(0.4, Math.min((pw - margin * 2 - coordPad) / bs, (ph - top - margin - bottom - coordTop) / bs));
    gridXmm = margin + coordPad;
    gridYmm = top + coordTop;
    pattern = renderPatternCanvas(part, { ...patOnly, cellSize: Math.max(1, M(cellMm)), background: null, boardSize: 0 });
  } else {
    const chunk = Math.max(8, Math.min(60, opts.maxCellsPerPage));
    const cols = Math.ceil(doc.width / chunk);
    const rows = Math.ceil(doc.height / chunk);
    const total = cols * rows;
    const idx = Math.min(page, total - 1);
    const rx = idx % cols;
    const ry = Math.floor(idx / cols);
    const x0 = rx * chunk;
    const y0 = ry * chunk;
    const cw = Math.min(chunk, doc.width - x0);
    const chh = Math.min(chunk, doc.height - y0);
    const part = subDoc(doc, x0, y0, cw, chh);

    let top = margin;
    drawHeader(
      `${doc.name || 'Perler Pattern'} · 第 ${idx + 1} 块`,
      `${doc.width} × ${doc.height} 格 · 块 ${idx + 1}/${total} · 第 ${y0 + 1}-${y0 + chh} 行，第 ${x0 + 1}-${x0 + cw} 列`,
    );
    if (opts.withHeader) top += 12.5;

    const coordPad = opts.coords ? 6 : 1.5;
    const coordTop = opts.coords ? 3.6 : 0.6;
    const bottom = opts.calibration ? 13 : 6;
    cellMm = Math.max(
      0.4,
      Math.min((pw - margin * 2 - coordPad) / cw, (ph - top - margin - bottom - coordTop) / chh),
    );
    gridXmm = margin + coordPad;
    gridYmm = top + coordTop;
    pattern = renderPatternCanvas(part, { ...patOnly, cellSize: Math.max(1, M(cellMm)), background: null, boardSize: 0 });
  }

  // 图纸：renderPatternCanvas 自带坐标留白，按同样留白对齐到页面网格原点
  const cellPx = Math.max(1, cellMm * pxPerMm);
  const padLeft = opts.coords ? Math.max(20, cellPx * 1.2) : 6;
  const padTop = opts.coords ? Math.max(18, cellPx * 1.1) : 6;
  ctx.drawImage(pattern, M(gridXmm) - padLeft, M(gridYmm) - padTop);

  // 单页预览：用量表贴在图纸下方
  if (opts.layout === 'single' && opts.legend) {
    const rows = usageRows(doc);
    if (rows.length) {
      const total = rows.reduce((acc, r) => acc + r.count, 0);
      const m = pdfLegendMetrics(rows.length, pw - margin * 2);
      const ly = Math.min(ph - margin - 20, gridYmm + legendSpanMm + 5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#282834';
      ctx.font = `600 ${Math.round(M(3.1) * 1.28)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
      ctx.fillText('色号用量', M(margin), M(ly + 4));
      ctx.textAlign = 'right';
      ctx.fillStyle = '#787888';
      ctx.font = `400 ${Math.round(M(2.6) * 1.28)}px ui-monospace, monospace`;
      ctx.fillText(`${rows.length} 色 · ${total} 颗`, M(pw - margin), M(ly + 4));
      ctx.textAlign = 'left';
      rows.forEach(({ color, count }, i) => {
        const col = i % m.cols;
        const line = Math.floor(i / m.cols);
        const cx = margin + col * m.colW;
        const cy = ly + m.headH + line * m.rowH;
        const sw = M(3.2);
        ctx.fillStyle = color.hex;
        ctx.fillRect(M(cx), M(cy), sw, sw);
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.lineWidth = 0.6;
        ctx.strokeRect(M(cx) + 0.3, M(cy) + 0.3, sw - 0.6, sw - 0.6);
        ctx.fillStyle = '#1e1e2a';
        const fs = Math.max(9, Math.round(M(2.4) * 1.3));
        ctx.font = `600 ${fs}px ui-monospace, monospace`;
        ctx.fillText(color.code, M(cx + 4.4), M(cy + 2.4));
        const cw2 = ctx.measureText(color.code).width;
        ctx.fillStyle = '#828292';
        ctx.font = `400 ${Math.max(8, Math.round(M(2.1) * 1.3))}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
        ctx.fillText(color.name, M(cx + 4.4) + cw2 + M(1.4), M(cy + 2.4));
        ctx.textAlign = 'right';
        ctx.fillStyle = '#3c3c4c';
        ctx.font = `400 ${Math.max(9, Math.round(M(2.3) * 1.3))}px ui-monospace, monospace`;
        ctx.fillText(String(count), M(cx + m.colW - 16), M(cy + 2.4));
        ctx.textAlign = 'left';
      });
    }
  }

  // 页脚：50mm 校准尺 + 提示
  const footY = M(ph - margin + 1);
  if (opts.calibration) {
    const mmPx = M(50);
    const rx = M(margin);
    ctx.strokeStyle = '#3c3c48';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rx, footY);
    ctx.lineTo(rx + mmPx, footY);
    ctx.moveTo(rx, footY - M(1.6));
    ctx.lineTo(rx, footY + M(1.6));
    ctx.moveTo(rx + mmPx, footY - M(1.6));
    ctx.lineTo(rx + mmPx, footY + M(1.6));
    ctx.stroke();
    ctx.fillStyle = '#5a5a69';
    ctx.font = `400 ${Math.round(M(2.3) * 1.3)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('50 mm', rx + mmPx / 2, footY - M(2.4));
    ctx.textAlign = 'left';
    ctx.fillText('打印请选「实际大小 / 100%」，并关闭「适合页面」', M(margin + 55), footY + M(0.6));
  }
  ctx.fillStyle = '#9696a5';
  ctx.textAlign = 'right';
  ctx.font = `400 ${Math.round(M(2.3))}px ui-monospace, monospace`;
  ctx.fillText('Perler Studio', M(pw - margin), footY + M(0.6));

  // 水印：预览里同样画出来，导出与预览保持一致。
  // 整行用同一种淡灰、不再用蓝色、不再加下划线，避免抢了图纸本身的视线。
  if (opts.watermark) {
    const text = opts.watermarkText || DEFAULT_WATERMARK_TEXT;
    const url = opts.watermarkUrl || DEFAULT_WATERMARK_URL;
    const wmY = opts.calibration ? footY - M(5.4) : footY;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8b8b99';
    ctx.font = `400 ${Math.round(M(2.4) * 1.3)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
    ctx.fillText(text, M(margin), wmY);
    const tw = ctx.measureText(text).width;
    const short = url.replace(/^https?:\/\//, '');
    ctx.font = `400 ${Math.round(M(2.3) * 1.3)}px ui-monospace, monospace`;
    ctx.fillText('  ' + short, M(margin) + tw, wmY);
    ctx.textAlign = 'left';
  }

  return canvas;
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
      const bottom = opts.calibration ? 13 : 6;
      const availW = pw - margin * 2 - coordPad;
      const availH = ph - top - margin - bottom - coordTop;
      // 关键：cell 一律按「完整一块板」算，边缘残缺板不放大，
      // 否则每页格子大小不同，打印后拼装对不上。
      const cell = Math.max(0.4, Math.min(availW / bs, availH / bs));
      // 板居中铺在纸上，不贴左上角
      const gridX = margin + coordPad + Math.max(0, (availW - bs * cell) / 2);
      const gridY = top + coordTop + Math.max(0, (availH - bs * cell) / 2);

      // 只画这块板：把整图坐标裁剪到板范围
      pdfDrawPattern(pdf, doc, { ...opts, boardSize: 0 }, cell, gridX, gridY, lay, {
        x0,
        x1,
        y0,
        y1,
      });

      // 板框固定按整块板画，残缺处留白，方便对位
      pdf.setDrawColor(217, 84, 30);
      pdf.setLineWidth(0.5);
      pdf.rect(gridX, gridY, bs * cell, bs * cell, 'S');

      // 拼装对位标记：板边缘中点的小三角
      const edgeW = bs * cell;
      const edgeH = bs * cell;
      pdf.setFillColor(217, 84, 30);
      const tri = Math.min(3, cell * 0.5);
      const midX = gridX + edgeW / 2;
      const midY = gridY + edgeH / 2;
      if (rx > 0) pdf.triangle(gridX, midY, gridX - tri, midY - tri, gridX - tri, midY + tri, 'F');
      if (rx < lay.cols - 1) pdf.triangle(gridX + edgeW, midY, gridX + edgeW + tri, midY - tri, gridX + edgeW + tri, midY + tri, 'F');
      if (ry > 0) pdf.triangle(midX, gridY, midX - tri, gridY - tri, midX + tri, gridY - tri, 'F');
      if (ry < lay.rows - 1) pdf.triangle(midX, gridY + edgeH, midX - tri, gridY + edgeH + tri, midX + tri, gridY + edgeH + tri, 'F');

      pdfFooter(pdf, opts, pw, ph, margin, `${pageIndex} / ${total}`);
    }
  }
}

/** 导出 PDF：默认整张图纸一页装下；也可一板一页 */
export function exportPDF(doc: PatternDoc, opts: PdfOptions) {
  const autoOrient: 'portrait' | 'landscape' = doc.width > doc.height ? 'landscape' : 'portrait';
  const orientation = opts.orientation === 'auto' ? autoOrient : opts.orientation;
  const pdf = new jsPDF({ orientation, unit: 'mm', format: opts.pageSize });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 12;

  if (opts.layout === 'single') {
    pdfSinglePage(pdf, doc, opts, pw, ph, margin);
  } else if (opts.layout === 'boards') {
    pdfBoardPages(pdf, doc, opts, pw, ph, margin);
  } else {
    const chunk = Math.max(8, Math.min(60, opts.maxCellsPerPage));
    const cols = Math.ceil(doc.width / chunk);
    const rows = Math.ceil(doc.height / chunk);
    const totalPages = cols * rows;
    let pageIndex = 0;

    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        if (pageIndex > 0) pdf.addPage();
        pageIndex++;
        const x0 = rx * chunk;
        const y0 = ry * chunk;
        const x1 = Math.min(doc.width, x0 + chunk);
        const y1 = Math.min(doc.height, y0 + chunk);
        const cw = x1 - x0;
        const chh = y1 - y0;

        let top = margin;
        if (opts.withHeader) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(13);
          pdf.setTextColor(20, 20, 28);
          pdf.text(doc.name || 'Perler Pattern', margin, top + 4);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          pdf.setTextColor(110, 110, 125);
          pdf.text(
            `${doc.width} x ${doc.height} beads  |  block ${rx + 1}-${ry + 1} of ${cols}-${rows}  |  cols ${x0 + 1}-${x1}, rows ${y0 + 1}-${y1}`,
            margin,
            top + 9,
          );
          top += 13;
        }

        const availW = pw - margin * 2;
        const availH = ph - top - margin;
        const cell = Math.min(availW / (cw + 1.6), availH / (chh + 1.6));
        // 分块也居中，避免每页都贴在左上角
        const gridX = margin + Math.max(0, (availW - cw * cell) / 2);
        const gridY = top + Math.max(0, (availH - chh * cell) / 2);

        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const v = doc.cells[y * doc.width + x];
            if (!v) continue;
            const c = doc.palette[v - 1];
            if (!c) continue;
            const { r, g, b } = hexRgb(c.hex);
            pdf.setFillColor(r, g, b);
            pdf.rect(gridX + (x - x0) * cell, gridY + (y - y0) * cell, cell, cell, 'F');
          }
        }

        pdf.setDrawColor(190, 190, 200);
        pdf.setLineWidth(0.12);
        for (let x = 0; x <= cw; x++) {
          const px = gridX + x * cell;
          pdf.line(px, gridY, px, gridY + chh * cell);
        }
        for (let y = 0; y <= chh; y++) {
          const py = gridY + y * cell;
          pdf.line(gridX, py, gridX + cw * cell, py);
        }
        pdf.setDrawColor(120, 120, 135);
        pdf.setLineWidth(0.32);
        for (let x = 0; x <= cw; x += 5) {
          const px = gridX + x * cell;
          pdf.line(px, gridY, px, gridY + chh * cell);
        }
        for (let y = 0; y <= chh; y += 5) {
          const py = gridY + y * cell;
          pdf.line(gridX, py, gridX + cw * cell, py);
        }

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(Math.max(4.5, Math.min(6.5, cell * 0.42)));
        pdf.setTextColor(90, 90, 105);
        for (let x = x0; x < x1; x++) {
          if ((x - x0) % 5 !== 0 && x !== x1 - 1) continue;
          pdf.text(String(x + 1), gridX + (x - x0) * cell + cell / 2, gridY - 1.2, { align: 'center' });
        }
        for (let y = y0; y < y1; y++) {
          if ((y - y0) % 5 !== 0 && y !== y1 - 1) continue;
          pdf.text(String(y + 1), gridX - 1.2, gridY + (y - y0) * cell + cell / 2 + 1, { align: 'right' });
        }

        pdf.setFontSize(7);
        pdf.setTextColor(150, 150, 165);
        pdf.text(`${pageIndex} / ${totalPages}`, pw - margin, ph - 4, { align: 'right' });
        pdf.text('Perler Studio', margin, ph - 4);
      }
    }
  }

  if (opts.withLegend) {
    const usage = usageOf(doc);
    const entries = Array.from(usage.entries()).sort((a, b) => b[1] - a[1]);
    const perPage = 26;
    for (let i = 0; i < entries.length; i += perPage) {
      pdf.addPage();
      pdfTextSafe(pdf, '色号用量清单', margin, margin + 6, { sizeMm: 4.2, bold: true });
      const slice = entries.slice(i, i + perPage);
      slice.forEach(([v, count], k) => {
        const c = doc.palette[v - 1];
        if (!c) return;
        const y = margin + 16 + k * 8;
        const { r, g, b } = hexRgb(c.hex);
        pdf.setFillColor(r, g, b);
        pdf.rect(margin, y - 4, 7, 7, 'F');
        pdf.setDrawColor(200, 200, 210);
        pdf.rect(margin, y - 4, 7, 7, 'S');
        pdfTextSafe(pdf, `${c.brand} ${c.code}  ${c.name}`, margin + 10, y + 1, { sizeMm: 3.2 });
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(30, 30, 40);
        pdf.text(`${count} pcs`, pw - margin, y + 1, { align: 'right' });
      });
    }
  }

  pdf.save(`${safeFileName(doc.name)}.pdf`);
}

function hexRgb(hex: string) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function exportCSV(doc: PatternDoc) {
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
  // 加 BOM 便于 Excel 识别中文
  downloadText('\ufeff' + rows.join('\n'), `${safeFileName(doc.name)}-用量.csv`, 'text/csv');
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
