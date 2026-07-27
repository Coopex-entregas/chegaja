@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Publicar ChegaJá no Cloudflare

echo ============================================================
echo           INSTALADOR DO CHEGAJÁ
echo ============================================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo ERRO: Node.js nao encontrado.
  echo Instale o Node.js 22 ou superior e execute novamente.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 22 (
  echo ERRO: O ChegaJá requer Node.js 22 ou superior.
  pause
  exit /b 1
)

echo [1/2] Instalando as ferramentas do projeto...
call npm config set registry https://registry.npmjs.org/
call npm install --registry=https://registry.npmjs.org/
if errorlevel 1 goto erro
for /f "tokens=1 delims=." %%V in ('npm --version') do set NPM_MAJOR=%%V
if %NPM_MAJOR% GEQ 11 (
  call npm approve-scripts esbuild workerd sharp
  if errorlevel 1 goto erro
)

echo [2/2] Configurando e publicando...
node scripts\configure-cloudflare.mjs
if errorlevel 1 goto erro

echo.
echo Publicacao concluida.
pause
exit /b 0

:erro
echo.
echo ERRO: A publicacao nao foi concluida.
echo Copie esta tela ou tire uma foto para verificar o erro.
pause
exit /b 1
