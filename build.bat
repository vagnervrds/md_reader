@echo off
setlocal

cd /d "%~dp0"

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Atualizando contador de build...
node scripts\increment-build.js
if errorlevel 1 exit /b 1

if not exist build mkdir build

echo Compilando mdreader para Windows x64...
call npx.cmd pkg . --targets node18-win-x64 --output build\mdreader.exe
if errorlevel 1 exit /b 1

echo.
echo Build gerado em:
echo   build\mdreader.exe
echo.
pause

endlocal
