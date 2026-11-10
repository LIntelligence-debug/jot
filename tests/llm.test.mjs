import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createAnthropicProvider } from '../src/llm/anthropic.mjs'
import { createOpenAiProvider } from '../src/llm/openai.mjs'
import { listModels, normalizeSummary, parseJsonLoose, testConnection } from '../src/llm/index.mjs'

async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    return await fn('http://127.0.0.1:' + port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => {
      let body = null
      try { body = JSON.parse(data) } catch { body = data }
      resolve({ body, headers: req.headers, url: req.url })
    })
  })
}

test('OpenAI 兼容 provider：请求体/鉴权头/响应解析', async () => {
  process.env.STUDY_TEST_KEY = 'test-key'
  let captured = null
  await withServer(async (req, res) => {
    captured = await readJsonBody(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      choices: [{ message: { content: '{"overview":"ok"}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    }))
  }, async (base) => {
    const cfg = {
      llm: { mode: 'openai', baseURL: base + '/v1', model: 'qwen2.5:7b', apiKeyEnv: 'STUDY_TEST_KEY', apiKey: null, temperature: 0.3, maxTokens: 512, timeoutMs: 5000 },
    }
    const provider = createOpenAiProvider(cfg)
    assert.equal(provider.hasAuth(), true)
    const result = await provider.complete({ system: 'sys', user: 'hi', maxTokens: 128, timeoutMs: 5000 })
    assert.equal(result.text, '{"overview":"ok"}')
    assert.equal(result.usage.completion_tokens, 3)
    assert.equal(captured.url, '/v1/chat/completions')
    assert.equal(captured.headers.authorization, 'Bearer test-key')
    assert.equal(captured.body.model, 'qwen2.5:7b')
    assert.equal(captured.body.messages.length, 2)
    assert.equal(captured.body.messages[0].role, 'system')
    assert.equal(captured.body.stream, false)
    assert.equal(captured.body.max_tokens, 128)
  })
  delete process.env.STUDY_TEST_KEY
})

test('OpenAI 兼容 provider：没有 key 时 hasAuth=false 且抛 AUTH', async () => {
  delete process.env.STUDY_TEST_KEY
  const cfg = { llm: { mode: 'openai', baseURL: 'http://127.0.0.1:1/v1', model: 'x', apiKeyEnv: 'STUDY_TEST_KEY', apiKey: null, maxTokens: 64, timeoutMs: 3000 } }
  const provider = createOpenAiProvider(cfg)
  assert.equal(provider.hasAuth(), false)
  await assert.rejects(() => provider.complete({ system: '', user: 'hi' }), (error) => error.code === 'AUTH')
})

test('Anthropic 兼容 provider：/v1/messages + x-api-key', async () => {
  process.env.STUDY_TEST_KEY = 'test-key'
  let captured = null
  await withServer(async (req, res) => {
    captured = await readJsonBody(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 5, output_tokens: 2 } }))
  }, async (base) => {
    const cfg = { llm: { mode: 'anthropic', baseURL: base, model: 'deepseek-flash', apiKeyEnv: 'STUDY_TEST_KEY', apiKey: null, maxTokens: 256, timeoutMs: 5000 } }
    const provider = createAnthropicProvider(cfg)
    const result = await provider.complete({ system: 'sys', user: 'hi', timeoutMs: 5000 })
    assert.equal(result.text, 'hello')
    assert.equal(captured.url, '/v1/messages')
    assert.equal(captured.headers['x-api-key'], 'test-key')
    assert.equal(captured.body.system, 'sys')
    assert.equal(captured.body.messages[0].content[0].text, 'hi')
  })
  delete process.env.STUDY_TEST_KEY
})

test('离线模式测试连接不需要联网', async () => {
  const result = await testConnection({ llm: { mode: 'offline' } })
  assert.equal(result.ok, true)
  assert.match(result.message, /离线/)
})

test('离线模式模型列表给出离线提示', async () => {
  const result = await listModels({ llm: { mode: 'offline' } })
  assert.equal(result.ok, true)
  assert.equal(result.models.length, 1)
})

test('parseJsonLoose 容忍代码块、前后废话与尾逗号', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonLoose('好的，结果如下：{"a":1} 以上'), { a: 1 })
  assert.deepEqual(parseJsonLoose('{"a":1,}'), { a: 1 })
  assert.equal(parseJsonLoose('完全不是 JSON'), null)
  assert.equal(parseJsonLoose(''), null)
})

test('normalizeSummary 规范化字段并补默认值', () => {
  const summary = normalizeSummary({
    overview: '一句话',
    knowledgePoints: [{ point: '概念A', detail: '解释A' }, '字符串知识点'],
    keyTerms: [{ term: '术语', explain: '说明' }],
    studyTips: ['常考'],
    pitfalls: ['易错'],
    reviewQuestions: ['问题？'],
    mindmap: { title: '根', children: [{ title: '子' }] },
  }, '标题')
  assert.equal(summary.overview, '一句话')
  assert.equal(summary.knowledgePoints.length, 2)
  assert.deepEqual(summary.knowledgePoints[1], { point: '字符串知识点', detail: '' })
  assert.deepEqual(summary.studyTips, ['常考'])
  assert.equal(Object.hasOwn(summary, 'danmakuFocus'), false)
  assert.equal(summary.generatedBy, 'llm')
  assert.equal(summary.mindmap.children[0].title, '子')
})

test('连接失败抛出 NETWORK 错误', async () => {
  process.env.STUDY_TEST_KEY = 'k'
  const cfg = { llm: { mode: 'openai', baseURL: 'http://127.0.0.1:1/v1', model: 'x', apiKeyEnv: 'STUDY_TEST_KEY', apiKey: null, maxTokens: 64, timeoutMs: 2000 } }
  const provider = createOpenAiProvider(cfg)
  await assert.rejects(() => provider.complete({ system: '', user: 'hi' }), (error) => error.code === 'NETWORK')
  delete process.env.STUDY_TEST_KEY
})
