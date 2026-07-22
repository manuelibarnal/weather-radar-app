@echo off
set PATH=C:\Program Files\nodejs\;%PATH%
cd /d "%~dp0"
call npm run build
echo.
echo === Compilacion terminada. La web estatica esta en la carpeta "out". ===
pause
