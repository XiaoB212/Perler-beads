import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../core/store';
import { buildShareUrl } from '../core/share';

/** 色号 → 总格数 / 已拼格数 */
function colorStats(cells: Uint16Array, progress: Uint8Array, paletteLength: number) {
  const total = new Int32Array(paletteLength);
  const placed = new Int32Array(paletteLength);
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (!v) continue;
    const k = v - 1;
    if (k < 0 || k >= paletteLength) continue;
    total[k]++;
    if (progress[i]) placed[k]++;
  }
  return { total, placed };
}

/**
 * 进度模式下的「对色拼装」面板：先选现在手上在拼的色号，
 * 点对了打勾、点错了打叉；也可以把当前进度做成链接发给别人看。
 */
export default function ProgressPanel() {
  const doc = useEditor((s) => s.doc);
  const flags = useEditor((s) => s.flags);
  const setFlag = useEditor((s) => s.setFlag);
  const checkColor = useEditor((s) => s.checkColor);
  const setCheckColor = useEditor((s) => s.setCheckColor);
  const wrongMarks = useEditor((s) => s.wrongMarks);
  const clearWrong = useEditor((s) => s.clearWrong);
  const rightCount = useEditor((s) => s.rightCount);
  const wrongCount = useEditor((s) => s.wrongCount);
  const setColorIndex = useEditor((s) => s.setColorIndex);
  const soloColor = useEditor((s) => s.soloColor);
  const setSoloColor = useEditor((s) => s.setSoloColor);
  const markColorPlaced = useEditor((s) => s.markColorPlaced);
  const notify = useEditor((s) => s.notify);
  const [autoNext, setAutoNext] = useState(true);
  const [shareMsg, setShareMsg] = useState('');

  const { total, placed } = useMemo(
    () => colorStats(doc.cells, doc.progress, doc.palette.length),
    [doc],
  );

  const rows = useMemo(() => {
    const out: { index: number; code: string; hex: string; total: number; placed: number }[] = [];
    for (let i = 0; i < doc.palette.length; i++) {
      if (!total[i]) continue;
      out.push({
        index: i,
        code: doc.palette[i].code,
        hex: doc.palette[i].hex,
        total: total[i],
        placed: placed[i],
      });
    }
    out.sort((a, b) => b.total - a.total);
    return out;
  }, [doc, total, placed]);

  const curRow = rows.find((r) => r.index === checkColor);

  const overall = rows.reduce(
    (acc, r) => ({ total: acc.total + r.total, placed: acc.placed + r.placed }),
    { total: 0, placed: 0 },
  );
  const percent = overall.total ? Math.round((overall.placed / overall.total) * 100) : 0;
  const accuracy =
    rightCount + wrongCount > 0 ? Math.round((rightCount / (rightCount + wrongCount)) * 100) : null;

  // 当前色号拼完了就自动跳到下一个没拼完的，线上照着拼时不用手动切
  useEffect(() => {
    if (!flags.progressCheck || !autoNext || checkColor < 0) return;
    const cur = rows.find((r) => r.index === checkColor);
    if (cur && cur.placed < cur.total) return;
    const next = rows.find((r) => r.placed < r.total);
    if (next && next.index !== checkColor) {
      setCheckColor(next.index);
      setColorIndex(next.index);
      notify(`「${cur?.code ?? '这个色号'}」拼完了，下一个：${next.code}`);
    }
  }, [flags.progressCheck, autoNext, checkColor, rows, setCheckColor, setColorIndex, notify]);

  const share = async () => {
    const res = await buildShareUrl(doc);
    const saved = res.saved && res.saved > 0 ? `（压缩后短了 ${res.saved} 个字符）` : '';
    const hint = res.tooLong
      ? `链接有点长（${res.length} 字符），有些聊天工具可能会截断，可以改用导出的 PNG / PDF 分享`
      : `进度链接已复制${saved}，发给别人就能看到你拼到哪儿了`;
    const done = () => {
      setShareMsg(hint);
      notify(res.tooLong ? '进度链接已复制（偏长）' : '进度链接已复制', res.tooLong ? 'warn' : 'ok');
    };
    try {
      await navigator.clipboard?.writeText(res.url);
      done();
    } catch {
      // 复制失败时把链接摊在面板上，让用户自己选中复制
      setShareMsg(res.url);
    }
    if (!navigator.clipboard) setShareMsg(res.url);
  };

  return (
    <>
      <div className="divider" />
      <div className="panel-head">
        <span className="panel-title">进度 · 拼装</span>
      </div>

      <div className="row-toggle" onClick={() => setFlag('progressCheck', !flags.progressCheck)}>
        <span>对色拼装（点错打叉）</span>
        <span className={'switch' + (flags.progressCheck ? ' on' : '')} />
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        {flags.progressCheck
          ? '先选你现在手上在拼的色号，点对了打勾、点错了打叉，同色格子会高亮出来。'
          : '关着的时候就是随手点一下打勾，不挑色号。'}
      </p>

      {flags.progressCheck && (
        <>
          <div className="progress-summary">
            <div className="progress-ring" style={{ ['--pct' as string]: `${percent}%` }}>
              <b>{percent}%</b>
            </div>
            <div className="progress-figures">
              <div>
                <b>{overall.placed}</b>
                <span>/ {overall.total} 颗</span>
              </div>
              <div className="progress-acc">
                对 {rightCount} · 叉 {wrongCount}
                {accuracy !== null && <em>准确率 {accuracy}%</em>}
              </div>
              {wrongMarks.size > 0 && (
                <button className="btn tiny" onClick={clearWrong}>
                  清掉 {wrongMarks.size} 个叉号
                </button>
              )}
            </div>
          </div>

          <div className="row-toggle" onClick={() => setAutoNext((v) => !v)}>
            <span>拼完自动跳下一个色号</span>
            <span className={'switch' + (autoNext ? ' on' : '')} />
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label>正在拼的色号</label>
            <div className="check-color-grid">
              {rows.map((r) => {
                const done = r.placed >= r.total;
                const on = r.index === checkColor;
                return (
                  <button
                    key={r.index}
                    className={'check-color' + (on ? ' on' : '') + (done ? ' done' : '')}
                    title={`${r.code} ${r.placed}/${r.total} 颗`}
                    onClick={() => {
                      setCheckColor(r.index);
                      setColorIndex(r.index);
                    }}
                  >
                    <span className="check-color-dot" style={{ background: r.hex }} />
                    <span className="check-color-code">{r.code}</span>
                    <span className="check-color-num">
                      {r.placed}/{r.total}
                    </span>
                  </button>
                );
              })}
              <button
                className={'check-color' + (checkColor < 0 ? ' on' : '')}
                title="不指定色号，点哪都算对"
                onClick={() => setCheckColor(-1)}
              >
                <span className="check-color-dot any" />
                <span className="check-color-code">任意</span>
                <span className="check-color-num">不判定</span>
              </button>
            </div>
          </div>

          {/* 单色模式 + 整色完成：先拼哪个颜色就只拼它，拼完一键整色打勾 */}
          {checkColor >= 0 && (
            <>
              <div className="row-toggle" onClick={() => setSoloColor(soloColor === null ? checkColor : null)}>
                <span>单色模式（只拼这个色号）</span>
                <span className={'switch' + (soloColor !== null ? ' on' : '')} />
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  className="btn sm"
                  style={{ flex: 1 }}
                  onClick={() => markColorPlaced(checkColor, true)}
                  title="把这个色号整色标记为已拼"
                >
                  整色完成 {curRow ? `(${curRow.total} 颗)` : ''}
                </button>
                <button
                  className="btn sm"
                  onClick={() => markColorPlaced(checkColor, false)}
                  title="把这个色号的进度清掉"
                >
                  取消
                </button>
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                单色模式打开后，画布上别的颜色会压暗，点错颜色也不会误勾；一个颜色拼完就能直接「整色完成」。
              </p>
            </>
          )}
        </>
      )}

      <div className="field" style={{ marginTop: 12 }}>
        <label>分享进度</label>
        <button className="btn block" onClick={share}>
          复制进度分享链接
        </button>
        <p className="hint" style={{ marginTop: 6 }}>
          链接里带着图纸和你已经拼好的部分，别人打开就能看到进度，不用登录也不用上传。
        </p>
        {shareMsg && <p className="hint share-msg">{shareMsg}</p>}
      </div>
    </>
  );
}