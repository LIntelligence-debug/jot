# HTTP API 与 SSE 事件

离线学习笔记助手的本地服务（默认 `http://127.0.0.1:7870`）同时提供控制台静态页面与 JSON API。除 SSE 外所有接口都返回 JSON（`content-type: application/json; charset=utf-8`，`cache-control: no-store`）。

- 服务只监听 `web.host`（默认 `127.0.0.1`），没有鉴权，**不要**把 `web.host` 改成 `0.0.0.0` 暴露出去。
- 请求体上限 **1MB**，超限报错 `请求体过大（上限 1MB）`；请求体不是合法 JSON 时报错 `请求体不是合法 JSON`。
- 请求体为空时按 `{}` 处理。
- 处理器内部抛出的异常统一转成 **HTTP 500** + `{"ok": false, "error": "..."}`，同时写入 `data/web.log` 并通过 SSE `log` 事件推送。
- 各字段的实际默认值见 `src/core/config.mjs` 的 `DEFAULTS`、[config/config.example.json](../config/config.example.json) 与 [config/config.schema.json](../config/config.schema.json)。
- 下文示例中的路径统一用 `C:\notes\jot\` 作占位，实际以你的 `outputDir` / `dataDir` 为准。

> Windows PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，本文示例请用 `curl.exe`，或改用 `Invoke-RestMethod`：
> `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:7870/api/config -ContentType 'application/json' -Body '{"enabled":true}'`
>
> **中文请求体的编码坑**：Windows PowerShell 5.1 的 `Invoke-RestMethod` 默认按 ANSI 编码发送字符串 body，直接传中文会变成乱码（服务端按 UTF-8 解析）。带中文时请显式转成 UTF-8 字节，或把 JSON 存成 UTF-8 文件后用 `curl.exe --data-binary @body.json`：
>
> ```powershell
> $payload = @{ title = '摄影基础：曝光三要素'; text = '本节讲光圈、快门与感光度……' } | ConvertTo-Json -Depth 5
> $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
> Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:7870/api/import' `
>   -ContentType 'application/json; charset=utf-8' -Body $bytes
> ```
>
> PowerShell 7+ 默认 UTF-8，无需转换。

---

## 接口一览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/state` | 完整状态快照 |
| POST | `/api/config` | 修改配置 |
| POST | `/api/poll` | 单步检测前台窗口（不处理） |
| POST | `/api/scan` | 处理当前窗口或指定标题 |
| POST | `/api/import` | 导入学习材料并整理 |
| POST | `/api/rebuild` | 只重建 Markdown/Word |
| GET | `/api/notes?title=` | 查某条学习记录 |
| POST | `/api/notes/markdown` | 取某条记录的 Markdown 源码 |
| POST | `/api/open` | 在文件管理器中打开路径 |
| POST | `/api/llm/test` | 测试模型连接 |
| GET | `/api/llm/models` | 拉取模型列表（仅 OpenAI 兼容） |
| GET | `/api/stream` | SSE 实时事件流 |
| POST | `/api/shutdown` | 退出服务 |

静态资源：`GET /` 返回控制台 `index.html`，`GET /static/<file>` 返回 `src/server/static/` 下的文件；不存在的路径返回 404 纯文本，越界路径返回 403 JSON `{"ok":false,"error":"禁止访问"}`。

---

## GET /api/health

健康检查。启动时也用它判断「是否已有实例在运行」。

```bash
curl http://127.0.0.1:7870/api/health
```

```json
{
  "ok": true,
  "app": "jot",
  "port": 7870,
  "mode": "offline"
}
```

`port` 是实际监听端口（7870 被占用时会顺延），`mode` 取自 `llm.mode`。

## GET /api/state

返回完整状态快照，控制台首屏与每次操作后都靠它刷新。

```bash
curl http://127.0.0.1:7870/api/state
```

```json
{
  "ok": true,
  "enabled": false,
  "pollIntervalMs": 15000,
  "stablePolls": 2,
  "nextTickAt": 0,
  "running": false,
  "decision": "paused",
  "pending": null,
  "foreground": null,
  "stage": null,
  "lastError": null,
  "lastResult": null,
  "lastResultAt": 0,
  "startedAt": 1762732800000,
  "outputDir": "C:\\notes\\jot\\课程知识地图",
  "dataDir": "C:\\notes\\jot\\data",
  "watchSupported": true,
  "platform": "Windows",
  "now": 1762732800000,
  "subjects": [{ "name": "计算机基础", "videos": 1, "updatedAt": 1762732800000 }],
  "subjectCount": 1,
  "videoCount": 1,
  "recent": [
    {
      "title": "Python 入门：变量与循环",
      "subject": "计算机基础",
      "at": 1762732800000,
      "generatedBy": "offline",
      "noteDocx": "C:\\notes\\jot\\课程知识地图\\计算机基础\\单集笔记\\2026-11-10_Python 入门：变量与循环.docx",
      "noteMd": "C:\\notes\\jot\\课程知识地图\\计算机基础\\单集笔记\\2026-11-10_Python 入门：变量与循环.md",
      "manualDocx": "C:\\notes\\jot\\课程知识地图\\计算机基础\\学习手册.docx"
    }
  ],
  "latest": {
    "subject": "计算机基础",
    "title": "Python 入门：变量与循环",
    "generatedBy": "offline",
    "noteMd": "C:\\notes\\jot\\课程知识地图\\计算机基础\\单集笔记\\2026-11-10_Python 入门：变量与循环.md",
    "noteDocx": "C:\\notes\\jot\\课程知识地图\\计算机基础\\单集笔记\\2026-11-10_Python 入门：变量与循环.docx",
    "summary": { "overview": "…", "knowledgePoints": [] }
  },
  "logs": [{ "at": 1762732800000, "level": "info", "message": "学习助手已启动：http://127.0.0.1:7870" }],
  "llm": {
    "mode": "offline",
    "modeLabel": "离线模板引擎",
    "model": "qwen2.5:7b",
    "baseURL": "http://127.0.0.1:11434/v1",
    "apiKeyEnv": "STUDY_LLM_API_KEY",
    "hasAuth": true
  },
  "web": { "port": 7870, "url": "http://127.0.0.1:7870" }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `enabled` / `pollIntervalMs` / `stablePolls` | 自动检测开关、间隔、稳定次数 |
| `nextTickAt` | 下一次自动检测的时间戳；`0` 表示未排程（未开启或平台不支持） |
| `running` | 是否正在处理一条记录（同一时刻只处理一条） |
| `decision` | 最近一次判定，见下表 |
| `pending` | 等待稳定的候选：`{title, count}` 或 `null` |
| `foreground` | 最近一次读到的前台窗口：`{proc, raw, cleaned, at}` 或 `null` |
| `stage` | 当前处理阶段：`{stage, title, message, at, ...}`，空闲时为 `idle` |
| `lastError` / `lastResult` / `lastResultAt` | 最近一次失败原因 / 最近一次成功结果 / 时间戳 |
| `startedAt` | 服务启动时间戳 |
| `subjects` | `[{name, videos, updatedAt}]`（`videos` 是条目数） |
| `subjectCount` / `videoCount` | 学科数 / 总条目数 |
| `recent` | 最近 60 条记录（按更新时间倒序） |
| `latest` | 最近更新的一条记录（含完整记录与所属 `subject`） |
| `logs` | 最近 120 条内存日志（与 `data/web.log` 同内容） |
| `llm` | 当前生成方式；`hasAuth` 在离线模式下恒为 `true` |
| `web` | 实际端口与 URL |
| `watchSupported` / `platform` | 当前平台是否支持自动读取前台窗口 |

`decision` 取值：

| 值 | 含义 |
| --- | --- |
| `idle` | 尚未开始判定 |
| `paused` | 自动检测未开启 |
| `watch-unsupported` | 当前平台不支持自动读取前台窗口（非 Windows） |
| `window-error` | 读取前台窗口失败（如 PowerShell 超时） |
| `non-video` | 前台进程不在浏览器/播放器白名单 |
| `ignored-window` | 标题被忽略（过短、首页、搜索页等） |
| `waiting` | 已检测到新标题，等待连续命中 `stablePolls` 次 |
| `detected` | 已确认新内容并开始处理 |
| `seen` | 该标题已处理过，跳过 |
| `processed` | 最近一次处理成功 |
| `error` | 最近一次处理失败 |

## POST /api/config

局部修改配置并写回 `config/config.json`。只传想改的字段；字段名是 **扁平 API 名**，不是配置文件里的嵌套名。

可接受的字段：

| API 字段 | 映射到配置 | 校验 |
| --- | --- | --- |
| `enabled` | `enabled` | 只认 `true`，其他值一律按 `false` |
| `pollIntervalMs` | `pollIntervalMs` | 1000~300000 的整数（超出报错「轮询间隔必须在 1~300 秒之间」） |
| `llmMode` | `llm.mode` | `offline` / `openai` / `anthropic` |
| `llmBaseURL` | `llm.baseURL` | 必须 `http(s)://` 开头 |
| `llmModel` | `llm.model` | 非空 |
| `llmApiKeyEnv` | `llm.apiKeyEnv` | 合法环境变量名（`[A-Za-z_][A-Za-z0-9_]*`） |
| `outputDir` | `outputDir` | 非空字符串（相对路径按服务进程 CWD 解析） |

注意：`llm.apiKey`、`llm.authHeader`、`llm.temperature`、`llm.maxTokens`、`llm.timeoutMs`、`llm.fallbackToOffline`、`offline.*`、`prompt.*` 目前**不能**通过这个接口修改，请直接编辑 `config/config.json` 后重启服务。

```bash
curl -X POST http://127.0.0.1:7870/api/config \
  -H 'content-type: application/json' \
  -d '{"enabled":true,"pollIntervalMs":10000}'
```

```json
{
  "ok": true,
  "state": { "ok": true, "enabled": true, "pollIntervalMs": 10000, "...": "其余字段同 /api/state" }
}
```

- 校验失败不会写盘，返回 HTTP 500：`{"ok":false,"error":"轮询间隔必须在 1~300 秒之间"}`。
- 成功后立即重建 provider、重排检测定时器（`enabled: true` 时约 500ms 后开始首次检测），并广播 SSE `config` 事件。
- `outputDir` 修改后会立即 `mkdir -p` 新目录。

## POST /api/poll

单步检测一次前台窗口，只更新判定，**不处理内容**。用于调试「为什么没检测到」。

```bash
curl -X POST http://127.0.0.1:7870/api/poll -H 'content-type: application/json' -d '{}'
```

```json
{
  "ok": true,
  "state": { "decision": "detected", "foreground": { "proc": "chrome", "raw": "Python 入门：变量与循环_哔哩哔哩_bilibili", "cleaned": "Python 入门：变量与循环", "at": 1762732800000 }, "...": "..." }
}
```

在非 Windows 平台上 `decision` 为 `watch-unsupported`，`foreground` 为 `null`。

## POST /api/scan

处理「当前前台窗口」或「指定标题 / 材料」。

请求体：

```json
{ "title": "摄影基础：曝光三要素", "text": "可选：字幕/简介/学习笔记", "force": false }
```

- `title` 省略或为空 → 读取当前前台窗口标题（非 Windows 返回 400；当前前台不是浏览器/播放器或被忽略也返回 400）。
- `text` 最多使用 `maxImportChars`（默认 20000）个字符，超出截断。
- `force: true` → 跳过「已处理过」去重，重新生成（覆盖同名文件）。

```bash
curl -X POST http://127.0.0.1:7870/api/scan \
  -H 'content-type: application/json' \
  -d '{"title":"摄影基础：曝光三要素"}'
```

成功响应（`result` 与 CLI `--json` 输出同构）：

```json
{
  "ok": true,
  "result": {
    "ok": true,
    "title": "摄影基础：曝光三要素",
    "subject": "待分类",
    "generatedBy": "offline",
    "warning": null,
    "noteMd": "C:\\notes\\jot\\课程知识地图\\待分类\\单集笔记\\2026-11-10_摄影基础：曝光三要素.md",
    "noteDocx": "C:\\notes\\jot\\课程知识地图\\待分类\\单集笔记\\2026-11-10_摄影基础：曝光三要素.docx",
    "manualDocx": "C:\\notes\\jot\\课程知识地图\\待分类\\学习手册.docx",
    "docxError": null,
    "summary": {
      "overview": "…（一句话导语）",
      "knowledgePoints": [{ "point": "…", "detail": "…" }],
      "keyTerms": [{ "term": "…", "explain": "…" }],
      "studyTips": ["…"],
      "pitfalls": ["…"],
      "reviewQuestions": ["…"],
      "mindmap": { "title": "…", "children": [] },
      "generatedBy": "offline"
    },
    "video": { "title": "摄影基础：曝光三要素", "subject": "待分类", "noteMd": "…", "noteDocx": "…", "summary": { "…": "同 summary" } }
  }
}
```

失败情形（HTTP 400）：

| `error` | 触发条件 |
| --- | --- |
| `当前平台（macOS）不支持自动读取前台窗口，请直接填写标题` | 未传 `title` 且平台不支持 |
| `当前前台不是浏览器/播放器窗口，或标题被忽略` | 未传 `title` 且判定不是 `detected` |
| 处理错误原文（如 Word/文件写入失败） | 流水线返回 `ok:false` |

已处理过的标题且未加 `force` 时返回 HTTP 200，`result` 为 `{"ok": true, "skipped": true, "reason": "seen", "title": "..."}`。

`generatedBy` 取值：`offline`（离线引擎）、`llm`（大模型）、`offline-fallback`（模型失败后回退离线，此时 `warning` 有说明）。

## POST /api/import

导入学习材料并整理。`title` 与 `text` 都必填。

```bash
curl -X POST http://127.0.0.1:7870/api/import \
  -H 'content-type: application/json' \
  -d '{"title":"Python 入门：变量与循环","text":"变量是给数据起的名字……"}'
```

```json
{ "ok": true, "result": { "ok": true, "title": "Python 入门：变量与循环", "subject": "计算机基础", "generatedBy": "offline", "noteMd": "…", "noteDocx": "…" } }
```

缺少字段时返回 HTTP 400：`{"ok":false,"error":"缺少标题"}` / `{"ok":false,"error":"缺少导入文本（字幕/简介/笔记）"}`。

该接口同样接受可选的 `force: true`（跳过「已处理过」去重、覆盖同名文件）。重复导入同一标题且未加 `force` 时不报错，返回 HTTP 200 且 `result` 为 `{"ok":true,"skipped":true,"reason":"seen","title":"..."}`。

## POST /api/rebuild

只从 `data/state.json` 里已保存的总结重建所有 Markdown/Word，**不调用模型、不联网**。也用于「Word 文件被删/损坏」后的修复。

```bash
curl -X POST http://127.0.0.1:7870/api/rebuild -H 'content-type: application/json' -d '{}'
```

```json
{
  "ok": true,
  "outcome": [
    { "subject": "计算机基础", "ok": true, "error": null },
    { "subject": "待分类", "ok": true, "error": null },
    { "subject": "课程总览", "ok": true, "error": null }
  ]
}
```

- 每个学科一条（重建 `学习手册.md` + `学习手册.docx`），最后额外一条 `课程总览`。
- `ok` 为 `true` 仅当全部条目成功；有失败条目时为 `false`，但接口仍返回 HTTP 200，失败原因在 `error` 里。

## GET /api/notes?title=

按标题查某条学习记录（`title` 需要 URL 编码）。去重规则：忽略大小写、空白与标点。

```bash
curl "http://127.0.0.1:7870/api/notes?title=Python%20%E5%85%A5%E9%97%A8%EF%BC%9A%E5%8F%98%E9%87%8F%E4%B8%8E%E5%BE%AA%E7%8E%AF"
```

```json
{
  "ok": true,
  "subject": "计算机基础",
  "video": {
    "title": "Python 入门：变量与循环",
    "subject": "计算机基础",
    "generatedBy": "offline",
    "inputChars": 0,
    "noteMd": "C:\\notes\\jot\\课程知识地图\\计算机基础\\单集笔记\\2026-11-10_Python 入门：变量与循环.md",
    "noteDocx": "C:\\notes\\jot\\课程知识地图\\计算机基础\\单集笔记\\2026-11-10_Python 入门：变量与循环.docx",
    "manualMd": "C:\\notes\\jot\\课程知识地图\\计算机基础\\学习手册.md",
    "manualDocx": "C:\\notes\\jot\\课程知识地图\\计算机基础\\学习手册.docx",
    "summary": { "...": "..." },
    "createdAt": 1762732800000,
    "updatedAt": 1762732800000
  }
}
```

找不到返回 HTTP 404：`{"ok":false,"error":"没有找到该记录"}`。

## POST /api/notes/markdown

取某条记录的 Markdown 源码（控制台「查看 Markdown」用）。磁盘文件读不到时会用记录重新渲染一份返回。

```bash
curl -X POST http://127.0.0.1:7870/api/notes/markdown \
  -H 'content-type: application/json' \
  -d '{"title":"Python 入门：变量与循环"}'
```

```json
{
  "ok": true,
  "markdown": "## Python 入门：变量与循环\n\n> …\n\n### 内容信息\n…",
  "path": "C:\\notes\\jot\\课程知识地图\\计算机基础\\单集笔记\\2026-11-10_Python 入门：变量与循环.md"
}
```

找不到返回 HTTP 404：`{"ok":false,"error":"没有找到该记录"}`。

## POST /api/open

在系统文件管理器中打开一个路径。**只能打开输出目录或数据目录内的路径**（含两者本身）；不传 `path` 时打开输出目录。

```bash
curl -X POST http://127.0.0.1:7870/api/open \
  -H 'content-type: application/json' \
  -d '{"path":"C:\\\\notes\\\\jot\\\\课程知识地图\\\\课程总览.docx"}'
```

```json
{ "ok": true, "path": "C:\\notes\\jot\\课程知识地图\\课程总览.docx" }
```

越界或不存在时返回 HTTP 500：`{"ok":false,"error":"只能打开输出目录或数据目录内的路径"}` / `{"ok":false,"error":"路径不存在：C:\\..."}`。

## POST /api/llm/test

发一个极小的请求测试模型连通性（离线模式直接返回「不需要联网」）。

```bash
curl -X POST http://127.0.0.1:7870/api/llm/test -H 'content-type: application/json' -d '{}'
```

离线模式（HTTP 200）：

```json
{ "ok": true, "mode": "offline", "message": "当前为离线模式，不需要联网；笔记由本地模板引擎生成。", "ms": 0 }
```

正常连通（HTTP 200）：

```json
{ "ok": true, "mode": "openai", "model": "qwen2.5:7b", "ms": 812, "reply": "OK" }
```

失败（HTTP 400）：

```json
{ "ok": false, "mode": "openai", "error": "未设置 API Key：请设置环境变量 STUDY_LLM_API_KEY" }
```

## GET /api/llm/models

拉取模型列表。**仅 OpenAI 兼容模式支持**（`GET {baseURL}/models`）；Anthropic 兼容协议没有该接口，会返回失败提示。

```bash
curl http://127.0.0.1:7870/api/llm/models
```

```json
{ "ok": true, "models": ["qwen2.5:7b", "llama3.1:8b"] }
```

离线模式（HTTP 200）：

```json
{ "ok": true, "models": ["offline（本地模板引擎，不需要模型）"] }
```

失败（HTTP 400）：`{"ok":false,"models":[],"error":"未设置 API Key：…"}`，Anthropic 模式为 `{"ok":false,"models":[],"error":"Anthropic 兼容协议没有模型列表接口，请直接填写模型名"}`。

## GET /api/stream（SSE）

实时事件流。连接后先收到一次 `hello`，之后服务端每次状态变化推送一个命名事件。

```bash
curl -N http://127.0.0.1:7870/api/stream
```

响应头：`content-type: text/event-stream; charset=utf-8`、`cache-control: no-cache, no-transform`、`connection: keep-alive`。首帧为 `retry: 3000`（浏览器断线 3 秒后重连），之后每 15 秒发一行注释 `: ping` 保活。

事件格式：

```text
event: stage
data: {"stage":"summarize","title":"Python 入门：变量与循环","subject":"计算机基础","message":"正在生成学习笔记…","at":1762732800000}
```

| 事件 | `data` 内容 | 触发时机 |
| --- | --- | --- |
| `hello` | 完整状态快照（同 `/api/state`） | 客户端刚连上 |
| `state` | 完整状态快照 | 开始处理 / 处理结束 |
| `stage` | `{stage, title, subject?, message, at, noteDocx?, manualDocx?, result?}` | 每个阶段变化（`start` / `classify` / `summarize` / `write` / `done` / `idle`） |
| `log` | `{at, level, message}`，`level` 为 `info` / `warn` / `error` / `success` | 有新日志（含所有 API 错误） |
| `tick` | `{at, decision, pendingCount, nextTickAt}` | 每次自动检测结束 |
| `foreground` | `{proc, raw, cleaned, at}` | 读到前台窗口时（自动检测或手动 poll/scan） |
| `result` | 处理结果对象（同 `/api/scan` 的 `result`） | 一条记录处理成功 |
| `config` | `{enabled, pollIntervalMs}` | `/api/config` 修改成功 |

注意：

- 事件是**广播**的：多个浏览器标签会收到同一份事件。
- 服务端不重放历史事件；断线重连后请重新拉 `/api/state`（`hello` 就带完整快照）。
- `stage.result` 与 `result` 事件里的对象可能很大（含完整 `summary` 与记录路径），脚本解析时注意体积。

## POST /api/shutdown

优雅退出：先返回响应，约 150ms 后关闭 SSE 连接、写入 `data/server.json`（`port` 置 0）并 `process.exit(0)`。

```bash
curl -X POST http://127.0.0.1:7870/api/shutdown -H 'content-type: application/json' -d '{}'
```

```json
{ "ok": true }
```

控制台右上角「退出」按钮调的就是这个接口。CLI 前台运行时也可以用 `Ctrl+C`。

---

## 一个完整的脚本示例

用 PowerShell 一次性导入一条学习材料并读取 Markdown（注意 UTF-8 字节，见文首说明）：

```powershell
$base = 'http://127.0.0.1:7870'
$payload = @{
  title = 'Python 入门：变量与循环'
  text  = Get-Content '.\materials.txt' -Raw
} | ConvertTo-Json -Depth 5

$r = Invoke-RestMethod -Method Post -Uri "$base/api/import" `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
$r.result.generatedBy
$r.result.noteDocx

$mdBody = [System.Text.Encoding]::UTF8.GetBytes((@{ title = 'Python 入门：变量与循环' } | ConvertTo-Json))
Invoke-RestMethod -Method Post -Uri "$base/api/notes/markdown" `
  -ContentType 'application/json; charset=utf-8' -Body $mdBody
```

用 bash + curl（中文请求体建议写进 UTF-8 文件再用 `--data-binary @file`）：

```bash
cd jot
node src/cli.mjs serve --no-open &
sleep 1
node -e "const fs=require('fs');fs.writeFileSync('/tmp/body.json',JSON.stringify({title:'Python 入门：变量与循环',text:fs.readFileSync('./materials.txt','utf8')}))"
curl -s -X POST http://127.0.0.1:7870/api/import \
  -H 'content-type: application/json' --data-binary @/tmp/body.json
curl -s -X POST http://127.0.0.1:7870/api/shutdown -d '{}' -H 'content-type: application/json'
```
