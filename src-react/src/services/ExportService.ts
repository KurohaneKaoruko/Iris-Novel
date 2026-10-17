/**
 * 作品导出服务：合并 stories/ 章节（可选附 outline/concept 资料），
 * 组装为 md / txt / html 三种纯文本格式。
 *
 * 双端保存策略（经 transport 层）：
 * - 桌面端：写入作品目录 exports/ 下（writeText）。
 * - 浏览器端：saveFileBrowser 触发浏览器下载（作品目录在服务端主机上，
 *   浏览器拿不到本地路径，下载是最自然的等效行为）。
 */

import { chapterService } from './ChapterService'
import { readText, writeText } from '../tauri'
import { callCommand, isTauriApp, saveFileBrowser } from '../transport'
import type { ExportFormat, ExportOptions } from '../components/Export'

type TreeItem = {
  name: string
  path: string
  kind: 'file' | 'dir'
  children?: TreeItem[]
}

export type ExportResult = {
  fileName: string
  /** 桌面端为作品内相对路径；浏览器端为 null（已触发下载） */
  savedTo: string | null
  downloaded: boolean
  chapterCount: number
  totalChars: number
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^\|.*\|$/gm, (line) => line.replace(/\|/g, ' ').trim())
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1（$2）')
    .trim()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function markdownTitleToHtml(md: string): string {
  // 章节标题（# 开头）转 h2，其余段落转 p
  return md
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
      if (heading) {
        const level = Math.min(heading[1].length + 1, 6)
        return `<h${level}>${escapeHtml(heading[2])}</h${level}>`
      }
      return `<p>${escapeHtml(trimmed).replace(/\n/g, '<br/>')}</p>`
    })
    .filter(Boolean)
    .join('\n')
}

function buildHtmlDocument(title: string, author: string | undefined, bodyMd: string): string {
  const authorLine = author ? `\n    <meta name="author" content="${escapeHtml(author)}" />` : ''
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>${authorLine}
    <style>
      body { max-width: 42em; margin: 2rem auto; padding: 0 1rem;
        font-family: Georgia, "Noto Serif CJK SC", serif; line-height: 1.8; }
      h1 { text-align: center; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
${markdownTitleToHtml(bodyMd)}
  </body>
</html>
`
}

async function listMdFiles(dir: string): Promise<string[]> {
  try {
    const tree = await callCommand<TreeItem>('list_workspace_tree', { maxDepth: 2 })
    const target = tree.children?.find((c) => c.name === dir && c.kind === 'dir')
    if (!target?.children) return []
    return target.children
      .filter((c) => c.kind === 'file' && c.name.endsWith('.md'))
      .map((c) => c.path)
      .sort()
  } catch {
    return []
  }
}

async function collectMaterial(dir: string, label: string): Promise<string> {
  const files = await listMdFiles(dir)
  if (files.length === 0) return ''
  const parts: string[] = [`\n\n---\n\n# ${label}\n`]
  for (const f of files) {
    try {
      const raw = await readText(f)
      const name = f.split('/').pop() ?? f
      parts.push(`\n## ${name.replace(/\.md$/, '')}\n\n${raw.trim()}\n`)
    } catch {
      // 单文件读取失败不阻断导出
    }
  }
  return parts.join('')
}

export async function exportWork(options: ExportOptions): Promise<ExportResult> {
  const chapters = await chapterService.listChapters()
  if (chapters.length === 0) {
    throw new Error('no chapters to export (stories/ is empty)')
  }

  const title = options.title?.trim() || 'novel'
  const chunks: string[] = []

  if (options.includeMetadata) {
    const author = options.author?.trim()
    chunks.push(`# ${title}\n${author ? `\n> ${author}\n` : ''}\n---\n`)
  }

  for (const ch of chapters) {
    const raw = await readText(ch.filePath)
    chunks.push(`\n\n${raw.trim()}\n`)
  }

  if (options.includeOutline) {
    chunks.push(await collectMaterial('outline', '大纲'))
  }
  if (options.includeCharacters) {
    chunks.push(await collectMaterial('concept', '设定资料'))
  }

  const bodyMd = chunks.join('')
  const totalChars = bodyMd.replace(/\s/g, '').length
  const safeName = title.replace(/[\\/:*?"<>|]/g, '_')

  let content: string
  let fileName: string
  let mime: string
  const format: ExportFormat = options.format
  if (format === 'txt') {
    content = stripMarkdown(bodyMd)
    fileName = `${safeName}.txt`
    mime = 'text/plain'
  } else if (format === 'html') {
    content = buildHtmlDocument(title, options.author, bodyMd)
    fileName = `${safeName}.html`
    mime = 'text/html'
  } else {
    content = bodyMd.trim() + '\n'
    fileName = `${safeName}.md`
    mime = 'text/markdown'
  }

  if (isTauriApp()) {
    const { createDir } = await import('../tauri')
    try {
      await createDir('exports')
    } catch {
      // 已存在或不可创建（如只读工作区）时由后续 writeText 报错
    }
    const rel = `exports/${fileName}`
    await writeText(rel, content)
    return { fileName, savedTo: rel, downloaded: false, chapterCount: chapters.length, totalChars }
  }
  saveFileBrowser(fileName, content, mime)
  return { fileName, savedTo: null, downloaded: true, chapterCount: chapters.length, totalChars }
}
