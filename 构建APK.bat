@echo off
setlocal
title Chipmunks Warehouse - ARM64 APK
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-android-release.ps1"
) else (
  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-android-release.ps1"
)
set "result=%errorlevel%"
echo.
if not "%result%"=="0" echo BUILD FAILED. Keep the log in logs\android-build.
pause
exit /b %result%
