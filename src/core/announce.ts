/**
 * 公告与作者信息。
 *
 * 公告只在「这个版本还没弹过」时自动弹一次，用户点「不再提示」或者关掉之后
 * 记在 localStorage 里；之后可以从设置页「关于 → 更新公告 / 新手教程」再打开。
 */

import { APP_VERSION, APP_BUILD } from './version';

export interface Author {
  name: string;
  repo: string;
  site: string;
  home: string;
}

export const AUTHOR: Author = {
  name: 'XiaoB212',
  repo: 'https://github.com/XiaoB212/Perler-beads',
  site: 'https://xiaob212.github.io/Perler-beads/',
  home: 'https://github.com/XiaoB212',
};

export interface NoticeItem {
  title: string;
  text: string;
}

export interface Notice {
  version: string;
  build: string;
  headline: string;
  lead: string;
  items: NoticeItem[];
}

/** 当前版本的公告：设置页「最近更新」和开局弹窗共用这一份文案 */
export const NOTICE: Notice = {
  version: APP_VERSION,
  build: APP_BUILD,
  headline: '公告 · v' + APP_VERSION,
  lead: '这是一个纯本地运行的拼豆图纸工具：图片不上传、图纸存在你自己的浏览器里。',
  items: [
    {
      title: '图纸预览能放大了',
      text: '滚轮以指针为中心缩放、`适应` / `最大` 一键切、Alt 拖拽平移。放到 8 倍一格一格抠，悬停会显示「第几列第几行 · 色号」。',
    },
    {
      title: '工具条能自己排顺序',
      text: '设置 → 功能列表顺序，上下移就行，顺序记住；工具条里多了「抠图 / 魔法棒」，点一下直接进去抠。',
    },
    {
      title: '新手手册',
      text: '7 节 24 条，从「一分钟出第一张图」到「你的数据存在哪」，设置页随时能打开。',
    },
    {
      title: '右下角加了作者角标',
      text: 'XiaoB212 + 版本号，点开是 GitHub 仓库 —— 顺便可以确认线上跑的是不是最新一版。',
    },
  ],
};

const SEEN_KEY = 'perler-studio:notice-seen';

/** 这个版本是否已经看过公告（看过就不再自动弹） */
export function noticeSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === APP_VERSION;
  } catch {
    return false;
  }
}

export function markNoticeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
  } catch {
    /* 隐私模式写不了，就当没看过，下次还会弹 */
  }
}

/** 设置页里「重新打开时会再弹一次公告」 */
export function clearNoticeSeen(): void {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* 忽略 */
  }
}