import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const localIndex = args.indexOf('--local');
const local = localIndex >= 0;
if (local) args.splice(localIndex, 1);

const [nameRaw, emailRaw, password] = args;
const name = String(nameRaw ?? '').trim();
const email = String(emailRaw ?? '').trim().toLowerCase();

if (!name || !email || !password) {
  console.error('Uso: npm run admin:create -- "Nome" email@dominio.com "senha" [--local]');
  process.exit(1);
}
if (!/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Informe um e-mail válido.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('A senha deve ter pelo menos 8 caracteres.');
  process.exit(1);
}

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const wranglerCli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const scopeFlag = local ? '--local' : '--remote';

function runWrangler(extraArgs, inherit = true) {
  const result = spawnSync(process.execPath, [wranglerCli, ...extraArgs], {
    stdio: inherit ? 'inherit' : 'pipe',
    cwd: projectDir,
    windowsHide: true,
    encoding: 'utf8'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(details || `Wrangler terminou com código ${result.status}`);
  }
  return result;
}

function parseD1Json(text) {
  try {
    const data = JSON.parse(text || '[]');
    return Array.isArray(data) ? (data[0]?.results || []) : [];
  } catch {
    return [];
  }
}

try {
  const currentResult = runWrangler([
    'd1', 'execute', 'DB', scopeFlag, '--json',
    '--command', "SELECT id,name,email FROM users WHERE role='platform_admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1;"
  ], false);
  const currentMaster = parseD1Json(currentResult.stdout)[0];

  if (currentMaster && String(currentMaster.email).toLowerCase() !== email) {
    console.log('\nAdministrador Master existente encontrado.');
    console.log(`O acesso ${currentMaster.email} será atualizado para ${email}.`);
  }

  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(password, Buffer.from(salt, 'utf8'), 210000, 32, 'sha256').toString('base64url');
  const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const userId = currentMaster?.id || randomUUID();
  const sqlFile = join(projectDir, `.bootstrap-admin-${Date.now()}.sql`);

  const sql = currentMaster
    ? `
UPDATE users
SET name=${q(name)}, email=${q(email)}, password_hash=${q(hash)}, password_salt=${q(salt)},
    role='platform_admin', status='active', cooperative_id=NULL, establishment_id=NULL,
    driver_id=NULL, deleted_at=NULL, updated_at=CURRENT_TIMESTAMP
WHERE id=${q(userId)};
`
    : `
INSERT INTO users (id,cooperative_id,establishment_id,driver_id,name,email,username,password_hash,password_salt,role,status)
VALUES (${q(userId)},NULL,NULL,NULL,${q(name)},${q(email)},NULL,${q(hash)},${q(salt)},'platform_admin','active');
`;

  writeFileSync(sqlFile, sql, 'utf8');
  try {
    runWrangler(['d1', 'execute', 'DB', scopeFlag, '--file', sqlFile]);
  } finally {
    try { unlinkSync(sqlFile); } catch {}
  }

  runWrangler([
    'd1', 'execute', 'DB', scopeFlag,
    '--command', `SELECT name,email,role,status FROM users WHERE id=${q(userId)};`
  ]);
  console.log(`\nAdministrador Master criado/atualizado com sucesso: ${email}`);
  console.log('Este é o único usuário que pode visualizar todas as cooperativas e a auditoria da plataforma.');
  console.log('Agora inicie com: npm run dev');
} catch (error) {
  console.error(`\nNão foi possível criar o Administrador Master: ${error.message}`);
  process.exitCode = 1;
}
