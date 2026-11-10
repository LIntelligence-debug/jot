/**
 * 大模型接入入口：
 * - createProvider(cfg)：按 cfg.llm.mode 选择 provider（offline 返回 null）；
 * - generateSummary(cfg, input, logger)：统一「模型优先 / 失败回退离线」的摘要生成；
 * - 宽松 JSON 解析 + 一次重试 + 用量日志。
 */
import { buildMessages } from '../core/prompt.mjs'
import { summarizeOffline } from '../core/offline.mjs'
import { createOpenAiProvider, LlmError } from './openai.mjs'
import { createAnthropicProvider } from './anthropic.mjs'

export { LlmError }

export const PROVIDER_LABELS = {
  offline: '离线模板引擎',
  openai: 'OpenAI 兼容接口',
  anthropic: 'Anthropic 兼容接口',
}

export function createProvider(cfg) {
  const mode = cfg?.llm?.mode
  if (mode === 'openai') return createOpenAiProvider(cfg)
  if (mode === 'anthropic') return createAnthropicProvider(cfg)
  return null
}

export function isOfflineMode(cfg) {
  return !cfg?.llm?.mode || cfg.llm.mode === 'offline'
}

/** 解析模型输出：容忍 markdown 代码块、前后废话、尾逗号、单引号。 */
export function parseJsonLoose(text) {
  if (!text) return null
  const t = String(text).trim()
  try { return JSON.parse(t) } catch { /* 继续 */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) {
    try { return JSON.parse(fence[1].trim()) } catch { /* 继续 */ }
  }
  const start = t.indexOf('{')
  if (start < 0) return null
  const candidates = []
  let end = t.lastIndexOf('}')
  while (end > start) {
    candidates.push(t.slice(start, end + 1))
    end = t.lastIndexOf('}', end - 1)
  }
  for (const candidate of candidates) {
    try { return JSON.parse(candidate) } catch { /* 继续 */ }
  }
  for (const candidate of candidates) {
    try {
      const fixed = candidate
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
      return JSON.parse(fixed)
    } catch { /* 继续 */ }
  }
  return null
}

function asStringArray(value, max = 30) {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : v && typeof v === 'object' ? String(v.text ?? v.title ?? '').trim() : ''))
    .filter(Boolean)
    .slice(0, max)
}

function asPointArray(value, max = 30) {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => {
      if (typeof v === 'string') return { point: v.trim(), detail: '' }
      if (v && typeof v === 'object') {
        return { point: String(v.point ?? v.title ?? '').trim(), detail: String(v.detail ?? v.explain ?? v.description ?? '').trim() }
      }
      return null
    })
    .filter((v) => v && v.point)
    .slice(0, max)
}

function asTermArray(value, max = 20) {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => {
      if (typeof v === 'string') return { term: v.trim(), explain: '' }
      if (v && typeof v === 'object') return { term: String(v.term ?? v.name ?? '').trim(), explain: String(v.explain ?? v.detail ?? '').trim() }
      return null
    })
    .filter((v) => v && v.term)
    .slice(0, max)
}

function normalizeMindmap(node, depth = 0) {
  if (depth > 3 || !node || typeof node !== 'object') return null
  const title = String(node.title ?? node.name ?? '').trim()
  if (!title) return null
  const children = Array.isArray(node.children)
    ? node.children.map((c) => normalizeMindmap(c, depth + 1)).filter(Boolean).slice(0, 12)
    : []
  return { title, children }
}

/** 把模型返回的 JSON 规范成与离线引擎一致的 summary 结构。 */
export function normalizeSummary(raw, fallbackTitle = '') {
  const s = raw && typeof raw === 'object' ? raw : {}
  return {
    overview: String(s.overview ?? s.summary ?? '').trim(),
    knowledgePoints: asPointArray(s.knowledgePoints ?? s.keyPoints),
    keyTerms: asTermArray(s.keyTerms ?? s.terms),
    studyTips: asStringArray(s.studyTips ?? s.examTips),
    pitfalls: asStringArray(s.pitfalls),
    reviewQuestions: asStringArray(s.reviewQuestions),
    mindmap: normalizeMindmap(s.mindmap) ?? { title: fallbackTitle || '课程知识地图', children: [] },
    generatedBy: 'llm',
  }
}

function logUsage(logger, usage, providerLabel) {
  if (!usage || !logger) return
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0
  if (input || output) logger.info('模型用量（' + providerLabel + '）：输入 ' + input + ' tokens / 输出 ' + output + ' tokens')
}

/**
 * 生成结构化摘要：离线模式直接用离线引擎；模型模式失败时按配置回退离线引擎。
 * @returns {Promise<{summary:object, generatedBy:'offline'|'llm'|'offline-fallback', provider:string|null, model:string|null, warning:string|null}>}
 */
export async function generateSummary({ cfg, input, logger, provider }) {
  const offline = () => summarizeOffline({ ...input, cfg })

  if (isOfflineMode(cfg)) {
    return { summary: offline(), generatedBy: 'offline', provider: null, model: null, warning: null }
  }

  const p = provider || createProvider(cfg)
  if (!p || !p.hasAuth()) {
    const warning = '未配置 API Key（环境变量 ' + (cfg.llm.apiKeyEnv || 'STUDY_LLM_API_KEY') + '），已使用离线引擎。'
    if (logger) logger.warn(warning)
    return { summary: offline(), generatedBy: 'offline-fallback', provider: null, model: null, warning }
  }

  const messages = buildMessages({ ...input, cfg })
  const maxTokens = cfg.llm.maxTokens || 4096
  const timeoutMs = cfg.llm.timeoutMs || 120000

  let lastError = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await p.complete({
        system: messages.system,
        user: attempt === 0 ? messages.user : messages.user + '\n\n（上一次回复不是合法 JSON。请严格只输出 JSON 对象本身，不要任何解释或代码块。）',
        maxTokens,
        timeoutMs,
      })
      logUsage(logger, result.usage, p.label)
      if (logger) logger.info('模型返回 ' + (result.ms ? Math.round(result.ms / 100) / 10 + ' 秒' : '完成') + '，正在解析…')
      const parsed = parseJsonLoose(result.text)
      if (parsed) {
        const summary = normalizeSummary(parsed, input.title)
        if (!summary.knowledgePoints.length) throw new LlmError('模型返回的 JSON 缺少 knowledgePoints', { code: 'PARSE' })
        return { summary, generatedBy: 'llm', provider: p.id, model: cfg.llm.model, warning: null }
      }
      lastError = new LlmError('模型返回内容无法解析为 JSON', { code: 'PARSE' })
    } catch (error) {
      lastError = error
      if (logger) logger.warn('模型调用失败（第 ' + (attempt + 1) + ' 次）：' + (error && error.message ? error.message : error))
      if (error && error.code === 'AUTH') break
    }
  }

  if (cfg.llm.fallbackToOffline === false) throw lastError
  const warning = '模型调用失败，已回退离线引擎：' + (lastError && lastError.message ? lastError.message : lastError)
  if (logger) logger.warn(warning)
  return { summary: offline(), generatedBy: 'offline-fallback', provider: null, model: null, warning }
}

/** 测试连接：发一个极小的请求，返回可用性与耗时。 */
export async function testConnection(cfg) {
  if (isOfflineMode(cfg)) {
    return { ok: true, mode: 'offline', message: '当前为离线模式，不需要联网；笔记由本地模板引擎生成。', ms: 0 }
  }
  const p = createProvider(cfg)
  if (!p.hasAuth()) {
    return { ok: false, mode: cfg.llm.mode, error: '未设置 API Key：请设置环境变量 ' + (cfg.llm.apiKeyEnv || 'STUDY_LLM_API_KEY') }
  }
  const started = Date.now()
  try {
    const r = await p.complete({ system: '你是连接测试助手，只回复 OK。', user: 'ping', maxTokens: 8, timeoutMs: 20000 })
    return {
      ok: true,
      mode: cfg.llm.mode,
      model: cfg.llm.model,
      ms: Date.now() - started,
      reply: String(r.text || '').slice(0, 40),
    }
  } catch (error) {
    return { ok: false, mode: cfg.llm.mode, error: String(error && error.message ? error.message : error), ms: Date.now() - started }
  }
}

/** 拉取模型列表（仅 OpenAI 兼容模式支持）。 */
export async function listModels(cfg) {
  if (isOfflineMode(cfg)) return { ok: true, models: ['offline（本地模板引擎，不需要模型）'] }
  const p = createProvider(cfg)
  if (!p.hasAuth()) return { ok: false, models: [], error: '未设置 API Key：请设置环境变量 ' + (cfg.llm.apiKeyEnv || 'STUDY_LLM_API_KEY') }
  return p.listModels()
}
