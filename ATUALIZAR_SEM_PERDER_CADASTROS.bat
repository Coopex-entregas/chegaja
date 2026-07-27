@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Atualizar ChegaJa sem perder cadastros

echo ============================================================
echo       ATUALIZAR CHEGAJA SEM PERDER CADASTROS
echo ============================================================
echo.
echo Este processo usa o banco D1 existente e nao cria outro banco.
echo Nao feche esta janela durante a atualizacao.
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo ERRO: Node.js nao encontrado. Instale o Node.js 22 ou superior.
  pause
  exit /b 1
)

echo [1/2] Instalando as dependencias do projeto...
call npm config set registry https://registry.npmjs.org/
call npm install --registry=https://registry.npmjs.org/
if errorlevel 1 goto erro

echo [2/2] Conectando ao banco existente, testando e publicando...
node scripts\update-cloudflare.mjs
if errorlevel 1 goto erro

echo.
echo ============================================================
echo ATUALIZACAO CONCLUIDA SEM APAGAR OS CADASTROS
echo ============================================================
echo Abra o sistema e pressione Ctrl + Shift + R.
pause
exit /b 0

:erro
echo.
echo ERRO: A atualizacao nao foi concluida.
echo Nenhum novo banco deve ser criado. Tire uma foto desta tela.
pause
exit /b 1
