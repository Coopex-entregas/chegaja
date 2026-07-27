import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const args=process.argv.slice(2),localIndex=args.indexOf('--local'),local=localIndex>=0;
if(local)args.splice(localIndex,1);
const [driverSearchRaw,emailRaw,usernameRaw,password]=args;
const driverSearch=String(driverSearchRaw||'').trim(),email=String(emailRaw||'').trim().toLowerCase(),username=String(usernameRaw||'').trim().toLowerCase()||null;
if(!driverSearch||!email||!password){console.error('Uso: npm run driver:repair -- "email/CPF/nome do cooperado" login@email.com usuario-opcional "senha" [--local]');process.exit(1)}
if(!/^\S+@\S+\.\S+$/.test(email)){console.error('Informe um e-mail de login válido.');process.exit(1)}
if(password.length<8){console.error('A senha deve ter pelo menos 8 caracteres.');process.exit(1)}
const projectDir=fileURLToPath(new URL('../',import.meta.url)),wranglerCli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),scopeFlag=local?'--local':'--remote';
const q=v=>`'${String(v).replaceAll("'","''")}'`;
function run(extra,inherit=true){const r=spawnSync(process.execPath,[wranglerCli,...extra],{cwd:projectDir,stdio:inherit?'inherit':'pipe',encoding:'utf8',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error([r.stdout,r.stderr].filter(Boolean).join('\n')||`Wrangler: ${r.status}`);return r}
function rows(text){try{const d=JSON.parse(text||'[]');return Array.isArray(d)?(d[0]?.results||[]):[]}catch{return[]}}
try{
  const digits=driverSearch.replace(/\D/g,'');
  const result=run(['d1','execute','DB',scopeFlag,'--json','--command',`SELECT id,cooperative_id,name,email,cpf,phone,status FROM drivers WHERE deleted_at IS NULL AND (lower(trim(COALESCE(email,'')))=lower(trim(${q(driverSearch)})) OR replace(replace(replace(COALESCE(cpf,''),'.',''),'-',''),' ','')=${q(digits)} OR replace(replace(replace(replace(replace(COALESCE(phone,''),'(',''),')',''),'-',''),' ',''),'+','')=${q(digits)} OR lower(trim(name))=lower(trim(${q(driverSearch)}))) LIMIT 5;`],false);
  const found=rows(result.stdout);
  if(found.length!==1){console.error(found.length?'Mais de um cooperado encontrado. Use o e-mail ou CPF exato.':'Cooperado não encontrado.');if(found.length)found.forEach(x=>console.error(`${x.name} — ${x.email||x.cpf||x.phone}`));process.exit(2)}
  const driver=found[0];
  if(driver.status!=='active'){console.error('O cooperado precisa estar ativo.');process.exit(3)}
  const current=rows(run(['d1','execute','DB',scopeFlag,'--json','--command',`SELECT * FROM users WHERE role='driver' AND deleted_at IS NULL AND (driver_id=${q(driver.id)} OR (driver_id IS NULL AND cooperative_id=${q(driver.cooperative_id)} AND lower(trim(email))=lower(trim(${q(email)})))) ORDER BY CASE WHEN driver_id=${q(driver.id)} THEN 0 ELSE 1 END LIMIT 1;`],false).stdout)[0];
  const salt=randomBytes(16).toString('base64url'),hash=pbkdf2Sync(password,Buffer.from(salt,'utf8'),210000,32,'sha256').toString('base64url'),userId=current?.id||randomUUID();
  const sql=current?`UPDATE users SET cooperative_id=${q(driver.cooperative_id)},establishment_id=NULL,driver_id=${q(driver.id)},name=${q(driver.name)},email=${q(email)},username=${username?q(username):'NULL'},password_hash=${q(hash)},password_salt=${q(salt)},role='driver',status='active',deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=${q(userId)};`:`INSERT INTO users(id,cooperative_id,establishment_id,driver_id,name,email,username,password_hash,password_salt,role,status) VALUES(${q(userId)},${q(driver.cooperative_id)},NULL,${q(driver.id)},${q(driver.name)},${q(email)},${username?q(username):'NULL'},${q(hash)},${q(salt)},'driver','active');`;
  const file=join(projectDir,`.repair-driver-${Date.now()}.sql`);writeFileSync(file,sql,'utf8');try{run(['d1','execute','DB',scopeFlag,'--file',file])}finally{try{unlinkSync(file)}catch{}}
  run(['d1','execute','DB',scopeFlag,'--command',`SELECT u.name,u.email,u.username,u.role,u.status,d.name cooperado,d.status cadastro_status FROM users u JOIN drivers d ON d.id=u.driver_id WHERE u.id=${q(userId)};`]);
  console.log(`\nAcesso do cooperado reparado. Login: ${username||email}`);
}catch(e){console.error(`\nFalha ao reparar o acesso: ${e.message}`);process.exitCode=1}
