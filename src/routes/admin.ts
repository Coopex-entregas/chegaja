import { Hono, type Context } from 'hono';
import type { AppBindings, Role } from '../types';
import { hashPassword, randomToken } from '../lib/crypto';
import { audit } from '../lib/audit';
import { assertRole, bodyJson, cleanText, cooperativeScope, id, nowIso, nullableText, sqlLike, toCents, toNumber } from '../lib/util';
import { saveBrandingAsset } from '../lib/branding';

export const adminRoutes = new Hono<AppBindings>();

const digitsOnly = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const normalizedPersonName = (value: unknown) => cleanText(value,150).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
function brazilToday(): string {
  const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return date.toISOString().slice(0,10);
}
function membershipParts(value: unknown, defaultYear: number): { number:string; sequence:number; year:number } | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,4})\s*[-\/]\s*(\d{2}|\d{4})$/);
  if (!match) throw new Error('A matrícula deve seguir o formato 0001-26.');
  const sequence = Number(match[1]);
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) throw new Error('A sequência da matrícula deve ficar entre 0001 e 9999.');
  const short = Number(match[2].slice(-2));
  const century = defaultYear - (defaultYear % 100);
  let year = match[2].length === 4 ? Number(match[2]) : century + short;
  if (year > defaultYear + 1) year -= 100;
  return { number:`${String(sequence).padStart(4,'0')}-${String(year).slice(-2)}`, sequence, year };
}
async function nextMembership(c: Context<AppBindings>, cooperativeId:string, joinedAt:string) {
  const year = Number(joinedAt.slice(0,4)) || Number(brazilToday().slice(0,4));
  // A sequência é permanente dentro da cooperativa e não reinicia a cada ano.
  // O sufixo informa apenas o ano de ingresso: 0667-22, 0668-23, 0669-26...
  const row = await c.env.DB.prepare(`SELECT MAX(COALESCE(membership_sequence,CAST(substr(membership_number,1,instr(membership_number,'-')-1) AS INTEGER),0)) max_sequence FROM drivers WHERE cooperative_id=?`)
    .bind(cooperativeId).first<{max_sequence:number}>();
  const sequence = Math.max(0,Number(row?.max_sequence||0)) + 1;
  if (sequence > 9999) throw new Error('A numeração de matrícula atingiu o limite de 9999 cooperados.');
  return { number:`${String(sequence).padStart(4,'0')}-${String(year).slice(-2)}`, sequence, year };
}
async function activeAttendantBases(c: Context<AppBindings>, cooperativeId:string) {
  const rows=await c.env.DB.prepare(`SELECT id,name,address,active FROM bases WHERE cooperative_id=? AND deleted_at IS NULL AND COALESCE(active,1)=1 ORDER BY name`).bind(cooperativeId).all<{id:string;name:string;address:string;active:number}>();
  return rows.results||[];
}
async function resolveAttendantBase(c: Context<AppBindings>, cooperativeId:string, requested:unknown):Promise<string> {
  const bases=await activeAttendantBases(c,cooperativeId);
  // Quando há uma única Base, ela é sempre vinculada automaticamente. Isso
  // também neutraliza um id antigo que tenha ficado salvo no formulário/cache.
  if(bases.length===1)return bases[0].id;
  if(!bases.length)throw new Error('Nenhuma Base ativa foi encontrada nesta cooperativa.');
  const requestedId=cleanText(requested,100);
  const linked=bases.find(base=>base.id===requestedId);
  if(linked)return linked.id;
  throw new Error('A cooperativa possui mais de uma Base. Selecione em qual delas o atendente trabalhará.');
}

const guaranteeFields = [
  ['guarantee_sun',0],['guarantee_mon',1],['guarantee_tue',2],['guarantee_wed',3],
  ['guarantee_thu',4],['guarantee_fri',5],['guarantee_sat',6]
] as const;
const guaranteeSelect = (alias='e') => guaranteeFields.map(([key,weekday]) => `,(SELECT guaranteed_cents FROM establishment_daily_guarantees g WHERE g.establishment_id=${alias}.id AND g.weekday=${weekday} AND g.active=1 LIMIT 1) ${key}_cents`).join('');
async function saveDailyGuarantees(c: Context<AppBindings>, cooperativeId:string, establishmentId:string, body:Record<string,unknown>) {
  const statements:D1PreparedStatement[]=[];
  for(const [key,weekday] of guaranteeFields){
    if(!(key in body))continue;
    const cents=Math.max(0,toCents(body[key]));
    statements.push(c.env.DB.prepare(`INSERT INTO establishment_daily_guarantees(id,cooperative_id,establishment_id,weekday,guaranteed_cents,active) VALUES (?,?,?,?,?,?) ON CONFLICT(establishment_id,weekday) DO UPDATE SET guaranteed_cents=excluded.guaranteed_cents,active=excluded.active,updated_at=CURRENT_TIMESTAMP`)
      .bind(id(),cooperativeId,establishmentId,weekday,cents,cents>0?1:0));
  }
  if(statements.length)await c.env.DB.batch(statements);
}


type EstablishmentShiftInput = {
  id?: string | null;
  name: string;
  start_time: string;
  end_time: string;
  shift_label: string;
  guaranteed_cents: number;
};

function establishmentShiftInputs(body:Record<string,unknown>):EstablishmentShiftInput[]|null {
  if(!('shift_templates_json' in body) && !('shift_templates' in body)) return null;
  const source=body.shift_templates_json ?? body.shift_templates;
  let values:unknown=source;
  if(typeof source==='string'){
    const raw=source.trim();
    if(!raw)return [];
    try{values=JSON.parse(raw);}catch{throw new Error('Os horários e garantidos enviados estão inválidos.');}
  }
  if(!Array.isArray(values))throw new Error('Informe os horários do estabelecimento em uma lista válida.');
  if(values.length>60)throw new Error('Cadastre no máximo 60 horários por estabelecimento.');
  const normalized:EstablishmentShiftInput[]=[];
  for(const value of values){
    if(!value || typeof value!=='object')continue;
    const row=value as Record<string,unknown>;
    const start=cleanText(row.start_time,5),end=cleanText(row.end_time,5);
    const name=cleanText(row.name || (start&&end?`${start} às ${end}`:''),100);
    const label=cleanText(row.shift_label || 'DIA',100);
    const hasAny=Boolean(name||start||end||row.guaranteed_value);
    if(!hasAny)continue;
    if(!name||!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end))throw new Error('Preencha nome, hora inicial e hora final de todos os horários.');
    normalized.push({
      id:nullableText(row.id,100),
      name,start_time:start,end_time:end,shift_label:label,
      guaranteed_cents:Math.max(0,toCents(row.guaranteed_value))
    });
  }
  return normalized;
}

async function syncEstablishmentShiftTemplates(c:Context<AppBindings>,cooperativeId:string,establishmentId:string,items:EstablishmentShiftInput[]|null){
  if(items===null)return;
  const existingRows=await c.env.DB.prepare(`SELECT st.id FROM shift_templates st LEFT JOIN contracts ct ON ct.id=st.contract_id AND ct.deleted_at IS NULL WHERE st.cooperative_id=? AND (st.establishment_id=? OR ct.establishment_id=?) AND st.deleted_at IS NULL`).bind(cooperativeId,establishmentId,establishmentId).all<{id:string}>();
  const existing=new Set((existingRows.results||[]).map(row=>String(row.id)));
  const kept=new Set<string>();
  const statements:D1PreparedStatement[]=[];
  for(const item of items){
    if(item.id&&existing.has(item.id)){
      kept.add(item.id);
      statements.push(c.env.DB.prepare(`UPDATE shift_templates SET name=?,start_time=?,end_time=?,shift_label=?,guaranteed_cents=?,contract_id=NULL,base_id=NULL,active=1,deleted_at=NULL,updated_at=? WHERE id=? AND cooperative_id=?`)
        .bind(item.name,item.start_time,item.end_time,item.shift_label,item.guaranteed_cents,nowIso(),item.id,cooperativeId));
    }else{
      const shiftId=id();kept.add(shiftId);
      statements.push(c.env.DB.prepare(`INSERT INTO shift_templates(id,cooperative_id,name,start_time,end_time,shift_label,establishment_id,contract_id,base_id,guaranteed_cents,active) VALUES (?,?,?,?,?,?,?,NULL,NULL,?,1)`)
        .bind(shiftId,cooperativeId,item.name,item.start_time,item.end_time,item.shift_label,establishmentId,item.guaranteed_cents));
    }
  }
  for(const shiftId of existing){
    if(!kept.has(shiftId))statements.push(c.env.DB.prepare(`UPDATE shift_templates SET active=0,deleted_at=COALESCE(deleted_at,?),updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),shiftId));
  }
  if(statements.length)await c.env.DB.batch(statements);
}


async function saveLinkedAccess(c: Context<AppBindings>, kind: 'establishment' | 'driver', entityId: string) {
  const auth = c.get('auth');
  assertRole(auth, ['platform_admin','cooperative_admin']);
  const table = kind === 'establishment' ? 'establishments' : 'drivers';
  const role: Role = kind === 'establishment' ? 'establishment' : 'driver';
  const foreignColumn = kind === 'establishment' ? 'establishment_id' : 'driver_id';
  const entity = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND deleted_at IS NULL`).bind(entityId).first<any>();
  if (!entity || (auth.role !== 'platform_admin' && auth.cooperativeId !== entity.cooperative_id)) {
    return c.json({ ok:false, error:'Cadastro não encontrado ou acesso não autorizado.' }, 404);
  }
  if (kind === 'driver' && entity.status !== 'active') return c.json({ok:false,error:'Ative o cooperado antes de criar o acesso.'},409);
  if (kind === 'establishment' && Number(entity.active || 0) !== 1) return c.json({ok:false,error:'Ative o estabelecimento antes de criar o acesso.'},409);

  const body = await bodyJson<Record<string,unknown>>(c);
  const name = cleanText(body.name || entity.name, 150);
  const email = cleanText(body.email || entity.email, 200).toLowerCase();
  const username = nullableText(body.username, 100)?.toLowerCase() || null;
  const password = String(body.password || '');
  if (!name || !email) return c.json({ ok:false,error:'Informe nome e e-mail de acesso.' },400);

  // Primeiro procura o acesso já vinculado. Depois tenta reaproveitar um usuário antigo
  // da mesma cooperativa/mesmo perfil que tenha o mesmo e-mail ou usuário, mas esteja sem vínculo.
  let existing = await c.env.DB.prepare(`SELECT * FROM users WHERE ${foreignColumn}=? AND role=? AND deleted_at IS NULL LIMIT 1`).bind(entityId, role).first<any>();
  if (!existing) {
    existing = await c.env.DB.prepare(`SELECT * FROM users WHERE cooperative_id=? AND role=? AND deleted_at IS NULL AND (lower(trim(email))=? OR (? IS NOT NULL AND lower(trim(username))=?)) AND (${foreignColumn} IS NULL OR ${foreignColumn}=?) LIMIT 1`)
      .bind(entity.cooperative_id, role, email, username, username, entityId).first<any>();
  }

  try {
    if (existing) {
      const establishmentId = kind === 'establishment' ? entityId : null;
      const driverId = kind === 'driver' ? entityId : null;
      const statements: D1PreparedStatement[] = [c.env.DB.prepare(`UPDATE users SET cooperative_id=?,establishment_id=?,driver_id=?,name=?,email=?,username=?,role=?,status='active',deleted_at=NULL,updated_at=? WHERE id=?`)
        .bind(entity.cooperative_id,establishmentId,driverId,name,email,username,role,nowIso(),existing.id)];
      if (password) {
        if (password.length < 8) return c.json({ok:false,error:'A senha deve ter pelo menos 8 caracteres.'},400);
        const hashed = await hashPassword(password);
        statements.push(c.env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?`).bind(hashed.hash,hashed.salt,nowIso(),existing.id));
      }
      if (kind === 'driver') statements.push(c.env.DB.prepare(`UPDATE drivers SET email=COALESCE(NULLIF(?,''),email),updated_at=? WHERE id=?`).bind(email,nowIso(),entityId));
      await c.env.DB.batch(statements);
      await audit(c,'update','user',existing.id,{email:existing.email,role},{name,email,username,role,entityId},entity.cooperative_id);
      return c.json({ok:true,id:existing.id,updated:true,login:{email,username}});
    }
    if (password.length < 8) return c.json({ok:false,error:'Informe uma senha inicial com pelo menos 8 caracteres.'},400);
    const hashed = await hashPassword(password);
    const userId = id();
    const establishmentId = kind === 'establishment' ? entityId : null;
    const driverId = kind === 'driver' ? entityId : null;
    const statements: D1PreparedStatement[] = [c.env.DB.prepare(`INSERT INTO users (id,cooperative_id,establishment_id,driver_id,name,email,username,password_hash,password_salt,role,status) VALUES (?,?,?,?,?,?,?,?,?,?,'active')`)
      .bind(userId,entity.cooperative_id,establishmentId,driverId,name,email,username,hashed.hash,hashed.salt,role)];
    if (kind === 'driver') statements.push(c.env.DB.prepare(`UPDATE drivers SET email=COALESCE(NULLIF(?,''),email),updated_at=? WHERE id=?`).bind(email,nowIso(),entityId));
    await c.env.DB.batch(statements);
    await audit(c,'create','user',userId,null,{name,email,username,role,entityId},entity.cooperative_id);
    return c.json({ok:true,id:userId,created:true,login:{email,username}},201);
  } catch (error) {
    console.error('saveLinkedAccess', error);
    return c.json({ok:false,error:'E-mail ou usuário já está sendo usado em outro acesso. Abra Usuários para localizar o cadastro duplicado.'},409);
  }
}

adminRoutes.get('/dashboard', async (c) => {
  const auth = c.get('auth');
  const coop = cooperativeScope(auth, c.req.query('cooperative_id'));
  const params: unknown[] = [];
  const where = coop ? ' cooperative_id = ? AND ' : '';
  if (coop) params.push(coop);

  if (auth.role === 'driver' && auth.driverId) {
    const data = await c.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM deliveries WHERE assigned_driver_id=? AND deleted_at IS NULL AND status NOT IN ('delivered','cancelled')) active_deliveries,
        (SELECT COUNT(*) FROM deliveries WHERE assigned_driver_id=? AND deleted_at IS NULL AND date(created_at,'-3 hours')=date('now','-3 hours')) deliveries_today,
        (SELECT COALESCE(SUM(amount_cents),0) FROM financial_entries WHERE driver_id=? AND deleted_at IS NULL AND status!='cancelled') balance_cents,
        (SELECT COUNT(*) FROM schedules WHERE driver_id=? AND deleted_at IS NULL AND start_at >= datetime('now') AND start_at < datetime('now','+7 days')) schedules_week
    `).bind(auth.driverId, auth.driverId, auth.driverId, auth.driverId).first();
    return c.json({ ok: true, data });
  }

  if (auth.role === 'establishment' && auth.establishmentId) {
    const data = await c.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM deliveries WHERE establishment_id=? AND deleted_at IS NULL AND status NOT IN ('delivered','cancelled')) active_deliveries,
        (SELECT COUNT(*) FROM deliveries WHERE establishment_id=? AND deleted_at IS NULL AND date(created_at,'-3 hours')=date('now','-3 hours')) deliveries_today,
        (SELECT COALESCE(SUM(charge_cents),0) FROM deliveries WHERE establishment_id=? AND deleted_at IS NULL AND status='delivered' AND strftime('%Y-%m',created_at,'-3 hours')=strftime('%Y-%m','now','-3 hours')) month_charge_cents,
        (SELECT COUNT(DISTINCT assigned_driver_id) FROM deliveries WHERE establishment_id=? AND deleted_at IS NULL AND date(created_at,'-3 hours')=date('now','-3 hours')) drivers_today
    `).bind(auth.establishmentId, auth.establishmentId, auth.establishmentId, auth.establishmentId).first();
    return c.json({ ok: true, data });
  }

  const statements = [
    auth.role === 'platform_admin'
      ? c.env.DB.prepare(`SELECT COUNT(*) value FROM cooperatives WHERE deleted_at IS NULL AND status='active'`)
      : c.env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM cooperatives WHERE id=? AND deleted_at IS NULL AND status='active') THEN 1 ELSE 0 END value`).bind(auth.cooperativeId),
    c.env.DB.prepare(`SELECT COUNT(*) value FROM establishments WHERE ${where} deleted_at IS NULL AND active=1`).bind(...params),
    c.env.DB.prepare(`SELECT COUNT(*) value FROM drivers WHERE ${where} deleted_at IS NULL AND status='active'`).bind(...params),
    c.env.DB.prepare(`SELECT COUNT(*) value FROM deliveries WHERE ${where} deleted_at IS NULL AND date(created_at,'-3 hours')=date('now','-3 hours')`).bind(...params),
    c.env.DB.prepare(`SELECT COUNT(*) value FROM deliveries WHERE ${where} deleted_at IS NULL AND status NOT IN ('delivered','cancelled')`).bind(...params),
    c.env.DB.prepare(`SELECT COALESCE(SUM(charge_cents),0) value FROM deliveries WHERE ${where} deleted_at IS NULL AND status='delivered' AND strftime('%Y-%m',created_at,'-3 hours')=strftime('%Y-%m','now','-3 hours')`).bind(...params),
    c.env.DB.prepare(`SELECT COUNT(*) value FROM drivers WHERE ${where} deleted_at IS NULL AND online=1 AND location_updated_at >= datetime('now','-5 minutes')`).bind(...params)
  ];
  const results = await c.env.DB.batch(statements);
  const values = results.map((result) => Number((result.results?.[0] as { value?: number } | undefined)?.value ?? 0));
  return c.json({
    ok: true,
    data: {
      cooperatives: values[0],
      establishments: values[1],
      drivers: values[2],
      deliveries_today: values[3],
      active_deliveries: values[4],
      month_charge_cents: values[5],
      online_drivers: values[6]
    }
  });
});

adminRoutes.get('/cooperatives', async (c) => {
  const auth = c.get('auth');
  assertRole(auth, ['platform_admin']);
  const search = cleanText(c.req.query('q'), 100);
  const query = search
    ? c.env.DB.prepare(`SELECT * FROM cooperatives WHERE deleted_at IS NULL AND (name LIKE ? OR legal_name LIKE ? OR cnpj LIKE ?) ORDER BY created_at DESC`).bind(sqlLike(search), sqlLike(search), sqlLike(search))
    : c.env.DB.prepare(`SELECT * FROM cooperatives WHERE deleted_at IS NULL ORDER BY created_at DESC`);
  const rows = await query.all();
  return c.json({ ok: true, items: rows.results });
});

adminRoutes.post('/cooperatives', async (c) => {
  const auth = c.get('auth');
  assertRole(auth, ['platform_admin']);
  const body = await bodyJson<Record<string, unknown>>(c);
  const name = cleanText(body.name, 150);
  if (!name) return c.json({ ok: false, error: 'Informe o nome da cooperativa.' }, 400);
  const cooperative = {
    id: id(), name, legal_name: nullableText(body.legal_name, 200), cnpj: nullableText(body.cnpj, 30),
    email: nullableText(body.email, 200), phone: nullableText(body.phone, 40), address: nullableText(body.address, 500),
    logo_url: nullableText(body.logo_url, 500), primary_color: cleanText(body.primary_color || '#7A1538', 20), status: cleanText(body.status || 'active', 20)
  };
  await c.env.DB.prepare(`INSERT INTO cooperatives (id,name,legal_name,cnpj,email,phone,address,logo_url,primary_color,status) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(...Object.values(cooperative)).run();
  await audit(c, 'create', 'cooperative', cooperative.id, null, cooperative, cooperative.id);
  return c.json({ ok: true, item: cooperative }, 201);
});

adminRoutes.put('/cooperatives/:id', async (c) => {
  const auth = c.get('auth'); assertRole(auth, ['platform_admin']);
  const cooperativeId = c.req.param('id');
  const before = await c.env.DB.prepare(`SELECT * FROM cooperatives WHERE id=? AND deleted_at IS NULL`).bind(cooperativeId).first();
  if (!before) return c.json({ ok: false, error: 'Cooperativa não encontrada.' }, 404);
  const body = await bodyJson<Record<string, unknown>>(c);
  const after = {
    name: cleanText(body.name ?? (before as any).name, 150), legal_name: nullableText(body.legal_name ?? (before as any).legal_name, 200),
    cnpj: nullableText(body.cnpj ?? (before as any).cnpj, 30), email: nullableText(body.email ?? (before as any).email, 200),
    phone: nullableText(body.phone ?? (before as any).phone, 40), address: nullableText(body.address ?? (before as any).address, 500),
    logo_url: nullableText(body.logo_url ?? (before as any).logo_url, 500), primary_color: cleanText(body.primary_color ?? (before as any).primary_color, 20),
    status: cleanText(body.status ?? (before as any).status, 20)
  };
  await c.env.DB.prepare(`UPDATE cooperatives SET name=?,legal_name=?,cnpj=?,email=?,phone=?,address=?,logo_url=?,primary_color=?,status=?,updated_at=? WHERE id=?`)
    .bind(after.name,after.legal_name,after.cnpj,after.email,after.phone,after.address,after.logo_url,after.primary_color,after.status,nowIso(),cooperativeId).run();
  await audit(c, 'update', 'cooperative', cooperativeId, before, after, cooperativeId);
  return c.json({ ok: true });
});

adminRoutes.delete('/cooperatives/:id', async (c) => {
  const auth = c.get('auth'); assertRole(auth, ['platform_admin']);
  const cooperativeId = c.req.param('id');
  await c.env.DB.prepare(`UPDATE cooperatives SET status='inactive',deleted_at=?,updated_at=? WHERE id=?`).bind(nowIso(), nowIso(), cooperativeId).run();
  await audit(c, 'delete', 'cooperative', cooperativeId, null, null, cooperativeId);
  return c.json({ ok: true });
});

adminRoutes.get('/establishments', async (c) => {
  const auth = c.get('auth');
  if (auth.role === 'driver') {
    const rows = await c.env.DB.prepare(`
      SELECT e.*,(SELECT COUNT(*) FROM shift_templates st LEFT JOIN contracts sct ON sct.id=st.contract_id AND sct.deleted_at IS NULL WHERE (st.establishment_id=e.id OR sct.establishment_id=e.id) AND st.active=1 AND st.deleted_at IS NULL) shift_count FROM establishments e JOIN driver_establishments de ON de.establishment_id=e.id
      WHERE de.driver_id=? AND e.deleted_at IS NULL ORDER BY e.name
    `).bind(auth.driverId).all();
    return c.json({ ok: true, items: rows.results });
  }
  if (auth.role === 'establishment') {
    const row = await c.env.DB.prepare(`SELECT e.*${guaranteeSelect('e')}, (SELECT COUNT(*) FROM shift_templates st LEFT JOIN contracts sct ON sct.id=st.contract_id AND sct.deleted_at IS NULL WHERE (st.establishment_id=e.id OR sct.establishment_id=e.id) AND st.active=1 AND st.deleted_at IS NULL) shift_count, (SELECT u.id FROM users u WHERE u.establishment_id=e.id AND u.role='establishment' AND u.deleted_at IS NULL LIMIT 1) access_user_id, (SELECT u.email FROM users u WHERE u.establishment_id=e.id AND u.role='establishment' AND u.deleted_at IS NULL LIMIT 1) access_email, (SELECT u.status FROM users u WHERE u.establishment_id=e.id AND u.role='establishment' AND u.deleted_at IS NULL LIMIT 1) access_status FROM establishments e WHERE e.id=? AND e.deleted_at IS NULL`).bind(auth.establishmentId).first();
    return c.json({ ok: true, items: row ? [row] : [] });
  }
  const coop = cooperativeScope(auth, c.req.query('cooperative_id'));
  const search = cleanText(c.req.query('q'), 100);
  let sql = `SELECT e.*${guaranteeSelect('e')}, (SELECT COUNT(*) FROM shift_templates st LEFT JOIN contracts sct ON sct.id=st.contract_id AND sct.deleted_at IS NULL WHERE (st.establishment_id=e.id OR sct.establishment_id=e.id) AND st.active=1 AND st.deleted_at IS NULL) shift_count, c.name cooperative_name, (SELECT u.id FROM users u WHERE u.establishment_id=e.id AND u.role='establishment' AND u.deleted_at IS NULL LIMIT 1) access_user_id, (SELECT u.email FROM users u WHERE u.establishment_id=e.id AND u.role='establishment' AND u.deleted_at IS NULL LIMIT 1) access_email, (SELECT u.status FROM users u WHERE u.establishment_id=e.id AND u.role='establishment' AND u.deleted_at IS NULL LIMIT 1) access_status FROM establishments e JOIN cooperatives c ON c.id=e.cooperative_id WHERE e.deleted_at IS NULL`;
  const params: unknown[] = [];
  if (coop) { sql += ` AND e.cooperative_id=?`; params.push(coop); }
  if (search) { sql += ` AND (e.name LIKE ? OR e.cnpj LIKE ? OR e.email LIKE ?)`; params.push(sqlLike(search),sqlLike(search),sqlLike(search)); }
  sql += ` ORDER BY e.name`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ ok: true, items: rows.results });
});

adminRoutes.post('/establishments', async (c) => {
  const auth = c.get('auth'); assertRole(auth, ['platform_admin','cooperative_admin','dispatcher']);
  const body = await bodyJson<Record<string, unknown>>(c);
  const cooperativeId = cooperativeScope(auth, cleanText(body.cooperative_id, 100));
  if (!cooperativeId) return c.json({ ok: false, error: 'Selecione a cooperativa.' }, 400);
  const name = cleanText(body.name, 150);
  if (!name) return c.json({ ok: false, error: 'Informe o estabelecimento.' }, 400);
  let shiftInputs:EstablishmentShiftInput[]|null;
  try{shiftInputs=establishmentShiftInputs(body);}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:'Horários inválidos.'},400);}
  const establishment = {
    id: id(), cooperative_id: cooperativeId, name, legal_name: nullableText(body.legal_name,200), cnpj: nullableText(body.cnpj,30),
    email: nullableText(body.email,200), phone: nullableText(body.phone,40), address: nullableText(body.address,500), logo_url: nullableText(body.logo_url,500),
    latitude: toNumber(body.latitude), longitude: toNumber(body.longitude), checkin_token: `LG-${randomToken(12)}`,
    city: nullableText(body.city,100), state: nullableText(body.state,50), postal_code: nullableText(body.postal_code,20),
    rate_per_km_cents: toCents(body.rate_per_km || 2.5), minimum_fee_cents: toCents(body.minimum_fee || 12),
    cooperative_fee_percent: toNumber(body.cooperative_fee_percent) ?? 0, auto_quote: body.auto_quote === false ? 0 : 1,
    order_prefix: cleanText(body.order_prefix || 'LG',12).toUpperCase()
  };
  await c.env.DB.prepare(`INSERT INTO establishments (id,cooperative_id,name,legal_name,cnpj,email,phone,address,logo_url,latitude,longitude,checkin_token,city,state,postal_code,rate_per_km_cents,minimum_fee_cents,cooperative_fee_percent,auto_quote,order_prefix) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(...Object.values(establishment)).run();
  if(body.logo_data_url){
    establishment.logo_url=await saveBrandingAsset(c.env,'establishment',establishment.id,body.logo_data_url);
    await c.env.DB.prepare(`UPDATE establishments SET logo_url=? WHERE id=?`).bind(establishment.logo_url,establishment.id).run();
  }
  await saveDailyGuarantees(c,cooperativeId,establishment.id,body);
  await syncEstablishmentShiftTemplates(c,cooperativeId,establishment.id,shiftInputs);
  await audit(c, 'create', 'establishment', establishment.id, null, establishment, cooperativeId);
  return c.json({ ok: true, item: establishment }, 201);
});

adminRoutes.put('/establishments/:id', async (c) => {
  const auth = c.get('auth'); assertRole(auth, ['platform_admin','cooperative_admin','dispatcher']);
  const entityId = c.req.param('id');
  const before = await c.env.DB.prepare(`SELECT * FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(entityId).first<any>();
  if (!before) return c.json({ ok: false, error: 'Estabelecimento não encontrado.' }, 404);
  if (auth.role !== 'platform_admin' && auth.cooperativeId !== before.cooperative_id) return c.json({ ok: false, error: 'Acesso não autorizado.' }, 403);
  const body = await bodyJson<Record<string, unknown>>(c);
  let shiftInputs:EstablishmentShiftInput[]|null;
  try{shiftInputs=establishmentShiftInputs(body);}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:'Horários inválidos.'},400);}
  const after = {
    name: cleanText(body.name ?? before.name,150), legal_name: nullableText(body.legal_name ?? before.legal_name,200), cnpj: nullableText(body.cnpj ?? before.cnpj,30),
    email: nullableText(body.email ?? before.email,200), phone: nullableText(body.phone ?? before.phone,40), address: nullableText(body.address ?? before.address,500), logo_url: nullableText(body.logo_url ?? before.logo_url,500),
    latitude: toNumber(body.latitude ?? before.latitude), longitude: toNumber(body.longitude ?? before.longitude), active: Number(body.active ?? before.active) ? 1 : 0,
    city: nullableText(body.city ?? before.city,100), state: nullableText(body.state ?? before.state,50), postal_code: nullableText(body.postal_code ?? before.postal_code,20),
    rate_per_km_cents: body.rate_per_km !== undefined ? toCents(body.rate_per_km) : before.rate_per_km_cents,
    minimum_fee_cents: body.minimum_fee !== undefined ? toCents(body.minimum_fee) : before.minimum_fee_cents,
    cooperative_fee_percent: body.cooperative_fee_percent !== undefined ? toNumber(body.cooperative_fee_percent) : before.cooperative_fee_percent,
    auto_quote: body.auto_quote === undefined ? before.auto_quote : (body.auto_quote ? 1 : 0),
    order_prefix: cleanText(body.order_prefix ?? before.order_prefix ?? 'LG',12).toUpperCase()
  };
  await c.env.DB.prepare(`UPDATE establishments SET name=?,legal_name=?,cnpj=?,email=?,phone=?,address=?,latitude=?,longitude=?,active=?,city=?,state=?,postal_code=?,rate_per_km_cents=?,minimum_fee_cents=?,cooperative_fee_percent=?,auto_quote=?,order_prefix=?,updated_at=? WHERE id=?`)
    .bind(after.name,after.legal_name,after.cnpj,after.email,after.phone,after.address,after.latitude,after.longitude,after.active,after.city,after.state,after.postal_code,after.rate_per_km_cents,after.minimum_fee_cents,after.cooperative_fee_percent,after.auto_quote,after.order_prefix,nowIso(),entityId).run();
  if(body.logo_data_url){
    const logoUrl=await saveBrandingAsset(c.env,'establishment',entityId,body.logo_data_url);
    await c.env.DB.prepare(`UPDATE establishments SET logo_url=? WHERE id=?`).bind(logoUrl,entityId).run();
    (after as any).logo_url=logoUrl;
  }
  await saveDailyGuarantees(c,before.cooperative_id,entityId,body);
  await syncEstablishmentShiftTemplates(c,before.cooperative_id,entityId,shiftInputs);
  await audit(c, 'update', 'establishment', entityId, before, after, before.cooperative_id);
  return c.json({ ok: true });
});

adminRoutes.post('/establishments/:id/access', async (c) => saveLinkedAccess(c, 'establishment', c.req.param('id')));

adminRoutes.delete('/establishments/:id', async (c) => {
  const auth = c.get('auth'); assertRole(auth, ['platform_admin','cooperative_admin']);
  const entity = await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=?`).bind(c.req.param('id')).first<{cooperative_id:string}>();
  if (!entity || (auth.role !== 'platform_admin' && auth.cooperativeId !== entity.cooperative_id)) return c.json({ ok:false,error:'Acesso não autorizado.'},403);
  await c.env.DB.batch([c.env.DB.prepare(`UPDATE establishments SET active=0,deleted_at=?,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),c.req.param('id')),c.env.DB.prepare(`UPDATE users SET status='inactive',updated_at=? WHERE establishment_id=? AND role='establishment' AND deleted_at IS NULL`).bind(nowIso(),c.req.param('id'))]);
  await audit(c,'delete','establishment',c.req.param('id'),null,null,entity.cooperative_id);
  return c.json({ok:true});
});

adminRoutes.get('/drivers', async (c) => {
  const auth = c.get('auth');
  if (auth.role === 'driver') {
    const row = await c.env.DB.prepare(`SELECT d.*, (SELECT GROUP_CONCAT(de.establishment_id) FROM driver_establishments de WHERE de.driver_id=d.id) establishment_ids, (SELECT u.id FROM users u WHERE u.driver_id=d.id AND u.role='driver' AND u.deleted_at IS NULL LIMIT 1) access_user_id, (SELECT u.email FROM users u WHERE u.driver_id=d.id AND u.role='driver' AND u.deleted_at IS NULL LIMIT 1) access_email, (SELECT u.username FROM users u WHERE u.driver_id=d.id AND u.role='driver' AND u.deleted_at IS NULL LIMIT 1) access_username, (SELECT u.status FROM users u WHERE u.driver_id=d.id AND u.role='driver' AND u.deleted_at IS NULL LIMIT 1) access_status FROM drivers d WHERE d.id=?`).bind(auth.driverId).first();
    return c.json({ ok: true, items: row ? [row] : [] });
  }
  const coop = cooperativeScope(auth, c.req.query('cooperative_id'));
  const search = cleanText(c.req.query('q'), 100);
  const includeInactive = ['1','true','yes'].includes(String(c.req.query('include_inactive')||'').toLowerCase()) && ['platform_admin','cooperative_admin','dispatcher'].includes(auth.role);
  let sql = `SELECT d.*, c.name cooperative_name, (SELECT GROUP_CONCAT(de2.establishment_id) FROM driver_establishments de2 WHERE de2.driver_id=d.id) establishment_ids, (SELECT u.id FROM users u WHERE u.driver_id=d.id AND u.role='driver' AND u.deleted_at IS NULL LIMIT 1) access_user_id, (SELECT u.email FROM users u WHERE u.driver_id=d.id AND u.role='driver' AND u.deleted_at IS NULL LIMIT 1) access_email, (SELECT u.username FROM users u WHERE u.driver_id=d.id AND u.role='driver' AND u.deleted_at IS NULL LIMIT 1) access_username, (SELECT u.status FROM users u WHERE u.driver_id=d.id AND u.role='driver' AND u.deleted_at IS NULL LIMIT 1) access_status FROM drivers d JOIN cooperatives c ON c.id=d.cooperative_id WHERE 1=1`;
  const params: unknown[] = [];
  if(!includeInactive)sql += ` AND d.deleted_at IS NULL AND d.status='active'`;
  if (coop) { sql += ` AND d.cooperative_id=?`; params.push(coop); }
  if (auth.role === 'establishment') { sql += ` AND d.deleted_at IS NULL AND d.status='active' AND EXISTS(SELECT 1 FROM driver_establishments de WHERE de.driver_id=d.id AND de.establishment_id=?)`; params.push(auth.establishmentId); }
  if (search) { sql += ` AND (d.name LIKE ? OR d.cpf LIKE ? OR d.vehicle_plate LIKE ? OR d.membership_number LIKE ?)`; params.push(sqlLike(search),sqlLike(search),sqlLike(search),sqlLike(search)); }
  sql += ` ORDER BY CASE d.status WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,d.name`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ ok: true, items: rows.results });
});

adminRoutes.get('/drivers/next-membership', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher']);
  const cooperativeId=cooperativeScope(auth,c.req.query('cooperative_id'));
  if(!cooperativeId)return c.json({ok:false,error:'Selecione a cooperativa.'},400);
  const joinedAt=cleanText(c.req.query('joined_at')||brazilToday(),10);
  const membership=await nextMembership(c,cooperativeId,joinedAt);
  return c.json({ok:true,item:{membership_number:membership.number,membership_sequence:membership.sequence,membership_year:membership.year,joined_at:joinedAt}});
});

adminRoutes.post('/drivers', async (c) => {
  const auth = c.get('auth'); assertRole(auth, ['platform_admin','cooperative_admin','dispatcher']);
  const body = await bodyJson<Record<string, unknown>>(c);
  const cooperativeId = cooperativeScope(auth, cleanText(body.cooperative_id,100));
  if (!cooperativeId) return c.json({ok:false,error:'Selecione a cooperativa.'},400);
  const name = cleanText(body.name,150); if (!name) return c.json({ok:false,error:'Informe o nome do cooperado.'},400);
  const cpf = digitsOnly(body.cpf) || null;
  const joinedAt = cleanText(body.joined_at || brazilToday(),10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(joinedAt))return c.json({ok:false,error:'Informe uma data de ingresso válida.'},400);
  const currentYear=Number(joinedAt.slice(0,4));

  let existing:any=null;
  if(cpf){
    existing=await c.env.DB.prepare(`SELECT * FROM drivers WHERE cooperative_id=? AND replace(replace(replace(cpf,'.',''),'-',''),' ','')=? ORDER BY CASE status WHEN 'inactive' THEN 0 ELSE 1 END,created_at LIMIT 1`).bind(cooperativeId,cpf).first<any>();
    if(existing && normalizedPersonName(existing.name)!==normalizedPersonName(name)){
      return c.json({ok:false,error:'Este CPF já pertence a outro nome cadastrado.'},409);
    }
  }
  if(existing?.status==='active' && existing.deleted_at==null){
    return c.json({ok:false,error:`O cooperado já está ativo com a matrícula ${existing.membership_number||'ainda não informada'}.`},409);
  }

  let membership=existing?.membership_number
    ? {number:String(existing.membership_number),sequence:Number(existing.membership_sequence||String(existing.membership_number).split('-')[0]),year:Number(existing.membership_year||(`20${String(existing.membership_number).slice(-2)}`))}
    : membershipParts(body.membership_number,currentYear) || await nextMembership(c,cooperativeId,joinedAt);
  const duplicate=await c.env.DB.prepare(`SELECT id,name,status,membership_number FROM drivers WHERE cooperative_id=? AND (membership_number=? OR membership_sequence=?) AND id<>? LIMIT 1`).bind(cooperativeId,membership.number,membership.sequence,existing?.id||'').first<any>();
  if(duplicate)return c.json({ok:false,error:`A sequência ${String(membership.sequence).padStart(4,'0')} já pertence a ${duplicate.name} (${duplicate.membership_number||'matrícula existente'}).`},409);

  if(existing){
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE drivers SET name=?,cpf=?,email=?,phone=?,vehicle_plate=?,vehicle_model=?,status='active',online=0,membership_number=?,membership_sequence=?,membership_year=?,joined_at=COALESCE(joined_at,?),left_at=NULL,deleted_at=NULL,updated_at=? WHERE id=?`)
        .bind(name,cpf,nullableText(body.email,200),nullableText(body.phone,40),nullableText(body.vehicle_plate,20),nullableText(body.vehicle_model,100),membership.number,membership.sequence,membership.year,joinedAt,nowIso(),existing.id),
      c.env.DB.prepare(`UPDATE users SET status='active',deleted_at=NULL,updated_at=? WHERE driver_id=? AND role='driver'`).bind(nowIso(),existing.id)
    ]);
    await audit(c,'reactivate','driver',existing.id,existing,{name,cpf,membership_number:membership.number},cooperativeId);
    return c.json({ok:true,item:{...existing,id:existing.id,name,cpf,status:'active',membership_number:membership.number,membership_sequence:membership.sequence,membership_year:membership.year,joined_at:existing.joined_at||joinedAt,restored:true}},200);
  }

  const driver = { id:id(), cooperative_id:cooperativeId, name, cpf, email:nullableText(body.email,200), phone:nullableText(body.phone,40), vehicle_plate:nullableText(body.vehicle_plate,20), vehicle_model:nullableText(body.vehicle_model,100), membership_number:membership.number, membership_sequence:membership.sequence, membership_year:membership.year, joined_at:joinedAt };
  await c.env.DB.prepare(`INSERT INTO drivers (id,cooperative_id,name,cpf,email,phone,vehicle_plate,vehicle_model,membership_number,membership_sequence,membership_year,joined_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...Object.values(driver)).run();
  const establishmentIds = Array.isArray(body.establishment_ids) ? body.establishment_ids.map(String) : [];
  if (establishmentIds.length) await c.env.DB.batch(establishmentIds.map((eid)=>c.env.DB.prepare(`INSERT OR IGNORE INTO driver_establishments (driver_id,establishment_id) SELECT ?,id FROM establishments WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(driver.id,eid,cooperativeId)));
  await audit(c,'create','driver',driver.id,null,driver,cooperativeId);
  return c.json({ok:true,item:driver},201);
});

adminRoutes.put('/drivers/:id', async (c) => {
  const auth = c.get('auth'); assertRole(auth, ['platform_admin','cooperative_admin','dispatcher']);
  const entityId=c.req.param('id'); const before=await c.env.DB.prepare(`SELECT * FROM drivers WHERE id=?`).bind(entityId).first<any>();
  if(!before) return c.json({ok:false,error:'Cooperado não encontrado.'},404);
  if(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id) return c.json({ok:false,error:'Acesso não autorizado.'},403);
  const body=await bodyJson<Record<string,unknown>>(c);
  const joinedAt=cleanText(body.joined_at??before.joined_at??String(before.created_at||brazilToday()).slice(0,10),10);
  const year=Number(joinedAt.slice(0,4))||Number(brazilToday().slice(0,4));
  const requestedMembership=membershipParts(body.membership_number??before.membership_number,year) || await nextMembership(c,before.cooperative_id,joinedAt);
  const duplicate=await c.env.DB.prepare(`SELECT id,name,membership_number FROM drivers WHERE cooperative_id=? AND (membership_number=? OR membership_sequence=?) AND id<>? LIMIT 1`).bind(before.cooperative_id,requestedMembership.number,requestedMembership.sequence,entityId).first<any>();
  if(duplicate)return c.json({ok:false,error:`A sequência ${String(requestedMembership.sequence).padStart(4,'0')} já pertence a ${duplicate.name} (${duplicate.membership_number||'matrícula existente'}).`},409);
  const after={name:cleanText(body.name??before.name,150),cpf:digitsOnly(body.cpf??before.cpf)||null,email:nullableText(body.email??before.email,200),phone:nullableText(body.phone??before.phone,40),vehicle_plate:nullableText(body.vehicle_plate??before.vehicle_plate,20),vehicle_model:nullableText(body.vehicle_model??before.vehicle_model,100),status:cleanText(body.status??before.status,20),membership_number:requestedMembership.number,membership_sequence:requestedMembership.sequence,membership_year:requestedMembership.year,joined_at:joinedAt};
  await c.env.DB.prepare(`UPDATE drivers SET name=?,cpf=?,email=?,phone=?,vehicle_plate=?,vehicle_model=?,status=?,membership_number=?,membership_sequence=?,membership_year=?,joined_at=?,deleted_at=CASE WHEN ?='active' THEN NULL ELSE deleted_at END,left_at=CASE WHEN ?='active' THEN NULL ELSE left_at END,updated_at=? WHERE id=?`).bind(after.name,after.cpf,after.email,after.phone,after.vehicle_plate,after.vehicle_model,after.status,after.membership_number,after.membership_sequence,after.membership_year,after.joined_at,after.status,after.status,nowIso(),entityId).run();
  if(Array.isArray(body.establishment_ids)){
    await c.env.DB.prepare(`DELETE FROM driver_establishments WHERE driver_id=?`).bind(entityId).run();
    const ids=body.establishment_ids.map(String);
    if(ids.length) await c.env.DB.batch(ids.map((eid)=>c.env.DB.prepare(`INSERT OR IGNORE INTO driver_establishments (driver_id,establishment_id) SELECT ?,id FROM establishments WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(entityId,eid,before.cooperative_id)));
  }
  if(after.status==='active')await c.env.DB.prepare(`UPDATE users SET status='active',deleted_at=NULL,updated_at=? WHERE driver_id=? AND role='driver'`).bind(nowIso(),entityId).run();
  await audit(c,'update','driver',entityId,before,after,before.cooperative_id); return c.json({ok:true});
});

adminRoutes.post('/drivers/:id/access', async (c) => saveLinkedAccess(c, 'driver', c.req.param('id')));

adminRoutes.delete('/drivers/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);
  const entity=await c.env.DB.prepare(`SELECT * FROM drivers WHERE id=?`).bind(c.req.param('id')).first<any>();
  if(!entity||(auth.role!=='platform_admin'&&auth.cooperativeId!==entity.cooperative_id)) return c.json({ok:false,error:'Acesso não autorizado.'},403);
  const leftAt=brazilToday();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE drivers SET status='inactive',online=0,left_at=?,deleted_at=NULL,updated_at=? WHERE id=?`).bind(leftAt,nowIso(),c.req.param('id')),
    c.env.DB.prepare(`UPDATE users SET status='inactive',updated_at=? WHERE driver_id=? AND role='driver'`).bind(nowIso(),c.req.param('id')),
    c.env.DB.prepare(`UPDATE waiting_queue SET status='left',left_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting'`).bind(c.req.param('id'))
  ]);
  await audit(c,'deactivate','driver',c.req.param('id'),entity,{status:'inactive',left_at:leftAt,membership_number:entity.membership_number},entity.cooperative_id);
  return c.json({ok:true,message:'Cooperado inativado. Histórico e matrícula preservados.'});
});

adminRoutes.get('/users/attendant-bases', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);
  const cooperativeId=cooperativeScope(auth,c.req.query('cooperative_id'));
  if(!cooperativeId)return c.json({ok:false,error:'Selecione a cooperativa.'},400);
  return c.json({ok:true,items:await activeAttendantBases(c,cooperativeId)});
});

adminRoutes.get('/users', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);
  const coop=cooperativeScope(auth,c.req.query('cooperative_id'));let sql=`SELECT u.id,u.name,u.email,u.username,u.role,u.status,u.cooperative_id,u.establishment_id,u.driver_id,u.last_login_at,u.created_at,c.name cooperative_name,e.name establishment_name,d.name driver_name,
    (SELECT ba.base_id FROM base_attendants ba WHERE ba.user_id=u.id AND ba.active=1 ORDER BY ba.created_at LIMIT 1) base_id,
    (SELECT GROUP_CONCAT(b.name, ', ') FROM base_attendants ba JOIN bases b ON b.id=ba.base_id WHERE ba.user_id=u.id AND ba.active=1 AND b.deleted_at IS NULL) base_name
    FROM users u LEFT JOIN cooperatives c ON c.id=u.cooperative_id LEFT JOIN establishments e ON e.id=u.establishment_id LEFT JOIN drivers d ON d.id=u.driver_id WHERE u.deleted_at IS NULL`;const params:unknown[]=[];
  if(coop){sql+=` AND u.cooperative_id=?`;params.push(coop);} sql+=` ORDER BY u.name`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});
});

adminRoutes.post('/users', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const body=await bodyJson<Record<string,unknown>>(c);
  const role=cleanText(body.role,30) as Role;if(!['cooperative_admin','dispatcher','establishment','driver'].includes(role)) return c.json({ok:false,error:'Perfil inválido. O Administrador Master é único e somente pode ser criado pelo instalador.'},400);
  const cooperativeId=cooperativeScope(auth,cleanText(body.cooperative_id,100));if(!cooperativeId)return c.json({ok:false,error:'Selecione a cooperativa.'},400);
  const name=cleanText(body.name,150),email=cleanText(body.email,200).toLowerCase(),username=nullableText(body.username,100),password=String(body.password??'');
  if(!name||!email||password.length<8)return c.json({ok:false,error:'Informe nome, e-mail e senha com pelo menos 8 caracteres.'},400);
  const establishmentId=role==='establishment'?cleanText(body.establishment_id,100):null;const driverId=role==='driver'?cleanText(body.driver_id,100):null;const baseId=role==='dispatcher'?await resolveAttendantBase(c,cooperativeId,body.base_id):null;
  if(role==='establishment'&&!establishmentId)return c.json({ok:false,error:'Vincule o estabelecimento.'},400);if(role==='driver'&&!driverId)return c.json({ok:false,error:'Vincule o cooperado.'},400);
  if(establishmentId){const linked=await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(establishmentId).first<{cooperative_id:string}>();if(!linked||linked.cooperative_id!==cooperativeId)return c.json({ok:false,error:'O estabelecimento não pertence à cooperativa selecionada.'},400);}
  if(driverId){const linked=await c.env.DB.prepare(`SELECT cooperative_id FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(driverId).first<{cooperative_id:string}>();if(!linked||linked.cooperative_id!==cooperativeId)return c.json({ok:false,error:'O cooperado não pertence à cooperativa selecionada.'},400);}
  const hashed=await hashPassword(password);const userId=id();
  const statements=[c.env.DB.prepare(`INSERT INTO users (id,cooperative_id,establishment_id,driver_id,name,email,username,password_hash,password_salt,role) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(userId,cooperativeId,establishmentId,driverId,name,email,username,hashed.hash,hashed.salt,role)];
  if(role==='dispatcher'&&baseId)statements.push(c.env.DB.prepare(`INSERT INTO base_attendants(id,cooperative_id,base_id,user_id,active,created_by) VALUES (?,?,?,?,1,?)`).bind(id(),cooperativeId,baseId,userId,auth.id));
  try{await c.env.DB.batch(statements);}
  catch(error){return c.json({ok:false,error:'E-mail ou usuário já cadastrado.'},409);}
  await audit(c,'create','user',userId,null,{name,email,username,role,cooperativeId,establishmentId,driverId,baseId},cooperativeId);return c.json({ok:true,id:userId},201);
});

adminRoutes.put('/users/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const entityId=c.req.param('id');const before=await c.env.DB.prepare(`SELECT * FROM users WHERE id=? AND deleted_at IS NULL`).bind(entityId).first<any>();
  if(!before)return c.json({ok:false,error:'Usuário não encontrado.'},404);if(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id)return c.json({ok:false,error:'Acesso não autorizado.'},403);
  if(before.role==='platform_admin'&&auth.id!==entityId)return c.json({ok:false,error:'O Administrador Master somente pode alterar o próprio acesso.'},403);
  const body=await bodyJson<Record<string,unknown>>(c);const requestedRole=cleanText(body.role??before.role,30) as Role;
  const role:Role=before.role==='platform_admin'?'platform_admin':requestedRole;
  if(before.role!=='platform_admin'&&!['cooperative_admin','dispatcher','establishment','driver'].includes(role))return c.json({ok:false,error:'Perfil inválido.'},400);
  const currentBase=await c.env.DB.prepare(`SELECT base_id FROM base_attendants WHERE user_id=? AND active=1 ORDER BY created_at LIMIT 1`).bind(entityId).first<{base_id:string}>();
  const baseId=role==='dispatcher'?await resolveAttendantBase(c,before.cooperative_id,body.base_id??currentBase?.base_id):null;
  const after={name:cleanText(body.name??before.name,150),email:cleanText(body.email??before.email,200).toLowerCase(),username:nullableText(body.username??before.username,100),role,status:cleanText(body.status??before.status,20),establishment_id:role==='establishment'?nullableText(body.establishment_id??before.establishment_id,100):null,driver_id:role==='driver'?nullableText(body.driver_id??before.driver_id,100):null,base_id:baseId};
  if(after.establishment_id){const linked=await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(after.establishment_id).first<{cooperative_id:string}>();if(!linked||linked.cooperative_id!==before.cooperative_id)return c.json({ok:false,error:'O estabelecimento não pertence à cooperativa do usuário.'},400);}
  if(after.driver_id){const linked=await c.env.DB.prepare(`SELECT cooperative_id FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(after.driver_id).first<{cooperative_id:string}>();if(!linked||linked.cooperative_id!==before.cooperative_id)return c.json({ok:false,error:'O cooperado não pertence à cooperativa do usuário.'},400);}
  const statements=[c.env.DB.prepare(`UPDATE users SET name=?,email=?,username=?,role=?,status=?,establishment_id=?,driver_id=?,updated_at=? WHERE id=?`).bind(after.name,after.email,after.username,after.role,after.status,after.establishment_id,after.driver_id,nowIso(),entityId)];
  statements.push(c.env.DB.prepare(`UPDATE base_attendants SET active=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=?`).bind(entityId));
  if(role==='dispatcher'&&baseId&&after.status==='active')statements.push(c.env.DB.prepare(`INSERT INTO base_attendants(id,cooperative_id,base_id,user_id,active,created_by) VALUES (?,?,?,?,1,?) ON CONFLICT(base_id,user_id) DO UPDATE SET active=1,updated_at=CURRENT_TIMESTAMP`).bind(id(),before.cooperative_id,baseId,entityId,auth.id));
  if(body.password){const password=String(body.password);if(password.length<8)return c.json({ok:false,error:'A senha deve ter pelo menos 8 caracteres.'},400);const hashed=await hashPassword(password);statements.push(c.env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?`).bind(hashed.hash,hashed.salt,nowIso(),entityId));}
  try{await c.env.DB.batch(statements);}catch{return c.json({ok:false,error:'E-mail ou usuário já utilizado.'},409);}
  await audit(c,'update','user',entityId,before,after,before.cooperative_id);return c.json({ok:true});
});

adminRoutes.delete('/users/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);if(auth.id===c.req.param('id'))return c.json({ok:false,error:'Você não pode excluir o próprio acesso.'},400);
  const entity=await c.env.DB.prepare(`SELECT cooperative_id,role FROM users WHERE id=?`).bind(c.req.param('id')).first<{cooperative_id:string|null;role:Role}>();if(!entity||(auth.role!=='platform_admin'&&auth.cooperativeId!==entity.cooperative_id))return c.json({ok:false,error:'Acesso não autorizado.'},403);
  if(entity.role==='platform_admin')return c.json({ok:false,error:'O Administrador Master não pode ser excluído.'},403);
  await c.env.DB.batch([c.env.DB.prepare(`UPDATE users SET status='inactive',deleted_at=?,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),c.req.param('id')),c.env.DB.prepare(`UPDATE base_attendants SET active=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=?`).bind(c.req.param('id'))]);await audit(c,'delete','user',c.req.param('id'),null,null,entity.cooperative_id);return c.json({ok:true});
});
