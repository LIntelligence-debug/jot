import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, DEFAULT_CORE_SUBJECTS } from '../src/core/config.mjs'
import { deriveKeywords, matchCoreSubject, matchExistingSubject, noteDir, safeName, subjectDir } from '../src/core/subjects.mjs'

const cfg = { ...DEFAULTS, outputDir: 'out' }

test('预设学科关键词匹配（数学 / 英语 / 计算机）', () => {
  assert.equal(matchCoreSubject('高等数学 第一章 函数与极限', cfg).name, '数学')
  assert.equal(matchCoreSubject('英语语法：时态与语态', cfg).name, '英语')
  assert.equal(matchCoreSubject('Python 入门：变量与循环', cfg).name, '计算机基础')
  assert.equal(matchCoreSubject('完全无关的标题', cfg), null)
})

test('匹配最长别名：高等数学优先于数学', () => {
  const hit = matchCoreSubject('高等数学 第一章', cfg)
  assert.equal(hit.alias, '高等数学')
  assert.equal(hit.name, '数学')
})

test('已有学科名复用', () => {
  assert.equal(matchExistingSubject('摄影 构图 练习', ['摄影', '英语']), '摄影')
  assert.equal(matchExistingSubject('完全无关', ['摄影']), null)
})

test('文件名安全化', () => {
  assert.equal(safeName('a/b:c*d?e"f<g>h|i'), 'a b c d e f g h i')
  assert.equal(safeName('  多  空格  '), '多 空格')
  assert.equal(safeName('x'.repeat(80), 10).length, 10)
})

test('关键词兜底提取', () => {
  const words = deriveKeywords('【课程】第一章 函数 与 极限：导数')
  assert.ok(words.includes('第一章'))
  assert.ok(words.includes('函数'))
  assert.equal(words.length <= 6, true)
})

test('目录布局扁平：<输出目录>/<学科>/单集笔记', () => {
  assert.deepEqual(subjectDir(cfg, '数学'), ['out', '数学'])
  assert.deepEqual(noteDir(cfg, '数学').slice(-2), ['数学', '单集笔记'])
  assert.deepEqual(noteDir(cfg, '摄影'), ['out', '摄影', '单集笔记'])
})

test('预设学科不绑定任何考试：别名里没有考试预设词', () => {
  const banned = /专升本|升本|考纲|真题|四级|六级/
  for (const subject of DEFAULT_CORE_SUBJECTS) {
    for (const alias of subject.aliases) {
      assert.equal(banned.test(alias), false, '别名不应包含考试预设：' + alias)
    }
  }
  assert.ok(DEFAULT_CORE_SUBJECTS.length >= 3)
})
