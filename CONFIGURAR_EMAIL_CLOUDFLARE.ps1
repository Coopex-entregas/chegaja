$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkRed
Write-Host '       CONFIGURAR E-MAIL DO CHEGAJÁ' -ForegroundColor DarkRed
Write-Host '============================================================' -ForegroundColor DarkRed
Write-Host ''
Write-Host 'Antes, verifique um dominio no Resend e crie uma API Key.' -ForegroundColor Yellow
Write-Host ''

$secure = Read-Host 'Cole a RESEND_API_KEY' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if ([string]::IsNullOrWhiteSpace($apiKey)) { throw 'A chave do Resend nao foi informada.' }

$mailFrom = Read-Host 'Remetente verificado [ChegaJá <nao-responda@seudominio.com>]'
if ([string]::IsNullOrWhiteSpace($mailFrom)) { $mailFrom = 'ChegaJá <nao-responda@seudominio.com>' }

$config = Get-Content '.\wrangler.jsonc' -Raw
$escaped = $mailFrom.Replace('\\','\\\\').Replace('"','\\"')
$config = [regex]::Replace($config, '"MAIL_FROM"\s*:\s*"[^"]*"', '"MAIL_FROM": "' + $escaped + '"')
Set-Content '.\wrangler.jsonc' $config -Encoding UTF8

$apiKey | npx wrangler secret put RESEND_API_KEY
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel salvar a chave no Cloudflare.' }

npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel publicar a configuracao.' }

Write-Host ''
Write-Host 'E-mail configurado. Teste em Esqueci minha senha.' -ForegroundColor Green
