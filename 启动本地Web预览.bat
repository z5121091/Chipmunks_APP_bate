@echo off
setlocal

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-web.ps1"

if errorlevel 1 (
  echo.
  echo Start failed. Please send the error above to Codex.
  pause
  exit /b %errorlevel%
)

echo.
echo If the browser opened, local Web preview started successfully.
echo If the window says already running, the preview was already active.
echo.
pause
