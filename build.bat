@echo off
setlocal

cd /d "%~dp0"

:loop
echo.
echo ==========================================
echo Atualizando contador de build...
if exist "scripts\increment_build.py" (
  python scripts\increment_build.py
) else if exist "scripts\increment-build.js" (
  node scripts\increment-build.js
)

if not exist build mkdir build

echo.
echo Sincronizando frontend...
powershell -Command "Copy-Item -Path 'public/*' -Destination 'internal/server/public' -Recurse -Force"

echo.
echo Gerando recursos do Windows (icone e manifesto)...
go run github.com/tc-hib/go-winres@latest make --in winres/winres.json --out cmd/mdreader/rsrc

echo.
echo Compilando mdreader em Go (Windows x64)...
go build -ldflags="-s -w" -o build\mdreader.exe ./cmd/mdreader
if errorlevel 1 (
  echo.
  echo [ERRO] Falha na compilacao!
  goto wait_next
)

echo.
echo ==========================================
echo Build concluido com sucesso!
echo Executavel: build\mdreader.exe
powershell -Command "Write-Host ('Tamanho:    {0:N2} MB' -f ((Get-Item build/mdreader.exe).Length / 1MB))"
echo ==========================================

:wait_next
echo.
echo Pressione ENTER para novo build ou feche a janela...
pause >nul
goto loop
