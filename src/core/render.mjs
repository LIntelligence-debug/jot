/**
 * 把结构化总结渲染成 Markdown：单集笔记 / 学科学习手册 / 课程总览。
 * 输出保持稳定格式，供 docx/writer.mjs 转 Word。
 */
const FENCE = String.fromCharCode(96, 96, 96)

export function pad2(n) {
  return String(n).padStart(2, '0')
}

export function dateStamp(ts = Date.now()) {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

export function dateTimeStamp(ts = Date.now()) {
  const d = new Date(ts)
  return dateStamp(ts) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

export function escapeMermaid(s, max = 40) {
  return String(s || '')
    .replace(/[()[\]{}|<>'"`\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function mindmapNodeLines(node, indent, out) {
  if (!node || !node.title) return
  const title = escapeMermaid(node.title)
  if (!title) return
  out.push('  '.repeat(indent) + title)
  for (const child of (node.children ?? []).slice(0, 12)) mindmapNodeLines(child, indent + 1, out)
}

export function mindmapBlock(video) {
  const root = escapeMermaid(video.title, 50) || '课程知识地图'
  const lines = [FENCE + 'mermaid', 'mindmap', '  root((' + root + '))']
  const children = video.summary?.mindmap?.children ?? []
  if (children.length > 0) {
    for (const child of children.slice(0, 12)) mindmapNodeLines(child, 2, lines)
  } else {
    for (const p of (video.summary?.knowledgePoints ?? []).slice(0, 8)) {
      const t = escapeMermaid(p.point)
      if (t) lines.push('    ' + t)
    }
  }
  lines.push(FENCE)
  return lines.join('\n')
}

/** 生成方式标签：让每篇笔记都能看出是离线模板还是某个模型生成的。 */
export function generationLabel(video) {
  const by = video.generatedBy || video.source || 'offline'
  if (by === 'llm') return '大模型生成' + (video.provider ? '（' + video.provider + (video.model ? ' · ' + video.model : '') + '）' : '')
  if (by === 'offline-fallback') return '离线模板整理（模型调用失败后回退）'
  return '离线模板整理（未接入大模型）'
}

export function renderVideoSection(video) {
  const s = video.summary ?? {}
  const lines = []
  lines.push('## ' + video.title)
  lines.push('')
  if (s.overview) {
    lines.push('> ' + s.overview)
    lines.push('')
  }
  lines.push('### 内容信息')
  lines.push('')
  lines.push('- 学科：' + (video.subject || '未分类'))
  lines.push('- 生成方式：' + generationLabel(video))
  if (video.inputChars) lines.push('- 参考文本：' + video.inputChars + ' 字（用户导入的学习材料）')
  if (video.promptPersona) lines.push('- 整理风格：' + video.promptPersona)
  lines.push('- 整理时间：' + dateTimeStamp(video.generatedAt ?? Date.now()))
  lines.push('')
  if ((s.knowledgePoints ?? []).length) {
    lines.push('### 核心知识点')
    lines.push('')
    for (const p of s.knowledgePoints) {
      lines.push('- **' + p.point + '**' + (p.detail ? '：' + p.detail : ''))
    }
    lines.push('')
  }
  if ((s.keyTerms ?? []).length) {
    lines.push('### 重点概念与公式')
    lines.push('')
    for (const t of s.keyTerms) lines.push('- **' + t.term + '**' + (t.explain ? '：' + t.explain : ''))
    lines.push('')
  }
  const studyTips = s.studyTips ?? s.examTips ?? []
  if (studyTips.length) {
    lines.push('### 学习重点')
    lines.push('')
    for (const t of studyTips) lines.push('- ' + t)
    lines.push('')
  }
  if ((s.pitfalls ?? []).length) {
    lines.push('### 易错点')
    lines.push('')
    for (const t of s.pitfalls) lines.push('- ' + t)
    lines.push('')
  }
  if ((s.reviewQuestions ?? []).length) {
    lines.push('### 复习自测')
    lines.push('')
    s.reviewQuestions.forEach((q, i) => lines.push((i + 1) + '. ' + q))
    lines.push('')
  }
  lines.push('### 思维导图')
  lines.push('')
  lines.push(mindmapBlock(video))
  lines.push('')
  return lines.join('\n')
}

export function renderManual(subject, videos) {
  const list = [...videos].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  const lines = []
  lines.push('# ' + subject + ' 学习手册')
  lines.push('')
  lines.push('> 笔记工坊自动生成 · 共 ' + list.length + ' 集 · 更新于 ' + dateTimeStamp())
  lines.push('')
  lines.push('## 学科总览')
  lines.push('')
  lines.push(FENCE + 'mermaid')
  lines.push('mindmap')
  lines.push('  root((' + escapeMermaid(subject, 30) + '))')
  for (const v of list) {
    const t = escapeMermaid(v.title, 50)
    if (t) lines.push('    ' + t)
  }
  lines.push(FENCE)
  lines.push('')
  for (const v of list) {
    lines.push('---')
    lines.push('')
    lines.push(renderVideoSection(v))
  }
  return lines.join('\n')
}

export function renderOverview(store) {
  const subjects = store.listSubjects()
  const lines = []
  lines.push('# 课程知识地图')
  lines.push('')
  lines.push('> 笔记工坊自动生成 · 更新于 ' + dateTimeStamp())
  lines.push('')
  lines.push('## 学科')
  lines.push('')
  if (subjects.length === 0) lines.push('（暂无，整理第一条学习记录后自动创建）')
  subjects.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  for (const s of subjects) {
    lines.push('- **' + s.name + '** — ' + s.videos.length + ' 集 → ' + s.name + '/学习手册.docx')
  }
  lines.push('')
  lines.push('## 最近更新')
  lines.push('')
  const recent = []
  for (const s of subjects) {
    for (const v of s.videos) recent.push({ subject: s.name, title: v.title, at: v.updatedAt ?? v.createdAt ?? 0 })
  }
  recent.sort((a, b) => b.at - a.at)
  if (recent.length === 0) lines.push('（暂无）')
  for (const r of recent.slice(0, 10)) lines.push('- ' + dateTimeStamp(r.at) + ' · ' + r.subject + ' · ' + r.title)
  lines.push('')
  return lines.join('\n')
}
