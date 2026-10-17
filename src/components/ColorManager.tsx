import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { BRAND_LABEL, BUILTIN_PALETTES, palettePreset } from '../core/palette';
import type { BeadColor } from '../core/types';
import { IconClose, IconDownload, IconPlus, IconSearch, IconTrash, IconUpload } from './Icons';
import { readableTextColor } from '../core/color';
import {
  deleteUserPalette,
  exportPaletteCsv,
  exportPaletteJson,
  listUserPalettes,
  mapByNearestHex,
  parsePaletteText,
  saveUserPalette,
  toBeadColors,
  type ParseResult,
  type UserPalette,
} from '../core/palette-io';

interface Props {
  onClose: () => void;
  /** 打开时停在哪个 tab：从「换色卡」进来直接到品牌色板 */
  initialTab?: 'doc' | 'preset' | 'io';
}

export default function ColorManager({ onClose, initialTab = 'doc' }: Props) {
  const doc = useEditor((s) => s.doc);
  const addCustomColor = useEditor((s) => s.addCustomColor);
  const updateColor = useEditor((s) => s.updateColor);
  const removeColor = useEditor((s) => s.removeColor);
  const setPalette = useEditor((s) => s.setPalette);
  const setColorIndex = useEditor((s) => s.setColorIndex);
  const colorIndex = useEditor((s) => s.colorIndex);
  const notify = useEditor((s) => s.notify);

  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'doc' | 'preset' | 'io'>(initialTab);

  // —— 导入 / 导出 ——
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [importMode, setImportMode] = useState<'replace' | 'append'>('replace');
  const [palName, setPalName] = useState('');
  const [saved, setSaved] = useState<UserPalette[]>(() => listUserPalettes());
  const [dragOver, setDragOver] = useState(false);

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

  /** 把旧色板按最近色映射到新色板，保留已画内容 */
  const applyPalette = (next: BeadColor[], label: string) => {
    const old = doc.palette;
    const map = new Map<number, number>();
    old.forEach((c, i) => {
      map.set(i, mapByNearestHex(c.hex, next));
    });
    const cells = doc.cells.slice();
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] > 0) cells[i] = (map.get(cells[i] - 1) ?? 0) + 1;
    }
    setPalette(next);
    useEditor.setState({ doc: { ...useEditor.getState().doc, cells }, colorIndex: 0 });
    notify(label);
  };

  const applyPreset = (key: string) => {
    applyPalette(palettePreset(key), `已应用 ${BRAND_LABEL[key]} 色板`);
    setTab('doc');
  };

  const patch = (i: number, p: Partial<BeadColor>) => updateColor(i, p);

  /* ----------------------- 导入 ----------------------- */

  const runParse = (text: string, fallbackName = '') => {
    try {
      const r = parsePaletteText(text);
      if (!r.colors.length) {
        setParsed(null);
        notify('没读到任何色号，检查一下文件格式', 'warn');
        return;
      }
      setParsed(r);
      if (!palName) setPalName(r.name || fallbackName || '导入的色卡');
      notify(`读到 ${r.colors.length} 个色号${r.merged ? `，合并重复 ${r.merged}` : ''}`);
    } catch (err) {
      setParsed(null);
      notify((err as Error).message || '解析失败', 'warn');
    }
  };

  const readFile = async (f: File) => {
    const text = await f.text();
    const base = f.name.replace(/\.[^.]+$/, '');
    setPaste(text.slice(0, 20000));
    runParse(text, base);
  };

  const doImport = () => {
    if (!parsed) return;
    const incoming = toBeadColors(parsed.colors, '自定义');
    if (importMode === 'replace') {
      applyPalette(incoming, `已导入 ${incoming.length} 个色号，替换当前色板`);
    } else {
      const have = new Set(doc.palette.map((c) => c.hex.toUpperCase()));
      const add = incoming.filter((c) => !have.has(c.hex.toUpperCase()));
      if (!add.length) {
        notify('这些颜色当前色板里都有了', 'warn');
        return;
      }
      setPalette(doc.palette.concat(add));
      notify(`已追加 ${add.length} 个色号（跳过 ${incoming.length - add.length} 个重复）`);
    }
    setTab('doc');
  };

  /* ----------------------- 我的色卡 ----------------------- */

  const doSave = () => {
    const item = saveUserPalette(palName || doc.name || '我的色卡', doc.palette);
    setPalName(item.name);
    setSaved(listUserPalettes());
    notify(`已保存「${item.name}」，下次可以直接套用`);
  };

  const applyUserPalette = (p: UserPalette) => {
    applyPalette(toBeadColors(p.colors, p.colors[0]?.brand || '自定义'), `已套用色卡「${p.name}」`);
    setTab('doc');
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div className="dialog-title">
            <h2>色号管理</h2>
            <p>自定义色号、导入导出色卡、替换整套色板 —— 全部保存在本地</p>
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
          <button className={tab === 'io' ? 'active' : ''} onClick={() => setTab('io')}>
            导入 / 导出
          </button>
        </div>

        {tab === 'doc' && (
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
                <button className="btn sm" onClick={() => setTab('preset')} title="整块换成别的品牌色卡">
                  换色卡
                </button>
              </div>
              <div className="hint" style={{ marginBottom: 10 }}>
                色号 / 色名 / 品牌点一下就能直接改，改完立刻生效，随时都能改——不是导入时定死的。
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {list.map(({ c, i }) => (
                  <div
                    key={c.id + i}
                    className="color-row"
                    style={i === colorIndex ? { background: 'var(--accent-soft)' } : undefined}
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
                      <input
                        className="brand"
                        value={c.brand ?? ''}
                        onChange={(e) => patch(i, { brand: e.target.value })}
                        placeholder="品牌"
                        title="品牌名，导出色卡时会带上"
                      />
                    </div>
                    <span
                      className="chip"
                      style={{ fontFamily: 'var(--mono)', fontSize: 10 }}
                      title="该色使用量"
                    >
                      {usage.get(i) ?? 0}
                    </span>
                    <span className="chip hex-chip" title="HEX">
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
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                提示：删除色号会同时清除画布上使用该色的格子
              </span>
              <div className="spacer" />
              <button className="btn" onClick={onClose}>
                完成
              </button>
            </div>
          </>
        )}

        {tab === 'preset' && (
          <>
            <div className="dialog-body">
              <p style={{ marginTop: 0, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7 }}>
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
                        <b>{BRAND_LABEL[key]}</b>
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

        {tab === 'io' && (
          <>
            <div className="dialog-body">
              {/* 导出当前色板 */}
              <div className="io-block">
                <div className="io-head">
                  <b>导出当前色板</b>
                  <span>共 {doc.palette.length} 色，改完可以再导回来</span>
                </div>
                <div className="io-actions">
                  <button className="btn" onClick={() => exportPaletteJson(doc.palette, palName || doc.name)}>
                    <IconDownload width={14} height={14} /> 导出 JSON
                  </button>
                  <button className="btn" onClick={() => exportPaletteCsv(doc.palette, palName || doc.name)}>
                    <IconDownload width={14} height={14} /> 导出 CSV
                  </button>
                  <span className="io-note">CSV 适合在 Excel 里批量改色号再粘回来</span>
                </div>
              </div>

              <div className="divider" />

              {/* 导入 */}
              <div className="io-block">
                <div className="io-head">
                  <b>导入色卡</b>
                  <span>支持本项目的 .palette.json、带 HEX 的 JSON 数组，或「色号,色名,HEX」表格</span>
                </div>

                <div
                  className={'dropzone' + (dragOver ? ' over' : '')}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) void readFile(f);
                  }}
                >
                  <IconUpload width={20} height={20} />
                  <b>点这里选文件，或把文件拖进来</b>
                  <span>.json / .csv / .txt</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,.csv,.txt,application/json,text/csv,text/plain"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void readFile(f);
                      e.target.value = '';
                    }}
                  />
                </div>

                <textarea
                  className="input io-textarea"
                  placeholder={'也可以直接粘贴，例如：\nA1,绯红,#E23B4A\nA2,朱红,#E5484D'}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={4}
                />
                <div className="io-actions">
                  <button className="btn sm" onClick={() => runParse(paste)}>
                    解析上面这段
                  </button>
                  <div className="segmented sm-seg">
                    <button
                      className={importMode === 'replace' ? 'active' : ''}
                      onClick={() => setImportMode('replace')}
                      title="用导入的色卡替换当前图纸色板，已画内容映射到最近色"
                    >
                      替换色板
                    </button>
                    <button
                      className={importMode === 'append' ? 'active' : ''}
                      onClick={() => setImportMode('append')}
                      title="把导入的色号追加到当前色板，重复 HEX 自动跳过"
                    >
                      追加颜色
                    </button>
                  </div>
                </div>

                {parsed && (
                  <div className="io-preview">
                    <div className="io-preview-head">
                      <b>
                        读到 {parsed.colors.length} 个色号
                        {parsed.merged > 0 && ` · 合并重复 ${parsed.merged}`}
                        {parsed.skipped > 0 && ` · 跳过无效 ${parsed.skipped}`}
                      </b>
                      <button className="btn sm primary" onClick={doImport}>
                        {importMode === 'replace' ? '替换为这套色卡' : '追加进当前色板'}
                      </button>
                    </div>
                    <div className="io-swatches">
                      {parsed.colors.slice(0, 40).map((c, i) => (
                        <span key={i} className="io-swatch" style={{ background: c.hex }} title={`${c.code} ${c.name} ${c.hex}`} />
                      ))}
                      {parsed.colors.length > 40 && <span className="io-more">+{parsed.colors.length - 40}</span>}
                    </div>
                  </div>
                )}
              </div>

              <div className="divider" />

              {/* 我的色卡 */}
              <div className="io-block">
                <div className="io-head">
                  <b>我的色卡</b>
                  <span>存到浏览器本地，换个图纸也能一键套用</span>
                </div>
                <div className="io-actions">
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 120 }}
                    placeholder={doc.name || '色卡名字'}
                    value={palName}
                    onChange={(e) => setPalName(e.target.value)}
                  />
                  <button className="btn sm" onClick={doSave}>
                    保存当前色板
                  </button>
                </div>
                {saved.length > 0 ? (
                  <div className="saved-list">
                    {saved.map((p) => (
                      <div key={p.id} className="saved-item">
                        <span className="saved-swatches">
                          {p.colors.slice(0, 8).map((c, i) => (
                            <i key={i} style={{ background: c.hex }} />
                          ))}
                        </span>
                        <span className="saved-body">
                          <b>{p.name}</b>
                          <em>{p.colors.length} 色</em>
                        </span>
                        <button className="btn sm" onClick={() => applyUserPalette(p)}>
                          套用
                        </button>
                        <button
                          className="icon-btn"
                          title="导出"
                          onClick={() => exportPaletteJson(toBeadColors(p.colors, '自定义'), p.name)}
                        >
                          <IconDownload width={13} height={13} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title="删除"
                          onClick={() => {
                            deleteUserPalette(p.id);
                            setSaved(listUserPalettes());
                            notify('已删除该色卡');
                          }}
                        >
                          <IconTrash width={13} height={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="io-empty">还没有保存过色卡。把常用的那套色板存下来，之后开新图纸直接套用。</p>
                )}
              </div>
            </div>
            <div className="dialog-foot">
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                导入是宽容模式：3 位 HEX、带不带 #、8 位带透明度、rgb 数组都认
              </span>
              <div className="spacer" />
              <button className="btn" onClick={onClose}>
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
