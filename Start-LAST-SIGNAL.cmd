@echo off
setlocal
title LAST SIGNAL
cd /d "%~dp0"

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo Node.js / npm was not found. Install Node.js and try again.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Dependencies are missing. Run npm install in this folder first.
  pause
  exit /b 1
)

echo Starting LAST SIGNAL. Your browser will open automatically.
echo Keep this window open while playing. Close it to stop the server.
echo.
call npm.cmd run dev -- --open
if errorlevel 1 pause
