import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { deleteDoc, loadDoc, readIndex, saveDoc, type IndexEntry } from '../core/storage';
import { docToThumb, parseProject } from '../core/export';
import { IconClose, IconDownload, IconFile, IconFolder, IconTrash, IconUpload } from './Icons';

interface Props {
  onClose: () => void;
}

export default function ProjectsDialog({ onClose }: Props) {
  const doc = useEditor((s) => s.doc);
  const loadDocument = useEditor((s) => s.loadDocument);
  const notify = useEditor((s) => s.notify);
  const setDocMetaList = useEditor((s) => s.setDocMetaList);
  const [list, setList] = useState<IndexEntry[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setList(readIndex());
  useEffect(() => {
    refresh();
  }, []);

  const saveCurrent = () => {
    const thumb = docToThumb(doc, 200);
    const ok = saveDoc(doc, thumb);
    if (ok) {
      useEditor.getState().markClean();
      refresh();
      notify('已保存到本地');
    } else {
      notify('本地存储空间不足，请删除旧图纸', 'warn');
    }
  };

  const openEntry = (e: IndexEntry) => {
    if (useEditor.getState().dirty && !confirm('当前图纸有未保存修改，切换会丢失。继续？')) return;
    const d = loadDoc(e.id);
    if (d) {
      loadDocument(d);
      notify(`已打开「${d.name}」`);
      onClose();
    } else {
      notify('读取失败，文件可能已损坏', 'warn');
    }
  };

  const removeEntry = (e: IndexEntry, ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (!confirm(`删除「${e.name}」？此操作不可恢复。`)) return;
    deleteDoc(e.id);
    refresh();
    notify('已删除');
  };

  const importProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const d = parseProject(String(reader.result));
      if (!d) {
        notify('不是有效的工程文件', 'warn');
        return;
      }
      loadDocument(d);
      notify(`已导入「${d.name}」`);
      onClose();
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    setDocMetaList(
      list.map((e) => ({
        id: e.id,
        name: e.name,
        width: e.width,
        height: e.height,
        updatedAt: e.updatedAt,
        createdAt: e.updatedAt,
        thumb: e.thumb,
        paletteBrand: '',
      })),
    );
  }, [list, setDocMetaList]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div className="dialog-title">
            <h2>我的图纸</h2>
            <p>保存在本机浏览器中，不会上传；建议定期导出工程文件备份</p>
          </div>
          <button className="dialog-close" onClick={onClose}>
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="dialog-body">
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            <button className="btn primary sm" onClick={saveCurrent}>
              <IconDownload width={13} height={13} /> 保存当前图纸
            </button>
            <button className="btn sm" onClick={() => fileRef.current?.click()}>
              <IconUpload width={13} height={13} /> 导入工程文件
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importProject(f);
              }}
            />
          </div>

          {list.length ? (
            <div className="project-list">
              {list.map((e) => (
                <div key={e.id} className="project-card" onClick={() => openEntry(e)}>
                  <div className="project-thumb">
                    {e.thumb ? <img src={e.thumb} alt={e.name} /> : <IconFile width={22} height={22} />}
                  </div>
                  <div className="project-meta">
                    <b>{e.name}</b>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                      <span>
                        {e.width}×{e.height} · {new Date(e.updatedAt).toLocaleDateString('zh-CN')}
                      </span>
                      <button
                        className="icon-btn danger"
                        style={{ width: 20, height: 20 }}
                        onClick={(ev) => removeEntry(e, ev)}
                        title="删除"
                      >
                        <IconTrash width={11} height={11} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="hint-box">
              <IconFolder width={26} height={26} style={{ opacity: 0.5, marginBottom: 8 }} />
              <div>还没有保存过图纸</div>
              <div style={{ marginTop: 4 }}>点击上方「保存当前图纸」即可存到本地</div>
            </div>
          )}
        </div>

        <div className="dialog-foot">
          <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>共 {list.length} 份图纸</span>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
