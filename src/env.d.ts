/// <reference types="vite/client" />

/** 构建时由 vite.config.ts 的 define 注入：package.json 里的版本号 */
declare const __APP_VERSION__: string;

/** 构建时由 vite.config.ts 的 define 注入：构建日期（YYYY-MM-DD） */
declare const __APP_BUILD__: string;