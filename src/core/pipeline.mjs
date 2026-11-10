/**
 * 单节课处理流水线：
 * 学科分类（关键词，离线） → 摘要（离线引擎 / 大模型，失败自动回退） → 写 Markdown/Word
 * → 更新学科学习手册与课程总览 → 更新状态。
 *
 * 设计原则：任何一步失败都写事件日志；除「明确跳过」外不静默丢课。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { generateSummary } from '../llm/index.mjs'
import { markdownToDocx } from './docx/writer.mjs'
import { dateStamp, renderManual, renderOverview, renderVideoSection } from './render.mjs'
import { deriveKeywords, matchCoreSubject, matchExistingSubject, noteDir, safeName, subjectDir } from './subjects.mjs'
import { normalizeTitle } from './state.mjs'

export function writeUtf8(file, content) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
  return file
}

/** 尝试生成 Word：失败不阻断流程（Markdown 一定保留）。 */
export function tryWriteDocx(markdown, target, store) {
  try {
    const buffer = markdownToDocx(markdown)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, buffer)
    return { ok: true, path: target }
  } catch (error) {
    const message = String(error && error.message ? error.message : error).slice(0, 500)
    if (store) store.log('docx-error', { file: target, error: message })
    return { ok: false, error: message }
  }
}

/**
 * 处理一条学习记录。
 * @param {{logger?:object, provider?:object, onEvent?:Function}} ctx
 * @param {object} cfg 已解析配置
 * @param {import('./state.mjs').StateStore} store
 * @param {string} rawTitle 学习记录标题
 * @param {{text?:string, force?:boolean}} [options] text = 用户导入的字幕/简介/笔记
 */
export async function processTitle(ctx, cfg, store, rawTitle, options = {}) {
  const emit = typeof ctx.onEvent === 'function' ? ctx.onEvent : () => {}
  const logger = ctx.logger
  const title = String(rawTitle ?? '').trim()
  if (!title) return { ok: false, skipped: true, reason: 'empty-title', error: '标题不能为空' }
  if (!options.force && store.hasSeen(title)) {
    return { ok: true, skipped: true, reason: 'seen', title }
  }

  // 1) 学科分类：核心学科别名 → 已有学科名 → 待分类
  emit({ stage: 'classify', title, message: '正在判断学科…' })
  const existing = store.listSubjects().map((s) => s.name)
  const coreHit = matchCoreSubject(title, cfg)
  const subject = coreHit?.name ?? matchExistingSubject(title, existing) ?? '待分类'
  const keywords = coreHit ? [coreHit.alias] : deriveKeywords(title)
  store.log('classify', { title, subject, classifiedBy: coreHit ? 'keyword' : 'fallback', keywords })
  emit({ stage: 'classify', title, subject, message: '学科：' + subject })

  // 2) 摘要：离线引擎或大模型（失败回退）
  const text = String(options.text ?? '').slice(0, cfg.maxImportChars || 20000)
  emit({ stage: 'summarize', title, subject, message: text ? '正在整理导入的学习材料…' : '正在生成学习笔记…' })
  const generated = await generateSummary({
    cfg,
    logger,
    provider: ctx.provider,
    input: { title, subject, keywords, text, cfg },
  })
  const { summary } = generated
  emit({
    stage: 'summarize',
    title,
    subject,
    message: generated.generatedBy === 'llm' ? '模型总结完成' : generated.generatedBy === 'offline-fallback' ? '已回退离线引擎' : '离线总结完成',
  })

  // 3) 写单集笔记
  const dirs = subjectDir(cfg, subject)
  const base = dateStamp() + '_' + safeName(title, 40)
  const noteMd = join(...noteDir(cfg, subject), base + '.md')
  const noteDocx = join(...noteDir(cfg, subject), base + '.docx')
  const manualMd = join(...dirs, '学习手册.md')
  const manualDocx = join(...dirs, '学习手册.docx')
  const video = {
    title,
    subject,
    keywords,
    summary,
    generatedBy: generated.generatedBy,
    provider: generated.provider,
    model: generated.model,
    inputChars: text.length,
    promptPersona: cfg.prompt?.persona || null,
    generatedAt: Date.now(),
    noteMd,
    noteDocx,
    manualMd,
    manualDocx,
  }
  emit({ stage: 'write', title, subject, message: '正在写 Markdown…' })
  video.sectionMarkdown = renderVideoSection(video)
  writeUtf8(noteMd, video.sectionMarkdown)
  emit({ stage: 'write', title, subject, message: '正在生成 Word…' })
  const noteDocxResult = tryWriteDocx(video.sectionMarkdown, noteDocx, store)

  // 4) 学科学习手册 + 课程总览
  const entry = store.upsertVideo(subject, video)
  const manualText = renderManual(subject, entry.videos)
  writeUtf8(manualMd, manualText)
  const manualDocxResult = tryWriteDocx(manualText, manualDocx, store)
  const overviewMd = join(cfg.outputDir, '课程总览.md')
  const overviewDocx = join(cfg.outputDir, '课程总览.docx')
  const overviewText = renderOverview(store, cfg)
  writeUtf8(overviewMd, overviewText)
  tryWriteDocx(overviewText, overviewDocx, store)

  store.markSeen(title, { subject, title })
  store.setLast(title)
  store.save()
  store.log('note-written', {
    title,
    subject,
    noteMd,
    noteDocx: noteDocxResult.ok ? noteDocx : null,
    manualDocx: manualDocxResult.ok ? manualDocx : null,
    generatedBy: generated.generatedBy,
  })
  emit({
    stage: 'write',
    title,
    subject,
    message: noteDocxResult.ok ? 'Word 已生成' : 'Word 生成失败，已保留 Markdown',
    noteDocx: noteDocxResult.ok ? noteDocx : null,
    manualDocx: manualDocxResult.ok ? manualDocx : null,
  })

  const result = {
    ok: true,
    title,
    subject,
    generatedBy: generated.generatedBy,
    warning: generated.warning,
    noteMd,
    noteDocx: noteDocxResult.ok ? noteDocx : null,
    manualDocx: manualDocxResult.ok ? manualDocx : null,
    docxError: noteDocxResult.ok ? null : noteDocxResult.error,
    summary,
    video,
  }
  emit({ stage: 'done', title, subject, message: '完成', result })
  return result
}

/** 只从已保存的总结重建全部 Markdown / Word（不调用模型、不联网）。 */
export function rebuildAll(cfg, store, logger) {
  const outcome = []
  for (const s of store.listSubjects()) {
    const dirs = subjectDir(cfg, s.name)
    const manualMd = join(...dirs, '学习手册.md')
    const manualText = renderManual(s.name, s.videos)
    writeUtf8(manualMd, manualText)
    const r = tryWriteDocx(manualText, join(...dirs, '学习手册.docx'), store)
    outcome.push({ subject: s.name, ok: r.ok, error: r.error ?? null })
    if (logger) logger.info('重建手册：' + s.name + '（' + s.videos.length + ' 集）' + (r.ok ? ' 完成' : ' Word 失败'))
  }
  const overviewMd = join(cfg.outputDir, '课程总览.md')
  const overviewText = renderOverview(store, cfg)
  writeUtf8(overviewMd, overviewText)
  const r = tryWriteDocx(overviewText, join(cfg.outputDir, '课程总览.docx'), store)
  outcome.push({ subject: '课程总览', ok: r.ok, error: r.error ?? null })
  return outcome
}

/** 生成文件名的日期前缀（供 UI 展示用）。 */
export function noteBaseName(title) {
  return dateStamp() + '_' + safeName(title, 40)
}

export { normalizeTitle }
