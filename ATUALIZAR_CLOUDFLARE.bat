@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Atualizar ChegaJa no Cloudflare

echo ============================================================
echo          ATUALIZAR CHEGAJA NO CLOUDFLARE
echo ============================================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo ERRO: Node.js nao encontrado. Instale o Node.js 22 ou superior.
  pause
  exit /b 1
)

echo [1/2] Instalando as dependencias...
call npm config set registry https://registry.npmjs.org/
call npm install --registry=https://registry.npmjs.org/
if errorlevel 1 goto erro

echo [2/2] Localizando o banco, aplicando migracoes e publicando...
node scripts\update-cloudflare.mjs
if errorlevel 1 goto erro

echo.
echo Atualizacao concluida.
pause
exit /b 0

:erro
echo.
echo ERRO: A atualizacao nao foi concluida.
echo Copie esta tela ou tire uma foto para verificar o erro.
pause
exit /b 1
