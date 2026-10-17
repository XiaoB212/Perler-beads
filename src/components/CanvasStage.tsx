import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, bresenham } from '../core/store';
import { stageColors, type ResolvedTheme } from '../core/theme';
import { readableTextColor } from '../core/color';
import { ZOOM_MAX, ZOOM_MIN, boardGuideLines, boardLabel, focusRect } from '../core/board';
import type { PatternDoc } from '../core/types';

interface Props {
  doc: PatternDoc;
  theme?: ResolvedTheme;
}

type DragMode = 'paint' | 'erase' | 'pan' | 'shape' | 'progress' | null;

/**
 * 单格像素（= zoom）的上下限来自 core/board.ts，和 store.setZoom 共用同一对常量。
 * 上限 220 是为了让「分板聚焦」能把一块 4×4 的小板真正铺满视口。
 */
const CELL_MIN = ZOOM_MIN;
const CELL_MAX = ZOOM_MAX;

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
  const shapeFill = useEditor((s) => s.shapeFill);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const hover = useEditor((s) => s.hover);
  const focus = useEditor((s) => s.focus);
  const focusOnCell = useEditor((s) => s.focusOnCell);
  const setFocus = useEditor((s) => s.setFocus);
  const setZoom = useEditor((s) => s.setZoom);
  const setPan = useEditor((s) => s.setPan);
  const panBy = useEditor((s) => s.panBy);
  const setHover = useEditor((s) => s.setHover);
  const setColorIndex = useEditor((s) => s.setColorIndex);
  const notify = useEditor((s) => s.notify);
  const requestFit = useEditor((s) => s.requestFit);
const checkColor = useEditor((s) => s.checkColor);
  const wrongMarks = useEditor((s) => s.wrongMarks);
  const soloColor = useEditor((s) => s.soloColor);

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
  // 平移原点吸附到「设备像素」而不是整数 CSS 像素。
  // 居中的基准点 (size-board)/2 经常落在 x.5，直接 Math.round 会让整张图
  // 在两个设备像素之间来回跳，细网格线看起来就是一直在抖（用户 m06835 的反馈）。
  const snapOrigin = (v: number) => {
    const d = Math.min(2, window.devicePixelRatio || 1);
    return Math.round(v * d) / d;
  };
  const originX = useMemo(() => {
    const boardW = doc.width * cell;
    return snapOrigin((size.w - boardW) / 2 + pan.x);
  }, [size.w, doc.width, cell, pan.x]);
  const originY = useMemo(() => {
    const boardH = doc.height * cell;
    return snapOrigin((size.h - boardH) / 2 + pan.y);
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

  // 自动铺满：容器尺寸变化 / 切换图纸时都重新算一次最合适的格宽。
  // 之前只在「算出来比当前小」时才调整，于是把窗口拉大、或者换到小图时，
  // 画布会一直缩在角落一小块 —— 用户要的是「自动扩大铺满这个区域」。
  // 手动缩放过（滚轮 / 按钮）后就不再自动接管，避免抢用户的视角。
  const manualZoomRef = useRef(false);
  const fittedRef = useRef<string>('');
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const fitToStage = useCallback((grow: boolean) => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    const s = useEditor.getState();
    // 预留顶栏 chip 条与底部缩放条的高度
    const padX = w < 700 ? 24 : 72;
    const padY = h < 560 ? 96 : 72;
    const fit = Math.min((w - padX) / s.doc.width, (h - padY) / s.doc.height);
    if (fit <= 0) return;
    const next = Math.max(CELL_MIN, Math.min(CELL_MAX, fit));
    if (!grow && next >= s.zoom) return;
    s.setZoom(next);
    s.setPan({ x: 0, y: 0 });
  }, []);
  useEffect(() => {
    const key = `${doc.id}:${doc.width}x${doc.height}`;
    if (key !== fittedRef.current) {
      // 换图纸 = 回到自动模式
      fittedRef.current = key;
      manualZoomRef.current = false;
    }
    if (manualZoomRef.current) return;
    fitToStage(true);
    // 依赖里带上容器尺寸：移动端首次测量为 0 时这里会提前返回，
    // 必须等 ResizeObserver 给出真实尺寸后再算一次，否则手机上会裁掉图纸。
  }, [doc.id, doc.width, doc.height, size.w, size.h, fitToStage]);

  // 聚焦某一块板：把那块板铺满整个视口。
  // 之前只是把视口平移过去，格子大小不变，于是「一块板还是只占中间一小块」——
  // 用户分板本来就是为了「一次只看一块、放大到好看」，所以这里重新算缩放并居中。
  useEffect(() => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    const s = useEditor.getState();
    if (!focus || doc.pegboard <= 0) {
      manualZoomRef.current = false;
      fitToStage(true);
      return;
    }
    const fr = focusRect(focus, doc.width, doc.height);
    const padX = w < 700 ? 32 : 88;
    const padY = h < 560 ? 104 : 88;
    const fit = Math.min((w - padX) / fr.w, (h - padY) / fr.h);
    const next = Math.max(CELL_MIN, Math.min(CELL_MAX, fit));
    manualZoomRef.current = true;
    s.setZoom(next);
    s.setPan({
      x: (doc.width / 2 - (fr.x + fr.w / 2)) * next,
      y: (doc.height / 2 - (fr.y + fr.h / 2)) * next,
    });
  }, [focus, doc.pegboard, doc.width, doc.height, size.w, size.h, fitToStage]);

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
    // 单色模式：只对某一个色号动手，其余颜色压暗
    const solo = soloColor;
    const byColor = new Map<string, Path2D>();
    const byColorDim = new Map<string, Path2D>();
    const holes = new Path2D();
    const checks = new Path2D();
    // 对色拼装：点错的格子上盖一个红叉
    const wrongs = new Path2D();
    const checkActive = flags.progressMode && flags.progressCheck && checkColor >= 0;
    // 当前正在拼的色号，用它给同色格子加一圈提示，线上照着拼时一眼看清该放哪
    const targetV = checkActive ? checkColor + 1 : solo !== null ? solo + 1 : 0;
    const targets = new Path2D();
    const holeR = Math.max(0.9, cell * 0.14);
    const drawHoles = flags.beadHoles && cell >= 8;
    // 色号：格子在屏幕上够大才画得下，否则会糊成一团
    const drawCodes = flags.showCodes && cell >= 12;
    const codeCells: { x: number; y: number; code: string; hex: string; dim: boolean }[] = [];
    const emptyEven = new Path2D();
    const emptyOdd = new Path2D();
    // 豆子形状：方格（默认）或圆格。圆格要留一点缝，不然相邻圆会粘连成一片。
    const roundCell = flags.cellShape === 'circle';
    const beadR = (step / 2) * 0.94;
    const addCell = (p: Path2D, px: number, py: number) => {
      if (roundCell) {
        const cx = px + step / 2;
        const cy = py + step / 2;
        p.moveTo(cx + beadR, cy);
        p.arc(cx, cy, beadR, 0, Math.PI * 2);
      } else {
        p.rect(px, py, step, step);
      }
    };
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        const px = originX + x * cell;
        const py = originY + y * cell;
        const v = doc.cells[y * doc.width + x];
        if (!v) {
          if (!roundCell) addCell((x + y) % 2 === 0 ? emptyEven : emptyOdd, px, py);
          continue;
        }
        const c = doc.palette[v - 1];
        if (!c) continue;
        const placed = doc.progress[y * doc.width + x] === 1;
        // 单色模式：只拼一个色号，其它颜色压暗，省得在一堆豆子里找
        const dim = (dimMode && !placed) || (solo !== null && v - 1 !== solo);
        const bucket = dim ? byColorDim : byColor;
        let p = bucket.get(c.hex);
        if (!p) {
          p = new Path2D();
          bucket.set(c.hex, p);
        }
        addCell(p, px, py);
        if (drawHoles) {
          const hx = px + cell / 2;
          const hy = py + cell / 2;
          holes.moveTo(hx + holeR, hy);
          holes.arc(hx, hy, holeR, 0, Math.PI * 2);
        }
        // 褪色（未拼）的格子也要给色号，否则用户看不出这里该放什么豆
        if (drawCodes) codeCells.push({ x: px, y: py, code: c.code, hex: c.hex, dim });
        if (placed && flags.progressMode) {
          checks.moveTo(px + cell * 0.22, py + cell * 0.52);
          checks.lineTo(px + cell * 0.42, py + cell * 0.74);
          checks.lineTo(px + cell * 0.8, py + cell * 0.26);
        }
        if (flags.progressMode && wrongMarks.has(y * doc.width + x)) {
          wrongs.moveTo(px + cell * 0.24, py + cell * 0.24);
          wrongs.lineTo(px + cell * 0.76, py + cell * 0.76);
          wrongs.moveTo(px + cell * 0.76, py + cell * 0.24);
          wrongs.lineTo(px + cell * 0.24, py + cell * 0.76);
        }
        if (targetV && v === targetV && !placed) {
          // 双层路径 + evenodd 填充 = 一圈描边环，不遮住豆子本身的颜色
          const m = Math.max(1, cell * 0.1);
          const cx = px + cell / 2;
          const cy = py + cell / 2;
          if (roundCell) {
            targets.moveTo(cx + beadR - m, cy);
            targets.arc(cx, cy, Math.max(1, beadR - m), 0, Math.PI * 2);
            targets.moveTo(cx + beadR - 3 * m, cy);
            targets.arc(cx, cy, Math.max(0.5, beadR - 3 * m), 0, Math.PI * 2);
          } else {
            targets.rect(px + m, py + m, cell - 2 * m, cell - 2 * m);
            targets.rect(px + 3 * m, py + 3 * m, Math.max(1, cell - 6 * m), Math.max(1, cell - 6 * m));
          }
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
      for (const cc of codeCells) {
        // 字号两层约束：不超过格子的 52%，也不超过格宽能容纳的宽度。
        // 之前用描边（strokeText）给色号做外发光，1.6px 的描边把 5~6px 的字整个糊掉了，
        // 看上去就是一团发虚的色块 —— 所以这里改回纯填充，字色按豆子底色取黑或白。
        const fs = Math.min(cell * 0.52, (cell * 0.9) / Math.max(1, cc.code.length * 0.62));
        if (fs < 5.5) continue;
        ctx.font = `600 ${fs.toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        // 对齐到整数像素，半像素会让 canvas 做灰度插值，小字号必然发虚
        const cx = Math.round(cc.x + cell / 2);
        // 有中孔时色号压在下半个豆子上，避免被孔挡住
        const ty = Math.round(cc.y + cell * (drawHoles ? 0.7 : 0.52));
        ctx.globalAlpha = cc.dim ? 0.72 : 1;
        ctx.fillStyle = readableTextColor(cc.hex);
        ctx.fillText(cc.code, cx, ty);
      }
      ctx.globalAlpha = 1;
    }
    if (flags.progressMode) {
      // 正在拼的色号先高亮，再画已完成的对号
      if (targetV && cell >= 5) {
        ctx.fillStyle = C.accent;
        ctx.globalAlpha = 0.55;
        ctx.fill(targets, 'evenodd');
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = C.check;
      ctx.lineWidth = Math.max(1.2, cell * 0.09);
      ctx.stroke(checks);
      if (wrongMarks.size && cell >= 6) {
        ctx.strokeStyle = C.wrong;
        ctx.lineWidth = Math.max(1.6, cell * 0.11);
        ctx.lineCap = 'round';
        ctx.stroke(wrongs);
        ctx.lineCap = 'butt';
      }
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

      // 板边界：一条干净的实线（以前是奇偶交替实线/虚线，几百块板时满屏橙色
      // 虚线非常刺眼，参考站只在板边界画一条细一点的深色线）
      ctx.strokeStyle = C.pegboard;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let x = bs; x < doc.width; x += bs) {
        const px = Math.round(originX + x * cell) + 0.5;
        ctx.moveTo(px, originY);
        ctx.lineTo(px, originY + boardH);
      }
      for (let y = bs; y < doc.height; y += bs) {
        const py = Math.round(originY + y * cell) + 0.5;
        ctx.moveTo(originX, py);
        ctx.lineTo(originX + boardW, py);
      }
      ctx.stroke();

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
            ctx.fillStyle = C.ruler;
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
  }, [doc, size, cell, originX, originY, flags, C, theme, focus, checkColor, wrongMarks, soloColor]);

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
      const minX = Math.max(0, Math.min(x0, x1));
      const maxX = Math.min(doc.width - 1, Math.max(x0, x1));
      const minY = Math.max(0, Math.min(y0, y1));
      const maxY = Math.min(doc.height - 1, Math.max(y0, y1));
      // 预览必须画「将要落下的那些格子」，而不是一个包围盒。
      // 以前无论直线/矩形/椭圆都只画同一个半透明方框，看起来就像「直线是方格、椭圆是长方形的」。
      const fill = theme === 'light' ? 'rgba(217,84,30,0.30)' : 'rgba(255,138,76,0.34)';
      const edge = theme === 'light' ? 'rgba(217,84,30,0.95)' : 'rgba(255,168,110,0.98)';

      // 这里复用和 store.drawShape / drawLine 完全一致的判定，保证「预览所见 = 落笔所得」
      const hits: [number, number][] = [];
      if (tool === 'line') {
        for (const [x, y] of bresenham(x0, y0, x1, y1)) {
          if (inBounds(x, y)) hits.push([x, y]);
        }
      } else if (tool === 'rect') {
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            if (shapeFill || x === minX || x === maxX || y === minY || y === maxY) hits.push([x, y]);
          }
        }
      } else {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const rx = Math.max(0.5, (maxX - minX) / 2);
        const ry = Math.max(0.5, (maxY - minY) / 2);
        const innerRx = rx - 1;
        const innerRy = ry - 1;
        const inside = (x: number, y: number, ax: number, ay: number) => {
          if (ax <= 0 || ay <= 0) return false;
          const nx = (x - cx) / (ax + 0.5);
          const ny = (y - cy) / (ay + 0.5);
          return nx * nx + ny * ny <= 1;
        };
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            if (!inside(x, y, rx, ry)) continue;
            if (shapeFill || !inside(x, y, innerRx, innerRy)) hits.push([x, y]);
          }
        }
      }

      // 格子多的时候逐格描边会糊成一片，改画整块填充 + 外轮廓
      const area = (maxX - minX + 1) * (maxY - minY + 1);
      const dense = hits.length > 900 || area > 2500;
      ctx.fillStyle = fill;
      for (const [x, y] of hits) {
        ctx.fillRect(originX + x * cell, originY + y * cell, cell, cell);
      }
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.4;
      if (dense) {
        ctx.strokeRect(
          originX + minX * cell + 0.5,
          originY + minY * cell + 0.5,
          (maxX - minX + 1) * cell - 1,
          (maxY - minY + 1) * cell - 1,
        );
      } else {
        // 只描边「边缘格」：逐格描满会显得糊，只勾外圈更清楚
        const set = new Set(hits.map(([x, y]) => `${x},${y}`));
        for (const [x, y] of hits) {
          const px = originX + x * cell;
          const py = originY + y * cell;
          ctx.beginPath();
          if (!set.has(`${x},${y - 1}`)) {
            ctx.moveTo(px, py + 0.5);
            ctx.lineTo(px + cell, py + 0.5);
          }
          if (!set.has(`${x},${y + 1}`)) {
            ctx.moveTo(px, py + cell - 0.5);
            ctx.lineTo(px + cell, py + cell - 0.5);
          }
          if (!set.has(`${x - 1},${y}`)) {
            ctx.moveTo(px + 0.5, py);
            ctx.lineTo(px + 0.5, py + cell);
          }
          if (!set.has(`${x + 1},${y}`)) {
            ctx.moveTo(px + cell - 0.5, py);
            ctx.lineTo(px + cell - 0.5, py + cell);
          }
          ctx.stroke();
        }
      }
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
  }, [
    hover,
    shapePreview,
    size,
    originX,
    originY,
    cell,
    tool,
    brushSize,
    flags,
    doc.width,
    doc.height,
    theme,
    shapeFill,
  ]);

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
      const next = Math.max(CELL_MIN, Math.min(CELL_MAX, pinch.zoom * (dist / pinch.dist)));
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
    const drag = dragRef.current;
    // 平移时不用更新悬停格：光标是抓手，而且每移动一次就写一次 store
    // 会让整个界面跟着重渲染，平板/触控板上就会顿成「抖动」。
    if (drag?.mode !== 'pan' && (!hover || hover.x !== x || hover.y !== y)) {
      setHover(inBounds(x, y) ? { x, y } : null);
    }
    if (!drag) return;
    if (drag.mode === 'pan') {
      // 这里拿到的是「这一次移动了多远」的增量，必须累加到当前 pan 上。
      // 之前写成 startPan + 增量：每动一下都从起点重新算，画布就在原位附近来回跳，
      // 看起来就是一直抖 —— 这就是「平移抖动」的根因。
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (dx || dy) panBy(dx, dy);
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

  /** 以画布上某一点为锚点缩放：锚点下的格子保持不动 */
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const boardX = (mx - originX) / cell;
      const boardY = (my - originY) / cell;
      const next = Math.max(CELL_MIN, Math.min(CELL_MAX, cell * factor));
      if (next === cell) return;
      manualZoomRef.current = true;
      setZoom(next);
      const boardW = doc.width * next;
      const boardH = doc.height * next;
      const newOriginX = mx - boardX * next;
      const newOriginY = my - boardY * next;
      setPan({
        x: newOriginX - (size.w - boardW) / 2,
        y: newOriginY - (size.h - boardH) / 2,
      });
    },
    [originX, originY, cell, doc.width, doc.height, size.w, size.h, setZoom, setPan],
  );

  /** 以画布中心为锚点缩放（缩放条按钮 / 快捷键用，不跑偏） */
  const centerZoom = useCallback(
    (factor: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : 0;
      const cy = rect ? rect.top + rect.height / 2 : 0;
      zoomAt(cx, cy, factor);
    },
    [zoomAt],
  );

  const onWheel = (e: WheelEvent) => {
    // 和 Figma / Excalidraw 一致的手感：
    //   滚轮或触控板两指 = 上下左右平移（能「随意拖动、上下滑动」）
    //   Ctrl / ⌘ / Alt + 滚轮、触控板捏合 = 以指针为锚点缩放
    // 之前的版本反着来（滚轮直接缩放），想挪一下画面反而很难。
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(e.clientX, e.clientY, factor);
      return;
    }
    // Shift + 滚轮 = 只横向平移（笔记本只有竖滚时很有用）
    const dx = e.shiftKey ? -(e.deltaY || e.deltaX) : -e.deltaX;
    const dy = e.shiftKey ? 0 : -e.deltaY;
    if (!dx && !dy) return;
    // 用 panBy 而不是 setPan({...pan})：后者读的是上一次渲染的闭包值，
    // 滚轮/触控板一秒能来几十个事件，连续累加就会丢步，看起来像在抖。
    panBy(dx, dy);
  };
  // React 的 onWheel 是 passive 的，里面 preventDefault 会被浏览器警告并忽略，
  // 所以自己挂一个 { passive: false } 的原生监听，才能阻止页面跟着滚动。
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fn = (e: WheelEvent) => {
      e.preventDefault();
      wheelRef.current(e);
    };
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  }, []);

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
    // 手动按「适应窗口」= 明确要求回到自动模式，之后跟着容器走
    manualZoomRef.current = false;
    fitToStage(true);
  }, [fitRequest, size.w, size.h, fitToStage]);

  // 键盘光标移出可视区时自动把画布挪过来，否则用方向键会「画到看不见的地方」。
  // 只在 cursorTick 变化（键盘移动）时触发，鼠标悬停不能把画布拖走。
  const cursorTick = useEditor((s) => s.cursorTick);
  const lastFollowTick = useRef(0);
  useEffect(() => {
    // 只在「真的按了方向键」时跟随。之前依赖里有 originX/originY，
    // 平移完这个 effect 会再跑一次，把光标重新顶到边缘 → 再平移 → 来回抖。
    if (!cursorTick || cursorTick === lastFollowTick.current) return;
    lastFollowTick.current = cursorTick;
    if (!hover || !size.w || !size.h) return;
    const margin = 48;
    const cx = originX + hover.x * cell + cell / 2;
    const cy = originY + hover.y * cell + cell / 2;
    let dx = 0;
    let dy = 0;
    if (cx < margin) dx = margin - cx;
    else if (cx > size.w - margin) dx = size.w - margin - cx;
    if (cy < margin) dy = margin - cy;
    else if (cy > size.h - margin) dy = size.h - margin - cy;
    if (dx || dy) panBy(dx, dy);
  }, [cursorTick, hover, originX, originY, cell, size.w, size.h, panBy]);

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
        <button className="zbtn" onClick={() => centerZoom(1 / 1.25)} title="缩小">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M3 7h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <span className="zoomval">{zoomPct}%</span>
        <button className="zbtn" onClick={() => centerZoom(1.25)} title="放大">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <div className="vdivider" />
        <button
          className="zbtn"
          title="适应窗口"
          onClick={() => requestFit()}
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
