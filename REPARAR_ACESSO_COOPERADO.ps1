$ErrorActionPreference = "Stop"
Write-Host "`n============================================================" -ForegroundColor DarkRed
Write-Host "       REPARAR ACESSO DO COOPERADO — LIGERIM" -ForegroundColor DarkRed
Write-Host "============================================================`n" -ForegroundColor DarkRed
$busca = Read-Host "E-mail, CPF ou nome EXATO do cooperado"
$email = Read-Host "E-mail que ele usará para entrar"
$usuario = Read-Host "Usuário opcional (Enter para não usar)"
$secure = Read-Host "Nova senha (mínimo 8 caracteres)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $senha = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
node .\scripts\repair-driver-access.mjs "$busca" "$email" "$usuario" "$senha" --local
if ($LASTEXITCODE -ne 0) { throw "Não foi possível reparar o acesso." }
Write-Host "`nAgora execute .\INICIAR_LOCAL.bat e entre com o e-mail/usuário e a nova senha." -ForegroundColor Green
