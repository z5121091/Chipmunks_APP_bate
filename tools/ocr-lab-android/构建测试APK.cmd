@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1"
set "lab_build_exit=%errorlevel%"
pause
exit /b %lab_build_exit%
