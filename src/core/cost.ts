// 成本估算与库存清单
//
// 竞品调研结论：市面上的拼豆工具都停在「生成图纸」，没有一家回答
// 「这一张要花多少钱、我手上还有多少、还差多少要买」。
// 这里把用量、单价（元/千颗）、库存（已有颗数）合成一张采购清单。

import type { PatternDoc } from './types';

const PRICE_KEY = 'perler-studio:default-price';

/** 默认单价：元 / 千颗（5mm 拼豆常见区间 2~4 元） */
export const DEFAULT_PRICE = 2.5;

export function getDefaultPrice(): number {
  try {
    const raw = localStorage.getItem(PRICE_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PRICE;
}

export function setDefaultPrice(n: number) {
  try {
    localStorage.setItem(PRICE_KEY, String(Math.max(0, n)));
  } catch {
    /* ignore */
  }
}

export interface CostRow {
  index: number;
  total: number;
  placed: number;
  remaining: number;
  /** 元 / 千颗 */
  unitPrice: number;
  /** 该色总价（元） */
  amount: number;
  /** 已有库存（颗） */
  stock: number;
  /** 还差多少颗要买 */
  restock: number;
  /** 补货花费（元） */
  restockAmount: number;
}

export interface CostSummary {
  rows: CostRow[];
  /** 全部豆子的材料总价 */
  totalAmount: number;
  /** 尚未拼的部分折算金额 */
  remainingAmount: number;
  /** 需要补货的颗数 */
  restockCount: number;
  /** 补货花费 */
  restockAmount: number;
  /** 有库存时省下的金额 */
  savedAmount: number;
}

export function costSummary(doc: PatternDoc, defaultPrice: number): CostSummary {
  const count = new Map<number, number>();
  const placed = new Map<number, number>();
  for (let i = 0; i < doc.cells.length; i++) {
    const v = doc.cells[i];
    if (!v) continue;
    const k = v - 1;
    count.set(k, (count.get(k) ?? 0) + 1);
    if (doc.progress[i]) placed.set(k, (placed.get(k) ?? 0) + 1);
  }

  const rows: CostRow[] = [];
  let totalAmount = 0;
  let remainingAmount = 0;
  let restockCount = 0;
  let restockAmount = 0;
  let savedAmount = 0;

  for (const [index, total] of count) {
    const color = doc.palette[index];
    if (!color) continue;
    const unitPrice = typeof color.price === 'number' && color.price >= 0 ? color.price : defaultPrice;
    const amount = (total / 1000) * unitPrice;
    const p = placed.get(index) ?? 0;
    const remaining = total - p;
    const stock = Math.max(0, Math.floor(color.stock ?? 0));
    const restock = Math.max(0, total - stock);
    const rowRestockAmount = (restock / 1000) * unitPrice;

    totalAmount += amount;
    remainingAmount += (remaining / 1000) * unitPrice;
    restockCount += restock;
    restockAmount += rowRestockAmount;
    savedAmount += (Math.min(stock, total) / 1000) * unitPrice;

    rows.push({ index, total, placed: p, remaining, unitPrice, amount, stock, restock, restockAmount: rowRestockAmount });
  }

  rows.sort((a, b) => b.total - a.total);
  return { rows, totalAmount, remainingAmount, restockCount, restockAmount, savedAmount };
}

/** ¥12.34 / ¥0.05 这种紧凑格式 */
export function money(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '¥0';
  if (n < 0.1) return '¥' + n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return '¥' + n.toFixed(2).replace(/\.00$/, '');
}
