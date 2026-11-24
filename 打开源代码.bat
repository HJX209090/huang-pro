@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js。请先安装 Node.js，再双击这个脚本。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo 第一次打开，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败。
    pause
    exit /b 1
  )
)

netstat -ano | findstr "127.0.0.1:5173" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo 源代码窗口已经在运行。请直接使用已经打开的 huang++pro，不要再开一个。
  pause
  exit /b 0
)

echo 正在从源代码启动 huang++pro ...
call npm run dev
if errorlevel 1 pause
