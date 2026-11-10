/**
 * 包入口：给二次开发/脚本调用提供统一导出。
 *
 * 典型用法：
 *   import { loadConfig, StateStore, processTitle } from 'jot'
 *   const cfg = loadConfig({ configPath: './config/config.json' })
 *   const store = new StateStore(cfg.dataDir)
 *   await processTitle({ logger }, cfg, store, '高等数学 第一章 函数与极限', { text: '……' })
 */
export {
  DEFAULTS,
  LLM_MODES,
  DEFAULT_CORE_SUBJECTS,
  atomicWriteJson,
  configToFile,
  deepMerge,
  defaultConfigPath,
  ensureDirs,
  loadConfig,
  readJson,
  saveConfig,
  updateConfigFile,
} from './core/config.mjs'
export { StateStore, normalizeTitle, STATE_VERSION } from './core/state.mjs'
export { processTitle, rebuildAll, tryWriteDocx, writeUtf8 } from './core/pipeline.mjs'
export { generateSummary, createProvider, testConnection, listModels, parseJsonLoose, normalizeSummary, PROVIDER_LABELS, isOfflineMode } from './llm/index.mjs'
export { createOpenAiProvider } from './llm/openai.mjs'
export { createAnthropicProvider } from './llm/anthropic.mjs'
export { renderManual, renderOverview, renderVideoSection, generationLabel, dateStamp, dateTimeStamp } from './core/render.mjs'
export { markdownToDocx, writeDocx } from './core/docx/writer.mjs'
export { createZip, readZip } from './core/docx/zip.mjs'
export { createApp } from './server/app.mjs'
export { createLogger } from './log.mjs'
export { detectForeground, watcherSupported, platformLabel } from './watch/index.mjs'
export { deriveKeywords, matchCoreSubject, matchExistingSubject, noteDir, safeName, subjectDir } from './core/subjects.mjs'
export { summarizeOffline } from './core/offline.mjs'
