/**
 * 程序化封面：由作品标题确定性派生封面色板与构图。
 * 同一标题恒定输出同款封面，无需外部图片资源。
 */

export type CoverArt = {
  /** 封面主体渐变（从亮到暗） */
  from: string
  to: string
  /** 叠加光斑 */
  glowA: string
  glowB: string
  /** 标题首字（1-2 字） */
  initials: string
}

/** FNV-1a 32 位哈希（对 Unicode 逐码元） */
export function hashTitle(title: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < title.length; i += 1) {
    h ^= title.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function initialsOf(title: string): string {
  const compact = title.replace(/\s+/g, '')
  if (!compact) return '书'
  // 中文/日文取前两字；纯拉丁取词首字母（最多两位）
  if (/[\u3400-\u9fff\u3040-\u30ff\uf900-\ufaff]/.test(compact)) {
    return compact.slice(0, 2)
  }
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return compact.slice(0, 2).toUpperCase()
}

/**
 * 由标题生成封面色板。
 * 色相取哈希不同位段，保证同一标题稳定；明度/饱和度固定以保证深色主题下可读。
 */
export function coverFor(title: string): CoverArt {
  const h = hashTitle(title || '未命名')
  const hue1 = h % 360
  const hue2 = (h >>> 9) % 360
  const hue3 = (h >>> 17) % 360
  return {
    from: `hsl(${hue1} 46% 36%)`,
    to: `hsl(${hue2} 52% 15%)`,
    glowA: `hsla(${hue1} 82% 72% / 0.38)`,
    glowB: `hsla(${hue3} 74% 62% / 0.3)`,
    initials: initialsOf(title),
  }
}

/** 内联样式：封面渐变底 */
export function coverStyle(art: CoverArt): Record<string, string> {
  return {
    background: `linear-gradient(155deg, ${art.from} 0%, ${art.to} 100%)`,
  }
}
