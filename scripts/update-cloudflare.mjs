import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function execute(executable, args, { capture = false, shell = false } = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    shell,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });

  if (result.error) {
    const message = result.error?.message || String(result.error);
    if (capture) return { ok: false, output: '', error: message, status: 1 };
    console.error(`Falha ao iniciar o comando: ${message}`);
    return { ok: false, output: '', error: message, status: 1 };
  }

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  return {
    ok: result.status === 0,
    output: stdout,
    stderr,
    error: result.status === 0 ? '' : (stderr || stdout).trim(),
    status: result.status ?? 1
  };
}

function runWrangler(args, options = {}) {
  if (!existsSync(wranglerBin)) {
    console.error('Wrangler não encontrado em node_modules. Execute o instalador novamente.');
    process.exit(1);
  }
  const result = execute(process.execPath, [wranglerBin, ...args], options);
  if (!result.ok && options.required !== false) {
    if (options.capture && result.error) console.error(result.error);
    process.exit(result.status || 1);
  }
  return result;
}

function runNpm(args) {
  const result = execute(npm, args, { shell: process.platform === 'win32' });
  if (!result.ok) process.exit(result.status || 1);
}

console.log('\n[1/5] Verificando acesso ao Cloudflare...');
let who = runWrangler(['whoami'], { required: false });
if (!who.ok) {
  console.log('\nO acesso ao Cloudflare ainda não está autorizado neste computador.');
  console.log('Uma página do Cloudflare será aberta. Entre na mesma conta onde está o sistema atual.\n');
  const login = runWrangler(['login'], { required: false });
  if (!login.ok) {
    console.error('\nNão foi possível concluir o login no Cloudflare.');
    console.error('Feche esta janela, confirme a internet e tente novamente.');
    process.exit(login.status || 1);
  }
  who = runWrangler(['whoami'], { required: false });
  if (!who.ok) {
    console.error('\nO Cloudflare não confirmou o acesso depois do login.');
    process.exit(who.status || 1);
  }
}

console.log('[2/5] Localizando o banco D1 existente...');
const listResult = runWrangler(['d1', 'list', '--json'], { capture: true, required: false });
if (!listResult.ok) {
  console.error(listResult.error || 'Não foi possível consultar os bancos D1 da conta atual.');
  console.error('\nConfirme que você entrou na mesma conta Cloudflare onde o ChegaJá já está publicado.');
  process.exit(listResult.status || 1);
}

let databases;
try {
  databases = JSON.parse(listResult.output);
} catch {
  console.error('O Cloudflare respondeu, mas a lista de bancos D1 não pôde ser lida.');
  console.error(listResult.output.trim());
  process.exit(1);
}

const database = databases.find(db => db.name === 'ligerim-db');
if (!database) {
  console.error('O banco ligerim-db não foi encontrado nesta conta.');
  console.error('Nenhum banco novo foi criado. Entre na conta Cloudflare correta e execute novamente.');
  process.exit(1);
}

const databaseId = database.uuid || database.id;
if (!databaseId) {
  console.error('O Cloudflare não retornou o ID do banco ligerim-db.');
  process.exit(1);
}

const configPath = new URL('../wrangler.jsonc', import.meta.url);
let config = readFileSync(configPath, 'utf8');
config = config.replace(/"database_id"\s*:\s*"[^"]+"/, `"database_id": "${databaseId}"`);
writeFileSync(configPath, config);
console.log(`Banco existente confirmado: ${databaseId}`);

console.log('[3/5] Aplicando somente as migrações pendentes...');
runWrangler(['d1', 'migrations', 'apply', 'DB', '--remote']);

console.log('[4/5] Verificando o projeto...');
runNpm(['run', 'check']);

console.log('[5/5] Publicando a nova versão...');
runWrangler(['deploy']);

console.log('\nChegaJá atualizado sem criar outro banco.');
console.log('Os cadastros e os segredos existentes foram preservados.');
