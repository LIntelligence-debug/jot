/**
 * 持久状态：seen（去重）、subjects（学科 → 学习记录）、事件日志。
 * 原子写（tmp + rename），全部同步写，避免轮询与手动操作竞态。
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const STATE_VERSION = 1

/** 标题去重键：小写、去空白/标点/符号。 */
export function normalizeTitle(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function emptyState() {
  return {
    version: STATE_VERSION,
    lastTitle: '',
    lastRunAt: 0,
    seen: {},
    subjects: {},
    updatedAt: 0,
  }
}

function atomicWrite(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp.' + process.pid
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

export class StateStore {
  constructor(dataDir) {
    this.dir = dataDir
    this.file = join(dataDir, 'state.json')
    this.eventFile = join(dataDir, 'events.jsonl')
    mkdirSync(dataDir, { recursive: true })
    this.state = this.load()
  }

  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''))
      const state = Object.assign(emptyState(), parsed && typeof parsed === 'object' ? parsed : {})
      if (!state.seen || typeof state.seen !== 'object') state.seen = {}
      if (!state.subjects || typeof state.subjects !== 'object') state.subjects = {}
      return state
    } catch {
      return emptyState()
    }
  }

  save() {
    this.state.updatedAt = Date.now()
    atomicWrite(this.file, JSON.stringify(this.state, null, 2) + '\n')
  }

  /** 从磁盘重新载入（多进程共享 state 时用）。 */
  reload() {
    this.state = this.load()
    return this.state
  }

  log(type, data = {}) {
    try {
      appendFileSync(this.eventFile, JSON.stringify(Object.assign({ at: Date.now(), type }, data)) + '\n', 'utf8')
    } catch { /* 日志失败不影响主流程 */ }
  }

  hasSeen(title) {
    return Object.hasOwn(this.state.seen, normalizeTitle(title))
  }

  markSeen(title, extra = {}) {
    this.state.seen[normalizeTitle(title)] = Object.assign({ ts: Date.now(), title: String(title) }, extra)
    this.pruneSeen()
  }

  pruneSeen(max = 800) {
    const keys = Object.keys(this.state.seen)
    if (keys.length <= max) return
    const sorted = keys.sort((a, b) => (this.state.seen[a]?.ts ?? 0) - (this.state.seen[b]?.ts ?? 0))
    for (const k of sorted.slice(0, keys.length - max)) delete this.state.seen[k]
  }

  listSubjects() {
    return Object.entries(this.state.subjects).map(([name, data]) => ({
      name,
      createdAt: data.createdAt ?? 0,
      updatedAt: data.updatedAt ?? 0,
      videos: Array.isArray(data.videos) ? data.videos : [],
    }))
  }

  subject(name) {
    return this.state.subjects[name]
  }

  ensureSubject(name) {
    if (!this.state.subjects[name]) {
      this.state.subjects[name] = { createdAt: Date.now(), updatedAt: Date.now(), videos: [] }
    }
    return this.state.subjects[name]
  }

  /** 新增或按标题替换已有视频记录，返回学科条目。 */
  upsertVideo(subject, video) {
    const entry = this.ensureSubject(subject)
    const idx = entry.videos.findIndex((v) => normalizeTitle(v.title) === normalizeTitle(video.title))
    if (idx >= 0) {
      entry.videos[idx] = Object.assign({}, entry.videos[idx], video, { updatedAt: Date.now() })
    } else {
      entry.videos.push(Object.assign({}, video, { createdAt: Date.now(), updatedAt: Date.now() }))
    }
    entry.updatedAt = Date.now()
    return entry
  }

  findVideo(title) {
    for (const [subject, data] of Object.entries(this.state.subjects)) {
      const hit = (data.videos ?? []).find((v) => normalizeTitle(v.title) === normalizeTitle(title))
      if (hit) return { subject, video: hit }
    }
    return null
  }

  removeVideo(title) {
    let removed = false
    for (const data of Object.values(this.state.subjects)) {
      const idx = (data.videos ?? []).findIndex((v) => normalizeTitle(v.title) === normalizeTitle(title))
      if (idx >= 0) {
        data.videos.splice(idx, 1)
        removed = true
      }
    }
    if (removed) this.save()
    return removed
  }

  setLast(title) {
    this.state.lastTitle = String(title ?? '')
    this.state.lastRunAt = Date.now()
  }

  stats() {
    const subjects = this.listSubjects()
    return {
      subjectCount: subjects.length,
      videoCount: subjects.reduce((n, s) => n + s.videos.length, 0),
      subjects: subjects.map((s) => ({ name: s.name, videos: s.videos.length, updatedAt: s.updatedAt })),
    }
  }
}
