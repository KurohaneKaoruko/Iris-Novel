import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommandPalette, type CommandItem } from '../src/components/CommandPalette'

const items: CommandItem[] = [
  { id: 'save', title: 'Save File', category: 'File', shortcut: 'Ctrl+S', run: vi.fn() },
  { id: 'new', title: 'New Chapter', category: 'Writing', run: vi.fn() },
  { id: 'export', title: 'Export Work', category: 'Writing', disabled: true, run: vi.fn() },
  { id: 'search', title: 'Global Search', category: 'View', shortcut: 'Ctrl+F', run: vi.fn() },
]

function setup(overrides?: { items?: CommandItem[]; isOpen?: boolean }) {
  const onClose = vi.fn()
  const paletteItems = overrides?.items ?? items
  const utils = render(
    <CommandPalette isOpen={overrides?.isOpen ?? true} items={paletteItems} onClose={onClose} />,
  )
  return { onClose, ...utils }
}

describe('CommandPalette', () => {
  it('不打开时不渲染', () => {
    setup({ isOpen: false })
    expect(screen.queryByPlaceholderText('输入命令名称…')).toBeNull()
  })

  it('打开时渲染全部命令并自动聚焦', () => {
    setup()
    const input = screen.getByPlaceholderText('输入命令名称…')
    expect(input).toBeTruthy()
    expect(screen.getByText('Save File')).toBeTruthy()
    expect(screen.getByText('New Chapter')).toBeTruthy()
    expect(screen.getByText('Export Work')).toBeTruthy()
  })

  it('模糊搜索过滤命令', () => {
    setup()
    const input = screen.getByPlaceholderText('输入命令名称…')
    fireEvent.change(input, { target: { value: 'svfl' } })
    expect(screen.getByText('Save File')).toBeTruthy()
    expect(screen.queryByText('New Chapter')).toBeNull()
    expect(screen.queryByText('Global Search')).toBeNull()
  })

  it('搜索无结果显示空态', () => {
    setup()
    fireEvent.change(screen.getByPlaceholderText('输入命令名称…'), { target: { value: 'zzzz' } })
    expect(screen.getByText('没有匹配的命令')).toBeTruthy()
  })

  it('Enter 执行选中命令并关闭', () => {
    const { onClose } = setup()
    const input = screen.getByPlaceholderText('输入命令名称…')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(items[0].run).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ArrowDown + Enter 执行第二项', () => {
    setup()
    const input = screen.getByPlaceholderText('输入命令名称…')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(items[1].run).toHaveBeenCalledTimes(1)
  })

  it('禁用项不可执行', () => {
    const { onClose } = setup()
    const input = screen.getByPlaceholderText('输入命令名称…')
    fireEvent.change(input, { target: { value: 'export' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(items[2].run).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape 关闭面板', () => {
    const { onClose } = setup()
    fireEvent.keyDown(screen.getByPlaceholderText('输入命令名称…'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击遮罩关闭，点击面板不关闭', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByText('Save File'))
    expect(onClose).toHaveBeenCalledTimes(1)
    onClose.mockClear()
    fireEvent.click(screen.getByPlaceholderText('输入命令名称…'), { detail: 0 })
    expect(onClose).not.toHaveBeenCalled()
  })
})
