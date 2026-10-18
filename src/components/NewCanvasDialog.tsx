import { useMemo, useState } from 'react';
import { useEditor } from '../core/store';
import { BRAND_LABEL, DEFAULT_PALETTE_KEY, PALETTE_KEYS } from '../core/palette';
import {
  CANVAS_MAX,
  CANVAS_MAX_AREA,
  CANVAS_MIN,
  CANVAS_SOFT_CELLS,
  DEFAULT_CANVAS_SIZE,
  DEFAULT_PEGBOARD,
  PEGBOARD_MAX,
  PEGBOARD_PRESETS,
  clampCanvasPair,
  clampPegboard,
} from '../core/board';
import { IconClose, IconPlus } from './Icons';

interface Props {
  onClose: () => void;
}

const BOARD_SIZES = PEGBOARD_PRESETS.filter((p) => p.value > 0);

/** 常用板数搭配：画布尺寸 = 单板格数 × 板数，和导入、导出用的是同一套分板口径 */
const BOARD_COUNTS = [
  { cols: 1, rows: 1, label: '1 × 1 块' },
  { cols: 2, rows: 2, label: '2 × 2 块' },
  { cols: 3, rows: 3, label: '3 × 3 块' },
  { cols: 4, rows: 4, label: '4 × 4 块' },
  { cols: 6, rows: 6, label: '6 × 6 块' },
  { cols: 8, rows: 8, label: '8 × 8 块' },
];


export default function NewCanvasDialog({ onClose }: Props) {
  const newDocument = useEditor((s) => s.newDocument);
  const dirty = useEditor((s) => s.dirty);
  // 输入框用字符串保存，允许中途清空（否则 0 删不掉）；失焦或创建时再收成数字
  const [wText, setWText] = useState(String(DEFAULT_CANVAS_SIZE));
  const [hText, setHText] = useState(String(DEFAULT_CANVAS_SIZE));
  const [square, setSquare] = useState(true);
  const [paletteKey, setPaletteKey] = useState<string>(DEFAULT_PALETTE_KEY);
  const [name, setName] = useState('');
  // 单块拼豆板的格数：先定板，再定用几块板，尺寸就是这两个数的乘积
  const [boardSize, setBoardSize] = useState(DEFAULT_PEGBOARD);
  const [boardText, setBoardText] = useState(String(DEFAULT_PEGBOARD));

  const commitBoard = (raw: string) => {
    setBoardText(raw);
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setBoardSize(clampPegboard(n) || DEFAULT_PEGBOARD);
  };

  const toNum = (t: string) => {
    const n = Number(t.trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  // 输入框允许空着（正在删数字），这时按默认值算，不打断输入
  const wNum = toNum(wText) || DEFAULT_CANVAS_SIZE;
  const hNum = square ? wNum : toNum(hText) || DEFAULT_CANVAS_SIZE;
  const pair = clampCanvasPair(wNum, hNum);
  const cw = pair.w;
  const ch = pair.h;
  const tooBig = cw * ch > CANVAS_SOFT_CELLS;
  const clamped = cw !== wNum || ch !== hNum;

  /** 按「几块板 × 单板格数」定尺寸：这就是导入和导出用的同一套分板口径 */
  const useBoardCount = (cols: number, rows: number) => {
    setWText(String(clampCanvasPair(boardSize * cols, boardSize * rows).w));
    setHText(String(clampCanvasPair(boardSize * cols, boardSize * rows).h));
  };

  const boards = useMemo(
    () => Math.ceil(cw / boardSize) * Math.ceil(ch / boardSize),
    [cw, ch, boardSize],
  );
  const boardCols = Math.ceil(cw / boardSize);
  const boardRows = Math.ceil(ch / boardSize);

  const create = () => {
    if (dirty && !confirm('当前图纸尚未保存，新建会丢失未保存的内容。继续？')) return;
    newDocument(cw, ch, paletteKey, name.trim() || '未命名图纸', boardSize);
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div className="dialog-title">
            <h2>新建图纸</h2>
            <p>选择画布尺寸与品牌色板，随时可以再调整</p>
          </div>
          <button className="dialog-close" onClick={onClose}>
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="field" style={{ marginBottom: 14 }}>
            <label>图纸名称</label>
            <input
              className="input"
              placeholder="未命名图纸"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              autoFocus
            />
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label>单块拼豆板格数</label>
            <div className="slider-row">
              <input
                className="input"
                type="number"
                min={2}
                max={PEGBOARD_MAX}
                style={{ width: 84 }}
                value={boardText}
                onChange={(e) => commitBoard(e.target.value)}
                onBlur={() => setBoardText(String(boardSize))}
                title={`实体板一行的格数，常用 29 / 48 / 64，最大 ${PEGBOARD_MAX}`}
              />
              <span className="val">× {boardSize} 格 / 块</span>
            </div>
            <div className="seg-wrap" style={{ marginTop: 8 }}>
              {BOARD_SIZES.map((b) => (
                <button
                  key={b.value}
                  className={'seg' + (boardSize === b.value ? ' on' : '')}
                  onClick={() => {
                    setBoardSize(b.value);
                    setBoardText(String(b.value));
                  }}
                  title={b.note}
                >
                  {b.value}
                </button>
              ))}
            </div>
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label>用几块板</label>
            <div className="preset-grid">
              {BOARD_COUNTS.map((p) => (
                <button
                  key={p.label}
                  className={'preset-btn' + (boardCols === p.cols && boardRows === p.rows ? ' active' : '')}
                  onClick={() => useBoardCount(p.cols, p.rows)}
                >
                  <b>{p.label}</b>
                  <span>
                    {boardSize * p.cols} × {boardSize * p.rows}
                  </span>
                </button>
              ))}
            </div>
            <span className="hint">
              点一个就按当前单板格数算好画布；也可以直接在下面填任意宽高。
            </span>
          </div>

          <div className="form-grid" style={{ marginBottom: 10 }}>
            <div className="field">
              <label>宽度（格）</label>
              <input
                className="input"
                type="number"
                min={CANVAS_MIN}
                max={CANVAS_MAX}
                value={wText}
                onChange={(e) => {
                  setWText(e.target.value);
                }}
                onBlur={() => {
                  const v = toNum(wText) || DEFAULT_CANVAS_SIZE;
                  setWText(String(v));
                  if (square) setHText(String(v));
                }}
              />
            </div>
            <div className="field">
              <label>高度（格）</label>
              <input
                className="input"
                type="number"
                min={CANVAS_MIN}
                max={CANVAS_MAX}
                value={square ? String(cw) : hText}
                disabled={square}
                onChange={(e) => setHText(e.target.value)}
                onBlur={() => setHText(String(toNum(hText) || DEFAULT_CANVAS_SIZE))}
              />
            </div>
          </div>

          <div className="row-toggle" style={{ marginBottom: 14 }} onClick={() => setSquare(!square)}>
            <span>画布保持正方形</span>
            <span className={'switch' + (square ? ' on' : '')} />
          </div>

          <div className="field">
            <label>品牌色板</label>
            <select className="select" value={paletteKey} onChange={(e) => setPaletteKey(e.target.value)}>
              {PALETTE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {BRAND_LABEL[k]}
                </option>
              ))}
            </select>
            <span className="hint">
              共 {cw * ch} 格 · {boardCols} × {boardRows} = {boards} 块 {boardSize}×{boardSize} 拼豆板 · 色卡数据来自
              pindou-color-data
            </span>
            {clamped && (
              <span className="hint warn">
                已自动收成 {cw} × {ch}：单边最多 {CANVAS_MAX} 格，总面积最多{' '}
                {Math.round(CANVAS_MAX_AREA / 10000)} 万格（再大浏览器画不动、也导不出来）。
              </span>
            )}
            {tooBig && !clamped && (
              <span className="hint warn">
                画布超过 {CANVAS_SOFT_CELLS / 10000} 万格，缩放后滚动可能会有轻微卡顿。分板聚焦能让绘制保持在单块板内。
              </span>
            )}
            {!clamped && (cw === CANVAS_MAX || ch === CANVAS_MAX) ? (
              <span className="hint">已经到单边上限 {CANVAS_MAX} 格。</span>
            ) : null}
          </div>
        </div>

        <div className="dialog-foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={create}>
            <IconPlus width={14} height={14} /> 创建画布
          </button>
        </div>
      </div>
    </div>
  );
}
