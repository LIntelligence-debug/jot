/**
 * 简单日志：写 data/web.log，同时提供内存环形缓冲给 Web UI 显示。
 * 纯本地文件，不上报任何地方。
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MAX_LOG_BYTES = 2 * 1024 * 1024
const MAX_BUFFER = 300

/** @param {string} dataDir */
export function createLogger(dataDir) {
  const file = join(dataDir, 'web.log')
  const buffer = []
  try { mkdirSync(dataDir, { recursive: true }) } catch { /* 忽略 */ }

  function rotate() {
    try {
      if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) renameSync(file, file + '.1')
    } catch { /* 忽略 */ }
  }

  function log(level, message) {
    const entry = { at: Date.now(), level: String(level || 'info'), message: String(message) }
    buffer.push(entry)
    if (buffer.length > MAX_BUFFER) buffer.shift()
    try {
      rotate()
      appendFileSync(file, '[' + new Date().toISOString() + '] [' + entry.level + '] ' + entry.message + '\n', 'utf8')
    } catch { /* 日志失败不影响主流程 */ }
    return entry
  }

  return {
    log,
    info: (m) => log('info', m),
    success: (m) => log('success', m),
    warn: (m) => log('warn', m),
    error: (m) => log('error', m),
    recent: (n = 120) => buffer.slice(-n),
    clear: () => buffer.splice(0, buffer.length),
    file,
  }
}

export function ensureDir(p) {
  mkdirSync(dirname(p), { recursive: true })
  mkdirSync(p, { recursive: true })
  return p
}
