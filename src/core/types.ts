// 拼豆工作室 · 核心类型定义

/** 豆子颜色（色号） */
export interface BeadColor {
  /** 稳定 id，用于跨文档引用（导出/导入工程时保留） */
  id: string;
  /** 品牌，如 MARD / Artkal / Perler / 自定义 */
  brand: string;
  /** 色号，如 A1 / S12 */
  code: string;
  /** 中文或英文色名 */
  name: string;
  /** #RRGGBB */
  hex: string;
  /** 是否为用户自定义 */
  custom?: boolean;
  /** 单价：元 / 千颗；留空则回落到图纸默认单价 */
  price?: number;
  /** 已有库存（颗）；用于「需补货」清单 */
  stock?: number;
}

/** 空单元格哨兵值 */
export const EMPTY = 0;

/** 图纸文档 */
export interface PatternDoc {
  id: string;
  name: string;
  width: number;
  height: number;
  /** 长度 = width*height，0 表示空，其余为 palette 下标 + 1 */
  cells: Uint16Array;
  /** 进度标记，1 = 已拼好 */
  progress: Uint8Array;
  /** 本文档色板 */
  palette: BeadColor[];
  /** 拼豆板格数（用于分板参考线），0 表示不显示 */
  pegboard: number;
  createdAt: number;
  updatedAt: number;
  notes: string;
}

export type Tool =
  | 'pencil'
  | 'eraser'
  | 'bucket'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'picker'
  | 'pan'
  | 'move';

export interface Point {
  x: number;
  y: number;
}

export interface ViewFlags {
  grid: boolean;
  rulers: boolean;
  beadHoles: boolean;
  /** 画拼豆板分界线 */
  pegboard: boolean;
  /** 在每块板上标 A1 / B2 之类的板号 */
  boardIds: boolean;
  symmetryX: boolean;
  symmetryY: boolean;
  progressMode: boolean;
  dimUnplaced: boolean;
  /**
   * 线上拼豆模式：独立的「照着拼」状态，开的时候自己带进度模式，
   * 右侧用量页里会出现对色拼装、单色、进度环、分享链接这一整套。
   * 和进度模式不是一回事 —— 进度模式只要求「点格子打勾」，线上模式是一整场拼装。
   */
  onlineMode: boolean;
  /**
   * 对色拼装：进度模式下先选「正在拼的色号」，点对了打勾、点错了打叉。
   * 关掉就是原来的「随便点一下就是对号」。
   */
  progressCheck: boolean;
  /** 在每颗豆子上显示色号（需要放大到一定倍数才画得下） */
  showCodes: boolean;
  /** 豆子形状：方格（默认）或圆格 */
  cellShape: CellShape;
  /**
   * 双击画布进入「只看这块板」。关掉之后双击没有任何效果，
   * 板的位置只能在设置里点板号改 —— 涂色时不会莫名其妙跳进小分板。
   */
  dblClickFocus: boolean;
  /**
   * 拼错时的提醒方式：
   * - cross 盖一个红叉（最显眼，但会遮住豆子颜色）
   * - ring  格子外圈画一道红边（看得见颜色）
   * - none  只在面板上统计，不在画布上画
   */
  wrongStyle: WrongStyle;
}

export type CellShape = 'square' | 'circle';

export type WrongStyle = 'cross' | 'ring' | 'none';

export const DEFAULT_FLAGS: ViewFlags = {
  grid: true,
  rulers: true,
  beadHoles: false,
  pegboard: true,
  boardIds: true,
  symmetryX: false,
  symmetryY: false,
  progressMode: false,
  dimUnplaced: true,
  onlineMode: false,
  progressCheck: false,
  showCodes: false,
  cellShape: 'square',
  dblClickFocus: true,
  wrongStyle: 'ring',
};

/** 撤销快照 */
export interface Snapshot {
  width: number;
  height: number;
  cells: Uint16Array;
  progress: Uint8Array;
  palette: BeadColor[];
  pegboard: number;
  /** 聚焦模式：只看某一块板（null = 看全图） */
  focus: FocusState | null;
}

/** 分板聚焦：把视图锁在某一块板上，拼装时不会画到别的板去 */
export interface FocusState {
  /** 单板格数（快照当前 doc.pegboard，切板尺寸时自动失效） */
  size: number;
  col: number;
  row: number;
}

/** 工程文件（.perler.json） */
export interface ProjectFile {
  format: 'perler-studio';
  version: 1;
  exportedAt: number;
  name: string;
  width: number;
  height: number;
  pegboard: number;
  notes: string;
  palette: BeadColor[];
  /** RLE 编码的单元格数据 */
  cells: string;
  /** RLE 编码的进度数据 */
  progress: string;
}

export interface ColorUsage {
  index: number;
  color: BeadColor;
  total: number;
  placed: number;
  remaining: number;
}
