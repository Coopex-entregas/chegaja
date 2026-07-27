@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo      ATUALIZAR CHEGAJA LOCAL SEM PERDER CADASTROS
echo ============================================================
echo.
echo Este processo usa o banco local que esta na pasta .wrangler.
echo.

if not exist ".wrangler" (
  echo ERRO: A pasta .wrangler nao foi encontrada nesta versao.
  echo Copie a pasta .wrangler da versao antiga para esta pasta e tente novamente.
  echo Nenhum cadastro foi alterado.
  pause
  exit /b 1
)

if not exist ".dev.vars" (
  echo ERRO: O arquivo .dev.vars nao foi encontrado nesta versao.
  echo Copie o arquivo .dev.vars da versao antiga para esta pasta e tente novamente.
  echo Nenhum cadastro foi alterado.
  pause
  exit /b 1
)

echo [1/3] Instalando as dependencias...
call npm install
if errorlevel 1 goto erro

echo [2/3] Aplicando somente as migracoes pendentes no banco local existente...
call npm run db:migrate:local
if errorlevel 1 goto erro

echo [3/3] Iniciando o ChegaJa local...
call npm run dev
exit /b 0

:erro
echo.
echo ERRO: A atualizacao local nao foi concluida.
echo A pasta .wrangler nao foi apagada.
pause
exit /b 1
