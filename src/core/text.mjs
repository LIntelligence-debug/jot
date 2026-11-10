/**
 * jot / 离线文本工具
 *
 * 纯 Node 内置实现、零第三方依赖、ESM。
 * 所有函数都是纯函数：相同输入必然得到相同输出（排序都带稳定的次序兜底）。
 * 主要服务于 src/core/offline.mjs 的抽取式摘要，也可以被渲染层或测试直接复用。
 */

// ── 正则与常量 ───────────────────────────────────────────────

// 汉字范围：基本区 + 扩展 A + 兼容区（覆盖常见中文文本）
const CJK_CHAR_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const CJK_RUN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g
const WORD_RE = /[A-Za-z][A-Za-z0-9_'-]*/g
const NUMBER_RE = /\d+(?:\.\d+)?/g
const MEANINGFUL_RE = /[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]/

// 句界：中文/英文句末标点、分号、换行、省略号、连续句点
const SENTENCE_DELIM_RE = /[。！？!?；;…]+|\.{2,}|\n+/g
// 英文句点 + 空格 + 大写/数字开头，视为一句结束（避免英文整段不拆句）
const ENGLISH_PERIOD_RE = /([A-Za-z0-9]{2,})\.(\s+)(?=[A-Z0-9])/g
// 列表项前缀（"- "、"1. "、"（1）" 等），分句后去掉
const LEADING_BULLET_RE = /^(?:[-*+•·●▪◦]|\d{1,3}[.、)）]|[（(]\d{1,3}[)）])\s*/

// 高频虚词（单字）：n-gram 首尾命中即视为噪声
const STOP_CHARS = new Set(
  (
    '的了着过是在和与及或就也都而這这那有我你他她它们个上下中里后前时对从到把被让使为以于所其之等' +
    '很更最还又但却并且如若因所以如果因为虽然但是然后因此然而而且不过只是这样那样一些什么怎么' +
    '如何为什么没有不是就是还是'
  ).split(''),
)

// 英文停用词
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its',
  'as', 'at', 'by', 'from', 'we', 'you', 'they', 'he', 'she', 'i', 'not', 'no', 'if',
  'then', 'than', 'so', 'such', 'can', 'could', 'should', 'would', 'may', 'might',
  'will', 'just', 'about', 'into', 'over', 'after', 'before', 'between', 'there',
  'their', 'our', 'your', 'his', 'her', 'them', 'us', 'do', 'does', 'did', 'has',
  'have', 'had', 'but', 'also', 'more', 'most', 'some', 'any', 'all', 'each', 'every',
  'which', 'who', 'when', 'where', 'why', 'how', 'what', 'use', 'used', 'using',
])

// ── 基础工具 ────────────────────────────────────────────────

/**
 * 规范化空白：去 BOM/零宽字符、统一换行、各类空格转半角、压缩行内空白与空行。
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeSpace(input) {
  if (input === null || input === undefined) return ''
  let text = String(input)
  // BOM、零宽字符、双向控制字符
  text = text.replace(/^\uFEFF/, '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
  // 统一换行
  text = text.replace(/\r\n?/g, '\n')
  // 各类空格（NBSP、全角空格等）转普通空格
  text = text.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
  // 行内空白压缩、去行尾空白
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trimEnd())
    .join('\n')
  // 压缩空行：最多保留一个空行
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

/**
 * 按字符数截断（超出时以省略号收尾）。
 * @param {unknown} input
 * @param {number} max 最大字符数
 * @param {string} tail 截断后缀
 * @returns {string}
 */
export function truncate(input, max = 120, tail = '…') {
  const text = normalizeSpace(input)
  const limit = Math.max(1, Math.floor(Number(max) || 1))
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  const tailChars = Array.from(String(tail ?? ''))
  if (limit <= tailChars.length) return chars.slice(0, limit).join('')
  return chars.slice(0, limit - tailChars.length).join('').trimEnd() + tailChars.join('')
}

/**
 * 字符串数组去空、去重（保留首次出现顺序）。
 * @param {unknown[]} list
 * @returns {string[]}
 */
export function uniqueStrings(list) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const text = normalizeSpace(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function clampInt(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.floor(num)))
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

// ── 分句 ────────────────────────────────────────────────────

/**
 * 中英文分句：按 。！？!?；;… 换行与省略号切分，去掉列表符号与空句，去重且保留原序。
 * @param {unknown} input
 * @returns {string[]}
 */
export function splitSentences(input) {
  let text = normalizeSpace(input)
  if (!text) return []
  // 英文句点分句：先变成换行，再统一走后面的分隔符逻辑
  text = text.replace(ENGLISH_PERIOD_RE, '$1\n')
  const parts = text.split(SENTENCE_DELIM_RE)
  const out = []
  const seen = new Set()
  for (const part of parts) {
    const sentence = cleanSentencePart(part)
    if (!sentence || sentence.length < 2) continue
    if (!MEANINGFUL_RE.test(sentence)) continue // 纯符号片段丢弃
    if (seen.has(sentence)) continue
    seen.add(sentence)
    out.push(sentence)
  }
  return out
}

function cleanSentencePart(part) {
  let text = String(part ?? '').trim()
  // 去掉可能的列表序号/项目符号
  for (let i = 0; i < 2; i++) text = text.replace(LEADING_BULLET_RE, '').trim()
  text = text
    .replace(/^[\s,，、:：;；.。!！?？…]+/, '')
    .replace(/[\s,，、:：;；.。!！?？…]+$/, '')
  return text
}

// ── 分词 ────────────────────────────────────────────────────

/**
 * 分词：中文 2~4 字滑窗 n-gram + 英文/数字单词（小写）。
 * 返回词项数组，允许重复（便于外部统计词频）。
 * @param {unknown} input
 * @returns {string[]}
 */
export function tokenize(input) {
  const text = normalizeSpace(input)
  if (!text) return []
  const tokens = []
  let match

  CJK_RUN_RE.lastIndex = 0
  while ((match = CJK_RUN_RE.exec(text)) !== null) {
    const run = match[0]
    for (let size = 2; size <= 4; size++) {
      for (let i = 0; i + size <= run.length; i++) tokens.push(run.slice(i, i + size))
    }
  }

  WORD_RE.lastIndex = 0
  while ((match = WORD_RE.exec(text)) !== null) {
    const word = match[0].toLowerCase().replace(/^[-']+|[-']+$/g, '')
    if (word) tokens.push(word)
  }

  NUMBER_RE.lastIndex = 0
  while ((match = NUMBER_RE.exec(text)) !== null) tokens.push(match[0])

  return tokens
}

// ── 句子打分 ────────────────────────────────────────────────

/**
 * 句子打分：标题关键词重合 + 关键词密度 + 位置加权 + 长度惩罚。
 * @param {unknown} sentences
 * @param {{ titleTerms?: string[] }} [options]
 * @returns {{ sentence: string, index: number, score: number }[]}
 */
export function rankSentences(sentences, options = {}) {
  const source = Array.isArray(sentences) ? sentences : []
  const list = source.map((item) => normalizeSpace(item)).filter((item) => item.length >= 2)
  if (!list.length) return []

  const titleTerms = uniqueStrings(
    (Array.isArray(options.titleTerms) ? options.titleTerms : [])
      .map((term) => normalizeSpace(term).toLowerCase())
      .filter((term) => term.length >= 2),
  )

  // 统计“出现在多少个句子里”，比总词频更能代表全局关键词
  const tokenSets = []
  const df = new Map()
  for (const sentence of list) {
    const set = new Set(tokenize(sentence.toLowerCase()))
    tokenSets.push(set)
    for (const token of set) df.set(token, (df.get(token) || 0) + 1)
  }
  let maxDf = 1
  for (const value of df.values()) if (value > maxDf) maxDf = value

  const scored = list.map((sentence, index) => {
    const tokens = tokenSets[index]
    let keywordSum = 0
    for (const token of tokens) {
      const count = df.get(token) || 0
      if (count >= 2) keywordSum += count / maxDf
    }
    const density = tokens.size ? keywordSum / Math.sqrt(tokens.size) : 0

    const lower = sentence.toLowerCase()
    let titleHits = 0
    for (const term of titleTerms) if (lower.includes(term)) titleHits++

    const positionBoost =
      index === 0 ? 1 : index === 1 ? 0.6 : index === 2 ? 0.4 : index === list.length - 1 ? 0.2 : 0

    const length = sentence.length
    let lengthPenalty = 1
    if (length < 12) lengthPenalty = 0.45
    else if (length < 20) lengthPenalty = 0.75
    else if (length > 160) lengthPenalty = 0.7
    else if (length > 120) lengthPenalty = 0.85

    const score = Math.round((density * 2 + titleHits * 1.2 + positionBoost) * lengthPenalty * 1e6) / 1e6
    return { sentence, index, score }
  })

  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored
}

// ── 关键词抽取 ──────────────────────────────────────────────

/**
 * 抽取高频关键词：去停用词后的中英混合词项，按 词频×词长 排序，并去掉高度重叠的片段。
 * @param {unknown} input
 * @param {number} [limit]
 * @returns {{ term: string, count: number }[]}
 */
export function extractKeywords(input, limit = 10) {
  const text = normalizeSpace(input)
  const max = clampInt(limit, 1, 50, 10)
  const counts = new Map()

  for (const term of tokenize(text)) {
    if (!isCandidateTerm(term)) continue
    counts.set(term, (counts.get(term) || 0) + 1)
  }

  const candidates = []
  for (const [term, count] of counts) {
    const lengthBonus = 1 + 0.2 * (Array.from(term).length - 2)
    candidates.push({ term, count, score: count * lengthBonus })
  }
  candidates.sort(
    (a, b) => b.score - a.score || b.count - a.count || compareText(a.term, b.term),
  )

  const picked = []
  for (const item of candidates) {
    if (picked.length >= max) break
    if (picked.some((prev) => termOverlaps(prev.term, item.term))) continue
    picked.push({ term: item.term, count: item.count })
  }
  return picked
}

function isCjkTerm(term) {
  const chars = Array.from(term)
  return chars.length > 0 && chars.every((ch) => CJK_CHAR_RE.test(ch))
}

function isCandidateTerm(term) {
  if (!term || term.length < 2) return false
  if (/^[a-z]/.test(term)) {
    if (!/^[a-z][a-z0-9_'-]*$/.test(term)) return false
    return !STOP_WORDS.has(term)
  }
  if (/^[0-9.]+$/.test(term)) return false
  if (!isCjkTerm(term)) return false
  const chars = Array.from(term)
  if (chars.length < 2 || chars.length > 4) return false
  // 首尾是虚词视为噪声片段（如“的是”“数的”）
  if (STOP_CHARS.has(chars[0]) || STOP_CHARS.has(chars[chars.length - 1])) return false
  return true
}

function termOverlaps(a, b) {
  if (a === b || a.includes(b) || b.includes(a)) return true
  const setA = charSet(normalizeForSimilarity(a))
  const setB = charSet(normalizeForSimilarity(b))
  return jaccard(setA, setB) >= 0.6
}

// ── 相似度去重 ──────────────────────────────────────────────

/**
 * 按字符集合相似度（Jaccard）去重，保留首次出现的条目。
 * @param {unknown[]} items
 * @param {{ key?: string | ((item: unknown) => string), threshold?: number }} [options]
 * @returns {unknown[]}
 */
export function dedupeBySimilarity(items, options = {}) {
  const list = Array.isArray(items) ? items : []
  const rawThreshold = Number(options.threshold)
  const threshold = Number.isFinite(rawThreshold) ? Math.min(1, Math.max(0, rawThreshold)) : 0.8
  const key = options.key
  const getKey =
    typeof key === 'function'
      ? key
      : (item) => {
          if (typeof item === 'string') return item
          if (item && typeof item === 'object' && key !== undefined && key !== null) {
            return String(item[key] ?? '')
          }
          return String(item ?? '')
        }

  const kept = []
  const keptSets = []
  const seenExact = new Set()
  for (const item of list) {
    const normalized = normalizeForSimilarity(getKey(item))
    if (!normalized) continue
    if (seenExact.has(normalized)) continue
    const set = charSet(normalized)
    let duplicate = false
    for (const previous of keptSets) {
      if (jaccard(previous, set) >= threshold) {
        duplicate = true
        break
      }
    }
    if (duplicate) continue
    seenExact.add(normalized)
    kept.push(item)
    keptSets.push(set)
  }
  return kept
}

/**
 * 字符集合的 Jaccard 相似度（0~1）。
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
export function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const ch of a) if (b.has(ch)) intersection++
  return intersection / (a.size + b.size - intersection)
}

function charSet(text) {
  return new Set(Array.from(text))
}

function normalizeForSimilarity(input) {
  return normalizeSpace(input).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}
