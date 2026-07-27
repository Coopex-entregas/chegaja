import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const cwd = fileURLToPath(new URL('../', import.meta.url));

function run(args, options = {}) {
  const result = spawnSync(npx, args, { cwd, encoding: 'utf8', stdio: options.capture ? ['pipe','pipe','pipe'] : 'inherit', input: options.input });
  if (result.status !== 0) {
    if (options.capture) console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  return options.captureAll ? `${result.stdout || ''}${result.stderr || ''}` : (result.stdout || '');
}

console.log('\n============================================================');
console.log('        PUBLICAR CHEGAJÁ NO CLOUDFLARE');
console.log('============================================================\n');

console.log('[1/8] Verificando o acesso ao Cloudflare...');
let who = spawnSync(npx, ['wrangler','whoami'], { cwd, encoding:'utf8', stdio:'inherit' });
if (who.status !== 0) run(['wrangler','login']);

console.log('[2/8] Localizando ou criando o banco D1...');
let databases = [];
try { databases = JSON.parse(run(['wrangler','d1','list','--json'], { capture:true })); } catch {}
let database = databases.find((db) => db.name === 'ligerim-db');
if (!database) {
  const created = run(['wrangler','d1','create','ligerim-db'], { capture:true, captureAll:true });
  const match = created.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!match) { console.error('Não foi possível identificar o ID do banco.'); process.exit(1); }
  database = { uuid: match[0], name: 'ligerim-db' };
}
const databaseId = database.uuid || database.id;
const configPath = new URL('../wrangler.jsonc', import.meta.url);
let config = readFileSync(configPath, 'utf8');
config = config.replace(/"database_id"\s*:\s*"[^"]+"/, `"database_id": "${databaseId}"`);
writeFileSync(configPath, config);
console.log(`Banco configurado: ${databaseId}`);

console.log('[3/8] Aplicando as migrações...');
run(['wrangler','d1','migrations','apply','DB','--remote']);

console.log('[4/8] Fazendo a primeira publicação...');
const deployOutput = run(['wrangler','deploy'], { capture:true, captureAll:true });
console.log(deployOutput);
const urlMatch = deployOutput.match(/https:\/\/[^\s]+\.workers\.dev/i);
if (urlMatch) {
  config = readFileSync(configPath, 'utf8').replace(/"APP_URL"\s*:\s*"[^"]+"/, `"APP_URL": "${urlMatch[0]}"`);
  writeFileSync(configPath, config);
}

console.log('[5/8] Criando a chave de segurança JWT...');
const jwtSecret = randomBytes(64).toString('base64url');
run(['wrangler','secret','put','JWT_SECRET'], { input: jwtSecret + '\n', capture:true });

console.log('[6/8] Coletando os dados de configuração...');
const rl = createInterface({ input, output });
const name = (await rl.question('Nome do administrador: ')).trim() || 'Administrador';
const email = (await rl.question('E-mail do administrador: ')).trim().toLowerCase();
const password = await rl.question('Senha (mínimo 8 caracteres): ');
rl.close();
console.log('Mapas: depois do primeiro acesso, abra Administrador Master > Configurações para escolher Google Maps ou OpenStreetMap.');
console.log('[7/8] Criando o primeiro administrador...');
if (!email || password.length < 8) { console.error('E-mail inválido ou senha com menos de 8 caracteres.'); process.exit(1); }
const adminResult = spawnSync(process.execPath, ['scripts/bootstrap-admin.mjs',name,email,password], { cwd, stdio:'inherit' });
if (adminResult.status !== 0) process.exit(adminResult.status || 1);

console.log('[8/8] Publicando a configuração final...');
run(['wrangler','deploy']);

console.log('\n============================================================');
console.log('CHEGAJÁ PUBLICADO COM SUCESSO');
if (urlMatch) console.log(`Acesse: ${urlMatch[0]}`);
console.log('Guarde e envie ao GitHub o wrangler.jsonc atualizado.');
console.log('============================================================\n');
