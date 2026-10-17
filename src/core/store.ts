import { create } from 'zustand';
import type { BeadColor, PatternDoc, Snapshot, Tool, ViewFlags } from '../core/types';
import { DEFAULT_FLAGS } from '../core/types';
import { palettePreset } from '../core/palette';
import { uid } from '../core/util';
import { loadDoc, readIndex } from './storage';
import { createDemoDoc } from './demo';

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

export function createDoc(width: number, height: number, paletteKey = 'mard', name = '未命名图纸'): PatternDoc {
  const palette = palettePreset(paletteKey);
  return {
    id: uid(),
    name,
    width,
    height,
    cells: new Uint16Array(width * height),
    progress: new Uint8Array(width * height),
    palette,
    pegboard: 29,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    notes: '',
  };
}

function snapshot(doc: PatternDoc): Snapshot {
  return {
    width: doc.width,
    height: doc.height,
    cells: doc.cells.slice(),
    progress: doc.progress.slice(),
    palette: doc.palette.map((c) => ({ ...c })),
    pegboard: doc.pegboard,
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
  /** 进度模式下本次拖动是「标记已拼」还是「取消已拼」 */
  progressTarget: 0 | 1;
  toast: { id: number; text: string; kind?: 'ok' | 'warn' } | null;
  dirty: boolean;
  docMetaList: DocMeta[];

  setTool: (t: Tool) => void;
  setColorIndex: (i: number) => void;
  setBrushSize: (n: number) => void;
  setShapeFill: (v: boolean) => void;
  toggleFlag: (k: keyof ViewFlags) => void;
  setFlag: (k: keyof ViewFlags, v: boolean) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  setHover: (h: HoverCell | null) => void;
  notify: (text: string, kind?: 'ok' | 'warn') => void;

  beginStroke: () => void;
  endStroke: () => void;
  undo: () => void;
  redo: () => void;

  paintCell: (x: number, y: number, opts?: PaintOptions) => void;
  paintProgressCell: (x: number, y: number, value: 0 | 1) => void;
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
  applyImported: (cells: Uint16Array, palette: BeadColor[], width: number, height: number, name?: string) => void;
  markClean: () => void;
  setDocMetaList: (l: DocMeta[]) => void;
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
  progressTarget: 1,
  toast: null,
  dirty: false,
  docMetaList: [],

  setTool: (t) => set({ tool: t }),
  setColorIndex: (i) => set({ colorIndex: i, tool: get().tool === 'picker' ? 'pencil' : get().tool }),
  setBrushSize: (n) => set({ brushSize: Math.max(1, Math.min(16, n)) }),
  setShapeFill: (v) => set({ shapeFill: v }),
  toggleFlag: (k) => set({ flags: { ...get().flags, [k]: !get().flags[k] } }),
  setFlag: (k, v) => set({ flags: { ...get().flags, [k]: v } }),
  setZoom: (z) => set({ zoom: Math.max(1, Math.min(64, z)) }),
  setPan: (p) => set({ pan: p }),
  setHover: (h) => set({ hover: h }),
  notify: (text, kind = 'ok') => {
    const id = Date.now() + Math.random();
    set({ toast: { id, text, kind } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 2200);
  },

  beginStroke: () => {
    const { doc, past } = get();
    const snap = snapshot(doc);
    const next = past.concat([snap]);
    if (next.length > HISTORY_LIMIT) next.shift();
    set({ past: next, future: [], strokeActive: true });
  },

  endStroke: () => {
    const { doc } = get();
    doc.updatedAt = Date.now();
    set({ strokeActive: false, dirty: true });
  },

  undo: () => {
    const { past, future, doc } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    const cur = snapshot(doc);
    set({
      doc: restore(doc, prev),
      past: past.slice(0, -1),
      future: future.concat([cur]),
      dirty: true,
    });
  },

  redo: () => {
    const { past, future, doc } = get();
    if (!future.length) return;
    const next = future[future.length - 1];
    const cur = snapshot(doc);
    set({
      doc: restore(doc, next),
      past: past.concat([cur]),
      future: future.slice(0, -1),
      dirty: true,
    });
  },

  paintCell: (x, y, opts = {}) => {
    const { doc, colorIndex, brushSize, flags } = get();
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
    const { doc, brushSize } = get();
    const r = Math.floor((brushSize - 1) / 2);
    let changed = false;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) continue;
        const i = py * doc.width + px;
        if (doc.cells[i] === 0) continue;
        if (doc.progress[i] !== value) {
          doc.progress[i] = value;
          changed = true;
        }
      }
    }
    if (changed) set({ doc: { ...doc, updatedAt: Date.now() }, dirty: true });
  },

  floodFill: (x, y) => {
    const { doc, colorIndex } = get();
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
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
      if (px > 0) stack.push(i - 1);
      if (px < doc.width - 1) stack.push(i + 1);
      if (py > 0) stack.push(i - doc.width);
      if (py < doc.height - 1) stack.push(i + doc.width);
    }
    set({ doc: { ...doc, updatedAt: Date.now() }, dirty: true });
  },

  drawLine: (x0, y0, x1, y1) => {
    const { doc, colorIndex, brushSize, flags } = get();
    const v = colorIndex + 1;
    const pts = bresenham(x0, y0, x1, y1);
    const r = Math.floor((brushSize - 1) / 2);
    for (const [x, y] of pts) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) continue;
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
    const { doc, colorIndex, flags, shapeFill } = get();
    const v = colorIndex + 1;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const setPx = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
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
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const nx = (x - cx) / (rx + 0.5);
          const ny = (y - cy) / (ry + 0.5);
          const d = nx * nx + ny * ny;
          if (d <= 1) {
            if (shapeFill) setPx(x, y);
            else if (d > 0.55) setPx(x, y);
          }
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
      zoom: Math.max(4, Math.min(24, Math.floor(680 / Math.max(w, h)))),
      pan: { x: 0, y: 0 },
      dirty: true,
      hover: null,
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
    });
  },

  renameDoc: (name) => set({ doc: { ...get().doc, name, updatedAt: Date.now() }, dirty: true }),

  resizeDoc: (w, h) => {
    const { doc } = get();
    const snap = snapshot(doc);
    const next = createDoc(w, h, 'mard', doc.name);
    next.palette = doc.palette.map((c) => ({ ...c }));
    next.pegboard = doc.pegboard;
    next.createdAt = doc.createdAt;
    next.notes = doc.notes;
    next.id = doc.id;
    const copyW = Math.min(w, doc.width);
    const copyH = Math.min(h, doc.height);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        next.cells[y * w + x] = doc.cells[y * doc.width + x];
        next.progress[y * w + x] = doc.progress[y * doc.width + x];
      }
    }
    set({ doc: next, past: get().past.concat([snap]), future: [], dirty: true });
  },

  setPegboard: (n) => set({ doc: { ...get().doc, pegboard: n, updatedAt: Date.now() }, dirty: true }),
  setNotes: (s) => set({ doc: { ...get().doc, notes: s }, dirty: true }),

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

  applyImported: (cells, palette, width, height, name) => {
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
    });
  },

  markClean: () => set({ dirty: false }),
  setDocMetaList: (l) => set({ docMetaList: l }),
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
