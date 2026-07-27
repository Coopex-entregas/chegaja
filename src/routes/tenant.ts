import { Hono } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { audit } from '../lib/audit';
import { randomToken } from '../lib/crypto';
import { queueWebhookEvent } from '../lib/webhooks';
import { assertRole, bodyJson, cleanText, cooperativeScope, id, nowIso, nullableText, saoPauloDate, sqlLike, toCents } from '../lib/util';
import { expandJsonRows } from '../lib/rows';
import { deliveryFields } from '../lib/delivery-fields';

export const tenantRoutes = new Hono<AppBindings>();

type AnyRow = Record<string, any>;

function canManage(auth: AuthUser): boolean {
  return ['platform_admin', 'cooperative_admin'].includes(auth.role);
}

function requestedCooperative(auth: AuthUser, requested?: string | null): string | null {
  return cooperativeScope(auth, requested || null);
}

async function assertCooperativeExists(c: any, cooperativeId: string): Promise<boolean> {
  const row = await c.env.DB.prepare(`SELECT id FROM cooperatives WHERE id=? AND status='active' AND deleted_at IS NULL`).bind(cooperativeId).first();
  return Boolean(row);
}

async function scopedContract(c: any, contractId: string): Promise<AnyRow | null> {
  const auth = c.get('auth') as AuthUser;
  let sql = `SELECT ct.*,e.name establishment_name FROM contracts ct LEFT JOIN establishments e ON e.id=ct.establishment_id WHERE ct.id=? AND ct.deleted_at IS NULL`;
  const params: unknown[] = [contractId];
  if (auth.role !== 'platform_admin') { sql += ` AND ct.cooperative_id=?`; params.push(auth.cooperativeId); }
  if (auth.role === 'establishment') { sql += ` AND ct.establishment_id=?`; params.push(auth.establishmentId); }
  return c.env.DB.prepare(sql).bind(...params).first() as any;
}

function dateAdd(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function combineDateTime(date: string, time: string, nextDay = false): string {
  return `${nextDay ? dateAdd(date, 1) : date}T${time}:00`;
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}


type ShiftTemplateTarget = {
  contractId: string | null;
  establishmentId: string | null;
  baseId: string | null;
};

function owns(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

async function normalizeShiftTemplateTarget(
  c: any,
  cooperativeId: string,
  body: Record<string, unknown>,
  before?: AnyRow | null,
): Promise<ShiftTemplateTarget> {
  const targetType = cleanText(body.target_type, 30).toLowerCase();
  const targetId = nullableText(body.target_id, 100);

  let contractId: string | null;
  let establishmentId: string | null;
  let baseId: string | null;

  if (targetType || targetId) {
    if (!targetId || !['contract', 'establishment', 'base'].includes(targetType)) {
      throw new Error('Selecione corretamente um contrato, estabelecimento ou Base.');
    }
    contractId = targetType === 'contract' ? targetId : null;
    establishmentId = targetType === 'establishment' ? targetId : null;
    baseId = targetType === 'base' ? targetId : null;
  } else {
    contractId = owns(body, 'contract_id')
      ? nullableText(body.contract_id, 100)
      : nullableText(before?.contract_id, 100);
    establishmentId = owns(body, 'establishment_id')
      ? nullableText(body.establishment_id, 100)
      : nullableText(before?.establishment_id, 100);
    baseId = owns(body, 'base_id')
      ? nullableText(body.base_id, 100)
      : nullableText(before?.base_id, 100);
  }

  // Compatibilidade com versões antigas do formulário, que podiam enviar dois
  // identificadores para o mesmo local operacional. O sistema transforma o
  // vínculo em um único alvo, sem impedir o cadastro de vários horários.
  if (baseId && (contractId || establishmentId)) {
    const base = await c.env.DB.prepare(`
      SELECT id,virtual_establishment_id
        FROM bases
       WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL
    `).bind(baseId, cooperativeId).first() as AnyRow | null;
    if (!base) throw new Error('Base inválida.');

    let sameBase = true;
    if (establishmentId && String(base.virtual_establishment_id || '') !== String(establishmentId)) {
      sameBase = false;
    }
    if (contractId) {
      const contract = await c.env.DB.prepare(`
        SELECT id,name,establishment_id
          FROM contracts
         WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL
      `).bind(contractId, cooperativeId).first() as AnyRow | null;
      if (
        !contract
        || cleanText(contract.name, 100).toLowerCase() !== 'base'
        || String(contract.establishment_id || '') !== String(base.virtual_establishment_id || '')
      ) {
        sameBase = false;
      }
    }
    if (!sameBase) {
      throw new Error('Escolha somente um contrato, estabelecimento ou Base.');
    }
    contractId = null;
    establishmentId = null;
  }

  if (contractId && establishmentId) {
    const contract = await c.env.DB.prepare(`
      SELECT id,establishment_id
        FROM contracts
       WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL
    `).bind(contractId, cooperativeId).first() as AnyRow | null;
    if (!contract || String(contract.establishment_id || '') !== String(establishmentId)) {
      throw new Error('Escolha somente um contrato, estabelecimento ou Base.');
    }
    // Quando o contrato pertence ao estabelecimento recebido, mantém o
    // contrato como alvo canônico porque é ele que aparece na grade da escala.
    establishmentId = null;
  }

  const selected = [contractId, establishmentId, baseId].filter(Boolean).length;
  if (selected !== 1) {
    throw new Error('Escolha um contrato, estabelecimento ou Base.');
  }

  if (contractId) {
    const contract = await c.env.DB.prepare(`
      SELECT id FROM contracts
       WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL
    `).bind(contractId, cooperativeId).first();
    if (!contract) throw new Error('Contrato inválido.');
  }
  if (establishmentId) {
    const establishment = await c.env.DB.prepare(`
      SELECT id FROM establishments
       WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL
    `).bind(establishmentId, cooperativeId).first();
    if (!establishment) throw new Error('Estabelecimento inválido.');
  }
  if (baseId) {
    const base = await c.env.DB.prepare(`
      SELECT id FROM bases
       WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL
    `).bind(baseId, cooperativeId).first();
    if (!base) throw new Error('Base inválida.');
  }

  return { contractId, establishmentId, baseId };
}

function normalizeWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))];
}

async function contractRuleQuote(c: any, cooperativeId: string, contractId: string | null, neighborhood: string): Promise<AnyRow | null> {
  const normalized = neighborhood.trim();
  if (!normalized) return null;
  let sql = `SELECT r.*,ct.name contract_name FROM contract_price_rules r JOIN contracts ct ON ct.id=r.contract_id WHERE r.cooperative_id=? AND r.active=1 AND ct.active=1 AND ct.deleted_at IS NULL AND lower(trim(r.neighborhood))=lower(trim(?))`;
  const params: unknown[] = [cooperativeId, normalized];
  if (contractId) { sql += ` AND r.contract_id=?`; params.push(contractId); }
  sql += ` ORDER BY CASE WHEN r.fixed_cents>0 THEN 0 ELSE 1 END, r.fixed_cents DESC, r.base_cents DESC LIMIT 1`;
  return c.env.DB.prepare(sql).bind(...params).first() as any;
}

// Contexto e seletor do administrador master
tenantRoutes.get('/tenant-context', async (c) => {
  const auth = c.get('auth');
  if (auth.role === 'platform_admin') {
    const cooperatives = await c.env.DB.prepare(`SELECT id,name,status,primary_color FROM cooperatives WHERE deleted_at IS NULL ORDER BY name`).all();
    return c.json({ ok: true, master: true, cooperatives: cooperatives.results, cooperative_id: c.req.query('cooperative_id') || null });
  }
  const cooperative = auth.cooperativeId
    ? await c.env.DB.prepare(`SELECT id,name,status,primary_color FROM cooperatives WHERE id=? AND deleted_at IS NULL`).bind(auth.cooperativeId).first()
    : null;
  return c.json({ ok: true, master: false, cooperative_id: auth.cooperativeId, cooperatives: cooperative ? [cooperative] : [] });
});

// Contratos
tenantRoutes.get('/contracts', async (c) => {
  const auth = c.get('auth');
  const coop = requestedCooperative(auth, c.req.query('cooperative_id'));
  let sql = `SELECT ct.*,e.name establishment_name,
    (SELECT COUNT(*) FROM contract_price_rules r WHERE r.contract_id=ct.id AND r.active=1) price_count,
    (SELECT COUNT(*) FROM schedules s WHERE s.contract_id=ct.id AND s.deleted_at IS NULL) schedule_count
    FROM contracts ct LEFT JOIN establishments e ON e.id=ct.establishment_id WHERE ct.deleted_at IS NULL`;
  const params: unknown[] = [];
  if (coop) { sql += ` AND ct.cooperative_id=?`; params.push(coop); }
  if (auth.role === 'establishment') { sql += ` AND ct.establishment_id=?`; params.push(auth.establishmentId); }
  const q = cleanText(c.req.query('q'), 100);
  if (q) { sql += ` AND (ct.name LIKE ? OR ct.code LIKE ? OR e.name LIKE ?)`; params.push(sqlLike(q), sqlLike(q), sqlLike(q)); }
  sql += ` ORDER BY ct.active DESC,ct.name`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ ok: true, items: rows.results });
});

tenantRoutes.post('/contracts', async (c) => {
  const auth = c.get('auth'); assertRole(auth, ['platform_admin','cooperative_admin']);
  const body = await bodyJson<Record<string, unknown>>(c);
  const cooperativeId = requestedCooperative(auth, cleanText(body.cooperative_id, 100));
  const name = cleanText(body.name, 150);
  if (!cooperativeId || !name || !(await assertCooperativeExists(c, cooperativeId))) return c.json({ ok:false,error:'Informe a cooperativa e o nome do contrato.' },400);
  const establishmentId = nullableText(body.establishment_id,100);
  if (establishmentId) {
    const establishment = await c.env.DB.prepare(`SELECT cooperative_id,address FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(establishmentId).first() as any;
    if (!establishment || establishment.cooperative_id !== cooperativeId) return c.json({ok:false,error:'O estabelecimento não pertence à cooperativa.'},400);
  }
  const item = { id:id(), cooperative_id:cooperativeId, establishment_id:establishmentId, name, code:nullableText(body.code,50), pickup_address:nullableText(body.pickup_address,500), notes:nullableText(body.notes,1000) };
  try {
    await c.env.DB.prepare(`INSERT INTO contracts (id,cooperative_id,establishment_id,name,code,pickup_address,notes) VALUES (?,?,?,?,?,?,?)`).bind(item.id,item.cooperative_id,item.establishment_id,item.name,item.code,item.pickup_address,item.notes).run();
  } catch { return c.json({ok:false,error:'Já existe um contrato com esse nome na cooperativa.'},409); }
  await audit(c,'create','contract',item.id,null,item,cooperativeId);
  return c.json({ok:true,item},201);
});

tenantRoutes.put('/contracts/:id', async (c) => {
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);
  const before=await scopedContract(c,c.req.param('id'));if(!before)return c.json({ok:false,error:'Contrato não encontrado.'},404);
  const body=await bodyJson<Record<string,unknown>>(c);
  const establishmentId=nullableText(body.establishment_id??before.establishment_id,100);
  if(establishmentId){const e=await c.env.DB.prepare(`SELECT cooperative_id FROM establishments WHERE id=? AND deleted_at IS NULL`).bind(establishmentId).first() as any;if(!e||e.cooperative_id!==before.cooperative_id)return c.json({ok:false,error:'Estabelecimento inválido.'},400);}
  const after={name:cleanText(body.name??before.name,150),code:nullableText(body.code??before.code,50),establishment_id:establishmentId,pickup_address:nullableText(body.pickup_address??before.pickup_address,500),notes:nullableText(body.notes??before.notes,1000),active:body.active===undefined?before.active:(body.active?1:0)};
  await c.env.DB.prepare(`UPDATE contracts SET name=?,code=?,establishment_id=?,pickup_address=?,notes=?,active=?,updated_at=? WHERE id=?`).bind(after.name,after.code,after.establishment_id,after.pickup_address,after.notes,after.active,nowIso(),before.id).run();
  await audit(c,'update','contract',before.id,before,after,before.cooperative_id);return c.json({ok:true});
});

tenantRoutes.delete('/contracts/:id', async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const before=await scopedContract(c,c.req.param('id'));if(!before)return c.json({ok:false,error:'Contrato não encontrado.'},404);await c.env.DB.prepare(`UPDATE contracts SET active=0,deleted_at=?,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),before.id).run();await audit(c,'delete','contract',before.id,before,null,before.cooperative_id);return c.json({ok:true});});

// Tabela simples de contrato: bairro, valor fixo e valor base
tenantRoutes.get('/contract-prices', async(c)=>{
  const auth=c.get('auth');const coop=requestedCooperative(auth,c.req.query('cooperative_id'));
  let sql=`SELECT r.*,ct.name contract_name,ct.establishment_id,e.name establishment_name FROM contract_price_rules r JOIN contracts ct ON ct.id=r.contract_id LEFT JOIN establishments e ON e.id=ct.establishment_id WHERE ct.deleted_at IS NULL`;const params:unknown[]=[];
  if(coop){sql+=` AND r.cooperative_id=?`;params.push(coop);}if(auth.role==='establishment'){sql+=` AND ct.establishment_id=?`;params.push(auth.establishmentId);}if(c.req.query('contract_id')){sql+=` AND r.contract_id=?`;params.push(c.req.query('contract_id'));}sql+=` ORDER BY ct.name,r.neighborhood`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});
});

tenantRoutes.post('/contract-prices',async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const body=await bodyJson<Record<string,unknown>>(c);const contract=await scopedContract(c,cleanText(body.contract_id,100));if(!contract)return c.json({ok:false,error:'Contrato não encontrado.'},404);const neighborhood=cleanText(body.neighborhood,150);if(!neighborhood)return c.json({ok:false,error:'Informe o bairro.'},400);const item={id:id(),cooperative_id:contract.cooperative_id,contract_id:contract.id,neighborhood,fixed_cents:toCents(body.fixed_value),base_cents:toCents(body.base_value),driver_cents:toCents(body.driver_value),cooperative_cents:toCents(body.cooperative_value)};try{await c.env.DB.prepare(`INSERT INTO contract_price_rules (id,cooperative_id,contract_id,neighborhood,fixed_cents,base_cents,driver_cents,cooperative_cents) VALUES (?,?,?,?,?,?,?,?)`).bind(item.id,item.cooperative_id,item.contract_id,item.neighborhood,item.fixed_cents,item.base_cents,item.driver_cents,item.cooperative_cents).run();}catch{return c.json({ok:false,error:'Esse bairro já está cadastrado nesse contrato.'},409);}await audit(c,'create','contract_price',item.id,null,item,contract.cooperative_id);return c.json({ok:true,item},201);});

tenantRoutes.put('/contract-prices/:id',async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const before=await c.env.DB.prepare(`SELECT r.*,ct.cooperative_id contract_cooperative FROM contract_price_rules r JOIN contracts ct ON ct.id=r.contract_id WHERE r.id=?`).bind(c.req.param('id')).first() as any;if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.contract_cooperative))return c.json({ok:false,error:'Valor não encontrado.'},404);const body=await bodyJson<Record<string,unknown>>(c);const after={neighborhood:cleanText(body.neighborhood??before.neighborhood,150),fixed_cents:body.fixed_value!==undefined?toCents(body.fixed_value):before.fixed_cents,base_cents:body.base_value!==undefined?toCents(body.base_value):before.base_cents,driver_cents:body.driver_value!==undefined?toCents(body.driver_value):before.driver_cents,cooperative_cents:body.cooperative_value!==undefined?toCents(body.cooperative_value):before.cooperative_cents,active:body.active===undefined?before.active:(body.active?1:0)};await c.env.DB.prepare(`UPDATE contract_price_rules SET neighborhood=?,fixed_cents=?,base_cents=?,driver_cents=?,cooperative_cents=?,active=?,updated_at=? WHERE id=?`).bind(after.neighborhood,after.fixed_cents,after.base_cents,after.driver_cents,after.cooperative_cents,after.active,nowIso(),before.id).run();await audit(c,'update','contract_price',before.id,before,after,before.contract_cooperative);return c.json({ok:true});});

tenantRoutes.delete('/contract-prices/:id',async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);const before=await c.env.DB.prepare(`SELECT r.*,ct.cooperative_id contract_cooperative FROM contract_price_rules r JOIN contracts ct ON ct.id=r.contract_id WHERE r.id=?`).bind(c.req.param('id')).first() as any;if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.contract_cooperative))return c.json({ok:false,error:'Valor não encontrado.'},404);await c.env.DB.prepare(`DELETE FROM contract_price_rules WHERE id=?`).bind(before.id).run();await audit(c,'delete','contract_price',before.id,before,null,before.contract_cooperative);return c.json({ok:true});});

// Horários fixos
tenantRoutes.get('/shift-templates',async(c)=>{
  const auth=c.get('auth');
  const coop=requestedCooperative(auth,c.req.query('cooperative_id'));
  let sql=`SELECT st.*,ct.name contract_name,ct.establishment_id contract_establishment_id,e.name establishment_name,b.name base_name
    FROM shift_templates st
    LEFT JOIN contracts ct ON ct.id=st.contract_id AND ct.deleted_at IS NULL
    LEFT JOIN establishments e ON e.id=st.establishment_id AND e.deleted_at IS NULL
    LEFT JOIN bases b ON b.id=st.base_id AND b.deleted_at IS NULL
    WHERE st.deleted_at IS NULL`;
  const params:unknown[]=[];
  if(coop){sql+=` AND st.cooperative_id=?`;params.push(coop);}
  if(auth.role==='establishment'){sql+=` AND (st.establishment_id=? OR ct.establishment_id=?)`;params.push(auth.establishmentId,auth.establishmentId);}
  sql+=` ORDER BY COALESCE(b.name,ct.name,e.name,''),st.start_time,st.name`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ok:true,items:rows.results});
});

tenantRoutes.post('/shift-templates',async(c)=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);
  const body=await bodyJson<Record<string,unknown>>(c);
  const cooperativeId=auth.cooperativeId;
  const name=cleanText(body.name,100),start=cleanText(body.start_time,5),end=cleanText(body.end_time,5),label=cleanText(body.shift_label||body.name,100);
  if(!cooperativeId||!name||!validTime(start)||!validTime(end))return c.json({ok:false,error:'Informe nome, início e fim do horário.'},400);
  let target:ShiftTemplateTarget;
  try{target=await normalizeShiftTemplateTarget(c,cooperativeId,body);}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:'Local inválido.'},400);}
  const guaranteedCents=target.baseId?0:Math.max(0,toCents(body.guaranteed_value));
  const item={id:id(),cooperative_id:cooperativeId,name,start_time:start,end_time:end,shift_label:label,contract_id:target.contractId,establishment_id:target.establishmentId,base_id:target.baseId,guaranteed_cents:guaranteedCents};
  await c.env.DB.prepare(`INSERT INTO shift_templates (id,cooperative_id,name,start_time,end_time,shift_label,establishment_id,contract_id,base_id,guaranteed_cents) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(item.id,item.cooperative_id,item.name,item.start_time,item.end_time,item.shift_label,item.establishment_id,item.contract_id,item.base_id,item.guaranteed_cents).run();
  await audit(c,'create','shift_template',item.id,null,item,cooperativeId);return c.json({ok:true,item},201);
});

tenantRoutes.put('/shift-templates/:id',async(c)=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);
  const before=await c.env.DB.prepare(`SELECT * FROM shift_templates WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first() as any;
  if(!before)return c.json({ok:false,error:'Horário não encontrado.'},404);
  const body=await bodyJson<Record<string,unknown>>(c);
  let target:ShiftTemplateTarget;
  try{target=await normalizeShiftTemplateTarget(c,before.cooperative_id,body,before);}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:'Local inválido.'},400);}
  const after={name:cleanText(body.name??before.name,100),start_time:cleanText(body.start_time??before.start_time,5),end_time:cleanText(body.end_time??before.end_time,5),shift_label:cleanText(body.shift_label??before.shift_label,100),contract_id:target.contractId,establishment_id:target.establishmentId,base_id:target.baseId,guaranteed_cents:target.baseId?0:(body.guaranteed_value===undefined?Math.max(0,Number(before.guaranteed_cents||0)):Math.max(0,toCents(body.guaranteed_value))),active:body.active===undefined?before.active:(body.active?1:0)};
  if(!validTime(after.start_time)||!validTime(after.end_time))return c.json({ok:false,error:'Horário inválido.'},400);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE shift_templates SET name=?,start_time=?,end_time=?,shift_label=?,contract_id=?,establishment_id=?,base_id=?,guaranteed_cents=?,active=?,updated_at=? WHERE id=?`).bind(after.name,after.start_time,after.end_time,after.shift_label,after.contract_id,after.establishment_id,after.base_id,after.guaranteed_cents,after.active,nowIso(),before.id),
    c.env.DB.prepare(`UPDATE schedule_week_rows SET start_time=?,end_time=?,shift_label=?,guaranteed_cents=?,updated_at=CURRENT_TIMESTAMP WHERE shift_template_id=? AND active=1 AND date(week_start)>=date('now','-6 days')`).bind(after.start_time,after.end_time,after.shift_label,after.guaranteed_cents,before.id),
    c.env.DB.prepare(`UPDATE schedule_week_drafts SET start_time=?,end_time=?,shift_label=?,guaranteed_cents=?,updated_at=CURRENT_TIMESTAMP WHERE shift_template_id=? AND date(week_start)>=date('now','-6 days')`).bind(after.start_time,after.end_time,after.shift_label,after.guaranteed_cents,before.id),
    c.env.DB.prepare(`UPDATE schedules SET guaranteed_cents=?,shift_label=?,updated_at=CURRENT_TIMESTAMP WHERE shift_template_id=? AND status IN ('scheduled','confirmed') AND datetime(start_at)>=datetime('now','-3 hours') AND id NOT IN (SELECT schedule_id FROM guarantee_settlements)`).bind(after.guaranteed_cents,after.shift_label,before.id)
  ]);
  await audit(c,'update','shift_template',before.id,before,after,before.cooperative_id);return c.json({ok:true});
});

tenantRoutes.delete('/shift-templates/:id',async(c)=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);
  const before=await c.env.DB.prepare(`SELECT * FROM shift_templates WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first() as any;
  if(!before)return c.json({ok:false,error:'Horário não encontrado.'},404);
  await c.env.DB.prepare(`UPDATE shift_templates SET active=0,deleted_at=?,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),before.id).run();
  await audit(c,'delete','shift_template',before.id,before,null,before.cooperative_id);return c.json({ok:true});
});

// Planejador de escala com contagem por contrato e alerta de conflito
tenantRoutes.get('/schedule-planner',async(c)=>{
  const auth=c.get('auth');const from=cleanText(c.req.query('from')||saoPauloDate(),10);const to=cleanText(c.req.query('to')||dateAdd(from,35),10);
  let sql=`SELECT s.*,d.name driver_name,ct.name contract_name,e.name establishment_name,st.name shift_template_name FROM schedules s JOIN drivers d ON d.id=s.driver_id LEFT JOIN contracts ct ON ct.id=s.contract_id LEFT JOIN establishments e ON e.id=s.establishment_id LEFT JOIN shift_templates st ON st.id=s.shift_template_id WHERE s.deleted_at IS NULL AND date(s.start_at)>=date(?) AND date(s.start_at)<=date(?)`;const params:unknown[]=[from,to];
  if(auth.role!=='platform_admin'){sql+=` AND s.cooperative_id=?`;params.push(auth.cooperativeId);}else if(c.req.query('cooperative_id')){sql+=` AND s.cooperative_id=?`;params.push(c.req.query('cooperative_id'));}
  if(auth.role==='driver'){sql+=` AND s.driver_id=?`;params.push(auth.driverId);}if(auth.role==='establishment'){sql+=` AND s.establishment_id=?`;params.push(auth.establishmentId);}if(c.req.query('driver_id')){sql+=` AND s.driver_id=?`;params.push(c.req.query('driver_id'));}if(c.req.query('contract_id')){sql+=` AND s.contract_id=?`;params.push(c.req.query('contract_id'));}sql+=` ORDER BY s.start_at,d.name`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all<AnyRow>();
  const summary=new Map<string,{driver_id:string;driver_name:string;contract_id:string|null;contract_name:string;count:number}>();
  for(const row of rows.results){const key=`${row.driver_id}|${row.contract_id||''}`;const current=summary.get(key)||{driver_id:row.driver_id,driver_name:row.driver_name,contract_id:row.contract_id||null,contract_name:row.contract_name||'Sem contrato',count:0};current.count+=1;summary.set(key,current);}
  return c.json({ok:true,items:rows.results,summary:[...summary.values()]});
});

tenantRoutes.post('/schedule-planner',async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher']);const body=await bodyJson<Record<string,unknown>>(c);const cooperativeId=requestedCooperative(auth,cleanText(body.cooperative_id,100));const driverId=cleanText(body.driver_id,100),contractId=nullableText(body.contract_id,100),templateId=nullableText(body.shift_template_id,100);const startDate=cleanText(body.start_date,10),endDate=cleanText(body.end_date||body.start_date,10);let startTime=cleanText(body.start_time,5),endTime=cleanText(body.end_time,5),shiftLabel=cleanText(body.shift_label,100);
  if(!cooperativeId||!driverId||!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate))return c.json({ok:false,error:'Informe cooperado e período da escala.'},400);
  const driver=await c.env.DB.prepare(`SELECT cooperative_id,status FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(driverId).first() as any;if(!driver||driver.cooperative_id!==cooperativeId||driver.status!=='active')return c.json({ok:false,error:'Cooperado inválido para essa cooperativa.'},400);
  let establishmentId: string|null=null;
  if(contractId){const contract=await c.env.DB.prepare(`SELECT cooperative_id,establishment_id FROM contracts WHERE id=? AND deleted_at IS NULL AND active=1`).bind(contractId).first() as any;if(!contract||contract.cooperative_id!==cooperativeId)return c.json({ok:false,error:'Contrato inválido.'},400);establishmentId=contract.establishment_id||null;}
  let templateGuaranteedCents=0;
  if(templateId){const template=await c.env.DB.prepare(`SELECT * FROM shift_templates WHERE id=? AND deleted_at IS NULL AND active=1`).bind(templateId).first() as any;if(!template||template.cooperative_id!==cooperativeId)return c.json({ok:false,error:'Horário fixo inválido.'},400);startTime=template.start_time;endTime=template.end_time;shiftLabel=template.shift_label;templateGuaranteedCents=template.base_id?0:Math.max(0,Number(template.guaranteed_cents||0));}
  if(!validTime(startTime)||!validTime(endTime))return c.json({ok:false,error:'Selecione um horário fixo ou informe início e fim.'},400);
  const weekdays=normalizeWeekdays(body.weekdays);const selectedDays=weekdays.length?weekdays:[new Date(`${startDate}T12:00:00Z`).getUTCDay()];const maxDays=93;const dates:string[]=[];for(let date=startDate,i=0;date<=endDate&&i<maxDays;date=dateAdd(date,1),i+=1){const dow=new Date(`${date}T12:00:00Z`).getUTCDay();if(selectedDays.includes(dow))dates.push(date);}if(!dates.length)return c.json({ok:false,error:'Nenhuma data corresponde aos dias selecionados.'},400);
  const conflicts:AnyRow[]=[];const generated=dates.map((date)=>{const overnight=endTime<=startTime;return{date,start_at:combineDateTime(date,startTime),end_at:combineDateTime(date,endTime,overnight)}});
  for(const item of generated){const conflict=await c.env.DB.prepare(`SELECT s.id,s.start_at,s.end_at,ct.name contract_name FROM schedules s LEFT JOIN contracts ct ON ct.id=s.contract_id WHERE s.driver_id=? AND s.deleted_at IS NULL AND s.status!='cancelled' AND s.start_at<? AND s.end_at>? LIMIT 1`).bind(driverId,item.end_at,item.start_at).first() as any;if(conflict)conflicts.push({...conflict,new_start_at:item.start_at,new_end_at:item.end_at});}
  if(conflicts.length&&!body.allow_conflict)return c.json({ok:false,error:`O cooperado já possui ${conflicts.length} escala(s) no mesmo horário. Você pode confirmar mesmo assim.`,conflict:true,conflicts},409);
  const recurrence=id();const statements=generated.map((item)=>c.env.DB.prepare(`INSERT INTO schedules (id,cooperative_id,establishment_id,driver_id,start_at,end_at,status,guaranteed_cents,notes,recurrence_group_id,created_by,contract_id,shift_template_id,shift_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id(),cooperativeId,establishmentId,driverId,item.start_at,item.end_at,cleanText(body.status||'scheduled',20),templateId?templateGuaranteedCents:Math.max(0,toCents(body.guaranteed_value)),nullableText(body.notes,1000),recurrence,auth.id,contractId,templateId,shiftLabel||null));await c.env.DB.batch(statements);await audit(c,'create','schedule_series',recurrence,null,{driver_id:driverId,contract_id:contractId,dates:generated,conflicts:conflicts.length},cooperativeId);return c.json({ok:true,count:generated.length,conflicts:conflicts.length},201);
});

tenantRoutes.put('/schedule-planner/:id',async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher']);
  const before=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND deleted_at IS NULL`).bind(c.req.param('id')).first<any>();
  if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id))return c.json({ok:false,error:'Escala não encontrada.'},404);
  const body=await bodyJson<Record<string,unknown>>(c);
  const driverId=cleanText(body.driver_id??before.driver_id,100);
  const contractId=nullableText(body.contract_id??before.contract_id,100);
  const templateId=nullableText(body.shift_template_id??before.shift_template_id,100);
  let establishmentId=before.establishment_id,baseId=before.base_id||null;
  if(contractId){const ct=await c.env.DB.prepare(`SELECT cooperative_id,establishment_id FROM contracts WHERE id=? AND deleted_at IS NULL`).bind(contractId).first<any>();if(!ct||ct.cooperative_id!==before.cooperative_id)return c.json({ok:false,error:'Contrato inválido.'},400);establishmentId=ct.establishment_id||null;baseId=null;}
  let startTime=cleanText(body.start_time||String(before.start_at).slice(11,16),5),endTime=cleanText(body.end_time||String(before.end_at).slice(11,16),5),shiftLabel=nullableText(body.shift_label??before.shift_label,100),guaranteedCents=Math.max(0,Number(before.guaranteed_cents||0));
  if(templateId){
    const template=await c.env.DB.prepare(`SELECT * FROM shift_templates WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(templateId,before.cooperative_id).first<any>();
    if(!template)return c.json({ok:false,error:'Horário fixo inválido.'},400);
    startTime=String(template.start_time);endTime=String(template.end_time);shiftLabel=String(template.shift_label||template.name||'TURNO');guaranteedCents=template.base_id?0:Math.max(0,Number(template.guaranteed_cents||0));
    establishmentId=template.establishment_id||establishmentId;baseId=template.base_id||baseId;
  }
  const date=cleanText(body.date||String(before.start_at).slice(0,10),10);
  if(!validTime(startTime)||!validTime(endTime))return c.json({ok:false,error:'Horário inválido.'},400);
  const startAt=combineDateTime(date,startTime),endAt=combineDateTime(date,endTime,endTime<=startTime);
  const conflict=await c.env.DB.prepare(`SELECT id FROM schedules WHERE id<>? AND driver_id=? AND deleted_at IS NULL AND status!='cancelled' AND start_at<? AND end_at>? LIMIT 1`).bind(before.id,driverId,endAt,startAt).first();
  if(conflict&&!body.allow_conflict)return c.json({ok:false,error:'O cooperado já possui outra escala nesse horário.',conflict:true},409);
  const after={driver_id:driverId,contract_id:contractId,establishment_id:establishmentId,base_id:baseId,shift_template_id:templateId,start_at:startAt,end_at:endAt,shift_label:shiftLabel,status:cleanText(body.status??before.status,20),guaranteed_cents:baseId?0:guaranteedCents,notes:nullableText(body.notes??before.notes,1000)};
  await c.env.DB.prepare(`UPDATE schedules SET driver_id=?,contract_id=?,establishment_id=?,base_id=?,shift_template_id=?,start_at=?,end_at=?,shift_label=?,status=?,guaranteed_cents=?,notes=?,updated_at=? WHERE id=?`).bind(after.driver_id,after.contract_id,after.establishment_id,after.base_id,after.shift_template_id,after.start_at,after.end_at,after.shift_label,after.status,after.guaranteed_cents,after.notes,nowIso(),before.id).run();
  await audit(c,'update','schedule',before.id,before,after,before.cooperative_id);return c.json({ok:true,conflict:Boolean(conflict)});
});

tenantRoutes.delete('/schedule-planner/:id',async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher']);const before=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND deleted_at IS NULL`).bind(c.req.param('id')).first() as any;if(!before||(auth.role!=='platform_admin'&&auth.cooperativeId!==before.cooperative_id))return c.json({ok:false,error:'Escala não encontrada.'},404);if(c.req.query('scope')==='series'&&before.recurrence_group_id)await c.env.DB.prepare(`UPDATE schedules SET status='cancelled',deleted_at=?,updated_at=? WHERE recurrence_group_id=?`).bind(nowIso(),nowIso(),before.recurrence_group_id).run();else await c.env.DB.prepare(`UPDATE schedules SET status='cancelled',deleted_at=?,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),before.id).run();await audit(c,'delete','schedule',before.id,before,null,before.cooperative_id);return c.json({ok:true});});

// Cooperados online da própria cooperativa
tenantRoutes.get('/online-drivers',async(c)=>{const auth=c.get('auth');let sql=`SELECT d.id,d.cooperative_id,d.name,d.phone,d.vehicle_plate,d.vehicle_model,d.online,d.last_seen_at,d.current_lat,d.current_lng,d.location_accuracy,d.location_updated_at,c.name cooperative_name FROM drivers d JOIN cooperatives c ON c.id=d.cooperative_id WHERE d.deleted_at IS NULL AND d.status='active'`;const params:unknown[]=[];if(auth.role!=='platform_admin'){sql+=` AND d.cooperative_id=?`;params.push(auth.cooperativeId);}else if(c.req.query('cooperative_id')){sql+=` AND d.cooperative_id=?`;params.push(c.req.query('cooperative_id'));}if(auth.role==='establishment'){sql+=` AND (EXISTS(SELECT 1 FROM driver_establishments de WHERE de.driver_id=d.id AND de.establishment_id=?) OR EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.establishment_id=? AND s.deleted_at IS NULL AND date(s.start_at)>=date('now','-1 day')) OR EXISTS(SELECT 1 FROM deliveries x WHERE x.assigned_driver_id=d.id AND x.establishment_id=? AND x.deleted_at IS NULL AND x.status NOT IN ('delivered','cancelled')))`;params.push(auth.establishmentId,auth.establishmentId,auth.establishmentId);}if(auth.role==='driver'){sql+=` AND d.id=?`;params.push(auth.driverId);}sql+=` ORDER BY d.online DESC,d.name`;const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});});

// Entregas com dados completos por endereço, sem latitude/longitude manual
tenantRoutes.get('/deliveries-v2',async(c)=>{const auth=c.get('auth');let sql=`SELECT ${deliveryFields('d')},json_object('establishment_name',e.name,'driver_name',dr.name,'contract_name',ct.name) related_json FROM deliveries d JOIN establishments e ON e.id=d.establishment_id LEFT JOIN drivers dr ON dr.id=d.assigned_driver_id LEFT JOIN contracts ct ON ct.id=d.contract_id WHERE d.deleted_at IS NULL`;const params:unknown[]=[];if(auth.role!=='platform_admin'){sql+=` AND d.cooperative_id=?`;params.push(auth.cooperativeId);}else if(c.req.query('cooperative_id')){sql+=` AND d.cooperative_id=?`;params.push(c.req.query('cooperative_id'));}if(auth.role==='establishment'){sql+=` AND d.establishment_id=?`;params.push(auth.establishmentId);}if(auth.role==='driver'){sql+=` AND d.assigned_driver_id=?`;params.push(auth.driverId);}if(c.req.query('status')){sql+=` AND d.status=?`;params.push(c.req.query('status'));}if(c.req.query('from')){sql+=` AND date(d.created_at,'-3 hours')>=date(?)`;params.push(c.req.query('from'));}if(c.req.query('to')){sql+=` AND date(d.created_at,'-3 hours')<=date(?)`;params.push(c.req.query('to'));}const q=cleanText(c.req.query('q'),100);if(q){sql+=` AND (d.customer_name LIKE ? OR d.customer_phone LIKE ? OR d.pickup_address LIKE ? OR d.delivery_address LIKE ? OR d.external_id LIKE ?)`;params.push(sqlLike(q),sqlLike(q),sqlLike(q),sqlLike(q),sqlLike(q));}sql+=` ORDER BY d.created_at DESC LIMIT 1000`;const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:expandJsonRows(rows.results as AnyRow[])});});

tenantRoutes.post('/deliveries-v2',async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher','establishment']);const body=await bodyJson<Record<string,unknown>>(c);const establishmentId=auth.role==='establishment'?auth.establishmentId:cleanText(body.establishment_id,100);if(!establishmentId)return c.json({ok:false,error:'Selecione o estabelecimento.'},400);const establishment=await c.env.DB.prepare(`SELECT * FROM establishments WHERE id=? AND deleted_at IS NULL AND active=1`).bind(establishmentId).first() as any;if(!establishment||(auth.role!=='platform_admin'&&auth.cooperativeId!==establishment.cooperative_id))return c.json({ok:false,error:'Estabelecimento inválido.'},403);const contractId=nullableText(body.contract_id,100);let contract:AnyRow|null=null;if(contractId){contract=await c.env.DB.prepare(`SELECT * FROM contracts WHERE id=? AND deleted_at IS NULL AND active=1`).bind(contractId).first() as any;if(!contract||contract.cooperative_id!==establishment.cooperative_id||(contract.establishment_id&&contract.establishment_id!==establishmentId))return c.json({ok:false,error:'Contrato inválido para esse estabelecimento.'},400);}const customerName=cleanText(body.customer_name,150),customerPhone=cleanText(body.customer_phone,50),pickupAddress=cleanText(body.pickup_address||contract?.pickup_address||establishment.address,500),deliveryAddress=cleanText(body.delivery_address,500);if(!customerName||!customerPhone||!pickupAddress||!deliveryAddress)return c.json({ok:false,error:'Informe nome, telefone, endereço de coleta e endereço de entrega.'},400);let chargeCents=toCents(body.charge_value),driverCents=toCents(body.driver_value),cooperativeCents=toCents(body.cooperative_value);const destinationNeighborhood=cleanText(body.delivery_neighborhood,150);if(contractId&&destinationNeighborhood&&chargeCents===0){const rule=await contractRuleQuote(c,establishment.cooperative_id,contractId,destinationNeighborhood);if(rule){chargeCents=Number(rule.fixed_cents||rule.base_cents||0);driverCents=Number(rule.driver_cents||0);cooperativeCents=Number(rule.cooperative_cents||Math.max(0,chargeCents-driverCents));}}const assignedDriverId=nullableText(body.assigned_driver_id,100);if(assignedDriverId){const dr=await c.env.DB.prepare(`SELECT cooperative_id,status FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(assignedDriverId).first() as any;if(!dr||dr.cooperative_id!==establishment.cooperative_id||dr.status!=='active')return c.json({ok:false,error:'Cooperado inválido.'},400);}const delivery={id:id(),cooperative_id:establishment.cooperative_id,establishment_id:establishmentId,contract_id:contractId,external_id:nullableText(body.external_id,150),source:cleanText(body.source||'panel',50),customer_name:customerName,customer_phone:customerPhone,pickup_contact_name:nullableText(body.pickup_contact_name,150),pickup_phone:nullableText(body.pickup_phone,50),pickup_address:pickupAddress,pickup_neighborhood:nullableText(body.pickup_neighborhood,150),recipient_name:nullableText(body.recipient_name,150),recipient_phone:nullableText(body.recipient_phone,50),delivery_address:deliveryAddress,delivery_neighborhood:nullableText(body.delivery_neighborhood,150),item_description:nullableText(body.item_description,500),charge_cents:chargeCents,driver_earnings_cents:driverCents,cooperative_fee_cents:cooperativeCents,payment_method:nullableText(body.payment_method,50),payment_status:cleanText(body.payment_status||'pending',30),notes:nullableText(body.notes,1500),tracking_token:randomToken(24),assigned_driver_id:assignedDriverId,created_by:auth.id};const status=assignedDriverId?'assigned':'new';try{await c.env.DB.prepare(`INSERT INTO deliveries (id,cooperative_id,establishment_id,contract_id,external_id,source,customer_name,customer_phone,pickup_contact_name,pickup_phone,pickup_address,pickup_neighborhood,recipient_name,recipient_phone,delivery_address,delivery_neighborhood,item_description,status,charge_cents,driver_earnings_cents,cooperative_fee_cents,payment_method,payment_status,notes,tracking_token,assigned_driver_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(delivery.id,delivery.cooperative_id,delivery.establishment_id,delivery.contract_id,delivery.external_id,delivery.source,delivery.customer_name,delivery.customer_phone,delivery.pickup_contact_name,delivery.pickup_phone,delivery.pickup_address,delivery.pickup_neighborhood,delivery.recipient_name,delivery.recipient_phone,delivery.delivery_address,delivery.delivery_neighborhood,delivery.item_description,status,delivery.charge_cents,delivery.driver_earnings_cents,delivery.cooperative_fee_cents,delivery.payment_method,delivery.payment_status,delivery.notes,delivery.tracking_token,delivery.assigned_driver_id,delivery.created_by).run();}catch{return c.json({ok:false,error:'Pedido duplicado ou dados inválidos.'},409);}await c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,new_status,changed_by) VALUES (?,?,?,?,?)`).bind(id(),delivery.id,delivery.cooperative_id,status,auth.id).run();await audit(c,'create','delivery',delivery.id,null,delivery,delivery.cooperative_id);c.executionCtx.waitUntil(queueWebhookEvent(c.env,delivery.cooperative_id,delivery.establishment_id,'delivery.created',{...delivery,status}));return c.json({ok:true,item:{...delivery,status,tracking_url:`${new URL(c.req.url).origin}/r/${delivery.tracking_token}`}},201);});

tenantRoutes.put('/deliveries-v2/:id',async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher','establishment']);let sql=`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND deleted_at IS NULL`;const params:unknown[]=[c.req.param('id')];if(auth.role!=='platform_admin'){sql+=` AND cooperative_id=?`;params.push(auth.cooperativeId);}if(auth.role==='establishment'){sql+=` AND establishment_id=?`;params.push(auth.establishmentId);}const before=await c.env.DB.prepare(sql).bind(...params).first() as any;if(!before)return c.json({ok:false,error:'Entrega não encontrada.'},404);if(['delivered','cancelled'].includes(before.status))return c.json({ok:false,error:'Entrega finalizada.'},400);const body=await bodyJson<Record<string,unknown>>(c);const after={customer_name:cleanText(body.customer_name??before.customer_name,150),customer_phone:cleanText(body.customer_phone??before.customer_phone,50),pickup_contact_name:nullableText(body.pickup_contact_name??before.pickup_contact_name,150),pickup_phone:nullableText(body.pickup_phone??before.pickup_phone,50),pickup_address:cleanText(body.pickup_address??before.pickup_address,500),pickup_neighborhood:nullableText(body.pickup_neighborhood??before.pickup_neighborhood,150),recipient_name:nullableText(body.recipient_name??before.recipient_name,150),recipient_phone:nullableText(body.recipient_phone??before.recipient_phone,50),delivery_address:cleanText(body.delivery_address??before.delivery_address,500),delivery_neighborhood:nullableText(body.delivery_neighborhood??before.delivery_neighborhood,150),item_description:nullableText(body.item_description??before.item_description,500),charge_cents:body.charge_value!==undefined?toCents(body.charge_value):before.charge_cents,driver_earnings_cents:body.driver_value!==undefined?toCents(body.driver_value):before.driver_earnings_cents,cooperative_fee_cents:body.cooperative_value!==undefined?toCents(body.cooperative_value):before.cooperative_fee_cents,payment_method:nullableText(body.payment_method??before.payment_method,50),payment_status:cleanText(body.payment_status??before.payment_status,30),notes:nullableText(body.notes??before.notes,1500)};await c.env.DB.prepare(`UPDATE deliveries SET customer_name=?,customer_phone=?,pickup_contact_name=?,pickup_phone=?,pickup_address=?,pickup_neighborhood=?,recipient_name=?,recipient_phone=?,delivery_address=?,delivery_neighborhood=?,item_description=?,charge_cents=?,driver_earnings_cents=?,cooperative_fee_cents=?,payment_method=?,payment_status=?,notes=?,updated_at=? WHERE id=?`).bind(after.customer_name,after.customer_phone,after.pickup_contact_name,after.pickup_phone,after.pickup_address,after.pickup_neighborhood,after.recipient_name,after.recipient_phone,after.delivery_address,after.delivery_neighborhood,after.item_description,after.charge_cents,after.driver_earnings_cents,after.cooperative_fee_cents,after.payment_method,after.payment_status,after.notes,nowIso(),before.id).run();await audit(c,'update','delivery',before.id,before,after,before.cooperative_id);return c.json({ok:true});});

// Solicitações do futuro aplicativo de clientes
tenantRoutes.get('/customer-requests',async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher']);let sql=`SELECT r.*,c.name cooperative_name,d.status delivery_status FROM customer_requests r JOIN cooperatives c ON c.id=r.cooperative_id LEFT JOIN deliveries d ON d.id=r.delivery_id WHERE 1=1`;const params:unknown[]=[];if(auth.role!=='platform_admin'){sql+=` AND r.cooperative_id=?`;params.push(auth.cooperativeId);}else if(c.req.query('cooperative_id')){sql+=` AND r.cooperative_id=?`;params.push(c.req.query('cooperative_id'));}if(c.req.query('status')){sql+=` AND r.status=?`;params.push(c.req.query('status'));}sql+=` ORDER BY r.created_at DESC LIMIT 500`;const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});});

tenantRoutes.post('/customer-requests/:id/convert',async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin','dispatcher']);let sql=`SELECT * FROM customer_requests WHERE id=?`;const params:unknown[]=[c.req.param('id')];if(auth.role!=='platform_admin'){sql+=` AND cooperative_id=?`;params.push(auth.cooperativeId);}const request=await c.env.DB.prepare(sql).bind(...params).first() as any;if(!request)return c.json({ok:false,error:'Solicitação não encontrada.'},404);if(request.delivery_id)return c.json({ok:false,error:'Solicitação já convertida.'},400);const body=await bodyJson<Record<string,unknown>>(c);const establishmentId=cleanText(body.establishment_id,100);const establishment=await c.env.DB.prepare(`SELECT * FROM establishments WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(establishmentId,request.cooperative_id).first() as any;if(!establishment)return c.json({ok:false,error:'Selecione um estabelecimento da cooperativa.'},400);const driverId=nullableText(body.assigned_driver_id,100),contractId=nullableText(body.contract_id,100);const deliveryId=id(),trackingToken=randomToken(24),status=driverId?'assigned':'new';await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO deliveries (id,cooperative_id,establishment_id,contract_id,source,customer_name,customer_phone,pickup_contact_name,pickup_phone,pickup_address,pickup_neighborhood,recipient_name,recipient_phone,delivery_address,delivery_neighborhood,item_description,status,charge_cents,payment_method,payment_status,notes,tracking_token,assigned_driver_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(deliveryId,request.cooperative_id,establishmentId,contractId,'customer_app',request.customer_name,request.customer_phone,request.pickup_contact_name,request.pickup_phone,request.pickup_address,request.pickup_neighborhood,request.recipient_name,request.recipient_phone,request.delivery_address,request.delivery_neighborhood,request.item_description,status,request.quoted_cents,request.payment_method,'pending',request.notes,trackingToken,driverId,auth.id),c.env.DB.prepare(`UPDATE customer_requests SET status='converted',delivery_id=?,updated_at=? WHERE id=?`).bind(deliveryId,nowIso(),request.id),c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,new_status,changed_by) VALUES (?,?,?,?,?)`).bind(id(),deliveryId,request.cooperative_id,status,auth.id)]);await audit(c,'convert','customer_request',request.id,request,{delivery_id:deliveryId},request.cooperative_id);return c.json({ok:true,delivery_id:deliveryId,tracking_url:`${new URL(c.req.url).origin}/r/${trackingToken}`});});
