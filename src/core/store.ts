import { create } from 'zustand';
import type { BeadColor, FocusState, PatternDoc, Snapshot, Tool, ViewFlags } from '../core/types';
import { DEFAULT_FLAGS } from '../core/types';
import { DEFAULT_PALETTE_KEY, palettePreset } from '../core/palette';
import { uid } from '../core/util';
import { loadDoc, readIndex } from './storage';
import { createDemoDoc } from './demo';
import {
  DEFAULT_PEGBOARD,
  ZOOM_MAX,
  ZOOM_MIN,
  boardCols,
  boardRows,
  clampCanvasPair,
  clampPegboard,
  focusRect,
} from './board';

export interface HoverCell {
  x: number;
  y: number;
}

export interface DocMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
  createdAt: number;
  thumb?: string;
  paletteBrand: string;
}

const HISTORY_LIMIT = 60;

/**
 * 撤销快照会整份拷贝 cells（Uint16）+ progress（Uint8），约 3 字节/格。
 * 小画布给满 60 步；超大画布按内存预算削减，避免 5000×5000 时一次撤销就吃掉 75MB。
 */
function historyLimitFor(width: number, height: number): number {
  const bytes = Math.max(1, width * height) * 3;
  const budget = 240 * 1024 * 1024;
  return Math.max(2, Math.min(HISTORY_LIMIT, Math.floor(budget / bytes)));
}

const FIRST_VISIT_KEY = 'perler-studio:visited';

/**
 * 初始文档：优先打开本地最近保存的那张；
 * 本地一张都没有时给一张示例图纸（新老用户都能立刻看到效果，而不是一片空网格）。
 */
function createInitialDoc(): PatternDoc {
  try {
    const idx = readIndex();
    if (idx.length) {
      const last = loadDoc(idx[0].id);
      if (last) return last;
    }
    localStorage.setItem(FIRST_VISIT_KEY, '1');
    return createDemoDoc();
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return createDemoDoc();
}

export function createDoc(
  width: number,
  height: number,
  paletteKey = DEFAULT_PALETTE_KEY,
  name = '未命名图纸',
): PatternDoc {
  const { w, h } = clampCanvasPair(width, height);
  const palette = palettePreset(paletteKey);
  return {
    id: uid(),
    name,
    width: w,
    height: h,
    cells: new Uint16Array(w * h),
    progress: new Uint8Array(w * h),
    palette,
    pegboard: DEFAULT_PEGBOARD,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    notes: '',
  };
}

function snapshot(doc: PatternDoc, focus: FocusState | null): Snapshot {
  return {
    width: doc.width,
    height: doc.height,
    cells: doc.cells.slice(),
    progress: doc.progress.slice(),
    palette: doc.palette.map((c) => ({ ...c })),
    pegboard: doc.pegboard,
    focus,
  };
}

function restore(doc: PatternDoc, snap: Snapshot): PatternDoc {
  return {
    ...doc,
    width: snap.width,
    height: snap.height,
    cells: snap.cells.slice(),
    progress: snap.progress.slice(),
    palette: snap.palette.map((c) => ({ ...c })),
    pegboard: snap.pegboard,
    updatedAt: Date.now(),
  };
}

export interface PaintOptions {
  symmetryX?: boolean;
  symmetryY?: boolean;
  /** 直接指定写入值（0 = 擦除） */
  value?: number;
}

/**
 * 这一格能不能画：越界不行，聚焦模式下出了这块板也不行。
 *
 * 所有写入路径（画笔 / 直线 / 形状 / 油漆桶 / 进度勾选）都要过这一关，
 * 否则「只看一块板」时还会悄悄改到隔壁板的数据。
 */
function allows(focus: FocusState | null, width: number, height: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  if (!focus) return true;
  const r = focusRect(focus, width, height);
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

interface EditorState {
  doc: PatternDoc;
  tool: Tool;
  colorIndex: number;
  brushSize: number;
  shapeFill: boolean;
  flags: ViewFlags;
  zoom: number;
  pan: { x: number; y: number };
  hover: HoverCell | null;
  past: Snapshot[];
  future: Snapshot[];
  strokeActive: boolean;
  /**
   * 分板聚焦：只看某一块板。绘制会被夹在这块板的矩形里，
   * 拼一块 29×29 的板时不会误画到隔壁板。
   */
  focus: FocusState | null;
  /** 进度模式下本次拖动是「标记已拼」还是「取消已拼」 */
  progressTarget: 0 | 1;
  /**
   * 对色拼装：当前正在拼的色号（doc.palette 下标）。-1 表示还没选。
   * 只有 flags.progressCheck 打开时才参与判定。
   */
  checkColor: number;
  /** 对色拼装点错的格子（画叉），点对了会自动消掉 */
  wrongMarks: Set<number>;
  /** 累计打叉次数（用于算准确率，不会因为修正而减少） */
  wrongCount: number;
  /** 累计正确放置次数 */
  rightCount: number;
  /**
   * 单色模式：!= null 时只对这一个色号动手（进度勾选、画布压暗其它颜色）。
   * 「先拼哪个颜色就单独拼它」靠这个。
   */
  soloColor: number | null;
  toast: { id: number; text: string; kind?: 'ok' | 'warn' } | null;
  dirty: boolean;
  docMetaList: DocMeta[];
  /** 递增即触发一次「适应窗口」，由 CanvasStage 监听（它才知道容器真实尺寸） */
  fitRequest: number;
  /** 递增即表示「键盘移动了光标」，画布据此自动跟随（鼠标悬停不应触发） */
  cursorTick: number;

  setTool: (t: Tool) => void;
  setColorIndex: (i: number) => void;
  setBrushSize: (n: number) => void;
  setShapeFill: (v: boolean) => void;
  toggleFlag: (k: keyof ViewFlags) => void;
  setFlag: <K extends keyof ViewFlags>(k: K, v: ViewFlags[K]) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  /** 增量平移（滚轮 / 惯性滚动用，基于最新状态累加，不会丢步） */
  panBy: (dx: number, dy: number) => void;
  setHover: (h: HoverCell | null) => void;
  notify: (text: string, kind?: 'ok' | 'warn') => void;

  /** 进入/退出某块板的聚焦模式（传 null 表示看全图） */
  setFocus: (f: FocusState | null) => void;
  /** 以某一格为准聚焦它所在的板 */
  focusOnCell: (x: number, y: number) => void;
  /** 在当前板序里前后切换聚焦的板，方便「拼完这块换下一块」 */
  stepFocus: (delta: number) => void;

  beginStroke: () => void;
  endStroke: () => void;
  undo: () => void;
  redo: () => void;

  paintCell: (x: number, y: number, opts?: PaintOptions) => void;
  paintProgressCell: (x: number, y: number, value: 0 | 1) => void;
  /** 对色拼装时选「正在拼的色号」，传 -1 表示不挑色 */
  setCheckColor: (i: number) => void;
  /** 单色模式：只拼这一个色号；传 null 退出 */
  setSoloColor: (i: number | null) => void;
  /** 一键把某个色号整色标记为已拼 / 未拼 */
  markColorPlaced: (index: number, v: boolean) => void;
  /**
   * 进度模式的一次点击。开对色检查时按色号判定：对了打勾、错了打叉；
   * 关掉时就是简单取反。
   */
  clickProgress: (x: number, y: number) => void;
  /** 清空所有打叉标记（保留累计次数） */
  clearWrong: () => void;
  floodFill: (x: number, y: number) => void;
  drawLine: (x0: number, y0: number, x1: number, y1: number) => void;
  drawShape: (kind: 'rect' | 'ellipse', x0: number, y0: number, x1: number, y1: number) => void;

  newDocument: (w: number, h: number, paletteKey: string, name?: string) => void;
  loadDocument: (doc: PatternDoc) => void;
  renameDoc: (name: string) => void;
  resizeDoc: (w: number, h: number) => void;
  setPegboard: (n: number) => void;
  setNotes: (s: string) => void;

  addCustomColor: (c: BeadColor) => number;
  updateColor: (index: number, patch: Partial<BeadColor>) => void;
  removeColor: (index: number) => void;
  replaceColor: (index: number, hex: string) => void;
  replaceAllOfColor: (index: number, hex: string) => void;
  setPalette: (palette: BeadColor[]) => void;

  fillAll: () => void;
  clearAll: () => void;
  markAllPlaced: (v: boolean) => void;
  applyImported: (
    cells: Uint16Array,
    palette: BeadColor[],
    width: number,
    height: number,
    name?: string,
    pegboard?: number,
  ) => void;
  markClean: () => void;
  setDocMetaList: (l: DocMeta[]) => void;
  requestFit: () => void;
  /** 键盘光标：按格移动（step 默认 1，Shift 时 5） */
  moveCursor: (dx: number, dy: number, step?: number) => void;
  /** 在键盘光标处落笔 / 擦除 / 勾选进度 */
  paintAtCursor: (erase?: boolean) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: createInitialDoc(),
  tool: 'pencil',
  colorIndex: 0,
  brushSize: 1,
  shapeFill: true,
  flags: { ...DEFAULT_FLAGS },
  zoom: 14,
  pan: { x: 0, y: 0 },
  hover: null,
  past: [],
  future: [],
  strokeActive: false,
  focus: null,
  progressTarget: 1,
  checkColor: -1,
  wrongMarks: new Set<number>(),
  wrongCount: 0,
  rightCount: 0,
  soloColor: null,
  toast: null,
  dirty: false,
  docMetaList: [],
  fitRequest: 0,
  cursorTick: 0,

  setTool: (t) => set({ tool: t }),
  setColorIndex: (i) => set({ colorIndex: i, tool: get().tool === 'picker' ? 'pencil' : get().tool }),
  setBrushSize: (n) => set({ brushSize: Math.max(1, Math.min(16, n)) }),
  setShapeFill: (v) => set({ shapeFill: v }),
  toggleFlag: (k) => set({ flags: { ...get().flags, [k]: !get().flags[k] } }),
  setFlag: (k, v) => set({ flags: { ...get().flags, [k]: v } }),
  setZoom: (z) => set({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) }),
  setPan: (p) => set({ pan: p }),
  /** 增量平移：滚轮连续触发时必须基于最新状态累加，否则用闭包里的旧 pan 会丢步、回跳 */
  panBy: (dx, dy) => {
    const cur = get().pan;
    if (!dx && !dy) return;
    set({ pan: { x: cur.x + dx, y: cur.y + dy } });
  },
  setHover: (h) => set({ hover: h }),
  notify: (text, kind = 'ok') => {
    const id = Date.now() + Math.random();
    set({ toast: { id, text, kind } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 2200);
  },

  beginStroke: () => {
    const { doc, past, focus } = get();
    const snap = snapshot(doc, focus);
    const next = past.concat([snap]);
    const limit = historyLimitFor(doc.width, doc.height);
    while (next.length > limit) next.shift();
    set({ past: next, future: [], strokeActive: true });
  },

  endStroke: () => {
    const { doc } = get();
    doc.updatedAt = Date.now();
    set({ strokeActive: false, dirty: true });
  },

  undo: () => {
    const { past, future, doc, focus } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    const cur = snapshot(doc, focus);
    set({
      doc: restore(doc, prev),
      past: past.slice(0, -1),
      future: future.concat([cur]),
      focus: prev.focus,
      dirty: true,
    });
  },

  redo: () => {
    const { past, future, doc, focus } = get();
    if (!future.length) return;
    const next = future[future.length - 1];
    const cur = snapshot(doc, focus);
    set({
      doc: restore(doc, next),
      past: past.concat([cur]),
      future: future.slice(0, -1),
      focus: next.focus,
      dirty: true,
    });
  },

  paintCell: (x, y, opts = {}) => {
    const { doc, colorIndex, brushSize, flags, focus } = get();
    const v = opts.value ?? colorIndex + 1;
    const symX = opts.symmetryX ?? flags.symmetryX;
    const symY = opts.symmetryY ?? flags.symmetryY;
    const r = Math.floor((brushSize - 1) / 2);
    const targets: [number, number][] = [];
    for (let dy = 0; dy <= r * 2; dy++) {
      for (let dx = 0; dx <= r * 2; dx++) {
        const px = x - r + dx;
        const py = y - r + dy;
        if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) continue;
        targets.push([px, py]);
        if (symX) targets.push([doc.width - 1 - px, py]);
        if (symY) targets.push([px, doc.height - 1 - py]);
        if (symX && symY) targets.push([doc.width - 1 - px, doc.height - 1 - py]);
      }
    }
    let changed = false;
    for (const [px, py] of targets) {
      if (!allows(focus, doc.width, doc.height, px, py)) continue;
      const i = py * doc.width + px;
      if (doc.cells[i] !== v) {
        doc.cells[i] = v;
        if (flags.progressMode) doc.progress[i] = 0;
        changed = true;
      }
    }
    if (changed) set({ doc: { ...doc, updatedAt: Date.now() }, dirty: true });
  },

  paintProgressCell: (x, y, value) => {
    const { doc, brushSize, focus, soloColor } = get();
    const r = Math.floor((brushSize - 1) / 2);
    let changed = false;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (!allows(focus, doc.width, doc.height, px, py)) continue;
        const i = py * doc.width + px;
        if (doc.cells[i] === 0) continue;
        // 单色模式只动这一个色号
        if (soloColor !== null && doc.cells[i] - 1 !== soloColor) continue;
        if (doc.progress[i] !== value) {
          doc.progress[i] = value;
          changed = true;
        }
      }
    }
    if (changed) set({ doc: { ...doc, updatedAt: Date.now() }, dirty: true });
  },

  setCheckColor: (i) => set({ checkColor: i }),

  setSoloColor: (i) => set({ soloColor: i }),

  markColorPlaced: (index, v) => {
    const { doc } = get();
    const want = index + 1;
    const progress = doc.progress.slice();
    let changed = false;
    for (let i = 0; i < doc.cells.length; i++) {
      if (doc.cells[i] !== want) continue;
      const next = v ? 1 : 0;
      if (progress[i] !== next) {
        progress[i] = next;
        changed = true;
      }
    }
    if (!changed) return;
    set({ doc: { ...doc, progress, updatedAt: Date.now() }, dirty: true });
    const color = doc.palette[index];
    get().notify(
      `${color ? `${color.code} ${color.name}` : '该色号'} 整色已${v ? '标记完成' : '取消完成'}`,
      'ok',
    );
  },

  clickProgress: (x, y) => {
    const { doc, brushSize, focus, flags, checkColor, soloColor } = get();
    if (!allows(focus, doc.width, doc.height, x, y)) return;
    const i = y * doc.width + x;
    if (doc.cells[i] === 0) return;
    // 单色模式：点到别的颜色直接不理，避免手滑把别的色号也勾上
    if (soloColor !== null && doc.cells[i] - 1 !== soloColor) return;

    // 只有「对色拼装」才做色号判定；否则保持原来的随手打勾
    if (flags.progressCheck && checkColor >= 0) {
      const want = checkColor + 1;
      const hit = doc.cells[i] === want;
      const progress = new Uint8Array(doc.progress);
      const wrong = new Set(get().wrongMarks);
      let rightCount = get().rightCount;
      let wrongCount = get().wrongCount;

      if (hit) {
        const already = progress[i] === 1;
        progress[i] = already ? 0 : 1;
        if (!already) rightCount += 1;
        wrong.delete(i);
      } else {
        wrong.add(i);
        wrongCount += 1;
      }
      void brushSize;
      set({
        doc: { ...doc, progress, updatedAt: Date.now() },
        wrongMarks: wrong,
        rightCount,
        wrongCount,
        dirty: true,
      });
      return;
    }

    get().beginStroke();
    get().paintProgressCell(x, y, doc.cells[i] && doc.progress[i] ? 0 : 1);
    get().endStroke();
  },

  clearWrong: () => set({ wrongMarks: new Set<number>() }),

  floodFill: (x, y) => {
    const { doc, colorIndex, focus } = get();
    if (!allows(focus, doc.width, doc.height, x, y)) return;
    const target = doc.cells[y * doc.width + x];
    const v = colorIndex + 1;
    if (target === v) return;
    const cells = doc.cells;
    const stack: number[] = [y * doc.width + x];
    const seen = new Uint8Array(cells.length);
    while (stack.length) {
      const i = stack.pop() as number;
      if (seen[i]) continue;
      if (cells[i] !== target) continue;
      seen[i] = 1;
      cells[i] = v;
      const px = i % doc.width;
      const py = (i / doc.width) | 0;
      if (allows(focus, doc.width, doc.height, px - 1, py)) stack.push(i - 1);
      if (allows(focus, doc.width, doc.height, px + 1, py)) stack.push(i + 1);
      if (allows(focus, doc.width, doc.height, px, py - 1)) stack.push(i - doc.width);
      if (allows(focus, doc.width, doc.height, px, py + 1)) stack.push(i + doc.width);
    }
    set({ doc: { ...doc, updatedAt: Date.now() }, dirty: true });
  },

  drawLine: (x0, y0, x1, y1) => {
    const { doc, colorIndex, brushSize, flags, focus } = get();
    const v = colorIndex + 1;
    const pts = bresenham(x0, y0, x1, y1);
    const r = Math.floor((brushSize - 1) / 2);
    for (const [x, y] of pts) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (!allows(focus, doc.width, doc.height, px, py)) continue;
          doc.cells[py * doc.width + px] = v;
          if (flags.symmetryX) doc.cells[py * doc.width + (doc.width - 1 - px)] = v;
          if (flags.symmetryY) doc.cells[(doc.height - 1 - py) * doc.width + px] = v;
          if (flags.symmetryX && flags.symmetryY)
            doc.cells[(doc.height - 1 - py) * doc.width + (doc.width - 1 - px)] = v;
        }
      }
    }
    set({ doc: { ...doc, updatedAt: Date.now() }, dirty: true });
  },

  drawShape: (kind, x0, y0, x1, y1) => {
    const { doc, colorIndex, flags, shapeFill, focus } = get();
    const v = colorIndex + 1;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const setPx = (x: number, y: number) => {
      if (!allows(focus, doc.width, doc.height, x, y)) return;
      doc.cells[y * doc.width + x] = v;
      if (flags.symmetryX) doc.cells[y * doc.width + (doc.width - 1 - x)] = v;
      if (flags.symmetryY) doc.cells[(doc.height - 1 - y) * doc.width + x] = v;
      if (flags.symmetryX && flags.symmetryY)
        doc.cells[(doc.height - 1 - y) * doc.width + (doc.width - 1 - x)] = v;
    };
    if (kind === 'rect') {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const edge = x === minX || x === maxX || y === minY || y === maxY;
          if (shapeFill || edge) setPx(x, y);
        }
      }
    } else {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rx = Math.max(0.5, (maxX - minX) / 2);
      const ry = Math.max(0.5, (maxY - minY) / 2);
      // 逐格判断「格心是否落在椭圆环带内」：
      // 实心 = 落在椭圆内；描边 = 落在椭圆内且不在内缩一圈的椭圆内。
      // 之前描边用 d > 0.55 做近似，边框宽度随半径变化，圆的四个"角"会缺格。
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
          if (shapeFill || !inside(x, y, innerRx, innerRy)) setPx(x, y);
        }
      }
    }
    set({ doc: { ...doc, updatedAt: Date.now() }, dirty: true });
  },

  newDocument: (w, h, paletteKey, name) => {
    const doc = createDoc(w, h, paletteKey, name);
    set({
      doc,
      past: [],
      future: [],
      colorIndex: 0,
      zoom: Math.max(4, Math.min(24, Math.floor(680 / Math.max(doc.width, doc.height)))),
      pan: { x: 0, y: 0 },
      dirty: true,
      hover: null,
      focus: null,
      checkColor: -1,
      wrongMarks: new Set<number>(),
      wrongCount: 0,
      rightCount: 0,
      soloColor: null,
    });
  },

  loadDocument: (doc) => {
    set({
      doc,
      past: [],
      future: [],
      colorIndex: 0,
      zoom: Math.max(4, Math.min(24, Math.floor(680 / Math.max(doc.width, doc.height)))),
      pan: { x: 0, y: 0 },
      dirty: false,
      hover: null,
      focus: null,
      checkColor: -1,
      wrongMarks: new Set<number>(),
      wrongCount: 0,
      rightCount: 0,
      soloColor: null,
    });
  },

  renameDoc: (name) => set({ doc: { ...get().doc, name, updatedAt: Date.now() }, dirty: true }),

  resizeDoc: (w, h) => {
    const { doc, focus } = get();
    const snap = snapshot(doc, focus);
    const next = createDoc(w, h, 'mard', doc.name);
    next.palette = doc.palette.map((c) => ({ ...c }));
    next.pegboard = doc.pegboard;
    next.createdAt = doc.createdAt;
    next.notes = doc.notes;
    next.id = doc.id;
    // 用 clamp 之后的真实尺寸拷数据：直接拿入参 w/h 会在超限时越界写
    const nextW = next.width;
    const nextH = next.height;
    const copyW = Math.min(nextW, doc.width);
    const copyH = Math.min(nextH, doc.height);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        next.cells[y * nextW + x] = doc.cells[y * doc.width + x];
        next.progress[y * nextW + x] = doc.progress[y * doc.width + x];
      }
    }
    // 尺寸变了，原来聚焦的那块板可能已经不存在
    const nextFocus =
      focus && focus.col < boardCols(next.width, focus.size) && focus.row < boardRows(next.height, focus.size)
        ? focus
        : null;
    set({
      doc: next,
      past: get().past.concat([snap]),
      future: [],
      dirty: true,
      focus: nextFocus,
      // 尺寸变了，叉号的下标会整体错位，直接清掉
      wrongMarks: new Set<number>(),
    });
  },

  setPegboard: (n) => {
    const pegboard = clampPegboard(n);
    // 换板规格后旧聚焦坐标会指错地方，直接退回全图
    set({
      doc: { ...get().doc, pegboard, updatedAt: Date.now() },
      dirty: true,
      focus: null,
    });
  },
  setNotes: (s) => set({ doc: { ...get().doc, notes: s }, dirty: true }),

  setFocus: (f) => {
    const { doc } = get();
    if (!f) {
      set({ focus: null });
      return;
    }
    if (doc.pegboard <= 0) return;
    const col = Math.max(0, Math.min(boardCols(doc.width, doc.pegboard) - 1, f.col));
    const row = Math.max(0, Math.min(boardRows(doc.height, doc.pegboard) - 1, f.row));
    set({ focus: { size: doc.pegboard, ...{ col, row } } });
  },

  focusOnCell: (x, y) => {
    const { doc, focus, setFocus } = get();
    if (doc.pegboard <= 0) return;
    // 已经聚焦在同一块板上：再点一次就退出聚焦（像个开关）
    if (focus && Math.floor(x / doc.pegboard) === focus.col && Math.floor(y / doc.pegboard) === focus.row) {
      setFocus(null);
      return;
    }
    setFocus({ size: doc.pegboard, col: Math.floor(x / doc.pegboard), row: Math.floor(y / doc.pegboard) });
  },

  stepFocus: (delta) => {
    const { doc, focus, setFocus } = get();
    if (doc.pegboard <= 0) return;
    const cols = boardCols(doc.width, doc.pegboard);
    const rows = boardRows(doc.height, doc.pegboard);
    const total = cols * rows;
    if (total <= 0) return;
    const cur = focus ? focus.row * cols + focus.col : -1;
    const next = cur < 0 ? (delta > 0 ? 0 : total - 1) : (cur + delta + total) % total;
    setFocus({ size: doc.pegboard, col: next % cols, row: Math.floor(next / cols) });
  },

  addCustomColor: (c) => {
    const { doc } = get();
    const palette = doc.palette.concat([{ ...c, custom: true }]);
    set({ doc: { ...doc, palette, updatedAt: Date.now() }, dirty: true });
    return palette.length - 1;
  },

  updateColor: (index, patch) => {
    const { doc } = get();
    const palette = doc.palette.map((c, i) => (i === index ? { ...c, ...patch } : c));
    set({ doc: { ...doc, palette, updatedAt: Date.now() }, dirty: true });
  },

  removeColor: (index) => {
    const { doc } = get();
    if (doc.palette.length <= 1) return;
    const palette = doc.palette.filter((_, i) => i !== index);
    const cells = doc.cells.slice();
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === index + 1) cells[i] = 0;
      else if (cells[i] > index + 1) cells[i] -= 1;
    }
    set({ doc: { ...doc, palette, cells, updatedAt: Date.now() }, dirty: true });
  },

  replaceColor: (index, hex) => {
    const { doc } = get();
    const palette = doc.palette.map((c, i) => (i === index ? { ...c, hex } : c));
    set({ doc: { ...doc, palette, updatedAt: Date.now() }, dirty: true });
  },

  replaceAllOfColor: (index, hex) => {
    const { doc } = get();
    const palette = doc.palette.map((c, i) => (i === index ? { ...c, hex } : c));
    set({ doc: { ...doc, palette, updatedAt: Date.now() }, dirty: true });
  },

  setPalette: (palette) => set({ doc: { ...get().doc, palette, updatedAt: Date.now() }, dirty: true }),

  fillAll: () => {
    const { doc, colorIndex } = get();
    doc.cells.fill(colorIndex + 1);
    set({ doc: { ...doc, updatedAt: Date.now() }, dirty: true });
  },

  clearAll: () => {
    const { doc } = get();
    doc.cells.fill(0);
    doc.progress.fill(0);
    set({ doc: { ...doc, updatedAt: Date.now() }, dirty: true });
  },

  markAllPlaced: (v) => {
    const { doc } = get();
    const progress = doc.progress.slice();
    for (let i = 0; i < doc.cells.length; i++) {
      if (doc.cells[i] !== 0) progress[i] = v ? 1 : 0;
    }
    set({ doc: { ...doc, progress, updatedAt: Date.now() }, dirty: true });
  },

  applyImported: (cells, palette, width, height, name, pegboard) => {
    const doc = get().doc;
    const next: PatternDoc = {
      ...doc,
      id: uid(),
      name: name ?? doc.name,
      width,
      height,
      cells,
      progress: new Uint8Array(width * height),
      palette,
      // 导入时顺手把板规格定下来：用户选「小板 29」就是想按 29 格一块板拼
      pegboard: pegboard !== undefined ? clampPegboard(pegboard) : doc.pegboard,
      updatedAt: Date.now(),
    };
    set({
      doc: next,
      past: [],
      future: [],
      colorIndex: 0,
      zoom: Math.max(3, Math.min(22, Math.floor(680 / Math.max(width, height)))),
      pan: { x: 0, y: 0 },
      dirty: true,
      hover: null,
      focus: null,
      checkColor: -1,
      wrongMarks: new Set<number>(),
      wrongCount: 0,
      rightCount: 0,
      soloColor: null,
    });
  },

  markClean: () => set({ dirty: false }),
  setDocMetaList: (l) => set({ docMetaList: l }),
  requestFit: () => set({ fitRequest: get().fitRequest + 1 }),

  moveCursor: (dx, dy, step = 1) => {
    const { doc, hover } = get();
    // 还没有光标时，先放到图纸中央
    const cur = hover ?? { x: Math.floor(doc.width / 2), y: Math.floor(doc.height / 2) };
    const nx = Math.max(0, Math.min(doc.width - 1, cur.x + dx * step));
    const ny = Math.max(0, Math.min(doc.height - 1, cur.y + dy * step));
    set({ hover: { x: nx, y: ny }, cursorTick: get().cursorTick + 1 });
  },

  paintAtCursor: (erase = false) => {
    const { doc, hover, tool, colorIndex, flags } = get();
    // 还没有光标：先把光标放到图纸中央，这一步不落笔
    if (!hover) {
      set({
        hover: { x: Math.floor(doc.width / 2), y: Math.floor(doc.height / 2) },
        cursorTick: get().cursorTick + 1,
      });
      return;
    }
    const { x, y } = hover;
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    if (flags.progressMode) {
      get().clickProgress(x, y);
      return;
    }
    if (tool === 'picker') {
      const v = doc.cells[y * doc.width + x];
      if (v) set({ colorIndex: v - 1 });
      return;
    }
    get().beginStroke();
    if (erase || tool === 'eraser') get().paintCell(x, y, { value: 0 });
    else if (tool === 'bucket') get().floodFill(x, y);
    else get().paintCell(x, y);
    get().endStroke();
    void colorIndex;
  },
}));

export function bresenham(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (let guard = 0; guard < 100000; guard++) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}
