@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Enviar ChegaJa ao GitHub

echo ============================================================
echo              ENVIAR CHEGAJA AO GITHUB
echo ============================================================
echo.
where git >nul 2>&1
if errorlevel 1 (
  echo ERRO: Git nao encontrado.
  echo Instale o Git para Windows e execute novamente.
  pause
  exit /b 1
)

set /p REPO=Cole a URL do repositorio vazio do GitHub: 
if "%REPO%"=="" (
  echo URL nao informada.
  pause
  exit /b 1
)

if not exist .git git init
git add .
git commit -m "ChegaJa 12.6 - cliente, credito e D1 corrigidos"
git branch -M main
git remote remove origin >nul 2>&1
git remote add origin "%REPO%"
git push -u origin main
if errorlevel 1 goto erro

echo.
echo Projeto enviado ao GitHub com sucesso.
pause
exit /b 0

:erro
echo.
echo Nao foi possivel enviar. Confirme se o repositorio esta vazio
echo e se o GitHub autorizou o acesso deste computador.
pause
exit /b 1
