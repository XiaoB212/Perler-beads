import { useMemo, useState } from 'react';
import { useEditor } from '../core/store';
import { BRAND_LABEL, BUILTIN_PALETTES, palettePreset } from '../core/palette';
import type { BeadColor } from '../core/types';
import { IconClose, IconPlus, IconSearch, IconTrash } from './Icons';
import { readableTextColor } from '../core/color';

interface Props {
  onClose: () => void;
}

export default function ColorManager({ onClose }: Props) {
  const doc = useEditor((s) => s.doc);
  const addCustomColor = useEditor((s) => s.addCustomColor);
  const updateColor = useEditor((s) => s.updateColor);
  const removeColor = useEditor((s) => s.removeColor);
  const setPalette = useEditor((s) => s.setPalette);
  const setColorIndex = useEditor((s) => s.setColorIndex);
  const colorIndex = useEditor((s) => s.colorIndex);
  const notify = useEditor((s) => s.notify);

  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'doc' | 'preset'>('doc');

  const usage = useMemo(() => {
    const m = new Map<number, number>();
    for (let i = 0; i < doc.cells.length; i++) {
      const v = doc.cells[i];
      if (v) m.set(v - 1, (m.get(v - 1) ?? 0) + 1);
    }
    return m;
  }, [doc.cells]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return doc.palette
      .map((c, i) => ({ c, i }))
      .filter(
        ({ c }) =>
          !kw ||
          c.name.toLowerCase().includes(kw) ||
          c.code.toLowerCase().includes(kw) ||
          c.hex.toLowerCase().includes(kw),
      );
  }, [doc.palette, q]);

  const addNew = () => {
    const idx = addCustomColor({
      id: 'custom-' + Date.now().toString(36),
      brand: '自定义',
      code: 'C' + (doc.palette.filter((c) => c.custom).length + 1),
      name: '自定义色',
      hex: '#FF8A3D',
      custom: true,
    });
    setColorIndex(idx);
    notify('已新增自定义色号');
  };

  const applyPreset = (key: string) => {
    const preset = palettePreset(key);
    // 保留已画内容：把旧色映射到新色板最接近的颜色
    const old = doc.palette;
    const map = new Map<number, number>();
    old.forEach((c, i) => {
      let best = 0;
      let bestD = Infinity;
      const rgb = parseInt(c.hex.slice(1), 16);
      const r1 = (rgb >> 16) & 255;
      const g1 = (rgb >> 8) & 255;
      const b1 = rgb & 255;
      preset.forEach((p, j) => {
        const pr = parseInt(p.hex.slice(1), 16);
        const d =
          (((pr >> 16) & 255) - r1) ** 2 + (((pr >> 8) & 255) - g1) ** 2 + ((pr & 255) - b1) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      map.set(i, best);
    });
    const cells = doc.cells.slice();
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] > 0) cells[i] = (map.get(cells[i] - 1) ?? 0) + 1;
    }
    setPalette(preset);
    useEditor.setState({ doc: { ...useEditor.getState().doc, cells }, colorIndex: 0 });
    setTab('doc');
    notify(`已应用 ${BRAND_LABEL[key]} 色板`);
  };

  const patch = (i: number, p: Partial<BeadColor>) => updateColor(i, p);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div className="dialog-title">
            <h2>色号管理</h2>
            <p>自定义色号、修改 HEX、替换整套色板 —— 全部保存在本地</p>
          </div>
          <button className="dialog-close" onClick={onClose}>
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="tabs">
          <button className={tab === 'doc' ? 'active' : ''} onClick={() => setTab('doc')}>
            本图纸色板 · {doc.palette.length}
          </button>
          <button className={tab === 'preset' ? 'active' : ''} onClick={() => setTab('preset')}>
            品牌色板
          </button>
        </div>

        {tab === 'doc' ? (
          <>
            <div className="dialog-body">
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div className="palette-search" style={{ flex: 1 }}>
                  <IconSearch />
                  <input placeholder="搜索色号 / 色名 / HEX" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <button className="btn sm primary" onClick={addNew}>
                  <IconPlus width={13} height={13} /> 新增色号
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {list.map(({ c, i }) => (
                  <div
                    key={c.id + i}
                    className="color-row"
                    style={i === colorIndex ? { background: 'rgba(255,138,61,0.1)' } : undefined}
                  >
                    <button
                      className="color-swatch-input"
                      style={{ background: c.hex }}
                      onClick={() => setColorIndex(i)}
                      title="设为当前色"
                    >
                      <input
                        type="color"
                        value={c.hex}
                        onChange={(e) => patch(i, { hex: e.target.value.toUpperCase() })}
                      />
                    </button>
                    <div className="color-fields">
                      <input
                        className="code"
                        value={c.code}
                        onChange={(e) => patch(i, { code: e.target.value })}
                        placeholder="色号"
                      />
                      <input
                        className="name"
                        value={c.name}
                        onChange={(e) => patch(i, { name: e.target.value })}
                        placeholder="色名"
                      />
                    </div>
                    <span
                      className="chip"
                      style={{ fontFamily: 'var(--mono)', fontSize: 10 }}
                      title="该色使用量"
                    >
                      {usage.get(i) ?? 0}
                    </span>
                    <span
                      className="chip"
                      style={{ color: readableTextColor('#000'), fontSize: 10, minWidth: 52, justifyContent: 'center' }}
                    >
                      {c.hex}
                    </span>
                    <button
                      className="icon-btn danger"
                      onClick={() => {
                        removeColor(i);
                        notify('已删除该色号');
                      }}
                      title="删除色号（画布上该色会一并清除）"
                    >
                      <IconTrash width={13} height={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="dialog-foot">
              <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                提示：删除色号会同时清除画布上使用该色的格子
              </span>
              <div className="spacer" />
              <button className="btn" onClick={onClose}>
                完成
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dialog-body">
              <p style={{ marginTop: 0, fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.7 }}>
                选择一套品牌色板替换当前图纸色板。已画的内容会自动映射到最接近的新色号，不会丢失。
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                {Object.keys(BUILTIN_PALETTES).map((key) => {
                  const p = BUILTIN_PALETTES[key];
                  return (
                    <button
                      key={key}
                      className="radio-card"
                      onClick={() => applyPreset(key)}
                      style={{ padding: '10px 12px' }}
                    >
                      <div className="rc-body">
                        <b>
                          {BRAND_LABEL[key]} · {p.length} 色
                        </b>
                        <span style={{ display: 'flex', gap: 2, marginTop: 5 }}>
                          {p
                            .filter((_, i) => i % Math.ceil(p.length / 24) === 0)
                            .slice(0, 24)
                            .map((c, i) => (
                              <i
                                key={i}
                                style={{
                                  width: 12,
                                  height: 12,
                                  borderRadius: 3,
                                  background: c.hex,
                                  display: 'block',
                                }}
                              />
                            ))}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="dialog-foot">
              <div className="spacer" />
              <button className="btn" onClick={onClose}>
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
