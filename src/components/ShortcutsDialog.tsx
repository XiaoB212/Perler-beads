import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTIONS,
  DEFAULT_KEYMAP,
  actionLabel,
  conflictedActions,
  eventToBinding,
  keyLabel,
  saveKeymap,
  type ActionId,
  type KeyMap,
} from '../core/keymap';
import { IconClose, IconRotate } from './Icons';

interface Props {
  onClose: () => void;
  keymap: KeyMap;
  onChange: (next: KeyMap) => void;
}

export default function ShortcutsDialog({ onClose, keymap, onChange }: Props) {
  const [editing, setEditing] = useState<ActionId | null>(null);
  const [draft, setDraft] = useState<KeyMap>(keymap);
  const [error, setError] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(keymap), [keymap]);

  // 捕获阶段拿键盘事件：正在录制键位时不能让它触发别的快捷键
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setEditing(null);
        setError('');
        return;
      }
      const binding = eventToBinding(e);
      if (!binding) return;
      const clashes = conflictedActions(binding, draft, editing);
      if (clashes.length) {
        setError(`「${keyLabel(binding).join('+')}」已经分配给「${actionLabel(clashes[0])}」了，换一个键位`);
        return;
      }
      const next = { ...draft, [editing]: binding };
      setDraft(next);
      saveKeymap(next);
      onChange(next);
      setEditing(null);
      setError('');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing, draft, onChange]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof ACTIONS>();
    for (const a of ACTIONS) {
      const list = map.get(a.group) ?? [];
      list.push(a);
      map.set(a.group, list);
    }
    return [...map.entries()];
  }, []);

  const resetOne = (id: ActionId) => {
    const next = { ...draft, [id]: DEFAULT_KEYMAP[id] };
    setDraft(next);
    saveKeymap(next);
    onChange(next);
    setError('');
  };

  const resetAll = () => {
    const next = { ...DEFAULT_KEYMAP };
    setDraft(next);
    saveKeymap(next);
    onChange(next);
    setError('');
  };

  const isCustom = (id: ActionId) => draft[id] !== DEFAULT_KEYMAP[id];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div className="dialog-title">
            <h2>快捷键</h2>
            <p>点键位就能改；桌面端不碰鼠标也能画。站内按 {keyLabel(draft.help).join('+')} 随时叫出这张表。</p>
          </div>
          <button className="dialog-close" onClick={onClose}>
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="dialog-body" ref={boxRef}>
          <div className="keys-toolbar">
            <button className="btn sm" onClick={resetAll}>
              <IconRotate width={12} height={12} /> 全部恢复默认
            </button>
            <span className="keys-tip">点击右侧键位后，直接按下想绑定的按键（Esc 取消）</span>
          </div>

          {error && <div className="keys-error">{error}</div>}

          <div className="keys-grid">
            {groups.map(([title, items]) => (
              <section className="keys-group" key={title}>
                <h3>{title}</h3>
                <ul>
                  {items.map((it) => (
                    <li key={it.id}>
                      <span className="keys-desc">{it.label}</span>
                      <span className="keys-combo">
                        <button
                          className={
                            'key-cap' + (editing === it.id ? ' recording' : '') + (isCustom(it.id) ? ' custom' : '')
                          }
                          onClick={() => {
                            setEditing(it.id);
                            setDraft(keymap);
                            setError('');
                          }}
                          title={isCustom(it.id) ? '已修改，点击重设；双击恢复默认' : '点击修改'}
                          onDoubleClick={() => resetOne(it.id)}
                        >
                          {editing === it.id ? (
                            <em>请按键…</em>
                          ) : (
                            keyLabel(draft[it.id]).map((k) => (
                              <kbd className="kbd" key={k}>
                                {k}
                              </kbd>
                            ))
                          )}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <p className="keys-note">
            方向键把光标放到画布上，之后 Enter 落笔、Delete 擦除，全程不需要鼠标；
            Shift + 方向键一次走 5 格。键位保存在本机浏览器里，换设备不会同步。
          </p>
        </div>

        <div className="dialog-foot">
          <div className="spacer" />
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
