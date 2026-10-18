import { useMemo, useState } from 'react';
import { useEditor } from '../core/store';
import { IconCheck, IconDownload } from './Icons';
import { exportCSV } from '../core/export';
import { costSummary, getDefaultPrice, money, setDefaultPrice } from '../core/cost';
import ProgressPanel from './ProgressPanel';

export default function UsagePanel() {
  const doc = useEditor((s) => s.doc);
  const colorIndex = useEditor((s) => s.colorIndex);
  const setColorIndex = useEditor((s) => s.setColorIndex);
  const markAllPlaced = useEditor((s) => s.markAllPlaced);
  const toggleFlag = useEditor((s) => s.toggleFlag);
  const flags = useEditor((s) => s.flags);
  const updateColor = useEditor((s) => s.updateColor);
  const soloColor = useEditor((s) => s.soloColor);
  const setSoloColor = useEditor((s) => s.setSoloColor);
  const markColorPlaced = useEditor((s) => s.markColorPlaced);

  const [mode, setMode] = useState<'usage' | 'cost'>('usage');
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [price, setPrice] = useState(() => getDefaultPrice());

  const { rows, total, placed } = useMemo(() => {
    const totalMap = new Map<number, number>();
    const placedMap = new Map<number, number>();
    let t = 0;
    let p = 0;
    for (let i = 0; i < doc.cells.length; i++) {
      const v = doc.cells[i];
      if (!v) continue;
      t++;
      totalMap.set(v - 1, (totalMap.get(v - 1) ?? 0) + 1);
      if (doc.progress[i]) {
        p++;
        placedMap.set(v - 1, (placedMap.get(v - 1) ?? 0) + 1);
      }
    }
    const rows = Array.from(totalMap.entries())
      .map(([idx, count]) => ({
        idx,
        color: doc.palette[idx],
        total: count,
        placed: placedMap.get(idx) ?? 0,
      }))
      .filter((r) => r.color)
      .sort((a, b) => b.total - a.total);
    return { rows, total: t, placed: p };
    // 依赖整个 doc：cells / progress 是原地修改的 TypedArray，引用不变，
    // 只用 doc.cells 做依赖会导致勾选进度后统计不刷新。
  }, [doc]);

  const cost = useMemo(() => costSummary(doc, price), [doc, price]);

  const pct = total ? (placed / total) * 100 : 0;
  const boards = doc.pegboard
    ? Math.ceil(doc.width / doc.pegboard) * Math.ceil(doc.height / doc.pegboard)
    : 0;

  const commitPrice = (n: number) => {
    const v = Number.isFinite(n) ? Math.max(0, n) : 0;
    setPrice(v);
    setDefaultPrice(v);
  };

  return (
    <div>
      <div className="panel-head">
        <span className="panel-title">用量与成本</span>
        <button className="icon-btn" title="导出用量 CSV" onClick={() => exportCSV(doc)}>
          <IconDownload width={14} height={14} />
        </button>
      </div>

      <div className="segmented" style={{ marginBottom: 10, width: '100%' }}>
        <button className={mode === 'usage' ? 'active' : ''} onClick={() => setMode('usage')} style={{ flex: 1 }}>
          用量
        </button>
        <button className={mode === 'cost' ? 'active' : ''} onClick={() => setMode('cost')} style={{ flex: 1 }}>
          成本
        </button>
      </div>

      <div className="usage-summary">
        <div className="stat-card hl">
          <div className="k">总豆数</div>
          <div className="v">{total}</div>
        </div>
        <div className="stat-card">
          <div className="k">已拼</div>
          <div className="v">{placed}</div>
        </div>
        <div className="stat-card">
          <div className="k">色数</div>
          <div className="v">{rows.length}</div>
        </div>
      </div>

      <div className="mini-label">
        <span>拼装进度</span>
        <b>{pct.toFixed(1)}%</b>
      </div>
      <div className="progress-bar">
        <i style={{ width: `${pct}%` }} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button
          className={'btn sm ' + (flags.progressMode ? 'primary' : '')}
          onClick={() => toggleFlag('progressMode')}
          style={{ flex: 1 }}
          title="开启后画笔用于勾选已拼好的豆子"
        >
          <IconCheck width={12} height={12} />
          {flags.progressMode ? '进度模式 开' : '进度模式'}
        </button>
        <button
          className={'btn sm ' + (soloColor !== null ? 'primary' : '')}
          onClick={() => setSoloColor(soloColor === null ? colorIndex : null)}
          title="单色模式：只拼当前这个色号，画布上其它颜色会压暗，一格一格对色时更好找"
        >
          {soloColor === null ? '单色' : `单色 ${doc.palette[soloColor]?.code ?? ''}`}
        </button>
      </div>

      {soloColor !== null && (
        <div className="hint-box" style={{ marginBottom: 10 }}>
          单色模式：现在只拼 <b>{doc.palette[soloColor]?.code} {doc.palette[soloColor]?.name}</b>
          ，点别的颜色不会误勾；点上面的「单色」退出。
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button className="btn sm" onClick={() => markAllPlaced(true)} title="全部标记为已拼">
          全拼
        </button>
        <button className="btn sm" onClick={() => markAllPlaced(false)} title="清空进度">
          重置
        </button>
        {soloColor !== null && (
          <button
            className="btn sm"
            onClick={() => markColorPlaced(soloColor, true)}
            title="把单色模式这个色号整色标记为完成"
          >
            <IconCheck width={12} height={12} />
            整色完成
          </button>
        )}
      </div>

      {mode === 'cost' && (
        <>
          <div className="cost-box">
            <div className="cost-row">
              <span>默认单价</span>
              <span className="cost-input">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={price}
                  onChange={(e) => commitPrice(Number(e.target.value))}
                />
                <em>元/千颗</em>
              </span>
            </div>
            <div className="cost-hero">
              <div className="k">材料费合计</div>
              <div className="v">{money(cost.totalAmount)}</div>
              <div className="s">
                未拼部分 {money(cost.remainingAmount)} · {total} 颗
              </div>
            </div>
            <div className="cost-row">
              <span>需补货</span>
              <b>{cost.restockCount} 颗</b>
            </div>
            <div className="cost-row">
              <span>补货花费</span>
              <b>{money(cost.restockAmount)}</b>
            </div>
            {cost.savedAmount > 0 && (
              <div className="cost-row">
                <span>库存已抵</span>
                <b className="ok">{money(cost.savedAmount)}</b>
              </div>
            )}
          </div>
          <div className="mini-label">
            <span>单色单价 / 库存</span>
            <b>点色号展开</b>
          </div>
        </>
      )}

      {mode === 'usage' && flags.progressMode && (
        <>
          <div className="online-banner">
            <b>线上拼豆模式</b>
            <span>对色打勾 / 打叉，每格颜色进度都在下面这个面板里；单色模式可以只留一个色号。</span>
          </div>
          <ProgressPanel />
        </>
      )}

      {mode === 'usage' && (
        <>
          <div className="mini-label">
            <span>分板</span>
            <b>
              {boards ? `${boards} 板 · 每板 ${doc.pegboard}×${doc.pegboard}` : '不显示分板'}
            </b>
          </div>
          <div className="divider" style={{ marginTop: 8 }} />
        </>
      )}

      <div className="panel-head">
        <span className="panel-title">色号明细</span>
        <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
          {mode === 'cost' ? '点开改单价与库存' : '点击切换当前色'}
        </span>
      </div>

      <div className="usage-list">
        {mode === 'usage'
          ? rows.map((r) => {
              const p = r.total ? (r.placed / r.total) * 100 : 0;
              const allDone = r.placed >= r.total;
              return (
                <div
                  key={r.idx}
                  className={
                    'usage-row' + (r.idx === colorIndex ? ' active' : '') + (r.idx === soloColor ? ' solo' : '')
                  }
                  onClick={() => {
                    setColorIndex(r.idx);
                    // 单色模式开着的时候，点哪一行就切到哪一行，不用来回点两次
                    if (soloColor !== null) setSoloColor(r.idx);
                  }}
                >
                  <div className="usage-dot" style={{ background: r.color.hex }} />
                  <div className="usage-name">
                    <b>
                      {r.color.brand} {r.color.code}
                    </b>
                    <span>
                      {r.color.name} · {p > 0 ? `${p.toFixed(0)}%` : r.color.hex.toUpperCase()}
                    </span>
                  </div>
                  <div className="usage-num">
                    {r.total}
                    <small>{r.placed > 0 ? `已 ${r.placed}` : '颗'}</small>
                  </div>
                  <button
                    type="button"
                    className={'usage-act' + (allDone ? ' done' : '')}
                    title={allDone ? `取消 ${r.color.code} 整色完成` : `一键把 ${r.color.code} 整色标为完成`}
                    onClick={(e) => {
                      e.stopPropagation();
                      markColorPlaced(r.idx, !allDone);
                    }}
                  >
                    <IconCheck width={11} height={11} />
                  </button>
                </div>
              );
            })
          : cost.rows.map((r) => {
              const c = doc.palette[r.index];
              const open = openIdx === r.index;
              return (
                <div key={r.index}>
                  <div
                    className={'usage-row' + (open ? ' active' : '')}
                    onClick={() => setOpenIdx(open ? null : r.index)}
                  >
                    <div className="usage-dot" style={{ background: c.hex }} />
                    <div className="usage-name">
                      <b>
                        {c.brand} {c.code}
                      </b>
                      <span>
                        {r.total} 颗 · 单价 {money(r.unitPrice)}
                        {r.stock > 0 ? ` · 库存 ${r.stock}` : ''}
                      </span>
                    </div>
                    <div className="usage-num">
                      {money(r.amount)}
                      <small className={r.restock > 0 ? 'warn' : ''}>
                        {r.restock > 0 ? `补 ${r.restock}` : '库存足'}
                      </small>
                    </div>
                  </div>
                  {open && (
                    <div className="cost-editor">
                      <label>
                        <span>单价</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={c.price ?? ''}
                          placeholder={String(price)}
                          onChange={(e) =>
                            updateColor(r.index, {
                              price: e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                        />
                        <em>元/千颗</em>
                      </label>
                      <label>
                        <span>库存</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={c.stock ?? ''}
                          placeholder="0"
                          onChange={(e) =>
                            updateColor(r.index, {
                              stock: e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value))),
                            })
                          }
                        />
                        <em>颗</em>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
        {!rows.length && <div className="hint-box">画布还是空的，开始画点什么吧 ✦</div>}
      </div>
    </div>
  );
}
