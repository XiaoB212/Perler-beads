import qrcode from 'qrcode-generator';

/**
 * 二维码（QR Code）。
 *
 * 为什么要有它：进度分享链接是整张图纸压进 URL hash 的，图一大就是几千上万字符，
 * 微信 / Discord / 邮件里经常被截断，复制粘贴也容易少一个字符。
 * 二维码把这些字符全塞进一张图里，扫一下就行，不再受「链接太长」的限制。
 *
 * 用的是 qrcode-generator（MIT，零依赖，约 50KB，只在需要时同步生成矩阵），
 * 没有联网请求，也没有 canvas 之外的环境依赖。
 */

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

/** 生成二维码矩阵；字符超出容量时返回 null（调用方决定怎么降级） */
export function qrMatrix(text: string, level: QrLevel = 'M'): { count: number; isDark: (row: number, col: number) => boolean } | null {
  if (!text) return null;
  try {
    const qr = qrcode(0, level);
    qr.addData(text);
    qr.make();
    return { count: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) };
  } catch {
    return null;
  }
}

/** 内容装得下吗？装不下就别在导出件里留一块空白 */
export function qrFits(text: string, level: QrLevel = 'M'): boolean {
  return qrMatrix(text, level) !== null;
}

export interface QrRenderOptions {
  /** 每个模块多少像素（整数最好，避免边缘发虚） */
  moduleSize?: number;
  /** 四周静区，按模块数算。QR 规范要求至少 4，小于 2 会扫不出来 */
  margin?: number;
  /** 深色 / 浅色，默认纯黑纯白（对比度越高越好扫） */
  dark?: string;
  light?: string;
}

/** 画到 canvas：导出的 PNG / 面板里的预览都用它 */
export function renderQrCanvas(text: string, opts: QrRenderOptions = {}): HTMLCanvasElement | null {
  const m = qrMatrix(text, 'M');
  if (!m) return null;
  const quiet = Math.max(2, opts.margin ?? 3);
  const mod = Math.max(1, Math.round(opts.moduleSize ?? 4));
  const total = m.count + quiet * 2;
  const px = total * mod;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = opts.light ?? '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = opts.dark ?? '#12141d';
  for (let r = 0; r < m.count; r++) {
    for (let c = 0; c < m.count; c++) {
      if (m.isDark(r, c)) ctx.fillRect((c + quiet) * mod, (r + quiet) * mod, mod, mod);
    }
  }
  return canvas;
}

/** 二维码占多少像素（用来排版时预留空间） */
export function qrPixelSize(text: string, moduleSize = 4, margin = 3): number {
  const m = qrMatrix(text, 'M');
  if (!m) return 0;
  return (m.count + Math.max(2, margin) * 2) * Math.max(1, Math.round(moduleSize));
}

/** 生成一段可直接塞进 SVG 的 <g>，格子边对边不留缝，缩放不会出现白线 */
export function qrSvgGroup(text: string, x: number, y: number, size: number, opts: QrRenderOptions = {}): string | null {
  const m = qrMatrix(text, 'M');
  if (!m) return null;
  const quiet = Math.max(2, opts.margin ?? 3);
  const total = m.count + quiet * 2;
  const cell = size / total;
  const dark = opts.dark ?? '#12141d';
  const light = opts.light ?? '#ffffff';
  // 每行合并连续的黑格子，输出成一个 <path>，比 m.count² 个 <rect> 小一个数量级
  const cmds: string[] = [];
  for (let r = 0; r < m.count; r++) {
    let start = -1;
    for (let c = 0; c <= m.count; c++) {
      const on = c < m.count && m.isDark(r, c);
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        const px = x + (start + quiet) * cell;
        const py = y + (r + quiet) * cell;
        const pw = (c - start) * cell;
        cmds.push(`M${px.toFixed(2)} ${py.toFixed(2)}h${pw.toFixed(2)}v${cell.toFixed(2)}h${(-pw).toFixed(2)}z`);
        start = -1;
      }
    }
  }
  return [
    `<g id="qr">`,
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" fill="${light}" rx="${(cell * 2).toFixed(2)}"/>`,
    `<path d="${cmds.join('')}" fill="${dark}" shape-rendering="crispEdges"/>`,
    `</g>`,
  ].join('\n');
}

/** 下载二维码 PNG（面板里「存成图片」用） */
export function qrDataUrl(text: string, moduleSize = 8): string | null {
  const canvas = renderQrCanvas(text, { moduleSize });
  return canvas ? canvas.toDataURL('image/png') : null;
}
