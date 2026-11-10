# Jot — 离线优先的学习笔记工具

> 名字取自英文「jot down」：随手记下、速记；中文名：笔记工坊。

**简介 / About**

Jot（笔记工坊）：离线优先的学习笔记工具。把视频课、教程、讲座、读书、播客等学习内容的标题与文字材料，整理成按学科归档的 Markdown / Word 笔记；默认完全离线、零依赖，可选接入大模型，失败自动回退本地引擎。

Jot — offline-first study notes. Turn any learning content plus optional text into subject-organized Markdown/Word notes. Fully offline, zero deps; optional LLM with local fallback.

[![CI](https://github.com/LIntelligence-debug/jot/actions/workflows/ci.yml/badge.svg)](https://github.com/LIntelligence-debug/jot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![零运行时依赖](https://img.shields.io/badge/dependencies-0-blue.svg)](package.json)

---

## 特性

- **通用学习笔记**：不绑定任何考试、培训体系或内容平台。学摄影、学编程、读一本书、听一集播客，只要有标题（外加可选的文字材料），就能整理成结构化笔记。
- **默认完全离线**：默认配置下不发起任何网络请求。笔记由本地抽取式摘要引擎 + Markdown 模板生成，没有网络、没有大模型也能用。
- **可选接入大模型**：支持 `offline` / `openai`（OpenAI 兼容，含 Ollama、LM Studio、vLLM、DeepSeek）/ `anthropic`（Anthropic 兼容）三种模式；模型调用失败会自动回退离线引擎，笔记不会丢。
- **纯 JS 生成 Word**：`src/core/docx/` 自己实现 OOXML 与 ZIP（只依赖 `node:zlib`），不调用 python-docx、不装 LibreOffice。中文默认 `宋体`，mermaid 思维导图转成 Word 原生分级大纲。
- **本地 Web 控制台**：`127.0.0.1:7870`，可切模式、改配置、看阶段进度与实时日志、打开输出目录，SSE 推送状态。
- **三种入口**：Web UI、CLI、导入学习材料（粘贴字幕/简介/课堂笔记/自己的摘录）。
- **Windows 前台窗口检测（可选）**：切到学习页面就自动识别内容标题；其他平台用手动标题或导入材料。
- **学科分类**：默认给出「英语 / 数学 / 计算机基础」三个示例学科及别名表，可自由增删改名；未命中的内容归入 `待分类`。
- **零遥测**：没有统计、没有上报、没有账号体系，笔记只写在本机磁盘。
- **零运行时依赖**：`package.json` 没有 `dependencies`，clone 下来即可 `node src/cli.mjs ...` 运行。

## 生成质量：先说清楚

本项目有两条生成路径，质量差别很大，文档不会拿离线结果冒充大模型结果：

| 路径 | 做法 | 质量 | 何时使用 |
| --- | --- | --- | --- |
| **离线模板/抽取引擎**（默认） | 从你导入的材料里**抽取句子**：分句 → 句子打分（标题命中、关键词密度、位置、长度）→ 去重 → 套 Markdown 模板；没有材料时生成「学习框架笔记」 | 能保证结构完整、原文不漏关键句，但**不会推理、不会补充材料外的结论**，可读性与知识点提炼明显弱于大模型 | 断网、隐私敏感、只想快速归档 |
| **大模型**（可选） | 把标题/学科/关键词 + 你的材料发给模型，要求返回固定 JSON 结构，再走同一套渲染与 Word 生成 | 会归纳、会补例子与学习建议、会写导语；质量取决于模型和提示词 | 有本地模型（Ollama/LM Studio）或云端 API Key |

每篇笔记里都会写明生成方式（`离线模板整理` / `离线模板整理（模型调用失败后回退）` / `大模型生成（provider · model）`），可以直接核对。**不要**把离线模式的产出当成「AI 精读」。

## 快速开始

需要 **Node.js >= 20**（Windows / macOS / Linux）。

```bash
npm start          # 等价于 node src/cli.mjs serve
# 然后打开 http://127.0.0.1:7870
```

没有 npm 也可以直接跑：

```bash
node src/cli.mjs serve
```

首次运行会自动创建 `config/config.json`（含解析后的绝对路径）。默认 `enabled: false`，即**不会自动轮询**，只在「立即扫描」/「导入文本」或 CLI 操作时工作；首次运行不会联网。

> 端口被占用时会从 7870 起自动往后找可用端口；如果检测到已有实例在运行，会直接打开那个实例的地址（状态文件：`data/server.json`）。

## 三种用法

### 1. Web 控制台

`npm start` 后浏览器会自动打开 `http://127.0.0.1:7870`。可以：

- 打开/关闭「自动检测」（仅 Windows 生效），调整检测间隔（3~300 秒）、单步检测；
- 「立即扫描」（当前平台支持时读取前台窗口标题）、「导入文本」（粘贴学习材料）；
- 查看「正在处理」阶段：分类 → 摘要 → 写文档 → 完成；
- 查看最新总结、历史记录、实时日志，一键打开输出目录、打开笔记、重建全部 Word、查看 Markdown 源码；
- 「设置」里切换生成方式（离线 / OpenAI 兼容 / Anthropic 兼容）、Base URL、模型名、API Key 环境变量名；「测试连接」「拉取模型列表」。

### 2. CLI

```bash
node src/cli.mjs serve                                  # 启动本地控制台（默认命令）
node src/cli.mjs add "摄影基础：曝光三要素"                # 只凭标题整理（离线生成学习框架笔记）
node src/cli.mjs add "Python 入门：变量与循环" --text "本节讲变量、赋值与循环……"  # 带材料整理
node src/cli.mjs add "Python 入门：变量与循环" --file ./notes.txt
node src/cli.mjs import "摄影基础：曝光三要素" --file ./materials.txt   # 导入学习材料（必须提供材料）
node src/cli.mjs list                                  # 列出学科与已整理内容
node src/cli.mjs rebuild                               # 只重建 Markdown/Word，不调用模型
node src/cli.mjs config get llm.mode                   # 查看单个配置项
node src/cli.mjs config set llm.mode openai            # 修改配置（会先校验再写盘）
node src/cli.mjs test-llm                              # 测试大模型连接
```

常用选项：`--config <path>`（换配置文件）、`--port <n>`（serve 端口，1024~65535）、`--no-open`（不自动开浏览器）、`--force`（重新生成已处理过的标题）、`--json`（机器可读输出）、`-h/--help`。`add` 可以只给标题（生成学习框架笔记），`import` 必须给材料（`--file` / `--text` / `--text -`）。

`--text -` 从 stdin 读材料，适合 `cat materials.txt | node src/cli.mjs import "标题" --text -` 这种用法。**Windows PowerShell 5.1 下管道/`--text` 传中文可能因终端编码变成乱码，建议统一用 `--file` 传文件**（文件按 UTF-8 读取）。

### 3. 导入学习材料

最稳的用法（也适用于 macOS/Linux）：把字幕、视频简介、课堂笔记、自己的摘录粘进 Web 的「导入文本」，或在 CLI 用 `--file` / `--text` 传进去。离线引擎会从材料中抽知识点、术语、学习重点句、易错句，并生成自测题与思维导图。

没有材料也能生成，但只是**学习框架**（学习目标、核心概念清单、公式与符号、示例、学习重点、易错点、自测安排），内容需要你对照原始内容补充——这是设计上的取舍，不是 bug。

## 接入大模型

三种模式（`llm.mode`）：

| mode | 协议 | 适配服务 |
| --- | --- | --- |
| `offline`（默认） | 不联网 | 本地模板/抽取引擎 |
| `openai` | `POST {baseURL}/chat/completions`，`Authorization: Bearer <key>` | Ollama、LM Studio、vLLM、DeepSeek（OpenAI 兼容）、OpenAI 官方、以及任何 OpenAI 兼容网关 |
| `anthropic` | `POST {baseURL}/v1/messages`（baseURL 以 `/v1` 结尾时直接拼 `/messages`），`x-api-key` | DeepSeek Anthropic 端点、Anthropic 官方、兼容网关 |

密钥**只从环境变量读取**（变量名由 `llm.apiKeyEnv` 指定，默认 `STUDY_LLM_API_KEY`），不写进配置文件：

```powershell
# PowerShell（当前窗口临时生效）
$env:STUDY_LLM_API_KEY = "sk-..."
node src/cli.mjs test-llm
```

```bash
# bash / zsh
export STUDY_LLM_API_KEY="sk-..."
node src/cli.mjs test-llm
```

常见服务商的配置片段（也可以直接在 Web「设置」里填）：

```jsonc
// Ollama（本地，先 ollama pull qwen2.5:7b）
{ "llm": { "mode": "openai", "baseURL": "http://127.0.0.1:11434/v1", "model": "qwen2.5:7b" } }

// LM Studio（本地，开启 Local Server）
{ "llm": { "mode": "openai", "baseURL": "http://127.0.0.1:1234/v1", "model": "qwen2.5-7b-instruct" } }

// vLLM（自建）
{ "llm": { "mode": "openai", "baseURL": "http://127.0.0.1:8000/v1", "model": "Qwen/Qwen2.5-7B-Instruct" } }

// DeepSeek（OpenAI 兼容）
{ "llm": { "mode": "openai", "baseURL": "https://api.deepseek.com/v1", "model": "deepseek-chat" } }

// DeepSeek（Anthropic 兼容）
{ "llm": { "mode": "anthropic", "baseURL": "https://api.deepseek.com/anthropic", "model": "deepseek-chat" } }

// OpenAI 官方
{ "llm": { "mode": "openai", "baseURL": "https://api.openai.com/v1", "model": "gpt-4o-mini" } }
```

> 上面用 `jsonc` 只是方便加注释；`config/config.json` 是标准 JSON，**不能带 `//` 注释**，合并到已有配置时只保留 `llm` 里的字段即可。

本地模型（Ollama / LM Studio）通常不校验 Key，但客户端仍需要一个非空值才会发请求：随便设 `STUDY_LLM_API_KEY=local` 即可。

失败回退规则（`llm.fallbackToOffline`，默认 `true`）：

- 没设置 API Key → 直接用离线引擎，结果标记 `offline-fallback`，日志给出警告；
- 网络错误、鉴权失败（401/403）、限流（429）、5xx、返回内容不是合法 JSON → 重试 1 次后回退离线引擎，笔记照常生成；
- `fallbackToOffline: false` 时以上错误会直接抛出，不生成笔记。

更细的接入说明、错误码含义与排查方法见 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

## 配置

- 默认配置文件：`config/config.json`（首次运行自动创建；已在 `.gitignore` 中，不会提交）
- 换配置文件：`--config <path>` 或环境变量 `STUDY_CONFIG`
- 优先级：**默认值 < 配置文件 < 环境变量**
- 修改方式：Web「设置」/ `node src/cli.mjs config set <key> <value>` / 直接编辑 JSON（改完重启或重新调用即可）
- 写回前会做校验（端口范围、URL 格式、模型名非空等），校验失败不写盘
- 仓库附带 `config/config.schema.json`，用 VS Code 等编辑器打开配置时可获得校验与补全

主要字段（完整默认值见 [config/config.example.json](config/config.example.json)）：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `version` | `1` | 配置版本号 |
| `enabled` | `false` | 是否开启前台窗口自动检测；`false` 时只响应手动扫描/导入 |
| `pollIntervalMs` | `15000` | 自动检测间隔（毫秒，≥1000；Web/API 限制 1000~300000） |
| `stablePolls` | `2` | 同一标题连续被检测到几次才处理（避免误触） |
| `titleMinLen` | `4` | 标题短于该长度视为无效窗口（如浏览器首页） |
| `maxImportChars` | `20000` | 导入材料最多使用多少字符（超出截断） |
| `outputDir` | `null` → `<项目根>/课程知识地图` | 笔记输出目录（绝对路径） |
| `dataDir` | `null` → `<项目根>/data` | 状态、日志、临时脚本目录 |
| `offline.maxTextChars` | `20000` | 离线引擎最多读取多少字材料 |
| `offline.maxPoints` | `20` | 离线引擎最多输出多少个知识点 |
| `offline.maxKeyTerms` | `10` | 离线引擎最多抽取多少个术语 |
| `prompt.persona` | `"学习笔记整理助手"` | 提示词里的角色描述（模型模式生效，也会写进笔记的「整理风格」） |
| `prompt.goal` | `"日常学习与复习"` | 整理目标（写进提示词，影响模型的取舍与措辞） |
| `llm.mode` | `"offline"` | `offline` / `openai` / `anthropic` |
| `llm.baseURL` | `"http://127.0.0.1:11434/v1"` | 模型服务地址（必须 http/https） |
| `llm.model` | `"qwen2.5:7b"` | 模型名 |
| `llm.apiKeyEnv` | `"STUDY_LLM_API_KEY"` | 存 API Key 的**环境变量名** |
| `llm.apiKey` | `null` | 直接写密钥（不推荐：会明文落盘） |
| `llm.authHeader` | `null` | Anthropic 兼容模式自定义鉴权头名（默认 `x-api-key`） |
| `llm.temperature` | `0.7` | 采样温度 |
| `llm.maxTokens` | `4096` | 单次回复上限 |
| `llm.timeoutMs` | `120000` | 请求超时 |
| `llm.fallbackToOffline` | `true` | 模型失败是否回退离线引擎 |
| `web.host` | `"127.0.0.1"` | 监听地址（默认只本机可达） |
| `web.port` | `7870` | 默认端口（占用时自动顺延） |
| `web.openBrowser` | `true` | 启动时自动打开浏览器（`--no-open` 可关） |
| `watch.browsers` | chrome、msedge、firefox… | 视为「学习内容窗口」的浏览器进程名白名单 |
| `watch.clients` | B 站、抖音、优酷、PotPlayer、VLC… | 视为「学习内容窗口」的播放器/客户端进程名白名单 |
| `subjects.core` | 英语 / 数学 / 计算机基础（带别名表） | 预设学科：标题命中别名即归档，可自由增删；未命中归入「待分类」 |
| `subjects.autoCreate` | `true` | 预留字段，当前实现始终自动创建学科目录 |

`subjects.core` 示例（可自由增删学科与别名）：

```json
{
  "subjects": {
    "core": [
      { "name": "英语", "aliases": ["英语", "英文", "词汇", "语法", "听力", "口语"] },
      { "name": "数学", "aliases": ["数学", "高数", "微积分", "导数", "积分", "概率", "统计"] },
      { "name": "计算机基础", "aliases": ["计算机", "编程", "代码", "算法", "数据结构", "Python"] }
    ]
  }
}
```

环境变量：

| 变量 | 作用 |
| --- | --- |
| `STUDY_CONFIG` | 配置文件路径 |
| `STUDY_PORT` | 覆盖 `web.port` |
| `STUDY_OUTPUT_DIR` | 覆盖 `outputDir` |
| `STUDY_DATA_DIR` | 覆盖 `dataDir` |
| `STUDY_LLM_API_KEY` | 默认的 API Key 变量名（可用 `llm.apiKeyEnv` 改成别的名字） |

## 输出目录结构

默认写到 `<项目根>/课程知识地图/`（可在配置里改）。目录是**扁平**的：每个学科一层，不再有额外分组：

```text
课程知识地图/
├── 课程总览.md                # 所有学科与最近更新的索引
├── 课程总览.docx
├── 数学/
│   ├── 学习手册.md            # 该学科所有单集笔记的合集（每条一节）
│   ├── 学习手册.docx
│   └── 单集笔记/
│       ├── 2026-11-10_高等数学 第一章 函数与极限.md
│       └── 2026-11-10_高等数学 第一章 函数与极限.docx
├── 英语/
│   └── ...
├── 计算机基础/
│   └── ...
└── 待分类/                    # 未命中任何预设学科别名的内容
    ├── 学习手册.md
    └── 单集笔记/
```

文件名规则：`YYYY-MM-DD_<标题截断 40 字>.md|.docx`；标题里的 `\ / : * ? " < > |` 与换行会被替换成空格。同一标题再次整理会被当作「已处理过」跳过；加 `--force` 才会重新生成并覆盖同名文件。

每篇单集笔记的固定结构：`## 标题` → 导语 → `### 内容信息` → `### 核心知识点` → `### 重点概念与公式` → `### 学习重点` → `### 易错点` → `### 复习自测` → `### 思维导图`（mermaid mindmap 源码；转 Word 时变成分级大纲）。

运行时数据都在 `data/`：

```text
data/
├── state.json        # 已处理标题（去重）、学科与内容记录
├── events.jsonl      # 事件日志（分类/写文件/Word 错误等）
├── web.log           # 服务日志（>2MB 自动轮转为 web.log.1）
├── server.json       # 当前实例的 pid/port/url（单实例检测用）
└── foreground.ps1    # Windows 前台窗口读取脚本（首次自动生成）
```

## HTTP API 简表

服务只监听 `127.0.0.1`（默认），所有接口都是本机 JSON / SSE，无鉴权（所以请勿改 `web.host` 暴露到公网）。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/health` | 健康检查（`{ok, app, port, mode}`） |
| `GET /api/state` | 完整状态快照（开关、阶段、学科、最近记录、日志、模型信息） |
| `POST /api/config` | 修改配置（`enabled` / `pollIntervalMs` / `llmMode` / `llmBaseURL` / `llmModel` / `llmApiKeyEnv` / `outputDir`） |
| `POST /api/poll` | 单步检测一次前台窗口（不处理） |
| `POST /api/scan` | 处理当前窗口或指定标题（`{title?, text?, force?}`） |
| `POST /api/import` | 导入学习材料并整理（`{title, text}`） |
| `POST /api/rebuild` | 只重建全部 Markdown/Word |
| `GET /api/notes?title=` | 查某条学习记录 |
| `POST /api/notes/markdown` | 取某条记录的 Markdown 源码（`{title}`） |
| `POST /api/open` | 在文件管理器中打开路径（限制在输出目录/数据目录内） |
| `POST /api/llm/test` | 测试模型连接 |
| `GET /api/llm/models` | 拉取模型列表（仅 OpenAI 兼容） |
| `GET /api/stream` | SSE 事件流：`hello` / `state` / `stage` / `log` / `tick` / `foreground` / `result` / `config` |
| `POST /api/shutdown` | 退出服务 |

字段、响应示例、curl 调用与 SSE 事件格式见 [docs/API.md](docs/API.md)。

## CLI 命令表

| 命令 | 说明 |
| --- | --- |
| `node src/cli.mjs serve` | 启动本地 Web 控制台（不带命令时的默认行为） |
| `node src/cli.mjs add <标题> [--text 文本\|--file 文件] [--force]` | 整理一条学习记录（离线模板或已配置的大模型） |
| `node src/cli.mjs import <标题> --file <文件>`（或 `--text -` 读 stdin） | 导入学习材料并整理（**必须提供材料**） |
| `node src/cli.mjs list` | 列出输出目录/数据目录、生成方式、学科与已整理内容 |
| `node src/cli.mjs rebuild` | 只从已保存的总结重建 Markdown/Word，不调用模型 |
| `node src/cli.mjs config [get <key>] [set <key> <value>]` | 查看/修改配置（`key` 支持 `llm.mode` 这种点号路径） |
| `node src/cli.mjs test-llm` | 测试大模型连接（离线模式只提示无需联网） |

通用选项：`--config <path>`、`--port <n>`（仅 serve）、`--no-open`（仅 serve）、`--force`、`--json`、`-h/--help`。

退出码：`0` 成功；`1` 运行失败（处理失败、模型测试失败等）；`2` 用法错误（缺标题、未知子命令等）。

## Windows 前台窗口自动检测（可选）

- **只在 Windows 上可用**。实现方式：`data/foreground.ps1` 里调 `user32.dll` 读前台窗口标题与进程名，PowerShell 把结果写进 UTF-8 临时文件再读回（绕开控制台编码问题，中文标题不乱码）。不联网、不截图、不读页面内容。
- 判定流程：进程名在白名单（`watch.browsers` / `watch.clients`）→ 清理标题（去掉 ` - Google Chrome`、`_哔哩哔哩_bilibili` 等后缀）→ 命中忽略规则则跳过（B 站首页、搜索页、`about:blank`、过短标题等）→ 同一标题连续 `stablePolls` 次命中才处理 → 已处理过的标题（忽略大小写/标点/空白）直接跳过。
- 开启方式：Web 顶栏开关，或 `POST /api/config {"enabled": true}`，或 `node src/cli.mjs config set enabled true`。
- **macOS / Linux**：`watchSupported` 为 `false`，自动检测会被忽略。用「导入文本」或 CLI `add` 手动给标题即可：

```bash
node src/cli.mjs add "摄影基础：曝光三要素" --file ./materials.txt
curl -X POST http://127.0.0.1:7870/api/scan -H 'content-type: application/json' -d '{"title":"摄影基础：曝光三要素"}'
```

- 不读视频内容、不下载视频、不抓弹幕：这里只做事后整理，不做搬运。

## 隐私与安全

- **默认不出网**：`llm.mode = "offline"` 时不发起任何 HTTP 请求。只有把模式切成 `openai` / `anthropic` 并设置了 Key，才会连你自己配置的 `llm.baseURL`。
- **零遥测**：没有统计上报、没有版本检查、没有崩溃上报、没有账号。
- **数据只在本机**：笔记在 `outputDir`，状态/日志在 `dataDir`；HTTP 服务只监听 `127.0.0.1`。
- **密钥不进配置文件**：优先用环境变量（`llm.apiKeyEnv` 指定的变量名）。配置里的 `llm.apiKey` 会明文落盘，不建议使用；`config/config.json` 与 `data/` 已在 `.gitignore` 中。
- **打开路径受限**：`/api/open` 只允许打开输出目录或数据目录内的路径。

## 已知限制

- 离线引擎是**抽取式**的：不会推理、不会补充原文外的知识；没有材料时只产出学习框架。
- Word 输出支持标题/段落/引用/列表/代码块/思维导图大纲，不支持图片、表格、脚注等复杂排版。
- 自动检测仅 Windows；其他平台靠手动标题或导入学习材料。
- 单机单用户，没有权限体系；不要把 `web.host` 改成 `0.0.0.0` 暴露到局域网/公网。
- 去重按标题（忽略大小写与标点），标题相同的不同内容会被视为同一条记录。
- 学科归类靠标题里的别名匹配，不会分析材料内容；命名不规范时可能落到 `待分类`。

## 开发与测试

```bash
node -v                 # 需要 >= 20
npm test                # 等价于 node --test（测试全部用 node:test，不装依赖）
npm run smoke           # 端到端冒烟：临时目录里生成多条示例记录并校验 Markdown/Word
npm run dev             # serve --no-open
```

- 测试不联网：模型协议的测试用 `node:http` 起本地假服务（`tests/llm.test.mjs`），生成流程用临时目录（`scripts/smoke.mjs`）。
- 目录结构：

```text
jot/
├── src/
│   ├── cli.mjs            # CLI 入口（serve/add/import/list/rebuild/config/test-llm）
│   ├── index.mjs          # 包入口：统一导出，供二次开发调用
│   ├── log.mjs            # 文件日志 + 内存环形缓冲
│   ├── core/
│   │   ├── config.mjs     # 默认值/合并/校验/原子写
│   │   ├── state.mjs      # 去重、学科与内容记录、事件日志
│   │   ├── subjects.mjs   # 学科归类、目录命名、标题清洗
│   │   ├── text.mjs       # 分句/分词/句子打分/关键词/相似度去重
│   │   ├── offline.mjs    # 离线摘要引擎（抽取式 + 框架模板）
│   │   ├── prompt.mjs     # 大模型提示词（固定 JSON 输出）
│   │   ├── render.mjs     # 结构化 summary → Markdown
│   │   ├── pipeline.mjs   # 单条记录流水线 + 重建
│   │   └── docx/          # 纯 JS OOXML（writer.mjs）与 ZIP（zip.mjs）
│   ├── llm/               # openai.mjs / anthropic.mjs / index.mjs（回退逻辑）
│   ├── watch/             # 前台窗口检测（Windows 实现 + 跨平台兜底）
│   └── server/            # HTTP API、SSE、静态控制台
├── config/config.example.json
├── config/config.schema.json
├── examples/              # 示例配置与示例学习材料
├── scripts/smoke.mjs      # 端到端冒烟
├── tests/                 # node:test 测试
└── docs/                  # API / 服务商 / 架构 / FAQ
```

- 想直接调用库接口（不经 CLI/Web），可以 `import { loadConfig, StateStore, processTitle } from './src/index.mjs'`，示例见 `src/index.mjs` 顶部注释。
- 贡献流程与代码约定见 [CONTRIBUTING.md](CONTRIBUTING.md)；版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 文档

- [docs/API.md](docs/API.md) — HTTP API 与 SSE 事件完整字段、curl 示例
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — 接入 Ollama / LM Studio / vLLM / DeepSeek / OpenAI
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 模块划分、数据流、为什么 Word 不用 python-docx
- [docs/FAQ.md](docs/FAQ.md) — 常见问题（端口、乱码、401/429、Word 打不开、清空状态…）

## 常见问题（速览）

- **离线能用吗？** 能。默认就是离线，导入学习材料后可直接生成 Markdown + Word；没有材料只会生成学习框架。
- **笔记质量比大模型差？** 是，见上面「生成质量」。离线引擎保证结构完整与原文可追溯，不负责推理归纳。
- **Word 打不开 / 中文变方框？** 文件是标准 OOXML ZIP，Word 2016+ 与 WPS 都能开；中文统一用 `宋体`（eastAsia），若仍异常请换用最新版 WPS/Word 并确认字体已安装。
- **端口 7870 被占？** 会自动顺延到下一个可用端口，实际地址看控制台输出 / `data/server.json`；也可 `--port` 或 `STUDY_PORT` 指定。
- **密钥放哪？** 环境变量 `STUDY_LLM_API_KEY`（或 `llm.apiKeyEnv` 指定的名字）。配置文件里不要写。
- **为什么不做 B 站抓取/下载？** 只做「标题 + 你提供的材料」的笔记整理，不下载视频、不抓弹幕、不绕登录，避免版权与账号风险。
- **如何提升质量？** 接本地模型（Ollama/LM Studio 的 7B 以上）或云端 API；给足材料；调 `prompt.persona` / `prompt.goal` / `llm.model`。

更多见 [docs/FAQ.md](docs/FAQ.md)。

## License 与致谢

[MIT](LICENSE) © Jot contributors。

致谢思路来源：本地优先（local-first）工具、`node:test` 内置测试、以及所有在离线环境下仍坚持做笔记的人。项目不依赖任何第三方运行时库——Word 生成、ZIP 打包、窗口检测都只用 Node 内置能力。

---

## English Quickstart

**Jot** — an offline-first study-notes assistant. It turns the title of any learning content (a video lesson, tutorial, lecture, book chapter, podcast, tech talk…) plus optional text material into Markdown and Word notes, organized by subject. Fully offline by default; optionally connects to any OpenAI-compatible or Anthropic-compatible LLM (Ollama, LM Studio, vLLM, DeepSeek, OpenAI…). Zero runtime dependencies, pure-JS DOCX generation, local web console at `127.0.0.1:7870`, no telemetry.

Requirements: Node.js >= 20.

```bash
npm start
# open http://127.0.0.1:7870
```

Without npm:

```bash
node src/cli.mjs serve
```

Command-line usage:

```bash
node src/cli.mjs add "Photography Basics: Exposure Triangle" --file ./materials.txt
node src/cli.mjs import "Python Intro: Variables and Loops" --file ./materials.txt
node src/cli.mjs list
node src/cli.mjs rebuild
```

Enable an LLM (key stays in an environment variable, never in the config file):

```bash
export STUDY_LLM_API_KEY=sk-...        # PowerShell: $env:STUDY_LLM_API_KEY="sk-..."
node src/cli.mjs config set llm.mode openai
node src/cli.mjs config set llm.baseURL http://127.0.0.1:11434/v1   # Ollama
node src/cli.mjs config set llm.model qwen2.5:7b
node src/cli.mjs test-llm
```

If the model call fails, notes fall back to the offline engine automatically. Notes are written to `./课程知识地图/<subject>/` by default; state and logs go to `./data/`.

**Honest note:** the offline engine is extractive (it quotes and restructures your material; it does not reason). Quality is clearly below an LLM — that is the trade-off for working fully offline.

Docs: [API](docs/API.md) · [Providers](docs/PROVIDERS.md) · [Architecture](docs/ARCHITECTURE.md) · [FAQ](docs/FAQ.md). License: [MIT](LICENSE).
