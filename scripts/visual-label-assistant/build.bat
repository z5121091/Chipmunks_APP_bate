@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo Palm Warehouse Visual Label Assistant
echo ========================================
echo.
echo Building the standalone EXE...
echo This may take several minutes the first time.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
if errorlevel 1 (
  echo.
  echo Build failed. Please send the error above to Codex.
  pause
  exit /b 1
)

echo.
echo Build completed successfully.
echo Opening the output folder...
start "" "%~dp0dist"
pause
