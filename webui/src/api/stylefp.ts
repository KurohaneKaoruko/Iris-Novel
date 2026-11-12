/**
 * 文风指纹持久化：存 concept/style-fingerprint.json，随工程走。
 * 工坊学习一次，全工程共用（任务队列逐章生成、工坊各工具都能带上）。
 */
import { readText, writeText } from './backend'
import {
  fingerprintText,
  parseStyleFingerprint,
  buildFingerprintPrompt,
  type StyleFingerprint,
} from './studio'

export type { StyleFingerprint }
export { fingerprintText, parseStyleFingerprint, buildFingerprintPrompt }

const FP_PATH = 'concept/style-fingerprint.json'

/** 读取工程文风指纹（无文件/解析失败/全空 → null） */
export async function loadStyleFingerprint(): Promise<StyleFingerprint | null> {
  try {
    const raw = await readText(FP_PATH)
    return parseStyleFingerprint(raw)
  } catch {
    return null
  }
}

/** 保存工程文风指纹（传 null 清空为空对象）；无打开工程时抛错由调用方决定是否吞掉 */
export async function saveStyleFingerprint(fp: StyleFingerprint | null): Promise<void> {
  const body = fp ? JSON.stringify(fp, null, 2) + '\n' : '{}\n'
  await writeText(FP_PATH, body)
}
