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
  clampCanvasPair,
} from '../core/board';
import { IconClose, IconPlus } from './Icons';

interface Props {
  onClose: () => void;
}

/** 常用尺寸都按「常见方形板」的整数倍给，方便直接开拼；也能自己填任意值 */
const SIZES = [
  { w: 29, h: 29, label: '29 × 29', sub: '单块大板' },
  { w: 48, h: 48, label: '48 × 48', sub: '单块加大板' },
  { w: 64, h: 64, label: '64 × 64', sub: '默认' },
  { w: 87, h: 87, label: '87 × 87', sub: '3×3 板' },
  { w: 116, h: 116, label: '116 × 116', sub: '4×4 板' },
  { w: 232, h: 232, label: '232 × 232', sub: '8×8 板' },
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

  const boards = useMemo(
    () => Math.ceil(cw / DEFAULT_PEGBOARD) * Math.ceil(ch / DEFAULT_PEGBOARD),
    [cw, ch],
  );

  const create = () => {
    if (dirty && !confirm('当前图纸尚未保存，新建会丢失未保存的内容。继续？')) return;
    newDocument(cw, ch, paletteKey, name.trim() || '未命名图纸');
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
            <label>常用尺寸</label>
            <div className="preset-grid">
              {SIZES.map((s) => (
                <button
                  key={s.w}
                  className={'preset-btn' + (cw === s.w && ch === s.h ? ' active' : '')}
                  onClick={() => {
                    setWText(String(s.w));
                    setHText(String(s.h));
                  }}
                >
                  <b>{s.label}</b>
                  <span>{s.sub}</span>
                </button>
              ))}
            </div>
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
              共 {cw * ch} 格 · {boards} 块 {DEFAULT_PEGBOARD}×{DEFAULT_PEGBOARD} 拼豆板 · 色卡数据来自
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
