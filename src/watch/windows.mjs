/**
 * Windows 前台窗口读取：通过 PowerShell 调 user32.dll，结果写 UTF-8 文件再读回，
 * 规避 PowerShell stdout 的 GBK/UTF-8 编码差异（中文标题必须这样处理）。
 * 仅 Windows 支持；其他平台由 watch/index.mjs 返回 unsupported。
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const POLL_PS1 = [
  'param([string]$OutFile)',
  'Add-Type -ErrorAction SilentlyContinue @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public static class FGWin {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '}',
  '"@',
  '$h = [FGWin]::GetForegroundWindow()',
  '$sb = New-Object System.Text.StringBuilder 512',
  '[void][FGWin]::GetWindowText($h, $sb, 512)',
  '$procId = 0',
  '[void][FGWin]::GetWindowThreadProcessId($h, [ref]$procId)',
  '$pname = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName',
  '$nl = [string][char]10',
  '$text = "TITLE=" + $sb.ToString() + $nl + "PROC=" + $pname',
  '[System.IO.File]::WriteAllText($OutFile, $text, (New-Object System.Text.UTF8Encoding($false)))',
  '',
].join('\n')

export const TITLE_SUFFIXES = [
  ' - Google Chrome', ' - Microsoft Edge', ' - Mozilla Firefox', ' - Chromium', ' - Opera',
  ' - Brave', ' - Internet Explorer', ' - 谷歌浏览器', ' - 微软 Edge', ' - 火狐浏览器',
  '_哔哩哔哩_bilibili', '_哔哩哔哩', ' - 哔哩哔哩', ' - bilibili', '-bilibili', ' - Bilibili',
  ' - YouTube', ' - 优酷', ' - 爱奇艺', ' - 腾讯视频', ' - 芒果TV', ' - 抖音', ' - 快手', ' - Quark',
]

export function cleanTitle(raw) {
  let t = String(raw || '').trim()
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of TITLE_SUFFIXES) {
      if (t.endsWith(suffix)) {
        t = t.slice(0, -suffix.length).trim()
        changed = true
      }
    }
  }
  return t
}

export function isVideoProc(proc, cfg) {
  const name = String(proc || '').trim().toLowerCase().replace(/\.exe$/i, '')
  if (!name) return false
  const pool = [].concat(cfg?.watch?.browsers ?? [], cfg?.watch?.clients ?? [])
  return pool.some((p) => String(p).trim().toLowerCase().replace(/\.exe$/i, '') === name)
}

const SKIP_PATTERNS = [
  /^(哔哩哔哩|bilibili)/i,
  /^(首页|搜索|热搜|热门|动态|消息|我的|直播|番剧|国创|放映厅|专栏|活动|会员购|下载客户端|新标签页|新建标签页)/,
  /^https?:\/\//i,
  /^(about:blank|chrome:\/\/|edge:\/\/|file:\/\/)/i,
]

export function shouldSkipTitle(title, minLen = 4) {
  const t = String(title || '').trim()
  if (t.length < minLen) return true
  if (SKIP_PATTERNS.some((re) => re.test(t))) return true
  if (t.length <= 12 && t.startsWith('哔哩哔哩')) return true
  return false
}

function ensureScript(dataDir) {
  const p = join(dataDir, 'foreground.ps1')
  if (!existsSync(p)) writeFileSync(p, POLL_PS1, 'utf8')
  return p
}

/** @returns {Promise<{title:string, proc:string}|null>} */
export async function readForeground(dataDir, options = {}) {
  if (process.platform !== 'win32') return null
  const timeoutMs = options.timeoutMs ?? 8000
  const script = ensureScript(dataDir)
  const outFile = join(dataDir, 'foreground-out-' + process.pid + '-' + Date.now() + '.txt')
  try {
    await execFileP('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-OutFile', outFile,
    ], { timeout: timeoutMs, windowsHide: true })
    const text = readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '')
    const title = (text.match(/^TITLE=(.*)$/m)?.[1] ?? '').trim()
    const proc = (text.match(/^PROC=(.*)$/m)?.[1] ?? '').trim()
    if (!title && !proc) return null
    return { title, proc }
  } catch {
    return null
  } finally {
    try { unlinkSync(outFile) } catch { /* 忽略 */ }
  }
}
