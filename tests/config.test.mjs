import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULTS, deepMerge, loadConfig, updateConfigFile } from '../src/core/config.mjs'
import { tempDir } from './helpers.mjs'

function writeConfig(dir, patch = {}) {
  const configPath = join(dir, 'config.json')
  const base = {
    outputDir: join(dir, '课程知识地图'),
    dataDir: join(dir, 'data'),
    ...patch,
  }
  writeFileSync(configPath, JSON.stringify(base, null, 2), 'utf8')
  return configPath
}

test('默认配置：离线模式、端口 7870、三个预设学科、通用提示词', () => {
  const dir = tempDir()
  const cfg = loadConfig({ configPath: writeConfig(dir), env: {} })
  assert.equal(cfg.llm.mode, 'offline')
  assert.equal(cfg.web.port, 7870)
  assert.equal(cfg.web.host, '127.0.0.1')
  assert.equal(cfg.pollIntervalMs, DEFAULTS.pollIntervalMs)
  assert.equal(cfg.subjects.core.length, 3)
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.maxTokens, cfg.llm.maxTokens)
  assert.equal(cfg.prompt.persona, '学习笔记整理助手')
  assert.equal(cfg.prompt.goal, '日常学习与复习')
  assert.equal(Object.hasOwn(cfg.prompt, 'examName'), false)
})

test('首次运行自动生成配置文件', () => {
  const dir = tempDir()
  const configPath = join(dir, 'config.json')
  assert.equal(existsSync(configPath), false)
  const cfg = loadConfig({ configPath, env: {} })
  assert.equal(existsSync(configPath), true)
  const raw = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(raw.llm.mode, 'offline')
  assert.ok(String(raw.outputDir).includes('课程知识地图'))
  assert.equal(cfg.configPath, configPath)
})

test('deepMerge 只覆盖给定字段且不影响数组', () => {
  const merged = deepMerge({ a: 1, llm: { mode: 'offline', model: 'x' } }, { llm: { mode: 'openai' } })
  assert.equal(merged.llm.mode, 'openai')
  assert.equal(merged.llm.model, 'x')
  assert.equal(merged.a, 1)
})

test('环境变量覆盖端口与输出目录', () => {
  const dir = tempDir()
  const cfg = loadConfig({
    configPath: writeConfig(dir),
    env: { STUDY_PORT: '7999', STUDY_OUTPUT_DIR: join(dir, '自定义输出') },
  })
  assert.equal(cfg.web.port, 7999)
  assert.equal(cfg.outputDir, join(dir, '自定义输出'))
})

test('非法配置会抛出中文错误', () => {
  const dir = tempDir()
  assert.throws(() => loadConfig({ configPath: writeConfig(dir, { web: { port: 80 } }), env: {} }), /web\.port/)
  assert.throws(() => loadConfig({ configPath: writeConfig(dir, { llm: { mode: 'hacker' } }), env: {} }), /llm\.mode/)
  assert.throws(() => loadConfig({ configPath: writeConfig(dir, { subjects: { core: [] } }), env: {} }), /subjects\.core/)
})

test('updateConfigFile：合法更新落盘，非法更新不落盘', () => {
  const dir = tempDir()
  const configPath = writeConfig(dir)
  const next = updateConfigFile(configPath, { llm: { mode: 'openai', model: 'qwen2.5:7b' } })
  assert.equal(next.llm.mode, 'openai')
  const onDisk = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(onDisk.llm.mode, 'openai')

  const before = readFileSync(configPath, 'utf8')
  assert.throws(() => updateConfigFile(configPath, { web: { port: 1 } }), /web\.port/)
  assert.equal(readFileSync(configPath, 'utf8'), before)
})

test('updateConfigFile：带 UTF-8 BOM 的配置不会丢字段', () => {
  const dir = tempDir()
  const configPath = join(dir, 'config.json')
  const content = {
    outputDir: join(dir, '自定义输出'),
    dataDir: join(dir, '自定义数据'),
    pollIntervalMs: 15000,
  }
  writeFileSync(configPath, '\uFEFF' + JSON.stringify(content, null, 2), 'utf8')
  const next = updateConfigFile(configPath, { pollIntervalMs: 10000 })
  assert.equal(next.pollIntervalMs, 10000)
  const onDisk = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''))
  assert.equal(onDisk.pollIntervalMs, 10000)
  assert.equal(onDisk.outputDir, join(dir, '自定义输出'), 'BOM 不应导致其他配置丢失')
  assert.equal(onDisk.dataDir, join(dir, '自定义数据'))
})

test('updateConfigFile：配置不是合法 JSON 时抛错且不修改文件', () => {
  const dir = tempDir()
  const configPath = join(dir, 'config.json')
  const broken = '{ 这不是 JSON'
  writeFileSync(configPath, broken, 'utf8')
  assert.throws(() => updateConfigFile(configPath, { pollIntervalMs: 10000 }), /不是合法 JSON/)
  assert.equal(readFileSync(configPath, 'utf8'), broken)
})
