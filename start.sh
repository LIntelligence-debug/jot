#!/bin/sh
# 笔记工坊 · macOS / Linux 启动脚本（需要 Node.js >= 20）
exec node "$(dirname "$0")/src/cli.mjs" serve "$@"
