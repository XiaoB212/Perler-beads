import { useState } from 'react';
import { useEditor } from '../core/store';
import { BRAND_LABEL, DEFAULT_PALETTE_KEY, PALETTE_KEYS } from '../core/palette';
import { IconClose, IconPlus } from './Icons';

interface Props {
  onClose: () => void;
}

const SIZES = [
  { w: 29, h: 29, label: '29 × 29', sub: '单板' },
  { w: 48, h: 48, label: '48 × 48', sub: '常用' },
  { w: 58, h: 58, label: '58 × 58', sub: '双板' },
  { w: 87, h: 87, label: '87 × 87', sub: '三板' },
  { w: 96, h: 96, label: '96 × 96', sub: '大图' },
  { w: 116, h: 116, label: '116 × 116', sub: '四板' },
];

export default function NewCanvasDialog({ onClose }: Props) {
  const newDocument = useEditor((s) => s.newDocument);
  const dirty = useEditor((s) => s.dirty);
  const [w, setW] = useState(48);
  const [h, setH] = useState(48);
  const [paletteKey, setPaletteKey] = useState<string>(DEFAULT_PALETTE_KEY);
  const [name, setName] = useState('');

  const create = () => {
    if (dirty && !confirm('当前图纸尚未保存，新建会丢失未保存的内容。继续？')) return;
    newDocument(Math.max(4, Math.min(300, w)), Math.max(4, Math.min(300, h)), paletteKey, name.trim() || '未命名图纸');
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
                  className={'preset-btn' + (w === s.w && h === s.h ? ' active' : '')}
                  onClick={() => {
                    setW(s.w);
                    setH(s.h);
                  }}
                >
                  <b>{s.label}</b>
                  <span>{s.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-grid" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>宽度（格）</label>
              <input
                className="input"
                type="number"
                min={4}
                max={300}
                value={w}
                onChange={(e) => setW(Number(e.target.value) || 0)}
              />
            </div>
            <div className="field">
              <label>高度（格）</label>
              <input
                className="input"
                type="number"
                min={4}
                max={300}
                value={h}
                onChange={(e) => setH(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="field">
            <label>品牌色板</label>
            <select
              className="select"
              value={paletteKey}
              onChange={(e) => setPaletteKey(e.target.value)}
            >
              {PALETTE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {BRAND_LABEL[k]}
                </option>
              ))}
            </select>
            <span className="hint">
              共 {w * h} 格 · {Math.ceil(w / 29) * Math.ceil(h / 29)} 块 29×29 拼豆板 ·
              色卡数据来自 pindou-color-data
            </span>
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
