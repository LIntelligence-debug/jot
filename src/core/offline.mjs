/**
 * jot / 离线摘要引擎
 *
 * 在完全不联网、不调用任何大模型的前提下，把「标题 + 用户粘贴的学习材料」
 * 整理成与渲染层（src/core/render.mjs）约定一致的结构化 summary。
 *
 * 两条路径：
 *  1) 有可用文本：抽取式摘要（只从原文句中抽取/拼接，不补充原文之外的具体结论）；
 *  2) 只有标题：学习框架笔记（overview 明确标注「离线模板整理（未接入大模型）」）。
 *
 * 全部为确定性纯函数：相同输入 ⇒ 相同输出；零第三方依赖，只用 Node 内置能力。
 */

import {
  normalizeSpace,
  splitSentences,
  tokenize,
  rankSentences,
  extractKeywords,
  dedupeBySimilarity,
  truncate,
  uniqueStrings,
} from './text.mjs'

// ── 常量 ────────────────────────────────────────────────────

const MAX_TEXT_CHARS = 20000
const MAX_SENTENCES = 600
const POINT_MAX = 24
const DETAIL_MAX = 120
const MIN_TEXT_POINTS = 8
const MAX_TEXT_POINTS = 20
const MAX_KEY_TERMS = 12
const MAX_STUDY_TIPS = 6
const MAX_PITFALLS = 6
const MAX_QUESTIONS = 10
const MEANINGFUL_RE = /[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]/

// 「重点 / 易错」句子的触发词（只用于识别用户导入材料里的重点句，输出不预设考试框架）
const STUDY_HINT_RE = /考点|常考|必考|重点|难点|分值|题型|考核|考查/
const PITFALL_HINT_RE = /易错|容易混|注意区别|不要|误区|易混|混淆|陷阱|注意区分|错误/

// 句子开头的口头填充词（生成知识点标题时剥掉）
const LEADING_FILLERS = [
  '那么', '首先', '然后', '其次', '接下来', '因此', '所以', '但是', '而且', '不过',
  '另外', '我们', '大家', '这个', '那个', '本节', '今天', '其实', '就是说', '可以说',
  '比如说', '例如', '总之', '综上', '简单来说', '实际上', '注意', '记住', '学习',
  '重点是', '重点在于', '要点是', '关键是', '主要是', '其中', '尤其是', '特别是',
]

// 术语里常见的动词/填充前缀：抽取到的“学习函数”“先要判断函数”会被剥成“函数”
const TERM_PREFIX_NOISE = [
  '我们', '大家', '本节', '这个', '那个', '这些', '那些', '一种', '一个', '两个',
  '几个', '各个', '先要', '首先', '然后', '其次', '如果', '因为', '所以', '但是',
  '而且', '不过', '这是', '那是', '其中', '以及', '就是', '还是', '学习', '判断',
  '计算', '求出', '使用', '进行', '得到', '出现', '考虑', '需要', '可以', '能够',
  '通过', '利用', '知道', '掌握', '理解', '注意', '记住', '整理', '记录', '回到',
]

// 过于泛化的“术语”，不进 keyTerms（避免「基本概念」「步骤」这类空话占位）
const GENERIC_TERMS = new Set([
  '基本概念', '常用计算方法', '常用方法', '主要内容', '基本内容', '核心内容',
  '学习目标', '基础知识', '方法', '概念', '定义', '条件', '结论', '性质', '原理',
  '规则', '公式', '题目', '例题', '内容', '问题', '知识', '部分', '情况', '要求',
  '方面', '过程', '结果', '特点', '关系', '作用', '意义', '影响', '步骤', '技巧',
  '法则', '定理', '公式', '题型', '结论', '本节', '计算', '定式', '课堂', '知识点',
])

// 常见学科术语后缀（用于「XX函数/公式/定理/法则/机制」模式抽取）
const TERM_SUFFIXES = [
  '函数', '公式', '定理', '法则', '机制', '定义', '原理', '性质', '方程', '不等式',
  '导数', '微分', '积分', '极限', '分布', '定律', '模型', '算法', '结构', '步骤',
  '条件', '结论', '规则', '概念', '方法', '技巧', '题型', '无穷小', '无穷大',
  '连续性', '可导性', '单调性', '奇偶性', '周期性', '定义域', '值域', '向量',
  '矩阵', '行列式', '概率', '期望', '方差', '级数', '收敛', '发散', '替换', '判定',
]
const SUFFIX_PATTERN = TERM_SUFFIXES.slice().sort((a, b) => b.length - a.length).join('|')
const SUFFIX_TERM_RE = new RegExp('([\\u4e00-\\u9fa5]{2,4}(?:' + SUFFIX_PATTERN + '))', 'g')
const QUOTED_TERM_RE = /[《「『“"]([^《》「」『』“”"]{2,16})[》」』”"]/g
const TERM_EDGE_STOP = new Set(
  '的了着过是在和与及或就也都而這这那有我你他她它们个把被让使为以于所其之等很更最还又但却并且如若因因此然后而且不过只是这样'.split(''),
)
// 术语开头允许保留“等/是”等有实义的字（等价、等于），只剥除纯虚词
const TERM_LEADING_STOP = new Set(
  '的了着过在和与及或就也都而這这那有我你她它们个把被让为以于所其之很更最还又但却并且如若因因此然后而且不过只是这样'.split(''),
)
// 术语内部出现这些句子连接/动词时视为原句片段，直接丢弃
const TERM_INNER_NOISE = new Set([
  '是', '把', '于', '使', '得', '再', '就', '都', '也', '但', '而', '却', '被', '让',
  '给', '与', '和', '及', '或',
])
// 判定“词边界”时，前一个字符属于这些虚词才允许开始一个新术语
const TERM_BOUNDARY_STOP = new Set('的了着过是在和与及或、把被让为以于所其之等'.split(''))

// 自测题模板：按知识点依次套用，保证确定性
const QUESTION_TEMPLATES = [
  (point) => `${point}是什么？请用一句话概括。`,
  (point) => `${point}的适用条件与使用场景是什么？`,
  (point) => `如何用「${point}」解决本节题目？请写出关键步骤。`,
  (point) => `请举一个例子说明「${point}」的应用。`,
  (point) => `「${point}」最容易与哪些内容混淆？如何区分？`,
  (point) => `用「${point}」完成一道基础练习，并检查每一步的依据。`,
]

// ── 主入口 ──────────────────────────────────────────────────

/**
 * 离线摘要入口。
 * @param {{
 *   title?: string,
 *   subject?: string,
 *   keywords?: string[],
 *   text?: string | string[],
 *   cfg?: object,
 * }} [input]
 * @returns {{
 *   overview: string,
 *   knowledgePoints: { point: string, detail: string }[],
 *   keyTerms: { term: string, explain: string }[],
 *   studyTips: string[],
 *   pitfalls: string[],
 *   reviewQuestions: string[],
 *   mindmap: { title: string, children: { title: string, children: { title: string }[] }[] },
 *   generatedBy: 'offline',
 * }}
 */
export function summarizeOffline(input = {}) {
  const options = input && typeof input === 'object' ? input : {}

  const title = truncate(normalizeSpace(options.title), 80)
  if (!title) throw new TypeError('summarizeOffline: 需要非空的标题 title')

  const subject = truncate(normalizeSpace(options.subject), 30)
  const keywords = uniqueStrings(
    (Array.isArray(options.keywords) ? options.keywords : []).map((item) =>
      truncate(normalizeSpace(item), 16),
    ),
  ).slice(0, 12)

  const cfg = readOfflineConfig(options.cfg)
  const rawText = Array.isArray(options.text) ? options.text.join('\n') : options.text
  const fullText = normalizeSpace(rawText)
  const text = fullText.slice(0, cfg.maxTextChars)
  const sentences = text ? splitSentences(text).slice(0, MAX_SENTENCES) : []

  const hasText =
    text.length >= 20 && sentences.length >= 3 && looksLikeCourseText(text)
  // 用户确实粘贴了文本，但篇幅/有效内容不足：给出「已导入但过短」的明确提示，
  // 避免用户误以为导入的文本被丢弃（overview 里同时保留离线模板说明）。
  const shortText = !hasText && fullText.length > 0
  const textLength = Array.from(fullText).length

  const summary = hasText
    ? buildTextSummary({ title, subject, keywords, text, sentences, cfg })
    : buildFrameworkSummary({ title, subject, keywords, cfg, shortText, textLength })

  return finalizeSummary(summary, title)
}

// ── 配置读取 ────────────────────────────────────────────────

function readOfflineConfig(raw) {
  const offline =
    raw && typeof raw === 'object' && raw.offline && typeof raw.offline === 'object'
      ? raw.offline
      : {}
  return {
    maxTextChars: clampInt(offline.maxTextChars, 2000, 200000, MAX_TEXT_CHARS),
    maxPoints: clampInt(offline.maxPoints ?? offline.maxKnowledgePoints, MIN_TEXT_POINTS, 20, 20),
    maxKeyTerms: clampInt(offline.maxKeyTerms, 4, MAX_KEY_TERMS, 10),
  }
}

function clampInt(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.floor(num)))
}

/**
 * 判断文本是否像「可整理的学习材料」（而非纯符号/乱码），符号占比过高时回退到标题模板。
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeCourseText(text) {
  const chars = Array.from(text)
  if (!chars.length) return false
  let meaningful = 0
  for (const ch of chars) if (MEANINGFUL_RE.test(ch)) meaningful++
  return meaningful >= 12 && meaningful / chars.length >= 0.2
}

// ── 有文本：抽取式摘要 ──────────────────────────────────────

function buildTextSummary({ title, subject, keywords, text, sentences, cfg }) {
  const titleTerms = buildTitleTerms(title, keywords)
  const ranked = rankSentences(sentences, { titleTerms })
  const keyTerms = buildKeyTerms({
    text,
    sentences,
    titleTerms,
    keywords,
    maxTerms: cfg.maxKeyTerms,
  })
  const knowledgePoints = buildKnowledgePoints({
    ranked,
    titleTerms,
    keyTerms,
    maxPoints: cfg.maxPoints,
  })
  const studyTips = pickHintedSentences(sentences, STUDY_HINT_RE, MAX_STUDY_TIPS)
  const pitfalls = pickHintedSentences(sentences, PITFALL_HINT_RE, MAX_PITFALLS)
  const reviewQuestions = buildReviewQuestions(knowledgePoints)
  const mindmap = buildMindmap(title, knowledgePoints)
  const overview = buildTextOverview({ title, subject, sentences, knowledgePoints, keyTerms })

  return { overview, knowledgePoints, keyTerms, studyTips, pitfalls, reviewQuestions, mindmap }
}

function buildTextOverview({ title, subject, sentences, knowledgePoints, keyTerms }) {
  const core = knowledgePoints
    .slice(0, 3)
    .map((item) => item.point)
    .join('；')
  const parts = [
    `本节《${title}》${subject ? `（${subject}）` : ''}基于用户粘贴的 ${sentences.length} 句学习材料做抽取式整理，共得到 ${knowledgePoints.length} 个知识点、${keyTerms.length} 个术语。`,
  ]
  if (core) parts.push(`核心内容：${core}。`)
  parts.push('本笔记由离线摘要引擎在本地生成（未接入大模型），只摘取原文句子，不补充文本之外的具体结论。')
  return truncate(parts.join(''), 320)
}

/**
 * 生成标题相关的词项（用于句子打分时提升「标题命中」权重）。
 * @param {string} title
 * @param {string[]} keywords
 * @returns {string[]}
 */
function buildTitleTerms(title, keywords) {
  const terms = []
  const seen = new Set()
  const push = (raw) => {
    const term = normalizeSpace(raw)
    const chars = Array.from(term)
    if (chars.length < 2) return
    if (/^[的了与和及或在]|[的了与和及或在]$/.test(term)) return
    if (seen.has(term)) return
    seen.add(term)
    terms.push(term)
  }

  // 标题按标点/空白切段
  const segments = title.split(/[\s\-—_/|｜:：,，、·.。!！?？()（）【】[\]「」《》“”"']+/).filter(Boolean)
  for (const segment of segments) {
    const chars = Array.from(segment)
    if (chars.length >= 2 && chars.length <= 12) push(segment)
  }
  for (const keyword of keywords) push(keyword)
  // 标题里的中文 2~4 字 n-gram
  for (const run of title.match(/[\u4e00-\u9fff]+/g) || []) {
    for (let size = Math.min(4, run.length); size >= 2; size--) {
      for (let i = 0; i + size <= run.length; i++) push(run.slice(i, i + size))
    }
  }
  return terms.slice(0, 30)
}

/**
 * 由打分最高的句子提炼知识点（8~20 条，按得分排序）。
 */
function buildKnowledgePoints({ ranked, titleTerms, keyTerms, maxPoints }) {
  const units = []
  for (const item of ranked) {
    const sentence = item.sentence
    if (sentence.length < 6) continue
    const label = buildPointLabel(sentence, titleTerms)
    if (!label || label.length < 4) continue
    units.push({ point: label, detail: truncate(sentence, DETAIL_MAX) })
  }

  let picked = dedupeBySimilarity(units, { key: 'point', threshold: 0.82 })

  // 句子不够时，用逗号/顿号切出的子句补足，保证至少 8 条知识点
  if (picked.length < MIN_TEXT_POINTS) {
    const extra = []
    for (const item of ranked) {
      for (const clause of splitClauses(item.sentence)) {
        if (clause.length < 8) continue
        const label = truncate(stripLeadingFillers(clause), POINT_MAX)
        if (label.length < 6) continue
        extra.push({ point: label, detail: truncate(clause, DETAIL_MAX) })
      }
      if (picked.length + extra.length >= MIN_TEXT_POINTS * 2) break
    }
    picked = dedupeBySimilarity(picked.concat(extra), { key: 'point', threshold: 0.82 })
  }

  // 仍然不够：用已抽取的术语补足（术语与解释都来自原文，不是编造）
  if (picked.length < MIN_TEXT_POINTS) {
    for (const item of keyTerms) {
      picked.push({
        point: truncate(`${item.term}：${item.explain}`, POINT_MAX),
        detail: truncate(item.explain, DETAIL_MAX),
      })
    }
    picked = dedupeBySimilarity(picked, { key: 'point', threshold: 0.86 })
  }

  return picked.slice(0, maxPoints)
}

/**
 * 从原句中提炼 12~24 字的短标题：剥口头禅 → 取含标题关键词的子句 → 太短则向后拼接。
 */
function buildPointLabel(sentence, titleTerms) {
  const clean = stripLeadingFillers(sentence)
  if (!clean) return ''
  const clauses = splitClauses(clean)
  let picked = ''
  if (clauses.length) {
    const withTitle = clauses.filter((clause) => titleTerms.some((term) => clause.includes(term)))
    picked = withTitle[0] || clauses[0]
    let index = clauses.indexOf(picked)
    while (Array.from(picked).length < 12 && index + 1 < clauses.length) {
      index++
      picked = `${picked}，${clauses[index]}`
    }
  }
  let label = truncate(picked || clean, POINT_MAX)
  if (Array.from(label).length < 12 && Array.from(clean).length > Array.from(label).length) {
    label = truncate(clean, POINT_MAX)
  }
  return label.replace(/[\s,，、:：;；]+$/, '')
}

/**
 * 抽取术语：引号/书名号内容 + 「XX函数/公式/定理/法则…」模式 + 高频 n-gram + 用户关键词。
 */
function buildKeyTerms({ text, sentences, titleTerms, keywords, maxTerms }) {
  const ordered = []
  const seen = new Set()
  const add = (raw, lenient = false) => {
    const term = cleanTerm(raw, { lenient })
    if (!term || GENERIC_TERMS.has(term) || seen.has(term)) return
    seen.add(term)
    ordered.push(term)
  }

  let match
  QUOTED_TERM_RE.lastIndex = 0
  while ((match = QUOTED_TERM_RE.exec(text)) !== null) add(match[1], true)

  SUFFIX_TERM_RE.lastIndex = 0
  while ((match = SUFFIX_TERM_RE.exec(text)) !== null) {
    // 只接受从词边界开始的模式匹配，避免「个容易求极限」这类半截片段
    if (!isTermBoundary(text, match.index)) continue
    add(match[1])
  }

  for (const item of extractKeywords(text, maxTerms * 3)) add(item.term)
  for (const keyword of keywords) add(keyword)
  for (const term of titleTerms) add(term)

  let entries = ordered.map((term, order) => ({
    term,
    order,
    count: countOccurrences(text, term),
  }))
  entries = dedupeBySimilarity(entries, { key: 'term', threshold: 0.9 })
  // 短词若被出现次数相近的长词包含，则丢弃短词（避免「极限」与「函数极限」同时出现）
  entries = entries.filter(
    (item, index) =>
      !entries.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.term.length > item.term.length &&
          other.term.includes(item.term) &&
          other.count * 5 >= item.count * 3,
      ),
  )

  return entries.slice(0, maxTerms).map((item) => ({
    term: truncate(item.term, 16),
    explain: buildExplain(item.term, sentences, text),
  }))
}

function cleanTerm(raw, options = {}) {
  if (typeof raw !== 'string') return ''
  const lenient = options.lenient === true
  let term = normalizeSpace(raw)
    .replace(/^[《「『“"（(【[]+/, '')
    .replace(/[》」』”"）)】\]。，,、；;：:！!？?…]+$/, '')
    .trim()
  term = stripEdgeStops(term)
  // 模式/词频抽到的中文片段做一次降噪（去并列词、去“的”前缀、去动词前缀）
  if (!lenient && /[\u4e00-\u9fff]/.test(term)) {
    term = simplifyCjkTerm(term)
    if (Array.from(term).some((ch) => TERM_INNER_NOISE.has(ch))) return ''
  }
  const chars = Array.from(term)
  if (chars.length < 2 || chars.length > 16) return ''
  if (/[\s，,、：:；;。.!！?？…]/.test(term)) return ''
  if (/^[0-9.]+$/.test(term)) return ''
  if (chars.every((ch) => TERM_EDGE_STOP.has(ch))) return ''
  return term
}

/**
 * 中文术语降噪：
 *  - 「化或等价无穷小」→ 按并列连词切开取最长段 →「等价无穷小」
 *  - 「限的基本概念」→ 去掉“的”之前的部分 →「基本概念」
 *  - 「学习函数」「先要判断函数」→ 去掉动词/填充前缀 →「函数」
 */
function simplifyCjkTerm(term) {
  let text = term
  if (/[与和或及、]/.test(text)) {
    const parts = text.split(/[与和或及、]/).filter((part) => part.length >= 2)
    if (parts.length) {
      parts.sort((a, b) => b.length - a.length || compareText(a, b))
      text = parts[0]
    }
  }
  const deIndex = text.indexOf('的')
  if (deIndex > 0 && text.length - deIndex - 1 >= 2) text = text.slice(deIndex + 1)
  let changed = true
  let guard = 0
  while (changed && guard < 3) {
    changed = false
    guard++
    for (const prefix of TERM_PREFIX_NOISE) {
      if (text.startsWith(prefix) && text.length - prefix.length >= 2) {
        text = text.slice(prefix.length)
        changed = true
        break
      }
    }
  }
  return stripEdgeStops(text)
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function stripEdgeStops(term) {
  let text = term
  while (text.length > 2 && TERM_LEADING_STOP.has(text[0])) text = text.slice(1)
  while (text.length > 2 && TERM_EDGE_STOP.has(text[text.length - 1])) text = text.slice(0, -1)
  return text
}

/**
 * 判断某位置是否为词边界（上一个字符是标点/空白/虚词，或位于文本开头）。
 */
function isTermBoundary(text, index) {
  if (index <= 0) return true
  const previous = text[index - 1]
  if (TERM_BOUNDARY_STOP.has(previous)) return true
  return /[\s，,。、；;：:!！?？…（）()【】《》「」『』“”"'—\-]/.test(previous)
}

function buildExplain(term, sentences, text) {
  const needle = term.toLowerCase()
  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(needle)) return snippetAround(sentence, term, 72)
  }
  const haystack = text.toLowerCase()
  const index = haystack.indexOf(needle)
  if (index >= 0) return snippetAt(text, index, term.length, 72)
  return '（原文未直接展开该术语，建议结合课堂讲解补充定义、符号含义与适用条件）'
}

function snippetAround(sentence, term, maxLength) {
  const index = sentence.toLowerCase().indexOf(term.toLowerCase())
  return snippetAt(sentence, index < 0 ? 0 : index, term.length, maxLength)
}

function snippetAt(text, index, termLength, maxLength) {
  const limit = Math.max(8, maxLength)
  const start = Math.max(
    0,
    Math.min(index - Math.max(0, Math.floor((limit - termLength) / 2)), text.length - limit),
  )
  let snippet = text.slice(start, start + limit)
  if (start > 0) snippet = `…${snippet}`
  if (start + limit < text.length) snippet = `${snippet}…`
  return truncate(snippet, limit + 2)
}

function countOccurrences(text, term) {
  if (!term) return 0
  const haystack = text.toLowerCase()
  const needle = term.toLowerCase()
  let count = 0
  let index = 0
  while (index < haystack.length) {
    const found = haystack.indexOf(needle, index)
    if (found < 0) break
    count++
    index = found + Math.max(1, needle.length)
  }
  return count
}

/**
 * 抽取含提示词的句子（考点 / 易错），去重、限长、限条数。
 */
function pickHintedSentences(sentences, hintRe, max) {
  const picked = []
  for (const sentence of sentences) {
    if (!hintRe.test(sentence)) continue
    if (sentence.length < 6) continue
    picked.push(truncate(sentence, 100))
    if (picked.length >= max) break
  }
  return dedupeBySimilarity(picked, { threshold: 0.82 })
}

function buildReviewQuestions(knowledgePoints) {
  const questions = []
  const count = Math.min(6, knowledgePoints.length)
  for (let i = 0; i < count; i++) {
    const point = truncate(
      knowledgePoints[i].point.replace(/[\s。！？!?；;，,、：:]+$/g, ''),
      30,
    )
    if (!point) continue
    questions.push(QUESTION_TEMPLATES[i % QUESTION_TEMPLATES.length](point))
  }
  return dedupeBySimilarity(questions, { threshold: 0.9 }).slice(0, MAX_QUESTIONS)
}

function buildMindmap(title, knowledgePoints) {
  const children = []
  for (const point of knowledgePoints.slice(0, 6)) {
    children.push({ title: point.point, children: buildSubNodes(point) })
  }
  return { title: truncate(title || '课程知识地图', 40), children }
}

/**
 * 思维导图二级节点：优先取 detail 的子句短语，其次退回词项片段。
 */
function buildSubNodes(point) {
  const nodes = []
  const seen = new Set()
  const push = (raw) => {
    const label = truncate(stripLeadingFillers(raw), 12)
    if (!label || label === point.point || seen.has(label)) return
    seen.add(label)
    nodes.push({ title: label })
  }

  for (const clause of splitClauses(point.detail)) {
    if (clause.length < 4) continue
    push(clause)
    if (nodes.length >= 3) break
  }
  if (!nodes.length) {
    for (const item of extractKeywords(point.detail, 2)) {
      if (!point.point.includes(item.term)) push(item.term)
      if (nodes.length >= 2) break
    }
  }
  return nodes
}

/**
 * 按逗号/顿号/冒号等切子句，用于知识点标题与补充单元。
 */
function splitClauses(input) {
  return normalizeSpace(input)
    .split(/[，,、：:；;]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

/**
 * 去掉句首口头填充词与标点。
 */
function stripLeadingFillers(input) {
  let text = normalizeSpace(input)
  for (let i = 0; i < 3; i++) {
    const filler = LEADING_FILLERS.find(
      (item) => text.startsWith(item) && text.length > item.length + 6,
    )
    if (!filler) break
    text = text.slice(filler.length).replace(/^[，,、：:；;和与及或并\s]+/, '')
  }
  return text
    .replace(/^[，,、：:；;和与及或并\s]+/, '')
    .replace(/[，,、：:；;。.!！?？]+$/, '')
}

// ── 无文本：学习框架笔记 ────────────────────────────────────

function buildFrameworkSummary({ title, subject, keywords, cfg, shortText = false, textLength = 0 }) {
  const kws = keywords.slice(0, 8)
  const subjectName = subject || '本学科'
  const profile = detectSubjectProfile(subject)
  const points = []

  points.push({
    point: '学习目标与范围定位',
    detail: `先明确《${title}》要解决的问题与知识范围（属于${subjectName}的哪一部分、需要先掌握什么），再据此安排本节学习顺序。`,
  })
  points.push(
    kws.length
      ? {
          point: '核心概念与关键词',
          detail: `本节关键词：${kws.join('、')}。为每个关键词建立概念卡片，写出定义、符号/写法含义、适用条件和一个反例（听课时补充原文表述）。`,
        }
      : {
          point: '核心概念清单',
          detail: '把本节出现的名词与符号列成清单，逐条写出定义、含义与适用条件（听课时补充原文表述）。',
        },
  )
  points.push({
    point: '公式与符号含义',
    detail:
      '整理本节出现的公式或固定表达，标注每个符号/成分的含义、单位与前提条件，做到既能写出形式也能说明来源。',
  })
  points.push({ point: profile.stepsPoint, detail: profile.stepsDetail })
  points.push({
    point: '典型例题与变式',
    detail: '记录老师讲解的 1~2 道例题：抄写题干、写出完整步骤、标注易错环节，并尝试改一个条件做变式。',
  })
  points.push({
    point: '重点内容与常见形式',
    detail: '标出本节最需要记住的内容与常见考查/练习形式（问答、计算、操作、案例等），按重要程度排序，优先复习高频内容。',
  })
  points.push({
    point: '易错点与易混淆概念',
    detail: '整理本节容易混淆的概念对比表：定义、例子、适用条件、常见错误各写一条。',
  })
  points.push({
    point: '自测与复习安排',
    detail: '用 3~5 个自测问题检验掌握程度，按「当天回顾 → 3 天后复习 → 一周后做练习」安排巩固。',
  })
  points.push({
    point: '与前后章节的联系',
    detail: `把《${title}》接进知识树：它依赖哪些前置知识、为哪些后续章节做铺垫，各写 1~2 条（结合教材目录补充）。`,
  })

  const keyTerms = buildFrameworkKeyTerms(title, subject, kws)
  const studyTips = [
    '先建立本节的概念框架，再逐条补充定义、适用条件与例子',
    '按「了解 → 理解 → 会用」的层级安排复习优先级',
    '用 1~2 道练习题检验本节公式或方法的适用条件',
    '复习时先回顾易错点与易混淆概念，再做自测题',
  ]
  const pitfalls = [
    '套用公式或模板前先检查适用条件，避免张冠李戴',
    '相近概念要通过定义、例子与反例对比区分',
    '解题或实操过程保留关键步骤，防止跳步丢分',
  ]
  const reviewQuestions = [
    `用一句话说明《${title}》的研究对象。`,
    `列出《${title}》中的 2~3 个核心公式或固定表达，并写出适用条件。`,
    `找一道本节典型题，按完整步骤书写解答。`,
    `本节最容易与哪一节内容混淆？写出区分要点。`,
    `用自己的话复述本节 3 个核心概念。`,
    `如果要向别人讲清本节内容，你会怎样组织讲解顺序？`,
  ]

  // 有文本但过短：明确告诉用户文本已收到，避免误以为导入内容被丢弃
  const prefix = shortText
    ? `已导入学习文本但内容过短（${textLength} 字），以下为离线模板整理（未接入大模型）：`
    : '未获取到学习文本，以下为离线模板整理（未接入大模型）：'
  const overview =
    `${prefix}围绕《${title}》` +
    `${subject ? `（${subject}）` : ''}给出学习框架笔记，涵盖学习目标、核心概念、公式与符号、` +
    `${profile.stepsLabel}、重点内容、易错点与自测题。本模板只提供整理框架，不包含具体学科结论，` +
    '请对照学习材料或教材补充原文定义与例题。'

  return {
    overview,
    knowledgePoints: points.slice(0, cfg.maxPoints),
    keyTerms,
    studyTips,
    pitfalls,
    reviewQuestions,
    mindmap: buildMindmap(title, points.slice(0, 6)),
  }
}

/**
 * 标题路径的术语：优先用户关键词，其次从标题的「XX函数/定理…」模式中抽取。
 */
function buildFrameworkKeyTerms(title, subject, keywords) {
  if (keywords.length) {
    return keywords.slice(0, 8).map((term) => ({
      term: truncate(term, 16),
      explain: '关键词占位：听课时补充该概念的准确定义、符号含义与适用条件。',
    }))
  }
  const titleTerms = buildTitleTerms(title, [])
  const extracted = buildKeyTerms({
    text: [title, subject].filter(Boolean).join(' '),
    sentences: [],
    titleTerms,
    keywords: [],
    maxTerms: 6,
  })
  return extracted.map((item) => ({
    term: item.term,
    // 标题路径没有原文句子，统一用占位说明，避免把标题片段当成原文解释
    explain: '关键词占位：听课时补充该概念的准确定义、符号含义与适用条件。',
  }))
}

function detectSubjectProfile(subject) {
  const name = subject || ''
  if (/数学|高数|代数|几何|概率|统计|微积分/.test(name)) {
    return {
      stepsPoint: '解题步骤与思路',
      stepsLabel: '解题步骤',
      stepsDetail:
        '按「读题 → 识别题型 → 写出依据公式/定理 → 逐步推导 → 检验结果」整理老师板书的例题步骤，每一步都标注依据。',
    }
  }
  if (/英语|英文|语言|日语/.test(name)) {
    return {
      stepsPoint: '语言技能训练步骤',
      stepsLabel: '训练步骤',
      stepsDetail:
        '按「词汇/短语 → 语法结构 → 句子翻译 → 篇章理解 → 写作输出」整理本节语言点，并为每个语言点配一个例句。',
    }
  }
  if (/计算机|编程|程序|软件|信息|网络|数据库/.test(name)) {
    return {
      stepsPoint: '上机操作步骤',
      stepsLabel: '操作步骤',
      stepsDetail:
        '按「明确目标 → 准备环境 → 分步操作 → 验证结果 → 记录报错」整理本节实操流程，命令与参数要写全。',
    }
  }
  return {
    stepsPoint: '学习与操作步骤',
    stepsLabel: '学习步骤',
    stepsDetail:
      '按「明确目标 → 梳理概念 → 记录方法与步骤 → 跟做例题/实操 → 复盘检查」整理本节流程，每一步写出关键动作。',
  }
}

// ── 输出归一化 ──────────────────────────────────────────────

function finalizeSummary(raw, fallbackTitle) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    overview: truncate(normalizeSpace(source.overview), 320),
    knowledgePoints: normalizeKnowledgePoints(source.knowledgePoints),
    keyTerms: normalizeKeyTerms(source.keyTerms),
    studyTips: normalizeStringList(source.studyTips ?? source.examTips, MAX_STUDY_TIPS, 100),
    pitfalls: normalizeStringList(source.pitfalls, MAX_PITFALLS, 100),
    reviewQuestions: normalizeStringList(source.reviewQuestions, MAX_QUESTIONS, 120),
    mindmap: normalizeMindmap(source.mindmap, fallbackTitle),
    generatedBy: 'offline',
  }
}

function normalizeKnowledgePoints(list) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const point = truncate(
      typeof item === 'string' ? item : normalizeSpace(item && item.point),
      POINT_MAX,
    )
    const detail = truncate(
      typeof item === 'string' ? '' : normalizeSpace(item && item.detail),
      DETAIL_MAX,
    )
    if (!point) continue
    const key = `${point}\u0000${detail}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ point, detail })
    if (out.length >= MAX_TEXT_POINTS) break
  }
  return out
}

function normalizeKeyTerms(list) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const term = truncate(
      typeof item === 'string' ? item : normalizeSpace(item && item.term),
      16,
    )
    const explain = truncate(
      typeof item === 'string' ? '' : normalizeSpace(item && item.explain),
      90,
    )
    if (!term || seen.has(term)) continue
    seen.add(term)
    out.push({ term, explain })
    if (out.length >= MAX_KEY_TERMS) break
  }
  return out
}

function normalizeStringList(list, max, maxLength) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const text = truncate(normalizeSpace(item), maxLength)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= max) break
  }
  return out
}

function normalizeMindmap(node, fallbackTitle) {
  const root = node && typeof node === 'object' ? node : {}
  const title = truncate(normalizeSpace(root.title) || fallbackTitle || '课程知识地图', 40)
  const children = []
  for (const child of Array.isArray(root.children) ? root.children : []) {
    const childTitle = truncate(
      typeof child === 'string' ? child : normalizeSpace(child && child.title),
      40,
    )
    if (!childTitle) continue
    const grandchildren = []
    for (const grandchild of Array.isArray(child && child.children) ? child.children : []) {
      const grandTitle = truncate(
        typeof grandchild === 'string' ? grandchild : normalizeSpace(grandchild && grandchild.title),
        30,
      )
      if (!grandTitle) continue
      grandchildren.push({ title: grandTitle })
      if (grandchildren.length >= 12) break
    }
    children.push({ title: childTitle, children: grandchildren })
    if (children.length >= 12) break
  }
  return { title, children }
}

// 供其他模块复用的常量（不参与摘要计算）
export const OFFLINE_TEMPLATE_NOTICE = '离线模板整理（未接入大模型）'
