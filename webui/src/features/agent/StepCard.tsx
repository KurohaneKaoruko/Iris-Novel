import { useState } from 'react'
import type { AgentStep } from '../../hooks/useChat'
import { Icon, type IconName } from '../../components/Icon'

const TOOL_LABELS: Record<string, { label: string; icon: IconName }> = {
  fs_list_dir: { label: '列出目录', icon: 'folder-open' },
  fs_read_text: { label: '读取文件', icon: 'book-open' },
  fs_write_text: { label: '写入文件', icon: 'pen-line' },
  fs_exists: { label: '检查路径', icon: 'search' },
  fs_create_dir: { label: '创建目录', icon: 'folder-plus' },
  fs_delete: { label: '删除', icon: 'trash' },
  fs_rename: { label: '重命名', icon: 'pencil' },
}

/** 消息流内的工具执行步骤卡（Cline 式）：默认折叠，点击展开参数与观察 */
export function StepCard({ step, onOpenFile }: { step: AgentStep; onOpenFile?: (p: string) => void }) {
  const [open, setOpen] = useState(false)
  const meta = TOOL_LABELS[step.tool] ?? { label: step.tool, icon: 'wrench' as IconName }
  const running = step.phase === 'start'
  const okDone = step.phase !== 'start' && step.ok !== false
  const filePath = step.writePath ?? step.readPath

  return (
    <div className={`step-card ${running ? 'running' : okDone ? 'ok' : 'fail'}`}>
      <button className="step-head" onClick={() => setOpen((v) => !v)}>
        <span className="step-icon">
          {running ? <span className="step-spinner" /> : <Icon name={meta.icon} size={14} />}
        </span>
        <span className="step-label">
          {meta.label}
          {filePath ? <code className="step-path">{filePath}</code> : null}
          {step.readLines !== undefined ? <span className="step-meta">{step.readLines} 行</span> : null}
        </span>
        {step.durationMs !== undefined ? <span className="step-ms">{formatMs(step.durationMs)}</span> : null}
        <span className={`step-caret ${open ? 'open' : ''}`}><Icon name="chevron-right" size={12} /></span>
      </button>
      {open ? (
        <div className="step-body">
          {step.inputPreview ? (
            <Section title="参数">
              <pre>{step.inputPreview}</pre>
            </Section>
          ) : null}
          {step.listItems ? (
            <Section title={`目录（${step.listItems.length} 项）`}>
              <div className="step-list">
                {step.listItems.map((it, i) => (
                  <span key={i} className={it.kind === 'dir' ? 'is-dir' : ''}>
                    <Icon name={it.kind === 'dir' ? 'folder' : 'file'} size={12} /> {it.name}
                  </span>
                ))}
              </div>
            </Section>
          ) : null}
          {step.readPreview ? (
            <Section title="内容预览">
              <pre>{step.readPreview}</pre>
            </Section>
          ) : null}
          {step.observationPreview && !step.listItems && !step.readPreview ? (
            <Section title="结果">
              <pre>{step.observationPreview}</pre>
            </Section>
          ) : null}
          {filePath && onOpenFile ? (
            <button className="step-open" onClick={() => onOpenFile(filePath)}>
              在面板中打开 <Icon name="arrow-right" size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="step-section">
      <div className="step-section-title">{title}</div>
      {children}
    </div>
  )
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
