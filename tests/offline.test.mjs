/**
 * tests/offline.test.mjs
 *
 * 离线摘要引擎测试（node:test + node:assert/strict）。
 * 运行：node --test tests/offline.test.mjs
 * （受限沙箱禁止子进程 spawn 时，可用 --experimental-test-isolation=none 进程内运行）
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeSpace,
  splitSentences,
  tokenize,
  rankSentences,
  extractKeywords,
  dedupeBySimilarity,
  truncate,
} from '../src/core/text.mjs'
import { summarizeOffline } from '../src/core/offline.mjs'

// ── 测试素材 ────────────────────────────────────────────────

const SAMPLE_TITLE = '高数：函数极限与洛必达法则'
const SAMPLE_SUBJECT = '数学'
const SAMPLE_KEYWORDS = ['函数极限', '洛必达法则', '等价无穷小']
const SAMPLE_TEXT = [
  '本节我们学习函数极限的基本概念与常用计算方法。',
  '函数极限描述的是当自变量无限趋近某一点时，函数值的变化趋势。',
  '极限的定义用 ε-δ 语言表述：对任意给定的正数 ε，总存在正数 δ，使得当 0<|x-x0|<δ 时，有 |f(x)-A|<ε。',
  '计算极限时，首先要判断函数在趋近点附近是否连续。',
  '如果直接代入后出现 0/0 型不定式，可以考虑因式分解、有理化或等价无穷小替换。',
  '等价无穷小替换是常考的重点，例如当 x→0 时，sin x 与 x 等价。',
  '洛必达法则适用于 0/0 或 ∞/∞ 型不定式，使用前必须验证分子分母都可导。',
  '注意：洛必达法则不能用于非不定式，盲目求导会得到错误答案，这是最容易混的易错点。',
  '两个重要极限分别是 lim(x→0) sin x / x = 1 和 lim(x→∞)(1+1/x)^x = e。',
  '求极限的步骤可以概括为：先代入、再变形、后计算、最后检验。',
  '本节重点是极限的计算步骤，复习时要能独立写出过程。',
  '常见的误区是把无穷小与很小的数混为一谈，二者本质不同。',
  '使用夹逼定理时，需要找到两个容易求极限的函数把原函数夹住。',
  '函数在一点连续的条件是左极限、右极限存在且等于函数值。',
  '做练习题时要注意先写出极限存在的前提，再使用运算法则。',
  '本节重点是极限的四则运算法则与复合函数极限的求法。',
  '课后请完成教材第 32 页的 1 到 6 题，并整理错题。',
  '如果对某个步骤不确定，回到定义用 ε-δ 语言检验，不要凭感觉跳步。',
].join('\n')

const BASE_INPUT = {
  title: SAMPLE_TITLE,
  subject: SAMPLE_SUBJECT,
  keywords: SAMPLE_KEYWORDS,
  text: SAMPLE_TEXT,
}

// ── 文本工具 ────────────────────────────────────────────────

test('normalizeSpace: 去 BOM/零宽字符、统一空白、压缩空行', () => {
  assert.equal(normalizeSpace('\uFEFF  你好\u200B\n\n\n\n世界\t\t  '), '你好\n\n世界')
  assert.equal(normalizeSpace('a\u00A0\u3000b'), 'a b')
  assert.equal(normalizeSpace(null), '')
  assert.equal(normalizeSpace(undefined), '')
})

test('truncate: 按字符数截断并保留省略号', () => {
  assert.equal(truncate('abcdef', 4), 'abc…')
  assert.equal(truncate('abc', 5), 'abc')
  assert.equal(truncate('中文字符串', 3), '中文…')
  assert.ok(Array.from(truncate('一'.repeat(30), 10)).length <= 10)
})

test('splitSentences: 中英文分句、去空去重、保留原序', () => {
  const zh = splitSentences('第一句。第二句！第三句？第四句\n第五句；第六句……第一句。')
  assert.deepEqual(zh, ['第一句', '第二句', '第三句', '第四句', '第五句', '第六句'])

  const en = splitSentences('Hello world. This is a test. Done.')
  assert.equal(en.length, 3)
  assert.ok(en[0].startsWith('Hello world'))
  assert.equal(en[2], 'Done')

  assert.deepEqual(splitSentences('   '), [])
  // 纯符号片段不应被当作句子
  assert.deepEqual(splitSentences('!!!？？？……'), [])
  // 列表序号应被去掉
  assert.deepEqual(splitSentences('- 第一点。1. 第二点。'), ['第一点', '第二点'])
})

test('tokenize: 中文 2~4 字滑窗 + 英文/数字小写', () => {
  const zh = tokenize('函数极限')
  assert.ok(zh.includes('函数极限'))
  assert.ok(zh.includes('函数'))
  assert.ok(zh.includes('极限'))

  const mixed = tokenize('Hello World 2024')
  assert.ok(mixed.includes('hello'))
  assert.ok(mixed.includes('world'))
  assert.ok(mixed.includes('2024'))
  assert.deepEqual(tokenize(''), [])
})

test('rankSentences: 标题关键词命中的句子排在前面，且按分数降序', () => {
  const ranked = rankSentences(
    ['今天天气不错', '函数极限的定义很重要', '函数极限的计算方法'],
    { titleTerms: ['函数极限'] },
  )
  assert.equal(ranked.length, 3)
  assert.ok(ranked[0].sentence.includes('函数极限'))
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score)
  }
  assert.deepEqual(rankSentences([], { titleTerms: ['极限'] }), [])
})

test('extractKeywords: 去停用词、按频次排序、结果确定', () => {
  const first = extractKeywords('极限 极限 极限 函数 函数 导数', 5)
  assert.ok(first.length > 0 && first.length <= 5)
  const limit = first.find((item) => item.term === '极限')
  assert.ok(limit && limit.count >= 3)
  const second = extractKeywords('极限 极限 极限 函数 函数 导数', 5)
  assert.deepEqual(first, second)
})

test('dedupeBySimilarity: 按字符集合 Jaccard 去重并保留首次出现', () => {
  const deduped = dedupeBySimilarity(['函数极限的定义', '函数极限定义', '洛必达法则'], {
    threshold: 0.8,
  })
  assert.deepEqual(deduped, ['函数极限的定义', '洛必达法则'])

  const objects = [
    { point: '函数极限的定义', detail: 'A' },
    { point: '函数极限定义', detail: 'B' },
    { point: '洛必达法则', detail: 'C' },
  ]
  const dedupedObjects = dedupeBySimilarity(objects, { key: 'point', threshold: 0.8 })
  assert.equal(dedupedObjects.length, 2)
  assert.equal(dedupedObjects[0].detail, 'A')
  assert.equal(dedupedObjects[1].detail, 'C')
})

// ── 有文本：抽取式摘要 ──────────────────────────────────────

test('summarizeOffline: 有文本时生成 8~20 条知识点与完整字段', () => {
  const summary = summarizeOffline(BASE_INPUT)

  assert.equal(summary.generatedBy, 'offline')
  assert.equal(Object.hasOwn(summary, 'danmakuFocus'), false)
  assert.equal(Object.hasOwn(summary, 'commentFocus'), false)
  assert.ok(summary.overview.length > 0)
  assert.ok(summary.overview.includes('未接入大模型'))

  // 知识点 8~20 条，point/detail 均非空且限长
  assert.ok(
    summary.knowledgePoints.length >= 8 && summary.knowledgePoints.length <= 20,
    `知识点数量应为 8~20，实际 ${summary.knowledgePoints.length}`,
  )
  for (const point of summary.knowledgePoints) {
    assert.ok(typeof point.point === 'string' && point.point.length > 0)
    assert.ok(typeof point.detail === 'string' && point.detail.length > 0)
    assert.ok(Array.from(point.point).length <= 24)
    assert.ok(Array.from(point.detail).length <= 120)
  }

  // 术语 6~12 条
  assert.ok(
    summary.keyTerms.length >= 6 && summary.keyTerms.length <= 12,
    `术语数量应为 6~12，实际 ${summary.keyTerms.length}`,
  )
  for (const term of summary.keyTerms) {
    assert.ok(term.term.length > 0)
    assert.ok(term.explain.length > 0)
  }

  // 命中注入的重点句 / 易错句
  assert.ok(
    summary.studyTips.some((tip) => /常考|考点|重点|难点|分值/.test(tip)),
    `studyTips 应命中重点句式：${JSON.stringify(summary.studyTips)}`,
  )
  assert.ok(
    summary.pitfalls.some((tip) => /易错|误区|注意|混淆/.test(tip)),
    `pitfalls 应命中易错句式：${JSON.stringify(summary.pitfalls)}`,
  )
  assert.ok(summary.studyTips.length <= 6)
  assert.ok(summary.pitfalls.length <= 6)

  // 自测题与思维导图
  assert.ok(summary.reviewQuestions.length >= 6)
  assert.ok(summary.mindmap.title.includes('函数极限'))
  assert.ok(summary.mindmap.children.length >= 3 && summary.mindmap.children.length <= 6)
  assert.ok(summary.mindmap.children.some((child) => child.children.length >= 1))
})

test('summarizeOffline: 有文本时同输入同输出（确定性）', () => {
  assert.deepEqual(summarizeOffline(BASE_INPUT), summarizeOffline(BASE_INPUT))
  // text 以字符串数组传入与字符串等价
  const arrayInput = { ...BASE_INPUT, text: SAMPLE_TEXT.split('\n') }
  assert.deepEqual(summarizeOffline(arrayInput), summarizeOffline(BASE_INPUT))
})

test('summarizeOffline: cfg.offline 可限制知识点/术语数量', () => {
  const summary = summarizeOffline({
    ...BASE_INPUT,
    cfg: { offline: { maxPoints: 10, maxKeyTerms: 6, maxTextChars: 5000 } },
  })
  assert.ok(summary.knowledgePoints.length <= 10)
  assert.ok(summary.keyTerms.length <= 6)
})

// ── 仅标题：学习框架笔记 ────────────────────────────────────

test('summarizeOffline: 仅标题时生成学习框架笔记并标注离线模板', () => {
  const input = { title: SAMPLE_TITLE, subject: SAMPLE_SUBJECT, keywords: SAMPLE_KEYWORDS }
  const summary = summarizeOffline(input)

  assert.ok(summary.overview.includes('未获取到学习文本'))
  assert.ok(summary.overview.includes('离线模板整理（未接入大模型）'))
  assert.equal(summary.generatedBy, 'offline')

  assert.ok(summary.knowledgePoints.length >= 6)
  assert.ok(summary.knowledgePoints.length <= 20)
  for (const point of summary.knowledgePoints) {
    assert.ok(point.point.length > 0)
    assert.ok(point.detail.length > 0)
  }

  // 用户关键词进入术语，且解释是占位说明（不编造具体结论）
  assert.ok(summary.keyTerms.length >= 3)
  for (const term of summary.keyTerms) {
    assert.ok(term.explain.length > 0)
  }
  assert.ok(summary.studyTips.length >= 3)
  assert.ok(summary.pitfalls.length >= 3)
  assert.ok(summary.reviewQuestions.length >= 5)
  assert.ok(summary.mindmap.children.length >= 3)
  assert.ok(summary.mindmap.title.includes('函数极限'))

  // 确定性
  assert.deepEqual(summarizeOffline(input), summarizeOffline(input))
})

test('summarizeOffline: 没有关键词的仅标题输入也能生成框架', () => {
  const summary = summarizeOffline({ title: '线性代数：矩阵与行列式', subject: '数学' })
  assert.ok(summary.overview.includes('离线模板整理（未接入大模型）'))
  assert.ok(summary.knowledgePoints.length >= 6)
  assert.ok(Array.isArray(summary.keyTerms))
  assert.ok(summary.reviewQuestions.length >= 5)
})

// ── 边界 ────────────────────────────────────────────────────

test('summarizeOffline: 空标题抛出明确错误', () => {
  assert.throws(
    () => summarizeOffline({ title: '   ' }),
    (error) => error instanceof TypeError && /标题/.test(error.message),
  )
  assert.throws(
    () => summarizeOffline(),
    (error) => error instanceof TypeError && /标题/.test(error.message),
  )
})

test('summarizeOffline: 超长文本（>20000 字）被截断且不崩', () => {
  const tailMarker = '尾部特殊标记ABCDEF'
  const longText = `${SAMPLE_TEXT.repeat(60)}\n${tailMarker}。`
  assert.ok(longText.length > 20000)

  const summary = summarizeOffline({ ...BASE_INPUT, text: longText })
  assert.equal(summary.generatedBy, 'offline')
  assert.ok(summary.knowledgePoints.length >= 8)
  assert.ok(summary.knowledgePoints.length <= 20)
  assert.ok(summary.keyTerms.length <= 12)
  assert.ok(Array.from(summary.overview).length <= 320)
  for (const point of summary.knowledgePoints) {
    assert.ok(Array.from(point.detail).length <= 120)
  }
  // 20k 字符之后的尾部标记不应进入摘要
  assert.ok(!JSON.stringify(summary).includes(tailMarker))
})

test('summarizeOffline: 纯英文文本不崩', () => {
  const englishText = [
    'The limit describes how a function behaves near a point.',
    'We say the limit exists when both one-sided limits agree.',
    'Continuity requires the limit to equal the function value.',
    'Differentiate carefully and check the domain before applying a rule.',
    'Always verify the conditions of a theorem before using it.',
    'Practice with past exam questions to improve speed.',
    'A derivative measures the instantaneous rate of change.',
    'Check your answer by substituting a sample value.',
  ].join(' ')

  const summary = summarizeOffline({ title: 'Calculus: Limits and Continuity', text: englishText })
  assert.equal(summary.generatedBy, 'offline')
  assert.ok(summary.overview.length > 0)
  assert.ok(summary.knowledgePoints.length > 0 && summary.knowledgePoints.length <= 20)
  assert.ok(Array.isArray(summary.keyTerms))
  assert.ok(Array.isArray(summary.studyTips))
  assert.ok(Array.isArray(summary.pitfalls))
  assert.ok(Array.isArray(summary.reviewQuestions))
  assert.ok(summary.mindmap.children.length >= 3)
})

test('summarizeOffline: 纯符号文本回退到标题模板且不崩', () => {
  const summary = summarizeOffline({
    title: '符号与公式识别',
    text: '———……!!!???###@@@%%%'.repeat(3),
  })
  assert.equal(summary.generatedBy, 'offline')
  assert.ok(summary.overview.includes('离线模板整理（未接入大模型）'))
  assert.ok(summary.knowledgePoints.length >= 6)
  assert.equal(Object.hasOwn(summary, 'danmakuFocus'), false)
  assert.equal(Object.hasOwn(summary, 'commentFocus'), false)
})

test('summarizeOffline: 超短文本按标题模板处理，并提示文本已导入但过短', () => {
  const summary = summarizeOffline({ title: '极限初步', text: '极限。' })
  assert.ok(summary.overview.includes('离线模板整理（未接入大模型）'))
  // 用户粘贴了文本时必须明确告知「已导入但过短（N 字）」，不能让人误以为文本被丢弃
  assert.ok(summary.overview.includes('已导入学习文本但内容过短'))
  assert.ok(summary.overview.includes('（3 字）'))
  assert.ok(summary.knowledgePoints.length >= 6)
})
