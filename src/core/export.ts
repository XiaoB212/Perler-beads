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
}

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
};

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

/** 主渲染：把图纸画到 canvas */
export function renderPatternCanvas(doc: PatternDoc, opts: RenderOptions): HTMLCanvasElement {
  const { width, height, cells, palette } = doc;
  // 允许小于 1px 的格宽：5000 格画布的缩略图只能靠亚像素缩小才画得下
  const cs = Math.max(0.35, opts.cellSize);
  const bs = opts.boardSize ?? 0;
  const gap = opts.boardGap ?? 1.2;
  const lay = boardLayout(doc, bs, gap);
  const spanW = lay.spanX;
  const spanH = lay.spanY;
  const padTop = opts.coords ? Math.max(18, cs * 1.1) : 6;
  const padLeft = opts.coords ? Math.max(20, cs * 1.2) : 6;
  const pad = 8;
  const w = padLeft + spanW * cs + pad;
  const h = padTop + spanH * cs + pad;
  const canvas = document.createElement('canvas');
  const dpr = 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }

  // 格子底色
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = cells[y * width + x];
      if (!v) continue;
      const c = palette[v - 1];
      if (!c) continue;
      const px = padLeft + lay.x[x] * cs;
      const py = padTop + lay.y[y] * cs;
      ctx.fillStyle = c.hex;
      ctx.fillRect(px, py, cs, cs);
      if (opts.holes && cs >= 9) {
        ctx.beginPath();
        ctx.arc(px + cs / 2, py + cs / 2, Math.max(0.8, cs * 0.13), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.62)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.14)';
        ctx.lineWidth = Math.max(0.4, cs * 0.03);
        ctx.stroke();
      }
      if (opts.showCodes && cs >= 22) {
        ctx.fillStyle = inkFor(c.hex);
        ctx.font = `600 ${Math.round(cs * 0.3)}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.code, px + cs / 2, py + cs * 0.82);
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
      ctx.lineTo(px, padTop + spanH * cs);
    }
    for (let y = 0; y < spanH; y++) {
      const py = padTop + y * cs;
      ctx.moveTo(padLeft, py);
      ctx.lineTo(padLeft + spanW * cs, py);
    }
    ctx.stroke();
  }

  // 分板：每块板单独描边 + 板号
  if (bs > 0) {
    for (let ry = 0; ry < lay.rows; ry++) {
      for (let rx = 0; rx < lay.cols; rx++) {
        const gx = rx * (bs + gap);
        const gy = ry * (bs + gap);
        const bw = Math.min(bs, width - rx * bs) * cs;
        const bh = Math.min(bs, height - ry * bs) * cs;
        const px = padLeft + gx * cs;
        const py = padTop + gy * cs;
        ctx.strokeStyle = 'rgba(217,84,30,0.85)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(px - 0.5, py - 0.5, bw + 1, bh + 1);
        ctx.fillStyle = 'rgba(217,84,30,0.95)';
        ctx.font = `700 ${Math.max(7, Math.min(11, cs * 0.55))}px ui-monospace, monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(boardLabel(rx, ry), px + 2, py + 2);
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
  const w = padLeft + spanW * cs + pad;
  const h = padTop + spanH * cs + pad;
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="ui-monospace, Menlo, monospace">`,
  );
  out.push(`<title>${escapeXml(opts.title || doc.name)}</title>`);
  if (opts.background) out.push(`<rect width="${w}" height="${h}" fill="${opts.background}"/>`);
  out.push(`<g id="cells">`);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = cells[y * width + x];
      if (!v) continue;
      const c = palette[v - 1];
      if (!c) continue;
      const px = padLeft + lay.x[x] * cs;
      const py = padTop + lay.y[y] * cs;
      out.push(`<rect x="${px}" y="${py}" width="${cs}" height="${cs}" fill="${c.hex}"/>`);
      if (opts.holes && cs >= 8) {
        out.push(
          `<circle cx="${px + cs / 2}" cy="${py + cs / 2}" r="${(cs * 0.13).toFixed(2)}" fill="#ffffff" fill-opacity="0.62"/>`,
        );
      }
      if (opts.showCodes && cs >= 20) {
        out.push(
          `<text x="${px + cs / 2}" y="${py + cs * 0.82}" text-anchor="middle" font-size="${Math.round(cs * 0.3)}" fill="${inkFor(c.hex)}">${escapeXml(c.code)}</text>`,
        );
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
  // 分板框 + 板号
  if (bs > 0) {
    out.push(`<g id="boards" fill="none" stroke="rgba(217,84,30,0.9)" stroke-width="1.4">`);
    for (let ry = 0; ry < lay.rows; ry++) {
      for (let rx = 0; rx < lay.cols; rx++) {
        const bw = Math.min(bs, width - rx * bs) * cs;
        const bh = Math.min(bs, height - ry * bs) * cs;
        const px = padLeft + rx * (bs + gap) * cs;
        const py = padTop + ry * (bs + gap) * cs;
        out.push(`<rect x="${px}" y="${py}" width="${bw}" height="${bh}"/>`);
      }
    }
    out.push(`</g>`);
    out.push(
      `<g id="board-labels" fill="rgba(217,84,30,0.95)" font-size="${Math.max(7, Math.min(11, cs * 0.55))}" font-weight="700">`,
    );
    for (let ry = 0; ry < lay.rows; ry++) {
      for (let rx = 0; rx < lay.cols; rx++) {
        const px = padLeft + rx * (bs + gap) * cs;
        const py = padTop + ry * (bs + gap) * cs;
        out.push(`<text x="${px + 2}" y="${py + Math.max(7, Math.min(11, cs * 0.55)) + 2}">${boardLabel(rx, ry)}</text>`);
      }
    }
    out.push(`</g>`);
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
  showCodes: false,
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
) {
  const { sizeMm, bold = false, color = [24, 24, 32], align = 'left' } = opts;
  if (!/[^\x00-\x7f]/.test(text)) {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(sizeMm * 2.8346);
    pdf.setTextColor(color[0], color[1], color[2]);
    pdf.text(text, xMm, yMm, { align });
    return;
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

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = doc.cells[y * doc.width + x];
      if (!v) continue;
      const c = doc.palette[v - 1];
      if (!c) continue;
      const { r, g, b } = hexRgb(c.hex);
      pdf.setFillColor(r, g, b);
      pdf.rect(gridX + (lay.x[x] - ox) * cell, gridY + (lay.y[y] - oy) * cell, cell, cell, 'F');
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

  // 分板框 + 板号
  if (bs > 0) {
    for (let ry = 0; ry < lay.rows; ry++) {
      for (let rx = 0; rx < lay.cols; rx++) {
        const bx0 = rx * bs;
        const by0 = ry * bs;
        if (bx0 >= x1 || by0 >= y1 || bx0 + bs <= x0 || by0 + bs <= y0) continue;
        const bw = Math.min(bs, doc.width - bx0) * cell;
        const bh = Math.min(bs, doc.height - by0) * cell;
        const px = gridX + (lay.x[bx0] - ox) * cell;
        const py = gridY + (lay.y[by0] - oy) * cell;
        pdf.setDrawColor(217, 84, 30);
        pdf.setLineWidth(0.45);
        pdf.rect(px, py, bw, bh, 'S');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(Math.max(5, Math.min(9, cell * 0.62)));
        pdf.setTextColor(217, 84, 30);
        pdf.text(boardLabel(rx, ry), px + 0.8, py + Math.max(3.2, cell * 0.6));
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
): PdfPageGeometry {
  let top = margin;
  if (opts.withHeader) top += 13;
  const coordPad = opts.coords ? 6 : 1.5;
  const coordTop = opts.coords ? 3.6 : 0.6;
  const bottom = opts.calibration ? 13 : 6;
  const availW = pw - margin * 2 - coordPad;
  const availH = ph - top - margin - bottom - coordTop;
  const cell = Math.max(0.4, Math.min(availW / spanW, availH / spanH));
  // 垂直居中：短边方向不贴着页头，避免下半页大片空白
  const leftover = Math.max(0, availH - spanH * cell);
  const gridY = top + coordTop + leftover / 2;
  return { pw, ph, margin, top, coordPad, coordTop, bottom, cell, gridX: margin + coordPad, gridY };
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

  const g = pdfSingleGeometry(doc, opts, pw, ph, margin, lay.spanX, lay.spanY);
  pdfDrawPattern(pdf, doc, opts, g.cell, g.gridX, g.gridY, lay);
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

  if (opts.layout === 'single') {
    const bs = opts.boardSize ?? 0;
    const lay = boardLayout(doc, bs, opts.boardGap ?? 1.2);
    const g = pdfSingleGeometry(doc, opts, pw, ph, margin, lay.spanX, lay.spanY);
    const boardInfo = bs > 0 ? ` · ${lay.cols}×${lay.rows} 块 ${bs}×${bs} 板` : '';
    drawHeader(
      doc.name || 'Perler Pattern',
      `${doc.width} × ${doc.height} 格 · ${totalBeads(doc)} 颗 · ${doc.palette.length} 色${boardInfo}`,
    );
    pattern = renderPatternCanvas(doc, { ...opts, cellSize: Math.max(1, M(g.cell)), background: null });
    gridXmm = g.gridX;
    gridYmm = g.gridY;
    cellMm = g.cell;
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
    pattern = renderPatternCanvas(part, { ...opts, cellSize: Math.max(1, M(cellMm)), background: null, boardSize: 0 });
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
    pattern = renderPatternCanvas(part, { ...opts, cellSize: Math.max(1, M(cellMm)), background: null, boardSize: 0 });
  }

  // 图纸：renderPatternCanvas 自带坐标留白，按同样留白对齐到页面网格原点
  const cellPx = Math.max(1, cellMm * pxPerMm);
  const padLeft = opts.coords ? Math.max(20, cellPx * 1.2) : 6;
  const padTop = opts.coords ? Math.max(18, cellPx * 1.1) : 6;
  ctx.drawImage(pattern, M(gridXmm) - padLeft, M(gridYmm) - padTop);

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
      const gridX = margin + coordPad;
      const gridY = top + coordTop;

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
        const gridX = margin + cell * 1.6;
        const gridY = top;

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
