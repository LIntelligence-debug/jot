/**
 * 测试辅助：创建临时目录，并在进程退出时统一清理，避免在系统临时目录里留垃圾。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const created = []

export function tempDir(prefix = 'osa-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

export function cleanupTempDirs() {
  for (const dir of created.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

process.on('exit', cleanupTempDirs)
