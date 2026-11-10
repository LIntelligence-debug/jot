# 接入大模型（Providers）

笔记工坊默认 `llm.mode = "offline"`，不联网。接入大模型是可选的**增强**：失败会自动回退离线引擎，笔记不会丢。

- 支持两种协议：**OpenAI 兼容**（`/chat/completions`）与 **Anthropic 兼容**（`/v1/messages`）。
- 密钥只从环境变量读取，配置文件里不存明文。
- 具体字段与默认值：`src/core/config.mjs` 的 `DEFAULTS.llm`、[config/config.example.json](../config/config.example.json)。
- 示例配置：[examples/config.ollama.json](../examples/config.ollama.json)、[examples/config.deepseek.json](../examples/config.deepseek.json)。

## 1. 先设置 API Key

密钥变量名由 `llm.apiKeyEnv` 决定，默认 `STUDY_LLM_API_KEY`。程序**不会**自动读取 `.env` 文件（`.gitignore` 里的 `.env` 只是防止你误提交），必须真的把它放进进程环境：

```powershell
# PowerShell（当前窗口有效）
$env:STUDY_LLM_API_KEY = "sk-xxxxxxxx"

# 同一个窗口里验证
node src/cli.mjs test-llm
```

```bat
:: cmd.exe（当前窗口有效）
set STUDY_LLM_API_KEY=sk-xxxxxxxx
```

```bash
# bash / zsh（当前 shell 有效）
export STUDY_LLM_API_KEY="sk-xxxxxxxx"
```

需要持久化（重启终端仍有效）：

- Windows：`setx STUDY_LLM_API_KEY "sk-xxxxxxxx"`（新开终端生效），或在「系统属性 → 环境变量」里加。
- macOS/Linux：写进 `~/.zshrc` / `~/.bashrc`。

本地模型服务（Ollama / LM Studio）通常不校验 Key，但客户端**只有在 Key 非空时才会发请求**（`hasAuth()` 判断）。随便给一个占位值即可：`$env:STUDY_LLM_API_KEY = "local"`。

> 不建议在 `config/config.json` 里写 `llm.apiKey`：它会明文落盘，而且 `config/config.json` 虽然已在 `.gitignore` 里，仍然有被误备份/误分享的风险。

## 2. 切换模式与地址

三种方式任选其一：

**A. Web 控制台**：右上「设置」→ 生成方式 / Base URL / 模型名 / API Key 环境变量名 → 保存 →「测试连接」。

**B. CLI**：

```bash
node src/cli.mjs config set llm.mode openai
node src/cli.mjs config set llm.baseURL http://127.0.0.1:11434/v1
node src/cli.mjs config set llm.model qwen2.5:7b
node src/cli.mjs config set llm.apiKeyEnv STUDY_LLM_API_KEY
node src/cli.mjs test-llm
```

**C. 直接编辑 `config/config.json`**（改完重启服务）：

```json
{
  "llm": {
    "mode": "openai",
    "baseURL": "http://127.0.0.1:11434/v1",
    "model": "qwen2.5:7b",
    "apiKeyEnv": "STUDY_LLM_API_KEY",
    "temperature": 0.7,
    "maxTokens": 4096,
    "timeoutMs": 120000,
    "fallbackToOffline": true
  }
}
```

## 3. 常见服务商

### Ollama（本地，最省事）

```bash
ollama serve                 # 默认 127.0.0.1:11434
ollama pull qwen2.5:7b       # 中文学习笔记整理，7B 起步；显存够用 14B 更好
```

```json
{ "llm": { "mode": "openai", "baseURL": "http://127.0.0.1:11434/v1", "model": "qwen2.5:7b" } }
```

```bash
export STUDY_LLM_API_KEY=local
node src/cli.mjs config set llm.mode openai
node src/cli.mjs config set llm.baseURL http://127.0.0.1:11434/v1
node src/cli.mjs config set llm.model qwen2.5:7b
node src/cli.mjs test-llm
```

要点：**baseURL 必须带 `/v1`**（Ollama 的 OpenAI 兼容前缀），否则会请求到 `/chat/completions` 而不是 `/v1/chat/completions` 而 404。

### LM Studio（本地，图形界面）

在 LM Studio 里加载模型 → 左侧「Local Server」→ Start Server（默认 `http://127.0.0.1:1234`）。

```json
{ "llm": { "mode": "openai", "baseURL": "http://127.0.0.1:1234/v1", "model": "qwen2.5-7b-instruct" } }
```

模型名要和 LM Studio 里显示的 ID 一致；填不准时可以点控制台的「拉取列表」从 `/v1/models` 里挑。

### vLLM（自建/服务器）

```bash
vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000
```

```json
{ "llm": { "mode": "openai", "baseURL": "http://127.0.0.1:8000/v1", "model": "Qwen/Qwen2.5-7B-Instruct" } }
```

如果前面挂了 Nginx/网关需要鉴权，把 Key 放进 `STUDY_LLM_API_KEY`（会以 `Authorization: Bearer <key>` 发送）。

### DeepSeek（云端，两种协议都支持）

**OpenAI 兼容端点**：

```json
{
  "llm": {
    "mode": "openai",
    "baseURL": "https://api.deepseek.com/v1",
    "model": "deepseek-chat"
  }
}
```

**Anthropic 兼容端点**（本项目会拼成 `https://api.deepseek.com/anthropic/v1/messages`）：

```json
{
  "llm": {
    "mode": "anthropic",
    "baseURL": "https://api.deepseek.com/anthropic",
    "model": "deepseek-chat"
  }
}
```

```powershell
$env:STUDY_LLM_API_KEY = "sk-xxxxxxxx"   # DeepSeek 控制台申请
node src/cli.mjs config set llm.mode anthropic
node src/cli.mjs config set llm.baseURL https://api.deepseek.com/anthropic
node src/cli.mjs config set llm.model deepseek-chat
node src/cli.mjs test-llm
```

注意：Anthropic 模式的 `baseURL` **不要**再补 `/v1`（程序会自动判断：以 `/v1` 结尾就拼 `/messages`，否则拼 `/v1/messages`）。该协议的模型列表接口不存在，`/api/llm/models` 会返回提示，直接手填模型名即可。

### OpenAI 官方

```json
{ "llm": { "mode": "openai", "baseURL": "https://api.openai.com/v1", "model": "gpt-4o-mini" } }
```

### 其他 OpenAI 兼容网关

任何实现 `POST /chat/completions` 且返回 `choices[0].message.content` 的服务都可以：OneAPI、New API、OpenRouter、硅基流动、通义/智谱的兼容端点等。填 `baseURL`（到 `/v1` 为止）、`model`、以及对应的 Key 即可。

## 4. 请求细节（用于排查兼容问题）

**OpenAI 兼容**（`src/llm/openai.mjs`）：

- `POST {baseURL}/chat/completions`（`baseURL` 末尾斜杠会被去掉）。
- 头：`content-type: application/json`、`authorization: Bearer <key>`。
- 体：`{model, messages:[{role:"system"},{role:"user"}], temperature, max_tokens, stream:false}`。
- 取 `choices[0].message.content` 作为回复；用量取 `usage.prompt_tokens/completion_tokens`（或 `input_tokens/output_tokens`）。
- 模型列表：`GET {baseURL}/models`，取 `data[].id`。

**Anthropic 兼容**（`src/llm/anthropic.mjs`）：

- `POST {baseURL}/v1/messages`（`baseURL` 以 `/v1` 结尾时改为 `{baseURL}/messages`）。
- 头：`content-type: application/json`、`anthropic-version: 2023-06-01`、`x-api-key: <key>`。
- 体：`{model, max_tokens, system, messages:[{role:"user",content:[{type:"text",text}]}], stream:false}`。
- 取 `content[].text` 拼接作为回复。
- 高级：若网关要求别的鉴权头名（例如自定义的 `x-api-token`），可在 `config/config.json` 里加 **`llm.authHeader`**（默认 `x-api-key`，见 `config/config.example.json`）。该字段没有对应的 Web/API 配置项，需要手动写 JSON 并重启。

## 5. 失败回退与错误码

`generateSummary()` 的流程（`src/llm/index.mjs`）：

1. `llm.mode = offline` → 直接用离线引擎，不创建 provider。
2. 非离线但没设置 Key（`hasAuth() === false`）→ 回退离线，`generatedBy = "offline-fallback"`，`warning` 说明缺哪个环境变量。
3. 调用模型：最多尝试 **2 次**（第一次回复解析不出 JSON 时，第二次会在提示词后追加「只输出 JSON」的要求）。鉴权错误（`AUTH`）不重试。
4. 两次都失败且 `fallbackToOffline: true` → 回退离线引擎，`generatedBy = "offline-fallback"`，`warning` 记录最后一次错误原因。
5. `fallbackToOffline: false` → 抛出错误，该节课处理失败（`/api/scan` 返回 400，日志记 `error`）。

错误分类（`LlmError.code`，出现在日志与 `warning` 里）：

| code | 触发 | 典型原因 / 处理 |
| --- | --- | --- |
| `NETWORK` | `fetch` 抛错/超时 | 服务没启动、地址写错、代理拦截、`timeoutMs` 太小；先 `curl {baseURL}/models` 验证 |
| `AUTH` | HTTP 401 / 403 | 环境变量名写错、Key 无效/过期、Key 与端点不匹配（云厂商/区域） |
| `RATE` | HTTP 429 | 限流/额度不足：等一会儿、换模型或充值 |
| `SERVER` | HTTP 5xx | 服务端故障/模型加载中；稍后重试 |
| `HTTP` | 其他 4xx | 404 多半是 `baseURL` 少了 `/v1`；400 多半是模型名不存在或参数不被支持 |
| `PARSE` | 返回内容不是 JSON / 不是合法 JSON / 缺 `knowledgePoints` | 模型不遵循 JSON 指令：换更强的模型、降低 `temperature`（如 0.3）、减小 `maxImportChars` |

模型输出会被宽松解析：容忍 ```` ```json ```` 代码块、前后解释文字、尾逗号、未加引号的键名；仍解析不出才判 `PARSE`。

用量日志：成功调用会在 `data/web.log` 写一行「模型用量（OpenAI 兼容 · model）：输入 N tokens / 输出 M tokens」。

## 6. 调参建议

| 现象 | 建议 |
| --- | --- |
| 笔记太啰嗦 / 内容发散 | 降低 `llm.temperature`（0.2~0.4） |
| 输出被截断（JSON 不完整） | 提高 `llm.maxTokens`（如 8192），或减少导入文本长度 `maxImportChars` |
| 小模型老是返回非 JSON | 换 7B 以上、指令遵循更好的模型；`temperature` 降到 0.2 |
| 想要更贴合使用场景 | 改 `prompt.goal`（如「日常学习与复习」「准备技术面试」）与 `prompt.persona` |
| 网络慢/超时 | 提高 `llm.timeoutMs`；本地模型首次加载慢，可先手动预热一次 |
| 不想让失败悄悄回退 | 设 `llm.fallbackToOffline: false`，失败时明确报错 |

## 7. 隐私边界

- 离线模式：**不发任何请求**。
- 模型模式：只把「内容标题、学科、关键词、你导入的材料（截断到 `maxImportChars`）」发给 `llm.baseURL` 指向的服务。**不上传**笔记文件、不扫描磁盘、不发送环境变量以外的信息。
- 若用的是云端服务，请自行确认其数据政策；涉密/内部资料建议用 Ollama / LM Studio / 自建 vLLM。
