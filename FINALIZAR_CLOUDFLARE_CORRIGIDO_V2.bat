@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Finalizar instalacao do ChegaJa no Cloudflare

echo ============================================================
echo      FINALIZAR INSTALACAO DO CHEGAJA NO CLOUDFLARE - V2
echo ============================================================
echo.

where.exe node >nul 2>&1
if errorlevel 1 (
  echo ERRO: Node.js nao foi localizado no Windows.
  echo Instale o Node.js 22 ou superior e tente novamente.
  echo.
  pause
  exit /b 1
)

set "NODE_MAJOR="
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo ERRO: O comando node foi encontrado, mas nao respondeu.
  echo.
  pause
  exit /b 1
)

if %NODE_MAJOR% LSS 22 (
  echo ERRO: Node.js %NODE_MAJOR% encontrado. Use a versao 22 ou superior.
  echo.
  pause
  exit /b 1
)

echo Node.js encontrado:
node --version
echo.

if not exist "package.json" (
  echo ERRO: Coloque este arquivo na raiz do projeto,
  echo no mesmo local de package.json e wrangler.jsonc.
  echo.
  pause
  exit /b 1
)

if not exist "scripts\configure-cloudflare.mjs" (
  echo ERRO: Nao foi encontrado scripts\configure-cloudflare.mjs.
  echo Extraia o ZIP inteiro sobre a pasta do projeto e confirme a substituicao.
  echo.
  pause
  exit /b 1
)

echo [1/2] Instalando ou conferindo as dependencias...
call npm install --registry=https://registry.npmjs.org/
if errorlevel 1 goto erro

echo.
echo [2/2] Autorizando a Cloudflare, aplicando o banco e criando o Administrador Master...
node scripts\configure-cloudflare.mjs
if errorlevel 1 goto erro

echo.
echo ============================================================
echo INSTALACAO FINALIZADA COM SUCESSO
echo ============================================================
echo.
echo Abra o endereco do ChegaJa e pressione Ctrl+Shift+R.
echo Depois entre com o e-mail e a senha cadastrados nesta tela.
echo.
pause
exit /b 0

:erro
echo.
echo ============================================================
echo ERRO: A INSTALACAO NAO FOI CONCLUIDA
echo ============================================================
echo Copie desde a primeira linha de erro exibida acima.
echo.
pause
exit /b 1
