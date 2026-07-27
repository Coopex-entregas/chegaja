$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path '.dev.vars')) { throw 'Execute CONFIGURAR_LOCAL.ps1 primeiro.' }
$secure = Read-Host 'Cole a RESEND_API_KEY' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$mailFrom = Read-Host 'Remetente verificado [ChegaJá <nao-responda@seudominio.com>]'
if ([string]::IsNullOrWhiteSpace($mailFrom)) { $mailFrom = 'ChegaJá <nao-responda@seudominio.com>' }
$lines = Get-Content '.dev.vars' | Where-Object { $_ -notmatch '^(RESEND_API_KEY|MAIL_FROM)=' }
$lines += "RESEND_API_KEY=$apiKey"
$lines += "MAIL_FROM=$mailFrom"
$lines | Set-Content '.dev.vars' -Encoding ASCII
Write-Host 'E-mail local configurado. Reinicie npm run dev.' -ForegroundColor Green
