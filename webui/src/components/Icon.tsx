import type { CSSProperties, JSX } from 'react'

/**
 * 应用统一图标系统（lucide 线性风格，24 viewBox / stroke 2 / currentColor）。
 * 全应用禁止使用 emoji 作界面图标；一律走 <Icon name="…" />。
 */
export type IconName =
  | 'plus'
  | 'x'
  | 'check'
  | 'check-circle'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevrons-left'
  | 'chevrons-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'folder'
  | 'folder-open'
  | 'folder-plus'
  | 'file'
  | 'file-text'
  | 'file-plus'
  | 'file-input'
  | 'pencil'
  | 'pen-line'
  | 'book-open'
  | 'search'
  | 'trash'
  | 'wrench'
  | 'sun'
  | 'moon'
  | 'settings'
  | 'command'
  | 'download'
  | 'upload'
  | 'chart'
  | 'list-checks'
  | 'scale'
  | 'refresh'
  | 'log-out'
  | 'paperclip'
  | 'message'
  | 'square-pen'
  | 'user'
  | 'git-branch'
  | 'map-pin'
  | 'flag'
  | 'package'
  | 'sparkles'
  | 'panel-right'
  | 'panel-left'
  | 'clock'
  | 'home'
  | 'grip'
  | 'network'
  | 'focus'
  | 'chevron-left'

const PATHS: Record<IconName, JSX.Element> = {
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevrons-left': <path d="m11 17-5-5 5-5m7 10-5-5 5-5" />,
  'chevrons-right': <path d="m6 17 5-5-5-5m7 10 5-5-5-5" />,
  'arrow-up': <path d="M12 19V5m-7 7 7-7 7 7" />,
  'arrow-down': <path d="M12 5v14m7-7-7 7-7-7" />,
  'arrow-left': <path d="M19 12H5m7 7-7-7 7-7" />,
  'arrow-right': <path d="M5 12h14m-7-7 7 7-7 7" />,
  folder: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
  'folder-open': <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2c.33.5.89.8 1.49.8H18a2 2 0 0 1 2 2v2" />,
  'folder-plus': (
    <>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M12 10v6M9 13h6" />
    </>
  ),
  file: <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v5h5" />,
  'file-text': (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v5h5" />
      <path d="M10 9H8m8 4H8m8 4H8" />
    </>
  ),
  'file-plus': (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v5h5" />
      <path d="M12 12v6M9 15h6" />
    </>
  ),
  'file-input': (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v5h5" />
      <path d="M9 13h6m-3-3v6" />
    </>
  ),
  pencil: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Zm-2 5 4 4" />,
  'pen-line': <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  'book-open': <path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6m4-6v6" />
    </>
  ),
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.24a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.24a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.24a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.24a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  command: <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />,
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m14-5-5 5-5-5m5 5V3" />,
  upload: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-7 5-5 5 5m-5-5v12" />,
  chart: <path d="M3 3v16a2 2 0 0 0 2 2h16M18 17V9m-5 8V5M8 17v-3" />,
  'list-checks': <path d="m3 17 2 2 4-4m-6-8 2 2 4-4M13 6h8m-8 6h8m-8 6h8" />,
  scale: <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1m2.5 4h-13M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />,
  refresh: <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5m-13 6a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M3 21v-5h5" />,
  'log-out': <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" />,
  paperclip: <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  'square-pen': <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7m-2.4-8.4a2 2 0 0 1 2.8 2.8L12 15l-4 1 1-4Z" />,
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  'git-branch': (
    <>
      <path d="M6 3v12" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  'map-pin': (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  flag: <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zm0 7v-7" />,
  package: <path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Zm-17.7 0 8.7 5 8.7-5M12 22V12" />,
  sparkles: <path d="M9.94 15.5a2 2 0 0 0-1.44-1.44L2.37 12.5a.5.5 0 0 1 0-.97l6.13-1.57A2 2 0 0 0 9.94 8.5l1.56-6.14a.5.5 0 0 1 .97 0l1.57 6.14a2 2 0 0 0 1.43 1.43l6.14 1.57a.5.5 0 0 1 0 .97l-6.14 1.56a2 2 0 0 0-1.43 1.44l-1.57 6.13a.5.5 0 0 1-.97 0zM20 3v4m2-2h-4M4 17v2m1-1H3" />,
  'panel-right': (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </>
  ),
  'panel-left': (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  home: <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8m-6-11a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  grip: <path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01M9.5 5.5a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0Zm0 7a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0Zm0 7a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0Zm6-14a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0Zm0 7a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0Zm0 7a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0Z" />,
  network: (
    <>
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8" />
    </>
  ),
  focus: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    </>
  ),
  'chevron-left': <path d="m15 18-6-6 6-6" />,
}

type IconProps = {
  name: IconName
  /** 渲染尺寸（px），默认 16 */
  size?: number
  strokeWidth?: number
  className?: string
  style?: CSSProperties
}

export function Icon({ name, size = 16, strokeWidth = 2, className, style }: IconProps) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
