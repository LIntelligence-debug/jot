import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDirs, loadConfig } from '../src/core/config.mjs'
import { processTitle, rebuildAll } from '../src/core/pipeline.mjs'
import { StateStore } from '../src/core/state.mjs'
import { createLogger } from '../src/log.mjs'
import { tempDir } from './helpers.mjs'

function makeWorkspace() {
  const root = tempDir('osa-pipeline-')
  const configPath = join(root, 'config.json')
  writeFileSync(configPath, JSON.stringify({
    enabled: false,
    outputDir: join(root, '课程知识地图'),
    dataDir: join(root, 'data'),
  }), 'utf8')
  const cfg = loadConfig({ configPath, env: {} })
  ensureDirs(cfg)
  return {
    cfg,
    configPath,
    dataDir: cfg.dataDir,
    outputDir: cfg.outputDir,
    store: new StateStore(cfg.dataDir),
    logger: createLogger(cfg.dataDir),
  }
}

const TEXT = '考点：求定义域是常考题型。函数的定义域要求分母不为零。易错点：0/0 型不能直接代入。极限四则运算要求极限存在。'

test('离线生成：Markdown + Word + 手册 + 总览', async () => {
  const ws = makeWorkspace()
  const result = await processTitle({ logger: ws.logger }, ws.cfg, ws.store, '高等数学 第一章 函数、极限、连续', { text: TEXT })
  assert.equal(result.ok, true)
  assert.equal(result.subject, '数学')
  assert.equal(result.generatedBy, 'offline')
  assert.ok(existsSync(result.noteMd))
  assert.ok(existsSync(result.noteDocx))
  assert.ok(existsSync(result.manualDocx))
  const md = readFileSync(result.noteMd, 'utf8')
  assert.ok(md.includes('## 高等数学 第一章'))
  assert.ok(md.includes('### 核心知识点'))
  assert.ok(md.includes('离线模板整理'))
  assert.ok(existsSync(join(ws.outputDir, '课程总览.md')))
  assert.ok(existsSync(join(ws.outputDir, '课程总览.docx')))
  assert.equal(ws.store.stats().videoCount, 1)
})

test('同一标题第二次自动跳过；force 可重新生成', async () => {
  const ws = makeWorkspace()
  await processTitle({ logger: ws.logger }, ws.cfg, ws.store, '高一数学 集合与函数', {})
  const again = await processTitle({ logger: ws.logger }, ws.cfg, ws.store, '高一数学 集合与函数', {})
  assert.equal(again.skipped, true)
  assert.equal(again.reason, 'seen')
  const forced = await processTitle({ logger: ws.logger }, ws.cfg, ws.store, '高一数学 集合与函数', { force: true })
  assert.equal(forced.ok, true)
  assert.equal(ws.store.stats().videoCount, 1)
})

test('无文本只有标题也能生成框架笔记', async () => {
  const ws = makeWorkspace()
  const result = await processTitle({ logger: ws.logger }, ws.cfg, ws.store, '完全只有标题的课程', {})
  assert.equal(result.ok, true)
  assert.equal(result.subject, '待分类')
  const md = readFileSync(result.noteMd, 'utf8')
  assert.ok(md.includes('离线模板'))
})

test('未命中预设学科的内容也能归档（学科目录平铺）', async () => {
  const ws = makeWorkspace()
  const result = await processTitle({ logger: ws.logger }, ws.cfg, ws.store, '摄影基础 曝光三要素', {})
  assert.equal(result.subject, '待分类')
  assert.ok(result.noteMd.includes('待分类'))
  assert.ok(!result.noteMd.includes('其他学科'))
})

test('rebuildAll 只重建文档，不新增记录', async () => {
  const ws = makeWorkspace()
  await processTitle({ logger: ws.logger }, ws.cfg, ws.store, '英语语法 时态', { text: '一般现在时表示习惯。重点：时态辨析要多练。' })
  const before = ws.store.stats().videoCount
  const outcome = rebuildAll(ws.cfg, ws.store, ws.logger)
  assert.equal(outcome.every((row) => row.ok), true)
  assert.equal(ws.store.stats().videoCount, before)
  assert.ok(existsSync(join(ws.outputDir, '课程总览.docx')))
})

test('标题为空返回明确错误', async () => {
  const ws = makeWorkspace()
  const result = await processTitle({ logger: ws.logger }, ws.cfg, ws.store, '   ', {})
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'empty-title')
})
