/**
 * 端到端冒烟测试：临时目录里离线生成 3 个学科的笔记，并校验 Markdown / Word 产出。
 * 不联网、不依赖任何第三方库；退出码 0 表示通过。
 *
 * 运行：node scripts/smoke.mjs
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureDirs, loadConfig } from '../src/core/config.mjs'
import { processTitle, rebuildAll } from '../src/core/pipeline.mjs'
import { StateStore } from '../src/core/state.mjs'
import { subjectDir } from '../src/core/subjects.mjs'
import { createLogger } from '../src/log.mjs'
import { readZip } from '../src/core/docx/zip.mjs'

const CASES = [
  {
    title: '高等数学 第一章 函数、极限、连续',
    text: '本节讲函数与极限。函数的定义域要满足分母不为零、偶次根号下非负。重点：求定义域是常考题型，要多练。极限的四则运算法则要求各部分极限都存在。易错点：0/0 型不能直接代入，要先约分或抓大头。洛必达法则只适用于 0/0 或无穷/无穷型，且导数比的极限必须存在。易错：连续与间断点分类容易混淆。',
  },
  {
    title: 'Python 入门：变量、类型与循环',
    text: 'Python 用缩进表示代码块，缩进不一致会直接报错。变量不需要声明类型，赋值即创建。重点：整数、浮点数、字符串和布尔值是最常用的四种类型。易错点：字符串和数字相加会抛 TypeError，需要先转换类型。for 循环适合遍历序列，while 循环适合条件驱动。难点：循环里的变量作用域和 break/continue 的区别。练习：用循环打印九九乘法表。',
  },
  {
    title: '英语语法：时态与语态',
    text: '一般现在时表示习惯性动作与客观真理。现在完成时强调过去动作对现在的影响，常与 for、since 连用。被动语态由 be 加过去分词构成。重点：时态辨析是阅读和写作的基础。易错：现在完成时不能与明确表示过去的时间状语连用。注意区别一般过去时与现在完成时。练习：把五个主动句改成被动句。',
  },
  { title: '摄影基础：曝光三要素（无导入材料）' },
]

function fail(message) {
  console.error('✗ ' + message)
  process.exitCode = 1
}

function assertDocx(file) {
  if (!existsSync(file)) {
    fail('缺少 Word：' + file)
    return
  }
  const buffer = readFileSync(file)
  if (buffer.subarray(0, 4).toString('binary') !== 'PK\x03\x04') {
    fail('Word 文件不是 ZIP 格式：' + file)
    return
  }
  const entries = readZip(buffer)
  for (const name of ['word/document.xml', '[Content_Types].xml', 'word/styles.xml']) {
    if (!entries.has(name)) fail('Word 缺少条目 ' + name + '：' + file)
  }
  const xml = entries.get('word/document.xml').toString('utf8')
  if (!xml.includes('<w:document')) fail('document.xml 结构异常：' + file)
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'osa-smoke-'))
  const configPath = join(root, 'config.json')
  writeFileSync(configPath, JSON.stringify({
    enabled: false,
    outputDir: join(root, '课程知识地图'),
    dataDir: join(root, 'data'),
  }, null, 2), 'utf8')
  const cfg = loadConfig({ configPath, env: {} })
  ensureDirs(cfg)
  const logger = createLogger(cfg.dataDir)
  const store = new StateStore(cfg.dataDir)
  console.log('临时工作区：' + root)

  try {
    for (const item of CASES) {
      const result = await processTitle({ logger }, cfg, store, item.title, { text: item.text || '' })
      if (!result.ok) {
        fail('处理失败：' + item.title + ' → ' + result.error)
        continue
      }
      console.log('✓ ' + result.subject + ' · ' + result.title + '（' + result.generatedBy + '）')
      if (!existsSync(result.noteMd)) fail('缺少 Markdown：' + result.noteMd)
      assertDocx(result.noteDocx)
      const md = readFileSync(result.noteMd, 'utf8')
      for (const heading of ['### 核心知识点', '### 思维导图']) {
        if (!md.includes(heading)) fail(result.noteMd + ' 缺少章节 ' + heading)
      }
    }

    // 重建（不重新生成笔记）
    const outcome = rebuildAll(cfg, store, logger)
    for (const row of outcome) {
      if (!row.ok) fail('重建失败：' + row.subject + ' → ' + row.error)
    }
    const stats = store.stats()
    console.log('✓ 汇总：' + stats.subjectCount + ' 个学科 / ' + stats.videoCount + ' 集')
    for (const subject of store.listSubjects()) {
      const manualMd = join(...subjectDir(cfg, subject.name), '学习手册.md')
      if (!existsSync(manualMd)) fail('缺少学习手册：' + manualMd)
    }
    if (!existsSync(join(cfg.outputDir, '课程总览.md'))) fail('缺少课程总览.md')
    if (!existsSync(join(cfg.outputDir, '课程总览.docx'))) fail('缺少课程总览.docx')
    console.log('✓ 手册与总览已生成')
  } finally {
    if (!process.env.OSA_KEEP_SMOKE) {
      try { rmSync(root, { recursive: true, force: true }) } catch { /* 忽略 */ }
    } else {
      console.log('保留临时目录：' + root)
    }
  }

  if (process.exitCode) console.error('冒烟测试失败')
  else console.log('冒烟测试全部通过')
}

main().catch((error) => {
  console.error('冒烟测试异常：' + (error && error.stack ? error.stack : error))
  process.exitCode = 1
})
