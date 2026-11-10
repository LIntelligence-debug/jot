/**
 * 配置加载：默认值 < config/config.json < 环境变量。
 *
 * 设计原则：
 * - 首次运行自动生成 config/config.json（含绝对路径），用户只需改想改的字段；
 * - 配置文件里的 llm.apiKey 不建议使用，优先 apiKeyEnv（环境变量名）；
 * - 所有路径都解析成绝对路径再使用，避免 CWD 不同导致写错位置。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 项目根目录（src/core/config.mjs → 上两级）。 */
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const DEFAULT_CORE_SUBJECTS = [
  {
    name: '英语',
    aliases: ['英语', '英文', '词汇', '单词', '语法', '阅读', '阅读理解', '完形', '翻译', '写作', '作文', '听力', '口语', '语言'],
  },
  {
    name: '数学',
    aliases: ['数学', '高数', '高等数学', '代数', '几何', '微积分', '导数', '微分', '极限', '积分', '不定积分', '定积分', '线性代数', '线代', '概率', '概率论', '统计', '向量', '级数'],
  },
  {
    name: '计算机基础',
    aliases: ['计算机基础', '计算机', '编程', '程序', '代码', '算法', '数据结构', '操作系统', '网络基础', '计算机网络', '数据库', '软件', 'Office', 'Word', 'Excel', 'PPT', 'PowerPoint', 'Windows', 'C语言', 'Python'],
  },
]

export const DEFAULTS = {
  version: 1,
  enabled: false,
  pollIntervalMs: 15000,
  stablePolls: 2,
  titleMinLen: 4,
  maxImportChars: 20000,
  outputDir: null,
  dataDir: null,
  llm: {
    mode: 'offline',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    apiKeyEnv: 'STUDY_LLM_API_KEY',
    apiKey: null,
    authHeader: null,
    temperature: 0.7,
    maxTokens: 4096,
    timeoutMs: 120000,
    fallbackToOffline: true,
  },
  offline: {
    maxTextChars: 20000,
    maxPoints: 20,
    maxKeyTerms: 10,
  },
  prompt: {
    persona: '学习笔记整理助手',
    goal: '日常学习与复习',
  },
  web: {
    host: '127.0.0.1',
    port: 7870,
    openBrowser: true,
  },
  watch: {
    browsers: ['chrome', 'msedge', 'edge', 'firefox', 'iexplore', 'opera', 'brave', 'chromium', 'vivaldi', 'quark', '360chrome', '360se', 'qqbrowser'],
    clients: ['哔哩哔哩', 'bilibili', '抖音', 'douyin', '快手', 'kuaishou', '西瓜视频', 'xigua', '优酷', 'youku', '爱奇艺', 'iqiyi', '腾讯视频', 'qqlive', 'potplayer', 'vlc', 'mpv'],
  },
  subjects: {
    core: DEFAULT_CORE_SUBJECTS,
    autoCreate: true,
  },
}

export const LLM_MODES = ['offline', 'openai', 'anthropic']

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function deepMerge(base, extra) {
  if (!isPlainObject(extra)) return base
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v)
    else out[k] = v
  }
  return out
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return fallback
  }
}

export function atomicWriteJson(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp.' + process.pid
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export function expandHome(p) {
  const s = String(p || '').trim()
  if (!s) return s
  if (s === '~') return join(process.env.USERPROFILE || process.env.HOME || '.', '')
  if (s.startsWith('~/') || s.startsWith('~\\')) {
    const home = process.env.USERPROFILE || process.env.HOME || '.'
    return resolve(home, s.slice(2))
  }
  return s
}

export function defaultConfigPath() {
  return resolve(PKG_ROOT, 'config', 'config.json')
}

export function exampleConfigPath() {
  return resolve(PKG_ROOT, 'config', 'config.example.json')
}

function validate(cfg) {
  const errs = []
  const num = (key, min) => {
    if (typeof cfg[key] !== 'number' || !Number.isFinite(cfg[key]) || cfg[key] < min) {
      errs.push(`配置项 ${key} 必须是 >= ${min} 的数字`)
    }
  }
  num('pollIntervalMs', 1000)
  num('stablePolls', 1)
  num('titleMinLen', 1)
  num('maxImportChars', 200)
  if (typeof cfg.enabled !== 'boolean') errs.push('配置项 enabled 必须是布尔值')
  if (!cfg.outputDir || typeof cfg.outputDir !== 'string') errs.push('配置项 outputDir 不能为空')
  if (!cfg.dataDir || typeof cfg.dataDir !== 'string') errs.push('配置项 dataDir 不能为空')

  if (!isPlainObject(cfg.llm)) errs.push('配置项 llm 必须是对象')
  else {
    if (!LLM_MODES.includes(cfg.llm.mode)) errs.push(`配置项 llm.mode 必须是 ${LLM_MODES.join(' / ')} 之一`)
    if (typeof cfg.llm.baseURL !== 'string' || !/^https?:\/\//i.test(cfg.llm.baseURL)) {
      errs.push('配置项 llm.baseURL 必须是 http(s) 地址')
    }
    if (typeof cfg.llm.model !== 'string' || !cfg.llm.model.trim()) errs.push('配置项 llm.model 不能为空')
    if (cfg.llm.apiKey !== null && cfg.llm.apiKey !== undefined && typeof cfg.llm.apiKey !== 'string') {
      errs.push('配置项 llm.apiKey 必须是字符串或 null')
    }
    if (typeof cfg.llm.apiKeyEnv !== 'string') errs.push('配置项 llm.apiKeyEnv 必须是字符串（环境变量名）')
  }

  if (!isPlainObject(cfg.web)) errs.push('配置项 web 必须是对象')
  else {
    if (!Number.isInteger(cfg.web.port) || cfg.web.port < 1024 || cfg.web.port > 65535) {
      errs.push('配置项 web.port 必须是 1024-65535 的整数')
    }
    if (typeof cfg.web.host !== 'string' || !cfg.web.host.trim()) errs.push('配置项 web.host 不能为空')
  }

  if (!Array.isArray(cfg.subjects?.core) || cfg.subjects.core.length === 0) {
    errs.push('配置项 subjects.core 必须是非空数组')
  } else {
    for (const s of cfg.subjects.core) {
      if (!s || typeof s.name !== 'string' || !s.name.trim()) errs.push('subjects.core 每项必须有 name')
      else if (!Array.isArray(s.aliases)) s.aliases = []
    }
  }

  if (errs.length) {
    throw new Error('配置校验失败：\n- ' + errs.join('\n- '))
  }
}

function applyEnv(cfg, env) {
  const e = env || process.env
  if (e.STUDY_PORT) cfg.web.port = Number(e.STUDY_PORT)
  if (e.STUDY_OUTPUT_DIR) cfg.outputDir = e.STUDY_OUTPUT_DIR
  if (e.STUDY_DATA_DIR) cfg.dataDir = e.STUDY_DATA_DIR
  return cfg
}

/**
 * 载入配置：不存在则按默认值创建一份。
 * @param {{configPath?: string, env?: object, createIfMissing?: boolean}} [options]
 */
export function loadConfig(options = {}) {
  const configPath = resolve(options.configPath || process.env.STUDY_CONFIG || defaultConfigPath())
  let fileCfg = {}
  if (existsSync(configPath)) {
    try {
      fileCfg = readJson(configPath, {}) || {}
    } catch (error) {
      throw new Error(`配置文件解析失败 ${configPath}: ${error.message}`)
    }
  }
  const cfg = deepMerge(structuredClone(DEFAULTS), fileCfg)
  cfg.configPath = configPath
  cfg.rootDir = PKG_ROOT
  cfg.outputDir = resolve(expandHome(cfg.outputDir) || join(PKG_ROOT, '课程知识地图'))
  cfg.dataDir = resolve(expandHome(cfg.dataDir) || join(PKG_ROOT, 'data'))
  cfg.maxTokens = cfg.llm.maxTokens
  cfg.llmTimeoutMs = cfg.llm.timeoutMs
  applyEnv(cfg, options.env)
  validate(cfg)
  if (!existsSync(configPath) && options.createIfMissing !== false) {
    atomicWriteJson(configPath, configToFile(cfg))
  }
  return cfg
}

/** 写回配置文件时只保留可持久化字段（不含 configPath/rootDir 等运行时字段）。 */
export function configToFile(cfg) {
  const out = structuredClone(cfg)
  delete out.configPath
  delete out.rootDir
  delete out.maxTokens
  delete out.llmTimeoutMs
  return out
}

export function saveConfig(cfg) {
  atomicWriteJson(cfg.configPath, configToFile(cfg))
  return cfg
}

/**
 * 局部更新配置文件：读原始 JSON → 合并 patch → 校验 → 写入 → 重新载入。
 * 校验失败不会写盘；原文件不是合法 JSON 时抛错（绝不静默丢配置）。
 * 注意：读取时会剥掉 UTF-8 BOM（Windows 记事本 / PowerShell 5.1 写出的配置常带 BOM）。
 */
export function updateConfigFile(configPath, patch) {
  const file = resolve(configPath || defaultConfigPath())
  const original = existsSync(file) ? readFileSync(file, 'utf8') : ''
  let raw = {}
  if (original.trim()) {
    try {
      raw = JSON.parse(original.replace(/^\uFEFF/, ''))
    } catch (error) {
      throw new Error('配置文件不是合法 JSON，未做任何修改：' + file + '（' + error.message + '）')
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('配置文件内容必须是 JSON 对象，未做任何修改：' + file)
    }
  }
  const next = deepMerge(raw, patch || {})
  // 用同一套默认值+校验流程验证，再落盘
  const merged = deepMerge(structuredClone(DEFAULTS), next)
  merged.configPath = file
  merged.rootDir = PKG_ROOT
  merged.outputDir = resolve(expandHome(merged.outputDir) || join(PKG_ROOT, '课程知识地图'))
  merged.dataDir = resolve(expandHome(merged.dataDir) || join(PKG_ROOT, 'data'))
  validate(merged)
  atomicWriteJson(file, next)
  return loadConfig({ configPath: file, createIfMissing: false })
}

export function ensureDirs(cfg) {
  mkdirSync(cfg.outputDir, { recursive: true })
  mkdirSync(cfg.dataDir, { recursive: true })
}
