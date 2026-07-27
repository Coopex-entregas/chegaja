import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { geocodeAddress, routeBetween, routePrice, type GeoPoint } from '../lib/maps';
import { randomToken } from '../lib/crypto';
import { queueWebhookEvent } from '../lib/webhooks';
import { assertRole, bodyJson, cleanText, id, nullableText, toCents, toNumber } from '../lib/util';
import { expandJsonRows } from '../lib/rows';
import { deliveryFields } from '../lib/delivery-fields';
import { refreshDriverCompliance } from '../lib/compliance';
import { baseDirectReceivedPayment, baseReceivablePayment, isDirectReceivedDelivery, isReceivableCredit, reconcileDriverFinancialBalance } from '../lib/financial-settlement';
import { settleDueGuarantees } from '../lib/guarantees';

export const dispatchV6Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

function tenant(c: Context<AppBindings>, roles: AuthUser['role'][]): AuthUser {
  const auth = c.get('auth');
  assertRole(auth, roles);
  if (!auth.cooperativeId) throw new Error('Cooperativa não vinculada.');
  return auth;
}

function moneyCents(value: unknown): number {
  return Math.max(0, toCents(value));
}

function haversineMeters(aLat:number,aLng:number,bLat:number,bLng:number):number {
  const r=6371000,toRad=(v:number)=>v*Math.PI/180;
  const dLat=toRad(bLat-aLat),dLng=toRad(bLng-aLng);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
  return 2*r*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

function weekBounds(reference = new Date()): { start: string; end: string } {
  const d = new Date(reference.getTime());
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const start = d.toISOString().slice(0, 10);
  const e = new Date(d.getTime());
  e.setDate(e.getDate() + 6);
  return { start, end: e.toISOString().slice(0, 10) };
}

async function nextCode(c: Context<AppBindings>, cooperativeId: string, prefix = 'LG'): Promise<string> {
  const row = await c.env.DB.prepare(`
    INSERT INTO cooperative_sequences (cooperative_id,sequence_name,current_value,updated_at)
    VALUES (?,'delivery',1,CURRENT_TIMESTAMP)
    ON CONFLICT(cooperative_id,sequence_name)
    DO UPDATE SET current_value=current_value+1,updated_at=CURRENT_TIMESTAMP
    RETURNING current_value
  `).bind(cooperativeId).first<{ current_value: number }>();
  return `${prefix || 'LG'}-${String(row?.current_value || Date.now()).padStart(6, '0')}`;
}

async function servicesFor(c: Context<AppBindings>, cooperativeId: string, raw: unknown): Promise<{ total: number; items: Row[] }> {
  const ids = Array.isArray(raw) ? raw.map(String).filter(Boolean).slice(0, 30) : [];
  if (!ids.length) return { total: 0, items: [] };
  const placeholders = ids.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(`SELECT id,name,add_cents FROM services WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL AND id IN (${placeholders})`)
    .bind(cooperativeId, ...ids).all<Row>();
  const items = (rows.results || []) as Row[];
  return { total: items.reduce((sum, item) => sum + Number(item.add_cents || 0), 0), items };
}

async function valuesFor(c: Context<AppBindings>, cooperativeId: string, chargeCents: number, feePercent: number, deliveryType: 'establishment' | 'base', paymentMethod: unknown) {
  const coop = await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent,cooperative_fee_percent FROM cooperatives WHERE id=?`)
    .bind(cooperativeId).first<Row>();
  const effectiveFee = Number.isFinite(feePercent) ? feePercent : Number(coop?.cooperative_fee_percent || 0);
  const cooperativeFee = Math.round(chargeCents * Math.max(0, effectiveFee) / 100);
  const gross = Math.max(0, chargeCents - cooperativeFee);
  const taxable = deliveryType === 'establishment' || (deliveryType === 'base' && baseReceivablePayment(paymentMethod));
  const inss = taxable ? Math.round(gross * Number(coop?.inss_percent || 0) / 100) : 0;
  const sest = taxable ? Math.round(gross * Number(coop?.sest_senat_percent || 0) / 100) : 0;
  return { cooperativeFee, gross, net: Math.max(0, gross - inss - sest), inss, sest };
}

async function resolveRoute(c: Context<AppBindings>, pickupAddress: string, deliveryAddress: string, pickupPoint?: GeoPoint | null) {
  const origin = pickupPoint || await geocodeAddress(c.env, pickupAddress);
  const destination = await geocodeAddress(c.env, deliveryAddress);
  if (!origin || !destination) throw new Error('Não foi possível localizar os endereços. Informe rua, número, bairro, cidade e estado.');
  const route = await routeBetween(c.env, [origin, destination]);
  if (!route) throw new Error('Não foi possível calcular a rota neste momento.');
  return { origin, destination, route };
}

async function insertDelivery(c: Context<AppBindings>, input: {
  cooperativeId: string;
  establishmentId: string;
  baseId?: string | null;
  deliveryType: 'establishment' | 'base';
  source: string;
  prefix: string;
  customerName?: string | null;
  customerPhone?: string | null;
  pickupContactName?: string | null;
  pickupPhone?: string | null;
  pickupAddress: string;
  pickupNeighborhood?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  deliveryAddress: string;
  deliveryNeighborhood?: string | null;
  itemDescription?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string;
  notes?: string | null;
  chargeCents: number;
  servicesCents: number;
  feePercent: number;
  origin: GeoPoint;
  destination: GeoPoint;
  route: { distance_meters: number; duration_seconds: number; geometry: [number, number][] };
  serviceItems: Row[];
  createdBy: string;
}) {
  const displayCode = await nextCode(c, input.cooperativeId, input.prefix);
  const amounts = await valuesFor(c, input.cooperativeId, input.chargeCents, input.feePercent, input.deliveryType, input.paymentMethod);
  const deliveryId = id();
  const trackingToken = randomToken(24);
  await c.env.DB.prepare(`INSERT INTO deliveries (
    id,cooperative_id,establishment_id,source,customer_name,customer_phone,pickup_contact_name,pickup_phone,
    pickup_address,pickup_neighborhood,recipient_name,recipient_phone,delivery_address,delivery_neighborhood,
    item_description,pickup_lat,pickup_lng,delivery_lat,delivery_lng,status,charge_cents,driver_earnings_cents,
    cooperative_fee_cents,payment_method,payment_status,notes,tracking_token,created_by,display_code,delivery_type,
    base_id,distance_meters,duration_seconds,route_geometry,driver_gross_cents,driver_net_cents,services_cents
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    deliveryId, input.cooperativeId, input.establishmentId, input.source,
    input.customerName || null, input.customerPhone || null, input.pickupContactName || null, input.pickupPhone || null,
    input.pickupAddress, input.pickupNeighborhood || null, input.recipientName || null, input.recipientPhone || null,
    input.deliveryAddress, input.deliveryNeighborhood || null, input.itemDescription || null,
    input.origin.lat, input.origin.lng, input.destination.lat, input.destination.lng,
    input.chargeCents, amounts.gross, amounts.cooperativeFee, input.paymentMethod || null,
    input.paymentStatus || 'pending', input.notes || null, trackingToken, input.createdBy, displayCode,
    input.deliveryType, input.baseId || null, input.route.distance_meters, input.route.duration_seconds,
    JSON.stringify(input.route.geometry), amounts.gross, amounts.net, input.servicesCents
  ).run();
  if (input.serviceItems.length) {
    await c.env.DB.batch(input.serviceItems.map((service) => c.env.DB.prepare(`INSERT INTO delivery_services (delivery_id,service_id,service_name,add_cents) VALUES (?,?,?,?)`)
      .bind(deliveryId, service.id, service.name, service.add_cents)));
  }
  await c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,new_status,notes,changed_by) VALUES (?,?,?,'new',?,?)`)
    .bind(id(), deliveryId, input.cooperativeId, input.deliveryType === 'base' ? 'Entrega criada na Base' : 'Entrega de balcão criada pelo estabelecimento', input.createdBy).run();
  return {
    id: deliveryId,
    display_code: displayCode,
    tracking_token: trackingToken,
    tracking_url: `${c.env.APP_URL.replace(/\/$/, '')}/r/${trackingToken}`,
    amounts
  };
}

async function driverEligible(c: Context<AppBindings>, driverId: string, delivery: Row): Promise<boolean> {
  const online = await c.env.DB.prepare(`SELECT 1 ok FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND online=1 AND datetime(last_seen_at)>=datetime('now','-10 minutes') AND deleted_at IS NULL`)
    .bind(driverId, delivery.cooperative_id).first();
  if (!online) return false;
  if (delivery.delivery_type === 'base') {
    const scheduled = await c.env.DB.prepare(`SELECT 1 ok FROM schedules WHERE driver_id=? AND base_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND date(start_at)=date('now','-3 hours') LIMIT 1`)
      .bind(driverId, delivery.base_id).first();
    return Boolean(scheduled);
  }
  const eligible = await c.env.DB.prepare(`SELECT 1 ok WHERE EXISTS(
      SELECT 1 FROM schedules WHERE driver_id=? AND establishment_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND date(start_at)=date('now','-3 hours')
    ) OR EXISTS(
      SELECT 1 FROM establishment_driver_permissions WHERE driver_id=? AND establishment_id=? AND active=1 AND date(service_date)=date('now','-3 hours')
    ) LIMIT 1`).bind(driverId, delivery.establishment_id, driverId, delivery.establishment_id).first();
  return Boolean(eligible);
}

function canAssign(auth: AuthUser, delivery: Row): boolean {
  if (delivery.delivery_type === 'base') return ['cooperative_admin', 'dispatcher'].includes(auth.role);
  return auth.role === 'establishment' && auth.establishmentId === delivery.establishment_id;
}

async function finishFinancial(c: Context<AppBindings>, auth: AuthUser, delivery: Row) {
  const exists = await c.env.DB.prepare(`SELECT 1 ok FROM financial_entries WHERE delivery_id=? AND category='delivery' AND entry_type='credit' AND deleted_at IS NULL`)
    .bind(delivery.id).first();
  if (exists) return;
  const gross = Math.max(0,Number(delivery.driver_gross_cents || delivery.driver_earnings_cents || 0)||Math.max(0,Number(delivery.charge_cents||0)-Number(delivery.cooperative_fee_cents||0)));
  const taxable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  const direct=delivery.delivery_type==='base'&&baseDirectReceivedPayment(delivery.payment_method);
  const receivable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  if(!direct&&!receivable)return;
  const entryStatus=receivable?'open':'paid',settled=direct?gross:0;
  const coop = taxable?await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>():null;
  const inss = taxable?Math.round(gross * Number(coop?.inss_percent || 0) / 100):0;
  const sest = taxable?Math.round(gross * Number(coop?.sest_senat_percent || 0) / 100):0;
  const statements = [
    c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'credit','delivery',?,?,?,date('now','-3 hours'),?,?)`)
      .bind(id(), auth.cooperativeId, auth.driverId, delivery.establishment_id, delivery.id, `Entrega ${delivery.display_code}${receivable?'':' • recebido diretamente pelo cooperado'}`, gross, settled, entryStatus, auth.id)
  ];
  if (inss) statements.push(c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','INSS','INSS sobre entrega',?,date('now','-3 hours'),?)`)
    .bind(id(), auth.cooperativeId, auth.driverId, delivery.establishment_id, delivery.id, inss, auth.id));
  if (sest) statements.push(c.env.DB.prepare(`INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','SEST/SENAT','SEST/SENAT sobre entrega',?,date('now','-3 hours'),?)`)
    .bind(id(), auth.cooperativeId, auth.driverId, delivery.establishment_id, delivery.id, sest, auth.id));
  await c.env.DB.batch(statements);
  await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,String(auth.driverId));
}

// Entrega de balcão: somente o próprio estabelecimento cria.
dispatchV6Routes.post('/establishment/orders', async (c) => {
  const auth = tenant(c, ['establishment']);
  const body = await bodyJson<Row>(c);
  const establishment = await c.env.DB.prepare(`SELECT * FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`)
    .bind(auth.establishmentId, auth.cooperativeId).first<Row>();
  if (!establishment) return c.json({ ok: false, error: 'Estabelecimento não encontrado.' }, 404);
  const deliveryAddress = cleanText(body.delivery_address, 600);
  if (!deliveryAddress) return c.json({ ok: false, error: 'Informe o endereço de entrega.' }, 400);
  const route = await resolveRoute(c, establishment.address, deliveryAddress,
    establishment.latitude != null && establishment.longitude != null ? { lat: Number(establishment.latitude), lng: Number(establishment.longitude) } : null);
  const services = await servicesFor(c, auth.cooperativeId!, body.service_ids);
  const calculated = routePrice(route.route.distance_meters, Number(establishment.rate_per_km_cents || 0), Number(establishment.minimum_fee_cents || 0), services.total);
  const charge = body.charge_value !== undefined && body.charge_value !== '' ? moneyCents(body.charge_value) : calculated;
  const created = await insertDelivery(c, {
    cooperativeId: auth.cooperativeId!, establishmentId: establishment.id, deliveryType: 'establishment', source: 'counter',
    prefix: establishment.order_prefix || 'LG', customerName: nullableText(body.customer_name, 150), customerPhone: nullableText(body.customer_phone, 50),
    pickupContactName: establishment.name, pickupPhone: establishment.phone, pickupAddress: establishment.address,
    recipientName: nullableText(body.recipient_name, 150), recipientPhone: nullableText(body.recipient_phone, 50),
    deliveryAddress, deliveryNeighborhood: nullableText(body.delivery_neighborhood, 150), itemDescription: nullableText(body.item_description, 500),
    paymentMethod: nullableText(body.payment_method, 50), paymentStatus: cleanText(body.payment_status || 'pending', 30), notes: nullableText(body.notes, 1500),
    chargeCents: charge, servicesCents: services.total, feePercent: Number(establishment.cooperative_fee_percent || 0),
    origin: route.origin, destination: route.destination, route: route.route, serviceItems: services.items, createdBy: auth.id
  });
  c.executionCtx.waitUntil(queueWebhookEvent(c.env, auth.cooperativeId!, establishment.id, 'delivery.created', { id: created.id, display_code: created.display_code, status: 'new', delivery_type: 'establishment' }));
  return c.json({ ok: true, item: created }, 201);
});

// Entrega da Base: somente a administração da cooperativa cria.
dispatchV6Routes.post('/base/orders', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  const body = await bodyJson<Row>(c);
  const base = await c.env.DB.prepare(`SELECT * FROM bases WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`)
    .bind(cleanText(body.base_id, 100), auth.cooperativeId).first<Row>();
  if (!base) return c.json({ ok: false, error: 'Base não encontrada.' }, 404);
  const pickupAddress = cleanText(body.pickup_address, 600);
  const deliveryAddress = cleanText(body.delivery_address, 600);
  if (!pickupAddress || !deliveryAddress) return c.json({ ok: false, error: 'Informe os endereços de coleta e entrega.' }, 400);
  const route = await resolveRoute(c, pickupAddress, deliveryAddress);
  const services = await servicesFor(c, auth.cooperativeId!, body.service_ids);
  const calculated = routePrice(route.route.distance_meters, Number(base.rate_per_km_cents || 0), Number(base.minimum_fee_cents || 0), services.total);
  const charge = body.charge_value !== undefined && body.charge_value !== '' ? moneyCents(body.charge_value) : calculated;
  const created = await insertDelivery(c, {
    cooperativeId: auth.cooperativeId!, establishmentId: base.virtual_establishment_id, baseId: base.id, deliveryType: 'base', source: 'base_counter',
    prefix: 'BASE', customerName: nullableText(body.customer_name, 150), customerPhone: nullableText(body.customer_phone, 50),
    pickupContactName: nullableText(body.pickup_contact_name, 150), pickupPhone: nullableText(body.pickup_phone, 50), pickupAddress,
    pickupNeighborhood: nullableText(body.pickup_neighborhood, 150), recipientName: nullableText(body.recipient_name, 150),
    recipientPhone: nullableText(body.recipient_phone, 50), deliveryAddress, deliveryNeighborhood: nullableText(body.delivery_neighborhood, 150),
    itemDescription: nullableText(body.item_description, 500), paymentMethod: nullableText(body.payment_method, 50),
    paymentStatus: cleanText(body.payment_status || 'pending', 30), notes: nullableText(body.notes, 1500), chargeCents: charge,
    servicesCents: services.total, feePercent: Number(base.cooperative_fee_percent || 0), origin: route.origin, destination: route.destination,
    route: route.route, serviceItems: services.items, createdBy: auth.id
  });
  c.executionCtx.waitUntil(queueWebhookEvent(c.env, auth.cooperativeId!, base.virtual_establishment_id, 'delivery.created', { id: created.id, display_code: created.display_code, status: 'new', delivery_type: 'base', base_id: base.id }));
  return c.json({ ok: true, item: created }, 201);
});

dispatchV6Routes.get('/deliveries/:id/eligible-drivers', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher', 'establishment']);
  const delivery = await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(c.req.param('id'), auth.cooperativeId).first<Row>();
  if (!delivery) return c.json({ ok: false, error: 'Entrega não encontrada.' }, 404);
  if (!canAssign(auth, delivery)) {
    return c.json({ ok: false, error: delivery.delivery_type === 'base' ? 'Somente a cooperativa atribui entregas da Base.' : 'Somente o estabelecimento atribui suas entregas de balcão.' }, 403);
  }
  let sql = `SELECT d.id,d.name,d.phone,d.vehicle_model,d.vehicle_plate,d.current_lat,d.current_lng,d.location_updated_at,
    CASE WHEN d.online=1 AND datetime(d.last_seen_at)>=datetime('now','-10 minutes') THEN 1 ELSE 0 END online
    FROM drivers d WHERE d.cooperative_id=? AND d.status='active' AND d.deleted_at IS NULL
    AND d.online=1 AND datetime(d.last_seen_at)>=datetime('now','-10 minutes')`;
  const params: any[] = [auth.cooperativeId];
  if (delivery.delivery_type === 'base') {
    sql += ` AND EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.base_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=date('now','-3 hours'))`;
    params.push(delivery.base_id);
  } else {
    sql += ` AND (EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=date('now','-3 hours')) OR EXISTS(SELECT 1 FROM establishment_driver_permissions p WHERE p.driver_id=d.id AND p.establishment_id=? AND p.active=1 AND date(p.service_date)=date('now','-3 hours')))`;
    params.push(delivery.establishment_id, delivery.establishment_id);
  }
  sql += ` ORDER BY d.name`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ ok: true, items: rows.results, delivery_type: delivery.delivery_type });
});

dispatchV6Routes.post('/deliveries/:id/assign', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher', 'establishment']);
  const delivery = await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(c.req.param('id'), auth.cooperativeId).first<Row>();
  if (!delivery) return c.json({ ok: false, error: 'Entrega não encontrada.' }, 404);
  if (['delivered', 'cancelled'].includes(delivery.status)) return c.json({ ok: false, error: 'Esta entrega já foi finalizada.' }, 409);
  if (!canAssign(auth, delivery)) {
    return c.json({ ok: false, error: delivery.delivery_type === 'base' ? 'Somente a cooperativa atribui entregas da Base.' : 'Somente o estabelecimento atribui suas entregas de balcão.' }, 403);
  }
  const body = await bodyJson<Row>(c);
  const driverId = cleanText(body.driver_id, 100);
  const driver = await c.env.DB.prepare(`SELECT id,name FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND deleted_at IS NULL`)
    .bind(driverId, auth.cooperativeId).first<Row>();
  if (!driver) return c.json({ ok: false, error: 'Cooperado inválido.' }, 400);
  if (!(await driverEligible(c, driverId, delivery))) return c.json({ ok: false, error: 'O cooperado precisa estar online e escalado ou liberado para esse local hoje.' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status='assigned',assigned_by_role=?,assigned_by_user_id=?,assignment_source=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(driverId, auth.role, auth.id, delivery.delivery_type === 'base' ? 'cooperative_base' : 'establishment_counter', delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'assigned',?,?)`)
      .bind(id(), delivery.id, auth.cooperativeId, delivery.status, `Atribuída a ${driver.name}`, auth.id),
    c.env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting' AND ((? IS NOT NULL AND base_id=?) OR (? IS NOT NULL AND establishment_id=?))`)
      .bind(delivery.id,driverId,delivery.base_id,delivery.base_id,delivery.establishment_id,delivery.establishment_id)
  ]);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env, auth.cooperativeId!, delivery.establishment_id, 'delivery.assigned', { id: delivery.id, display_code: delivery.display_code, driver_id: driver.id, driver_name: driver.name, status: 'assigned' }));
  return c.json({ ok: true });
});

dispatchV6Routes.get('/driver/home', async (c) => {
  const auth = tenant(c, ['driver']);
  const { start, end } = weekBounds();
  const driver = await c.env.DB.prepare(`SELECT id,name,online,last_seen_at,current_lat,current_lng,location_updated_at FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(auth.driverId, auth.cooperativeId).first<Row>();
  const deliveries = await c.env.DB.prepare(`SELECT ${deliveryFields('x')},json_object('establishment_name',e.name,'base_name',b.name) related_json FROM deliveries x JOIN establishments e ON e.id=x.establishment_id LEFT JOIN bases b ON b.id=x.base_id WHERE x.cooperative_id=? AND x.assigned_driver_id=? AND x.deleted_at IS NULL AND x.status NOT IN ('delivered','cancelled') ORDER BY CASE x.status WHEN 'assigned' THEN 0 WHEN 'accepted' THEN 1 WHEN 'to_pickup' THEN 2 WHEN 'at_pickup' THEN 3 WHEN 'picked_up' THEN 4 WHEN 'in_route' THEN 5 ELSE 6 END,x.created_at`)
    .bind(auth.cooperativeId, auth.driverId).all<Row>();
  await settleDueGuarantees(c.env,auth.cooperativeId);
  await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,auth.driverId!);
  const financeRows=await c.env.DB.prepare(`SELECT f.*,dl.delivery_type,dl.payment_method FROM financial_entries f LEFT JOIN deliveries dl ON dl.id=f.delivery_id WHERE f.driver_id=? AND f.cooperative_id=? AND f.deleted_at IS NULL AND f.status!='cancelled' AND date(f.reference_date) BETWEEN date(?) AND date(?)`)
    .bind(auth.driverId,auth.cooperativeId,start,end).all<Row>();
  const finance=(financeRows.results||[]).reduce((acc:any,row:any)=>{
    const amount=Math.max(0,Number(row.amount_cents||0)),settled=Math.min(amount,Math.max(0,Number(row.settled_cents||0))),remaining=Math.max(0,amount-settled);
    if(row.entry_type==='credit'){
      acc.gross_cents+=amount;
      if(isDirectReceivedDelivery(row))acc.direct_received_cents+=amount;
      else if(isReceivableCredit(row)){acc.production_receivable_cents+=row.category==='delivery'?amount:0;acc.other_credits_cents+=row.category==='delivery'?0:amount;acc.receivable_open_cents+=remaining;}
    }else{acc.deductions_cents+=amount;acc.pending_debits_cents+=remaining;}
    return acc;
  },{gross_cents:0,production_receivable_cents:0,direct_received_cents:0,other_credits_cents:0,receivable_open_cents:0,deductions_cents:0,pending_debits_cents:0});
  finance.net_cents=finance.receivable_open_cents-finance.pending_debits_cents;
  finance.amount_to_receive_cents=Math.max(0,finance.net_cents);
  finance.debt_cents=Math.max(0,-finance.net_cents);
  finance.earnings_cents=finance.net_cents;
  const today = await c.env.DB.prepare(`SELECT s.*,e.name establishment_name,b.name base_name FROM schedules s LEFT JOIN establishments e ON e.id=s.establishment_id LEFT JOIN bases b ON b.id=s.base_id WHERE s.driver_id=? AND s.cooperative_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=date('now','-3 hours') ORDER BY s.start_at`)
    .bind(auth.driverId, auth.cooperativeId).all<Row>();
  const completedToday = await c.env.DB.prepare(`SELECT COUNT(*) total FROM deliveries WHERE assigned_driver_id=? AND status='delivered' AND date(delivered_at,'-3 hours')=date('now','-3 hours') AND deleted_at IS NULL`)
    .bind(auth.driverId).first<{ total: number }>();
  const safeDeliveries = expandJsonRows(deliveries.results as Row[]).map((item: Row) => item.delivery_type === 'base' ? { ...item, customer_phone: null, recipient_phone: null, pickup_phone: null } : item);
  return c.json({ ok: true, driver, online: Boolean(driver?.online && driver?.last_seen_at), week: { start, end }, finance, schedules: today.results, active_deliveries: safeDeliveries, completed_today: Number(completedToday?.total || 0) });
});

dispatchV6Routes.post('/driver/online', async (c) => {
  const auth = tenant(c, ['driver']);
  const body = await bodyJson<Row>(c);
  const online = Boolean(body.online);
  if (online) {
    const compliance=await refreshDriverCompliance(c.env,auth.driverId!);
    if(!compliance.allowed)return c.json({ok:false,error:compliance.reason||'Seu acesso está suspenso até a regularização dos documentos.'},403);
  }
  if (!online) {
    const active = await c.env.DB.prepare(`SELECT COUNT(*) total FROM deliveries WHERE assigned_driver_id=? AND status NOT IN ('delivered','cancelled','problem') AND deleted_at IS NULL`)
      .bind(auth.driverId).first<{ total: number }>();
    if (Number(active?.total || 0) > 0) return c.json({ ok: false, error: 'Finalize as entregas em andamento antes de ficar offline.' }, 409);
  }
  const lat = toNumber(body.latitude), lng = toNumber(body.longitude), accuracy = toNumber(body.accuracy);
  await c.env.DB.prepare(`UPDATE drivers SET online=?,last_seen_at=CURRENT_TIMESTAMP,current_lat=COALESCE(?,current_lat),current_lng=COALESCE(?,current_lng),location_accuracy=COALESCE(?,location_accuracy),location_updated_at=CASE WHEN ? IS NOT NULL AND ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE location_updated_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=?`)
    .bind(online ? 1 : 0, lat, lng, accuracy, lat, lng, auth.driverId, auth.cooperativeId).run();
  return c.json({ ok: true, online });
});

dispatchV6Routes.post('/driver/location', async (c) => {
  const auth = tenant(c, ['driver']);
  const compliance=await refreshDriverCompliance(c.env,auth.driverId!);
  if(!compliance.allowed)return c.json({ok:false,error:compliance.reason||'Seu acesso está suspenso até a regularização dos documentos.'},403);
  const body = await bodyJson<Row>(c);
  const lat = toNumber(body.latitude), lng = toNumber(body.longitude);
  if (lat == null || lng == null) return c.json({ ok: false, error: 'Localização inválida.' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE drivers SET online=1,last_seen_at=CURRENT_TIMESTAMP,current_lat=?,current_lng=?,location_accuracy=?,location_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=?`)
      .bind(lat, lng, toNumber(body.accuracy), auth.driverId, auth.cooperativeId),
    c.env.DB.prepare(`INSERT INTO driver_locations (cooperative_id,driver_id,latitude,longitude,accuracy,speed,heading,battery) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(auth.cooperativeId, auth.driverId, lat, lng, toNumber(body.accuracy), toNumber(body.speed), toNumber(body.heading), toNumber(body.battery))
  ]);
  const active = await c.env.DB.prepare(`SELECT id,display_code,delivery_lat,delivery_lng,customer_chat_enabled FROM deliveries WHERE cooperative_id=? AND assigned_driver_id=? AND status IN ('picked_up','in_route') AND approach_alert_sent_at IS NULL AND delivery_lat IS NOT NULL AND delivery_lng IS NOT NULL AND deleted_at IS NULL`).bind(auth.cooperativeId,auth.driverId).all<Row>();
  for (const delivery of active.results || []) {
    const remaining=haversineMeters(lat,lng,Number(delivery.delivery_lat),Number(delivery.delivery_lng));
    if (remaining<=1200) {
      const changed=await c.env.DB.prepare(`UPDATE deliveries SET approach_alert_sent_at=CURRENT_TIMESTAMP WHERE id=? AND approach_alert_sent_at IS NULL`).bind(delivery.id).run();
      if (changed.meta.changes) {
        await c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_name,message,recipient_type,conversation_key,driver_read_at,establishment_read_at,cooperative_read_at) VALUES (?,?,?,'cooperative','ChegaJá','O cooperado está próximo. Aguarde na porta ou no local combinado.','customer','customer_place',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(id(),delivery.id,auth.cooperativeId).run();
      }
    }
  }
  return c.json({ ok: true });
});

dispatchV6Routes.post('/driver/deliveries/:id/accept', async (c) => {
  const auth = tenant(c, ['driver']);
  const compliance=await refreshDriverCompliance(c.env,auth.driverId!);
  if(!compliance.allowed)return c.json({ok:false,error:compliance.reason||'Seu acesso está suspenso até a regularização dos documentos.'},403);
  const delivery = await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL`)
    .bind(c.req.param('id'), auth.cooperativeId, auth.driverId).first<Row>();
  if (!delivery) return c.json({ ok: false, error: 'Entrega não encontrada ou não atribuída a você.' }, 404);
  const online = await c.env.DB.prepare(`SELECT 1 ok FROM drivers WHERE id=? AND online=1 AND datetime(last_seen_at)>=datetime('now','-10 minutes')`).bind(auth.driverId).first();
  if (!online) return c.json({ ok: false, error: 'Fique online para aceitar a entrega.' }, 409);
  const result = await c.env.DB.prepare(`UPDATE deliveries SET status='accepted',accepted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND assigned_driver_id=? AND status='assigned'`)
    .bind(delivery.id, auth.driverId).run();
  if (!result.meta.changes) return c.json({ ok: false, error: 'A entrega não está disponível para aceite.' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,changed_by) VALUES (?,?,?,?,'accepted',?)`).bind(id(), delivery.id, auth.cooperativeId, delivery.status, auth.id),
    c.env.DB.prepare(`UPDATE delivery_offer_attempts SET status='accepted',responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=? AND driver_id=? AND status='pending'`).bind(delivery.id,auth.driverId),
    c.env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting' AND ((? IS NOT NULL AND base_id=?) OR (? IS NOT NULL AND establishment_id=?))`).bind(delivery.id,auth.driverId,delivery.base_id,delivery.base_id,delivery.establishment_id,delivery.establishment_id)
  ]);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env, auth.cooperativeId!, delivery.establishment_id, 'delivery.status_changed', { id: delivery.id, display_code: delivery.display_code, status: 'accepted' }));
  return c.json({ ok: true, tracking_url: `${c.env.APP_URL.replace(/\/$/, '')}/r/${delivery.tracking_token}` });
});

dispatchV6Routes.post('/driver/deliveries/:id/status', async (c) => {
  const auth = tenant(c, ['driver']);
  const body = await bodyJson<Row>(c);
  const next = cleanText(body.status, 30);
  const delivery = await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL`)
    .bind(c.req.param('id'), auth.cooperativeId, auth.driverId).first<Row>();
  if (!delivery) return c.json({ ok: false, error: 'Entrega não encontrada.' }, 404);
  const transitions: Record<string, string[]> = {
    accepted: ['to_pickup', 'problem'],
    to_pickup: ['at_pickup', 'problem'],
    at_pickup: ['picked_up', 'problem'],
    picked_up: ['in_route', 'problem'],
    in_route: ['problem'],
    problem: ['to_pickup', 'in_route']
  };
  if (!(transitions[delivery.status] || []).includes(next)) return c.json({ ok: false, error: 'Esta mudança de status não é permitida.' }, 409);
  const timeSql = next === 'picked_up' ? ',picked_up_at=CURRENT_TIMESTAMP' : '';
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET status=?,updated_at=CURRENT_TIMESTAMP${timeSql} WHERE id=?`).bind(next, delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`)
      .bind(id(), delivery.id, auth.cooperativeId, delivery.status, next, nullableText(body.notes, 500), auth.id)
  ]);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env, auth.cooperativeId!, delivery.establishment_id, 'delivery.status_changed', { id: delivery.id, display_code: delivery.display_code, status: next }));
  return c.json({ ok: true });
});

dispatchV6Routes.get('/notifications', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher', 'establishment', 'driver']);
  const after = Math.max(0, Number(c.req.query('after') || 0));
  const initial = c.req.query('initial') === '1';
  let where = `n.cooperative_id=?`;
  const params: any[] = [auth.cooperativeId];
  if (auth.role === 'driver') {
    where += ` AND n.driver_id=?`;
    params.push(auth.driverId);
  } else if (auth.role === 'establishment') {
    where += ` AND (n.establishment_id=? OR (n.event_type IN ('driver_online','driver_offline') AND EXISTS(
      SELECT 1 FROM schedules s WHERE s.driver_id=n.driver_id AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=date('now','-3 hours')
    )) OR (n.event_type IN ('driver_online','driver_offline') AND EXISTS(
      SELECT 1 FROM establishment_driver_permissions p WHERE p.driver_id=n.driver_id AND p.establishment_id=? AND p.active=1 AND date(p.service_date)=date('now','-3 hours')
    )))`;
    params.push(auth.establishmentId, auth.establishmentId, auth.establishmentId);
  }
  const max = await c.env.DB.prepare(`SELECT COALESCE(MAX(n.seq),0) cursor FROM notification_events n WHERE ${where}`).bind(...params).first<{ cursor: number }>();
  if (initial) return c.json({ ok: true, cursor: Number(max?.cursor || 0), items: [] });
  const rows = await c.env.DB.prepare(`SELECT n.seq,n.event_type,n.title,n.message,n.delivery_id,n.driver_id,n.establishment_id,n.created_at,d.display_code,d.status,d.delivery_type FROM notification_events n LEFT JOIN deliveries d ON d.id=n.delivery_id WHERE ${where} AND n.seq>? ORDER BY n.seq ASC LIMIT 100`)
    .bind(...params, after).all();
  return c.json({ ok: true, cursor: Number(max?.cursor || after), items: rows.results });
});
