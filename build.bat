@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

:: Permite passar argumento direto pela linha de comando (ex: build.bat 1, build.bat release, build.bat all)
if "%~1"=="1" goto do_build_cli
if "%~1"=="build" goto do_build_cli
if "%~1"=="2" goto do_build_and_release_cli
if "%~1"=="all" goto do_build_and_release_cli
if "%~1"=="3" goto do_release_only_cli
if "%~1"=="release" goto do_release_only_cli

:menu
echo.
echo ==========================================
echo          MDREADER - BUILD MENU
echo ==========================================
echo  [1] Gerar Build (Padrao)
echo  [2] Gerar Build e Publicar Release
echo  [3] Apenas Publicar Release (generate_release_notes.py)
echo  [0] Sair
echo ==========================================
set "opt="
set /p opt="Escolha uma opcao [1, 2, 3 ou 0] (Padrao: 1): "

if "%opt%"=="" set opt=1
if "%opt%"=="1" goto do_build
if "%opt%"=="2" goto do_build_and_release
if "%opt%"=="3" goto do_release_only
if "%opt%"=="0" exit /b 0

echo.
echo [Aviso] Opcao invalida. Tente novamente.
goto menu

:do_build
call :build_routine
goto wait_next

:do_build_and_release
call :build_routine
if errorlevel 1 (
  echo.
  echo [ERRO] Release cancelada devido a falhas na compilacao.
  goto wait_next
)
call :release_routine
goto wait_next

:do_release_only
call :release_routine
goto wait_next

:: --- Modos CLI (execucao direta sem pause no final) ---
:do_build_cli
call :build_routine
exit /b %errorlevel%

:do_build_and_release_cli
call :build_routine
if errorlevel 1 exit /b 1
call :release_routine
exit /b %errorlevel%

:do_release_only_cli
call :release_routine
exit /b %errorlevel%

:: ==========================================
:: Rotina de Build
:: ==========================================
:build_routine
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
  exit /b 1
)

echo.
echo ==========================================
echo Build concluido com sucesso!
echo Executavel: build\mdreader.exe
powershell -Command "Write-Host ('Tamanho:    {0:N2} MB' -f ((Get-Item build/mdreader.exe).Length / 1MB))"
echo ==========================================
exit /b 0

:: ==========================================
:: Rotina de Release
:: ==========================================
:release_routine
echo.
echo ==========================================
echo Executando gerador de Release Notes e Publicacao...
echo ==========================================
if exist "generate_release_notes.py" (
  python generate_release_notes.py
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao executar generate_release_notes.py!
    exit /b 1
  )
) else (
  echo [ERRO] generate_release_notes.py nao encontrado na raiz do projeto!
  exit /b 1
)
echo.
echo ==========================================
echo Release finalizada com sucesso!
echo ==========================================
exit /b 0

:wait_next
echo.
echo Pressione ENTER para voltar ao menu ou feche a janela...
pause >nul
goto menu
