@echo off
rem 笔记工坊 · Windows 启动脚本
rem 需要 Node.js >= 20（https://nodejs.org/）。若已安装但不在 PATH，脚本会尝试常见安装位置。
setlocal
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
)
if not "%NODE%"=="node" goto :run
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)
:run
"%NODE%" "%~dp0src\cli.mjs" serve %*
