@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prepare-build-environment.ps1" -Target Both
set "result=%errorlevel%"
pause
exit /b %result%
