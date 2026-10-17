import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, bresenham } from '../core/store';
import { stageColors, type ResolvedTheme } from '../core/theme';
import { readableTextColor } from '../core/color';
import { boardGuideLines, boardLabel, focusRect } from '../core/board';
import type { PatternDoc } from '../core/types';

interface Props {
  doc: PatternDoc;
  theme?: ResolvedTheme;
}

type DragMode = 'paint' | 'erase' | 'pan' | 'shape' | 'progress' | null;

/** 圆角矩形路径（兼容不支持 ctx.roundRect 的浏览器） */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export default function CanvasStage({ doc, theme = 'dark' }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const C = useMemo(() => stageColors(theme), [theme]);
  // 初始为 0：必须等 ResizeObserver 量到真实尺寸再画/适配，
  // 否则会用假尺寸算「适应窗口」，在手机上把图纸裁掉
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [spaceDown, setSpaceDown] = useState(false);

  const tool = useEditor((s) => s.tool);
  const colorIndex = useEditor((s) => s.colorIndex);
  const brushSize = useEditor((s) => s.brushSize);
  const flags = useEditor((s) => s.flags);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const hover = useEditor((s) => s.hover);
  const focus = useEditor((s) => s.focus);
  const focusOnCell = useEditor((s) => s.focusOnCell);
  const setFocus = useEditor((s) => s.setFocus);
  const setZoom = useEditor((s) => s.setZoom);
  const setPan = useEditor((s) => s.setPan);
  const setHover = useEditor((s) => s.setHover);
  const setColorIndex = useEditor((s) => s.setColorIndex);
  const notify = useEditor((s) => s.notify);

  const dragRef = useRef<{
    mode: DragMode;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
    pointerId: number;
  } | null>(null);

  const [shapePreview, setShapePreview] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // 双指缩放（触屏）：记录活动指针与手势起点
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    dist: number;
    zoom: number;
    localX: number;
    localY: number;
  } | null>(null);

  // 容器尺寸
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const cell = zoom;
  const originX = useMemo(() => {
    const boardW = doc.width * cell;
    return Math.round((size.w - boardW) / 2 + pan.x);
  }, [size.w, doc.width, cell, pan.x]);
  const originY = useMemo(() => {
    const boardH = doc.height * cell;
    return Math.round((size.h - boardH) / 2 + pan.y);
  }, [size.h, doc.height, cell, pan.y]);

  const cellFromEvent = useCallback(
    (e: React.PointerEvent | React.MouseEvent | PointerEvent): { x: number; y: number } => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      return {
        x: Math.floor((px - originX) / cell),
        y: Math.floor((py - originY) / cell),
      };
    },
    [originX, originY, cell],
  );

  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < doc.width && y < doc.height;

  // 首次进入 / 切换图纸时，若画布超出可视区则自动适应窗口
  const fittedRef = useRef<string>('');
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useEffect(() => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    const key = `${doc.id}:${doc.width}x${doc.height}`;
    if (fittedRef.current === key) return;
    fittedRef.current = key;
    // 预留顶栏 chip 条与底部缩放条的高度
    const padX = w < 700 ? 24 : 72;
    const padY = h < 560 ? 96 : 72;
    const fit = Math.min((w - padX) / doc.width, (h - padY) / doc.height);
    const s = useEditor.getState();
    if (fit < s.zoom) {
      s.setZoom(Math.max(2, Math.min(40, fit)));
      s.setPan({ x: 0, y: 0 });
    }
    // 依赖里带上容器尺寸：移动端首次测量为 0 时这里会提前返回，
    // 必须等 ResizeObserver 给出真实尺寸后再算一次，否则手机上会裁掉图纸。
  }, [doc.id, doc.width, doc.height, size.w, size.h]);

  // ===== 主画布绘制 =====
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(size.w * dpr));
    canvas.height = Math.max(1, Math.floor(size.h * dpr));
    canvas.style.width = size.w + 'px';
    canvas.style.height = size.h + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const boardW = doc.width * cell;
    const boardH = doc.height * cell;

    // 画布底板阴影
    ctx.save();
    ctx.shadowColor = C.shadow;
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = C.board;
    roundRect(ctx, originX - 3, originY - 3, boardW + 6, boardH + 6, 8);
    ctx.fill();
    ctx.restore();

    // 棋盘格空底
    const step = Math.max(8, cell);
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, originX, originY, boardW, boardH, 6);
    ctx.clip();
    // 只画视口内的格子：300×300 的大画布有 9 万格，全量遍历每帧要几十毫秒
    const vx0 = Math.max(0, Math.floor((0 - originX) / cell) - 1);
    const vx1 = Math.min(doc.width - 1, Math.ceil((size.w - originX) / cell) + 1);
    const vy0 = Math.max(0, Math.floor((0 - originY) / cell) - 1);
    const vy1 = Math.min(doc.height - 1, Math.ceil((size.h - originY) / cell) + 1);

    // 按颜色归批：同色格子合成一条 path，一次 fill，避免每格都切 fillStyle。
    // 豆子孔与对勾也各自合成一条 path，只画一次。
    const dimMode = flags.progressMode && flags.dimUnplaced;
    const byColor = new Map<string, Path2D>();
    const byColorDim = new Map<string, Path2D>();
    const holes = new Path2D();
    const checks = new Path2D();
    const holeR = Math.max(0.9, cell * 0.14);
    const drawHoles = flags.beadHoles && cell >= 8;
    // 色号：格子在屏幕上够大才画得下，否则会糊成一团
    const drawCodes = flags.showCodes && cell >= 17;
    const codeCells: { x: number; y: number; code: string; hex: string }[] = [];
    const emptyEven = new Path2D();
    const emptyOdd = new Path2D();
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        const px = originX + x * cell;
        const py = originY + y * cell;
        const v = doc.cells[y * doc.width + x];
        if (!v) {
          ((x + y) % 2 === 0 ? emptyEven : emptyOdd).rect(px, py, step, step);
          continue;
        }
        const c = doc.palette[v - 1];
        if (!c) continue;
        const placed = doc.progress[y * doc.width + x] === 1;
        const dim = dimMode && !placed;
        const bucket = dim ? byColorDim : byColor;
        let p = bucket.get(c.hex);
        if (!p) {
          p = new Path2D();
          bucket.set(c.hex, p);
        }
        p.rect(px, py, step, step);
        if (drawHoles) {
          const hx = px + cell / 2;
          const hy = py + cell / 2;
          holes.moveTo(hx + holeR, hy);
          holes.arc(hx, hy, holeR, 0, Math.PI * 2);
        }
        if (drawCodes && !dim) codeCells.push({ x: px, y: py, code: c.code, hex: c.hex });
        if (placed && flags.progressMode) {
          checks.moveTo(px + cell * 0.22, py + cell * 0.52);
          checks.lineTo(px + cell * 0.42, py + cell * 0.74);
          checks.lineTo(px + cell * 0.8, py + cell * 0.26);
        }
      }
    }
    ctx.fillStyle = C.emptyA;
    ctx.fill(emptyEven);
    ctx.fillStyle = C.emptyB;
    ctx.fill(emptyOdd);
    for (const [hex, p] of byColor) {
      ctx.fillStyle = hex;
      ctx.fill(p);
    }
    ctx.globalAlpha = 0.32;
    for (const [hex, p] of byColorDim) {
      ctx.fillStyle = hex;
      ctx.fill(p);
    }
    ctx.globalAlpha = 1;
    if (drawHoles) {
      ctx.fillStyle = C.hole;
      ctx.fill(holes);
      ctx.strokeStyle = theme === 'light' ? 'rgba(20,24,30,0.1)' : 'rgba(0,0,0,0.18)';
      ctx.lineWidth = Math.max(0.4, cell * 0.035);
      ctx.stroke(holes);
    }
    if (drawCodes && codeCells.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(Math.min(cell * 0.42, 13))}px ui-monospace, monospace`;
      for (const cc of codeCells) {
        ctx.fillStyle = readableTextColor(cc.hex);
        ctx.fillText(cc.code, cc.x + cell / 2, cc.y + cell * (drawHoles ? 0.72 : 0.52));
      }
    }
    if (flags.progressMode) {
      ctx.strokeStyle = C.check;
      ctx.lineWidth = Math.max(1.2, cell * 0.09);
      ctx.stroke(checks);
    }
    ctx.restore();

    // 网格
    if (flags.grid && cell >= 4) {
      ctx.beginPath();
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      for (let x = 0; x <= doc.width; x++) {
        const px = Math.round(originX + x * cell) + 0.5;
        ctx.moveTo(px, originY);
        ctx.lineTo(px, originY + boardH);
      }
      for (let y = 0; y <= doc.height; y++) {
        const py = Math.round(originY + y * cell) + 0.5;
        ctx.moveTo(originX, py);
        ctx.lineTo(originX + boardW, py);
      }
      ctx.stroke();
      // 每 5 格加深：分板时由板内细线 + 板边界代替，避免两套线叠在一起
      if (!(flags.pegboard && doc.pegboard > 0)) {
        ctx.beginPath();
        ctx.strokeStyle = C.gridStrong;
        ctx.lineWidth = 1;
        for (let x = 0; x <= doc.width; x += 5) {
          const px = Math.round(originX + x * cell) + 0.5;
          ctx.moveTo(px, originY);
          ctx.lineTo(px, originY + boardH);
        }
        for (let y = 0; y <= doc.height; y += 5) {
          const py = Math.round(originY + y * cell) + 0.5;
          ctx.moveTo(originX, py);
          ctx.lineTo(originX + boardW, py);
        }
        ctx.stroke();
      }
    }

    // 拼豆板分界：板内每 5 格一条细线 + 板边界一条粗线。
    // 学自 Jett-Wu/Perler_Beads_Generator 的 guideLineCenters：
    // 29 格板的 5 格线应该相对「每块板的起点」数（5/10/15/20/25），
    // 而不是全局 5/10/…，否则线会横穿板边界，看着像尺寸画错了。
    if (flags.pegboard && doc.pegboard > 0) {
      const bs = doc.pegboard;
      const innerX = boardGuideLines(doc.width, bs);
      const innerY = boardGuideLines(doc.height, bs);

      // 板内细分线：先铺一层细线，再单独描板边界，两者层级分明
      ctx.beginPath();
      ctx.strokeStyle = C.gridStrong;
      ctx.lineWidth = 1;
      for (const gx of innerX) {
        const px = Math.round(originX + gx * cell) + 0.5;
        ctx.moveTo(px, originY);
        ctx.lineTo(px, originY + boardH);
      }
      for (const gy of innerY) {
        const py = Math.round(originY + gy * cell) + 0.5;
        ctx.moveTo(originX, py);
        ctx.lineTo(originX + boardW, py);
      }
      ctx.stroke();

      // 板边界：奇偶交替实线 / 虚线，方便一眼数清第几块板
      ctx.strokeStyle = C.pegboard;
      let edgeIndex = 0;
      for (let x = bs; x < doc.width; x += bs) {
        const px = Math.round(originX + x * cell) + 0.5;
        ctx.beginPath();
        ctx.lineWidth = 1.8;
        ctx.setLineDash(edgeIndex % 2 === 0 ? [] : [5, 4]);
        ctx.moveTo(px, originY);
        ctx.lineTo(px, originY + boardH);
        ctx.stroke();
        edgeIndex++;
      }
      edgeIndex = 0;
      for (let y = bs; y < doc.height; y += bs) {
        const py = Math.round(originY + y * cell) + 0.5;
        ctx.beginPath();
        ctx.lineWidth = 1.8;
        ctx.setLineDash(edgeIndex % 2 === 0 ? [] : [5, 4]);
        ctx.moveTo(originX, py);
        ctx.lineTo(originX + boardW, py);
        ctx.stroke();
        edgeIndex++;
      }
      ctx.setLineDash([]);

      // 板号 A1 / B2：格够大才画，否则糊成一团
      if (flags.boardIds && cell >= 9) {
        const fs = Math.max(8, Math.min(13, cell * 0.5));
        ctx.font = `700 ${fs}px ui-monospace, monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const cols = Math.ceil(doc.width / bs);
        const rows = Math.ceil(doc.height / bs);
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const px = originX + col * bs * cell + 3;
            const py = originY + row * bs * cell + 2;
            const label = boardLabel(col, row);
            // 描一圈底色再写字，压在豆子上也读得清
            ctx.lineWidth = 3;
            ctx.strokeStyle = C.board;
            ctx.strokeText(label, px, py);
            ctx.fillStyle = C.pegboard;
            ctx.fillText(label, px, py);
          }
        }
      }
    }

    // 对称轴
    if (flags.symmetryX || flags.symmetryY) {
      ctx.strokeStyle = C.symmetry;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      if (flags.symmetryX) {
        const px = Math.round(originX + (doc.width / 2) * cell) + 0.5;
        ctx.moveTo(px, originY - 8);
        ctx.lineTo(px, originY + boardH + 8);
      }
      if (flags.symmetryY) {
        const py = Math.round(originY + (doc.height / 2) * cell) + 0.5;
        ctx.moveTo(originX - 8, py);
        ctx.lineTo(originX + boardW + 8, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 外框
    ctx.strokeStyle = C.gridStrong;
    ctx.lineWidth = 1.5;
    roundRect(ctx, originX - 0.5, originY - 0.5, boardW + 1, boardH + 1, 6);
    ctx.stroke();

    // 聚焦某一块板时，把其他板压暗 + 框出当前板
    if (focus && doc.pegboard > 0) {
      const fr = focusRect(focus, doc.width, doc.height);
      const fx = originX + fr.x * cell;
      const fy = originY + fr.y * cell;
      const fw = fr.w * cell;
      const fh = fr.h * cell;
      ctx.save();
      // evenodd 挖洞：只压暗当前板以外的区域，不用逐格算
      ctx.beginPath();
      ctx.rect(originX, originY, boardW, boardH);
      ctx.rect(fx, fy, fw, fh);
      ctx.fillStyle = theme === 'light' ? 'rgba(246,246,243,0.74)' : 'rgba(14,16,19,0.72)';
      ctx.fill('evenodd');
      ctx.strokeStyle = C.pegboard;
      ctx.lineWidth = 2.4;
      ctx.strokeRect(fx + 1, fy + 1, fw - 2, fh - 2);
      ctx.restore();
    }

    // 标尺
    if (flags.rulers && cell >= 6) {
      ctx.fillStyle = C.ruler;
      ctx.font = '500 9.5px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 格越小标签越稀：至少留 34px 才写得下一个 3 位数，否则挤成一团
      const labelEvery = Math.max(5, Math.ceil(Math.ceil(34 / cell) / 5) * 5);
      for (let x = 0; x <= doc.width; x++) {
        const px = originX + x * cell;
        if (px < 6 || px > size.w - 6) continue;
        if (x % 5 === 0) {
          ctx.fillRect(px - 0.5, originY - 12, 1, 5);
          if (x > 0 && x % labelEvery === 0) ctx.fillText(String(x), px, originY - 20);
        } else if (cell >= 12) {
          ctx.fillRect(px - 0.5, originY - 9, 1, 3);
        }
      }
      ctx.textAlign = 'right';
      for (let y = 0; y <= doc.height; y++) {
        const py = originY + y * cell;
        if (py < 6 || py > size.h - 6) continue;
        if (y % 5 === 0) {
          ctx.fillRect(originX - 12, py - 0.5, 5, 1);
          if (y > 0 && y % labelEvery === 0) ctx.fillText(String(y), originX - 16, py);
        } else if (cell >= 12) {
          ctx.fillRect(originX - 9, py - 0.5, 3, 1);
        }
      }
    }
  }, [doc, size, cell, originX, originY, flags, C, theme, focus]);

  // ===== 覆盖层（光标 / 形状预览） =====
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(size.w * dpr));
    canvas.height = Math.max(1, Math.floor(size.h * dpr));
    canvas.style.width = size.w + 'px';
    canvas.style.height = size.h + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const drawCellRect = (x: number, y: number, color: string, w = 1, h = 1) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(originX + x * cell + 1, originY + y * cell + 1, cell * w - 2, cell * h - 2);
    };

    if (shapePreview) {
      const { x0, y0, x1, y1 } = shapePreview;
      const minX = Math.min(x0, x1);
      const minY = Math.min(y0, y1);
      const w = Math.abs(x1 - x0) + 1;
      const h = Math.abs(y1 - y0) + 1;
      ctx.fillStyle = theme === 'light' ? 'rgba(217,84,30,0.16)' : 'rgba(255,138,76,0.2)';
      ctx.fillRect(originX + minX * cell, originY + minY * cell, w * cell, h * cell);
      ctx.strokeStyle = theme === 'light' ? 'rgba(217,84,30,0.9)' : 'rgba(255,168,110,0.95)';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(originX + minX * cell + 0.5, originY + minY * cell + 0.5, w * cell - 1, h * cell - 1);
    }

    const accentLine = theme === 'light' ? 'rgba(217,84,30,0.95)' : 'rgba(255,138,76,0.95)';
    const cursorLine = theme === 'light' ? 'rgba(20,24,30,0.75)' : 'rgba(255,255,255,0.92)';
    const symLine = theme === 'light' ? 'rgba(20,140,160,0.6)' : 'rgba(77,212,255,0.55)';

    if (hover && inBounds(hover.x, hover.y) && tool !== 'pan') {
      const r = Math.floor((brushSize - 1) / 2);
      if (tool === 'bucket') {
        drawCellRect(hover.x, hover.y, accentLine);
      } else if (tool === 'picker') {
        drawCellRect(hover.x, hover.y, theme === 'light' ? 'rgba(90,60,190,0.9)' : 'rgba(150,124,255,0.95)');
      } else if (tool === 'pencil' || tool === 'eraser' || tool === 'line' || tool === 'move') {
        const x0 = Math.max(0, hover.x - r);
        const y0 = Math.max(0, hover.y - r);
        const x1 = Math.min(doc.width - 1, hover.x + r);
        const y1 = Math.min(doc.height - 1, hover.y + r);
        drawCellRect(x0, y0, tool === 'eraser' ? 'rgba(255,92,108,0.95)' : cursorLine, x1 - x0 + 1, y1 - y0 + 1);
        if (flags.symmetryX) {
          const sx = doc.width - 1 - hover.x;
          drawCellRect(sx - (x1 - hover.x), y0, symLine, x1 - x0 + 1, y1 - y0 + 1);
        }
        if (flags.symmetryY) {
          const sy = doc.height - 1 - hover.y;
          drawCellRect(x0, sy - (y1 - hover.y), symLine, x1 - x0 + 1, y1 - y0 + 1);
        }
      } else {
        drawCellRect(hover.x, hover.y, cursorLine);
      }
    }
  }, [hover, shapePreview, size, originX, originY, cell, tool, brushSize, flags, doc.width, doc.height, theme]);

  // ===== 交互 =====
  const startPaint = (x: number, y: number, shift: boolean) => {
    const s = useEditor.getState();
    if (s.flags.progressMode) {
      const i = y * doc.width + x;
      const target = doc.cells[i] && doc.progress[i] ? 0 : 1;
      s.progressTarget = target;
      s.beginStroke();
      s.paintProgressCell(x, y, target);
      return;
    }
    s.beginStroke();
    if (tool === 'eraser') s.paintCell(x, y, { value: 0 });
    else if (tool === 'bucket') s.floodFill(x, y);
    else s.paintCell(x, y);
    void shift;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 第二根手指落下 → 进入双指缩放，并撤销刚才单指可能已经落下的笔
    if (pointersRef.current.size === 2) {
      if (dragRef.current) {
        if (dragRef.current.mode !== 'pan') useEditor.getState().endStroke();
        dragRef.current = null;
        setShapePreview(null);
      }
      const [a, b] = [...pointersRef.current.values()];
      const rect = canvas.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom: cell,
        localX: (midX - originX) / cell,
        localY: (midY - originY) / cell,
      };
      setHover(null);
      return;
    }

    const { x, y } = cellFromEvent(e);
    const isPan = tool === 'pan' || spaceDown || e.button === 1 || e.button === 2;
    if (isPan) {
      dragRef.current = {
        mode: 'pan',
        lastX: e.clientX,
        lastY: e.clientY,
        startX: x,
        startY: y,
        startPan: { ...pan },
        pointerId: e.pointerId,
      };
      return;
    }
    if (!inBounds(x, y)) return;
    const s = useEditor.getState();

    if (tool === 'picker') {
      const v = doc.cells[y * doc.width + x];
      if (v) {
        setColorIndex(v - 1);
        notify('已取色');
      }
      return;
    }

    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      dragRef.current = {
        mode: 'shape',
        lastX: x,
        lastY: y,
        startX: x,
        startY: y,
        startPan: { ...pan },
        pointerId: e.pointerId,
      };
      setShapePreview({ x0: x, y0: y, x1: x, y1: y });
      return;
    }

    startPaint(x, y, e.shiftKey);
    dragRef.current = {
      mode: s.flags.progressMode ? 'progress' : tool === 'eraser' ? 'erase' : 'paint',
      lastX: x,
      lastY: y,
      startX: x,
      startY: y,
      startPan: { ...pan },
      pointerId: e.pointerId,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 双指缩放：以两指中点为锚点
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const rect = canvasRef.current!.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      const next = Math.max(2, Math.min(48, pinch.zoom * (dist / pinch.dist)));
      const boardW = doc.width * next;
      const boardH = doc.height * next;
      setZoom(next);
      setPan({
        x: midX - pinch.localX * next - (size.w - boardW) / 2,
        y: midY - pinch.localY * next - (size.h - boardH) / 2,
      });
      return;
    }

    const { x, y } = cellFromEvent(e);
    if (!hover || hover.x !== x || hover.y !== y) setHover(inBounds(x, y) ? { x, y } : null);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'pan') {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      setPan({ x: drag.startPan.x + dx, y: drag.startPan.y + dy });
      return;
    }
    if (drag.mode === 'shape') {
      const cx = Math.max(0, Math.min(doc.width - 1, x));
      const cy = Math.max(0, Math.min(doc.height - 1, y));
      setShapePreview({ x0: drag.startX, y0: drag.startY, x1: cx, y1: cy });
      return;
    }
    if (!inBounds(x, y)) return;
    if (drag.mode === 'progress') {
      const s = useEditor.getState();
      s.paintProgressCell(x, y, s.progressTarget);
    } else if (drag.mode === 'erase') {
      const s = useEditor.getState();
      s.paintCell(x, y, { value: 0 });
    } else if (drag.mode === 'paint') {
      const s = useEditor.getState();
      // 直线补齐，避免快速移动时断点
      const pts = bresenham(drag.lastX, drag.lastY, x, y);
      for (const [px, py] of pts) s.paintCell(px, py);
    }
    drag.lastX = x;
    drag.lastY = y;
  };

  const endDrag = (e?: React.PointerEvent) => {
    if (e) pointersRef.current.delete(e.pointerId);
    else pointersRef.current.clear();
    if (pointersRef.current.size < 2) pinchRef.current = null;

    const drag = dragRef.current;
    if (!drag) return;
    const s = useEditor.getState();
    if (drag.mode === 'shape' && shapePreview) {
      s.beginStroke();
      if (tool === 'line') s.drawLine(shapePreview.x0, shapePreview.y0, shapePreview.x1, shapePreview.y1);
      else if (tool === 'rect' || tool === 'ellipse')
        s.drawShape(tool, shapePreview.x0, shapePreview.y0, shapePreview.x1, shapePreview.y1);
      s.endStroke();
      setShapePreview(null);
    } else if (drag.mode === 'paint' || drag.mode === 'erase' || drag.mode === 'progress') {
      s.endStroke();
    }
    dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const boardX = (mx - originX) / cell;
      const boardY = (my - originY) / cell;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.max(2, Math.min(48, cell * factor));
      setZoom(next);
      const boardW = doc.width * next;
      const boardH = doc.height * next;
      // 精确保持指针下的格子不动
      const newOriginX = mx - boardX * next;
      const newOriginY = my - boardY * next;
      setPan({
        x: newOriginX - (size.w - boardW) / 2,
        y: newOriginY - (size.h - boardH) / 2,
      });
    } else {
      setPan({ x: pan.x - e.deltaX, y: pan.y - e.deltaY });
    }
  };

  // 空格平移
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input,textarea')) {
        setSpaceDown(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // 适应窗口请求（顶栏 / 快捷键 0 都走这里，因为只有这里知道容器真实尺寸）
  const fitRequest = useEditor((s) => s.fitRequest);
  useEffect(() => {
    if (!fitRequest || !size.w || !size.h) return;
    const s = useEditor.getState();
    const z = Math.min((size.w - 80) / doc.width, (size.h - 80) / doc.height);
    s.setZoom(Math.max(2, Math.min(40, z)));
    s.setPan({ x: 0, y: 0 });
  }, [fitRequest, size.w, size.h, doc.width, doc.height]);

  // 键盘光标移出可视区时自动把画布挪过来，否则用方向键会「画到看不见的地方」。
  // 只在 cursorTick 变化（键盘移动）时触发，鼠标悬停不能把画布拖走。
  const cursorTick = useEditor((s) => s.cursorTick);
  useEffect(() => {
    if (!cursorTick || !hover || !size.w || !size.h) return;
    const margin = 48;
    const cx = originX + hover.x * cell + cell / 2;
    const cy = originY + hover.y * cell + cell / 2;
    let dx = 0;
    let dy = 0;
    if (cx < margin) dx = margin - cx;
    else if (cx > size.w - margin) dx = size.w - margin - cx;
    if (cy < margin) dy = margin - cy;
    else if (cy > size.h - margin) dy = size.h - margin - cy;
    if (dx || dy) setPan({ x: pan.x + dx, y: pan.y + dy });
  }, [cursorTick, hover, originX, originY, cell, size.w, size.h, pan.x, pan.y, setPan]);

  const cursor =
    tool === 'pan' || spaceDown
      ? 'grab'
      : tool === 'picker'
        ? 'copy'
        : tool === 'bucket'
          ? 'cell'
          : 'crosshair';

  const zoomPct = Math.round((cell / 14) * 100);

  return (
    <div className="stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          setHover(null);
          endDrag();
        }}
        onWheel={onWheel}
        onDoubleClick={(e) => {
          // 双击某块板 = 进入 / 退出「只看这块板」，比分板设置里点按钮快得多
          if (doc.pegboard <= 0) return;
          const { x, y } = cellFromEvent(e);
          if (!inBounds(x, y)) return;
          focusOnCell(x, y);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas ref={overlayRef} className="stage-overlay" />
      {focus && doc.pegboard > 0 && (
        <button className="stage-focus-chip" onClick={() => setFocus(null)} title="退出聚焦（只看全图）">
          <span className="focus-dot" />
          只看板 {boardLabel(focus.col, focus.row)}
          <span className="focus-exit">×</span>
        </button>
      )}
      <div className="stage-zoombar">
        <button className="zbtn" onClick={() => setZoom(cell / 1.25)} title="缩小">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M3 7h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <span className="zoomval">{zoomPct}%</span>
        <button className="zbtn" onClick={() => setZoom(cell * 1.25)} title="放大">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <div className="vdivider" />
        <button
          className="zbtn"
          title="适应窗口"
          onClick={() => {
            const s = useEditor.getState();
            const z = Math.min((size.w - 80) / doc.width, (size.h - 80) / doc.height);
            s.setZoom(Math.max(2, Math.min(40, z)));
            s.setPan({ x: 0, y: 0 });
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 5V2h3M12 5V2H9M2 9v3h3M12 9v3H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="stage-hint">
        <span className="kbd">方向键</span> 移光标 · <span className="kbd">Enter</span> 落笔 ·{' '}
        <span className="kbd">空格</span> 拖动 · <span className="kbd">?</span> 全部快捷键
      </div>
    </div>
  );
}
