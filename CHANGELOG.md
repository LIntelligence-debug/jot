# 更新日志（Changelog）

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的组织方式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-10

首个可用版本：离线优先的学习笔记助手。它把任何学习内容（视频课、教程、讲座、读书笔记、播客、技术分享……）的标题与可选文字材料，整理成按学科归档的 Markdown / Word 笔记。

### Added

- **通用学习笔记定位**：不限课程平台与内容形式——只认「内容标题 + 你提供的文字材料」，按学科归档，不绑定任何考试或培训体系。
- **离线模式（默认）**：本地抽取式摘要引擎，不联网、零运行时依赖。
  - 中英文分句、句子打分（标题命中 / 关键词密度 / 位置 / 长度）、相似度去重；
  - 知识点、重点概念与公式、学习重点、易错点、复习自测、思维导图（mermaid）；
  - 没有导入材料时生成「学习框架笔记」，导语明确标注「离线模板整理（未接入大模型）」。
- **可选大模型接入**：`offline` / `openai`（OpenAI 兼容）/ `anthropic`（Anthropic 兼容）三种模式；密钥只从环境变量读取（默认 `STUDY_LLM_API_KEY`），配置文件可指定变量名 `llm.apiKeyEnv`。
  - 适配 Ollama、LM Studio、vLLM、DeepSeek（两种端点）、OpenAI 官方及任意兼容网关；
  - 宽松 JSON 解析（代码块/前后废话/尾逗号/裸键名）+ 一次重试；
  - 失败自动回退离线引擎（`llm.fallbackToOffline`），`generatedBy` 标记 `offline` / `llm` / `offline-fallback`。
- **纯 JS 生成 Word**：自研 OOXML 生成器与 ZIP 打包（仅 `node:zlib`），不依赖 python-docx / LibreOffice / Office 安装。
  - 标题/段落/引用/列表/代码块；中文 `宋体`、西文 Calibri、代码 Consolas；UTF-8 文件名（ZIP bit 11）；
  - mermaid `mindmap` 代码块转为 Word 原生分级大纲（含导航窗格可用的 `outlineLvl`）。
- **本地 Web 控制台**（`127.0.0.1:7870`）：自动检测开关与间隔、单步检测、立即扫描、导入学习材料、处理阶段进度、最新总结、历史记录、实时日志、打开输出目录/笔记、重建全部 Word、查看 Markdown、模型设置与连接测试、退出。
- **SSE 实时状态**：`/api/stream` 推送 `hello` / `state` / `stage` / `log` / `tick` / `foreground` / `result` / `config` 事件，15 秒心跳。
- **HTTP API**：健康检查、状态快照、配置修改、单步检测、扫描、导入、重建、按标题查询与 Markdown 读取、受限路径打开、模型测试与模型列表、退出；请求体上限 1MB。
- **CLI**：`serve`（默认）、`add`、`import`、`list`、`rebuild`、`config get/set`、`test-llm`；支持 `--config` / `--port` / `--no-open` / `--force` / `--json` / `-h`。
- **Windows 前台窗口自动检测（可选）**：PowerShell 调 `user32.dll` 读取前台窗口标题 + 进程名，结果经 UTF-8 文件回读以正确处理中文；浏览器/播放器白名单、标题后缀清理、首页/搜索页忽略规则、连续 `stablePolls` 次稳定判定、按归一化标题去重。
- **学科与目录策略**：默认示例学科「英语 / 数学 / 计算机基础」（带别名表，可自由增删）；按学科归档，未命中归入「待分类」；输出目录扁平化——`课程知识地图/<学科>/学习手册` 与 `单集笔记/`，根目录另有 `课程总览`。
- **配置系统**：默认值 < `config/config.json` < 环境变量（`STUDY_CONFIG` / `STUDY_PORT` / `STUDY_OUTPUT_DIR` / `STUDY_DATA_DIR`）；首次运行自动生成配置文件；带校验的原子写；`config set` 支持点号路径。
  - `prompt.persona`（默认「学习笔记整理助手」）与 `prompt.goal`（默认「日常学习与复习」）控制整理风格与目标；
  - `offline.maxTextChars` / `offline.maxPoints` / `offline.maxKeyTerms` 可调离线引擎；
  - `llm.authHeader` 可自定义 Anthropic 兼容模式的鉴权头名（默认 `x-api-key`）；
  - 附带 `config/config.schema.json` 供编辑器校验/补全。
- **状态与日志**：`data/state.json`（去重、学科、内容记录，seen 上限 800）、`data/events.jsonl`、`data/web.log`（>2MB 轮转）、`data/server.json`（单实例检测心跳）。
- **单实例与端口顺延**：已有实例在跑时只打开浏览器；端口被占用时自动向后查找（最多 20 次）。
- **测试与 CI**：`node --test` 单测（配置、学科、渲染、离线引擎、Word 生成、两种模型协议、服务端等），`scripts/smoke.mjs` 端到端冒烟（多学科示例 + 手册/总览校验）；GitHub Actions 在 Node 20/22 × Ubuntu/Windows 上运行。
- **文档**：README（中文为主 + English Quickstart）、`docs/API.md`、`docs/PROVIDERS.md`、`docs/ARCHITECTURE.md`、`docs/FAQ.md`、`CONTRIBUTING.md`、示例配置与示例学习材料。

### Notes

- 离线引擎是**抽取式**的，不推理、不补充原文之外的结论，质量明显低于大模型；没有材料时只产出学习框架。文档与笔记里都如实标注生成方式。
- 自动检测仅支持 Windows；其他平台使用手动标题或导入学习材料。
- Word 输出仅覆盖项目生成的 Markdown 子集：不支持图片、表格、脚注等复杂排版。
- 服务无鉴权，设计为单机单用户；请勿将 `web.host` 改为对公网/局域网暴露。
- `subjects.autoCreate` 为预留配置项，当前实现始终自动创建学科目录。
- 笔记的「学习重点」来自材料中的提示句抽取（如「重点」「难点」「易错」「注意」等触发词），不包含任何考试大纲/分值/题型体系。
