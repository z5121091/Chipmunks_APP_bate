@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ====================================
echo   掌上仓库同步服务 - 打包工具
echo ====================================
echo.

:: 检查Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到Python，请先安装Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/4] 安装依赖...
pip install cherrypy openpyxl pystray Pillow pyinstaller -q

echo [2/4] 检查图标文件...
if exist "icon.ico" (
    echo [OK] 找到图标文件 icon.ico
    set ICON_PARAM=--icon "icon.ico"
) else (
    echo [提示] 未找到图标文件，使用默认图标
    set ICON_PARAM=
)

echo [3/4] 开始打包...
python -m PyInstaller --noconfirm --onefile --windowed ^
    --name "掌上仓库同步服务" ^
    %ICON_PARAM% ^
    label_sync_server.py

if errorlevel 1 (
    echo.
    echo [错误] 打包失败！
    pause
    exit /b 1
)

echo [4/4] 清理临时文件...
if exist build rmdir /s /q build
if exist "掌上仓库同步服务.spec" del /q "掌上仓库同步服务.spec"

echo.
echo ====================================
echo   打包成功！
echo   输出目录: dist\掌上仓库同步服务.exe
echo ====================================
echo.
echo 使用方法:
echo 1. 双击运行 掌上仓库同步服务.exe
echo 2. 在系统托盘找到图标
echo 3. 右键可设置开机自启动
echo.
pause
