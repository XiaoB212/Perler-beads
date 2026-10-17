import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../core/store';
import { BRAND_LABEL, PALETTE_KEYS, palettePreset, resolvePaletteKey } from '../core/palette';
import { IconPalette, IconPlus, IconSearch, IconSettings, IconTrash } from './Icons';

interface Props {
  onOpenManager: () => void;
}

/** 色卡切换按钮上的短名，全名太长会挤爆一行 */
const SHORT_LABEL: Record<string, string> = {
  mard291: 'MARD',
  coco291: 'COCO',
  manman278: '漫漫',
  mixiaowo290: '咪小窝',
  panpan289: '盼盼',
  artkal418: 'Artkal 418',
  artkal197: 'Artkal C',
  artkal221: 'Artkal M',
  youken174: '优肯',
  basic: '基础',
};

/** 从色号里取前缀当分组：A02 → A，CT03 → CT，01 → # */
function groupOf(code: string): string {
  const m = /^[A-Za-z]+/.exec(code);
  return m ? m[0].toUpperCase() : '#';
}

/** 分页步长：一次多放出这么多色块，避免 291/418 色一次性铺满 DOM */
const PAGE = 96;

export default function ColorPanel({ onOpenManager }: Props) {
  const doc = useEditor((s) => s.doc);
  const colorIndex = useEditor((s) => s.colorIndex);
  const setColorIndex = useEditor((s) => s.setColorIndex);
  const addCustomColor = useEditor((s) => s.addCustomColor);
  const notify = useEditor((s) => s.notify);
  const [q, setQ] = useState('');
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [group, setGroup] = useState<string>('all');
  const [libOpen, setLibOpen] = useState(false);
  const [libBrand, setLibBrand] = useState<string>('mard291');
  const [libQuery, setLibQuery] = useState('');
  const [listLimit, setListLimit] = useState(PAGE);
  const [libLimit, setLibLimit] = useState(PAGE);

  const usage = useMemo(() => {
    const m = new Map<number, number>();
    for (let i = 0; i < doc.cells.length; i++) {
      const v = doc.cells[i];
      if (!v) continue;
      m.set(v - 1, (m.get(v - 1) ?? 0) + 1);
    }
    return m;
  }, [doc.cells]);

  /** 色号分组：只有两个以上分组才显示 tab 条 */
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of doc.palette) {
      const g = groupOf(c.code);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    const keys = [...m.keys()].sort((a, b) => a.localeCompare(b));
    return { keys, counts: m };
  }, [doc.palette]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return doc.palette
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => {
        if (onlyUsed && !usage.get(i)) return false;
        if (group !== 'all' && groupOf(c.code) !== group) return false;
        if (!kw) return true;
        return (
          c.name.toLowerCase().includes(kw) ||
          c.code.toLowerCase().includes(kw) ||
          c.hex.toLowerCase().includes(kw) ||
          c.brand.toLowerCase().includes(kw)
        );
      });
  }, [doc.palette, q, onlyUsed, usage, group]);

  // 品牌色板里还没进当前图纸的颜色
  const library = useMemo(() => {
    const have = new Set(doc.palette.map((c) => c.hex.toUpperCase()));
    const kw = libQuery.trim().toLowerCase();
    return palettePreset(libBrand).filter((c) => {
      if (have.has(c.hex.toUpperCase())) return false;
      if (!kw) return true;
      return c.name.toLowerCase().includes(kw) || c.code.toLowerCase().includes(kw);
    });
  }, [doc.palette, libBrand, libQuery]);

  const cur = doc.palette[colorIndex];

  // 筛选条件一变就从第一页重新开始，避免停在「第 8 页」却只剩 3 条
  useEffect(() => {
    setListLimit(PAGE);
  }, [q, group, onlyUsed]);
  useEffect(() => {
    setLibLimit(PAGE);
  }, [libBrand, libQuery]);

  const shown = list.slice(0, listLimit);
  const libShown = library.slice(0, libLimit);

  const addFromLibrary = (hex: string, brand: string, code: string, name: string) => {
    const idx = addCustomColor({
      id: `lib-${Date.now().toString(36)}`,
      brand: brand.toUpperCase(),
      code,
      name,
      hex,
    });
    setColorIndex(idx);
    notify(`已加入 ${code} ${name}`);
  };

  return (
    <div>
      <div className="panel-head">
        <span className="panel-title">色板 · {doc.palette.length} 色</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={'btn sm ' + (onlyUsed ? 'primary' : '')}
            onClick={() => setOnlyUsed((v) => !v)}
            title="只显示已使用的颜色"
          >
            已用 {usage.size}
          </button>
          <button className="icon-btn" onClick={onOpenManager} title="色号管理">
            <IconSettings width={14} height={14} />
          </button>
        </div>
      </div>

      {cur && (
        <div className="current-color">
          <div className="current-swatch" style={{ background: cur.hex, color: cur.hex }} />
          <div className="current-meta">
            <b>
              {cur.brand} {cur.code} · {cur.name}
            </b>
            <span>{cur.hex.toUpperCase()}</span>
          </div>
          <button className="icon-btn" onClick={onOpenManager} title="管理色号">
            <IconPalette width={15} height={15} />
          </button>
        </div>
      )}

      <div className="palette-toolbar">
        <div className="palette-search">
          <IconSearch />
          <input placeholder="搜索色号 / 色名 / HEX" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn sm" onClick={onOpenManager} title="新增自定义色号">
          <IconPlus width={13} height={13} />
        </button>
      </div>

      {groups.keys.length > 1 && (
        <div className="group-tabs" role="tablist">
          <button
            className={'group-tab' + (group === 'all' ? ' active' : '')}
            onClick={() => setGroup('all')}
          >
            全部 <em>{doc.palette.length}</em>
          </button>
          {groups.keys.map((g) => (
            <button
              key={g}
              className={'group-tab' + (group === g ? ' active' : '')}
              onClick={() => setGroup(g === group ? 'all' : g)}
            >
              {g} <em>{groups.counts.get(g)}</em>
            </button>
          ))}
        </div>
      )}

      <div className="swatch-grid">
        {shown.map(({ c, i }) => (
          <button
            key={c.id + i}
            className={'swatch' + (i === colorIndex ? ' active' : '')}
            style={{ background: c.hex }}
            onClick={() => setColorIndex(i)}
            title={`${c.brand} ${c.code} ${c.name} · ${c.hex}${usage.get(i) ? ` · 用量 ${usage.get(i)}` : ''}`}
          >
            <span className="swatch-hole" />
            <span className="swatch-badge">{c.code}</span>
          </button>
        ))}
        {!list.length && (
          <div className="hint-box" style={{ gridColumn: '1 / -1' }}>
            没有匹配的颜色
            <br />
            <button className="btn sm" style={{ marginTop: 8 }} onClick={onOpenManager}>
              <IconTrash width={12} height={12} /> 前往色号管理
            </button>
          </div>
        )}
      </div>
      {list.length > listLimit && (
        <button className="load-more" onClick={() => setListLimit((n) => n + PAGE * 2)}>
          还有 {list.length - listLimit} 个色号 · 继续显示
        </button>
      )}

      {/* 从品牌色板补充颜色：不用先去色号管理建自定义色 */}
      <div className={'color-lib' + (libOpen ? ' open' : '')}>
        <button className="color-lib-head" onClick={() => setLibOpen((v) => !v)}>
          <IconPlus width={12} height={12} />
          <span>从品牌色板添加</span>
          <em>{libOpen ? '收起' : '展开'}</em>
        </button>
        {libOpen && (
          <>
            <div className="seg-row seg-wrap" style={{ marginBottom: 6 }}>
              {PALETTE_KEYS.map((k) => (
                <button
                  key={k}
                  className={'btn sm ' + (libBrand === k ? 'primary' : '')}
                  onClick={() => setLibBrand(k)}
                  title={BRAND_LABEL[k]}
                >
                  {SHORT_LABEL[k] ?? BRAND_LABEL[k]}
                </button>
              ))}
            </div>
            <div className="palette-search" style={{ marginBottom: 6 }}>
              <IconSearch />
              <input
                placeholder={`在 ${BRAND_LABEL[resolvePaletteKey(libBrand)]} 里找色号`}
                value={libQuery}
                onChange={(e) => setLibQuery(e.target.value)}
              />
            </div>
            <div className="swatch-grid lib">
              {libShown.map((c) => (
                <button
                  key={c.id}
                  className="swatch"
                  style={{ background: c.hex }}
                  onClick={() => addFromLibrary(c.hex, c.brand, c.code, c.name)}
                  title={`加入 ${c.brand} ${c.code} ${c.name} · ${c.hex}`}
                >
                  <span className="swatch-hole" />
                  <span className="swatch-badge">{c.code}</span>
                </button>
              ))}
              {!library.length && (
                <div className="hint-box" style={{ gridColumn: '1 / -1' }}>
                  这个色板的颜色都已经在图纸里了
                </div>
              )}
            </div>
            {library.length > libLimit && (
              <button className="load-more" onClick={() => setLibLimit((n) => n + PAGE * 2)}>
                还有 {library.length - libLimit} 个色号 · 继续显示
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
