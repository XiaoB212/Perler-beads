import { useState } from 'react';
import { AUTHOR, NOTICE, markNoticeSeen } from '../core/announce';
import { GUIDE } from '../core/guide';
import { APP_BUILD, APP_VERSION } from '../core/version';
import { IconBook, IconClose, IconGithub, IconSparkle } from './Icons';

interface Props {
  /** 打开时先看哪一页：公告 or 手册 */
  tab?: 'notice' | 'guide';
  onClose: () => void;
}

/**
 * 开局弹窗：公告 + 新手手册。
 * 公告只在「这个版本第一次打开」时自动出现；关掉或点「不再提示」都记下来，
 * 之后从设置页「关于 → 更新公告 / 新手教程」还能翻出来。
 */
export default function WelcomeDialog({ tab = 'notice', onClose }: Props) {
  const [page, setPage] = useState<'notice' | 'guide'>(tab);

  const dismiss = () => {
    markNoticeSeen();
    onClose();
  };

  return (
    <div className="overlay" onClick={dismiss}>
      <div className="dialog welcome" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div className="dialog-title">
            <h2>
              <IconSparkle width={16} height={16} /> 欢迎使用 Perler Studio
            </h2>
            <p>
              拼豆图纸工作台 · v{APP_VERSION}（{APP_BUILD}）· 纯本地运行，图片不上传
            </p>
          </div>
          <button className="dialog-close" onClick={dismiss} title="关闭（不再自动弹出）">
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="welcome-tabs">
          <button className={'welcome-tab' + (page === 'notice' ? ' on' : '')} onClick={() => setPage('notice')}>
            <IconSparkle width={13} height={13} /> 更新公告
          </button>
          <button className={'welcome-tab' + (page === 'guide' ? ' on' : '')} onClick={() => setPage('guide')}>
            <IconBook width={13} height={13} /> 新手手册
          </button>
        </div>

        <div className="dialog-body welcome-body">
          {page === 'notice' ? (
            <>
              <div className="author-card">
                <span className="author-avatar">X</span>
                <div className="author-main">
                  <b>作者：{AUTHOR.name}</b>
                  <span>一个人做的拼豆工具，问题、建议、想加的功能都可以在 GitHub 上提。</span>
                </div>
                <a className="author-link" href={AUTHOR.repo} target="_blank" rel="noreferrer">
                  <IconGithub width={13} height={13} /> 仓库
                </a>
              </div>

              <p className="notice-lead">{NOTICE.lead}</p>

              <ul className="notice-list">
                {NOTICE.items.map((it) => (
                  <li key={it.title}>
                    <b>{it.title}</b>
                    <span>{it.text}</span>
                  </li>
                ))}
              </ul>

              <p className="notice-foot">
                <a href={AUTHOR.site} target="_blank" rel="noreferrer">
                  在线版
                </a>
                打开就是最新版；
                <a href={AUTHOR.home} target="_blank" rel="noreferrer">
                  作者主页
                </a>
                有别的作品。
              </p>
            </>
          ) : (
            <div className="guide-list">
              {GUIDE.map((sec, i) => (
                <section className="guide-sec" key={sec.title}>
                  <h3>
                    <span className="guide-num">{i + 1}</span>
                    {sec.title}
                  </h3>
                  <p className="guide-intro">{sec.intro}</p>
                  <ul>
                    {sec.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="dialog-foot">
          <button className="btn ghost" onClick={dismiss} title="记住这个版本，下次不再自动弹出">
            不再提示
          </button>
          <div className="spacer" />
          {page === 'notice' ? (
            <>
              <button className="btn" onClick={() => setPage('guide')}>
                <IconBook width={13} height={13} /> 看新手手册
              </button>
              <button className="btn primary" onClick={dismiss}>
                开始使用
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setPage('notice')}>
                回到公告
              </button>
              <button className="btn primary" onClick={dismiss}>
                开始使用
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}