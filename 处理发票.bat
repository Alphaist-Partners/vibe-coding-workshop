@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: Add npm global bin to PATH so 'claude' command is found
set "PATH=%APPDATA%\npm;%PATH%"

:: Clear Claude Code session marker so nested claude calls are not blocked
set CLAUDECODE=
set CLAUDE_CODE=

echo.
echo  ==========================================
echo   费用报销自动化工具
echo  ==========================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo  [错误] 未找到 Python，请先安装 Python 3.10+
    echo  下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: Check dependencies
python -c "import openpyxl, rich" >nul 2>&1
if errorlevel 1 (
    echo  正在安装依赖包，请稍候...
    pip install openpyxl rich pymupdf pillow pillow-heif requests -q
    echo  依赖安装完成
    echo.
)


:: Run with dragged path (or no arg for manual input)
python src\main.py "%~1"

echo.
pause
