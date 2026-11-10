import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from '../src/server/app.mjs'
import { tempDir } from './helpers.mjs'

function makeWorkspace(port) {
  const root = tempDir('osa-server-')
  const configPath = join(root, 'config.json')
  writeFileSync(configPath, JSON.stringify({
    enabled: false,
    outputDir: join(root, '课程知识地图'),
    dataDir: join(root, 'data'),
    web: { host: '127.0.0.1', port },
    pollIntervalMs: 15000,
  }, null, 2), 'utf8')
  return { root, configPath, outputDir: join(root, '课程知识地图'), dataDir: join(root, 'data') }
}

async function request(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { text } }
  return { status: res.status, data, text }
}

test('本地服务：健康检查、状态、静态页与配置校验', async () => {
  const ws = makeWorkspace(17990)
  const app = await createApp({ configPath: ws.configPath, port: 17990, singleInstance: false, openBrowser: false })
  const handle = await app.start()
  const base = handle.url
  try {
    const health = await request(base, 'GET', '/api/health')
    assert.equal(health.status, 200)
    assert.equal(health.data.ok, true)
    assert.equal(health.data.app, 'jot')

    const state = await request(base, 'GET', '/api/state')
    assert.equal(state.status, 200)
    assert.equal(state.data.enabled, false)
    assert.equal(state.data.llm.mode, 'offline')
    assert.equal(state.data.outputDir, ws.outputDir)
    assert.equal(typeof state.data.watchSupported, 'boolean')

    const html = await request(base, 'GET', '/')
    assert.equal(html.status, 200)
    assert.ok(html.text.includes('笔记工坊'))
    assert.ok(html.text.includes('/static/app.js'))

    const js = await request(base, 'GET', '/static/app.js')
    assert.equal(js.status, 200)
    assert.ok(js.text.includes('EventSource'))

    const css = await request(base, 'GET', '/static/offline.css')
    assert.equal(css.status, 200)

    const badInterval = await request(base, 'POST', '/api/config', { pollIntervalMs: 500 })
    assert.equal(badInterval.status, 500)
    assert.ok(String(badInterval.data.error).includes('1~300'))

    const good = await request(base, 'POST', '/api/config', { pollIntervalMs: 5000 })
    assert.equal(good.status, 200)
    assert.equal(good.data.state.pollIntervalMs, 5000)

    const badMode = await request(base, 'POST', '/api/config', { llmMode: 'hacker' })
    assert.equal(badMode.status, 500)
  } finally {
    await handle.close()
  }
})

test('本地服务：扫描生成笔记、读取 Markdown、越权路径被拒绝', async () => {
  const ws = makeWorkspace(17991)
  const app = await createApp({ configPath: ws.configPath, port: 17991, singleInstance: false, openBrowser: false })
  const handle = await app.start()
  const base = handle.url
  try {
    const scan = await request(base, 'POST', '/api/scan', {
      title: 'WPS 多人在线协作编辑 Excel 表格',
      text: '考点：相对引用与绝对引用。易错点：工作簿与工作表不能混淆。',
    })
    assert.equal(scan.status, 200)
    assert.equal(scan.data.ok, true)
    assert.equal(scan.data.result.subject, '计算机基础')

    const notes = await request(base, 'GET', '/api/notes?title=' + encodeURIComponent('WPS 多人在线协作编辑 Excel 表格'))
    assert.equal(notes.status, 200)
    assert.equal(notes.data.video.title, 'WPS 多人在线协作编辑 Excel 表格')

    const md = await request(base, 'POST', '/api/notes/markdown', { title: 'WPS 多人在线协作编辑 Excel 表格' })
    assert.equal(md.status, 200)
    assert.ok(md.data.markdown.includes('### 核心知识点'))

    const missing = await request(base, 'GET', '/api/notes?title=' + encodeURIComponent('不存在'))
    assert.equal(missing.status, 404)

    const forbidden = await request(base, 'POST', '/api/open', { path: process.platform === 'win32' ? 'C:\\Windows\\notepad.exe' : '/etc/passwd' })
    assert.equal(forbidden.status, 500)
    assert.ok(String(forbidden.data.error).includes('输出目录'))

    const rebuild = await request(base, 'POST', '/api/rebuild', {})
    assert.equal(rebuild.status, 200)
    assert.equal(rebuild.data.ok, true)
  } finally {
    await handle.close()
  }
  assert.equal(existsSync(join(ws.outputDir, '课程总览.docx')), true)
  const info = JSON.parse(readFileSync(join(ws.dataDir, 'server.json'), 'utf8'))
  assert.ok(info.stoppedAt > 0)
})

test('SSE：连接后收到 hello 快照', async () => {
  const ws = makeWorkspace(17992)
  const app = await createApp({ configPath: ws.configPath, port: 17992, singleInstance: false, openBrowser: false })
  const handle = await app.start()
  try {
    const ac = new AbortController()
    const res = await fetch(handle.url + '/api/stream', { signal: ac.signal })
    assert.equal(res.status, 200)
    const reader = res.body.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    assert.ok(text.includes('event: hello'))
    assert.ok(text.includes('"ok":true'))
    ac.abort()
  } finally {
    await handle.close()
  }
})
