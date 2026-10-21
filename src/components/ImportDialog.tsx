import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { DEFAULT_QUANTIZE, backgroundMask, cropRectFor, magicWandMask, quantizeImage, sampleImage } from '../core/quantize';
import { BUILTIN_PALETTES, BRAND_LABEL, PALETTE_KEYS, palettePreset } from '../core/palette';
import type { BeadColor } from '../core/types';
import { IconCheck, IconClose, IconImage, IconUpload, IconWand } from './Icons';
import { renderPatternCanvas } from '../core/export';
import { PEGBOARD_MAX, PEGBOARD_PRESETS, CANVAS_MAX, DEFAULT_PEGBOARD, clampPegboard } from '../core/board';

interface Props {
  onClose: () => void;
  /** 外部拖入的图片：打开对话框时直接载入 */
  initialFile?: File | null;
  /** 上一次导入的全部设置：打开对话框时还原，用来二次编辑 */
  initialSeed?: ImportSeed | null;
  /** 生成成功后把设置交回上层，供「再调一下」再来一遍 */
  onSeed?: (seed: ImportSeed) => void;
}

/**
 * 一次导入的全部输入。存下来是为了「生成完不满意还能改」：
 * 图片本身（dataURL）+ 裁切中心/缩放 + 手抠遮罩 + 所有量化参数。
 */
export interface ImportSeed {
  dataUrl: string;
  fileName: string;
  boardSize: number;
  cols: number;
  rows: number;
  crop: { zoom: number; cx: number; cy: number };
  mask: Uint8Array | null;
  dither: number;
  ditherMode: 'none' | 'fs' | 'ordered';
  sample: 'point' | 'average';
  brightness: number;
  contrast: number;
  saturation: number;
  transparentWhite: boolean;
  whiteThreshold: number;
  speckle: boolean;
  useDocPalette: boolean;
  brandKey: string;
}

type Sample = 'point' | 'average';
/** move=不改；paint/erase=笔刷；rect* = 框选一块矩形整块处理；wand* = 魔棒点一下选整片同色连通区 */
type MaskTool = 'move' | 'paint' | 'erase' | 'rectCut' | 'rectKeep' | 'rectOnly' | 'wandCut' | 'wandKeep';

const isRectTool = (t: MaskTool) => t === 'rectCut' || t === 'rectKeep' || t === 'rectOnly';
const isWandTool = (t: MaskTool) => t === 'wandCut' || t === 'wandKeep';

/** 单板格数常用档：直接取拼豆板规格表，和画布设置里的分板保持一致 */
const BOARD_SIZES = PEGBOARD_PRESETS.filter((p) => p.value > 0);

/** 把 cells 裁到指定矩形，并顺手把没用到的颜色从色板里压掉 */
function cropCells(
  cells: Uint16Array,
  palette: BeadColor[],
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): { cells: Uint16Array; palette: BeadColor[] } {
  const out = new Uint16Array(w * h);
  const used = new Set<number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = cells[(y + y0) * width + (x + x0)] ?? 0;
      out[y * w + x] = v;
      if (v) used.add(v - 1);
    }
  }
  const keep = Array.from(used).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  const next = keep.map((old, i) => {
    remap.set(old, i);
    return palette[old];
  });
  if (remap.size !== palette.length) {
    for (let i = 0; i < out.length; i++) if (out[i] > 0) out[i] = (remap.get(out[i] - 1) ?? 0) + 1;
  }
  return { cells: out, palette: next };
}

/** 板数步进器：既能按加减，也能直接填数字 */
function TileStepper({
  label,
  value,
  text,
  max,
  min = 1,
  onText,
  onCommit,
}: {
  label: string;
  value: number;
  text: string;
  max: number;
  min?: number;
  onText: (s: string) => void;
  onCommit: (n: number) => void;
}) {
  return (
    <>
      <span className="val" style={{ width: 'auto' }}>
        {label}
      </span>
      <button className="chip" onClick={() => onCommit(Math.max(min, value - 1))} title="少一块板">
        −
      </button>
      <input
        type="number"
        className="input"
        style={{ width: 62 }}
        min={min}
        max={max}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onBlur={() => onCommit(value)}
      />
      <button className="chip" onClick={() => onCommit(Math.min(max, value + 1))} title="多一块板">
        +
      </button>
    </>
  );
}

export default function ImportDialog({ onClose, initialFile, initialSeed, onSeed }: Props) {
  const doc = useEditor((s) => s.doc);
  const applyImported = useEditor((s) => s.applyImported);
  const notify = useEditor((s) => s.notify);

  const seed = initialSeed ?? null;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState(seed?.fileName ?? '');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  // 尺寸按「真实的拼豆板」来定：单板格数 × 横纵板数。
  // 之前只有一个「画布宽度（格）」滑杆，用户拿到 64×64 的图根本不知道自己要用几块板，
  // 预览里也没有分板线，所以才会说「完全不是按照板子数量分的」。
  const [boardSize, setBoardSize] = useState(seed?.boardSize ?? DEFAULT_PEGBOARD);
  // 允许把单板格数清空重填（和板数输入一样，以前删不掉 0）
  const [boardText, setBoardText] = useState(String(seed?.boardSize ?? DEFAULT_PEGBOARD));
  const [cols, setCols] = useState(seed?.cols ?? 2);
  const [rows, setRows] = useState(seed?.rows ?? 2);
  // 锁定正方形：调一个另一个跟着动（拼豆板本身就是方的，默认锁上更符合直觉）
  const [lockSquare, setLockSquare] = useState(true);
  const [dither, setDither] = useState(seed?.dither ?? 0.5);
  const [ditherMode, setDitherMode] = useState<'none' | 'fs' | 'ordered'>(seed?.ditherMode ?? 'fs');
  const [sample, setSample] = useState<Sample>(seed?.sample ?? 'average');
  const [brightness, setBrightness] = useState(seed?.brightness ?? 1);
  const [contrast, setContrast] = useState(seed?.contrast ?? 1);
  const [saturation, setSaturation] = useState(seed?.saturation ?? 1);
  // 白底处理默认关闭：默认开着会把人物高光、白衣、眼睛反光挖成洞，
  // 用户看到的「中间一块块没色号」多数就是这么来的。需要去白底再手动打开。
  const [transparentWhite, setTransparentWhite] = useState(seed?.transparentWhite ?? false);
  const [whiteThreshold, setWhiteThreshold] = useState(seed?.whiteThreshold ?? 242);
  // 去零散单颗：抖动留下的孤立点最费眼，默认清掉
  const [speckle, setSpeckle] = useState(seed?.speckle ?? true);
  // 参考比例（1 颗豆 ≈ 原图几个像素）与豆子规格：只当辅助参考，帮用户估成品多大
  const [ratioText, setRatioText] = useState('2');
  const [beadMm, setBeadMm] = useState(5);
  // 板数允许中途清空重填（以前 0 删不掉，被用户吐槽过）
  const [colsText, setColsText] = useState(String(seed?.cols ?? 2));
  const [rowsText, setRowsText] = useState(String(seed?.rows ?? 2));
  // 默认用品牌全色板（色阶充足，渐变过渡自然）；当前图纸色板通常只有几种颜色，留给用户主动选
  const [useDocPalette, setUseDocPalette] = useState(seed?.useDocPalette ?? false);
  // 直接用完整 key，避免再靠 ALIASES 把 'mard' 映射成 'mard291'
  const [brandKey, setBrandKey] = useState(seed?.brandKey ?? 'mard291');

  /** 裁切中心 + 缩放：决定「取图片的哪一块」，默认整张居中 */
  const [crop, setCrop] = useState(() => seed?.crop ?? { zoom: 1, cx: 0.5, cy: 0.5 });
  /** 手抠遮罩：0 = 抠掉（不算豆子、不占板子），长度必须等于 width*height */
  const [mask, setMask] = useState<Uint8Array | null>(() => seed?.mask ?? null);
  const [tool, setTool] = useState<MaskTool>('move');
  const [brush, setBrush] = useState(2);
  const [tolerance, setTolerance] = useState(26);
  /** 魔棒是否走 8 邻域（默认 4 邻域，避免顺着斜向细缝漏出去把整张图吃掉） */
  const [diagWand, setDiagWand] = useState(false);
  /** 魔棒是否吃全图同色（勾上就不管连不连通，图里所有同色块一起处理） */
  const [wandGlobal, setWandGlobal] = useState(false);
  /** 生成时是否按内容裁掉四周空板 */
  const [trimToContent, setTrimToContent] = useState(true);

  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  /** 最近一次采样出来的原始像素：一键抠图要靠它判断边缘颜色 */
  const sampledRef = useRef<Uint8ClampedArray | null>(null);
  /** 正在拖/涂的状态 */
  const dragRef = useRef<{ x: number; y: number; painting: boolean; moved: boolean } | null>(null);
  /** 手抠过程中的工作副本：pointerup 才提交给 state，避免每一笔都重跑量化 */
  const workMaskRef = useRef<Uint8Array | null>(seed?.mask ?? null);
  /** 框选正在拖的矩形（格坐标，含小数端点） */
  const [rectSel, setRectSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const rectSelRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const rectDragRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * 魔棒悬停预览：鼠标停在预览上时就先把「点下去会吃哪一片」标出来，
   * 不用点一下才发现吃错了再撤销。按格缓存，只有跨格才重算。
   */
  const wandHoverCellRef = useRef(-1);
  const wandHoverCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceGeomRef = useRef({ scale: 1, dw: 0, dh: 0 });
  const previewGeomRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const width = boardSize * cols;
  const height = boardSize * rows;

  // 板数上限：单边 ≤ CANVAS_MAX，总数也别太夸张，免得一不小心生成百万格
  const maxTiles = Math.max(1, Math.min(16, Math.floor(CANVAS_MAX / Math.max(1, boardSize))));
  useEffect(() => {
    setCols((c) => {
      const n = Math.min(c, maxTiles);
      setColsText(String(n));
      return n;
    });
    setRows((r) => {
      const n = Math.min(r, maxTiles);
      setRowsText(String(n));
      return n;
    });
  }, [maxTiles]);

  /** 解析用户手填的板数；留空或非法返回 null（保持原值，允许清空重填） */
  const parseTiles = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    return Math.max(1, Math.min(maxTiles, Math.round(v)));
  };

  /** 原图每个像素大约对应多大一块豆子（越小越精细） */
  const pxPerBead = img ? img.naturalWidth / Math.max(1, width) : 0;

  // 反过来也要同步：用户直接改「单板格数」或「几块板」时，
  // 上面的参考比例要跟着变，不能还挂着旧数字。
  useEffect(() => {
    if (!img || !pxPerBead) return;
    if (ratioFocusedRef.current) return;
    setRatioText(String(Math.round(pxPerBead * 10) / 10));
  }, [img, pxPerBead]);

  /** 按「1 颗豆 ≈ N 个原图像素」反推板数；单板格数也跟着自动挑一档 */
  const applyRatio = (r: number, keepText = false) => {
    if (!img || !Number.isFinite(r) || r <= 0) return;
    const targetW = Math.max(1, Math.round(img.naturalWidth / r));
    const targetH = Math.max(1, Math.round(img.naturalHeight / r));
    // 板子往大了挑：先试最大的板规格，板数会超过 8×8 就换小一档，
    // 这样「单板格数」会自己跟着参考比例变，不用手调两次。
    const candidates = BOARD_SIZES.map((p) => p.value)
      .filter((v) => v <= CANVAS_MAX)
      .sort((a, b) => b - a);
    let picked = boardSize;
    for (const v of candidates) {
      if (Math.ceil(targetW / v) <= 8 && Math.ceil(targetH / v) <= 8) {
        picked = v;
        break;
      }
    }
    const c = Math.max(1, Math.min(16, Math.ceil(targetW / picked)));
    const rw = Math.max(1, Math.min(16, Math.ceil(targetH / picked)));
    setBoardSize(picked);
    setBoardText(String(picked));
    setCols(c);
    setRows(rw);
    setColsText(String(c));
    setRowsText(String(rw));
    if (!keepText) setRatioText(String(r));
  };

  // 参考比例输入框是否正在编辑：正编辑时不要用「实际比例」把用户敲进去的数字覆盖掉
  const ratioFocusedRef = useRef(false);

  const palette: BeadColor[] = useMemo(() => {
    return useDocPalette ? doc.palette : palettePreset(brandKey);
  }, [useDocPalette, doc.palette, brandKey]);

  const aspect = width / Math.max(1, height);
  /** 当前裁切窗（源图像素）：决定「取图片的哪一块」，默认整张居中 */
  const cropRect = useMemo(() => {
    if (!img) return undefined;
    return cropRectFor(img.naturalWidth || img.width, img.naturalHeight || img.height, aspect, crop.zoom, crop.cx, crop.cy);
  }, [img, aspect, crop]);

  /** 尺寸一变遮罩就对不上了：长度不符直接作废，别让它错位地抠掉别人的格子 */
  const activeMask = mask && mask.length === width * height ? mask : null;
  useEffect(() => {
    if (mask && mask.length !== width * height) {
      setMask(null);
      workMaskRef.current = null;
    }
  }, [mask, width, height]);

  const result = useMemo(() => {
    if (!img) return null;
    try {
      // 只采用户框住的那一块；没框就退化成原来的 cover（等比居中裁切）
      const data = sampleImage(img, width, height, sample, 'cover', cropRect);
      sampledRef.current = data;
      return quantizeImage(data, {
        ...DEFAULT_QUANTIZE,
        width,
        height,
        maxColors: palette.length,
        dither,
        ditherMode,
        sample,
        brightness,
        contrast,
        saturation,
        transparentWhite,
        whiteThreshold,
        speckle,
        palette,
        mask: activeMask ?? undefined,
      });
    } catch {
      return null;
    }
  }, [
    img,
    width,
    height,
    sample,
    dither,
    ditherMode,
    brightness,
    contrast,
    saturation,
    transparentWhite,
    whiteThreshold,
    speckle,
    palette,
    cropRect,
    activeMask,
  ]);

  /** 预览绘制：带分板线，让用户一眼看到「这是几块板拼起来」 */
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !result) return;
    const tmp = renderPatternCanvas(
      {
        ...doc,
        width,
        height,
        cells: result.cells,
        progress: new Uint8Array(width * height),
        palette: result.palette,
      },
      {
        cellSize: 8,
        grid: false,
        coords: false,
        background: null,
        holes: false,
        showCodes: false,
        dimUnplaced: false,
        boardSize: boardSize > 0 ? boardSize : 0,
      },
    );
    const maxW = 520;
    const scale = Math.min(1, maxW / tmp.width);
    canvas.width = Math.round(tmp.width * scale);
    canvas.height = Math.round(tmp.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    // 记住图案在画布里的实际位置，手抠时要把指针坐标换算回格子
    previewGeomRef.current = {
      x: 0,
      y: 0,
      w: canvas.width,
      h: canvas.height,
    };
  }, [result, doc, width, height, boardSize]);

  /** 遮罩图层：抠掉的格子盖一层灰，尺寸/位置跟预览 canvas 完全一致 */
  const drawMask = useCallback(() => {
    const layer = maskRef.current;
    const src = previewRef.current;
    if (!layer || !src || !src.width) return;
    // 直接跟预览 canvas 的像素尺寸对齐：预览是 nearest 缩放到 CSS 尺寸显示的，
    // 遮罩层只要和它的内部分辨率一致、再用 CSS 铺满同一个盒子，就永远不会错位。
    if (layer.width !== src.width || layer.height !== src.height) {
      layer.width = src.width;
      layer.height = src.height;
    }
    layer.style.width = '100%';
    layer.style.height = '100%';
    const ctx = layer.getContext('2d')!;
    ctx.clearRect(0, 0, layer.width, layer.height);
    const m = workMaskRef.current ?? mask;
    const cw = layer.width / width;
    const ch = layer.height / height;
    if (m) {
      const cell = Math.max(1, Math.ceil(Math.max(cw, ch)));
      ctx.fillStyle = 'rgba(120,124,146,0.55)';
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (m[y * width + x]) continue;
          ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), cell, cell);
        }
      }
    }
    // 正在拖的框选：实时画框 + 框外压暗，松手才真正改遮罩
    const sel = rectSelRef.current;
    if (sel && isRectTool(tool)) {
      const x0 = Math.min(sel.x0, sel.x1) * cw;
      const x1 = Math.max(sel.x0, sel.x1) * cw;
      const y0 = Math.min(sel.y0, sel.y1) * ch;
      const y1 = Math.max(sel.y0, sel.y1) * ch;
      ctx.fillStyle = tool === 'rectKeep' ? 'rgba(56,160,120,0.22)' : 'rgba(226,92,72,0.22)';
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      ctx.strokeStyle = tool === 'rectKeep' ? 'rgba(24,130,96,0.95)' : 'rgba(210,64,48,0.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, x1 - x0) - 1, Math.max(1, y1 - y0) - 1);
    }
  }, [width, height, mask, tool]);

  useEffect(() => {
    drawMask();
  }, [drawMask, mask, result]);

  /**
   * 魔棒悬停预览：把「点下去会吃哪一片」先标成半透明色块。
   * 用单独一层 canvas（不吃指针事件），不会和遮罩层打架。
   */
  const drawWandHover = useCallback(
    (cx: number, cy: number) => {
      const layer = wandHoverCanvasRef.current;
      const src = previewRef.current;
      const data = sampledRef.current;
      if (!layer || !src || !src.width || !data) return;
      if (layer.width !== src.width || layer.height !== src.height) {
        layer.width = src.width;
        layer.height = src.height;
      }
      layer.style.width = '100%';
      layer.style.height = '100%';
      const ctx = layer.getContext('2d')!;
      ctx.clearRect(0, 0, layer.width, layer.height);
      const hit = magicWandMask(data, width, height, cx, cy, tolerance, diagWand, !wandGlobal);
      const cw = layer.width / width;
      const ch = layer.height / height;
      const cell = Math.max(1, Math.ceil(Math.max(cw, ch)));
      // 高亮用琥珀黄 / 青绿：叠在红蓝绿的图上都还看得清
      // （一开始用半透明红叠红块，用户根本看不出选了哪儿）
      const keep = tool === 'wandKeep';
      ctx.fillStyle = keep ? 'rgba(34,197,168,0.55)' : 'rgba(255,196,48,0.6)';
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!hit[y * width + x]) continue;
          ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), cell, cell);
        }
      }
      // 再勾一圈边缘，小面积选区也能一眼看见
      ctx.strokeStyle = keep ? 'rgba(12,120,100,0.9)' : 'rgba(190,120,0,0.9)';
      ctx.lineWidth = 1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!hit[y * width + x]) continue;
          const px = Math.floor(x * cw);
          const py = Math.floor(y * ch);
          const left = x === 0 || !hit[y * width + x - 1];
          const right = x === width - 1 || !hit[y * width + x + 1];
          const up = y === 0 || !hit[(y - 1) * width + x];
          const down = y === height - 1 || !hit[(y + 1) * width + x];
          if (left) ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
          if (right) ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
          if (up) ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
          if (down) ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
        }
      }
    },
    [width, height, tolerance, diagWand, wandGlobal, tool],
  );

  const clearWandHover = useCallback(() => {
    wandHoverCellRef.current = -1;
    const layer = wandHoverCanvasRef.current;
    if (!layer) return;
    layer.getContext('2d')?.clearRect(0, 0, layer.width, layer.height);
  }, []);

  // 换成别的工具、或者遮罩变了，就把悬停高亮撤掉（不然会留一片过期的红块）
  useEffect(() => {
    if (!isWandTool(tool)) clearWandHover();
  }, [tool, clearWandHover]);
  useEffect(() => {
    clearWandHover();
  }, [mask, clearWandHover]);

  /** 原图 + 裁切框：拖动改中心、滚轮缩放，用来「选哪一块」 */
  useEffect(() => {
    const canvas = sourceRef.current;
    if (!canvas || !img) return;
    const boxW = 420;
    const boxH = 300;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(boxW / iw, boxH / ih);
    const dw = Math.max(1, Math.round(iw * scale));
    const dh = Math.max(1, Math.round(ih * scale));
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(img, 0, 0, dw, dh);
    sourceGeomRef.current = { scale, dw, dh };
    if (cropRect) {
      const x = cropRect.x * scale;
      const y = cropRect.y * scale;
      const w = cropRect.w * scale;
      const h = cropRect.h * scale;
      ctx.fillStyle = 'rgba(12,14,22,0.55)';
      ctx.fillRect(0, 0, dw, y);
      ctx.fillRect(0, y + h, dw, dh - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, dw - x - w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.strokeStyle = 'rgba(40,44,60,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      // 三分线，方便对准主体
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(x + (w * i) / 3, y);
        ctx.lineTo(x + (w * i) / 3, y + h);
        ctx.moveTo(x, y + (h * i) / 3);
        ctx.lineTo(x + w, y + (h * i) / 3);
      }
      ctx.stroke();
    }
  }, [img, cropRect]);

  /** 在原图上拖动 = 移动裁切窗（像手机相册裁图那样，拖的是图） */
  const onSourceDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, painting: false, moved: false };
  };
  const onSourceMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!dx && !dy) return;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved = true;
    const { dw, dh } = sourceGeomRef.current;
    if (!dw || !dh) return;
    setCrop((c) => ({
      ...c,
      cx: Math.min(1, Math.max(0, c.cx - dx / dw)),
      cy: Math.min(1, Math.max(0, c.cy - dy / dh)),
    }));
  };
  const onSourceUp = () => {
    dragRef.current = null;
  };
  const onSourceWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    setCrop((c) => ({ ...c, zoom: Math.min(12, Math.max(1, c.zoom * Math.exp(-e.deltaY / 500))) }));
  };
  // React 的 onWheel 是 passive 的，拦不住页面滚动：自己挂一个 non-passive 的监听
  useEffect(() => {
    const el = sourceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCrop((c) => ({ ...c, zoom: Math.min(12, Math.max(1, c.zoom * Math.exp(-e.deltaY / 500))) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [img]);

  /** 预览上涂遮罩：按格子刷，松手才提交（否则每一笔都重跑量化） */
  const paintAt = (e: React.PointerEvent<HTMLCanvasElement>, commit: boolean) => {
    const layer = maskRef.current;
    if (!layer) return;
    const r = layer.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cx = ((e.clientX - r.left) / r.width) * width;
    const cy = ((e.clientY - r.top) / r.height) * height;
    const m = workMaskRef.current ?? (mask ? mask.slice() : new Uint8Array(width * height).fill(1));
    workMaskRef.current = m;
    const keep = tool === 'erase' ? 1 : 0;
    const rad = Math.max(0.5, brush);
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(width - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(height - 1, Math.ceil(cy + rad));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rad * rad) m[y * width + x] = keep;
      }
    }
    drawMask();
    if (commit) setMask(m);
  };

  /** 指针位置 → 格坐标（可以是小数，框选时允许在格内起手） */
  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const layer = maskRef.current;
    if (!layer) return null;
    const r = layer.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: ((e.clientX - r.left) / r.width) * width,
      y: ((e.clientY - r.top) / r.height) * height,
    };
  };

  const onMaskDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'move') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (isWandTool(tool)) {
      const p = cellAt(e);
      if (p) applyWand(p.x, p.y, tool === 'wandKeep' ? 1 : 0);
      clearWandHover();
      return;
    }
    if (isRectTool(tool)) {
      const p = cellAt(e);
      if (!p) return;
      const sel = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      rectDragRef.current = { x: p.x, y: p.y };
      rectSelRef.current = sel;
      setRectSel(sel);
      return;
    }
    paintAt(e, false);
  };
  const onMaskMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isWandTool(tool)) {
      // 悬停预览：不用真的点下去就能看出魔棒会吃哪一片
      const p = cellAt(e);
      if (!p) return;
      const idx = Math.floor(p.y) * width + Math.floor(p.x);
      if (idx === wandHoverCellRef.current) return;
      wandHoverCellRef.current = idx;
      drawWandHover(p.x, p.y);
      return;
    }
    if (tool === 'move') return;
    if (e.buttons !== 1) return;
    if (isRectTool(tool)) {
      const d = rectDragRef.current;
      const p = cellAt(e);
      if (!d || !p) return;
      const sel = { x0: d.x, y0: d.y, x1: p.x, y1: p.y };
      rectSelRef.current = sel;
      setRectSel(sel);
      drawMask();
      return;
    }
    paintAt(e, false);
  };
  const onMaskUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'move' || isWandTool(tool)) return;    if (isRectTool(tool)) {
      rectDragRef.current = null;
      const sel = rectSelRef.current;
      if (sel) applyRect(sel, tool === 'rectKeep' ? 1 : tool === 'rectOnly' ? 'only' : 0);
      return;
    }
    paintAt(e, true);
  };

  /**
   * 把框选出来的矩形整块设成 0（抠掉）/ 1（补回）/ 'only'（只留框内，框外全抠）。
   * 这是「像 PS 框选那样」的那把刀：先框住主体，再一键只留框内，
   * 框外那些只占了板子一点点、却白白吃掉一整块板的空白就都不算了。
   */
  const applyRect = (sel: { x0: number; y0: number; x1: number; y1: number }, value: 0 | 1 | 'only') => {
    const m = workMaskRef.current ?? (mask ? mask.slice() : new Uint8Array(width * height).fill(1));
    const ax = Math.max(0, Math.min(width - 1, Math.floor(Math.min(sel.x0, sel.x1))));
    const bx = Math.max(0, Math.min(width - 1, Math.ceil(Math.max(sel.x0, sel.x1)) - 1));
    const ay = Math.max(0, Math.min(height - 1, Math.floor(Math.min(sel.y0, sel.y1))));
    const by = Math.max(0, Math.min(height - 1, Math.ceil(Math.max(sel.y0, sel.y1)) - 1));
    if (bx < ax || by < ay) {
      setRectSel(null);
      rectSelRef.current = null;
      return;
    }
    if (value === 'only') {
      // 只清框外：框内保留原有遮罩状态。这样「先一键抠背景、再只留框内」不会
      // 把刚刚抠掉的背景又补回来（以前是框内全填 1，一手抖就把背景吃回图纸）。
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (x < ax || x > bx || y < ay || y > by) m[y * width + x] = 0;
        }
      }
    } else {
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) m[y * width + x] = value;
    }
    workMaskRef.current = m;
    setMask(m.slice());
    setRectSel(null);
    rectSelRef.current = null;
    drawMask();
    const n = (bx - ax + 1) * (by - ay + 1);
    notify(
      value === 'only'
        ? `框外全部清掉，只留 ${bx - ax + 1}×${by - ay + 1} 这一块（框内保留原来的抠图状态）`
        : value === 0
          ? `已抠掉这一块 ${n} 格（${bx - ax + 1}×${by - ay + 1}），不占板子也不计颗数`
          : `已补回 ${n} 格（${bx - ax + 1}×${by - ay + 1}），这些格子重新参与配色`,
    );
  };

  /**
   * 魔棒：点一下，把这一格颜色接近、且和它连成一片的格子整片抠掉（或补回）。
   * 一键抠背景只认四边那圈颜色，抠完还剩在图案内部的白块、同色大色块，
   * 就用魔棒点一下 —— 不用一笔一笔涂。
   */
  const applyWand = (cx: number, cy: number, value: 0 | 1) => {
    const data = sampledRef.current;
    if (!data) return;
    const hit = magicWandMask(data, width, height, cx, cy, tolerance, diagWand, !wandGlobal);
    const m = workMaskRef.current ?? (mask ? mask.slice() : new Uint8Array(width * height).fill(1));
    let n = 0;
    for (let i = 0; i < hit.length; i++) {
      if (!hit[i]) continue;
      m[i] = value;
      n++;
    }
    workMaskRef.current = m;
    setMask(m.slice());
    drawMask();
    // 一个地方都没变（比如点的那片本来就全是这个状态）也要说一声，
    // 否则用户会以为魔棒没生效，反复点。
    if (!n) {
      notify('这一片已经是这个状态了，换个地方点，或者调大「容差」');
      return;
    }
    notify(
      value === 0
        ? `魔棒抠掉 ${n} 格（${Math.round((n / (width * height)) * 100)}%），这不参与配色、不计颗数`
        : `魔棒补回 ${n} 格，这些格子重新参与配色`,
    );
  };

  /** 一键抠图：从四边往里连通填充，把和边缘同色的一整片判成背景 */
  const autoCut = () => {
    const data = sampledRef.current;
    if (!data) return;
    // 已经框选过就把选区传进去：只吃和选区边界相连的背景，
    // 人物内部被围住的那块留着，不会在人物身上挖出没有色号的洞。
    const keep = mask && mask.length === width * height ? mask : undefined;
    const m = backgroundMask(data, width, height, tolerance, keep);
    workMaskRef.current = m;
    setMask(m.slice());
    drawMask();
    let cut = 0;
    for (let i = 0; i < m.length; i++) if (!m[i]) cut++;
    notify(`已抠掉 ${cut} 格（${Math.round((cut / (width * height)) * 100)}%），放着不动就是不用拼的部分`);
  };

  const resetMask = () => {
    workMaskRef.current = null;
    setMask(null);
    drawMask();
  };

  /** 内容包围盒：用来「按内容裁边」，把四周整块空白的板子去掉 */
  const contentBox = useMemo(() => {
    if (!result) return null;
    const cells = result.cells;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!cells[y * width + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    const bs = boardSize > 0 ? boardSize : 0;
    if (bs > 0) {
      x0 = Math.floor(x0 / bs) * bs;
      y0 = Math.floor(y0 / bs) * bs;
      x1 = Math.min(width - 1, Math.ceil((x1 + 1) / bs) * bs - 1);
      y1 = Math.min(height - 1, Math.ceil((y1 + 1) / bs) * bs - 1);
    }
    return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }, [result, width, height, boardSize]);

  const trimmed = useMemo(() => {
    if (!result || !contentBox) return null;
    const needTrim = contentBox.w < width || contentBox.h < height;
    if (!trimToContent || !needTrim) return null;
    return cropCells(result.cells, result.palette, width, contentBox.x0, contentBox.y0, contentBox.w, contentBox.h);
  }, [result, contentBox, trimToContent, width]);

  const placedCount = useMemo(() => {
    if (!result) return 0;
    let n = 0;
    for (let i = 0; i < result.cells.length; i++) if (result.cells[i]) n++;
    return n;
  }, [result]);

  /** 被抠掉的格子数（不含原本就是空白的地方） */
  const cutCount = useMemo(() => {
    if (!activeMask) return 0;
    let n = 0;
    for (let i = 0; i < activeMask.length; i++) if (!activeMask[i]) n++;
    return n;
  }, [activeMask]);

  const loadDataUrl = useCallback((dataUrl: string, name: string, guessTiles: boolean) => {
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setFileName(name);
      if (!guessTiles) return;
      // 画布尺寸由「板数 × 单板格数」决定，不再按图片比例改格子数；
      // 但可以按图片比例推荐一个板数排布，省得用户自己算，改完还能手动调。
      const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
      if (Number.isFinite(ratio) && ratio > 0) {
        if (ratio >= 1.12) {
          setRows(2);
          setCols(Math.max(1, Math.min(8, Math.round(2 * ratio))));
        } else if (ratio <= 0.89) {
          setCols(2);
          setRows(Math.max(1, Math.min(8, Math.round(2 / ratio))));
        } else {
          setCols(2);
          setRows(2);
        }
      }
    };
    image.onerror = () => alert('图片读取失败');
    image.src = dataUrl;
  }, []);

  const loadFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        alert('请选择图片文件');
        return;
      }
      // 用 dataURL 而不是 blobURL：后者在 onload 里被回收后，<img> 会变成裂图
      const reader = new FileReader();
      reader.onload = () => {
        setCrop({ zoom: 1, cx: 0.5, cy: 0.5 });
        setMask(null);
        workMaskRef.current = null;
        loadDataUrl(String(reader.result), file.name, true);
      };
      reader.onerror = () => alert('图片读取失败');
      reader.readAsDataURL(file);
    },
    [loadDataUrl],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  };

  // 从画布区直接拖入的图片：打开对话框即载入
  useEffect(() => {
    if (initialFile) loadFile(initialFile);
  }, [initialFile, loadFile]);

  // 二次编辑：带着上次的图片和参数直接回来，不用重新选图
  useEffect(() => {
    if (initialFile || !seed?.dataUrl) return;
    loadDataUrl(seed.dataUrl, seed.fileName, false);
    // 只在挂载时还原一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doImport = () => {
    if (!result) return;
    setBusy(true);
    const name = fileName.replace(/\.[^.]+$/, '') || '图片转图纸';
    const outW = trimmed?.cells ? contentBox!.w : width;
    const outH = trimmed?.cells ? contentBox!.h : height;
    const cells = trimmed?.cells ?? result.cells;
    const pal = trimmed?.palette ?? result.palette;
    applyImported(cells, pal, outW, outH, name, boardSize);
    notify(
      `已生成 ${outW}×${outH} 图纸 · ${Math.ceil(outW / Math.max(1, boardSize)) * Math.ceil(outH / Math.max(1, boardSize))} 块 ${boardSize}×${boardSize} 板 · ${pal.length} 色`,
    );
    if (img?.src) {
      onSeed?.({
        dataUrl: img.src,
        fileName,
        boardSize,
        cols,
        rows,
        crop,
        mask: activeMask,
        dither,
        ditherMode,
        sample,
        brightness,
        contrast,
        saturation,
        transparentWhite,
        whiteThreshold,
        speckle,
        useDocPalette,
        brandKey,
      });
    }
    setBusy(false);
    onClose();
  };


  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div className="dialog-title">
            <h2>以图生图 · 图片转图纸</h2>
            <p>上传图片 → 裁切 / 抠图 → 生成图纸：抠掉的地方不配色、不算豆子、也不占板子</p>
          </div>
          <button className="dialog-close" onClick={onClose}>
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="dialog-body">
          {!img ? (
            <div
              className={'dropzone' + (over ? ' over' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
            >
              <IconImage />
              <b>点击选择或拖入图片</b>
              <span>支持 PNG / JPG / WebP / GIF · 图片不会上传到任何服务器</span>
              <span className="dropzone-tip">
                载入之后可以抠图：框选 / 魔棒 / 笔刷修边 / 一键抠掉背景，抠掉的格子不配色、不算豆子、也不占板子
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadFile(f);
                }}
              />
            </div>
          ) : (
            <div className="import-grid">
              <div>
                <div className="preview-box" style={{ minHeight: 260 }}>
                  <span className="preview-label">原图 · 拖动挪位置，滚轮缩放</span>
                  <canvas
                    ref={sourceRef}
                    style={{ cursor: 'grab', touchAction: 'none', maxWidth: '100%' }}
                    onPointerDown={onSourceDown}
                    onPointerMove={onSourceMove}
                    onPointerUp={onSourceUp}
                    onPointerCancel={onSourceUp}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn sm" onClick={() => fileRef.current?.click()}>
                    <IconUpload width={12} height={12} /> 换一张
                  </button>
                  <span className="chip" style={{ flex: 1, justifyContent: 'center', minWidth: 0 }}>
                    {fileName}
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) loadFile(f);
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="preview-box" style={{ minHeight: 260 }}>
                  <span className="preview-label">
                    图纸预览 {result ? `· ${result.usedCount} 色` : ''}
                  </span>
                  <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
                    <canvas ref={previewRef} />
                    <canvas
                      ref={maskRef}
                      data-mask="1"
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        cursor: tool === 'move' ? 'default' : 'crosshair',
                        touchAction: 'none',
                      }}
                      onPointerDown={onMaskDown}
                      onPointerMove={onMaskMove}
                      onPointerUp={onMaskUp}
                      onPointerCancel={onMaskUp}
                      onPointerLeave={clearWandHover}
                    />
                    <canvas
                      ref={wandHoverCanvasRef}
                      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <span className="chip accent">
                    {width} × {height}
                  </span>
                  <span className="chip">
                    {cols} × {rows} 块板
                  </span>
                  <span className="chip">豆子 {placedCount} 颗</span>
                  {cutCount > 0 && <span className="chip warn">抠掉 {cutCount} 格</span>}
                  {contentBox && (contentBox.w < width || contentBox.h < height) && (
                    <span className="chip">
                      实际占 {contentBox.w} × {contentBox.h}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {img && (
            <div className="cut-card">
              <div className="cut-head">
                <b>抠图 / 裁边</b>
                <span>不需要拼的地方直接抠掉：不参与配色、不计入颗数，导出图纸里也是空白</span>
              </div>
              <div className="cut-row">
                <div className="seg-wrap">
                  <button className={tool === 'move' ? 'active' : ''} onClick={() => setTool('move')}>
                    只看原图
                  </button>
                  <button className={tool === 'paint' ? 'active' : ''} onClick={() => setTool('paint')}>
                    抠掉
                  </button>
                  <button className={tool === 'erase' ? 'active' : ''} onClick={() => setTool('erase')}>
                    补回
                  </button>
                  <button
                    className={tool === 'rectCut' ? 'active' : ''}
                    onClick={() => setTool('rectCut')}
                    title="在右侧预览上拖一个方框，框内整块抠掉"
                  >
                    框选抠掉
                  </button>
                  <button
                    className={tool === 'rectKeep' ? 'active' : ''}
                    onClick={() => setTool('rectKeep')}
                    title="在右侧预览上拖一个方框，框内整块补回"
                  >
                    框选补回
                  </button>
                  <button
                    className={tool === 'rectOnly' ? 'active' : ''}
                    onClick={() => setTool('rectOnly')}
                    title="拖一个方框框住主体，框外全部不算（多余的板子就没了）"
                  >
                    只留框内
                  </button>
                  <button
                    className={tool === 'wandCut' ? 'active' : ''}
                    onClick={() => setTool('wandCut')}
                    title="在预览上点一下，把这格颜色接近且连成一片的整块抠掉"
                  >
                    魔棒抠掉
                  </button>
                  <button
                    className={tool === 'wandKeep' ? 'active' : ''}
                    onClick={() => setTool('wandKeep')}
                    title="在预览上点一下，把这格颜色接近且连成一片的整块补回"
                  >
                    魔棒补回
                  </button>
                </div>
                <label className="cut-slider">
                  笔刷 {brush} 格
                  <input
                    type="range"
                    min={1}
                    max={8}
                    step={1}
                    value={brush}
                    onChange={(e) => setBrush(Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="cut-row">
                <button className="btn sm" onClick={autoCut}>
                  一键抠掉背景
                </button>
                <label className="cut-slider">
                  容差 {tolerance}
                  <input
                    type="range"
                    min={6}
                    max={90}
                    step={2}
                    value={tolerance}
                    onChange={(e) => setTolerance(Number(e.target.value))}
                  />
                </label>
                <button className="btn sm" onClick={resetMask} disabled={!mask}>
                  全部还原
                </button>
                <label className="check-inline">
                  <input type="checkbox" checked={trimToContent} onChange={(e) => setTrimToContent(e.target.checked)} />
                  按内容裁掉多余板子
                </label>
                <label className="check-inline" title="默认只走上下左右；斜向细缝多的图可以勾上">
                  <input type="checkbox" checked={diagWand} onChange={(e) => setDiagWand(e.target.checked)} />
                  魔棒认斜角
                </label>
                <label className="check-inline" title="勾上后不管连不连通，图里所有同色块一起处理">
                  <input type="checkbox" checked={wandGlobal} onChange={(e) => setWandGlobal(e.target.checked)} />
                  魔棒吃全图同色
                </label>
              </div>
              <div className="cut-tip">
                {isWandTool(tool)
                  ? `在右边「图纸预览」上点一下：${
                      tool === 'wandKeep' ? '这一格所在的同色连通块全部补回参与配色。' : '这一格所在的同色连通块整片抠掉，不占板子也不计颗数。'
                    }「容差」越大吃得越狠（${tolerance}），抠多了就换「魔棒补回」点回来。`
                  : isRectTool(tool)
                    ? `在右边「图纸预览」上拖一个方框：${
                        tool === 'rectOnly'
                          ? '框外全部清掉、只留框内（框内已经抠掉的地方保持原样）—— 适合主体只占画面一小块、却被算成一大堆板子的图。'
                          : tool === 'rectKeep'
                            ? '框内全部补回参与配色。'
                            : '框内整块抠掉，不占板子也不计颗数。'
                      }也可以用「抠掉 / 补回」笔刷一点点修边。`
                    : `抠完还剩 ${width * height - cutCount} 格可拼；拖动「原图」可以只取画面的一部分（滚轮缩放），
                周边空白多的图建议先缩放框住主体，再一键抠背景。`}
              </div>
              <div className="cut-tip" style={{ opacity: 0.85 }}>
                想抠得更准？可以先在 remove.bg、佐糖这类抠图网站把主体抠好、导出透明 PNG 再拖进来 ——
                <b>透明的地方会自动算抠掉</b>，不用在这里再画一遍。
              </div>
            </div>
          )}

          {img && (
            <>
              <div className="form-grid">
              <div className="field">
                <label>单板格数</label>
                  <div className="slider-row">
                    <input
                      type="number"
                      className="input"
                      min={2}
                      max={PEGBOARD_MAX}
                      value={boardText}
                      onChange={(e) => {
                        // 只改文本，允许清空重填；真正生效在 onChange 里做温和夹取
                        const raw = e.target.value;
                        setBoardText(raw);
                        if (raw.trim() === '') return;
                        const v = Number(raw);
                        if (!Number.isFinite(v)) return;
                        setBoardSize(clampPegboard(v) || DEFAULT_PEGBOARD);
                      }}
                      onBlur={() => {
                        if (boardText.trim() === '') {
                          setBoardText(String(boardSize));
                          return;
                        }
                        const v = clampPegboard(Number(boardText)) || DEFAULT_PEGBOARD;
                        setBoardSize(v);
                        setBoardText(String(v));
                      }}
                      style={{ width: 88 }}
                    />
                    <span className="val">× {boardSize} 格 / 块</span>
                  </div>
                  <div className="seg-wrap" style={{ marginTop: 2 }}>
                    {BOARD_SIZES.slice(0, 8).map((p) => (
                      <button
                        key={p.value}
                        className={boardSize === p.value ? 'active' : ''}
                        onClick={() => {
                          setBoardSize(p.value);
                          setBoardText(String(p.value));
                        }}
                        title={`每块板 ${p.value} × ${p.value} 格${p.note ? ' · ' + p.note : ''}`}
                      >
                        {p.value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label>用几块板（横 × 纵）</label>
                  <div className="slider-row">
                    <TileStepper
                      label="横"
                      value={cols}
                      text={colsText}
                      max={maxTiles}
                      onText={(s) => {
                        setColsText(s);
                        const n = parseTiles(s);
                        if (n != null) {
                          setCols(n);
                          if (lockSquare) {
                            setRows(n);
                            setRowsText(String(n));
                          }
                        }
                      }}
                      onCommit={(n) => {
                        setCols(n);
                        setColsText(String(n));
                        if (lockSquare) {
                          setRows(n);
                          setRowsText(String(n));
                        }
                      }}
                    />
                    <TileStepper
                      label="纵"
                      value={rows}
                      text={rowsText}
                      max={maxTiles}
                      onText={(s) => {
                        setRowsText(s);
                        const n = parseTiles(s);
                        if (n != null) {
                          setRows(n);
                          if (lockSquare) {
                            setCols(n);
                            setColsText(String(n));
                          }
                        }
                      }}
                      onCommit={(n) => {
                        setRows(n);
                        setRowsText(String(n));
                        if (lockSquare) {
                          setCols(n);
                          setColsText(String(n));
                        }
                      }}
                    />
                  </div>
                  <label className="checkbox-line" style={{ marginTop: 6 }}>
                    <span
                      className={'checkbox' + (lockSquare ? ' on' : '')}
                      onClick={() => setLockSquare((v) => !v)}
                      role="checkbox"
                      aria-checked={lockSquare}
                      tabIndex={0}
                    >
                      {lockSquare && <IconCheck width={11} height={11} />}
                    </span>
                    <span onClick={() => setLockSquare((v) => !v)}>锁定正方形（调一个，另一个跟着动）</span>
                  </label>
                  <span className="hint">
                    {cols} × {rows} = {cols * rows} 块 {boardSize}×{boardSize} 板，合计 {width} × {height} 格
                  </span>
                </div>

                <div className="field">
                  <label>参考比例（1 颗豆 ≈ 原图几个像素）</label>
                  <div className="slider-row">
                    <span className="val" style={{ width: 'auto' }}>1:</span>
                    <input
                      type="number"
                      className="input"
                      min={0.5}
                      max={16}
                      step={0.5}
                      value={ratioText}
                      onFocus={() => {
                        ratioFocusedRef.current = true;
                      }}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setRatioText(raw);
                        // 边打边联动：改比例的同时把上面的单板格数 / 板数一起调好
                        const v = Number(raw);
                        if (Number.isFinite(v) && v > 0) applyRatio(v, true);
                      }}
                      onBlur={() => {
                        ratioFocusedRef.current = false;
                        const v = Number(ratioText);
                        if (Number.isFinite(v) && v > 0) applyRatio(v, true);
                        else setRatioText(pxPerBead ? pxPerBead.toFixed(1) : '2');
                      }}
                      style={{ width: 72 }}
                    />
                    <span className="val">
                      {pxPerBead ? `现在约 1:${pxPerBead.toFixed(1)}` : '选图后可调'}
                    </span>
                  </div>
                  <div className="seg-row" style={{ marginTop: 4 }}>
                    {[1, 1.5, 2, 3, 4].map((r) => (
                      <button
                        key={r}
                        className={pxPerBead && Math.abs(pxPerBead - r) < 0.15 ? 'active' : ''}
                        onClick={() => applyRatio(r)}
                        title={`每 ${r} 个原图像素合成 1 颗豆`}
                      >
                        1:{r}
                      </button>
                    ))}
                  </div>
                  <span className="hint">
                    只是个参考，怎么好看怎么调：比例小＝格子多、细节多；比例大＝格子少、更省豆子。
                  </span>
                </div>

                <div className="field">
                  <label>成品大概多大（参考）</label>
                  <div className="seg-row">
                    {[
                      { mm: 2.6, l: '2.6mm 迷你' },
                      { mm: 5, l: '5mm 中豆' },
                      { mm: 10, l: '10mm 大豆' },
                    ].map((b) => (
                      <button
                        key={b.mm}
                        className={beadMm === b.mm ? 'active' : ''}
                        onClick={() => setBeadMm(b.mm)}
                      >
                        {b.l}
                      </button>
                    ))}
                  </div>
                  <span className="hint">
                    约 {((width * beadMm) / 10).toFixed(1)} × {((height * beadMm) / 10).toFixed(1)} cm ·{' '}
                    {width} × {height} = {width * height} 格
                  </span>
                </div>

                <div className="field">
                  <label>抖动算法</label>
                  <div className="segmented" style={{ alignSelf: 'flex-start' }}>
                    <button className={ditherMode === 'none' ? 'active' : ''} onClick={() => setDitherMode('none')}>
                      无
                    </button>
                    <button className={ditherMode === 'fs' ? 'active' : ''} onClick={() => setDitherMode('fs')}>
                      误差扩散
                    </button>
                    <button className={ditherMode === 'ordered' ? 'active' : ''} onClick={() => setDitherMode('ordered')}>
                      有序抖动
                    </button>
                  </div>
                  <span className="hint">无 = 最干净；误差扩散 = 过渡自然；有序 = 规则网纹，印刷感强</span>
                </div>

                {ditherMode !== 'none' && (
                  <div className="field">
                    <label>抖动强度</label>
                    <div className="slider-row">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={dither}
                        onChange={(e) => setDither(Number(e.target.value))}
                      />
                      <span className="val">{dither.toFixed(2)}</span>
                    </div>
                    <span className="hint">高抖动可还原渐变，低抖动更干净</span>
                  </div>
                )}

                <div className="field">
                  <label>颗粒感</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setSpeckle((v) => !v)}>
                    <span className={'checkbox' + (speckle ? ' on' : '')}>
                      {speckle ? (
                        <svg viewBox="0 0 16 16" width="10" height="10">
                          <path d="M2 8.5 L6 12 L14 3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                        </svg>
                      ) : null}
                    </span>
                    <span>去掉零散单颗</span>
                  </div>
                  <span className="hint">四面都是同一个色号时并过去。抖动出来的孤点最费眼，关掉可保留更多细节</span>
                </div>

                <div className="field">
                  <label>采样方式</label>
                  <div className="segmented" style={{ alignSelf: 'flex-start' }}>
                    <button className={sample === 'average' ? 'active' : ''} onClick={() => setSample('average')}>
                      平均采样
                    </button>
                    <button className={sample === 'point' ? 'active' : ''} onClick={() => setSample('point')}>
                      单点采样
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label>亮度</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      min={0.5}
                      max={1.6}
                      step={0.02}
                      value={brightness}
                      onChange={(e) => setBrightness(Number(e.target.value))}
                    />
                    <span className="val">{brightness.toFixed(2)}</span>
                  </div>
                </div>

                <div className="field">
                  <label>对比度</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.02}
                      value={contrast}
                      onChange={(e) => setContrast(Number(e.target.value))}
                    />
                    <span className="val">{contrast.toFixed(2)}</span>
                  </div>
                </div>

                <div className="field">
                  <label>饱和度</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.02}
                      value={saturation}
                      onChange={(e) => setSaturation(Number(e.target.value))}
                    />
                    <span className="val">{saturation.toFixed(2)}</span>
                  </div>
                </div>

                <div className="field">
                  <label>白底处理</label>
                  <div className="check-row" onClick={() => setTransparentWhite((v) => !v)}>
                    <span className={'checkbox' + (transparentWhite ? ' on' : '')}>
                      <IconCheck width={11} height={11} />
                    </span>
                    去掉连成片的白色背景
                  </div>
                  <div className="hint-line">
                    只去「从画布边缘 / 选区边界能走到的白」；被人围住的白（高光、白衣服）留着，
                    所以选区内不会出现没有色号的洞。
                  </div>
                  {transparentWhite && (
                    <div className="slider-row">
                      <input
                        type="range"
                        min={200}
                        max={255}
                        value={whiteThreshold}
                        onChange={(e) => setWhiteThreshold(Number(e.target.value))}
                      />
                      <span className="val">{whiteThreshold}</span>
                    </div>
                  )}
                </div>

                <div className="field full">
                  <label>匹配色板</label>
                  <div className="seg-row">
                    <button
                      className={'btn sm ' + (useDocPalette ? 'primary' : '')}
                      onClick={() => setUseDocPalette(true)}
                    >
                      当前图纸色板 · {doc.palette.length} 色
                    </button>
                    <button
                      className={'btn sm ' + (!useDocPalette ? 'primary' : '')}
                      onClick={() => setUseDocPalette(false)}
                    >
                      品牌色板
                    </button>
                  </div>
                  {/* 品牌色板一律列全 10 套，不随「当前图纸色板」隐藏——
                      之前选到图纸色板后整排品牌按钮就消失了，看着像点不开。 */}
                  <select
                    className="input"
                    style={{ marginTop: 8 }}
                    value={brandKey}
                    onChange={(e) => {
                      setBrandKey(e.target.value);
                      setUseDocPalette(false);
                    }}
                    title="选一套品牌色卡来匹配这张图，导入后还能在「色号管理」里继续改"
                  >
                    {PALETTE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {BRAND_LABEL[k] ?? k} · {BUILTIN_PALETTES[k]?.length ?? 0} 色
                      </option>
                    ))}
                  </select>
                  <div className="hint" style={{ marginTop: 6 }}>
                    {useDocPalette
                      ? `用当前图纸里的 ${doc.palette.length} 种颜色匹配，导入后色号与现场一致`
                      : `用 ${BRAND_LABEL[brandKey] ?? brandKey} 的全套 ${palette.length} 色匹配，渐变过渡更自然`}
                    ；导入后仍可在「色号管理」里换色卡或逐个改色号。
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="dialog-foot">
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {img
              ? '生成后想再改范围，点顶栏「重调图片」就能带着这次的裁切和抠图回来；也可用 Ctrl+Z 撤销'
              : '选择图片后可调整参数'}
          </span>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!img || !result || busy} onClick={doImport}>
            <IconWand width={14} height={14} /> 生成图纸
          </button>
        </div>
      </div>
    </div>
  );
}
