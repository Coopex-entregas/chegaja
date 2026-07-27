$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkBlue
Write-Host '       CONFIGURAR CHEGAJÁ LOCALMENTE' -ForegroundColor DarkBlue
Write-Host '============================================================' -ForegroundColor DarkBlue
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js não encontrado. Instale o Node.js 22 ou superior.'
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'O ChegaJá requer Node.js 22 ou superior.' }

npm config set registry https://registry.npmjs.org/
if (-not (Test-Path 'node_modules\.bin\wrangler.cmd')) {
  npm install --registry=https://registry.npmjs.org/
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível instalar as dependências.' }
}

$npmMajor = [int]((npm --version).Split('.')[0])
if ($npmMajor -ge 11) {
  npm approve-scripts esbuild workerd sharp
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível autorizar os componentes do Cloudflare.' }
}

if (-not (Test-Path '.dev.vars')) {
  $secret = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
  @"
JWT_SECRET=$secret
RESEND_API_KEY=
APP_ENV=development
APP_URL=http://127.0.0.1:8787
GOOGLE_MAPS_API_KEY=
GOOGLE_MAPS_BROWSER_KEY=
GOOGLE_MAPS_MAP_ID=DEMO_MAP_ID
"@ | Set-Content -Encoding ASCII '.dev.vars'
}

Write-Host 'As opções de mapa agora são configuradas dentro do Administrador Master > Configurações.' -ForegroundColor Cyan
Write-Host 'O sistema inicia com OpenStreetMap e você pode ativar o Google Maps depois.' -ForegroundColor Cyan
Write-Host ''

npm run db:migrate:local
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível atualizar o banco local. A configuração foi interrompida sem alterar o administrador.' }

$name = Read-Host 'Nome do administrador [Administrador ChegaJá]'
if ([string]::IsNullOrWhiteSpace($name)) { $name = 'Administrador ChegaJá' }
$email = Read-Host 'E-mail do administrador [admin@chegaja.local]'
if ([string]::IsNullOrWhiteSpace($email)) { $email = 'admin@chegaja.local' }
$secure = Read-Host 'Senha do administrador (mínimo 8 caracteres)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

$secureConfirm = Read-Host 'Digite novamente a mesma senha' -AsSecureString
$ptrConfirm = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConfirm)
try { $passwordConfirm = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptrConfirm) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptrConfirm) }

if ($password.Length -lt 8) { throw 'A senha precisa ter pelo menos 8 caracteres.' }
if ($password -cne $passwordConfirm) { throw 'As duas senhas não são iguais. Execute novamente.' }

Write-Host ''
Write-Host 'Criando ou atualizando o acesso do Administrador Master...' -ForegroundColor Yellow
node scripts/bootstrap-admin.mjs "$name" "$email" "$password" --local
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o administrador.' }

Write-Host ''
Write-Host "Acesso atualizado: $email" -ForegroundColor Green
Write-Host 'Configuração concluída.' -ForegroundColor Green
Write-Host 'Para iniciar, execute: .\INICIAR_LOCAL.bat' -ForegroundColor Green
Write-Host 'Depois abra o endereço mostrado na linha Ready on. Normalmente: http://127.0.0.1:8787' -ForegroundColor Green
