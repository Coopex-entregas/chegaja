$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkRed
Write-Host '       REDEFINIR ACESSO DO ADMINISTRADOR LOCAL' -ForegroundColor DarkRed
Write-Host '============================================================' -ForegroundColor DarkRed
Write-Host ''

if (-not (Test-Path 'node_modules\.bin\wrangler.cmd')) {
  throw 'Execute primeiro o CONFIGURAR_LOCAL.ps1.'
}

$name = Read-Host 'Nome do administrador [Administrador ChegaJá]'
if ([string]::IsNullOrWhiteSpace($name)) { $name = 'Administrador ChegaJá' }

$email = Read-Host 'E-mail que será usado para entrar'
if ([string]::IsNullOrWhiteSpace($email)) { throw 'Informe o e-mail.' }

$secure = Read-Host 'Nova senha (mínimo 8 caracteres)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

$secureConfirm = Read-Host 'Digite novamente a mesma senha' -AsSecureString
$ptrConfirm = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConfirm)
try { $passwordConfirm = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptrConfirm) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptrConfirm) }

if ($password.Length -lt 8) { throw 'A senha precisa ter pelo menos 8 caracteres.' }
if ($password -cne $passwordConfirm) { throw 'As duas senhas não são iguais.' }

node scripts/bootstrap-admin.mjs "$name" "$email" "$password" --local
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível redefinir o administrador.' }

Write-Host ''
Write-Host "Acesso redefinido com sucesso para: $email" -ForegroundColor Green
Write-Host 'Agora execute .\INICIAR_LOCAL.bat e entre com esse e-mail e a nova senha.' -ForegroundColor Green
