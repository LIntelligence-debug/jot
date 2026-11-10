/**
 * 离线保证测试：
 * 1) 离线模式跑完整流水线时，不允许任何 fetch 调用；
 * 2) 大模型模式失败时自动回退离线引擎，笔记照样生成。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDirs, loadConfig } from '../src/core/config.mjs'
import { processTitle } from '../src/core/pipeline.mjs'
import { StateStore } from '../src/core/state.mjs'
import { createLogger } from '../src/log.mjs'
import { generateSummary } from '../src/llm/index.mjs'
import { tempDir } from './helpers.mjs'

function makeWorkspace(extra = {}) {
  const root = tempDir('osa-offline-')
  const configPath = join(root, 'config.json')
  writeFileSync(configPath, JSON.stringify({
    enabled: false,
    outputDir: join(root, '课程知识地图'),
    dataDir: join(root, 'data'),
    ...extra,
  }), 'utf8')
  const cfg = loadConfig({ configPath, env: {} })
  ensureDirs(cfg)
  return { cfg, root, store: new StateStore(cfg.dataDir), logger: createLogger(cfg.dataDir) }
}

test('离线模式全程不调用 fetch（完全不出网）', async () => {
  const ws = makeWorkspace()
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = () => {
    calls += 1
    throw new Error('离线模式不允许联网')
  }
  try {
    const result = await processTitle({ logger: ws.logger }, ws.cfg, ws.store, '离线保证测试课程', { text: '考点：测试知识点。易错点：测试易错点。' })
    assert.equal(result.ok, true)
    assert.equal(result.generatedBy, 'offline')
    assert.ok(existsSync(result.noteDocx))
  } finally {
    globalThis.fetch = original
  }
  assert.equal(calls, 0, '离线模式不应发起任何网络请求')
})

test('模型调用失败时自动回退离线引擎，并给出 warning', async () => {
  const ws = makeWorkspace({
    llm: {
      mode: 'openai',
      baseURL: 'http://127.0.0.1:1/v1',
      model: 'unreachable-model',
      apiKeyEnv: 'OSA_TEST_KEY',
      fallbackToOffline: true,
      timeoutMs: 3000,
    },
  })
  process.env.OSA_TEST_KEY = 'test-key'
  try {
    const generated = await generateSummary({
      cfg: ws.cfg,
      logger: ws.logger,
      provider: null,
      input: { title: '回退测试课程', subject: '数学', keywords: ['极限'], text: '考点：回退后仍要生成笔记。', cfg: ws.cfg },
    })
    assert.equal(generated.generatedBy, 'offline-fallback')
    assert.equal(generated.summary.generatedBy, 'offline')
    assert.ok(generated.warning && generated.warning.includes('回退'))
  } finally {
    delete process.env.OSA_TEST_KEY
  }
})

test('模型调用成功时走 llm 分支并保留模型信息', async () => {
  const ws = makeWorkspace({ llm: { mode: 'openai', baseURL: 'http://127.0.0.1:1/v1', model: 'fake', apiKeyEnv: 'OSA_TEST_KEY' } })
  process.env.OSA_TEST_KEY = 'test-key'
  const fakeProvider = {
    id: 'openai',
    label: '测试模型',
    hasAuth: () => true,
    complete: async () => ({
      text: JSON.stringify({
        overview: '模型生成的概述',
        knowledgePoints: [{ point: '知识点A', detail: '解释A' }],
        keyTerms: [{ term: '术语', explain: '说明' }],
        studyTips: ['常考'],
        pitfalls: ['易错'],
        reviewQuestions: ['问题？'],
        mindmap: { title: '根', children: [{ title: '子' }] },
      }),
      usage: { input_tokens: 10, output_tokens: 20 },
      ms: 12,
      model: 'fake',
    }),
  }
  try {
    const generated = await generateSummary({
      cfg: ws.cfg,
      logger: ws.logger,
      provider: fakeProvider,
      input: { title: '模型分支测试', subject: '数学', keywords: [], text: '', cfg: ws.cfg },
    })
    assert.equal(generated.generatedBy, 'llm')
    assert.equal(generated.provider, 'openai')
    assert.equal(generated.summary.overview, '模型生成的概述')
    assert.equal(generated.warning, null)
  } finally {
    delete process.env.OSA_TEST_KEY
  }
})

test('fallbackToOffline=false 时模型失败直接抛错', async () => {
  const ws = makeWorkspace({
    llm: { mode: 'openai', baseURL: 'http://127.0.0.1:1/v1', model: 'x', apiKeyEnv: 'OSA_TEST_KEY', fallbackToOffline: false, timeoutMs: 2000 },
  })
  process.env.OSA_TEST_KEY = 'test-key'
  try {
    await assert.rejects(
      () => generateSummary({ cfg: ws.cfg, input: { title: 'x', subject: '数学', keywords: [], text: '', cfg: ws.cfg } }),
      (error) => Boolean(error && error.code),
    )
  } finally {
    delete process.env.OSA_TEST_KEY
  }
})
