import test from 'node:test'
import assert from 'node:assert/strict'
import { renderManual, renderOverview, renderVideoSection, dateStamp, mindmapBlock } from '../src/core/render.mjs'

function makeVideo(overrides = {}) {
  return {
    title: '第一章 函数与极限',
    subject: '数学',
    generatedBy: 'offline',
    inputChars: 1200,
    promptPersona: '课程学习笔记专家',
    generatedAt: 1790000000000,
    summary: {
      overview: '未获取到学习文本，以下为离线模板整理（未接入大模型）。',
      knowledgePoints: [
        { point: '函数定义域', detail: '分母不能为 0，偶次根号下非负。' },
        { point: '极限的四则运算', detail: '在极限存在时逐项计算。' },
      ],
      keyTerms: [{ term: '极限', explain: '描述趋近过程的量。' }],
      studyTips: ['常考求定义域'],
      pitfalls: ['易混左右极限'],
      reviewQuestions: ['函数定义域怎么求？'],
      mindmap: { title: '第一章 函数与极限', children: [{ title: '函数', children: [{ title: '定义域' }] }] },
    },
    ...overrides,
  }
}

test('单集笔记包含标题、概述、知识点、思维导图与生成方式', () => {
  const md = renderVideoSection(makeVideo())
  assert.ok(md.startsWith('## 第一章 函数与极限'))
  assert.ok(md.includes('> 未获取到学习文本'))
  assert.ok(md.includes('### 内容信息'))
  assert.ok(md.includes('### 核心知识点'))
  assert.ok(md.includes('**函数定义域**：分母不能为 0'))
  assert.ok(md.includes('### 学习重点'))
  assert.ok(md.includes('### 复习自测'))
  assert.ok(md.includes('### 思维导图'))
  assert.ok(md.includes('```mermaid'))
  assert.ok(md.includes('离线模板整理'))
  assert.ok(md.includes('参考文本：1200 字'))
})

test('大模型生成的笔记标注 provider 与 model', () => {
  const md = renderVideoSection(makeVideo({ generatedBy: 'llm', provider: 'openai', model: 'qwen2.5:7b' }))
  assert.ok(md.includes('大模型生成（openai · qwen2.5:7b）'))
})

test('学习手册包含学科名、集数与每节内容', () => {
  const md = renderManual('数学', [makeVideo(), makeVideo({ title: '第二章 导数' })])
  assert.ok(md.startsWith('# 数学 学习手册'))
  assert.ok(md.includes('共 2 集'))
  assert.ok(md.includes('## 第一章 函数与极限'))
  assert.ok(md.includes('## 第二章 导数'))
})

test('课程总览按学科平铺', () => {
  const store = {
    listSubjects: () => [
      { name: '数学', videos: [makeVideo()], createdAt: 1, updatedAt: 2 },
      { name: '摄影', videos: [makeVideo({ subject: '摄影' })], createdAt: 1, updatedAt: 2 },
    ],
  }
  const md = renderOverview(store)
  assert.ok(md.startsWith('# 课程知识地图'))
  assert.ok(md.includes('## 学科'))
  assert.ok(md.includes('**数学** — 1 集'))
  assert.ok(md.includes('**摄影** — 1 集'))
  assert.ok(md.includes('数学/学习手册.docx'))
  assert.ok(!md.includes('专升本核心'))
})

test('思维导图块在无 mindmap 时回退到知识点', () => {
  const video = makeVideo()
  video.summary.mindmap = { title: 'x', children: [] }
  const block = mindmapBlock(video)
  assert.ok(block.includes('mindmap'))
  assert.ok(block.includes('函数定义域'))
})

test('日期戳格式', () => {
  assert.match(dateStamp(1790000000000), /^\d{4}-\d{2}-\d{2}$/)
})
