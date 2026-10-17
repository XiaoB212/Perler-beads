/**
 * 拼豆板（pegboard）几何 + 画布尺寸约束。
 *
 * 屏幕渲染、导出、用量统计、分板总览、新建对话框全部从这里取数，
 * 免得出现「导出的板号是 A1、画布上却没有板号」「统计按 29 算、画布按 5 算」这类双写。
 */

/**
 * 画布边长允许范围（格）。
 * 上限按「浏览器真的能画完、能存下」来定，而不是按位数好看：
 * 1024×1024 = 104.8 万格，cells 用 Uint16 = 2MB、progress 用 Uint8 = 1MB，
 * 一份撤销快照约 3MB，60 步历史在内存预算内；再大（如 5000×5000 = 2500 万格、75MB）
 * 单次快照就把内存吃穿，导出时还会撞上 canvas 边长 16384 / 面积 2.68 亿像素的硬墙。
 */
export const CANVAS_MIN = 4;
export const CANVAS_MAX = 1024;

/** 总面积上限（格）：等于 1024×1024，允许 2048×512 这类窄长图 */
export const CANVAS_MAX_AREA = 1024 * 1024;

/** 超过这个格数就提示用户：Canvas 2D 每帧遍历会明显掉帧 */
export const CANVAS_SOFT_CELLS = 40000;

/** 超过这个格数按「超大画布」处理：撤销历史降级、缩略图跳过 */
export const CANVAS_BIG_CELLS = 1000000;

/** 市面常见拼豆板规格（5mm 豆），0 = 不显示 */
/**
 * 市面常见拼豆板规格（5mm 豆，一律正方形），0 = 不分板。
 * 数值取各品牌实际在售的方形板：小方板 14 / 15、中板 20 / 28、大板 29 / 30、
 * 加大板 48 / 52、超大板 57，以及常见自定义 64。
 */
export const PEGBOARD_PRESETS: { value: number; label: string; note?: string }[] = [
  { value: 0, label: '不分板' },
  { value: 10, label: '10 × 10', note: '迷你' },
  { value: 14, label: '14 × 14', note: '小方板' },
  { value: 15, label: '15 × 15', note: '小方板' },
  { value: 20, label: '20 × 20', note: '中方板' },
  { value: 28, label: '28 × 28', note: '中方板' },
  { value: 29, label: '29 × 29', note: '大方板' },
  { value: 30, label: '30 × 30', note: '大方板' },
  { value: 48, label: '48 × 48', note: '加大板' },
  { value: 52, label: '52 × 52', note: '加大板' },
  { value: 57, label: '57 × 57', note: '超大板' },
  { value: 64, label: '64 × 64', note: '自定义常用' },
];

/** 单块板的边长上限（格）：再大就没有实物对应了 */
export const PEGBOARD_MAX = 256;

/**
 * 单格像素（zoom）的上下限，全局唯一定义。
 * 上限从 48/64 提到 220：分板聚焦要把「一块 4×4 的小板」铺满视口，
 * 60px 一格根本填不满，用户会抱怨「不会自动扩大至全屏铺满这个区域」。
 * store 的 setZoom 和 CanvasStage 的所有缩放路径必须共用这两个常量，
 * 否则会出现「聚焦放大到 189，落库却被夹回 64」这种画面直接空白的 bug。
 */
export const ZOOM_MIN = 2;
export const ZOOM_MAX = 220;

/** 新建图纸的默认边长：正方形，一块 64×64 板正好铺满 */
export const DEFAULT_CANVAS_SIZE = 64;

/** 新建图纸的默认单板格数 */
export const DEFAULT_PEGBOARD = 64;

export function clampCanvasSize(n: number, fallback = 48): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, Math.round(n)));
}

/**
 * 一次性把宽高压进「单边 ≤ 1024 且 宽×高 ≤ 104.8 万」的盒子里。
 * 只压单边不够：2048×2048 单边合法但面积是 4 倍，内存与导出都会炸。
 */
export function clampCanvasPair(w: number, h: number): { w: number; h: number } {
  let cw = clampCanvasSize(w);
  let ch = clampCanvasSize(h);
  if (cw * ch > CANVAS_MAX_AREA) {
    const k = Math.sqrt(CANVAS_MAX_AREA / (cw * ch));
    cw = Math.max(CANVAS_MIN, Math.floor(cw * k));
    ch = Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, Math.floor(ch * k)));
  }
  return { w: cw, h: ch };
}

/** 板格数：0 或非法值 → 0（不显示分板），否则 2 – PEGBOARD_MAX */
export function clampPegboard(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(PEGBOARD_MAX, Math.max(2, Math.round(n)));
}

/** 板编号：行优先，A1 / B3 —— 与导出 PNG / PDF / SVG 上的编号保持一致 */
export function boardLabel(col: number, row: number): string {
  return `${String.fromCharCode(65 + (row % 26))}${col + 1}`;
}

export interface BoardRect {
  index: number;
  col: number;
  row: number;
  /** 左上角的格坐标 */
  x: number;
  y: number;
  /** 实际格数：最后一行 / 一列可能不满一块板 */
  w: number;
  h: number;
  label: string;
}

export function boardCols(width: number, size: number): number {
  return size > 0 ? Math.ceil(width / size) : 0;
}

export function boardRows(height: number, size: number): number {
  return size > 0 ? Math.ceil(height / size) : 0;
}

export function boardCount(width: number, height: number, size: number): number {
  return boardCols(width, size) * boardRows(height, size);
}

/** 全部分板矩形（行优先）；size<=0 返回空数组 */
export function boardsOf(width: number, height: number, size: number): BoardRect[] {
  const cols = boardCols(width, size);
  const rows = boardRows(height, size);
  if (!cols || !rows) return [];
  const out: BoardRect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * size;
      const y = row * size;
      out.push({
        index: row * cols + col,
        col,
        row,
        x,
        y,
        w: Math.min(size, width - x),
        h: Math.min(size, height - y),
        label: boardLabel(col, row),
      });
    }
  }
  return out;
}

/** 聚焦模式下真正可画的矩形（格坐标）；不聚焦就是整张图 */
export function focusRect(
  focus: { size: number; col: number; row: number } | null,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  if (!focus || focus.size <= 0) return { x: 0, y: 0, w: width, h: height };
  const x = Math.max(0, Math.min(Math.max(0, width - 1), focus.col * focus.size));
  const y = Math.max(0, Math.min(Math.max(0, height - 1), focus.row * focus.size));
  return { x, y, w: Math.min(focus.size, width - x), h: Math.min(focus.size, height - y) };
}

/** 某一格属于哪块板 */
export function boardAt(x: number, y: number, size: number): { col: number; row: number; label: string } | null {
  if (size <= 0) return null;
  const col = Math.floor(x / size);
  const row = Math.floor(y / size);
  return { col, row, label: boardLabel(col, row) };
}

/**
 * 板内细线（每 step 格一条），**相对每块板的起点**数。
 *
 * 这是从 Jett-Wu/Perler_Beads_Generator 的 guideLineCenters 学来的：
 * 29 格板里的 5 格线应该是 5/10/15/20/25，而不是全局的 5/10/…，
 * 否则线会横穿板边界，看着像尺寸画错了。
 */
export function boardGuideLines(total: number, size: number, step = 5): number[] {
  if (size <= 0 || step <= 0) return [];
  const out: number[] = [];
  for (let start = 0; start < total; start += size) {
    const len = Math.min(size, total - start);
    for (let o = step; o < len; o += step) out.push(start + o);
  }
  return out;
}
