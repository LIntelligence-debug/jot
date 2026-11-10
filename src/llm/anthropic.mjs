/**
 * Anthropic 兼容协议 provider：POST {baseURL}/v1/messages
 * 适配：DeepSeek Anthropic 端点（https://api.deepseek.com/anthropic）、Anthropic 官方等。
 * 鉴权头默认 x-api-key，可用 llm.authHeader 改成其他头名（如网关自定义的 x-api-token）。
 */
import { LlmError, joinUrl } from './openai.mjs'

function friendly(status, detail) {
  if (status === 401 || status === 403) return new LlmError('鉴权失败（' + status + '）：请检查 API Key 环境变量是否设置正确。', { code: 'AUTH', status, detail })
  if (status === 429) return new LlmError('请求过于频繁或额度不足（429），请稍后再试。', { code: 'RATE', status, detail })
  if (status >= 500) return new LlmError('模型服务暂时不可用（' + status + '），请稍后重试。', { code: 'SERVER', status, detail })
  return new LlmError('模型请求失败（' + status + '）：' + String(detail || '').slice(0, 300), { code: 'HTTP', status, detail })
}

export function messagesUrl(baseURL) {
  const base = String(baseURL || '').replace(/\/+$/, '')
  return base.endsWith('/v1') ? base + '/messages' : base + '/v1/messages'
}

export function createAnthropicProvider(cfg) {
  const llm = cfg.llm
  const apiKey = () => (llm.apiKey || process.env[llm.apiKeyEnv || 'STUDY_LLM_API_KEY'] || '').trim()
  const headerName = llm.authHeader || 'x-api-key'

  return {
    id: 'anthropic',
    label: 'Anthropic 兼容 · ' + llm.model,
    mode: 'anthropic',
    hasAuth() {
      return apiKey() !== ''
    },
    async complete({ system, user, maxTokens, timeoutMs, temperature }) {
      if (!apiKey()) throw new LlmError('未设置 API Key：请设置环境变量 ' + (llm.apiKeyEnv || 'STUDY_LLM_API_KEY'), { code: 'AUTH' })
      const body = {
        model: llm.model,
        max_tokens: maxTokens || llm.maxTokens,
        system: String(system || ''),
        messages: [{ role: 'user', content: [{ type: 'text', text: String(user || '') }] }],
        stream: false,
      }
      if (typeof temperature === 'number') body.temperature = temperature
      const headers = {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      }
      headers[headerName] = apiKey()
      const started = Date.now()
      let res
      try {
        res = await fetch(messagesUrl(llm.baseURL), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs || llm.timeoutMs),
        })
      } catch (error) {
        throw new LlmError('无法连接模型服务：' + String(error && error.message ? error.message : error), { code: 'NETWORK' })
      }
      const text = await res.text().catch(() => '')
      if (!res.ok) throw friendly(res.status, text)
      let json
      try { json = JSON.parse(text) } catch {
        throw new LlmError('模型返回的不是 JSON：' + text.slice(0, 200), { code: 'PARSE' })
      }
      const content = (json.content || []).map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('')
      return {
        text: String(content),
        usage: json.usage || null,
        ms: Date.now() - started,
        model: llm.model,
      }
    },
    async listModels() {
      return { ok: false, models: [], error: 'Anthropic 兼容协议没有模型列表接口，请直接填写模型名' }
    },
  }
}
