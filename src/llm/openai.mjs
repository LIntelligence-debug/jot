/**
 * OpenAI 兼容协议 provider：POST {baseURL}/chat/completions
 * 适配：Ollama（/v1）、LM Studio、vLLM、DeepSeek 兼容端点、OpenAI 官方。
 */

export class LlmError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'LlmError'
    this.code = options.code || 'LLM'
    this.status = options.status
    this.detail = options.detail
  }
}

export function joinUrl(base, path) {
  return String(base || '').replace(/\/+$/, '') + path
}

function friendly(status, detail) {
  if (status === 401 || status === 403) return new LlmError('鉴权失败（' + status + '）：请检查 API Key 环境变量是否设置正确。', { code: 'AUTH', status, detail })
  if (status === 429) return new LlmError('请求过于频繁或额度不足（429），请稍后再试。', { code: 'RATE', status, detail })
  if (status >= 500) return new LlmError('模型服务暂时不可用（' + status + '），请稍后重试。', { code: 'SERVER', status, detail })
  return new LlmError('模型请求失败（' + status + '）：' + String(detail || '').slice(0, 300), { code: 'HTTP', status, detail })
}

export function createOpenAiProvider(cfg) {
  const llm = cfg.llm
  const apiKey = () => (llm.apiKey || process.env[llm.apiKeyEnv || 'STUDY_LLM_API_KEY'] || '').trim()

  return {
    id: 'openai',
    label: 'OpenAI 兼容 · ' + llm.model,
    mode: 'openai',
    hasAuth() {
      return apiKey() !== ''
    },
    async complete({ system, user, maxTokens, timeoutMs, temperature }) {
      if (!apiKey()) throw new LlmError('未设置 API Key：请设置环境变量 ' + (llm.apiKeyEnv || 'STUDY_LLM_API_KEY'), { code: 'AUTH' })
      const body = {
        model: llm.model,
        messages: [
          { role: 'system', content: String(system || '') },
          { role: 'user', content: String(user || '') },
        ],
        temperature: typeof temperature === 'number' ? temperature : llm.temperature,
        max_tokens: maxTokens || llm.maxTokens,
        stream: false,
      }
      const started = Date.now()
      let res
      try {
        res = await fetch(joinUrl(llm.baseURL, '/chat/completions'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + apiKey(),
          },
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
      const content = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || ''
      return {
        text: String(content),
        usage: json.usage || null,
        ms: Date.now() - started,
        model: llm.model,
      }
    },
    async listModels() {
      if (!apiKey()) return { ok: false, error: '未设置 API Key' }
      try {
        const res = await fetch(joinUrl(llm.baseURL, '/models'), {
          headers: { authorization: 'Bearer ' + apiKey() },
          signal: AbortSignal.timeout(15000),
        })
        const text = await res.text()
        if (!res.ok) return { ok: false, error: friendly(res.status, text).message }
        const json = JSON.parse(text)
        const models = (json.data || []).map((m) => m.id).filter(Boolean)
        return { ok: true, models }
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) }
      }
    },
  }
}
