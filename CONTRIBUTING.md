# 贡献指南（Contributing）

感谢你愿意改进笔记工坊。这个项目的两条底线是：**默认离线可用**、**零运行时依赖**。改动请先确认不破坏这两点。

## 开发环境

- **Node.js >= 20**（CI 覆盖 Node 20 / 22，Ubuntu + Windows）
- 操作系统：Windows 是主要目标（自动检测仅 Windows），macOS / Linux 也支持手动与导入文本
- 不需要 `npm install`——项目没有运行时依赖，也没有构建步骤。如果顺手执行了 `npm install`，请留意它是顺手生成的 `package-lock.json` / `node_modules/`，不要把它们混进 PR（除非该 PR 明确要引入依赖并经讨论通过）。

```bash
git clone <your-fork-url> jot
cd jot
node -v                  # 应 >= v20
node --test              # 或 npm test
node scripts/smoke.mjs   # 端到端冒烟（不联网）
node src/cli.mjs serve --no-open   # 本地起控制台：http://127.0.0.1:7870
```

首次运行会生成 `config/config.json`；它和 `data/`、`课程知识地图/` 都在 `.gitignore` 中，**不要提交**。

## 代码风格

- **ESM + `.mjs`**：所有源码用 `import`/`export`，`package.json` 里 `"type": "module"`。
- 缩进 2 空格、换行 LF、UTF-8、文件末尾换行（见 `.editorconfig`）。
- 现有代码中分号风格不统一（早期的 `src/core/*.mjs`、`cli.mjs`、`server/app.mjs` 多数不写分号；`src/core/docx/*.mjs`、`text.mjs`、`offline.mjs` 带分号）。**改动某个文件时跟随该文件现有风格**，不要整文件重排；新增文件建议跟随所在目录的风格。
- 中文用户可见文案用中文，日志与错误信息保持完整可读（如「未设置 API Key：请设置环境变量 …」）。
- 对外函数写 JSDoc 类型注释，尤其是 `core/`、`llm/`、`server/` 的公共入口。
- 不引入第三方运行时依赖（`dependencies` 保持为空）。Word 生成、ZIP、HTTP、窗口检测都用 Node 内置能力实现；确实需要新依赖时请先开 issue 讨论，说明为什么内置能力不够。
- 不做任何隐式联网：新增功能若需要网络，必须只在用户显式配置的模型模式下发生，并在文档里写清楚。
- 不写死本机路径/用户名；所有路径经 `resolve`/`join` 处理。

## 目录与职责

| 路径 | 职责 | 改这里通常需要同步 |
| --- | --- | --- |
| `src/cli.mjs` | CLI 命令与选项 | `README.md` 命令表、`docs/API.md` 无关但 CLI 帮助文本 |
| `src/server/app.mjs` | HTTP API / SSE / 静态资源 | `docs/API.md`（字段与示例）、控制台前端 |
| `src/server/static/` | 原生 JS 控制台（无构建步骤） | 对应 API 变更 |
| `src/core/config.mjs` | 默认值、合并、校验、原子写 | `README.md` 配置表、`config/config.example.json`（由维护者确认） |
| `src/core/pipeline.mjs` | 单条记录流水线与重建 | `README.md` 输出结构、`docs/ARCHITECTURE.md` |
| `src/core/render.mjs` | summary → Markdown | `docs/ARCHITECTURE.md`、Word 渲染测试 |
| `src/core/text.mjs` / `offline.mjs` | 离线抽取引擎 | `docs/ARCHITECTURE.md`、离线测试 |
| `src/core/docx/` | 纯 JS OOXML / ZIP | `tests/*`、`docs/ARCHITECTURE.md` |
| `src/llm/` | 两种协议与回退策略 | `docs/PROVIDERS.md` |
| `src/watch/` | 前台窗口检测（Windows） | `README.md` 自动检测章节 |

## 测试要求

- 测试框架是 Node 内置的 `node:test` + `node:assert/strict`，文件放在 `tests/*.test.mjs`。
- **不联网**：模型协议的测试用 `node:http` 在 `127.0.0.1` 随机端口起假服务（参考 `tests/llm.test.mjs`）；不要请求真实 API、不要在测试里读真实 `config/config.json`。
- **不污染仓库**：涉及文件读写的测试用 `node:fs.mkdtempSync(join(tmpdir(), 'osa-...'))` 建临时目录，结束清理。
- **新增功能必须带测试**：至少覆盖正常路径 + 一个边界/失败路径（如空标题、非法配置、Word 生成失败回退）。
- **提交前自查**：

```bash
node --test                # 全部单测
node scripts/smoke.mjs     # 端到端：生成示例课并校验 Markdown/Word
```

- 如果改动影响 Word 输出，除单测外建议手动用 Word/WPS 打开 `scripts/smoke.mjs` 生成的 `.docx` 确认排版（冒烟脚本默认删临时目录，可用 `OSA_KEEP_SMOKE=1 node scripts/smoke.mjs` 保留）。

## 提交 PR 流程

1. Fork 仓库并从 `main` 开分支：`fix/xxx`、`feat/xxx`、`docs/xxx`。
2. 一个 PR 只做一件事；不要顺手重排整文件或改无关格式。
3. 提交信息说清「改了什么 + 为什么」，例如：
   - `fix(server): /api/open 越界路径返回 500 而不是静默忽略`
   - `feat(llm): 支持 DeepSeek Anthropic 兼容端点`
   - `docs: 补充 Ollama baseURL 必须带 /v1 的说明`
4. PR 描述模板：

```markdown
## 改了什么
- 

## 为什么
- 

## 怎么验证
- [ ] `node --test` 通过
- [ ] `node scripts/smoke.mjs` 通过
- [ ] 手动验证（步骤/截图/Word 打开情况）

## 关联 issue
Closes #
```

5. 提交前检查 `git status`：**不要**包含 `config/config.json`、`data/`、`课程知识地图/`、`.env`、`*.log`、任何 API Key 或真实笔记内容。截图/日志请脱敏。
6. 改动涉及以下内容时，务必同步文档：
   - HTTP 接口/字段/SSE 事件 → `docs/API.md`
   - 配置字段/默认值/环境变量 → `README.md` 配置表、`config/config.example.json`
   - 模型接入方式 → `docs/PROVIDERS.md`
   - 架构/数据流/取舍 → `docs/ARCHITECTURE.md`
   - 用户可见行为 → `README.md` 与 `docs/FAQ.md`
   - 版本行为变化 → `CHANGELOG.md`
7. CI 必须在 Node 20/22 × Ubuntu/Windows 全部通过后再请求合并；失败时先本地复现（注意 Node 版本差异）。

## 报告 Bug / 提建议

请附上：操作系统与版本、`node -v`、项目版本（`package.json`）、复现步骤、期望结果与实际结果、`data/web.log` 与 `data/events.jsonl` 的相关片段（先脱敏）。涉及 Word 的文件问题，请说明 Word/WPS 版本，最好附上出问题的 `.docx`（注意里面可能含真实笔记内容，必要时替换成示例文本复现）。

涉及安全/隐私（密钥泄露、路径穿越、绑定到外网）的问题请不要公开提 issue，先私下联系维护者。

## 行为准则

- 尊重不同基础的学习者：这个项目面向的是普通学习者，不是所有人都是开发者。
- 不提交他人内容的完整文字稿/受版权保护的素材；示例用虚构内容（参考 `examples/sample-transcript.txt`）。
- 不引入「自动抓取视频/绕登录/破解」相关功能，这不在项目范围内。

## 发布流程（维护者）

1. 更新 `CHANGELOG.md`、`package.json` 的 `version`。
2. `node --test`、`node scripts/smoke.mjs` 通过；在 Windows 上手动过一遍 Web 控制台与 `serve` 启动流程。
3. 打 tag（`vX.Y.Z`）并发布说明。
