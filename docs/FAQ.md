# 常见问题（FAQ）

## 离线相关

### 真的完全离线吗？会不会偷偷联网？

默认配置（`llm.mode = "offline"`）下不会发起任何网络请求：没有遥测、没有版本检查、没有字体/图标 CDN，控制台样式与脚本都是仓库内的静态文件。只有你把 `llm.mode` 改成 `openai` 或 `anthropic` 并且设置了 API Key，程序才会 `fetch` 你配置的 `llm.baseURL`。

想自己确认：断网后跑 `node src/cli.mjs add "任意标题" --text "一段文本"`，能正常产出 Markdown/Word；或者用系统防火墙/抓包工具观察进程，离线模式下没有外部连接。

### 离线生成的笔记为什么像模板/没有深度？

因为离线引擎是**抽取式**的（见 [ARCHITECTURE.md](ARCHITECTURE.md#3-离线引擎coretextmjs--coreofflinemjs)）：它只会分句、打分、抽关键词、把原文句子重排进固定章节，不会推理、不会补充材料里没有的内容。没有导入材料时更只是「学习框架模板」，需要你对照原始内容补充。

这是产品取舍：保证断网可用、隐私可控、结果可追溯（每句都能在原文里找到）。要更强的归纳能力，接一个大模型即可，见 [PROVIDERS.md](PROVIDERS.md)。

### 离线模式也能生成 Word 吗？

能。Word 生成完全在本地、纯 JS 完成，和模型模式没有区别。

### 没有网络能启动 Web 控制台吗？

能。服务只监听 `127.0.0.1`，页面资源全在本地，启动不会检查更新。

## 中文 / 编码 / 乱码

### 笔记文件是什么编码？有 BOM 吗？

全部是 **UTF-8 无 BOM**（`.editorconfig` 要求 `charset = utf-8`）。读取时也兼容 BOM（配置、状态、导入文本都会先剥掉 BOM），所以从 Windows 记事本/Excel 复制带 BOM 的内容不会出错。

### 控制台里中文显示成乱码？

- 文件本身是 UTF-8，浏览器页面声明 `<meta charset="utf-8">`，正常不会乱码。
- 如果是 **Windows 控制台（cmd/PowerShell）** 里 `node src/cli.mjs list` 输出中文乱码，那是终端代码页问题：先执行 `chcp 65001`，或用 Windows Terminal，或 `--json` 输出后用支持 UTF-8 的工具查看。
- 如果 Word 里中文变方框：确认系统有「宋体」；文件设置的是 `eastAsia="宋体"`，WPS 与 Word 2016+ 都正常。

### 用 PowerShell 调 API 时中文标题变成乱码/查不到

Windows PowerShell 5.1 的 `Invoke-RestMethod` 默认按 ANSI 编码发送字符串 body，服务端按 UTF-8 解析，于是标题里出现乱码，表现为「分类成了待分类」「`/api/notes` 404」。两种解决方式：

```powershell
# 1) 显式转 UTF-8 字节
$payload = @{ title = '摄影基础：曝光三要素'; text = '本节讲……' } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:7870/api/import' `
  -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
```

```powershell
# 2) 用 curl.exe + UTF-8 文件
node -e "require('fs').writeFileSync('body.json', JSON.stringify({title:'摄影基础：曝光三要素',text:'本节讲……'}))"
curl.exe -X POST http://127.0.0.1:7870/api/import -H "content-type: application/json" --data-binary "@body.json"
```

PowerShell 7+ / bash / macOS 终端默认 UTF-8，一般不会遇到。CLI 用 `--file`（文件按 UTF-8 读）最稳，`--text "中文"` 是否乱码取决于终端代码页。

### 导入的中文标题里的「：」「【】」会怎样？

文件系统安全的半角字符 `\ / : * ? " < > |` 与换行会被替换成空格；全角「：」「【】」在 Windows 上合法，会原样保留在文件名里。标题在文件名中截断到 40 字。

## 端口 / 启动 / 进程

### 7870 被占用怎么办？

程序会自动从 7870 开始往后找可用端口（最多尝试 20 个），实际地址以控制台输出或 `data/server.json` 的 `url` 为准。也可以显式指定：

```bash
node src/cli.mjs serve --port 8080
# 或
$env:STUDY_PORT = "8080"
```

### 启动后浏览器没自动打开？

- 用了 `--no-open` 或配置里 `web.openBrowser: false`；
- 手动访问 `http://127.0.0.1:7870`（或控制台打印的地址）；
- 无桌面环境（服务器/容器）时不会打开浏览器，属于预期。

### 为什么第二次 `npm start` 没有报错，而是直接打开了页面？

启动时会检查 `data/server.json` 里记录的端口并请求 `/api/health`：已有实例在跑就只打开浏览器、返回 `{existing:true}`，不会重复监听（避免两个进程写同一份状态）。要重启用 `POST /api/shutdown`、控制台「退出」，或 `Ctrl+C`。

### 怎么退出服务？

控制台右上「退出」按钮 / `Ctrl+C` / `curl -X POST http://127.0.0.1:7870/api/shutdown -d "{}" -H "content-type: application/json"`。

### `npm start` 报 `node: command not found` / `'node' 不是内部或外部命令`？

机器上没装 Node 或没进 PATH。装 Node.js >= 20（LTS 即可）后重开终端；也可以直接用 Node 的绝对路径跑 `node src/cli.mjs serve`。

### 能部署到服务器/局域网给多人用吗？

不建议。设计是**单机单用户**：服务无鉴权，且 `/api/open` 会调用系统文件管理器。虽然可以改 `web.host`，但请务必只在本机使用；要共享笔记，直接分享 `课程知识地图/` 目录下的文件。

## 自动检测

### 为什么自动检测没反应？

1. 只在 **Windows** 上可用（`watchSupported: true`）；macOS/Linux 会显示「当前系统不支持自动读取前台窗口」。
2. 顶栏开关要打开（`enabled: true`）；打开后首次检测约 500ms 后开始。
3. 前台进程要在白名单里（`watch.browsers` / `watch.clients`）：Chrome、Edge、Firefox、B 站/抖音/快手/优酷/爱奇艺/腾讯视频客户端、PotPlayer/VLC/mpv 等。
4. 标题不能命中忽略规则（B 站首页/搜索页、过短标题、`about:blank`、`chrome://` 等）。
5. 需要连续 `stablePolls`（默认 2）次命中才会处理。

用「单步检测」（`POST /api/poll`）能看到最近读到的原始标题、清理后标题与判定结果（`decision`/`foreground`）。

### 检测到的是浏览器首页/别的标签页标题怎么办？

- 先切到真正的视频播放页再等检测；标题里有 `_哔哩哔哩_bilibili` 之类的后缀会被自动清理；
- 调大 `titleMinLen` 或补充 `watch.browsers`/`watch.clients` 白名单（支持 `chrome`、`msedge`、`firefox`、`potplayer` 这类进程名，大小写与 `.exe` 不敏感）；
- 或者干脆关掉自动检测，用「立即扫描」/「导入文本」/ CLI `add` 手动指定标题。

### macOS / Linux 上怎么用？

自动检测被禁用，用「导入文本」或 CLI：

```bash
node src/cli.mjs add "摄影基础：曝光三要素" --file ./materials.txt
```

API 也支持直接给标题：`POST /api/scan {"title":"..."}`。

### 会抓取视频内容、弹幕或评论吗？

不会。项目只处理「内容标题 + 你提供的材料」，不下载视频、不抓弹幕/评论、不模拟登录换取内容。笔记结构里也没有弹幕/评论字段。

## 大模型相关

### 密钥应该放在哪？

环境变量，变量名由 `llm.apiKeyEnv` 指定（默认 `STUDY_LLM_API_KEY`）：

```powershell
$env:STUDY_LLM_API_KEY = "sk-..."
node src/cli.mjs test-llm
```

不要写进 `config/config.json`（即使写了 `llm.apiKey` 也只是明文落盘、不推荐）。程序**不会**自动加载 `.env` 文件。

### 报 401 / 403（鉴权失败）

- 环境变量名和 `llm.apiKeyEnv` 不一致（大小写敏感）；
- Key 无效/过期/额度用完，或与端点不匹配（换厂商要换 Key 和 baseURL）；
- PowerShell 里设了变量但服务是在别的窗口/别的用户下启动的——环境变量按进程继承，改完要重启服务。

### 报 429（请求过于频繁 / 额度不足）

等一会儿再试；换更小的模型或换服务商；降低导入文本长度（`maxImportChars`）以减少 token。离线模式完全不受影响。

### 报 404 / 400 / 模型不存在

- 404：OpenAI 兼容的 `baseURL` 通常**必须带 `/v1`**（如 `http://127.0.0.1:11434/v1`）；
- 400：模型名写错、该模型不支持 `temperature`/`max_tokens` 参数、上下文超限（减小 `maxImportChars`）；
- Anthropic 兼容：`baseURL` 已带 `/v1` 时程序会拼 `/messages`，否则拼 `/v1/messages`，不要自己多写一遍。

### 公司网络要走代理怎么办？

Node 内置的 `fetch` **默认不读取** `HTTP_PROXY`/`HTTPS_PROXY` 环境变量（Node 24+ 可用 `NODE_USE_ENV_PROXY=1` 开启对 `fetch` 的代理支持，具体以你的 Node 版本为准）。可选方案：用本地模型（Ollama/LM Studio，绕开代理）、在系统层设置代理、或换一台能直连的机器。

### 模型返回内容不是 JSON，笔记会不会失败？

不会（默认配置下）。程序容忍 ```` ```json ```` 代码块、前后解释、尾逗号、未加引号的键名；实在解析不出会重试一次，仍失败则**回退离线引擎**，笔记照常生成，`generatedBy` 记为 `offline-fallback`，`warning`/日志里带原因。

想让失败直接暴露，把 `llm.fallbackToOffline` 设成 `false`。

### 我怎么知道这条笔记是模型生成的还是离线的？

打开笔记，`### 内容信息` 里有「生成方式」：`离线模板整理（未接入大模型）` / `离线模板整理（模型调用失败后回退）` / `大模型生成（provider · model）`。控制台的「生成方式」卡片和 `data/web.log` 也有记录。

## 输出 / 文件

### 笔记存在哪里？

`outputDir`，默认 `<项目根>/课程知识地图/`。`node src/cli.mjs list` 会打印输出目录、数据目录与各学科集数；控制台「打开输出目录」按钮直接打开。结构见 [README](../README.md#输出目录结构)。

### 只重建文档、不想重新生成笔记怎么办？

```bash
node src/cli.mjs rebuild
# 或
curl -X POST http://127.0.0.1:7870/api/rebuild -H "content-type: application/json" -d "{}"
```

它只从 `data/state.json` 里已保存的总结重新渲染 Markdown/Word，不调用模型、不联网。适合「Word 被误删」「改了渲染逻辑想更新所有文档」的场景。

### Word 打不开 / 提示文件损坏

1. 先确认文件不是 0 字节；Markdown 一定在，Word 失败时结果里 `docxError` 会给出原因，`data/events.jsonl` 里也有 `docx-error` 事件。
2. 校验文件结构（标准 ZIP/OOXML）：

```bash
node --input-type=module -e "import {readFileSync} from 'node:fs'; import {readZip} from './src/core/docx/zip.mjs'; const z=readZip(readFileSync(process.argv[1])); console.log([...z.keys()].join('\n'))" "课程知识地图/课程总览.docx"
```

应当列出 `[Content_Types].xml`、`word/document.xml`、`word/styles.xml` 等条目。

3. 仍打不开时：换 WPS 试；确认 Word 版本（需要 Word 2007+ / WPS 2016+）；把该文件重命名为 `.zip` 看能否解压；然后提 issue 附 Word 版本、文件与 `data/events.jsonl`。
4. 应急：`node src/cli.mjs rebuild` 重新生成一次。

### 怎么清空/重置状态？

- **只想重新生成某条记录**：`node src/cli.mjs add "标题" --force`（覆盖同名文件），或 API `POST /api/scan {"title":"...","force":true}`。
- **清空「已处理」记录（保留笔记）**：删除 `data/state.json`（可先备份）。
- **彻底重置**：删掉 `data/` 与 `课程知识地图/`，重启服务（会重新生成默认 `state.json`）。
- **改回默认配置**：删 `config/config.json` 后重启会按默认值重建。

### 改了 `config/config.json` 为什么不生效？

运行中的服务持有内存里的配置。用 Web「设置」或 `POST /api/config` 会立即生效；直接编辑 JSON 的话需要重启服务。另外注意优先级：**默认值 < 配置文件 < 环境变量**，`STUDY_PORT` / `STUDY_OUTPUT_DIR` / `STUDY_DATA_DIR` 可能覆盖了文件里的值。

### 导入文本太长被截断了？

默认 `maxImportChars: 20000`（模型提示词与离线引擎都按这个上限取材料）。可以调大（校验要求 ≥ 200），但请注意模型的上下文与成本；太长的材料建议按章节拆开导入。

### 同一条内容导入两次，文件会重复吗？

不会。去重按标题（忽略大小写、空白、标点）；再次处理同一标题会被当作「已处理过」跳过，加 `--force` 才会重新生成并覆盖同名文件、更新记录。

### 「待分类」是什么？

标题没有命中任何预设学科别名（`subjects.core` 里的 `aliases`）、也不包含已有学科名时，会归到 `待分类/`（与所有学科同级的目录）。可以在 `subjects.core` 里补别名，或改标题让它命中（例如标题里带「Python」→ 计算机基础）。

## 开发 / CI

### 本地怎么跑测试？

```bash
node -v        # >= 20
node --test    # 或 npm test
node scripts/smoke.mjs   # 端到端冒烟（不联网）
```

测试不需要网络：模型协议的测试用 `node:http` 起本地假服务，生成流程用临时目录。

### CI 失败怎么排查？

- 先看 Node 版本：工作流矩阵是 Node 20 / 22 × Ubuntu / Windows，本地版本不同可能暴露不同的 `fetch`/`AbortSignal.timeout` 行为；
- 测试会写临时目录（`node:os` 的 `tmpdir()`），如果 CI 环境禁写临时目录或杀毒软件拦截，会报 `EPERM`/`EACCES`；
- 沙箱/受限环境里 `node --test` 需要为自己派生子进程（默认管道 stdio），某些限制性沙箱会返回 `spawn EPERM`——这是环境限制，不是测试失败，在普通终端/CI 上正常；
- 冒烟脚本失败会打印缺失的文件路径，可直接对照 [README 的输出目录结构](../README.md#输出目录结构)。

### 怎么参与开发？

见 [CONTRIBUTING.md](../CONTRIBUTING.md)：保持零运行时依赖、`node --test` 通过、改动同步更新文档与测试。
