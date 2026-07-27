import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { audit } from '../lib/audit';
import { hashPassword, randomToken } from '../lib/crypto';
import { geocodeAddress, routeBetween, routePrice, type GeoPoint } from '../lib/maps';
import { assertRole, bodyJson, cleanText, id, nowIso, nullableText, toCents, toNumber } from '../lib/util';
import { queueWebhookEvent } from '../lib/webhooks';
import { distanceMeters } from '../lib/queue';
import { expandJsonRows } from '../lib/rows';
import { deliveryFields } from '../lib/delivery-fields';
import { baseDirectReceivedPayment, baseReceivablePayment, carryoverDescription, cleanFinancialDescription, financialDebitPriority, isDirectReceivedDelivery, isReceivableCredit, reconcileDriverFinancialBalance } from '../lib/financial-settlement';
import { settleDueGuarantees } from '../lib/guarantees';

export const ligerimRoutes = new Hono<AppBindings>();

type AnyRow = Record<string, any>;
const cents = (v: unknown) => Math.max(0, toCents(v));
const num = (v: unknown, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;

function tenantAuth(c: Context<AppBindings>, roles: AuthUser['role'][] = ['cooperative_admin','dispatcher','establishment','driver']): AuthUser {
  const auth = c.get('auth');
  assertRole(auth, roles);
  if (!auth.cooperativeId) throw new Error('Cooperativa não vinculada.');
  return auth;
}

async function nextOrderCode(c: Context<AppBindings>, cooperativeId: string, prefix = 'LG'): Promise<string> {
  const row = await c.env.DB.prepare(`
    INSERT INTO cooperative_sequences (cooperative_id,sequence_name,current_value,updated_at)
    VALUES (?,'delivery',1,CURRENT_TIMESTAMP)
    ON CONFLICT(cooperative_id,sequence_name) DO UPDATE SET current_value=current_value+1,updated_at=CURRENT_TIMESTAMP
    RETURNING current_value
  `).bind(cooperativeId).first<{ current_value: number }>();
  return `${prefix || 'LG'}-${String(row?.current_value || Date.now()).padStart(6,'0')}`;
}

async function getServiceTotal(c: Context<AppBindings>, cooperativeId: string, serviceIds: string[]): Promise<{total:number;items:AnyRow[]}> {
  if (!serviceIds.length) return { total: 0, items: [] };
  const placeholders = serviceIds.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(`SELECT id,name,add_cents FROM services WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL AND id IN (${placeholders})`)
    .bind(cooperativeId, ...serviceIds).all<AnyRow>();
  const items = (rows.results || []) as AnyRow[];
  return { total: items.reduce((sum,x)=>sum+Number(x.add_cents||0),0), items };
}

async function resolveRoute(c: Context<AppBindings>, pickupAddress: string, deliveryAddress: string, pickup?: GeoPoint | null, delivery?: GeoPoint | null) {
  const origin = pickup || await geocodeAddress(c.env, pickupAddress);
  const destination = delivery || await geocodeAddress(c.env, deliveryAddress);
  if (!origin || !destination) throw new Error('Não foi possível localizar um dos endereços. Confira rua, número, bairro, cidade e estado.');
  const route = await routeBetween(c.env, [origin, destination]);
  if (!route) throw new Error('Não foi possível calcular a rota neste momento.');
  return { origin, destination, route };
}

async function calculateDriverValues(c: Context<AppBindings>, cooperativeId: string, chargeCents: number, feePercent: number, deliveryType: 'establishment' | 'base', paymentMethod: unknown) {
  const coop = await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent,cooperative_fee_percent FROM cooperatives WHERE id=?`).bind(cooperativeId).first<AnyRow>();
  const effectiveFee = feePercent >= 0 ? feePercent : Number(coop?.cooperative_fee_percent || 0);
  const cooperativeFee = Math.round(chargeCents * effectiveFee / 100);
  const gross = Math.max(0, chargeCents - cooperativeFee);
  const taxable = deliveryType === 'establishment' || (deliveryType === 'base' && baseReceivablePayment(paymentMethod));
  const inss = taxable ? Math.round(gross * Number(coop?.inss_percent || 0) / 100) : 0;
  const sest = taxable ? Math.round(gross * Number(coop?.sest_senat_percent || 0) / 100) : 0;
  return { cooperativeFee, gross, inss, sest, net: Math.max(0, gross - inss - sest) };
}

async function isDriverOnline(c: Context<AppBindings>, driverId: string): Promise<boolean> {
  const row = await c.env.DB.prepare(`SELECT 1 ok FROM drivers WHERE id=? AND online=1 AND status='active' AND COALESCE(on_leave,0)=0 AND deleted_at IS NULL AND datetime(last_seen_at)>=datetime('now','-10 minutes')`).bind(driverId).first();
  return Boolean(row);
}

async function isDriverEligible(c: Context<AppBindings>, driverId: string, delivery: AnyRow): Promise<boolean> {
  if (!(await isDriverOnline(c, driverId))) return false;
  if (delivery.delivery_type === 'base' && delivery.base_id) {
    const row = await c.env.DB.prepare(`SELECT 1 ok FROM schedules WHERE driver_id=? AND base_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND COALESCE(entry_type,'work')='work' AND date(start_at)=date('now','-3 hours') LIMIT 1`).bind(driverId,delivery.base_id).first();
    return Boolean(row);
  }
  const block=await c.env.DB.prepare(`SELECT 1 ok FROM driver_establishment_blocks WHERE driver_id=? AND establishment_id=? AND active=1 LIMIT 1`).bind(driverId,delivery.establishment_id).first();
  if(block)return false;
  const row = await c.env.DB.prepare(`SELECT 1 ok WHERE EXISTS(
      SELECT 1 FROM schedules s WHERE s.driver_id=? AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work' AND date(s.start_at)=date('now','-3 hours')
    ) OR EXISTS(
      SELECT 1 FROM establishment_driver_permissions p WHERE p.driver_id=? AND p.establishment_id=? AND p.active=1 AND date(p.service_date)=date('now','-3 hours')
    ) LIMIT 1`).bind(driverId,delivery.establishment_id,driverId,delivery.establishment_id).first();
  return Boolean(row);
}

function haversineMeters(a: GeoPoint,b: GeoPoint): number {
  const r=6371000,toRad=(v:number)=>v*Math.PI/180;
  const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*r*Math.asin(Math.sqrt(x));
}

async function createDelivery(c: Context<AppBindings>, options: {
  cooperativeId:string; establishmentId:string; baseId?:string|null; deliveryType:'establishment'|'base'; source:string;
  externalId?:string|null; customerName?:string|null; customerPhone?:string|null; pickupContactName?:string|null; pickupPhone?:string|null;
  pickupAddress:string; pickupNeighborhood?:string|null; recipientName?:string|null; recipientPhone?:string|null;
  deliveryAddress:string; deliveryNeighborhood?:string|null; itemDescription?:string|null; paymentMethod?:string|null; paymentStatus?:string;
  notes?:string|null; chargeCents:number; servicesCents:number; distanceMeters:number; durationSeconds:number; geometry:[number,number][];
  pickup:GeoPoint; destination:GeoPoint; feePercent:number; createdBy?:string|null; status?:string; serviceItems?:AnyRow[]; prefix?:string;
}) {
  const displayCode = await nextOrderCode(c, options.cooperativeId, options.prefix || 'LG');
  const values = await calculateDriverValues(c, options.cooperativeId, options.chargeCents, options.feePercent, options.deliveryType, options.paymentMethod);
  const deliveryId = id();
  const trackingToken = randomToken(24);
  await c.env.DB.prepare(`INSERT INTO deliveries (
    id,cooperative_id,establishment_id,external_id,source,customer_name,customer_phone,pickup_contact_name,pickup_phone,pickup_address,pickup_neighborhood,
    recipient_name,recipient_phone,delivery_address,delivery_neighborhood,item_description,pickup_lat,pickup_lng,delivery_lat,delivery_lng,status,
    charge_cents,driver_earnings_cents,cooperative_fee_cents,payment_method,payment_status,notes,tracking_token,created_by,display_code,delivery_type,base_id,
    distance_meters,duration_seconds,route_geometry,driver_gross_cents,driver_net_cents,services_cents
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    deliveryId,options.cooperativeId,options.establishmentId,options.externalId||null,options.source,options.customerName||null,options.customerPhone||null,
    options.pickupContactName||null,options.pickupPhone||null,options.pickupAddress,options.pickupNeighborhood||null,options.recipientName||null,
    options.recipientPhone||null,options.deliveryAddress,options.deliveryNeighborhood||null,options.itemDescription||null,options.pickup.lat,options.pickup.lng,
    options.destination.lat,options.destination.lng,options.status||'new',options.chargeCents,values.gross,values.cooperativeFee,options.paymentMethod||null,
    options.paymentStatus||'pending',options.notes||null,trackingToken,options.createdBy||null,displayCode,options.deliveryType,options.baseId||null,
    options.distanceMeters,options.durationSeconds,JSON.stringify(options.geometry),values.gross,values.net,options.servicesCents
  ).run();
  if (options.serviceItems?.length) {
    await c.env.DB.batch(options.serviceItems.map((s)=>c.env.DB.prepare(`INSERT INTO delivery_services (delivery_id,service_id,service_name,add_cents) VALUES (?,?,?,?)`).bind(deliveryId,s.id,s.name,s.add_cents)));
  }
  await c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,new_status,notes,changed_by) VALUES (?,?,?,?,?,?)`)
    .bind(id(),deliveryId,options.cooperativeId,options.status||'new','Pedido criado no ChegaJá',options.createdBy||null).run();
  return { id:deliveryId, display_code:displayCode, tracking_token:trackingToken, tracking_url:`${c.env.APP_URL.replace(/\/$/,'')}/r/${trackingToken}`, values };
}

// PLATAFORMA MASTER
ligerimRoutes.get('/platform/overview', async (c) => {
  const auth=c.get('auth'); assertRole(auth,['platform_admin']);
  const from=cleanText(c.req.query('from')||`${saoPauloDate().slice(0,7)}-01`,10);
  const to=cleanText(c.req.query('to')||saoPauloDate(),10);
  const selected=nullableText(c.req.query('cooperative_id'),100);
  let where=`c.deleted_at IS NULL`; const params:any[]=[];
  if(selected){where+=` AND c.id=?`;params.push(selected);}
  const rows=await c.env.DB.prepare(`SELECT c.id,c.name,c.status,c.cnpj,c.email,c.phone,
    (SELECT COUNT(*) FROM drivers d WHERE d.cooperative_id=c.id AND d.deleted_at IS NULL) drivers_total,
    (SELECT COUNT(*) FROM drivers d WHERE d.cooperative_id=c.id AND d.deleted_at IS NULL AND d.status='active') drivers_active,
    (SELECT COUNT(*) FROM establishments e WHERE e.cooperative_id=c.id AND e.deleted_at IS NULL AND e.active=1) establishments_active,
    (SELECT COUNT(*) FROM deliveries x WHERE x.cooperative_id=c.id AND x.deleted_at IS NULL AND date(x.created_at,'-3 hours') BETWEEN date(?) AND date(?)) deliveries_period,
    (SELECT COALESCE(SUM(x.cooperative_fee_cents),0) FROM deliveries x WHERE x.cooperative_id=c.id AND x.deleted_at IS NULL AND x.status='delivered' AND date(x.delivered_at,'-3 hours') BETWEEN date(?) AND date(?)) revenue_cents,
    (SELECT COALESCE(SUM(x.amount_cents),0) FROM cooperative_expenses x WHERE x.cooperative_id=c.id AND x.deleted_at IS NULL AND x.status='active' AND date(x.reference_date) BETWEEN date(?) AND date(?)) expenses_cents,
    (SELECT COALESCE(SUM(x.charge_cents),0) FROM deliveries x WHERE x.cooperative_id=c.id AND x.deleted_at IS NULL AND x.status='delivered' AND date(x.delivered_at,'-3 hours') BETWEEN date(?) AND date(?)) volume_cents
    FROM cooperatives c WHERE ${where} ORDER BY c.name`).bind(from,to,from,to,from,to,from,to,...params).all<AnyRow>();
  const items:AnyRow[]=(rows.results||[]).map((x:AnyRow):AnyRow=>({...x,profit_cents:Number(x.revenue_cents||0)-Number(x.expenses_cents||0)}));
  return c.json({ok:true,from,to,items,totals:{cooperatives:items.length,drivers:items.reduce((s,x)=>s+Number(x.drivers_total||0),0),active:items.reduce((s,x)=>s+Number(x.drivers_active||0),0),revenue_cents:items.reduce((s,x)=>s+Number(x.revenue_cents||0),0),expenses_cents:items.reduce((s,x)=>s+Number(x.expenses_cents||0),0),profit_cents:items.reduce((s,x)=>s+Number(x.profit_cents||0),0),volume_cents:items.reduce((s,x)=>s+Number(x.volume_cents||0),0)}});
});

ligerimRoutes.get('/platform/cooperatives', async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin']);const rows=await c.env.DB.prepare(`SELECT c.*,(SELECT name FROM users u WHERE u.cooperative_id=c.id AND u.role='cooperative_admin' AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1) admin_name,(SELECT email FROM users u WHERE u.cooperative_id=c.id AND u.role='cooperative_admin' AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1) admin_email FROM cooperatives c WHERE c.deleted_at IS NULL ORDER BY c.name`).all();return c.json({ok:true,items:rows.results});});

ligerimRoutes.post('/platform/cooperatives', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin']);const b=await bodyJson<AnyRow>(c);
  const name=cleanText(b.name,150),adminName=cleanText(b.admin_name,150),adminEmail=cleanText(b.admin_email,200).toLowerCase(),password=String(b.admin_password||'');
  if(!name||!adminName||!adminEmail||password.length<8)return c.json({ok:false,error:'Informe a cooperativa e o administrador com senha de pelo menos 8 caracteres.'},400);
  const cooperativeId=id(),userId=id(),hashed=await hashPassword(password);
  try{await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO cooperatives (id,name,legal_name,cnpj,email,phone,address,status,inss_percent,sest_senat_percent,default_minimum_cents,default_km_cents,cooperative_fee_percent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(cooperativeId,name,nullableText(b.legal_name,200),nullableText(b.cnpj,30),nullableText(b.email,200),nullableText(b.phone,50),nullableText(b.address,500),cleanText(b.status||'active',20),num(b.inss_percent,4),num(b.sest_senat_percent,.5),cents(b.default_minimum||12),cents(b.default_km||2.5),num(b.cooperative_fee_percent,0)),
    c.env.DB.prepare(`INSERT INTO users (id,cooperative_id,name,email,password_hash,password_salt,role,status) VALUES (?,?,?,?,?,?,'cooperative_admin','active')`).bind(userId,cooperativeId,adminName,adminEmail,hashed.hash,hashed.salt)
  ]);}catch{return c.json({ok:false,error:'CNPJ ou e-mail já cadastrado.'},409);}
  await audit(c,'create','cooperative',cooperativeId,null,{name,adminEmail},cooperativeId);
  return c.json({ok:true,id:cooperativeId,admin_login:adminEmail,institutional_login:nullableText(b.email,200)},201);
});

ligerimRoutes.put('/platform/cooperatives/:id', async(c)=>{
  const auth=c.get('auth');assertRole(auth,['platform_admin']);
  const b=await bodyJson<AnyRow>(c);
  const before=await c.env.DB.prepare(`SELECT * FROM cooperatives WHERE id=? AND deleted_at IS NULL`).bind(c.req.param('id')).first<AnyRow>();
  if(!before)return c.json({ok:false,error:'Cooperativa não encontrada.'},404);
  const admin=await c.env.DB.prepare(`SELECT * FROM users WHERE cooperative_id=? AND role='cooperative_admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`).bind(before.id).first<AnyRow>();
  const statements=[
    c.env.DB.prepare(`UPDATE cooperatives SET name=?,legal_name=?,cnpj=?,email=?,phone=?,address=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
      cleanText(b.name??before.name,150),nullableText(b.legal_name??before.legal_name,200),nullableText(b.cnpj??before.cnpj,30),nullableText(b.email??before.email,200),nullableText(b.phone??before.phone,50),nullableText(b.address??before.address,500),cleanText(b.status??before.status,20),before.id
    )
  ];
  if(admin){
    const adminName=cleanText(b.admin_name??admin.name,150);
    const adminEmail=cleanText(b.admin_email??admin.email,200).toLowerCase();
    const newPassword=String(b.admin_password||'');
    if(!adminName||!adminEmail)return c.json({ok:false,error:'Informe o nome e o e-mail do administrador.'},400);
    if(newPassword && newPassword.length<8)return c.json({ok:false,error:'A nova senha precisa ter pelo menos 8 caracteres.'},400);
    if(newPassword){
      const hashed=await hashPassword(newPassword);
      statements.push(c.env.DB.prepare(`UPDATE users SET name=?,email=?,password_hash=?,password_salt=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(adminName,adminEmail,hashed.hash,hashed.salt,admin.id));
    }else{
      statements.push(c.env.DB.prepare(`UPDATE users SET name=?,email=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(adminName,adminEmail,admin.id));
    }
  }
  try{await c.env.DB.batch(statements);}catch{return c.json({ok:false,error:'CNPJ ou e-mail já cadastrado.'},409);}
  await audit(c,'update','cooperative',before.id,before,b,before.id);
  return c.json({ok:true,admin_login:cleanText(b.admin_email??admin?.email,200).toLowerCase()});
});

ligerimRoutes.get('/platform/audit',async(c)=>{const auth=c.get('auth');assertRole(auth,['platform_admin']);const coop=nullableText(c.req.query('cooperative_id'),100);let sql=`SELECT a.*,u.name user_name,c.name cooperative_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN cooperatives c ON c.id=a.cooperative_id WHERE 1=1`;const p:any[]=[];if(coop){sql+=` AND a.cooperative_id=?`;p.push(coop);}sql+=` ORDER BY a.created_at DESC LIMIT 1000`;const rows=await c.env.DB.prepare(sql).bind(...p).all();return c.json({ok:true,items:rows.results});});

// CONTEXTO E DASHBOARD DA COOPERATIVA
ligerimRoutes.get('/tenant/overview',async(c)=>{const auth=tenantAuth(c,['cooperative_admin','dispatcher','establishment','driver']);
  if(auth.role==='establishment'){
    const d=await c.env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM deliveries WHERE establishment_id=? AND deleted_at IS NULL AND date(created_at,'-3 hours')=date('now','-3 hours')) deliveries_today,
      (SELECT COUNT(*) FROM deliveries WHERE establishment_id=? AND deleted_at IS NULL AND status NOT IN ('delivered','cancelled')) active,
      (
        (SELECT COALESCE(SUM(charge_cents),0) FROM deliveries WHERE establishment_id=? AND status='delivered' AND deleted_at IS NULL AND strftime('%Y-%m',delivered_at,'-3 hours')=strftime('%Y-%m','now','-3 hours'))
        +
        (SELECT COALESCE(SUM(f.amount_cents),0)
           FROM financial_entries f
           JOIN guarantee_settlement_financial_entries l ON l.financial_entry_id=f.id AND l.entry_kind='complement'
          WHERE f.establishment_id=? AND f.entry_type='credit' AND f.status!='cancelled' AND f.deleted_at IS NULL
            AND strftime('%Y-%m',f.reference_date)=strftime('%Y-%m','now','-3 hours'))
      ) month_cents`).bind(auth.establishmentId,auth.establishmentId,auth.establishmentId,auth.establishmentId).first();
    return c.json({ok:true,data:d});
  }
  if(auth.role==='driver'){
    const d=await c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM deliveries WHERE assigned_driver_id=? AND deleted_at IS NULL AND status NOT IN ('delivered','cancelled')) active,(SELECT COUNT(*) FROM deliveries WHERE assigned_driver_id=? AND date(created_at,'-3 hours')=date('now','-3 hours')) deliveries_today,(SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount_cents ELSE -amount_cents END),0) FROM financial_entries WHERE driver_id=? AND status='open' AND deleted_at IS NULL) available_cents,(SELECT COUNT(*) FROM schedules WHERE driver_id=? AND date(start_at) BETWEEN date('now','-3 hours') AND date('now','-3 hours','+7 days') AND deleted_at IS NULL) schedules_week`).bind(auth.driverId,auth.driverId,auth.driverId,auth.driverId).first();return c.json({ok:true,data:d});
  }
  const coop=auth.cooperativeId!;
  const d=await c.env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM drivers WHERE cooperative_id=? AND status='active' AND deleted_at IS NULL) drivers_active,
    (SELECT COUNT(*) FROM drivers WHERE cooperative_id=? AND online=1 AND datetime(last_seen_at)>=datetime('now','-10 minutes') AND deleted_at IS NULL) drivers_online,
    (SELECT COUNT(*) FROM establishments WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL) establishments,
    (SELECT COUNT(*) FROM deliveries WHERE cooperative_id=? AND date(created_at,'-3 hours')=date('now','-3 hours') AND deleted_at IS NULL) deliveries_today,
    (SELECT COUNT(*) FROM deliveries WHERE cooperative_id=? AND status NOT IN ('delivered','cancelled') AND deleted_at IS NULL) active_deliveries,
    (SELECT COALESCE(SUM(cooperative_fee_cents),0) FROM deliveries WHERE cooperative_id=? AND status='delivered' AND strftime('%Y-%m',delivered_at,'-3 hours')=strftime('%Y-%m','now','-3 hours')) month_profit_cents,
    (
      (SELECT COALESCE(SUM(charge_cents),0) FROM deliveries WHERE cooperative_id=? AND status='delivered' AND deleted_at IS NULL AND strftime('%Y-%m',delivered_at,'-3 hours')=strftime('%Y-%m','now','-3 hours'))
      +
      (SELECT COALESCE(SUM(f.amount_cents),0)
         FROM financial_entries f
         JOIN guarantee_settlement_financial_entries l ON l.financial_entry_id=f.id AND l.entry_kind='complement'
        WHERE f.cooperative_id=? AND f.entry_type='credit' AND f.status!='cancelled' AND f.deleted_at IS NULL
          AND strftime('%Y-%m',f.reference_date)=strftime('%Y-%m','now','-3 hours'))
    ) month_volume_cents`).bind(coop,coop,coop,coop,coop,coop,coop,coop).first();
  return c.json({ok:true,data:d});
});

ligerimRoutes.get('/tenant/settings',async(c)=>{const auth=tenantAuth(c,['cooperative_admin']);const item=await c.env.DB.prepare(`SELECT * FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first();return c.json({ok:true,item});});
ligerimRoutes.put('/tenant/settings',async(c)=>{const auth=tenantAuth(c,['cooperative_admin']);const b=await bodyJson<AnyRow>(c);await c.env.DB.prepare(`UPDATE cooperatives SET name=?,email=?,phone=?,address=?,logo_url=?,primary_color=?,login_title=?,login_subtitle=?,login_footer_text=?,inss_percent=?,sest_senat_percent=?,default_minimum_cents=?,default_km_cents=?,cooperative_fee_percent=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(cleanText(b.name,150),nullableText(b.email,200),nullableText(b.phone,50),nullableText(b.address,500),nullableText(b.logo_url,500),cleanText(b.primary_color||'#0D257A',20),nullableText(b.login_title,180),nullableText(b.login_subtitle,300),nullableText(b.login_footer_text,220),num(b.inss_percent,4),num(b.sest_senat_percent,.5),cents(b.default_minimum),cents(b.default_km),num(b.cooperative_fee_percent,0),auth.cooperativeId).run();await audit(c,'update','cooperative_settings',auth.cooperativeId!,null,b,auth.cooperativeId);return c.json({ok:true});});

// BASES E SERVIÇOS
ligerimRoutes.get('/tenant/bases',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher','driver']);
  let sql=`SELECT b.*,(SELECT COUNT(*) FROM schedules s WHERE s.base_id=b.id AND s.deleted_at IS NULL AND date(s.start_at)=date('now','-3 hours')) scheduled_today FROM bases b WHERE b.cooperative_id=? AND b.deleted_at IS NULL`;
  const params:any[]=[auth.cooperativeId];
  if(auth.role==='dispatcher'){
    const linkedCount=await c.env.DB.prepare(`SELECT COUNT(*) total FROM base_attendants WHERE cooperative_id=? AND active=1`).bind(auth.cooperativeId).first<AnyRow>();
    if(Number(linkedCount?.total||0)>0){sql+=` AND EXISTS(SELECT 1 FROM base_attendants a WHERE a.base_id=b.id AND a.user_id=? AND a.active=1)`;params.push(auth.id);}
  }
  sql+=` ORDER BY b.name`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ok:true,items:rows.results});
});
ligerimRoutes.post('/tenant/bases',async(c)=>{const auth=tenantAuth(c,['cooperative_admin']);const b=await bodyJson<AnyRow>(c);const name=cleanText(b.name,150),address=cleanText(b.address,500);if(!name||!address)return c.json({ok:false,error:'Informe nome e endereço da base.'},400);const geo=await geocodeAddress(c.env,address);if(!geo)return c.json({ok:false,error:'Endereço da base não localizado.'},400);const baseId=id(),estId=id(),token=randomToken(24);await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO establishments (id,cooperative_id,name,address,latitude,longitude,checkin_token,active,rate_per_km_cents,minimum_fee_cents,cooperative_fee_percent,order_prefix) VALUES (?,?,?,?,?,?,?,1,?,?,?,'BASE')`).bind(estId,auth.cooperativeId,`Base — ${name}`,address,geo.lat,geo.lng,randomToken(24),cents(b.rate_per_km||2.5),cents(b.minimum_fee||12),num(b.cooperative_fee_percent,0)),c.env.DB.prepare(`INSERT INTO bases (id,cooperative_id,name,address,city,state,postal_code,latitude,longitude,minimum_fee_cents,rate_per_km_cents,cooperative_fee_percent,qr_token,virtual_establishment_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(baseId,auth.cooperativeId,name,address,nullableText(b.city,100),nullableText(b.state,50),nullableText(b.postal_code,20),geo.lat,geo.lng,cents(b.minimum_fee||12),cents(b.rate_per_km||2.5),num(b.cooperative_fee_percent,0),token,estId)]);await audit(c,'create','base',baseId,null,{name,address},auth.cooperativeId);return c.json({ok:true,id:baseId},201);});
ligerimRoutes.put('/tenant/bases/:id',async(c)=>{const auth=tenantAuth(c,['cooperative_admin']);const before=await c.env.DB.prepare(`SELECT * FROM bases WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();if(!before)return c.json({ok:false,error:'Base não encontrada.'},404);const b=await bodyJson<AnyRow>(c),address=cleanText(b.address??before.address,500);let lat=before.latitude,lng=before.longitude;if(address!==before.address){const geo=await geocodeAddress(c.env,address);if(!geo)return c.json({ok:false,error:'Endereço não localizado.'},400);lat=geo.lat;lng=geo.lng;}await c.env.DB.batch([c.env.DB.prepare(`UPDATE bases SET name=?,address=?,city=?,state=?,postal_code=?,latitude=?,longitude=?,minimum_fee_cents=?,rate_per_km_cents=?,cooperative_fee_percent=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(cleanText(b.name??before.name,150),address,nullableText(b.city??before.city,100),nullableText(b.state??before.state,50),nullableText(b.postal_code??before.postal_code,20),lat,lng,b.minimum_fee!==undefined?cents(b.minimum_fee):before.minimum_fee_cents,b.rate_per_km!==undefined?cents(b.rate_per_km):before.rate_per_km_cents,num(b.cooperative_fee_percent,before.cooperative_fee_percent),b.active===undefined?before.active:(b.active?1:0),before.id),c.env.DB.prepare(`UPDATE establishments SET name=?,address=?,latitude=?,longitude=?,rate_per_km_cents=?,minimum_fee_cents=?,cooperative_fee_percent=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(`Base — ${cleanText(b.name??before.name,150)}`,address,lat,lng,b.rate_per_km!==undefined?cents(b.rate_per_km):before.rate_per_km_cents,b.minimum_fee!==undefined?cents(b.minimum_fee):before.minimum_fee_cents,num(b.cooperative_fee_percent,before.cooperative_fee_percent),before.virtual_establishment_id)]);return c.json({ok:true});});

ligerimRoutes.get('/tenant/services',async(c)=>{const auth=tenantAuth(c,['cooperative_admin','dispatcher','establishment','driver']);let sql=`SELECT s.*,b.name base_name,e.name establishment_name FROM services s LEFT JOIN bases b ON b.id=s.base_id LEFT JOIN establishments e ON e.id=s.establishment_id WHERE s.cooperative_id=? AND s.deleted_at IS NULL`;const p:any[]=[auth.cooperativeId];if(auth.role==='establishment'){sql+=` AND (s.establishment_id=? OR s.establishment_id IS NULL)`;p.push(auth.establishmentId);}sql+=` ORDER BY s.name`;const rows=await c.env.DB.prepare(sql).bind(...p).all();return c.json({ok:true,items:rows.results});});
ligerimRoutes.post('/tenant/services',async(c)=>{const auth=tenantAuth(c,['cooperative_admin']);const b=await bodyJson<AnyRow>(c),service={id:id(),cooperative_id:auth.cooperativeId,base_id:nullableText(b.base_id,100),establishment_id:nullableText(b.establishment_id,100),name:cleanText(b.name,150),description:nullableText(b.description,500),add_cents:cents(b.add_value)};if(!service.name)return c.json({ok:false,error:'Informe o nome do serviço.'},400);await c.env.DB.prepare(`INSERT INTO services (id,cooperative_id,base_id,establishment_id,name,description,add_cents) VALUES (?,?,?,?,?,?,?)`).bind(...Object.values(service)).run();return c.json({ok:true,id:service.id},201);});
ligerimRoutes.put('/tenant/services/:id',async(c)=>{const auth=tenantAuth(c,['cooperative_admin']);const before=await c.env.DB.prepare(`SELECT * FROM services WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();if(!before)return c.json({ok:false,error:'Serviço não encontrado.'},404);const b=await bodyJson<AnyRow>(c);await c.env.DB.prepare(`UPDATE services SET name=?,description=?,add_cents=?,base_id=?,establishment_id=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(cleanText(b.name??before.name,150),nullableText(b.description??before.description,500),b.add_value!==undefined?cents(b.add_value):before.add_cents,nullableText(b.base_id??before.base_id,100),nullableText(b.establishment_id??before.establishment_id,100),b.active===undefined?before.active:(b.active?1:0),before.id).run();return c.json({ok:true});});

// PRECIFICAÇÃO POR ROTA
ligerimRoutes.post('/maps/geocode',async(c)=>{tenantAuth(c,['cooperative_admin','dispatcher','establishment','driver']);const b=await bodyJson<AnyRow>(c);const point=await geocodeAddress(c.env,cleanText(b.address,600));if(!point)return c.json({ok:false,error:'Endereço não localizado.'},404);return c.json({ok:true,point});});
ligerimRoutes.post('/quotes/establishment',async(c)=>{const auth=tenantAuth(c,['establishment']);const b=await bodyJson<AnyRow>(c);const estId=auth.establishmentId;const est=await c.env.DB.prepare(`SELECT * FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(estId,auth.cooperativeId).first<AnyRow>();if(!est)return c.json({ok:false,error:'Estabelecimento não encontrado.'},404);const deliveryAddress=cleanText(b.delivery_address,600);const srvc=await getServiceTotal(c,auth.cooperativeId!,Array.isArray(b.service_ids)?b.service_ids.map(String):[]);const resolved=await resolveRoute(c,est.address,deliveryAddress,est.latitude&&est.longitude?{lat:Number(est.latitude),lng:Number(est.longitude)}:null,null);const charge=routePrice(resolved.route.distance_meters,Number(est.rate_per_km_cents),Number(est.minimum_fee_cents),srvc.total);const values=await calculateDriverValues(c,auth.cooperativeId!,charge,Number(est.cooperative_fee_percent||0),'establishment',b.payment_method||'pix');return c.json({ok:true,quote:{charge_cents:charge,services_cents:srvc.total,distance_meters:resolved.route.distance_meters,duration_seconds:resolved.route.duration_seconds,origin:resolved.origin,destination:resolved.destination,geometry:resolved.route.geometry,...values}});});
ligerimRoutes.post('/quotes/base',async(c)=>{const b=await bodyJson<AnyRow>(c);const cooperativeId=cleanText(b.cooperative_id,100),base=await c.env.DB.prepare(`SELECT * FROM bases WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(cleanText(b.base_id,100),cooperativeId).first<AnyRow>();if(!base)return c.json({ok:false,error:'Base não encontrada.'},404);const srvc=await getServiceTotal(c,cooperativeId,Array.isArray(b.service_ids)?b.service_ids.map(String):[]);const resolved=await resolveRoute(c,cleanText(b.pickup_address,600),cleanText(b.delivery_address,600));const charge=routePrice(resolved.route.distance_meters,Number(base.rate_per_km_cents),Number(base.minimum_fee_cents),srvc.total);return c.json({ok:true,quote:{charge_cents:charge,services_cents:srvc.total,distance_meters:resolved.route.distance_meters,duration_seconds:resolved.route.duration_seconds,origin:resolved.origin,destination:resolved.destination,geometry:resolved.route.geometry}});});

// PEDIDO DE BALCÃO / ESTABELECIMENTO
ligerimRoutes.post('/establishment/deliveries',async(c)=>{const auth=tenantAuth(c,['establishment']);const b=await bodyJson<AnyRow>(c);const estId=auth.establishmentId;const est=await c.env.DB.prepare(`SELECT * FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(estId,auth.cooperativeId).first<AnyRow>();if(!est)return c.json({ok:false,error:'Estabelecimento inválido.'},400);const deliveryAddress=cleanText(b.delivery_address,600);if(!deliveryAddress)return c.json({ok:false,error:'Informe o endereço de entrega.'},400);const srvc=await getServiceTotal(c,auth.cooperativeId!,Array.isArray(b.service_ids)?b.service_ids.map(String):[]);const resolved=await resolveRoute(c,est.address,deliveryAddress,est.latitude&&est.longitude?{lat:Number(est.latitude),lng:Number(est.longitude)}:null,null);const automatic=routePrice(resolved.route.distance_meters,Number(est.rate_per_km_cents),Number(est.minimum_fee_cents),srvc.total);const charge=automatic;const created=await createDelivery(c,{cooperativeId:auth.cooperativeId!,establishmentId:est.id,deliveryType:'establishment',source:'counter',customerName:nullableText(b.customer_name,150),customerPhone:nullableText(b.customer_phone,50),pickupContactName:est.name,pickupPhone:est.phone,pickupAddress:est.address,pickupNeighborhood:null,recipientName:nullableText(b.recipient_name,150),recipientPhone:nullableText(b.recipient_phone,50),deliveryAddress,deliveryNeighborhood:nullableText(b.delivery_neighborhood,150),itemDescription:nullableText(b.item_description,500),paymentMethod:nullableText(b.payment_method,50),paymentStatus:cleanText(b.payment_status||'pending',30),notes:nullableText(b.notes,1500),chargeCents:charge,servicesCents:srvc.total,distanceMeters:resolved.route.distance_meters,durationSeconds:resolved.route.duration_seconds,geometry:resolved.route.geometry,pickup:resolved.origin,destination:resolved.destination,feePercent:Number(est.cooperative_fee_percent||0),createdBy:auth.id,serviceItems:srvc.items,prefix:est.order_prefix||'LG'});await audit(c,'create','delivery',created.id,null,{display_code:created.display_code},auth.cooperativeId);c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,est.id,'delivery.created',{id:created.id,display_code:created.display_code,status:'new'}));return c.json({ok:true,item:created},201);});

// ENTREGAS E DESPACHO
ligerimRoutes.get('/tenant/deliveries',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher','establishment','driver']);
  let sql=`SELECT x.id,x.cooperative_id,x.establishment_id,x.customer_id,x.customer_mode,x.customer_name,x.customer_phone,
    x.pickup_contact_name,x.pickup_phone,x.pickup_address,x.pickup_neighborhood,x.pickup_apartment,x.pickup_complement,x.pickup_lat,x.pickup_lng,
    x.recipient_name,x.recipient_phone,x.delivery_address,x.delivery_neighborhood,x.delivery_apartment,x.delivery_complement,x.delivery_lat,x.delivery_lng,
    x.item_description,x.amount_to_collect_cents,x.display_code,x.delivery_type,x.base_id,x.status,x.charge_cents,x.base_charge_cents,x.route_charge_cents,
    x.displacement_distance_meters,x.displacement_cents,x.return_required,x.return_cents,x.service_charge_cents,x.services_cents,x.wait_charge_cents,
    x.cancellation_charge_cents,x.paid_cents,x.outstanding_cents,x.driver_earnings_cents,x.driver_gross_cents,x.driver_net_cents,x.cooperative_fee_cents,
    x.payment_method,x.payment_status,x.cash_payment_location,x.notes,x.tracking_token,x.assigned_driver_id,x.assignment_source,x.distance_meters,x.duration_seconds,
    x.route_geometry,x.confirmation_code,x.confirmation_required,x.credit_used_cents,x.wait_free_seconds,x.wait_rate_cents_per_15m,x.created_at,x.updated_at,
    json_object('establishment_name',e.name,'base_name',b.name,'driver_name',d.name) related_json FROM deliveries x JOIN establishments e ON e.id=x.establishment_id LEFT JOIN bases b ON b.id=x.base_id LEFT JOIN drivers d ON d.id=x.assigned_driver_id WHERE x.cooperative_id=? AND x.deleted_at IS NULL`;
  const p:any[]=[auth.cooperativeId];
  if(['cooperative_admin','dispatcher'].includes(auth.role)){
    sql+=` AND x.delivery_type='base'`;
    if(auth.role==='dispatcher'){
      const linkedCount=await c.env.DB.prepare(`SELECT COUNT(*) total FROM base_attendants WHERE cooperative_id=? AND active=1`).bind(auth.cooperativeId).first<AnyRow>();
      if(Number(linkedCount?.total||0)>0){sql+=` AND EXISTS(SELECT 1 FROM base_attendants a WHERE a.base_id=x.base_id AND a.user_id=? AND a.active=1)`;p.push(auth.id);}
    }
    const baseId=nullableText(c.req.query('base_id'),100);
    if(baseId){sql+=` AND x.base_id=?`;p.push(baseId);}
  }
  if(auth.role==='establishment'){sql+=` AND x.establishment_id=? AND COALESCE(x.delivery_type,'establishment')!='base'`;p.push(auth.establishmentId);}
  if(auth.role==='driver'){
    const online=await isDriverOnline(c,auth.driverId!);
    sql+=` AND (x.assigned_driver_id=?`;
    p.push(auth.driverId);
    if(online){
      sql+=` OR (x.assigned_driver_id IS NULL AND x.status IN ('new','offered') AND (
        (x.delivery_type='base' AND EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=? AND s.base_id=x.base_id AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work' AND date(s.start_at)=date('now','-3 hours')))
        OR
        (x.delivery_type='establishment' AND (EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=? AND s.establishment_id=x.establishment_id AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work' AND date(s.start_at)=date('now','-3 hours')) OR EXISTS(SELECT 1 FROM establishment_driver_permissions ep WHERE ep.driver_id=? AND ep.establishment_id=x.establishment_id AND ep.active=1 AND date(ep.service_date)=date('now','-3 hours'))))
      ))`;
      p.push(auth.driverId,auth.driverId,auth.driverId);
    }
    sql+=`)`;
  }
  const status=nullableText(c.req.query('status'),30);if(status){sql+=` AND x.status=?`;p.push(status);}
  sql+=` ORDER BY CASE WHEN x.status IN ('new','offered','assigned','accepted','to_pickup','at_pickup','picked_up','in_route') THEN 0 ELSE 1 END,x.created_at DESC LIMIT 500`;
  const rows=await c.env.DB.prepare(sql).bind(...p).all();
  return c.json({ok:true,items:expandJsonRows(rows.results as AnyRow[])});
});
ligerimRoutes.post('/tenant/deliveries/:id/assign',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher']);
  const b=await bodyJson<AnyRow>(c);
  const delivery=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND delivery_type='base' AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();
  if(!delivery)return c.json({ok:false,error:'Entrega da Base não encontrada.'},404);
  if(['delivered','cancelled'].includes(delivery.status))return c.json({ok:false,error:'A entrega já foi finalizada.'},409);
  const driver=await c.env.DB.prepare(`SELECT id,name,online,last_seen_at FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND deleted_at IS NULL`).bind(cleanText(b.driver_id,100),auth.cooperativeId).first<AnyRow>();
  if(!driver)return c.json({ok:false,error:'Cooperado inválido.'},400);
  if(!(await isDriverEligible(c,driver.id,delivery)))return c.json({ok:false,error:'O cooperado precisa estar online e escalado ou liberado para este estabelecimento hoje.'},409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status='assigned',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(driver.id,delivery.id),
    c.env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting' AND ((? IS NOT NULL AND base_id=?) OR (? IS NOT NULL AND establishment_id=?))`).bind(delivery.id,driver.id,delivery.base_id,delivery.base_id,delivery.establishment_id,delivery.establishment_id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'assigned',?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,`Atribuída a ${driver.name}`,auth.id)
  ]);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,delivery.establishment_id,'delivery.assigned',{id:delivery.id,display_code:delivery.display_code,driver_id:driver.id,driver_name:driver.name,status:'assigned'}));
  return c.json({ok:true});
});
ligerimRoutes.post('/driver/deliveries/:id/accept',async(c)=>{
  const auth=tenantAuth(c,['driver']);
  if(!(await isDriverOnline(c,auth.driverId!)))return c.json({ok:false,error:'Fique online para receber ou aceitar entregas.'},409);
  const delivery=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  if(delivery.assigned_driver_id&&delivery.assigned_driver_id!==auth.driverId)return c.json({ok:false,error:'Entrega atribuída a outro cooperado.'},409);
  if(!delivery.assigned_driver_id&&!(await isDriverEligible(c,auth.driverId!,delivery)))return c.json({ok:false,error:'Você não está escalado ou liberado para este local hoje.'},403);
  const result=await c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status='accepted',accepted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (assigned_driver_id IS NULL OR assigned_driver_id=?) AND status IN ('new','offered','assigned')`).bind(auth.driverId,delivery.id,auth.driverId).run();
  if(!result.meta.changes)return c.json({ok:false,error:'A entrega já foi aceita por outro cooperado ou não está mais disponível.'},409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE drivers SET online=1,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(auth.driverId),
    c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,changed_by) VALUES (?,?,?,?,'accepted',?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,auth.id)
  ]);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,delivery.establishment_id,'delivery.status_changed',{id:delivery.id,display_code:delivery.display_code,status:'accepted'}));
  return c.json({ok:true,tracking_url:`${c.env.APP_URL.replace(/\/$/,'')}/r/${delivery.tracking_token}`});
});

async function finishDelivery(c:Context<AppBindings>,auth:AuthUser,delivery:AnyRow){
  const duplicate=await c.env.DB.prepare(`SELECT 1 ok FROM financial_entries WHERE delivery_id=? AND category='delivery' AND entry_type='credit' AND deleted_at IS NULL`).bind(delivery.id).first();
  if(duplicate)return;
  const gross=Number(delivery.driver_gross_cents||delivery.driver_earnings_cents||0);
  const taxable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  const direct=delivery.delivery_type==='base'&&baseDirectReceivedPayment(delivery.payment_method);
  const receivable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  if(!direct&&!receivable)return;
  const entryStatus=receivable?'open':'paid',settled=direct?gross:0;
  const statements:any[]=[c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'credit','delivery',?,?,?,date('now','-3 hours'),?,?)`).bind(id(),auth.cooperativeId,auth.driverId,delivery.establishment_id,delivery.id,`Entrega ${delivery.display_code||delivery.id}${direct?' • recebido diretamente pelo cooperado':''}`,gross,settled,entryStatus,auth.id)];
  const coop=taxable?await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<AnyRow>():null;
  const inss=taxable?Math.round(gross*Number(coop?.inss_percent||0)/100):0,sest=taxable?Math.round(gross*Number(coop?.sest_senat_percent||0)/100):0;
  if(inss)statements.push(c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','INSS','INSS sobre entrega',?,date('now','-3 hours'),?)`).bind(id(),auth.cooperativeId,auth.driverId,delivery.establishment_id,delivery.id,inss,auth.id));
  if(sest)statements.push(c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','SEST/SENAT','SEST/SENAT sobre entrega',?,date('now','-3 hours'),?)`).bind(id(),auth.cooperativeId,auth.driverId,delivery.establishment_id,delivery.id,sest,auth.id));
  await c.env.DB.batch(statements);await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,String(auth.driverId));
}

ligerimRoutes.post('/driver/deliveries/:id/status',async(c)=>{const auth=tenantAuth(c,['driver']);const b=await bodyJson<AnyRow>(c),next=cleanText(b.status,30),allowed=['to_pickup','at_pickup','picked_up','in_route','problem'];if(!allowed.includes(next))return c.json({ok:false,error:'Status inválido.'},400);const d=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId,auth.driverId).first<AnyRow>();if(!d)return c.json({ok:false,error:'Entrega não encontrada.'},404);const timeColumn=next==='picked_up'?'picked_up_at':null;await c.env.DB.batch([c.env.DB.prepare(`UPDATE deliveries SET status=?,${timeColumn?`${timeColumn}=CURRENT_TIMESTAMP,`:''}updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(next,d.id),c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),d.id,auth.cooperativeId,d.status,next,nullableText(b.notes,500),auth.id)]);c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,d.establishment_id,'delivery.status_changed',{id:d.id,display_code:d.display_code,status:next}));return c.json({ok:true});});

// CHAT DA ENTREGA
ligerimRoutes.get('/tenant/deliveries/:id/messages',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher','establishment','driver']);
  const delivery=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  if(['cooperative_admin','dispatcher'].includes(auth.role)&&delivery.delivery_type!=='base')return c.json({ok:false,error:'A cooperativa acessa nesta área somente as entregas da Base.'},403);
  if(auth.role==='establishment'&&(delivery.establishment_id!==auth.establishmentId||delivery.delivery_type==='base'))return c.json({ok:false,error:'Acesso não autorizado.'},403);
  if(auth.role==='driver'&&delivery.assigned_driver_id!==auth.driverId)return c.json({ok:false,error:'Acesso não autorizado.'},403);
  if(Number(delivery.customer_chat_enabled??1)!==1)return c.json({ok:true,items:[],active:false,disabled:true});
  const rows=await c.env.DB.prepare(`SELECT id,sender_type,sender_name,message,created_at FROM delivery_messages WHERE delivery_id=? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 300`).bind(delivery.id).all();
  return c.json({ok:true,items:rows.results,active:!['delivered','cancelled'].includes(delivery.status)});
});

ligerimRoutes.post('/tenant/deliveries/:id/messages',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher','establishment','driver']);
  const delivery=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  if(Number(delivery.customer_chat_enabled??1)!==1)return c.json({ok:false,error:'O chat foi desativado para esta entrega.'},403);
  if(['delivered','cancelled'].includes(delivery.status))return c.json({ok:false,error:'A conversa foi encerrada com a finalização da entrega.'},409);
  if(['cooperative_admin','dispatcher'].includes(auth.role)&&delivery.delivery_type!=='base')return c.json({ok:false,error:'A cooperativa acessa nesta área somente as entregas da Base.'},403);
  if(auth.role==='establishment'&&(delivery.establishment_id!==auth.establishmentId||delivery.delivery_type==='base'))return c.json({ok:false,error:'Acesso não autorizado.'},403);
  if(auth.role==='driver'&&delivery.assigned_driver_id!==auth.driverId)return c.json({ok:false,error:'A conversa fica disponível após a entrega ser atribuída a você.'},403);
  const b=await bodyJson<AnyRow>(c),message=cleanText(b.message,500);
  if(!message)return c.json({ok:false,error:'Digite uma mensagem.'},400);
  const senderType=auth.role==='driver'?'driver':auth.role==='establishment'?'establishment':'cooperative';
  await c.env.DB.prepare(`INSERT INTO delivery_messages (id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,auth.cooperativeId,senderType,auth.id,auth.name,message).run();
  return c.json({ok:true});
});

ligerimRoutes.post('/driver/route-plan',async(c)=>{
  const auth=tenantAuth(c,['driver']);
  if(!(await isDriverOnline(c,auth.driverId!)))return c.json({ok:false,error:'Fique online para montar a rota.'},409);
  const b=await bodyJson<AnyRow>(c),ids=Array.isArray(b.delivery_ids)?b.delivery_ids.map(String).slice(0,20):[];
  if(!ids.length)return c.json({ok:false,error:'Selecione pelo menos uma entrega.'},400);
  const placeholders=ids.map(()=>'?').join(',');
  const rows=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE cooperative_id=? AND assigned_driver_id=? AND id IN (${placeholders}) AND status NOT IN ('delivered','cancelled')`).bind(auth.cooperativeId,auth.driverId,...ids).all<AnyRow>();
  const deliveries=(rows.results||[]) as AnyRow[];
  if(!deliveries.length)return c.json({ok:false,error:'Nenhuma entrega válida.'},400);
  const driver=await c.env.DB.prepare(`SELECT current_lat,current_lng FROM drivers WHERE id=?`).bind(auth.driverId).first<AnyRow>();
  if(driver?.current_lat==null||driver?.current_lng==null)return c.json({ok:false,error:'Atualize sua localização antes de montar a rota.'},409);
  let current:GeoPoint={lat:Number(driver.current_lat),lng:Number(driver.current_lng)};
  const picked=new Set<string>(deliveries.filter(d=>['picked_up','in_route'].includes(d.status)).map(d=>String(d.id)));
  const completed=new Set<string>();
  const stops:AnyRow[]=[];
  while(completed.size<deliveries.length){
    const candidates:AnyRow[]=[];
    for(const d of deliveries){
      if(completed.has(String(d.id)))continue;
      if(!picked.has(String(d.id))){
        if(d.pickup_lat!=null&&d.pickup_lng!=null)candidates.push({delivery:d,stop_type:'pickup',address:d.pickup_address,latitude:Number(d.pickup_lat),longitude:Number(d.pickup_lng)});
      }else if(d.delivery_lat!=null&&d.delivery_lng!=null){
        candidates.push({delivery:d,stop_type:'delivery',address:d.delivery_address,latitude:Number(d.delivery_lat),longitude:Number(d.delivery_lng)});
      }
    }
    if(!candidates.length)break;
    candidates.sort((a,b)=>haversineMeters(current,{lat:a.latitude,lng:a.longitude})-haversineMeters(current,{lat:b.latitude,lng:b.longitude}));
    const next=candidates[0];
    stops.push({delivery_id:next.delivery.id,display_code:next.delivery.display_code,stop_type:next.stop_type,address:next.address,latitude:next.latitude,longitude:next.longitude});
    current={lat:next.latitude,lng:next.longitude};
    if(next.stop_type==='pickup')picked.add(String(next.delivery.id));else completed.add(String(next.delivery.id));
  }
  if(!stops.length)return c.json({ok:false,error:'As entregas ainda não possuem coordenadas de rota.'},400);
  const routePoints:GeoPoint[]=[{lat:Number(driver.current_lat),lng:Number(driver.current_lng)},...stops.map(s=>({lat:Number(s.latitude),lng:Number(s.longitude)}))];
  const route=await routeBetween(c.env,routePoints);
  if(!route)return c.json({ok:false,error:'Não foi possível montar a rota.'},400);
  const planId=id();
  await c.env.DB.prepare(`UPDATE driver_route_plans SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='active'`).bind(auth.driverId).run();
  await c.env.DB.prepare(`INSERT INTO driver_route_plans (id,cooperative_id,driver_id,distance_meters,duration_seconds,geometry) VALUES (?,?,?,?,?,?)`).bind(planId,auth.cooperativeId,auth.driverId,route.distance_meters,route.duration_seconds,JSON.stringify(route.geometry)).run();
  await c.env.DB.batch(stops.map((stop,index)=>c.env.DB.prepare(`INSERT INTO driver_route_plan_stops (id,plan_id,delivery_id,stop_order,stop_type,address,latitude,longitude) VALUES (?,?,?,?,?,?,?,?)`).bind(id(),planId,stop.delivery_id,index+1,stop.stop_type,stop.address,stop.latitude,stop.longitude)));
  const navigationUrl=`https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(`${driver.current_lat},${driver.current_lng}`)}&destination=${encodeURIComponent(`${stops[stops.length-1].latitude},${stops[stops.length-1].longitude}`)}${stops.length>1?`&waypoints=${encodeURIComponent(stops.slice(0,-1).map(s=>`${s.latitude},${s.longitude}`).join('|'))}`:''}`;
  return c.json({ok:true,plan:{id:planId,...route,deliveries,stops,navigation_url:navigationUrl}});
});

// PRESENÇA POR QR
ligerimRoutes.post('/driver/presence/scan',async(c)=>{
  const auth=tenantAuth(c,['driver']);
  const b=await bodyJson<AnyRow>(c),token=cleanText(b.token,200),lat=toNumber(b.latitude),lng=toNumber(b.longitude);
  if(lat===null||lng===null||Math.abs(lat)>90||Math.abs(lng)>180||Math.abs(lat)+Math.abs(lng)<0.01)return c.json({ok:false,error:'Ative a localização precisa para validar sua chegada.'},400);
  const driverState=await c.env.DB.prepare(`SELECT status,on_leave FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(auth.driverId,auth.cooperativeId).first<AnyRow>();
  if(!driverState||driverState.status!=='active'||Number(driverState.on_leave||0)===1)return c.json({ok:false,error:'Seu cadastro está inativo ou afastado. Procure a cooperativa.'},409);
  const open=await c.env.DB.prepare(`SELECT * FROM presence_sessions WHERE driver_id=? AND checkout_at IS NULL ORDER BY checkin_at DESC LIMIT 1`).bind(auth.driverId).first<AnyRow>();
  let locationType:'establishment'|'base',location:any;
  if((location=await c.env.DB.prepare(`SELECT id,cooperative_id,name,latitude,longitude,queue_radius_meters checkin_radius_meters FROM establishments WHERE checkin_token=? AND active=1 AND deleted_at IS NULL`).bind(token).first<AnyRow>()))locationType='establishment';
  else if((location=await c.env.DB.prepare(`SELECT id,cooperative_id,name,latitude,longitude,checkin_radius_meters FROM bases WHERE qr_token=? AND active=1 AND deleted_at IS NULL`).bind(token).first<AnyRow>()))locationType='base';
  else return c.json({ok:false,error:'QR Code inválido.'},404);
  if(location.cooperative_id!==auth.cooperativeId)return c.json({ok:false,error:'Este local pertence a outra cooperativa.'},403);
  const locationLat=Number(location.latitude),locationLng=Number(location.longitude);
  if(!Number.isFinite(locationLat)||!Number.isFinite(locationLng)||Math.abs(locationLat)>90||Math.abs(locationLng)>180||Math.abs(locationLat)+Math.abs(locationLng)<0.01)return c.json({ok:false,error:'O endereço deste local ainda não possui localização confirmada.'},409);
  const distance=distanceMeters(lat,lng,locationLat,locationLng);
  const radius=Math.max(30,Number(location.checkin_radius_meters||250));
  if(distance>radius)return c.json({ok:false,error:`Você está a ${distance} m de ${location.name}. A leitura é aceita dentro de ${radius} m.`},403);
  if(open){
    const same=(locationType==='establishment'&&open.establishment_id===location.id)||(locationType==='base'&&open.base_id===location.id);
    if(!same)return c.json({ok:false,error:'Faça check-out do local atual antes de entrar em outro.'},409);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE presence_sessions SET checkout_at=CURRENT_TIMESTAMP,checkout_lat=?,checkout_lng=? WHERE id=?`).bind(lat,lng,open.id),
      c.env.DB.prepare(`UPDATE waiting_queue SET status='left',left_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting'`).bind(auth.driverId)
    ]);
    return c.json({ok:true,action:'checkout',location_name:location.name,distance_meters:distance});
  }
  if(locationType==='establishment'){const block=await c.env.DB.prepare(`SELECT reason FROM driver_establishment_blocks WHERE cooperative_id=? AND driver_id=? AND establishment_id=? AND active=1 LIMIT 1`).bind(auth.cooperativeId,auth.driverId,location.id).first<AnyRow>();if(block)return c.json({ok:false,error:`Você está bloqueado para atuar neste estabelecimento${block.reason?`: ${block.reason}`:''}.`},403);}
  const schedule=await c.env.DB.prepare(`SELECT id,contract_id FROM schedules WHERE driver_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND COALESCE(entry_type,'work')='work' AND date(start_at)=date('now','-3 hours') AND ((?='establishment' AND establishment_id=?) OR (?='base' AND base_id=?)) ORDER BY start_at LIMIT 1`).bind(auth.driverId,locationType,location.id,locationType,location.id).first<AnyRow>();
  if(!schedule)return c.json({ok:false,error:'Você não está escalado para trabalhar neste local hoje.'},403);
  const sessionId=id();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO presence_sessions (id,cooperative_id,driver_id,location_type,establishment_id,base_id,schedule_id,contract_id,checkin_lat,checkin_lng) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(sessionId,auth.cooperativeId,auth.driverId,locationType,locationType==='establishment'?location.id:null,locationType==='base'?location.id:null,schedule.id,schedule.contract_id||null,lat,lng),
    c.env.DB.prepare(`UPDATE drivers SET online=1,last_seen_at=CURRENT_TIMESTAMP,current_lat=?,current_lng=?,location_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(lat,lng,auth.driverId)
  ]);
  return c.json({ok:true,action:'checkin',location_name:location.name,distance_meters:distance,online:true,message:'Check-in confirmado. Você já está online; toque em Cheguei para entrar na fila.'});
});
ligerimRoutes.get('/tenant/presence',async(c)=>{const auth=tenantAuth(c,['cooperative_admin','dispatcher','driver','establishment']);let sql=`SELECT p.*,d.name driver_name,e.name establishment_name,b.name base_name FROM presence_sessions p JOIN drivers d ON d.id=p.driver_id LEFT JOIN establishments e ON e.id=p.establishment_id LEFT JOIN bases b ON b.id=p.base_id WHERE p.cooperative_id=?`;const params:any[]=[auth.cooperativeId];if(auth.role==='driver'){sql+=` AND p.driver_id=?`;params.push(auth.driverId);}if(auth.role==='establishment'){sql+=` AND p.establishment_id=?`;params.push(auth.establishmentId);}sql+=` ORDER BY p.checkin_at DESC LIMIT 500`;const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});});

// DESCONTOS, FECHAMENTO E ADIANTAMENTOS
function saoPauloDate(reference = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(reference);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function weekBounds(reference = new Date()) {
  const today = saoPauloDate(reference);
  const local = new Date(`${today}T12:00:00Z`);
  const day = local.getUTCDay();
  local.setUTCDate(local.getUTCDate() - (day === 0 ? 6 : day - 1));
  const start = local.toISOString().slice(0,10);
  const endDate = new Date(local.getTime());
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  return { start, end: endDate.toISOString().slice(0,10) };
}

function monthKeysBetween(start: string, end: string) {
  const out: string[] = [];
  const cursor = new Date(`${start.slice(0,7)}-01T12:00:00`);
  const last = new Date(`${end.slice(0,7)}-01T12:00:00`);
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0,7));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

async function configuredDeductions(c: Context<AppBindings>, cooperativeId: string, grossCents: number, weekStart: string, weekEnd: string) {
  const months = monthKeysBetween(weekStart, weekEnd);
  const placeholders = months.map(()=>'?').join(',');
  const values = months.length ? await c.env.DB.prepare(`SELECT deduction_type_id,reference_month,value FROM monthly_deduction_values WHERE cooperative_id=? AND reference_month IN (${placeholders})`).bind(cooperativeId,...months).all<AnyRow>() : { results: [] as AnyRow[] };
  const overrides = new Map<string,number>((values.results||[]).map((x:any)=>[`${x.deduction_type_id}:${x.reference_month}`,Number(x.value||0)]));
  const rows = await c.env.DB.prepare(`SELECT * FROM deduction_types WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL ORDER BY sort_order,name`).bind(cooperativeId).all<AnyRow>();
  const details: AnyRow[] = [];
  for (const rule of rows.results||[]) {
    if (rule.calculation_type === 'percentage') {
      const month = weekEnd.slice(0,7);
      const value = overrides.get(`${rule.id}:${month}`) ?? Number(rule.default_value||0);
      const amount = Math.max(0,Math.round(grossCents * value / 100));
      if (amount) details.push({id:rule.id,name:rule.name,calculation_type:rule.calculation_type,value,amount_cents:amount,sort_order:Number(rule.sort_order||0)});
      continue;
    }
    if (rule.calculation_type === 'fixed_weekly') {
      const month = weekEnd.slice(0,7);
      const value = overrides.get(`${rule.id}:${month}`) ?? Number(rule.default_value||0);
      const amount = Math.max(0,Math.round(value * 100));
      if (amount) details.push({id:rule.id,name:rule.name,calculation_type:rule.calculation_type,value,amount_cents:amount,sort_order:Number(rule.sort_order||0)});
      continue;
    }
    if (rule.calculation_type === 'fixed_monthly') {
      for (const month of months) {
        const [year,monthNumber] = month.split('-').map(Number);
        const lastDay = new Date(year,monthNumber,0,12).toISOString().slice(0,10);
        if (lastDay < weekStart || lastDay > weekEnd) continue;
        const value = overrides.get(`${rule.id}:${month}`) ?? Number(rule.default_value||0);
        const amount = Math.max(0,Math.round(value * 100));
        if (amount) details.push({id:rule.id,name:rule.name,calculation_type:rule.calculation_type,reference_month:month,value,amount_cents:amount,sort_order:Number(rule.sort_order||0)});
      }
    }
  }
  return { details, total: details.reduce((sum,x)=>sum+Number(x.amount_cents||0),0) };
}

ligerimRoutes.get('/tenant/deductions',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin']);
  const month=c.req.query('month')||new Date().toISOString().slice(0,7);
  const rows=await c.env.DB.prepare(`SELECT d.*,(SELECT value FROM monthly_deduction_values m WHERE m.deduction_type_id=d.id AND m.reference_month=? LIMIT 1) month_value FROM deduction_types d WHERE d.cooperative_id=? AND d.deleted_at IS NULL ORDER BY d.sort_order,d.name`).bind(month,auth.cooperativeId).all();
  return c.json({ok:true,month,items:rows.results});
});
ligerimRoutes.post('/tenant/deductions',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin']);
  const b=await bodyJson<AnyRow>(c),name=cleanText(b.name,100),type=cleanText(b.calculation_type,30);
  if(!name||!['percentage','fixed_monthly','fixed_weekly'].includes(type))return c.json({ok:false,error:'Dados inválidos.'},400);
  const did=id();
  await c.env.DB.prepare(`INSERT INTO deduction_types (id,cooperative_id,name,calculation_type,default_value,sort_order) VALUES (?,?,?,?,?,?)`).bind(did,auth.cooperativeId,name,type,num(b.default_value,0),num(b.sort_order,0)).run();
  return c.json({ok:true,id:did},201);
});
ligerimRoutes.put('/tenant/deductions/:id',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin']);
  const before=await c.env.DB.prepare(`SELECT * FROM deduction_types WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();
  if(!before)return c.json({ok:false,error:'Desconto não encontrado.'},404);
  const b=await bodyJson<AnyRow>(c),type=cleanText(b.calculation_type??before.calculation_type,30);
  if(!['percentage','fixed_monthly','fixed_weekly'].includes(type))return c.json({ok:false,error:'Tipo de cálculo inválido.'},400);
  await c.env.DB.prepare(`UPDATE deduction_types SET name=?,calculation_type=?,default_value=?,active=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(cleanText(b.name??before.name,100),type,num(b.default_value,before.default_value),b.active===undefined?before.active:(b.active?1:0),num(b.sort_order,before.sort_order),before.id).run();
  return c.json({ok:true});
});
ligerimRoutes.post('/tenant/deductions/:id/month',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin']);
  const b=await bodyJson<AnyRow>(c),month=cleanText(b.reference_month,7);
  if(!/^\d{4}-\d{2}$/.test(month))return c.json({ok:false,error:'Mês inválido.'},400);
  const type=await c.env.DB.prepare(`SELECT id FROM deduction_types WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first();
  if(!type)return c.json({ok:false,error:'Desconto não encontrado.'},404);
  await c.env.DB.prepare(`INSERT INTO monthly_deduction_values (id,cooperative_id,deduction_type_id,reference_month,value) VALUES (?,?,?,?,?) ON CONFLICT(cooperative_id,deduction_type_id,reference_month) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(id(),auth.cooperativeId,c.req.param('id'),month,num(b.value,0)).run();
  return c.json({ok:true});
});

ligerimRoutes.post('/tenant/deductions/apply',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin']),b=await bodyJson<AnyRow>(c);
  const allocationMode=cleanText(b.allocation_mode||'per_driver',30);
  if(!['per_driver','divide_total'].includes(allocationMode))return c.json({ok:false,error:'Escolha se o valor será por cooperado ou total dividido.'},400);
  const amountCents=cents(b.amount);if(amountCents<=0)return c.json({ok:false,error:'Informe um valor maior que zero.'},400);
  const referenceDate=cleanText(b.reference_date||saoPauloDate(),10);if(!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate))return c.json({ok:false,error:'Data inválida.'},400);
  const category=cleanText(b.category||'imposto_rateio',80),name=cleanText(b.name||'Imposto ou rateio',150),description=cleanText(b.description||name,500);
  let requestedIds=Array.isArray(b.driver_ids)?b.driver_ids.map((x:any)=>cleanText(x,100)).filter(Boolean):[];
  let sql=`SELECT id,name FROM drivers WHERE cooperative_id=? AND status='active' AND deleted_at IS NULL`,params:any[]=[auth.cooperativeId];
  if(!b.all_drivers){if(!requestedIds.length)return c.json({ok:false,error:'Selecione pelo menos um cooperado.'},400);sql+=` AND id IN (${requestedIds.map(()=>'?').join(',')})`;params.push(...requestedIds);}
  sql+=` ORDER BY name COLLATE NOCASE`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all<AnyRow>(),drivers=rows.results||[];
  if(!drivers.length)return c.json({ok:false,error:'Nenhum cooperado ativo foi selecionado.'},400);
  if(!b.all_drivers&&drivers.length!==new Set(requestedIds).size)return c.json({ok:false,error:'Um ou mais cooperados selecionados são inválidos ou inativos.'},400);
  const perDriver=Math.floor(amountCents/drivers.length),remainder=amountCents%drivers.length;
  if(allocationMode==='divide_total'&&perDriver<=0)return c.json({ok:false,error:'O valor total é muito pequeno para dividir entre os selecionados.'},400);
  const batchId=id(),allocations=drivers.map((driver:AnyRow,index:number)=>({driver_id:driver.id,driver_name:driver.name,amount_cents:allocationMode==='per_driver'?amountCents:perDriver+(index<remainder?1:0)}));
  await c.env.DB.batch(allocations.map((item:AnyRow)=>c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,entry_type,category,description,amount_cents,reference_date,status,created_by) VALUES (?,?,?,'debit',?,?,?,?, 'open',?)`).bind(id(),auth.cooperativeId,item.driver_id,category,cleanFinancialDescription(description),item.amount_cents,referenceDate,auth.id)));
  for(const item of allocations)await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,String(item.driver_id));
  await audit(c,'create','deduction_allocation',batchId,null,{allocation_mode:allocationMode,input_amount_cents:amountCents,category,name,description,reference_date:referenceDate,drivers:allocations},auth.cooperativeId||undefined);
  return c.json({ok:true,batch_id:batchId,allocation_mode:allocationMode,selected_count:allocations.length,total_cents:allocations.reduce((sum:number,x:AnyRow)=>sum+Number(x.amount_cents||0),0),items:allocations},201);
});


function debitPriority(category:string, description=''):number { return financialDebitPriority(category,description); }

async function closingPreview(c: Context<AppBindings>, cooperativeId: string, start: string) {
  await settleDueGuarantees(c.env,cooperativeId);
  const endDate=new Date(`${start}T12:00:00`);endDate.setDate(endDate.getDate()+6);const weekEnd=endDate.toISOString().slice(0,10);
  const nextDate=new Date(`${weekEnd}T12:00:00`);nextDate.setDate(nextDate.getDate()+1);const nextWeekStart=nextDate.toISOString().slice(0,10);
  const drivers=await c.env.DB.prepare(`SELECT id,name FROM drivers WHERE cooperative_id=? AND deleted_at IS NULL ORDER BY name`).bind(cooperativeId).all<AnyRow>();

  // Primeiro usa somente créditos realmente a receber para liquidar os débitos existentes.
  // Valores que o cooperado já recebeu diretamente na Base nunca entram nesta conciliação.
  for(const driver of drivers.results||[])await reconcileDriverFinancialBalance(c.env,cooperativeId,String(driver.id));

  const entries=await c.env.DB.prepare(`SELECT f.*,dl.delivery_type,dl.payment_method
    FROM financial_entries f LEFT JOIN deliveries dl ON dl.id=f.delivery_id
    WHERE f.cooperative_id=? AND f.deleted_at IS NULL AND f.status!='cancelled'
      AND ((f.entry_type='credit' AND date(f.reference_date) BETWEEN date(?) AND date(?))
        OR (f.entry_type='debit' AND ((f.status='open' AND date(f.reference_date)<=date(?)) OR date(f.reference_date) BETWEEN date(?) AND date(?))))
    ORDER BY date(f.reference_date),datetime(f.created_at),f.id`).bind(cooperativeId,start,weekEnd,weekEnd,start,weekEnd).all<AnyRow>();
  const byDriver=new Map<string,AnyRow[]>();
  for(const entry of entries.results||[]){const list=byDriver.get(String(entry.driver_id))||[];list.push(entry);byDriver.set(String(entry.driver_id),list);}
  const items:AnyRow[]=[];

  for(const driver of drivers.results||[]){
    const rows=byDriver.get(String(driver.id))||[];
    const credits=rows.filter(x=>x.entry_type==='credit'&&dateWithin(String(x.reference_date||''),start,weekEnd));
    const receivableCredits=credits.filter(isReceivableCredit),directCredits=credits.filter(isDirectReceivedDelivery);
    const productionReceivable=receivableCredits.reduce((sum,x)=>sum+Math.max(0,Number(x.amount_cents||0)),0);
    const directReceived=directCredits.reduce((sum,x)=>sum+Math.max(0,Number(x.amount_cents||0)),0);
    let available=receivableCredits.reduce((sum,x)=>sum+Math.max(0,Number(x.amount_cents||0)-Number(x.settled_cents||0)),0);

    const automatic=await configuredDeductions(c,cooperativeId,productionReceivable,start,weekEnd);
    const debitRows=rows.filter(x=>x.entry_type==='debit'&&(x.status==='open'||dateWithin(String(x.reference_date||''),start,weekEnd))).map(x=>{
      const amount=Math.max(0,Number(x.amount_cents||0));
      const settled=Math.min(amount,Math.max(0,Number(x.settled_cents||0)));
      return {entry_id:x.id,source:'entry',category:String(x.category||'other_expense'),description:cleanFinancialDescription(x.description||x.category),amount_cents:amount,already_settled_cents:settled,remaining_before_close_cents:Math.max(0,amount-settled),created_at:x.created_at,priority:debitPriority(String(x.category||''),String(x.description||'')),sort_order:Number(x.deduction_order||0),status:x.status};
    });
    const virtualRows=(automatic.details||[]).map((x:any,index:number)=>({entry_id:null,source:'configured',category:'configured_deduction',description:cleanFinancialDescription(x.name),amount_cents:Number(x.amount_cents||0),already_settled_cents:0,remaining_before_close_cents:Number(x.amount_cents||0),created_at:`${weekEnd}T23:59:${String(index).padStart(2,'0')}`,priority:debitPriority('configured_deduction',String(x.name||'')),sort_order:Number(x.sort_order||0),configured_type_id:x.id||null,status:'open'}));
    const ordered=[...debitRows,...virtualRows].filter(x=>x.amount_cents>0).sort((a,b)=>a.priority-b.priority||Number(a.sort_order||0)-Number(b.sort_order||0)||String(a.created_at).localeCompare(String(b.created_at)));

    const applied=ordered.map(row=>{
      // Débitos já conciliados aparecem como pagos. Somente o restante ainda aberto
      // pode consumir o saldo disponível. Os descontos automáticos são aplicados aqui.
      const newlyApplied=Math.min(available,row.remaining_before_close_cents);
      available-=newlyApplied;
      const appliedTotal=Math.min(row.amount_cents,row.already_settled_cents+newlyApplied);
      return {...row,newly_applied_cents:newlyApplied,applied_cents:appliedTotal,pending_cents:Math.max(0,row.amount_cents-appliedTotal)};
    });
    const advancesDue=applied.filter(x=>x.priority===30).reduce((sum,x)=>sum+x.amount_cents,0);
    const deductionsDue=applied.filter(x=>x.priority!==30).reduce((sum,x)=>sum+x.amount_cents,0);
    const advancesApplied=applied.filter(x=>x.priority===30).reduce((sum,x)=>sum+x.applied_cents,0);
    const deductionsApplied=applied.filter(x=>x.priority!==30).reduce((sum,x)=>sum+x.applied_cents,0);
    const pending=applied.reduce((sum,x)=>sum+x.pending_cents,0);
    const net=productionReceivable-deductionsDue-advancesDue;
    items.push({id:driver.id,name:driver.name,gross_cents:productionReceivable,production_receivable_cents:productionReceivable,direct_received_cents:directReceived,deductions_cents:deductionsDue,advances_cents:advancesDue,deductions_applied_cents:deductionsApplied,advances_applied_cents:advancesApplied,net_cents:net,payable_cents:Math.max(0,available),pending_deductions_cents:pending,deduction_details:applied,credit_entry_ids:receivableCredits.map(x=>x.id),next_week_start:nextWeekStart});
  }
  return {week_start:start,week_end:weekEnd,next_week_start:nextWeekStart,items,totals:{gross_cents:items.reduce((s,x)=>s+Number(x.gross_cents),0),direct_received_cents:items.reduce((s,x)=>s+Number(x.direct_received_cents),0),deductions_cents:items.reduce((s,x)=>s+Number(x.deductions_cents),0),advances_cents:items.reduce((s,x)=>s+Number(x.advances_cents),0),net_cents:items.reduce((s,x)=>s+Number(x.net_cents),0),payable_cents:items.reduce((s,x)=>s+Number(x.payable_cents),0),pending_deductions_cents:items.reduce((s,x)=>s+Number(x.pending_deductions_cents),0)}};
}

function dateWithin(value:string,start:string,end:string){const date=String(value||'').slice(0,10);return date>=start&&date<=end;}

ligerimRoutes.post('/tenant/weekly-close/preview',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin']);const b=await bodyJson<AnyRow>(c),start=cleanText(b.week_start,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start))return c.json({ok:false,error:'Informe a segunda-feira da semana.'},400);
  return c.json({ok:true,...await closingPreview(c,auth.cooperativeId!,start)});
});
ligerimRoutes.post('/tenant/weekly-close',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin']);const b=await bodyJson<AnyRow>(c),start=cleanText(b.week_start,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start))return c.json({ok:false,error:'Semana inválida.'},400);
  const existing=await c.env.DB.prepare(`SELECT id FROM weekly_closings WHERE cooperative_id=? AND week_start=?`).bind(auth.cooperativeId,start).first();
  if(existing)return c.json({ok:false,error:'Esta semana já foi fechada.'},409);
  const preview=await closingPreview(c,auth.cooperativeId!,start),closingId=id(),statements:any[]=[];
  statements.push(c.env.DB.prepare(`INSERT INTO weekly_closings (id,cooperative_id,week_start,week_end,status,total_gross_cents,total_deductions_cents,total_advances_cents,total_net_cents,closed_by,closed_at) VALUES (?,?,?,?,'closed',?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(closingId,auth.cooperativeId,preview.week_start,preview.week_end,preview.totals.gross_cents,preview.totals.deductions_cents,preview.totals.advances_cents,preview.totals.net_cents,auth.id));
  for(const item of preview.items){
    statements.push(c.env.DB.prepare(`INSERT INTO weekly_closing_items (id,closing_id,cooperative_id,driver_id,gross_cents,deductions_cents,advances_cents,net_cents,details_json) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id(),closingId,auth.cooperativeId,item.id,item.gross_cents,item.deductions_cents,item.advances_cents,item.net_cents,JSON.stringify({driver:item.name,production_receivable_cents:item.production_receivable_cents,direct_received_cents:item.direct_received_cents,payable_cents:item.payable_cents,ordered_deductions:item.deduction_details,pending_deductions_cents:item.pending_deductions_cents})));
    for(const creditId of item.credit_entry_ids||[])statements.push(c.env.DB.prepare(`UPDATE financial_entries SET settled_cents=amount_cents,status='paid',updated_at=CURRENT_TIMESTAMP WHERE id=? AND entry_type='credit'`).bind(creditId));
    for(const detail of item.deduction_details||[]){
      const clean=cleanFinancialDescription(detail.description),pending=Number(detail.pending_cents||0),applied=Number(detail.applied_cents||0);
      if(detail.source==='entry'&&detail.entry_id){
        if(pending<=0)statements.push(c.env.DB.prepare(`UPDATE financial_entries SET settled_cents=amount_cents,status='paid',description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(clean,detail.entry_id));
        else statements.push(c.env.DB.prepare(`UPDATE financial_entries SET amount_cents=?,settled_cents=0,status='open',reference_date=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(pending,preview.next_week_start,carryoverDescription(clean,preview.week_start,preview.week_end),detail.entry_id));
      }else if(detail.source==='configured'){
        if(applied>0)statements.push(c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,entry_type,category,description,amount_cents,settled_cents,deduction_order,reference_date,status,created_by) VALUES (?,?,?,'debit','configured_deduction',?,?,?,?,?,'paid',?)`).bind(id(),auth.cooperativeId,item.id,clean,applied,applied,detail.priority,preview.week_end,auth.id));
        if(pending>0)statements.push(c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,entry_type,category,description,amount_cents,settled_cents,deduction_order,reference_date,status,created_by) VALUES (?,?,?,'debit','configured_deduction',?,?,0,?,?,'open',?)`).bind(id(),auth.cooperativeId,item.id,carryoverDescription(clean,preview.week_start,preview.week_end),pending,detail.priority,preview.next_week_start,auth.id));
      }
    }
  }
  for(let index=0;index<statements.length;index+=75)await c.env.DB.batch(statements.slice(index,index+75));
  await audit(c,'close','weekly_closing',closingId,null,preview.totals,auth.cooperativeId);
  return c.json({ok:true,id:closingId,totals:preview.totals});
});
ligerimRoutes.get('/tenant/weekly-closes',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','driver']);
  if(auth.role==='driver'){
    const items=await c.env.DB.prepare(`SELECT i.*,w.week_start,w.week_end,w.status closing_status FROM weekly_closing_items i JOIN weekly_closings w ON w.id=i.closing_id WHERE i.driver_id=? ORDER BY w.week_start DESC`).bind(auth.driverId).all();
    return c.json({ok:true,items:items.results});
  }
  const rows=await c.env.DB.prepare(`SELECT w.* FROM weekly_closings w WHERE w.cooperative_id=? ORDER BY w.week_start DESC LIMIT 100`).bind(auth.cooperativeId).all();
  return c.json({ok:true,items:rows.results});
});

async function driverAdvanceAvailability(c:Context<AppBindings>,driverId:string){
  const driver=await c.env.DB.prepare(`SELECT cooperative_id FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(driverId).first<{cooperative_id:string}>();
  if(!driver)return {available_cents:0,week_start:'',week_end:'',gross_cents:0,inss_cents:0,sest_senat_cents:0,advances_cents:0,rateios_cents:0,other_deductions_cents:0,pending_requests_cents:0};
  const bounds=weekBounds(),preview=await closingPreview(c,driver.cooperative_id,bounds.start),item=(preview.items||[]).find((row:AnyRow)=>String(row.id)===String(driverId))||{};
  const pending=await c.env.DB.prepare(`SELECT COALESCE(SUM(requested_cents),0) v FROM advance_requests WHERE driver_id=? AND status='pending'`).bind(driverId).first<{v:number}>();
  const details=item.deduction_details||[];
  const sumPriority=(priority:number)=>details.filter((row:AnyRow)=>Number(row.priority)===priority).reduce((total:number,row:AnyRow)=>total+Number(row.applied_cents||0),0);
  const totalNet=Math.max(0,Number(item.net_cents||0)),pendingRequests=Math.max(0,Number(pending?.v||0));
  return {available_cents:Math.max(0,totalNet-pendingRequests),week_start:preview.week_start,week_end:preview.week_end,gross_cents:Number(item.gross_cents||0),inss_cents:sumPriority(10),sest_senat_cents:sumPriority(20),advances_cents:sumPriority(30),rateios_cents:sumPriority(40),other_deductions_cents:sumPriority(50),pending_requests_cents:pendingRequests,net_before_pending_cents:totalNet};
}
async function driverAvailable(c:Context<AppBindings>,driverId:string){return (await driverAdvanceAvailability(c,driverId)).available_cents;}
ligerimRoutes.get('/advances',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','driver']);
  if(auth.role==='driver'){const availability=await driverAdvanceAvailability(c,auth.driverId!);const rows=await c.env.DB.prepare(`SELECT * FROM advance_requests WHERE driver_id=? ORDER BY created_at DESC`).bind(auth.driverId).all();return c.json({ok:true,...availability,items:rows.results});}
  const rows=await c.env.DB.prepare(`SELECT a.*,d.name driver_name FROM advance_requests a JOIN drivers d ON d.id=a.driver_id WHERE a.cooperative_id=? ORDER BY a.created_at DESC`).bind(auth.cooperativeId).all();return c.json({ok:true,items:rows.results});
});
ligerimRoutes.post('/advances',async(c)=>{
  const auth=tenantAuth(c,['driver']);const b=await bodyJson<AnyRow>(c),amount=cents(b.amount),available=await driverAvailable(c,auth.driverId!);
  if(amount<=0||amount>available)return c.json({ok:false,error:'O valor deve ser positivo e não pode ultrapassar o disponível após os descontos.'},400);
  await c.env.DB.prepare(`INSERT INTO advance_requests (id,cooperative_id,driver_id,requested_cents,available_at_request_cents,driver_notes) VALUES (?,?,?,?,?,?)`).bind(id(),auth.cooperativeId,auth.driverId,amount,available,nullableText(b.notes,500)).run();return c.json({ok:true},201);
});
ligerimRoutes.post('/advances/:id/review',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin']);const b=await bodyJson<AnyRow>(c),a=await c.env.DB.prepare(`SELECT * FROM advance_requests WHERE id=? AND cooperative_id=? AND status='pending'`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();
  if(!a)return c.json({ok:false,error:'Solicitação não encontrada.'},404);const decision=cleanText(b.decision,20);if(!['approved','rejected'].includes(decision))return c.json({ok:false,error:'Decisão inválida.'},400);
  const currentAvailable=await driverAvailable(c,a.driver_id),reviewAvailable=currentAvailable+Number(a.requested_cents||0),approved=decision==='approved'?Math.min(cents(b.approved_value||a.requested_cents/100),Number(a.available_at_request_cents),reviewAvailable):0;
  if(decision==='approved'&&approved<=0)return c.json({ok:false,error:'O cooperado não possui saldo líquido disponível para este adiantamento.'},409);
  await c.env.DB.prepare(`UPDATE advance_requests SET status=?,approved_cents=?,admin_notes=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(decision,approved,nullableText(b.notes,500),auth.id,a.id).run();
  if(decision==='approved'){await c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,'debit','advance','Adiantamento aprovado',?,date('now','-3 hours'),?)`).bind(id(),auth.cooperativeId,a.driver_id,approved,auth.id).run();await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,String(a.driver_id));}
  return c.json({ok:true,approved_cents:approved});
});

// FINANCEIRO DO COOPERADO
ligerimRoutes.get('/driver/finance',async(c)=>{
  const auth=tenantAuth(c,['driver']);
  await settleDueGuarantees(c.env,auth.cooperativeId);
  await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,auth.driverId!);
  const from=c.req.query('from')||saoPauloDate(new Date(Date.now()-6*86400000)),to=c.req.query('to')||saoPauloDate();
  const rows=await c.env.DB.prepare(`SELECT f.*,dl.delivery_type,dl.payment_method FROM financial_entries f LEFT JOIN deliveries dl ON dl.id=f.delivery_id WHERE f.driver_id=? AND f.deleted_at IS NULL AND date(f.reference_date) BETWEEN date(?) AND date(?) ORDER BY f.reference_date DESC,f.created_at DESC`).bind(auth.driverId,from,to).all<AnyRow>();
  const items=[...(rows.results||[])].map((x:any)=>{const amount=Number(x.amount_cents||0),settled=Math.min(amount,Math.max(0,Number(x.settled_cents||0)));return {...x,description:cleanFinancialDescription(x.description),settled_cents:settled,remaining_cents:Math.max(0,amount-settled),financial_class:isDirectReceivedDelivery(x)?'production_received':isReceivableCredit(x)&&x.category==='delivery'?'production_receivable':x.entry_type==='credit'?'other_credit':'deduction'};});
  const recorded=new Set(items.filter((x:any)=>x.category==='delivery'&&x.entry_type==='credit'&&x.delivery_id).map((x:any)=>String(x.delivery_id)));
  const missing=await c.env.DB.prepare(`SELECT d.id,d.display_code,d.establishment_id,d.delivery_type,d.payment_method,d.delivered_at,d.updated_at,d.created_at,
      max(0,COALESCE(NULLIF(d.driver_gross_cents,0),NULLIF(d.driver_earnings_cents,0),d.charge_cents-d.cooperative_fee_cents,0)) gross_cents,
      c.inss_percent,c.sest_senat_percent
    FROM deliveries d JOIN cooperatives c ON c.id=d.cooperative_id
    WHERE d.cooperative_id=? AND d.assigned_driver_id=? AND d.status='delivered' AND d.deleted_at IS NULL
      AND date(COALESCE(d.delivered_at,d.updated_at,d.created_at),'-3 hours') BETWEEN date(?) AND date(?)
    ORDER BY COALESCE(d.delivered_at,d.updated_at,d.created_at) DESC`).bind(auth.cooperativeId,auth.driverId,from,to).all<AnyRow>();
  for(const delivery of missing.results||[]){
    if(recorded.has(String(delivery.id)))continue;
    const gross=Number(delivery.gross_cents||0),taxable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method)),direct=delivery.delivery_type==='base'&&baseDirectReceivedPayment(delivery.payment_method),receivable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method)),date=String(delivery.delivered_at||delivery.updated_at||delivery.created_at).slice(0,10);
    if(!direct&&!receivable)continue;
    items.push({id:`derived-credit-${delivery.id}`,delivery_id:delivery.id,delivery_type:delivery.delivery_type,payment_method:delivery.payment_method,entry_type:'credit',category:'delivery',description:`Entrega ${delivery.display_code||delivery.id.slice(0,8)}${direct?' • recebido diretamente pelo cooperado':''}`,amount_cents:gross,settled_cents:direct?gross:0,remaining_cents:direct?0:gross,reference_date:date,status:direct?'paid':'open',financial_class:direct?'production_received':'production_receivable',derived:true});
    if(taxable){const inss=Math.round(gross*Number(delivery.inss_percent||0)/100),sest=Math.round(gross*Number(delivery.sest_senat_percent||0)/100);if(inss)items.push({id:`derived-inss-${delivery.id}`,delivery_id:delivery.id,entry_type:'debit',category:'INSS',description:'INSS sobre entrega',amount_cents:inss,settled_cents:0,remaining_cents:inss,reference_date:date,status:'open',financial_class:'deduction',derived:true});if(sest)items.push({id:`derived-sest-${delivery.id}`,delivery_id:delivery.id,entry_type:'debit',category:'SEST/SENAT',description:'SEST/SENAT sobre entrega',amount_cents:sest,settled_cents:0,remaining_cents:sest,reference_date:date,status:'open',financial_class:'deduction',derived:true});}
  }
  items.sort((a:any,b:any)=>String(b.reference_date||'').localeCompare(String(a.reference_date||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const active=items.filter((x:any)=>x.status!=='cancelled');
  const summary=active.reduce((acc:any,x:any)=>{const amount=Number(x.amount_cents||0),remaining=Number(x.remaining_cents??Math.max(0,amount-Number(x.settled_cents||0)));if(x.entry_type==='credit'){acc.credits_cents+=amount;if(x.financial_class==='production_received')acc.direct_received_cents+=amount;else {acc.receivable_credits_cents+=amount;acc.receivable_open_cents+=remaining;if(x.financial_class==='production_receivable')acc.production_receivable_cents+=amount;else acc.other_credits_cents+=amount;}}else {acc.debits_cents+=amount;acc.pending_debits_cents+=remaining;}return acc;},{credits_cents:0,debits_cents:0,production_receivable_cents:0,direct_received_cents:0,other_credits_cents:0,receivable_credits_cents:0,receivable_open_cents:0,pending_debits_cents:0});
  summary.net_cents=summary.receivable_open_cents-summary.pending_debits_cents;summary.amount_to_receive_cents=Math.max(0,summary.net_cents);summary.debt_cents=Math.max(0,-summary.net_cents);summary.earnings_cents=summary.production_receivable_cents+summary.direct_received_cents+summary.other_credits_cents-summary.debits_cents;
  return c.json({ok:true,from,to,items,summary});
});

// CONECTORES CONFIGURADOS PELA COOPERATIVA
ligerimRoutes.get('/tenant/connectors',async(c)=>{const auth=tenantAuth(c,['cooperative_admin','dispatcher']);let sql=`SELECT i.id,i.cooperative_id,i.establishment_id,i.name,i.mode,i.base_url,i.orders_path,i.auth_type,i.auth_header,i.status,i.last_sync_at,i.last_error,i.created_at,e.name establishment_name FROM integration_connectors i JOIN establishments e ON e.id=i.establishment_id WHERE i.cooperative_id=?`;const p:any[]=[auth.cooperativeId];const rows=await c.env.DB.prepare(sql).bind(...p).all();return c.json({ok:true,items:rows.results});});
ligerimRoutes.post('/tenant/connectors',async(c)=>{const auth=tenantAuth(c,['cooperative_admin','dispatcher']);const b=await bodyJson<AnyRow>(c),estId=cleanText(b.establishment_id,100);const est=await c.env.DB.prepare(`SELECT id FROM establishments WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(estId,auth.cooperativeId).first();if(!est)return c.json({ok:false,error:'Estabelecimento inválido.'},400);const cid=id();await c.env.DB.prepare(`INSERT INTO integration_connectors (id,cooperative_id,establishment_id,name,mode,base_url,orders_path,auth_type,auth_header,encrypted_secret,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(cid,auth.cooperativeId,estId,cleanText(b.name,150),cleanText(b.mode||'inbound',20),nullableText(b.base_url,500),nullableText(b.orders_path,300),cleanText(b.auth_type||'bearer',20),nullableText(b.auth_header,100),nullableText(b.secret,1000),auth.id).run();return c.json({ok:true,id:cid},201);});

// COOPERADOS LIBERADOS PELO ESTABELECIMENTO
ligerimRoutes.get('/establishment/driver-access',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher','establishment']);
  const date=cleanText(c.req.query('date')||saoPauloDate(),10);
  const estId=auth.role==='establishment'?auth.establishmentId:cleanText(c.req.query('establishment_id'),100);
  if(!estId)return c.json({ok:false,error:'Selecione o estabelecimento.'},400);
  const est=await c.env.DB.prepare(`SELECT id FROM establishments WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(estId,auth.cooperativeId).first();
  if(!est)return c.json({ok:false,error:'Estabelecimento inválido.'},404);
  const rows=await c.env.DB.prepare(`SELECT d.id,d.name,d.phone,d.vehicle_model,d.vehicle_plate,d.online,d.last_seen_at,d.location_updated_at,
    CASE WHEN EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work' AND date(s.start_at)=date(?)) THEN 1 ELSE 0 END scheduled,
    p.id permission_id,CASE WHEN p.active=1 THEN 1 ELSE 0 END manually_allowed
    FROM drivers d
    LEFT JOIN establishment_driver_permissions p ON p.driver_id=d.id AND p.establishment_id=? AND date(p.service_date)=date(?)
    WHERE d.cooperative_id=? AND d.status='active' AND COALESCE(d.on_leave,0)=0 AND d.deleted_at IS NULL${auth.role==='establishment' ? ` AND (EXISTS(SELECT 1 FROM schedules sx WHERE sx.driver_id=d.id AND sx.establishment_id=? AND sx.deleted_at IS NULL AND sx.status IN ('scheduled','confirmed') AND COALESCE(sx.entry_type,'work')='work' AND date(sx.start_at)=date(?)) OR EXISTS(SELECT 1 FROM establishment_driver_permissions px WHERE px.driver_id=d.id AND px.establishment_id=? AND px.active=1 AND date(px.service_date)=date(?)))` : ''}
    ORDER BY scheduled DESC,manually_allowed DESC,d.online DESC,d.name`).bind(...(auth.role==='establishment'?[estId,date,estId,date,auth.cooperativeId,estId,date,estId,date]:[estId,date,estId,date,auth.cooperativeId])).all();
  return c.json({ok:true,date,establishment_id:estId,items:rows.results});
});

ligerimRoutes.post('/establishment/driver-access',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher']);
  const b=await bodyJson<AnyRow>(c),date=cleanText(b.service_date||saoPauloDate(),10);
  const estId=cleanText(b.establishment_id,100),driverId=cleanText(b.driver_id,100);
  const valid=await c.env.DB.prepare(`SELECT 1 ok FROM establishments e JOIN drivers d ON d.cooperative_id=e.cooperative_id WHERE e.id=? AND d.id=? AND e.cooperative_id=? AND e.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status='active'`).bind(estId,driverId,auth.cooperativeId).first();
  if(!valid)return c.json({ok:false,error:'Estabelecimento ou cooperado inválido.'},400);
  const permissionId=id();
  await c.env.DB.prepare(`INSERT INTO establishment_driver_permissions (id,cooperative_id,establishment_id,driver_id,service_date,active,notes,added_by) VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(establishment_id,driver_id,service_date) DO UPDATE SET active=1,notes=excluded.notes,added_by=excluded.added_by,updated_at=CURRENT_TIMESTAMP`).bind(permissionId,auth.cooperativeId,estId,driverId,date,nullableText(b.notes,500),auth.id).run();
  return c.json({ok:true});
});

ligerimRoutes.delete('/establishment/driver-access/:id',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher']);
  const item=await c.env.DB.prepare(`SELECT * FROM establishment_driver_permissions WHERE id=? AND cooperative_id=?`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();
  if(!item)return c.json({ok:false,error:'Liberação não encontrada.'},404);
  await c.env.DB.prepare(`UPDATE establishment_driver_permissions SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(item.id).run();
  return c.json({ok:true});
});

// MOTORISTAS ONLINE
ligerimRoutes.get('/tenant/online-drivers',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher','establishment']);
  let sql=`SELECT DISTINCT d.id,d.name,d.phone,d.vehicle_model,d.vehicle_plate,
    CASE WHEN d.online=1 AND datetime(d.last_seen_at)>=datetime('now','-10 minutes') THEN 1 ELSE 0 END online,
    d.last_seen_at,d.current_lat,d.current_lng,d.location_updated_at
    FROM drivers d WHERE d.cooperative_id=? AND d.status='active' AND COALESCE(d.on_leave,0)=0 AND d.deleted_at IS NULL`;
  const params:any[]=[auth.cooperativeId];
  if(auth.role==='establishment'){
    sql+=` AND (EXISTS(SELECT 1 FROM deliveries x WHERE x.assigned_driver_id=d.id AND x.establishment_id=? AND x.deleted_at IS NULL AND x.status NOT IN ('delivered','cancelled')) OR EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work' AND date(s.start_at)=date('now','-3 hours')) OR EXISTS(SELECT 1 FROM establishment_driver_permissions p WHERE p.driver_id=d.id AND p.establishment_id=? AND p.active=1 AND date(p.service_date)=date('now','-3 hours')))`;
    params.push(auth.establishmentId,auth.establishmentId,auth.establishmentId);
  }
  sql+=` ORDER BY online DESC,d.name`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ok:true,items:rows.results});
});

// ESCALAS COM ESTABELECIMENTO OU BASE
ligerimRoutes.get('/tenant/schedules',async(c)=>{const auth=tenantAuth(c,['cooperative_admin','dispatcher','establishment','driver']);const from=c.req.query('from')||saoPauloDate(),to=c.req.query('to')||from;let sql=`SELECT s.*,d.name driver_name,e.name establishment_name,b.name base_name,NULL contract_name,st.name shift_name FROM schedules s JOIN drivers d ON d.id=s.driver_id LEFT JOIN establishments e ON e.id=s.establishment_id LEFT JOIN bases b ON b.id=s.base_id LEFT JOIN shift_templates st ON st.id=s.shift_template_id WHERE s.cooperative_id=? AND s.deleted_at IS NULL AND date(s.start_at) BETWEEN date(?) AND date(?)`;const p:any[]=[auth.cooperativeId,from,to];if(auth.role==='driver'){sql+=` AND s.driver_id=?`;p.push(auth.driverId);}if(auth.role==='establishment'){sql+=` AND s.establishment_id=?`;p.push(auth.establishmentId);}sql+=` ORDER BY s.start_at,d.name`;const rows=await c.env.DB.prepare(sql).bind(...p).all();return c.json({ok:true,items:rows.results});});
ligerimRoutes.post('/tenant/schedules/generate',async(c)=>{const auth=tenantAuth(c,['cooperative_admin','dispatcher']);const b=await bodyJson<AnyRow>(c),driverId=cleanText(b.driver_id,100),startDate=cleanText(b.start_date,10),endDate=cleanText(b.end_date,10),templateId=cleanText(b.shift_template_id,100),days=Array.isArray(b.weekdays)?b.weekdays.map(Number):[];const template=await c.env.DB.prepare(`SELECT * FROM shift_templates WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(templateId,auth.cooperativeId).first<AnyRow>();const driver=await c.env.DB.prepare(`SELECT id FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND deleted_at IS NULL`).bind(driverId,auth.cooperativeId).first();if(!template||!driver||!startDate||!endDate||!days.length)return c.json({ok:false,error:'Informe cooperado, horário fixo, período e dias.'},400);const establishmentId=nullableText(b.establishment_id,100),baseId=nullableText(b.base_id,100);if(!establishmentId&&!baseId)return c.json({ok:false,error:'Selecione o estabelecimento ou a base.'},400);const group=id(),dates:any[]=[];let cursor=new Date(`${startDate}T12:00:00`),last=new Date(`${endDate}T12:00:00`);while(cursor<=last){if(days.includes(cursor.getDay())){const date=cursor.toISOString().slice(0,10),startAt=`${date}T${template.start_time}:00`,endObj=new Date(`${date}T${template.end_time}:00`);if(template.end_time<=template.start_time)endObj.setDate(endObj.getDate()+1);const endAt=endObj.toISOString().slice(0,19);const conflicts=await c.env.DB.prepare(`SELECT COUNT(*) total FROM schedules WHERE driver_id=? AND deleted_at IS NULL AND status!='cancelled' AND datetime(start_at)<datetime(?) AND datetime(end_at)>datetime(?)`).bind(driverId,endAt,startAt).first<{total:number}>();dates.push({date,startAt,endAt,conflict:Number(conflicts?.total||0)>0});}cursor.setDate(cursor.getDate()+1);}const conflictCount=dates.filter(x=>x.conflict).length;if(conflictCount&&!b.allow_conflicts)return c.json({ok:false,error:`Foram encontrados ${conflictCount} conflitos de horário. Confirme para manter mesmo assim.`,conflicts:dates.filter(x=>x.conflict)},409);const inserts=dates.map(x=>c.env.DB.prepare(`INSERT INTO schedules (id,cooperative_id,establishment_id,driver_id,start_at,end_at,status,guaranteed_cents,notes,recurrence_group_id,created_by,contract_id,shift_template_id,shift_label,base_id) VALUES (?,?,?,?,?,?,'scheduled',?,?,?,?,?,?,?,?)`).bind(id(),auth.cooperativeId,establishmentId,driverId,x.startAt,x.endAt,(baseId?0:Math.max(0,Number(template.guaranteed_cents||0))),nullableText(b.notes,500),group,auth.id,null,templateId,template.shift_label,baseId));if(inserts.length)await c.env.DB.batch(inserts);return c.json({ok:true,created:inserts.length,conflicts:conflictCount,group_id:group});});


ligerimRoutes.put('/tenant/schedules/:id',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher']);
  const before=await c.env.DB.prepare(`SELECT * FROM schedules WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();
  if(!before)return c.json({ok:false,error:'Escala não encontrada.'},404);
  const b=await bodyJson<AnyRow>(c),driverId=cleanText(b.driver_id??before.driver_id,100),establishmentId=nullableText(b.establishment_id??before.establishment_id,100),baseId=nullableText(b.base_id??before.base_id,100),templateId=nullableText(b.shift_template_id??before.shift_template_id,100);
  let startAt=cleanText(b.start_at??before.start_at,30),endAt=cleanText(b.end_at??before.end_at,30),shiftLabel=nullableText(b.shift_label??before.shift_label,100),guaranteedCents=baseId?0:Math.max(0,Number(before.guaranteed_cents||0));
  if(templateId){
    const template=await c.env.DB.prepare(`SELECT * FROM shift_templates WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(templateId,auth.cooperativeId).first<AnyRow>();
    if(!template)return c.json({ok:false,error:'Horário fixo inválido.'},400);
    const date=String(startAt||before.start_at).slice(0,10);
    startAt=`${date}T${template.start_time}:00`;
    const endDate=new Date(`${date}T${template.end_time}:00`);
    if(String(template.end_time)<=String(template.start_time))endDate.setDate(endDate.getDate()+1);
    endAt=endDate.toISOString().slice(0,19);
    shiftLabel=String(template.shift_label||template.name||'TURNO');
    guaranteedCents=(baseId||template.base_id)?0:Math.max(0,Number(template.guaranteed_cents||0));
  }
  if(!driverId||!startAt||!endAt||(!establishmentId&&!baseId))return c.json({ok:false,error:'Informe cooperado, horário e estabelecimento ou base.'},400);
  const conflict=await c.env.DB.prepare(`SELECT COUNT(*) total FROM schedules WHERE driver_id=? AND id!=? AND deleted_at IS NULL AND status!='cancelled' AND datetime(start_at)<datetime(?) AND datetime(end_at)>datetime(?)`).bind(driverId,before.id,endAt,startAt).first<{total:number}>();
  if(Number(conflict?.total||0)>0&&!b.allow_conflicts)return c.json({ok:false,error:'Este cooperado já possui outra escala nesse horário.',conflict:true},409);
  await c.env.DB.prepare(`UPDATE schedules SET driver_id=?,establishment_id=?,base_id=?,contract_id=?,shift_template_id=?,shift_label=?,start_at=?,end_at=?,guaranteed_cents=?,notes=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(driverId,establishmentId,baseId,null,templateId,shiftLabel,startAt,endAt,guaranteedCents,nullableText(b.notes??before.notes,500),cleanText(b.status??before.status,30),before.id).run();
  return c.json({ok:true});
});
ligerimRoutes.delete('/tenant/schedules/:id',async(c)=>{
  const auth=tenantAuth(c,['cooperative_admin','dispatcher']);
  const row=await c.env.DB.prepare(`SELECT id FROM schedules WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first();
  if(!row)return c.json({ok:false,error:'Escala não encontrada.'},404);
  await c.env.DB.prepare(`UPDATE schedules SET status='cancelled',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ok:true});
});

// CRÉDITOS PRÉ-PAGOS - APROVAÇÃO DA COOPERATIVA
ligerimRoutes.get('/tenant/credit-requests',async(c)=>{const auth=tenantAuth(c,['cooperative_admin']);const rows=await c.env.DB.prepare(`SELECT r.*,c.name customer_name,c.phone customer_phone,c.email customer_email FROM credit_purchase_requests r JOIN customers c ON c.id=r.customer_id WHERE r.cooperative_id=? ORDER BY r.created_at DESC`).bind(auth.cooperativeId).all();return c.json({ok:true,items:rows.results});});
ligerimRoutes.post('/tenant/credit-requests/:id/review',async(c)=>{const auth=tenantAuth(c,['cooperative_admin']);const b=await bodyJson<AnyRow>(c),decision=cleanText(b.decision,20),r=await c.env.DB.prepare(`SELECT * FROM credit_purchase_requests WHERE id=? AND status='pending' AND cooperative_id=?`).bind(c.req.param('id'),auth.cooperativeId).first<AnyRow>();if(!r)return c.json({ok:false,error:'Solicitação não encontrada.'},404);if(!['approved','rejected'].includes(decision))return c.json({ok:false,error:'Decisão inválida.'},400);await c.env.DB.prepare(`UPDATE credit_purchase_requests SET cooperative_id=?,status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(auth.cooperativeId,decision,auth.id,r.id).run();if(decision==='approved'){let wallet=await c.env.DB.prepare(`SELECT * FROM customer_wallets WHERE customer_id=?`).bind(r.customer_id).first<AnyRow>();if(!wallet){wallet={id:id()};await c.env.DB.prepare(`INSERT INTO customer_wallets (id,customer_id,balance_cents) VALUES (?,?,0)`).bind(wallet.id,r.customer_id).run();}await c.env.DB.batch([c.env.DB.prepare(`INSERT OR IGNORE INTO cooperative_customers (cooperative_id,customer_id,created_by) VALUES (?,?,?)`).bind(auth.cooperativeId,r.customer_id,auth.id),c.env.DB.prepare(`UPDATE customer_wallets SET balance_cents=balance_cents+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(r.amount_cents,wallet.id),c.env.DB.prepare(`INSERT INTO customer_wallet_transactions (id,wallet_id,cooperative_id,entry_type,category,amount_cents,description) VALUES (?,?,?,'credit','topup',?,'Crédito pré-pago aprovado')`).bind(id(),wallet.id,auth.cooperativeId,r.amount_cents)]);}return c.json({ok:true});});
