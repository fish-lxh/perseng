/**
 * 自定义 Icon 组件库
 *
 * 用 Material 风格填充 SVG 路径(参考 cyber-promptx.html 第 285-333 行的 `<svg fill="currentColor">` 写法),
 * 替代 lucide-react 描边图标,解决小尺寸下 strokeWidth=2 被反锯齿糊掉的问题。
 *
 * 关键差异:
 *  - lucide 默认 strokeWidth={2} 在 12-16px 下会因 1/2 像素对齐产生模糊感
 *  - 填充路径(fill="currentColor")天然清晰,边缘由 fill 决定,与字体纤细感更匹配
 *  - viewBox 都是 24x24,直接通过 className 控制尺寸
 */

import * as React from "react";

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /**
   * 图标尺寸 class,如 "w-4 h-4",默认 16px
   */
  className?: string;
  /**
   * 可选的 aria-label 用于无障碍
   */
  title?: string;
}

/**
 * 通用 SVG 容器,统一 viewBox + fill + shape-rendering + 默认尺寸。
 */
function Base({
  children,
  className = "w-4 h-4",
  title,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      shapeRendering="geometricPrecision"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/* ==================== 状态 / 提示 ==================== */

// 信息(i) - 圆形 + i
export function InfoIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
    </Base>
  );
}

// 警告(三角形)
export function AlertTriangleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
    </Base>
  );
}

// 错误 / 严重(圆形感叹号)
export function AlertCircleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
    </Base>
  );
}

// 关闭 ×
export function XIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </Base>
  );
}

/* ==================== 文件 / 文档 ==================== */

// 文件文档
export function FileTextIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </Base>
  );
}

/* ==================== 方向 / 折叠 ==================== */

// 右 chevron
export function ChevronRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8.59 8.59L12.17 12l-3.58 3.41L10 16.83l5-5-5-5z" />
    </Base>
  );
}

// 下 chevron
export function ChevronDownIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
    </Base>
  );
}

/* ==================== 上传 ==================== */

// 上传云(箭头 + 云)
export function UploadCloudIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
    </Base>
  );
}

// 上传箭头
export function UploadIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />
    </Base>
  );
}

/* ==================== 通用 ==================== */

// 复选 / 完成
export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </Base>
  );
}

// 加载 spinner(简单圆形,需配合 animate-spin)
export function LoaderIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
    </Base>
  );
}

// 钟铃
export function BellIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
    </Base>
  );
}

// 文件夹
export function FolderIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </Base>
  );
}

// 文件
export function FileIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" />
    </Base>
  );
}

// 文件夹(打开态) — 比例与 FolderIcon 略有不同,呈现"敞开"感
export function FolderOpenIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" />
    </Base>
  );
}

// 代码文件 — 文件形状 + </> 角标
export function FileCodeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM9.4 12.6L7 15l2.4 2.4 1.4-1.4L9.8 15l1-1-1.4-1.4zm5.2 0L13.2 14l1 1-1 1 1.4 1.4L17 15l-2.4-2.4z" />
    </Base>
  );
}

// 图片文件 — Material `image` 山形图样
export function FileImageIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
    </Base>
  );
}

// 垃圾桶
export function TrashIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </Base>
  );
}

// 刷新
export function RefreshIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </Base>
  );
}

// 加号
export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
    </Base>
  );
}

// 减号
export function MinusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M19 13H5v-2h14z" />
    </Base>
  );
}

// 暂停
export function PauseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </Base>
  );
}

// 停止(实心方块)
export function SquareIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6h12v12H6z" />
    </Base>
  );
}

// 发送
export function SendIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </Base>
  );
}

// 眼睛
export function EyeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </Base>
  );
}

// 消息(对话气泡)
export function MessageIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
    </Base>
  );
}

// 设置齿轮
export function SettingsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </Base>
  );
}

// 用户 / 群组
export function UsersIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </Base>
  );
}

// 商店
export function StoreIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 4H4v2h16zm0 4H4v12h16zm-8 2h-2v2H8v2h2v2h2v-2h2v-2h-2z" />
    </Base>
  );
}

// 工具(镐)
export function PickaxeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14.79 2.79L9 8.59 4.41 4 3 5.41 7.59 10l-5.79 5.79 1.41 1.41L9 11.41l5.79 5.79 1.41-1.41L10.41 10l5.79-5.79z" />
    </Base>
  );
}

// 锤子
export function HammerIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2.81 14.12L5.64 11.29c.39-.39 1.02-.39 1.41 0l1.41 1.41c.39.39.39 1.02 0 1.41L5.81 17.42c-.39.39-1.02.39-1.41 0L2.81 15.83c-.39-.39-.39-1.03 0-1.41zm14.41-9.04l-9.04 9.04 1.41 1.41 9.04-9.04-1.41-1.41z" />
    </Base>
  );
}

// 火花(AI)
export function SparklesIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
    </Base>
  );
}

// 机器人
export function BotIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h3a3 3 0 013 3v6a3 3 0 01-3 3H8a3 3 0 01-3-3v-6a3 3 0 013-3h3V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-3 8a1 1 0 100 2 1 1 0 000-2zm6 0a1 1 0 100 2 1 1 0 000-2z" />
    </Base>
  );
}

// Git 分支
export function GitBranchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 3v12M18 9a3 3 0 11-6 0 3 3 0 016 0zM6 21a3 3 0 100-6 3 3 0 000 6z" />
    </Base>
  );
}

// 外部链接箭头
export function ExternalLinkIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zm-9 5H3v13h13v-2H5V8z" />
    </Base>
  );
}

// 笑脸
export function SmileIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
    </Base>
  );
}

// 保存
export function SaveIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z" />
    </Base>
  );
}

// 文件夹加号
export function FolderPlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M22 6v12c0 1.11-.89 2-2 2H4c-1.11 0-2-.89-2-2V6c0-1.11.89-2 2-2h4l2 2h8c1.11 0 2 .89 2 2zm-7 4h-2v2h-2v2h2v2h2v-2h2v-2h-2v-2z" />
    </Base>
  );
}

// 文件夹减号
export function FolderMinusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M22 6v12c0 1.11-.89 2-2 2H4c-1.11 0-2-.89-2-2V6c0-1.11.89-2 2-2h4l2 2h8c1.11 0 2 .89 2 2zM8 14v2h8v-2H8z" />
    </Base>
  );
}

// 文件加号
export function FilePlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 14h-3v3h-2v-3H8v-2h3v-3h2v3h3v2zm-3-9V3.5L18.5 9H13z" />
    </Base>
  );
}

// 圆形 spinner
export function SpinnerIcon({ className = "", ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      className={className}
      shapeRendering="geometricPrecision"
      {...rest}
    >
      <path d="M12 3a9 9 0 109 9" />
    </svg>
  );
}
