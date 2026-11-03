import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
}))

import { callCommand } from '../src/transport'
import { BookAnalyzer } from '../src/components/BookAnalyzer'

const invokeMock = vi.mocked(callCommand)

const fakeReport = {
  title: '测试书',
  author: null,
  source: 'original',
  structure: { type: 'linear', acts: [], pacing: 'fast', audience: 'male' },
  plot_arcs: [],
  rhythm: {
    average_chapter_length: 2400,
    conflict_density: 'high',
    turning_points: [{ chapter: 5, type: 'major_turn', description: 'core conflict escalates' }],
    chapter_hooks: ['suspense'],
  },
  climax_points: [],
  power_moments: [{ chapter: 3, type: 'face_slap', description: 'protagonist wins', frequency: 'high' }],
  characters: [
    { name: '主角', role: 'protagonist', archetype: 'growth', growth: 'weak to strong', main_moments: [], relationships: [] },
  ],
  character_relationships: [],
  world_settings: [{ name: '大陆', category: 'geography', importance: 'core', description: 'east continent' }],
  power_system: [],
  techniques: [{ category: 'dialogue', technique: 'provocation', example: 'taunt', application: 'build tension' }],
  summary: 'A growth novel.',
  learnable_points: ['build tension'],
}

function setup(open = true) {
  const onClose = vi.fn()
  const utils = render(<BookAnalyzer isOpen={open} onClose={onClose} />)
  return { onClose, ...utils }
}

describe('BookAnalyzer', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('关闭时不渲染', () => {
    setup(false)
    expect(screen.queryByText('拆书分析')).toBeNull()
  })

  it('无内容时按钮禁用', () => {
    setup()
    const fullBtn = screen.getByText('完整分析')
    expect((fullBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('完整分析调用 book_analyze 并渲染结果分区', async () => {
    invokeMock.mockResolvedValue(fakeReport)
    setup()
    fireEvent.change(screen.getByPlaceholderText('粘贴要分析的正文…'), { target: { value: '第一章 起点\n正文内容' } })
    fireEvent.click(screen.getByText('完整分析'))
    await waitFor(() => {
      expect(screen.getByText('A growth novel.')).toBeTruthy()
    })
    expect(invokeMock).toHaveBeenCalledWith('book_analyze', {
      content: '第一章 起点\n正文内容',
      title: '未命名作品',
    })
    // 各分区标题
    expect(screen.getByText('结构分析')).toBeTruthy()
    expect(screen.getByText('节奏分析')).toBeTruthy()
    expect(screen.getByText('爽点分布')).toBeTruthy()
    expect(screen.getByText('人物分析')).toBeTruthy()
    expect(screen.getByText('世界观设定')).toBeTruthy()
    expect(screen.getByText('写作技法')).toBeTruthy()
    expect(screen.getByText('可借鉴要点')).toBeTruthy()
  })

  it('仅提取技法调用 book_extract_techniques', async () => {
    invokeMock.mockResolvedValue(fakeReport.techniques)
    setup()
    fireEvent.change(screen.getByPlaceholderText('粘贴要分析的正文…'), { target: { value: '冷笑 嘲讽' } })
    fireEvent.click(screen.getByText('仅提取技法'))
    await waitFor(() => {
      expect(screen.getByText('写作技法')).toBeTruthy()
    })
    expect(invokeMock).toHaveBeenCalledWith('book_extract_techniques', { content: '冷笑 嘲讽' })
  })

  it('分析失败显示错误信息', async () => {
    invokeMock.mockRejectedValue(new Error('backend boom'))
    setup()
    fireEvent.change(screen.getByPlaceholderText('粘贴要分析的正文…'), { target: { value: '内容' } })
    fireEvent.click(screen.getByText('完整分析'))
    await waitFor(() => {
      expect(screen.getByText('backend boom')).toBeTruthy()
    })
  })

  it('导入文件填充内容与书名', async () => {
    setup()
    const file = new File(['第一章 导入\n文本'], '我的小说.txt', { type: 'text/plain' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    // file input 是 hidden，通过 onChange 直接触发
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect((screen.getByPlaceholderText('粘贴要分析的正文…') as HTMLTextAreaElement).value).toContain('导入')
    })
    expect((screen.getByPlaceholderText('书名（可选）') as HTMLInputElement).value).toBe('我的小说')
  })

  it('字数统计实时更新', () => {
    setup()
    fireEvent.change(screen.getByPlaceholderText('粘贴要分析的正文…'), { target: { value: '你好世界' } })
    expect(screen.getByText('4 字')).toBeTruthy()
  })
})
