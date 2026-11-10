#!/usr/bin/env node
/**
 * CLI 入口（`node src/cli.mjs <command>` / `npm start`）。
 *
 * 命令：
 *   serve      启动本地 Web 控制台（默认命令）
 *   add        整理一条学习记录（手动标题，可导入文本）
 *   import     导入一份文本（字幕/简介/笔记）并整理
 *   list       列出学科与已整理记录
 *   rebuild    只重建 Markdown/Word（不调用模型）
 *   config     查看/修改配置
 *   test-llm   测试大模型连接（离线模式下只提示无需联网）
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { ensureDirs, loadConfig, updateConfigFile } from './core/config.mjs'
import { rebuildAll, processTitle } from './core/pipeline.mjs'
import { StateStore } from './core/state.mjs'
import { createLogger } from './log.mjs'
import { createProvider, PROVIDER_LABELS, testConnection } from './llm/index.mjs'
import { createApp } from './server/app.mjs'

const HELP = `Jot 笔记工坊 v0.1.0

用法：node src/cli.mjs <命令> [选项]

命令：
  serve                      启动本地 Web 控制台（默认）
  add <标题> [--text 文本|--file 文件] [--force]
                             整理一条学习记录（离线模板 / 已配置的大模型）
  import <标题> --file <文件> 导入字幕/简介/笔记并整理（也可 --text - 从 stdin 读）
  list                       列出学科与已整理记录
  rebuild                    只重建 Markdown/Word，不调用模型
  config [get <key>] [set <key> <value>]
                             查看或修改配置（key 支持 llm.mode 这类点号路径）
  test-llm                    测试大模型连接

选项：
  --config <path>   指定配置文件（默认 config/config.json）
  --port <n>        serve 的端口（默认取配置）
  --no-open         serve 时不自动打开浏览器
  --force           add/import 时重新生成已处理过的标题
  --json            机器可读输出
  -h, --help        显示帮助
`

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function readTextOption(values) {
  if (values.text === '-') return readStdin()
  if (typeof values.text === 'string') return values.text
  if (typeof values.file === 'string') return readFileSync(values.file, 'utf8')
  return ''
}

function printList(cfg, store) {
  const stats = store.stats()
  console.log('输出目录：' + cfg.outputDir)
  console.log('数据目录：' + cfg.dataDir)
  console.log('生成方式：' + (cfg.llm.mode === 'offline' ? '离线模板引擎（不联网）' : PROVIDER_LABELS[cfg.llm.mode] + ' · ' + cfg.llm.model))
  console.log('学科 ' + stats.subjectCount + ' 个 / 共 ' + stats.videoCount + ' 集')
  for (const s of store.listSubjects()) {
    console.log('\n[' + s.name + '] ' + s.videos.length + ' 集')
    for (const v of s.videos.slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))) {
      console.log('  - ' + v.title + '  (' + (v.generatedBy || 'offline') + ')')
    }
  }
}

function getByPath(obj, dotted) {
  return String(dotted).split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj)
}

function coerce(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value)
  return value
}

async function main() {
  const parsed = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      port: { type: 'string' },
      title: { type: 'string' },
      text: { type: 'string' },
      file: { type: 'string' },
      force: { type: 'boolean', default: false },
      'no-open': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const { values, positionals } = parsed
  const command = positionals[0] || 'serve'
  if (values.help) {
    console.log(HELP)
    return
  }

  const configPath = values.config
  const cfg = loadConfig({ configPath })
  ensureDirs(cfg)

  if (command === 'serve') {
    const port = values.port ? Number(values.port) : undefined
    if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) {
      console.error('端口必须是 1024-65535 的整数')
      process.exitCode = 2
      return
    }
    const app = await createApp({ configPath: cfg.configPath, port, openBrowser: !values['no-open'] })
    const handle = await app.start()
    console.log('Jot 笔记工坊已启动：' + handle.url)
    console.log('生成方式：' + (cfg.llm.mode === 'offline' ? '离线模板引擎（完全本地，不联网）' : PROVIDER_LABELS[cfg.llm.mode] + ' · ' + cfg.llm.model))
    console.log('按 Ctrl+C 退出')
    const stop = async () => { await handle.close(); process.exit(0) }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    return
  }

  const logger = createLogger(cfg.dataDir)
  const store = new StateStore(cfg.dataDir)
  const provider = createProvider(cfg)

  if (command === 'add' || command === 'import') {
    const title = (positionals[1] || values.title || '').trim()
    if (!title) {
      console.error('缺少标题：node src/cli.mjs ' + command + ' "<标题>" [--text 文本|--file 文件]')
      process.exitCode = 2
      return
    }
    const text = readTextOption(values)
    if (command === 'import' && !text.trim()) {
      console.error('import 需要文本：--file <字幕/简介文件> 或 --text "..." 或 --text -（从 stdin 读）')
      process.exitCode = 2
      return
    }
    const result = await processTitle({ logger, provider }, cfg, store, title, { text, force: values.force })
    if (values.json) {
      console.log(JSON.stringify(result, null, 2))
    } else if (result.ok === false) {
      console.error('处理失败：' + result.error)
      process.exitCode = 1
    } else if (result.skipped) {
      console.log('已处理过，跳过：' + title + '（加 --force 可重新生成）')
    } else {
      console.log('完成：' + title)
      console.log('  学科：' + result.subject)
      console.log('  方式：' + (result.generatedBy === 'llm' ? '大模型' : result.generatedBy === 'offline-fallback' ? '离线引擎（模型失败回退）' : '离线模板引擎'))
      if (result.warning) console.log('  提示：' + result.warning)
      console.log('  Markdown：' + result.noteMd)
      console.log('  Word：' + (result.noteDocx || '（生成失败，已保留 Markdown）'))
      if (result.docxError) console.log('  Word 错误：' + result.docxError)
    }
    return
  }

  if (command === 'list') {
    printList(cfg, store)
    return
  }

  if (command === 'rebuild') {
    const outcome = rebuildAll(cfg, store, logger)
    if (values.json) console.log(JSON.stringify(outcome, null, 2))
    else {
      for (const row of outcome) console.log((row.ok ? '✓ ' : '✗ ') + row.subject + (row.error ? '：' + row.error : ''))
    }
    return
  }

  if (command === 'config') {
    const sub = positionals[1]
    if (!sub || sub === 'get') {
      if (positionals[2]) console.log(JSON.stringify(getByPath(cfg, positionals[2]), null, 2))
      else console.log(JSON.stringify(cfg, null, 2))
      return
    }
    if (sub === 'set') {
      const key = positionals[2]
      const rawValue = positionals[3]
      if (!key || rawValue === undefined) {
        console.error('用法：config set <key> <value>（例如 config set llm.mode openai）')
        process.exitCode = 2
        return
      }
      const patch = {}
      const parts = key.split('.')
      let cursor = patch
      for (let i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] = {}
        cursor = cursor[parts[i]]
      }
      cursor[parts[parts.length - 1]] = coerce(rawValue)
      const next = updateConfigFile(cfg.configPath, patch)
      console.log('已更新：' + key + ' = ' + JSON.stringify(getByPath(next, key)))
      return
    }
    console.error('未知 config 子命令：' + sub)
    process.exitCode = 2
    return
  }

  if (command === 'test-llm') {
    const result = await testConnection(cfg)
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
    return
  }

  console.error('未知命令：' + command + '\n\n' + HELP)
  process.exitCode = 2
}

main().catch((error) => {
  console.error('运行失败：' + (error && error.stack ? error.stack : error))
  process.exitCode = 1
})
