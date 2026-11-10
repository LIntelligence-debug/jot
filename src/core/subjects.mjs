/**
 * 学科策略：预设学科用关键词/别名确定性匹配；未命中的内容按学科名归档，
 * 学科可由用户在 config 里自由增删（本项目不预设任何考试或课程体系）。
 */

export function safeName(raw, max = 40) {
  return String(raw || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** 返回 { name, alias, index } 或 null。取命中的最长别名，避免「数学」抢掉「高等数学」。 */
export function matchCoreSubject(title, cfg) {
  const text = String(title || '')
  if (!text) return null
  const lower = text.toLowerCase()
  let best = null
  for (const subject of cfg.subjects?.core ?? []) {
    for (const alias of subject.aliases ?? []) {
      const a = String(alias || '').trim()
      if (!a) continue
      const idx = lower.indexOf(a.toLowerCase())
      if (idx >= 0 && (!best || a.length > best.alias.length)) {
        best = { name: subject.name, alias: a, index: idx }
      }
    }
  }
  return best
}

/** 标题里出现已有学科名时归入该学科（用于复用之前自动创建的学科）。 */
export function matchExistingSubject(title, subjectNames) {
  const text = String(title || '').toLowerCase()
  for (const name of subjectNames) {
    const n = String(name).toLowerCase()
    if (n && text.includes(n)) return name
  }
  return null
}

/** 学科目录：<输出目录>/<学科>/（所有学科同级，没有预设层级）。 */
export function subjectDir(cfg, subject) {
  return [cfg.outputDir, safeName(subject, 30)]
}

/** 单条学习记录的目录：<输出目录>/<学科>/单集笔记/。 */
export function noteDir(cfg, subject) {
  return subjectDir(cfg, subject).concat('单集笔记')
}

/** 从标题提取兜底关键词（去标点、切词、长度过滤）。 */
export function deriveKeywords(title, limit = 6) {
  return String(title || '')
    .replace(/[【】[\]（）()《》<>|,，。.、:：;；!！?？"'`~]/g, ' ')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, limit)
}
