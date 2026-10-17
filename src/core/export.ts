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
}

export const DEFAULT_RENDER: RenderOptions = {
  cellSize: 24,
  grid: true,
  coords: true,
  background: '#ffffff',
  holes: true,
  showCodes: false,
  dimUnplaced: false,
};

function inkFor(hex: string): string {
  return readableTextColor(hex);
}

/** 主渲染：把图纸画到 canvas */
export function renderPatternCanvas(doc: PatternDoc, opts: RenderOptions): HTMLCanvasElement {
  const { width, height, cells, palette } = doc;
  const cs = Math.max(2, opts.cellSize);
  const padTop = opts.coords ? Math.max(18, cs * 1.1) : 6;
  const padLeft = opts.coords ? Math.max(20, cs * 1.2) : 6;
  const pad = 8;
  const w = padLeft + width * cs + pad;
  const h = padTop + height * cs + pad;
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
      const px = padLeft + x * cs;
      const py = padTop + y * cs;
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
    for (let x = 0; x <= width; x++) {
      const px = padLeft + x * cs;
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, padTop + height * cs);
    }
    for (let y = 0; y <= height; y++) {
      const py = padTop + y * cs;
      ctx.moveTo(padLeft, py);
      ctx.lineTo(padLeft + width * cs, py);
    }
    ctx.stroke();
    // 每 5 格加深
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
      const px = padLeft + x * cs + cs / 2;
      ctx.fillText(String(x + 1), px, padTop / 2 + 1);
    }
    ctx.textAlign = 'right';
    for (let y = 0; y < height; y++) {
      const py = padTop + y * cs + cs / 2;
      ctx.fillText(String(y + 1), padLeft - 4, py);
    }
  }

  return canvas;
}

export async function exportPNG(doc: PatternDoc, opts: RenderOptions) {
  const canvas = renderPatternCanvas(doc, opts);
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
  const padTop = opts.coords ? 22 : 8;
  const padLeft = opts.coords ? 26 : 8;
  const pad = 8;
  const w = padLeft + width * cs + pad;
  const h = padTop + height * cs + pad;
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
      const px = padLeft + x * cs;
      const py = padTop + y * cs;
      out.push(`<rect x="${px}" y="${py}" width="${cs}" height="${cs}" fill="${c.hex}"/>`);
      if (opts.holes && cs >= 8) {
        out.push(
          `<circle cx="${px + cs / 2}" cy="${py + cs / 2}" r="${(cs * 0.13).toFixed(2)}" fill="#ffffff" fill-opacity="0.62"/>`,
        );
      }
    }
  }
  out.push(`</g>`);
  if (opts.grid) {
    out.push(`<g id="grid" stroke="rgba(0,0,0,0.18)" stroke-width="0.5">`);
    for (let x = 0; x <= width; x++) {
      const px = padLeft + x * cs;
      out.push(`<line x1="${px}" y1="${padTop}" x2="${px}" y2="${padTop + height * cs}"/>`);
    }
    for (let y = 0; y <= height; y++) {
      const py = padTop + y * cs;
      out.push(`<line x1="${padLeft}" y1="${py}" x2="${padLeft + width * cs}" y2="${py}"/>`);
    }
    out.push(`</g>`);
  }
  if (opts.coords) {
    out.push(`<g id="coords" fill="rgba(0,0,0,0.55)" font-size="${Math.max(7, Math.min(11, cs * 0.62))}">`);
    for (let x = 0; x < width; x++) {
      out.push(
        `<text x="${padLeft + x * cs + cs / 2}" y="${padTop / 2 + 4}" text-anchor="middle">${x + 1}</text>`,
      );
    }
    for (let y = 0; y < height; y++) {
      out.push(
        `<text x="${padLeft - 4}" y="${padTop + y * cs + cs / 2 + 4}" text-anchor="end">${y + 1}</text>`,
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
  orientation: 'portrait' | 'landscape';
  maxCellsPerPage: number;
  withLegend: boolean;
  withHeader: boolean;
}

export const DEFAULT_PDF: Omit<PdfOptions, 'title'> = {
  ...DEFAULT_RENDER,
  pageSize: 'a4',
  orientation: 'landscape',
  maxCellsPerPage: 32,
  withLegend: true,
  withHeader: true,
  cellSize: 16,
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

/** 导出可分页打印的 PDF 图纸 */
export function exportPDF(doc: PatternDoc, opts: PdfOptions) {
  const pdf = new jsPDF({ orientation: opts.orientation, unit: 'mm', format: opts.pageSize });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 10;
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

      // 单元格
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

      // 网格线
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
      // 每 5 格加粗
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

      // 坐标
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

      // 页脚
      pdf.setFontSize(7);
      pdf.setTextColor(150, 150, 165);
      pdf.text(`${pageIndex} / ${totalPages}`, pw - margin, ph - 4, { align: 'right' });
      pdf.text('Perler Studio', margin, ph - 4);
    }
  }

  if (opts.withLegend) {
    const usage = usageOf(doc);
    const entries = Array.from(usage.entries()).sort((a, b) => b[1] - a[1]);
    const perPage = 26;
    for (let i = 0; i < entries.length; i += perPage) {
      pdf.addPage();
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.setTextColor(20, 20, 28);
      pdf.text('Bead usage / 色号用量', margin, margin + 6);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
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
        pdf.setTextColor(30, 30, 40);
        pdf.text(`${c.brand} ${c.code}  ${c.name}`, margin + 10, y + 1);
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
    cellSize: Math.max(2, Math.floor(size / Math.max(doc.width, doc.height))),
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
