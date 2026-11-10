/**
 * 本地 Web 服务：HTTP API + SSE + 静态页面。
 * 只监听 127.0.0.1（默认），不对外网提供服务；默认离线，不发起任何外部请求。
 */
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { atomicWriteJson, ensureDirs, loadConfig, readJson, updateConfigFile } from '../core/config.mjs'
import { processTitle, rebuildAll } from '../core/pipeline.mjs'
import { renderVideoSection } from '../core/render.mjs'
import { StateStore } from '../core/state.mjs'
import { createLogger } from '../log.mjs'
import { createProvider, listModels, PROVIDER_LABELS, testConnection } from '../llm/index.mjs'
import { detectForeground, platformLabel, watcherSupported } from '../watch/index.mjs'

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'static')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const now = () => Date.now()

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('请求体过大（上限 1MB）')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch { throw new Error('请求体不是合法 JSON') }
}

export function pickPort(host, start, attempts = 20) {
  return new Promise((resolvePort, rejectPort) => {
    let port = start
    const tryListen = () => {
      const srv = createNetServer()
      srv.once('error', (error) => {
        if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES') && attempts-- > 0) {
          port += 1
          tryListen()
        } else {
          rejectPort(error)
        }
      })
      srv.once('listening', () => {
        srv.close(() => resolvePort(port))
      })
      srv.listen(port, host)
    }
    tryListen()
  })
}

function safeOpenPath(targetPath, roots) {
  const full = resolve(String(targetPath || ''))
  const lower = full.toLowerCase()
  const allowed = roots.some((root) => {
    const r = resolve(root).toLowerCase()
    return lower === r || lower.startsWith(r + sep.toLowerCase())
  })
  if (!allowed) throw new Error('只能打开输出目录或数据目录内的路径')
  if (!existsSync(full)) throw new Error('路径不存在：' + full)
  return full
}

function openInFileManager(target) {
  if (process.platform === 'win32') return spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true })
  if (process.platform === 'darwin') return spawn('open', [target], { detached: true, stdio: 'ignore' })
  return spawn('xdg-open', [target], { detached: true, stdio: 'ignore' })
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
    return true
  } catch {
    return false
  }
}

export async function createApp(options = {}) {
  const configPath = options.configPath || null
  let cfg = loadConfig({ configPath })
  ensureDirs(cfg)
  const logger = createLogger(cfg.dataDir)
  const store = new StateStore(cfg.dataDir)
  let provider = createProvider(cfg)

  const infoFile = join(cfg.dataDir, 'server.json')
  const clients = new Set()
  const live = {
    foreground: null,
    stage: null,
    decision: 'idle',
    pending: null,
    lastError: null,
    lastResult: null,
    lastResultAt: 0,
    startedAt: now(),
    watchSupported: watcherSupported(),
    platform: platformLabel(),
  }
  let currentPort = 0
  let currentUrl = ''
  let server = null
  let running = false
  let timer = null
  let nextTickAt = 0
  let closed = false
  let heartbeat = null

  function log(level, message) {
    const entry = logger.log(level, message)
    broadcast('log', entry)
    return entry
  }

  function broadcast(event, data) {
    if (clients.size === 0) return
    const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'
    for (const res of clients) {
      try { res.write(payload) } catch { clients.delete(res) }
    }
  }

  function latestVideo() {
    const rows = []
    for (const subject of store.listSubjects()) {
      for (const video of subject.videos) rows.push({ subject: subject.name, video })
    }
    rows.sort((a, b) => (b.video.updatedAt || b.video.createdAt || 0) - (a.video.updatedAt || a.video.createdAt || 0))
    if (rows.length === 0) return null
    return Object.assign({ subject: rows[0].subject }, rows[0].video)
  }

  function recentVideos(limit = 60) {
    const rows = []
    for (const subject of store.listSubjects()) {
      for (const video of subject.videos) {
        rows.push({
          title: video.title,
          subject: subject.name,
          at: video.updatedAt || video.createdAt || 0,
          generatedBy: video.generatedBy || 'offline',
          noteDocx: video.noteDocx || '',
          noteMd: video.noteMd || '',
          manualDocx: video.manualDocx || '',
        })
      }
    }
    rows.sort((a, b) => b.at - a.at)
    return rows.slice(0, limit)
  }

  function snapshot() {
    if (!running) {
      try { store.reload() } catch { /* 忽略 */ }
    }
    const stats = store.stats()
    return {
      ok: true,
      enabled: cfg.enabled,
      pollIntervalMs: cfg.pollIntervalMs,
      stablePolls: cfg.stablePolls,
      nextTickAt,
      running,
      decision: live.decision,
      pending: live.pending,
      foreground: live.foreground,
      stage: live.stage,
      lastError: live.lastError,
      lastResult: live.lastResult,
      lastResultAt: live.lastResultAt,
      startedAt: live.startedAt,
      outputDir: cfg.outputDir,
      dataDir: cfg.dataDir,
      watchSupported: live.watchSupported,
      platform: live.platform,
      now: now(),
      subjects: stats.subjects,
      subjectCount: stats.subjectCount,
      videoCount: stats.videoCount,
      recent: recentVideos(60),
      latest: latestVideo(),
      logs: logger.recent(120),
      llm: {
        mode: cfg.llm.mode,
        modeLabel: PROVIDER_LABELS[cfg.llm.mode] || cfg.llm.mode,
        model: cfg.llm.model,
        baseURL: cfg.llm.baseURL,
        apiKeyEnv: cfg.llm.apiKeyEnv,
        hasAuth: cfg.llm.mode === 'offline' ? true : Boolean(provider && provider.hasAuth()),
      },
      web: { port: currentPort || cfg.web.port, url: currentUrl || '' },
    }
  }

  function schedule(delayMs) {
    if (closed) return
    if (timer) clearTimeout(timer)
    if (!cfg.enabled || !live.watchSupported) {
      nextTickAt = 0
      return
    }
    const delay = typeof delayMs === 'number' ? delayMs : cfg.pollIntervalMs
    nextTickAt = now() + delay
    timer = setTimeout(() => {
      tick().catch((error) => log('error', '轮询异常：' + (error && error.message ? error.message : error)))
    }, delay)
  }

  async function observe(shouldProcess) {
    if (!cfg.enabled) {
      live.decision = 'paused'
      return
    }
    if (!live.watchSupported) {
      live.decision = 'watch-unsupported'
      return
    }
    const det = await detectForeground(cfg, cfg.dataDir)
    live.decision = det.decision
    live.foreground = det.foreground
    if (det.foreground) broadcast('foreground', det.foreground)
    if (det.decision !== 'detected') {
      live.pending = null
      return
    }
    if (store.hasSeen(det.title)) {
      live.decision = 'seen'
      live.pending = null
      return
    }
    if (!live.pending || live.pending.title !== det.title) live.pending = { title: det.title, count: 1 }
    else live.pending.count += 1
    live.decision = 'waiting'
    if (live.pending.count < cfg.stablePolls) return
    const title = live.pending.title
    live.pending = null
    live.decision = 'detected'
    log('info', '检测到新内容：' + title)
    if (shouldProcess !== false) await processCurrent(title, {})
  }

  async function tick() {
    if (closed || !cfg.enabled) return
    if (running) {
      schedule()
      return
    }
    try {
      await observe(true)
    } finally {
      broadcast('tick', {
        at: now(),
        decision: live.decision,
        pendingCount: live.pending ? live.pending.count : 0,
        nextTickAt: now() + cfg.pollIntervalMs,
      })
      schedule()
    }
  }

  async function processCurrent(title, options = {}) {
    if (running) return { ok: false, error: '正在处理中' }
    running = true
    live.lastError = null
    live.stage = { stage: 'start', title, message: '开始处理…', at: now() }
    broadcast('stage', live.stage)
    broadcast('state', snapshot())
    try {
      const result = await processTitle(
        {
          logger,
          provider,
          onEvent: (event) => {
            live.stage = Object.assign({ at: now() }, event)
            broadcast('stage', live.stage)
          },
        },
        cfg,
        store,
        title,
        options,
      )
      if (result && result.skipped) {
        live.decision = 'seen'
        log('info', '已处理过，跳过：' + title)
      } else if (result && result.ok === false) {
        live.decision = 'error'
        live.lastError = result.error || '处理失败'
        log('error', '处理失败：' + live.lastError)
      } else {
        live.decision = 'processed'
        live.lastResultAt = now()
        live.lastResult = result
        log('success', '笔记已生成：' + (result.title || title) + ' → ' + (result.subject || '未分类') + (result.docxError ? '（Word 生成失败，已保留 Markdown）' : ''))
        broadcast('result', result)
      }
      return result
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      live.lastError = message
      live.decision = 'error'
      log('error', '处理失败：' + message)
      return { ok: false, error: message }
    } finally {
      running = false
      live.stage = Object.assign({ at: now() }, live.stage || {}, { stage: 'idle', message: '等待下一次任务' })
      broadcast('state', snapshot())
    }
  }

  function applyConfig(body) {
    const patch = {}
    if (Object.hasOwn(body, 'enabled')) patch.enabled = body.enabled === true
    if (Object.hasOwn(body, 'pollIntervalMs')) {
      const n = Number(body.pollIntervalMs)
      if (!Number.isFinite(n) || n < 1000 || n > 300000) throw new Error('轮询间隔必须在 1~300 秒之间')
      patch.pollIntervalMs = Math.round(n)
    }
    if (Object.hasOwn(body, 'llmMode')) {
      const mode = String(body.llmMode || '')
      if (!['offline', 'openai', 'anthropic'].includes(mode)) throw new Error('模型接入方式必须是 offline / openai / anthropic')
      patch.llm = Object.assign({}, patch.llm || {}, { mode })
    }
    if (Object.hasOwn(body, 'llmBaseURL')) {
      const url = String(body.llmBaseURL || '').trim()
      if (!/^https?:\/\//i.test(url)) throw new Error('Base URL 必须是 http(s) 地址')
      patch.llm = Object.assign({}, patch.llm || {}, { baseURL: url })
    }
    if (Object.hasOwn(body, 'llmModel')) {
      const model = String(body.llmModel || '').trim()
      if (!model) throw new Error('模型名不能为空')
      patch.llm = Object.assign({}, patch.llm || {}, { model })
    }
    if (Object.hasOwn(body, 'llmApiKeyEnv')) {
      const name = String(body.llmApiKeyEnv || '').trim()
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('API Key 环境变量名不合法')
      patch.llm = Object.assign({}, patch.llm || {}, { apiKeyEnv: name })
    }
    if (Object.hasOwn(body, 'outputDir')) {
      const dir = String(body.outputDir || '').trim()
      if (!dir) throw new Error('输出目录不能为空')
      patch.outputDir = dir
    }
    cfg = updateConfigFile(cfg.configPath, patch)
    ensureDirs(cfg)
    provider = createProvider(cfg)
    schedule()
    broadcast('config', { enabled: cfg.enabled, pollIntervalMs: cfg.pollIntervalMs })
    log('info', '配置已更新：' + (cfg.enabled ? '自动检测已开启' : '自动检测已暂停') + ' · 生成方式 ' + (PROVIDER_LABELS[cfg.llm.mode] || cfg.llm.mode))
    return snapshot()
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const pathname = decodeURIComponent(url.pathname)
    try {
      if (pathname === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, app: 'jot', port: currentPort || cfg.web.port, mode: cfg.llm.mode })
      }
      if (pathname === '/api/state' && req.method === 'GET') return sendJson(res, 200, snapshot())
      if (pathname === '/api/config' && req.method === 'POST') {
        const body = await readBody(req)
        return sendJson(res, 200, { ok: true, state: applyConfig(body || {}) })
      }
      if (pathname === '/api/poll' && req.method === 'POST') {
        await observe(false)
        return sendJson(res, 200, { ok: true, state: snapshot() })
      }
      if (pathname === '/api/scan' && req.method === 'POST') {
        const body = await readBody(req)
        let title = typeof body.title === 'string' ? body.title.trim() : ''
        if (!title) {
          if (!live.watchSupported) return sendJson(res, 400, { ok: false, error: '当前平台（' + live.platform + '）不支持自动读取前台窗口，请直接填写标题' })
          const det = await detectForeground(cfg, cfg.dataDir)
          if (det.decision !== 'detected') return sendJson(res, 400, { ok: false, error: '当前前台不是浏览器/播放器窗口，或标题被忽略' })
          title = det.title
        }
        const result = await processCurrent(title, {
          text: typeof body.text === 'string' ? body.text : '',
          force: body.force === true,
        })
        if (result && result.ok === false) return sendJson(res, 400, { ok: false, error: result.error })
        return sendJson(res, 200, { ok: true, result })
      }
      if (pathname === '/api/import' && req.method === 'POST') {
        const body = await readBody(req)
        const title = String(body.title || '').trim()
        const text = String(body.text || '').trim()
        if (!title) return sendJson(res, 400, { ok: false, error: '缺少标题' })
        if (!text) return sendJson(res, 400, { ok: false, error: '缺少导入文本（字幕/简介/笔记）' })
        const result = await processCurrent(title, { text, force: body.force === true })
        if (result && result.ok === false) return sendJson(res, 400, { ok: false, error: result.error })
        return sendJson(res, 200, { ok: true, result })
      }
      if (pathname === '/api/rebuild' && req.method === 'POST') {
        const outcome = rebuildAll(cfg, store, logger)
        const failed = outcome.filter((o) => !o.ok)
        log(failed.length ? 'warn' : 'success', '重建文档：' + outcome.length + ' 项，失败 ' + failed.length + ' 项')
        return sendJson(res, 200, { ok: failed.length === 0, outcome })
      }
      if (pathname === '/api/notes' && req.method === 'GET') {
        const title = url.searchParams.get('title') || ''
        const hit = store.findVideo(title)
        if (!hit) return sendJson(res, 404, { ok: false, error: '没有找到该记录' })
        return sendJson(res, 200, { ok: true, subject: hit.subject, video: hit.video })
      }
      if (pathname === '/api/notes/markdown' && req.method === 'POST') {
        const body = await readBody(req)
        const hit = store.findVideo(body && body.title ? body.title : '')
        if (!hit) return sendJson(res, 404, { ok: false, error: '没有找到该记录' })
        let markdown = ''
        try {
          markdown = readFileSync(hit.video.noteMd, 'utf8')
        } catch {
          markdown = renderVideoSection(hit.video)
        }
        return sendJson(res, 200, { ok: true, markdown, path: hit.video.noteMd })
      }
      if (pathname === '/api/open' && req.method === 'POST') {
        const body = await readBody(req)
        const target = safeOpenPath(body && body.path ? body.path : cfg.outputDir, [cfg.outputDir, cfg.dataDir])
        const child = openInFileManager(target)
        if (child && typeof child.unref === 'function') child.unref()
        return sendJson(res, 200, { ok: true, path: target })
      }
      if (pathname === '/api/llm/test' && req.method === 'POST') {
        const result = await testConnection(cfg)
        return sendJson(res, result.ok ? 200 : 400, result)
      }
      if (pathname === '/api/llm/models' && req.method === 'GET') {
        const result = await listModels(cfg)
        return sendJson(res, result.ok ? 200 : 400, result)
      }
      if (pathname === '/api/shutdown' && req.method === 'POST') {
        log('info', '收到退出请求')
        sendJson(res, 200, { ok: true })
        setTimeout(() => { close().then(() => process.exit(0), () => process.exit(0)) }, 150)
        return
      }
      if (pathname === '/api/stream' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        })
        res.write('retry: 3000\n\n')
        res.write('event: hello\ndata: ' + JSON.stringify(snapshot()) + '\n\n')
        clients.add(res)
        const ping = setInterval(() => {
          try { res.write(': ping\n\n') } catch { /* 忽略 */ }
        }, 15000)
        req.on('close', () => { clearInterval(ping); clients.delete(res) })
        return
      }
      return serveStatic(pathname, res)
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      log('error', '请求失败：' + message)
      return sendJson(res, 500, { ok: false, error: message })
    }
  }

  function serveStatic(pathname, res) {
    let rel = pathname === '/' ? '/index.html' : pathname
    if (rel.startsWith('/static/')) rel = rel.slice('/static'.length)
    const full = resolve(join(STATIC_DIR, rel))
    if (!full.toLowerCase().startsWith(STATIC_DIR.toLowerCase() + sep.toLowerCase())) {
      return sendJson(res, 403, { ok: false, error: '禁止访问' })
    }
    if (!existsSync(full) || !statSync(full).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('404 Not Found')
      return
    }
    res.writeHead(200, {
      'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    createReadStream(full).pipe(res)
    return undefined
  }

  async function close() {
    closed = true
    if (timer) clearTimeout(timer)
    if (heartbeat) clearInterval(heartbeat)
    for (const res of clients) { try { res.end() } catch { /* 忽略 */ } }
    clients.clear()
    try { atomicWriteJson(infoFile, { pid: process.pid, port: 0, url: '', stoppedAt: now() }) } catch { /* 忽略 */ }
    if (server) await new Promise((resolveClose) => server.close(() => resolveClose()))
  }

  async function start() {
    const host = cfg.web.host || '127.0.0.1'
    if (options.singleInstance !== false) {
      const info = readJson(infoFile, null)
      if (info && info.port) {
        try {
          const res = await fetch('http://127.0.0.1:' + info.port + '/api/health', { signal: AbortSignal.timeout(1500) })
          if (res.ok) {
            const url = 'http://' + host + ':' + info.port
            log('info', '学习助手已在运行：' + url)
            if (options.openBrowser !== false) openBrowser(url)
            return { existing: true, port: info.port, url, close: async () => {} }
          }
        } catch { /* 旧实例已退出 */ }
      }
    }
    const port = await pickPort(host, options.port || cfg.web.port)
    currentPort = port
    currentUrl = 'http://' + host + ':' + port
    server = createServer((req, res) => { handle(req, res) })
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(port, host, () => { server.removeListener('error', rejectListen); resolveListen() })
    })
    writeFileSync(infoFile, JSON.stringify({ pid: process.pid, port, url: currentUrl, startedAt: now(), outputDir: cfg.outputDir }, null, 2) + '\n', 'utf8')
    heartbeat = setInterval(() => {
      try { writeFileSync(infoFile, JSON.stringify({ pid: process.pid, port: currentPort, url: currentUrl, at: now() }, null, 2) + '\n', 'utf8') } catch { /* 忽略 */ }
    }, 5000)
    heartbeat.unref?.()
    log('info', '学习助手已启动：' + currentUrl + '（输出目录 ' + cfg.outputDir + '）')
    if (cfg.enabled && live.watchSupported) schedule(500)
    else if (cfg.enabled && !live.watchSupported) {
      live.decision = 'watch-unsupported'
      log('warn', '当前平台（' + live.platform + '）不支持自动读取前台窗口，已忽略自动检测；请用「立即扫描」或导入文本。')
    }
    if (options.openBrowser !== false) openBrowser(currentUrl)
    return { existing: false, port, url: currentUrl, close }
  }

  return { start, close, snapshot }
}
