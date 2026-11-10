/**
 * 自动检测前台视频窗口（可选能力）：
 * - Windows：读 user32 前台窗口标题 + 进程名；
 * - 其他平台：明确返回 unsupported，请使用手动输入或导入文本。
 * 手动模式在任何平台都可用，且不依赖此模块。
 */
import { cleanTitle, isVideoProc, readForeground, shouldSkipTitle } from './windows.mjs'

export { cleanTitle, isVideoProc, shouldSkipTitle }

export function watcherSupported() {
  return process.platform === 'win32'
}

export function platformLabel() {
  if (process.platform === 'win32') return 'Windows'
  if (process.platform === 'darwin') return 'macOS'
  return process.platform
}

/**
 * 读取一次前台窗口并给出判定（不做任何网络/模型调用）。
 * @returns {Promise<{supported:boolean, foreground:object|null, decision:string, title:string}>}
 */
export async function detectForeground(cfg, dataDir, options = {}) {
  if (!watcherSupported()) {
    return { supported: false, foreground: null, decision: 'watch-unsupported', title: '' }
  }
  const fg = await readForeground(dataDir, { timeoutMs: options.timeoutMs })
  if (!fg) return { supported: true, foreground: null, decision: 'window-error', title: '' }
  const raw = fg.title || ''
  const cleaned = cleanTitle(raw)
  const foreground = { proc: fg.proc, raw, cleaned, at: Date.now() }
  if (!isVideoProc(fg.proc, cfg)) return { supported: true, foreground, decision: 'non-video', title: '' }
  if (shouldSkipTitle(cleaned, cfg.titleMinLen)) return { supported: true, foreground, decision: 'ignored-window', title: '' }
  return { supported: true, foreground, decision: 'detected', title: cleaned }
}
