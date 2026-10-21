import { AUTHOR } from '../core/announce';
import { APP_VERSION } from '../core/version';
import { IconGithub } from './Icons';

/**
 * 右下角作者角标：常驻但很淡，鼠标移上去才亮起来。
 * 点一下打开仓库；不拦截任何画布操作（只有这一小块是热区）。
 */
export default function CornerBadge() {
  return (
    <a
      className="corner-badge"
      href={AUTHOR.repo}
      target="_blank"
      rel="noreferrer"
      title={`${AUTHOR.name} 的 GitHub 仓库 · Perler Studio v${APP_VERSION}`}
    >
      <IconGithub width={13} height={13} />
      <span className="cb-name">{AUTHOR.name}</span>
      <span className="cb-ver">v{APP_VERSION}</span>
    </a>
  );
}