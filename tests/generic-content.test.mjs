/**
 * 通用化回归测试：
 * 项目不做任何考试/升学预设——默认配置、提示词、离线生成结果、示例与脚本里
 * 都不应出现考试预设词，避免以后又退回「专升本工具」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CORE_SUBJECTS, DEFAULTS } from '../src/core/config.mjs'
import { buildSystemPrompt, buildSummaryPrompt } from '../src/core/prompt.mjs'
import { summarizeOffline } from '../src/core/offline.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BANNED = /专升本|升本|考纲|真题/

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(mjs|js|json|md|txt|cmd|sh|yml|yaml)$/i.test(entry.name)) out.push(full)
  }
  return out
}

test('默认配置与预设学科不含考试预设', () => {
  assert.equal(DEFAULTS.prompt.goal, '日常学习与复习')
  assert.equal(Object.hasOwn(DEFAULTS.prompt, 'examName'), false)
  const json = JSON.stringify(DEFAULT_CORE_SUBJECTS)
  assert.equal(BANNED.test(json), false, '预设学科别名不应包含考试预设词')
})

test('提示词是通用学习导向，不含考试预设', () => {
  const cfg = { ...DEFAULTS }
  const system = buildSystemPrompt(cfg)
  const user = buildSummaryPrompt({ title: '摄影基础：曝光三要素', subject: '摄影', keywords: [], text: '', cfg })
  for (const text of [system, user]) {
    assert.equal(BANNED.test(text), false, '提示词不应包含考试预设词')
  }
  assert.ok(system.includes('日常学习与复习'))
  assert.ok(user.includes('studyTips'))
  assert.ok(!user.includes('examTips'))
})

test('离线引擎输出不含考试预设，且使用 studyTips 字段', () => {
  const summary = summarizeOffline({
    title: '摄影基础：曝光三要素',
    subject: '摄影',
    keywords: ['光圈', '快门', 'ISO'],
    text: '光圈越大景深越浅。重点：快门速度决定曝光时间。易错点：只调一个参数就以为曝光正确。难点：逆光下平衡主体与背景。',
    cfg: { ...DEFAULTS },
  })
  const json = JSON.stringify(summary)
  assert.equal(BANNED.test(json), false, '生成的笔记不应出现考试预设词')
  assert.equal(Array.isArray(summary.studyTips), true)
  assert.equal(Object.hasOwn(summary, 'examTips'), false)
  assert.equal(Object.hasOwn(summary, 'danmakuFocus'), false)
})

test('源码/配置/示例/脚本里没有考试预设词（防止回归）', () => {
  const dirs = ['src', 'config', 'examples', 'scripts'].map((d) => join(ROOT, d))
  const files = []
  for (const dir of dirs) files.push(...walk(dir))
  assert.ok(files.length > 20, '应扫描到足够多的文件，实际 ' + files.length)
  const hits = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (BANNED.test(text)) hits.push(file.slice(ROOT.length + 1))
  }
  assert.deepEqual(hits, [], '以下文件含考试预设词：' + hits.join(', '))
})
