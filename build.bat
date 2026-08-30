@echo off
setlocal

cd /d "%~dp0"

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 goto wait_next
)

:loop
echo.
echo ==========================================
echo Atualizando contador de build...
node scripts\increment-build.js
if errorlevel 1 goto wait_next

if not exist build mkdir build

echo Compilando mdreader para Windows x64...
call npx.cmd pkg . --targets node18-win-x64 --output build\mdreader.exe
if errorlevel 1 goto wait_next

echo Aplicando icone e metadados no executavel...
node scripts\apply-icon.js

echo.
echo Build gerado em:
echo   build\mdreader.exe

:wait_next
echo.
echo Pressione ENTER para outro build...
pause >nul
goto loop
