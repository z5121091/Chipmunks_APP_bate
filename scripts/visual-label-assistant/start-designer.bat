@echo off
setlocal
cd /d "%~dp0"
python app.py --designer
if errorlevel 1 (
  echo.
  echo Visual label designer failed to start.
  echo Run: python -m pip install -r requirements.txt
  pause
)
