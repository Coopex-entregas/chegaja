import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { addressJson, addressPoint, readAddressConfirmationToken } from '../lib/address';
import { randomToken } from '../lib/crypto';
import { routeBetween, routePrice, type AddressCandidate } from '../lib/maps';
import { queueWebhookEvent } from '../lib/webhooks';
import { assignNextBaseDriver, assignNextEstablishmentDriver } from '../lib/queue';
import { reconcileDeliveryCredit } from '../lib/wallet';
import { assertRole, bodyJson, cleanText, id, nullableText, toCents } from '../lib/util';
import { expandJsonRow } from '../lib/rows';
import { deliveryFields } from '../lib/delivery-fields';
import { baseDirectReceivedPayment, baseReceivablePayment, reconcileDriverFinancialBalance } from '../lib/financial-settlement';

export const dispatchV7Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

function normalizePayment(value:unknown){
  const raw=String(value||'pix').trim().toLowerCase();
  if(['credit','credito','credito_antecipado','crédito antecipado','credito_automatico','crédito automático','prepaid','pre_pago'].includes(raw))return 'credit';
  if(['pix_cooperativa','pix cooperativa','pix-cooperativa'].includes(raw))return 'pix_cooperativa';
  if(['dinheiro','cash'].includes(raw))return 'dinheiro';
  if(['cartao_credito','cartão de crédito','cartao de credito','credito_cartao'].includes(raw))return 'cartao_credito';
  if(['cartao_debito','cartão de débito','cartao de debito','debito_cartao'].includes(raw))return 'cartao_debito';
  if(['vale_alimentacao','vale alimentação','vale-alimentação'].includes(raw))return 'vale_alimentacao';
  if(['vale_refeicao','vale refeição','vale-refeição'].includes(raw))return 'vale_refeicao';
  if(['cortesia','gratis','gratuito'].includes(raw))return 'cortesia';
  return 'pix';
}

function tenant(c: Context<AppBindings>, roles: AuthUser['role'][]): AuthUser {
  const auth = c.get('auth');
  assertRole(auth, roles);
  if (!auth.cooperativeId) throw new Error('Cooperativa não vinculada.');
  return auth;
}

function weekBounds(startRaw: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) throw new Error('Informe a data inicial da semana.');
  const startDate = new Date(`${startRaw}T12:00:00`);
  if (Number.isNaN(startDate.getTime())) throw new Error('Data da semana inválida.');
  const endDate = new Date(startDate.getTime());
  endDate.setDate(endDate.getDate() + 6);
  return { start: startRaw, end: endDate.toISOString().slice(0, 10) };
}

async function nextDisplayCode(c: Context<AppBindings>, cooperativeId: string, prefix: string): Promise<string> {
  const row = await c.env.DB.prepare(`
    INSERT INTO cooperative_sequences (cooperative_id,sequence_name,current_value,updated_at)
    VALUES (?,'delivery',1,CURRENT_TIMESTAMP)
    ON CONFLICT(cooperative_id,sequence_name)
    DO UPDATE SET current_value=current_value+1,updated_at=CURRENT_TIMESTAMP
    RETURNING current_value
  `).bind(cooperativeId).first<{ current_value: number }>();
  return `${prefix}-${String(row?.current_value || Date.now()).padStart(6, '0')}`;
}

async function uniqueConfirmationCode(c: Context<AppBindings>, phone: string | null): Promise<string> {
  const used = new Set<string>();
  if (phone) {
    const rows = await c.env.DB.prepare(`
      SELECT DISTINCT confirmation_code FROM deliveries
      WHERE confirmation_code IS NOT NULL
        AND (customer_phone=? OR recipient_phone=?)
      LIMIT 9000
    `).bind(phone, phone).all<{ confirmation_code: string }>();
    for (const row of rows.results || []) used.add(String(row.confirmation_code));
  }
  const buffer = new Uint32Array(1);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    crypto.getRandomValues(buffer);
    const value = String(1000 + (buffer[0] % 9000));
    if (!used.has(value)) return value;
  }
  for (let value = 1000; value <= 9999; value += 1) {
    if (!used.has(String(value))) return String(value);
  }
  throw new Error('Não foi possível gerar o código de confirmação.');
}

async function loadServices(c: Context<AppBindings>, cooperativeId: string, raw: unknown): Promise<{ items: Row[]; total: number }> {
  const ids = Array.isArray(raw) ? raw.map(String).filter(Boolean).slice(0, 40) : [];
  if (!ids.length) return { items: [], total: 0 };
  const marks = ids.map(() => '?').join(',');
  const result = await c.env.DB.prepare(`
    SELECT id,name,add_cents FROM services
    WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL AND id IN (${marks})
  `).bind(cooperativeId, ...ids).all<Row>();
  const items = (result.results || []) as Row[];
  return { items, total: items.reduce((sum, item) => sum + Number(item.add_cents || 0), 0) };
}

async function amounts(c: Context<AppBindings>, cooperativeId: string, chargeCents: number, feePercent: number, deliveryType: 'establishment' | 'base', paymentMethod: unknown) {
  const coop = await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`)
    .bind(cooperativeId).first<Row>();
  const fee = Math.round(chargeCents * Math.max(0, feePercent) / 100);
  const gross = Math.max(0, chargeCents - fee);
  const taxable = deliveryType === 'establishment' || (deliveryType === 'base' && baseReceivablePayment(paymentMethod));
  const inss = taxable ? Math.round(gross * Number(coop?.inss_percent || 0) / 100) : 0;
  const sest = taxable ? Math.round(gross * Number(coop?.sest_senat_percent || 0) / 100) : 0;
  return { fee, gross, inss, sest, net: Math.max(0, gross - inss - sest) };
}

async function finishFinancial(c: Context<AppBindings>, auth: AuthUser, delivery: Row) {
  const duplicate = await c.env.DB.prepare(`
    SELECT 1 ok FROM financial_entries
    WHERE delivery_id=? AND category='delivery' AND entry_type='credit' AND deleted_at IS NULL
  `).bind(delivery.id).first();
  if (duplicate) return;
  const gross = Math.max(0,Number(delivery.driver_gross_cents || delivery.driver_earnings_cents || 0)||Math.max(0,Number(delivery.charge_cents||0)-Number(delivery.cooperative_fee_cents||0)));
  const taxable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  const direct=delivery.delivery_type==='base'&&baseDirectReceivedPayment(delivery.payment_method);
  const receivable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  if(!direct&&!receivable)return;
  const entryStatus=receivable?'open':'paid',settled=direct?gross:0;
  const coop = taxable?await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`)
    .bind(auth.cooperativeId).first<Row>():null;
  const inss = taxable?Math.round(gross * Number(coop?.inss_percent || 0) / 100):0;
  const sest = taxable?Math.round(gross * Number(coop?.sest_senat_percent || 0) / 100):0;
  const entries = [
    c.env.DB.prepare(`
      INSERT INTO financial_entries
      (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by)
      VALUES (?,?,?,?,?,'credit','delivery',?,?,?,date('now'),?,?)
    `).bind(id(), auth.cooperativeId, auth.driverId, delivery.establishment_id, delivery.id, `Entrega ${delivery.display_code}${receivable?'':' • recebido diretamente pelo cooperado'}`, gross, settled, entryStatus, auth.id)
  ];
  if (inss) entries.push(c.env.DB.prepare(`
    INSERT INTO financial_entries
    (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by)
    VALUES (?,?,?,?,?,'debit','INSS','INSS sobre entrega',?,date('now'),?)
  `).bind(id(), auth.cooperativeId, auth.driverId, delivery.establishment_id, delivery.id, inss, auth.id));
  if (sest) entries.push(c.env.DB.prepare(`
    INSERT INTO financial_entries
    (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by)
    VALUES (?,?,?,?,?,'debit','SEST/SENAT','SEST/SENAT sobre entrega',?,date('now'),?)
  `).bind(id(), auth.cooperativeId, auth.driverId, delivery.establishment_id, delivery.id, sest, auth.id));
  await c.env.DB.batch(entries);
  await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,String(auth.driverId));
}

function candidateData(candidate: AddressCandidate) {
  return {
    text: candidate.formatted_address,
    neighborhood: candidate.neighborhood || null,
    point: addressPoint(candidate),
    json: addressJson(candidate),
    placeId: candidate.provider_id || null
  };
}

async function insertOrder(c: Context<AppBindings>, input: {
  cooperativeId: string; establishmentId: string; baseId?: string | null; deliveryType: 'establishment' | 'base'; source: string;
  prefix: string; pickup: AddressCandidate; destination: AddressCandidate; customerName?: string | null; customerPhone?: string | null; customerId?: string | null;
  pickupContactName?: string | null; pickupPhone?: string | null; recipientName?: string | null; recipientPhone?: string | null;
  pickupApartment?: string | null; pickupComplement?: string | null; deliveryApartment?: string | null; deliveryComplement?: string | null;
  itemDescription?: string | null; paymentMethod?: string | null; paymentStatus?: string; cashPaymentLocation?: string | null;
  amountToCollect?: unknown; notes?: string | null; serviceIds?: unknown; feePercent: number; ratePerKmCents: number; minimumFeeCents: number;
  manualCharge?: unknown; trackingEnabled: boolean; createdBy: string;
}) {
  const route = await routeBetween(c.env, [addressPoint(input.pickup), addressPoint(input.destination)]);
  if (!route) throw new Error('Não foi possível calcular a rota pelas ruas entre os endereços confirmados.');
  const services = await loadServices(c, input.cooperativeId, input.serviceIds);
  const calculated = routePrice(route.distance_meters, input.ratePerKmCents, input.minimumFeeCents, services.total);
  const charge = input.manualCharge !== undefined && input.manualCharge !== '' ? Math.max(0, toCents(input.manualCharge)) : calculated;
  const values = await amounts(c, input.cooperativeId, charge, input.feePercent, input.deliveryType, input.paymentMethod);
  const displayCode = await nextDisplayCode(c, input.cooperativeId, input.prefix);
  const deliveryId = id();
  const trackingToken = randomToken(24);
  const confirmationCode = await uniqueConfirmationCode(c, input.recipientPhone || input.customerPhone || null);
  const pickup = candidateData(input.pickup);
  const destination = candidateData(input.destination);
  const cashLocation = input.paymentMethod === 'dinheiro' ? cleanText(input.cashPaymentLocation, 20) : null;
  const amountToCollect = input.paymentMethod === 'cortesia' ? 0 : Math.max(0, toCents(input.amountToCollect));
  if (input.paymentMethod === 'dinheiro' && !['pickup', 'delivery'].includes(String(cashLocation))) {
    throw new Error('Informe se o pagamento em dinheiro será feito na coleta ou na entrega.');
  }
  const statements = [
    c.env.DB.prepare(`INSERT INTO deliveries (
      id,cooperative_id,establishment_id,source,customer_name,customer_phone,pickup_contact_name,pickup_phone,
      pickup_address,pickup_neighborhood,recipient_name,recipient_phone,delivery_address,delivery_neighborhood,item_description,
      pickup_lat,pickup_lng,delivery_lat,delivery_lng,status,charge_cents,driver_earnings_cents,cooperative_fee_cents,
      payment_method,payment_status,notes,tracking_token,created_by,display_code,delivery_type,base_id,distance_meters,
      duration_seconds,route_geometry,driver_gross_cents,driver_net_cents,services_cents,tracking_enabled,
      pickup_address_json,delivery_address_json,pickup_place_id,delivery_place_id,addresses_confirmed,cash_payment_location,confirmation_code,
      pickup_apartment,pickup_complement,delivery_apartment,delivery_complement,amount_to_collect_cents
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        deliveryId, input.cooperativeId, input.establishmentId, input.source, input.customerName || null, input.customerPhone || null,
        input.pickupContactName || null, input.pickupPhone || null, pickup.text, pickup.neighborhood, input.recipientName || null,
        input.recipientPhone || null, destination.text, destination.neighborhood, input.itemDescription || null,
        pickup.point.lat, pickup.point.lng, destination.point.lat, destination.point.lng, charge, values.gross, values.fee,
        input.paymentMethod || null, input.paymentStatus || 'pending', input.notes || null, trackingToken, input.createdBy,
        displayCode, input.deliveryType, input.baseId || null, route.distance_meters, route.duration_seconds,
        JSON.stringify(route.geometry), values.gross, values.net, services.total, input.trackingEnabled ? 1 : 0,
        pickup.json, destination.json, pickup.placeId, destination.placeId, 1, cashLocation, confirmationCode,
        input.pickupApartment || null, input.pickupComplement || null, input.deliveryApartment || null, input.deliveryComplement || null,
        amountToCollect
      ),
    c.env.DB.prepare(`
      INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,new_status,notes,changed_by)
      VALUES (?,?,?,'new',?,?)
    `).bind(id(), deliveryId, input.cooperativeId, input.deliveryType === 'base' ? 'Entrega criada pela Base com endereços confirmados' : 'Entrega de balcão criada com endereço confirmado', input.createdBy)
  ];
  if (input.customerId) {
    statements.push(c.env.DB.prepare(`UPDATE deliveries SET customer_id=? WHERE id=?`).bind(input.customerId,deliveryId));
    statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO cooperative_customers(cooperative_id,customer_id,created_by) VALUES (?,?,?)`).bind(input.cooperativeId,input.customerId,input.createdBy));
  }
  for (const service of services.items) {
    statements.push(c.env.DB.prepare(`INSERT INTO delivery_services (delivery_id,service_id,service_name,add_cents) VALUES (?,?,?,?)`)
      .bind(deliveryId, service.id, service.name, service.add_cents));
  }
  await c.env.DB.batch(statements);
  return {
    id: deliveryId, display_code: displayCode, confirmation_code: confirmationCode,
    charge_cents: charge, amount_to_collect_cents: amountToCollect, distance_meters: route.distance_meters, duration_seconds: route.duration_seconds,
    tracking_enabled: input.trackingEnabled,
    tracking_url: input.trackingEnabled ? `${c.env.APP_URL.replace(/\/$/, '')}/r/${trackingToken}` : null
  };
}

// Perfil operacional do estabelecimento autenticado, inclusive endereço confirmado.
dispatchV7Routes.get('/establishment/profile', async (c) => {
  const auth = tenant(c, ['establishment']);
  const item = await c.env.DB.prepare(`
    SELECT id,name,address,address_json,address_place_id,address_confirmed,latitude,longitude,city,state,postal_code,
      rate_per_km_cents,minimum_fee_cents,cooperative_fee_percent,tracking_enabled,order_prefix,checkin_token,queue_radius_meters
    FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL
  `).bind(auth.establishmentId, auth.cooperativeId).first<Row>();
  if (!item) return c.json({ ok: false, error: 'Estabelecimento não encontrado.' }, 404);
  return c.json({ ok: true, item });
});

// A cooperativa confirma ou troca o endereço exato de um estabelecimento.
dispatchV7Routes.put('/establishments/:id/address', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  const candidate = await readAddressConfirmationToken(c.env, (await bodyJson<Row>(c)).confirmation_token);
  const result = await c.env.DB.prepare(`
    UPDATE establishments SET address=?,address_json=?,address_place_id=?,address_confirmed=1,latitude=?,longitude=?,
      city=?,state=?,postal_code=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND cooperative_id=? AND deleted_at IS NULL
  `).bind(candidate.formatted_address, addressJson(candidate), candidate.provider_id || null, candidate.lat, candidate.lng,
    candidate.city, candidate.state_code || candidate.state, candidate.postal_code || null, c.req.param('id'), auth.cooperativeId).run();
  if (!result.meta.changes) return c.json({ ok: false, error: 'Estabelecimento não encontrado.' }, 404);
  return c.json({ ok: true, item: candidate });
});

// Endereço confirmado do estabelecimento. O estabelecimento precisa confirmar a própria origem uma vez.
dispatchV7Routes.put('/establishment/address', async (c) => {
  const auth = tenant(c, ['establishment']);
  const candidate = await readAddressConfirmationToken(c.env, (await bodyJson<Row>(c)).confirmation_token);
  await c.env.DB.prepare(`
    UPDATE establishments SET address=?,address_json=?,address_place_id=?,address_confirmed=1,latitude=?,longitude=?,
      city=?,state=?,postal_code=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND cooperative_id=?
  `).bind(candidate.formatted_address, addressJson(candidate), candidate.provider_id || null, candidate.lat, candidate.lng,
    candidate.city, candidate.state_code || candidate.state, candidate.postal_code || null, auth.establishmentId, auth.cooperativeId).run();
  return c.json({ ok: true, item: candidate });
});

// Cadastro e edição de Base com endereço estruturado confirmado.
dispatchV7Routes.post('/bases', async (c) => {
  const auth = tenant(c, ['cooperative_admin']);
  const body = await bodyJson<Row>(c);
  const name = cleanText(body.name, 150);
  if (!name) return c.json({ ok: false, error: 'Informe o nome da Base.' }, 400);
  const candidate = await readAddressConfirmationToken(c.env, body.confirmation_token);
  const baseId = id();
  const establishmentId = id();
  const rate = Math.max(0, toCents(body.rate_per_km ?? 2.5));
  const minimum = Math.max(0, toCents(body.minimum_fee ?? 12));
  const fee = Math.max(0, Number(body.cooperative_fee_percent || 0));
  const tracking = body.tracking_enabled === false ? 0 : 1;
  const checkinRadius = Math.max(30, Math.min(2000, Number(body.checkin_radius_meters || 250)));
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO establishments (
        id,cooperative_id,name,address,city,state,postal_code,latitude,longitude,checkin_token,active,
        rate_per_km_cents,minimum_fee_cents,cooperative_fee_percent,order_prefix,tracking_enabled,
        address_json,address_confirmed,address_place_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,'BASE',?,?,1,?)
    `).bind(
      establishmentId, auth.cooperativeId, `Base — ${name}`, candidate.formatted_address,
      candidate.city, candidate.state_code || candidate.state, candidate.postal_code || null,
      candidate.lat, candidate.lng, randomToken(24), rate, minimum, fee, tracking,
      addressJson(candidate), candidate.provider_id || null
    ),
    c.env.DB.prepare(`
      INSERT INTO bases (
        id,cooperative_id,name,address,city,state,postal_code,latitude,longitude,minimum_fee_cents,
        rate_per_km_cents,cooperative_fee_percent,qr_token,virtual_establishment_id,active,tracking_enabled,
        address_json,address_confirmed,address_place_id,checkin_radius_meters
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,1,?,?)
    `).bind(
      baseId, auth.cooperativeId, name, candidate.formatted_address, candidate.city,
      candidate.state_code || candidate.state, candidate.postal_code || null, candidate.lat, candidate.lng,
      minimum, rate, fee, randomToken(24), establishmentId, tracking, addressJson(candidate), candidate.provider_id || null, checkinRadius
    )
  ]);
  return c.json({ ok: true, id: baseId }, 201);
});

dispatchV7Routes.put('/bases/:id', async (c) => {
  const auth = tenant(c, ['cooperative_admin']);
  const body = await bodyJson<Row>(c);
  const before = await c.env.DB.prepare(`SELECT * FROM bases WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(c.req.param('id'), auth.cooperativeId).first<Row>();
  if (!before) return c.json({ ok: false, error: 'Base não encontrada.' }, 404);
  const candidate = String(body.confirmation_token || '').trim()
    ? await readAddressConfirmationToken(c.env, body.confirmation_token)
    : null;
  const name = cleanText(body.name ?? before.name, 150);
  const rate = body.rate_per_km !== undefined ? Math.max(0, toCents(body.rate_per_km)) : Number(before.rate_per_km_cents || 0);
  const minimum = body.minimum_fee !== undefined ? Math.max(0, toCents(body.minimum_fee)) : Number(before.minimum_fee_cents || 0);
  const fee = body.cooperative_fee_percent !== undefined ? Math.max(0, Number(body.cooperative_fee_percent || 0)) : Number(before.cooperative_fee_percent || 0);
  const active = body.active === undefined ? Number(before.active || 0) : (body.active ? 1 : 0);
  const checkinRadius = body.checkin_radius_meters === undefined ? Number(before.checkin_radius_meters || 250) : Math.max(30, Math.min(2000, Number(body.checkin_radius_meters || 250)));
  const address = candidate?.formatted_address || before.address;
  const city = candidate?.city || before.city;
  const state = candidate ? (candidate.state_code || candidate.state) : before.state;
  const postalCode = candidate?.postal_code || before.postal_code;
  const latitude = candidate?.lat ?? before.latitude;
  const longitude = candidate?.lng ?? before.longitude;
  const json = candidate ? addressJson(candidate) : before.address_json;
  const placeId = candidate?.provider_id || before.address_place_id;
  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE bases SET name=?,address=?,city=?,state=?,postal_code=?,latitude=?,longitude=?,minimum_fee_cents=?,
        rate_per_km_cents=?,cooperative_fee_percent=?,active=?,address_json=?,address_confirmed=1,address_place_id=?,checkin_radius_meters=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(name, address, city, state, postalCode, latitude, longitude, minimum, rate, fee, active, json, placeId, checkinRadius, before.id),
    c.env.DB.prepare(`
      UPDATE establishments SET name=?,address=?,city=?,state=?,postal_code=?,latitude=?,longitude=?,rate_per_km_cents=?,
        minimum_fee_cents=?,cooperative_fee_percent=?,address_json=?,address_confirmed=1,address_place_id=?,active=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(`Base — ${name}`, address, city, state, postalCode, latitude, longitude, rate, minimum, fee, json, placeId, active, before.virtual_establishment_id)
  ]);
  return c.json({ ok: true });
});

// Endereço confirmado da Base.
dispatchV7Routes.put('/bases/:id/address', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  const candidate = await readAddressConfirmationToken(c.env, (await bodyJson<Row>(c)).confirmation_token);
  const result = await c.env.DB.prepare(`
    UPDATE bases SET address=?,address_json=?,address_place_id=?,address_confirmed=1,latitude=?,longitude=?,
      city=?,state=?,postal_code=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND cooperative_id=? AND deleted_at IS NULL
  `).bind(candidate.formatted_address, addressJson(candidate), candidate.provider_id || null, candidate.lat, candidate.lng,
    candidate.city, candidate.state_code || candidate.state, candidate.postal_code || null, c.req.param('id'), auth.cooperativeId).run();
  if (!result.meta.changes) return c.json({ ok: false, error: 'Base não encontrada.' }, 404);
  return c.json({ ok: true, item: candidate });
});

// Balcão: o próprio estabelecimento cria e depois atribui.
dispatchV7Routes.post('/establishment/orders', async (c) => {
  const auth = tenant(c, ['establishment']);
  const body = await bodyJson<Row>(c);
  const paymentMethod = normalizePayment(body.payment_method);
  const requestedPaymentStatus = cleanText(body.payment_status || 'pending',30);
  const paymentStatus = paymentMethod === 'cortesia' ? 'paid' : requestedPaymentStatus;
  if (!['pix','dinheiro','cartao_credito','cartao_debito','vale_alimentacao','vale_refeicao','cortesia'].includes(paymentMethod)) return c.json({ ok:false, error:'Informe a forma de pagamento do estabelecimento.' },400);
  if (!['pending','paid'].includes(paymentStatus)) return c.json({ ok:false, error:'Informe se o pagamento está pendente ou pago.' },400);
  const establishment = await c.env.DB.prepare(`SELECT * FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`)
    .bind(auth.establishmentId, auth.cooperativeId).first<Row>();
  if (!establishment) return c.json({ ok: false, error: 'Estabelecimento não encontrado.' }, 404);
  if (!establishment.address_confirmed || !establishment.address_json) {
    return c.json({ ok: false, error: 'Confirme primeiro o endereço completo do estabelecimento, incluindo o número.' }, 409);
  }
  const pickup = JSON.parse(establishment.address_json) as Record<string, any>;
  const pickupCandidate: AddressCandidate = {
    provider: pickup.provider || 'google', provider_id: pickup.provider_id || establishment.address_place_id || '',
    formatted_address: pickup.formatted_address || establishment.address, display_name: pickup.formatted_address || establishment.address,
    street: pickup.street || '', number: pickup.number || '', neighborhood: pickup.neighborhood || '', city: pickup.city || establishment.city || '',
    state: pickup.state || establishment.state || '', state_code: pickup.state_code || establishment.state || '', postal_code: pickup.postal_code || establishment.postal_code || '',
    country: pickup.country || 'Brasil', lat: Number(pickup.latitude ?? establishment.latitude), lng: Number(pickup.longitude ?? establishment.longitude),
    precision: pickup.precision || 'rooftop', exact_number: true, exact_city: true, exact_state: true
  };
  const destination = await readAddressConfirmationToken(c.env, body.delivery_confirmation_token);
  const trackingEnabled = Number(establishment.tracking_enabled ?? 1) === 1;
  const created = await insertOrder(c, {
    cooperativeId: auth.cooperativeId!, establishmentId: establishment.id, deliveryType: 'establishment', source: 'counter_v7',
    prefix: establishment.order_prefix || 'LG', pickup: pickupCandidate, destination,
    customerName: nullableText(body.customer_name, 150), customerPhone: nullableText(body.customer_phone, 50),
    pickupContactName: establishment.name, pickupPhone: establishment.phone,
    recipientName: nullableText(body.recipient_name, 150), recipientPhone: nullableText(body.recipient_phone, 50),
    pickupApartment: nullableText(body.pickup_apartment, 80), pickupComplement: nullableText(body.pickup_complement, 250),
    deliveryApartment: nullableText(body.delivery_apartment, 80), deliveryComplement: nullableText(body.delivery_complement, 250),
    itemDescription: nullableText(body.item_description, 500), paymentMethod,
    paymentStatus, amountToCollect: body.amount_to_collect, cashPaymentLocation: nullableText(body.cash_payment_location, 20),
    notes: nullableText(body.notes, 1500), serviceIds: body.service_ids, feePercent: Number(establishment.cooperative_fee_percent || 0),
    ratePerKmCents: Number(establishment.rate_per_km_cents || 0), minimumFeeCents: Number(establishment.minimum_fee_cents || 0),
    trackingEnabled, createdBy: auth.id
  });
  const confirmationMode = String(establishment.confirmation_mode || 'required');
  await c.env.DB.prepare(`UPDATE deliveries SET confirmation_required=?,finish_without_code_authorized=?,confirmation_code=CASE WHEN ?='disabled' THEN NULL ELSE confirmation_code END,customer_chat_enabled=?,driver_call_enabled=? WHERE id=?`)
    .bind(confirmationMode==='required'?1:0,confirmationMode==='optional'||confirmationMode==='disabled'?1:0,confirmationMode,Number(establishment.customer_chat_enabled??1),Number(establishment.driver_call_enabled??0),created.id).run();
  if (confirmationMode==='disabled') (created as Row).confirmation_code = null;
  const automaticAssignment = await assignNextEstablishmentDriver(c.env,{cooperativeId:auth.cooperativeId!,establishmentId:establishment.id,deliveryId:created.id,changedBy:auth.id});
  if(automaticAssignment.assigned){
    (created as Row).status='assigned';
    (created as Row).assigned_driver_id=automaticAssignment.driverId;
    (created as Row).assigned_driver_name=automaticAssignment.driverName;
  }
  c.executionCtx.waitUntil(queueWebhookEvent(c.env, auth.cooperativeId!, establishment.id, 'delivery.created', { ...created, status:(created as Row).status||'new', delivery_type: 'establishment' }));
  return c.json({ ok: true, item: created, automatic_assignment: automaticAssignment }, 201);
});

// Base: administração da cooperativa cria e atribui.
dispatchV7Routes.post('/base/orders', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  const body = await bodyJson<Row>(c);
  const base = await c.env.DB.prepare(`SELECT * FROM bases WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`)
    .bind(cleanText(body.base_id, 100), auth.cooperativeId).first<Row>();
  if (!base) return c.json({ ok: false, error: 'Base não encontrada.' }, 404);
  const pickup = await readAddressConfirmationToken(c.env, body.pickup_confirmation_token);
  const destination = await readAddressConfirmationToken(c.env, body.delivery_confirmation_token);
  const cooperative = await c.env.DB.prepare(`SELECT base_tracking_enabled FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>();
  const trackingEnabled = Number(base.tracking_enabled ?? cooperative?.base_tracking_enabled ?? 1) === 1;
  const paymentMethod = normalizePayment(body.payment_method);
  const customerId = nullableText(body.customer_id,100);
  let customer: Row | null = null;
  if (customerId) {
    customer = await c.env.DB.prepare(`SELECT c.* FROM customers c WHERE c.id=? AND (EXISTS(SELECT 1 FROM cooperative_customers cc WHERE cc.customer_id=c.id AND cc.cooperative_id=? AND cc.status='active') OR EXISTS(SELECT 1 FROM customer_wallets w JOIN customer_wallet_transactions t ON t.wallet_id=w.id WHERE w.customer_id=c.id AND t.cooperative_id=?)) LIMIT 1`)
      .bind(customerId,auth.cooperativeId,auth.cooperativeId).first<Row>();
    if (!customer) return c.json({ok:false,error:'Cliente não encontrado nesta cooperativa.'},404);
  }
  if (paymentMethod==='credit' && !customerId) return c.json({ok:false,error:'Selecione o cliente que terá o crédito consumido.'},400);
  const created = await insertOrder(c, {
    cooperativeId: auth.cooperativeId!, establishmentId: base.virtual_establishment_id, baseId: base.id, deliveryType: 'base', source: 'base_counter_v7',
    prefix: 'BASE', pickup, destination, customerName: nullableText(body.customer_name, 150) || customer?.name || null, customerPhone: nullableText(body.customer_phone, 50) || customer?.phone || null, customerId,
    pickupContactName: nullableText(body.pickup_contact_name, 150), pickupPhone: nullableText(body.pickup_phone, 50),
    recipientName: nullableText(body.recipient_name, 150), recipientPhone: nullableText(body.recipient_phone, 50),
    pickupApartment: nullableText(body.pickup_apartment, 80), pickupComplement: nullableText(body.pickup_complement, 250),
    deliveryApartment: nullableText(body.delivery_apartment, 80), deliveryComplement: nullableText(body.delivery_complement, 250),
    itemDescription: nullableText(body.item_description, 500), paymentMethod,
    paymentStatus: paymentMethod==='credit' ? 'paid' : cleanText(body.payment_status || 'pending', 30), cashPaymentLocation: nullableText(body.cash_payment_location, 20),
    notes: nullableText(body.notes, 1500), serviceIds: body.service_ids, feePercent: Number(base.cooperative_fee_percent || 0),
    ratePerKmCents: Number(base.rate_per_km_cents || 0), minimumFeeCents: Number(base.minimum_fee_cents || 0),
    trackingEnabled, createdBy: auth.id
  });
  const confirmationMode = String(base.confirmation_mode || 'required');
  await c.env.DB.prepare(`UPDATE deliveries SET confirmation_required=?,finish_without_code_authorized=?,confirmation_code=CASE WHEN ?='disabled' THEN NULL ELSE confirmation_code END,customer_chat_enabled=?,driver_call_enabled=? WHERE id=?`)
    .bind(confirmationMode==='required'?1:0,confirmationMode==='optional'||confirmationMode==='disabled'?1:0,confirmationMode,Number(base.customer_chat_enabled??1),Number(base.driver_call_enabled??0),created.id).run();
  if (confirmationMode==='disabled') (created as Row).confirmation_code = null;
  if (customerId) {
    const requestId=id();
    await c.env.DB.prepare(`INSERT INTO customer_requests(
      id,cooperative_id,customer_id,customer_name,customer_phone,pickup_address,pickup_neighborhood,pickup_contact_name,pickup_phone,
      delivery_address,delivery_neighborhood,recipient_name,recipient_phone,item_description,payment_method,quoted_cents,notes,status,
      delivery_id,base_id,services_cents,distance_meters,duration_seconds,credit_used_cents,pickup_address_json,delivery_address_json,
      cash_payment_location,confirmation_code,pickup_apartment,pickup_complement,delivery_apartment,delivery_complement
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'converted',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(requestId,auth.cooperativeId,customerId,customer?.name||nullableText(body.customer_name,150)||'Cliente',customer?.phone||nullableText(body.customer_phone,50)||'',
        pickup.formatted_address,pickup.neighborhood||null,nullableText(body.pickup_contact_name,150),nullableText(body.pickup_phone,50),
        destination.formatted_address,destination.neighborhood||null,nullableText(body.recipient_name,150),nullableText(body.recipient_phone,50),
        nullableText(body.item_description,500),paymentMethod,created.charge_cents,nullableText(body.notes,1500),created.id,base.id,0,
        created.distance_meters,created.duration_seconds,0,addressJson(pickup),addressJson(destination),nullableText(body.cash_payment_location,20),
        (created as Row).confirmation_code||null,nullableText(body.pickup_apartment,80),nullableText(body.pickup_complement,250),
        nullableText(body.delivery_apartment,80),nullableText(body.delivery_complement,250)).run();
    if (paymentMethod==='credit') {
      try {
        await reconcileDeliveryCredit(c.env,{deliveryId:created.id,cooperativeId:auth.cooperativeId!,customerId,desiredCents:Number(created.charge_cents||0),displayCode:String(created.display_code),reason:'Crédito consumido ao lançar a entrega da Base',requestId});
      } catch (error) {
        await c.env.DB.prepare(`DELETE FROM deliveries WHERE id=?`).bind(created.id).run();
        throw error;
      }
    }
  }
  const automaticAssignment = await assignNextBaseDriver(c.env,{cooperativeId:auth.cooperativeId!,baseId:base.id,deliveryId:created.id,changedBy:auth.id});
  if(automaticAssignment.assigned){
    (created as Row).status='assigned';
    (created as Row).assigned_driver_id=automaticAssignment.driverId;
    (created as Row).assigned_driver_name=automaticAssignment.driverName;
  }
  c.executionCtx.waitUntil(queueWebhookEvent(c.env, auth.cooperativeId!, base.virtual_establishment_id, 'delivery.created', { ...created, status:(created as Row).status||'new', delivery_type: 'base', base_id: base.id }));
  return c.json({ ok: true, item: created, automatic_assignment: automaticAssignment }, 201);
});

// Conclusão obrigatória pelo código de 4 dígitos visível ao cliente.
dispatchV7Routes.post('/driver/deliveries/:id/confirm-delivery', async (c) => {
  const auth = tenant(c, ['driver']);
  const body = await bodyJson<Row>(c);
  const code = cleanText(body.confirmation_code, 4);
  const delivery = await c.env.DB.prepare(`
    SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL
  `).bind(c.req.param('id'), auth.cooperativeId, auth.driverId).first<Row>();
  if (!delivery) return c.json({ ok: false, error: 'Entrega não encontrada.' }, 404);
  if (!['picked_up', 'in_route', 'problem'].includes(delivery.status)) return c.json({ ok: false, error: 'A entrega precisa estar em rota para ser concluída.' }, 409);
  if (!/^\d{4}$/.test(code) || code !== String(delivery.confirmation_code || '')) {
    return c.json({ ok: false, error: 'Código incorreto. Peça ao cliente o código de 4 dígitos exibido no acompanhamento.' }, 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET status='delivered',confirmation_verified_at=CURRENT_TIMESTAMP,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'delivered','Código de 4 dígitos confirmado',?)`)
      .bind(id(), delivery.id, auth.cooperativeId, delivery.status, auth.id)
  ]);
  await finishFinancial(c, auth, delivery);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env, auth.cooperativeId!, delivery.establishment_id, 'delivery.status_changed', { id: delivery.id, display_code: delivery.display_code, status: 'delivered' }));
  return c.json({ ok: true, message: 'Entrega confirmada e finalizada.' });
});

// Remoção segura: preserva o histórico e cancela a entrega.
dispatchV7Routes.delete('/deliveries/:id', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher', 'establishment']);
  const delivery = await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(c.req.param('id'), auth.cooperativeId).first<Row>();
  if (!delivery) return c.json({ ok: false, error: 'Entrega não encontrada.' }, 404);
  const owns = delivery.delivery_type === 'base'
    ? ['cooperative_admin', 'dispatcher'].includes(auth.role)
    : auth.role === 'establishment' && auth.establishmentId === delivery.establishment_id;
  if (!owns) return c.json({ ok: false, error: 'Você não pode remover esta entrega.' }, 403);
  if (delivery.status === 'delivered') return c.json({ ok: false, error: 'Entrega concluída não pode ser removida; ela permanece no fechamento.' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delivery.id),
    c.env.DB.prepare(`UPDATE financial_entries SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE delivery_id=? AND deleted_at IS NULL`).bind(delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'cancelled','Entrega removida pelo responsável',?)`)
      .bind(id(), delivery.id, auth.cooperativeId, delivery.status, auth.id)
  ]);
  return c.json({ ok: true });
});

// Clona apenas entrega da Base, com novo número, token e código.
dispatchV7Routes.post('/base/deliveries/:id/clone', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  // Seleciona somente os campos usados na clonagem. `d.*` ultrapassa o limite
  // de colunas do D1 depois das migrações mais recentes.
  const source = await c.env.DB.prepare(`
    SELECT d.id,d.cooperative_id,d.establishment_id,d.base_id,d.pickup_address_json,d.delivery_address_json,
      d.customer_name,d.customer_phone,d.pickup_contact_name,d.pickup_phone,d.recipient_name,d.recipient_phone,
      d.item_description,d.payment_method,d.cash_payment_location,d.notes,d.charge_cents,d.display_code,
      b.rate_per_km_cents,b.minimum_fee_cents,b.cooperative_fee_percent,b.tracking_enabled base_tracking
    FROM deliveries d JOIN bases b ON b.id=d.base_id
    WHERE d.id=? AND d.cooperative_id=? AND d.delivery_type='base' AND d.deleted_at IS NULL
  `).bind(c.req.param('id'), auth.cooperativeId).first<Row>();
  if (!source) return c.json({ ok: false, error: 'Entrega da Base não encontrada.' }, 404);
  if (!source.pickup_address_json || !source.delivery_address_json) return c.json({ ok: false, error: 'Esta entrega antiga não possui endereços JSON confirmados e não pode ser clonada automaticamente.' }, 409);
  const services=await c.env.DB.prepare(`SELECT service_id FROM delivery_services WHERE delivery_id=? ORDER BY service_name`).bind(source.id).all<Row>();
  const p = JSON.parse(source.pickup_address_json); const d = JSON.parse(source.delivery_address_json);
  const toCandidate = (x: any): AddressCandidate => ({
    provider: x.provider || 'google', provider_id: x.provider_id || '', formatted_address: x.formatted_address, display_name: x.formatted_address,
    street: x.street, number: x.number, neighborhood: x.neighborhood || '', city: x.city, state: x.state,
    state_code: x.state_code || x.state, postal_code: x.postal_code || '', country: x.country || 'Brasil',
    lat: Number(x.latitude), lng: Number(x.longitude), precision: x.precision || 'rooftop', exact_number: true, exact_city: true, exact_state: true
  });
  const created = await insertOrder(c, {
    cooperativeId: auth.cooperativeId!, establishmentId: source.establishment_id, baseId: source.base_id, deliveryType: 'base', source: 'base_clone_v7',
    prefix: 'BASE', pickup: toCandidate(p), destination: toCandidate(d), customerName: source.customer_name, customerPhone: source.customer_phone,
    pickupContactName: source.pickup_contact_name, pickupPhone: source.pickup_phone, recipientName: source.recipient_name,
    recipientPhone: source.recipient_phone, itemDescription: source.item_description, paymentMethod: source.payment_method,
    paymentStatus: 'pending', cashPaymentLocation: source.cash_payment_location, notes: source.notes,
    serviceIds: (services.results||[]).map(item=>String(item.service_id)).filter(Boolean),
    feePercent: Number(source.cooperative_fee_percent || 0), ratePerKmCents: Number(source.rate_per_km_cents || 0),
    minimumFeeCents: Number(source.minimum_fee_cents || 0), manualCharge: Number(source.charge_cents || 0) / 100,
    trackingEnabled: Number(source.base_tracking ?? 1) === 1, createdBy: auth.id
  });
  await c.env.DB.prepare(`UPDATE deliveries SET cloned_from_delivery_id=? WHERE id=?`).bind(source.id, created.id).run();
  return c.json({ ok: true, item: created }, 201);
});

// Permissões de rastreio controladas pela cooperativa.
dispatchV7Routes.get('/tracking-settings', async (c) => {
  const auth = tenant(c, ['cooperative_admin']);
  const [coop, establishments, bases] = await Promise.all([
    c.env.DB.prepare(`SELECT base_tracking_enabled FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>(),
    c.env.DB.prepare(`SELECT id,name,tracking_enabled FROM establishments WHERE cooperative_id=? AND deleted_at IS NULL AND active=1 ORDER BY name`).bind(auth.cooperativeId).all<Row>(),
    c.env.DB.prepare(`SELECT id,name,tracking_enabled FROM bases WHERE cooperative_id=? AND deleted_at IS NULL AND active=1 ORDER BY name`).bind(auth.cooperativeId).all<Row>()
  ]);
  return c.json({ ok: true, base_tracking_enabled: Number(coop?.base_tracking_enabled ?? 1) === 1, establishments: establishments.results, bases: bases.results });
});

dispatchV7Routes.put('/tracking-settings/base-default', async (c) => {
  const auth = tenant(c, ['cooperative_admin']);
  const enabled = Boolean((await bodyJson<Row>(c)).enabled);
  await c.env.DB.prepare(`UPDATE cooperatives SET base_tracking_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(enabled ? 1 : 0, auth.cooperativeId).run();
  return c.json({ ok: true, enabled });
});

dispatchV7Routes.put('/tracking-settings/establishments/:id', async (c) => {
  const auth = tenant(c, ['cooperative_admin']);
  const enabled = Boolean((await bodyJson<Row>(c)).enabled);
  const result = await c.env.DB.prepare(`UPDATE establishments SET tracking_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(enabled ? 1 : 0, c.req.param('id'), auth.cooperativeId).run();
  if (!result.meta.changes) return c.json({ ok: false, error: 'Estabelecimento não encontrado.' }, 404);
  await c.env.DB.prepare(`
    UPDATE deliveries SET tracking_enabled=?
    WHERE establishment_id=? AND delivery_type='establishment'
      AND status NOT IN ('delivered','cancelled') AND deleted_at IS NULL
  `).bind(enabled ? 1 : 0, c.req.param('id')).run();
  return c.json({ ok: true, enabled });
});

dispatchV7Routes.put('/tracking-settings/bases/:id', async (c) => {
  const auth = tenant(c, ['cooperative_admin']);
  const enabled = Boolean((await bodyJson<Row>(c)).enabled);
  const result = await c.env.DB.prepare(`UPDATE bases SET tracking_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(enabled ? 1 : 0, c.req.param('id'), auth.cooperativeId).run();
  if (!result.meta.changes) return c.json({ ok: false, error: 'Base não encontrada.' }, 404);
  await c.env.DB.prepare(`UPDATE deliveries SET tracking_enabled=? WHERE base_id=? AND status NOT IN ('delivered','cancelled') AND deleted_at IS NULL`)
    .bind(enabled ? 1 : 0, c.req.param('id')).run();
  return c.json({ ok: true, enabled });
});

// Fechamento semanal detalhado, por cooperado/dia/entrega e por estabelecimento.
dispatchV7Routes.get('/weekly-summary', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  const { start, end } = weekBounds(cleanText(c.req.query('week_start'), 10));
  const driverFilter = cleanText(c.req.query('driver_id'), 100);
  const locationKey = cleanText(c.req.query('location_key'), 150);
  let establishmentFilter = cleanText(c.req.query('establishment_id'), 100);
  let baseFilter = '';
  if(locationKey.startsWith('est:')) establishmentFilter=locationKey.slice(4);
  if(locationKey.startsWith('base:')) { baseFilter=locationKey.slice(5); establishmentFilter=''; }
  const baseScope=baseFilter?await c.env.DB.prepare(`SELECT id,virtual_establishment_id FROM bases WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(baseFilter,auth.cooperativeId).first<Row>():null;
  if(baseFilter&&!baseScope)return c.json({ok:false,error:'Base inválida.'},400);
  let deliverySql = `
    SELECT d.id,d.display_code,d.delivered_at,date(d.delivered_at,'-3 hours') local_day,d.charge_cents,d.driver_gross_cents,d.driver_net_cents,d.cooperative_fee_cents,
      d.assigned_driver_id,d.establishment_id,d.delivery_type,d.base_id,d.payment_method,d.pickup_address,d.delivery_address,
      dr.name driver_name,e.name establishment_name,b.name base_name
    FROM deliveries d
    JOIN drivers dr ON dr.id=d.assigned_driver_id
    JOIN establishments e ON e.id=d.establishment_id
    LEFT JOIN bases b ON b.id=d.base_id
    WHERE d.cooperative_id=? AND d.status='delivered' AND d.deleted_at IS NULL
      AND date(d.delivered_at,'-3 hours') BETWEEN date(?) AND date(?)`;
  const deliveryParams: any[] = [auth.cooperativeId, start, end];
  if (driverFilter) { deliverySql += ` AND d.assigned_driver_id=?`; deliveryParams.push(driverFilter); }
  if (baseFilter) { deliverySql += ` AND d.base_id=?`; deliveryParams.push(baseFilter); }
  else if (establishmentFilter) { deliverySql += ` AND d.establishment_id=? AND d.delivery_type='establishment'`; deliveryParams.push(establishmentFilter); }
  deliverySql += ` ORDER BY dr.name,date(d.delivered_at,'-3 hours'),d.delivered_at`;
  const deliveries = (await c.env.DB.prepare(deliverySql).bind(...deliveryParams).all<Row>()).results || [];

  let driverSql = `SELECT id,name FROM drivers WHERE cooperative_id=? AND deleted_at IS NULL AND status='active'`;
  const driverParams: any[] = [auth.cooperativeId];
  if (driverFilter) { driverSql += ` AND id=?`; driverParams.push(driverFilter); }
  driverSql += ` ORDER BY name`;
  const cooperativeDrivers = (await c.env.DB.prepare(driverSql).bind(...driverParams).all<Row>()).results || [];

  let entrySql = `SELECT f.id,f.driver_id,f.establishment_id,f.entry_type,f.category,f.description,f.amount_cents,
      COALESCE(f.settled_cents,0) settled_cents,f.reference_date,f.delivery_id,f.status,fe.name financial_establishment_name,
      CASE WHEN EXISTS(
        SELECT 1 FROM guarantee_settlement_financial_entries gl
         WHERE gl.financial_entry_id=f.id AND gl.entry_kind='complement'
      ) THEN 1 ELSE 0 END is_guarantee_complement
    FROM financial_entries f
    LEFT JOIN establishments fe ON fe.id=f.establishment_id
    WHERE f.cooperative_id=? AND f.deleted_at IS NULL AND f.status!='cancelled'
      AND ((f.entry_type='credit' AND date(f.reference_date) BETWEEN date(?) AND date(?))
        OR (f.entry_type='debit' AND ((f.status='open' AND date(f.reference_date)<=date(?)) OR date(f.reference_date) BETWEEN date(?) AND date(?))))`;
  const entryParams: any[] = [auth.cooperativeId, start, end, end, start, end];
  if (driverFilter) { entrySql += ` AND f.driver_id=?`; entryParams.push(driverFilter); }
  if (baseFilter) {
    entrySql += ` AND (f.establishment_id=? OR f.delivery_id IN (SELECT id FROM deliveries WHERE cooperative_id=? AND base_id=?))`;
    entryParams.push(baseScope?.virtual_establishment_id||'',auth.cooperativeId,baseFilter);
  } else if (establishmentFilter) {
    entrySql += ` AND (f.establishment_id=? OR f.delivery_id IN (SELECT id FROM deliveries WHERE cooperative_id=? AND establishment_id=? AND delivery_type='establishment'))`;
    entryParams.push(establishmentFilter,auth.cooperativeId,establishmentFilter);
  }
  const entries = (await c.env.DB.prepare(entrySql).bind(...entryParams).all<Row>()).results || [];

  const driverMap = new Map<string, any>();
  for (const driver of cooperativeDrivers) {
    driverMap.set(String(driver.id), { id: String(driver.id), name: driver.name, production_cents: 0, direct_received_cents: 0, discounts_cents: 0, net_cents: 0, deliveries_count: 0, days: {} });
  }
  for (const delivery of deliveries) {
    const driverId = String(delivery.assigned_driver_id);
    if (!driverMap.has(driverId)) driverMap.set(driverId, { id: driverId, name: delivery.driver_name, production_cents: 0, direct_received_cents: 0, discounts_cents: 0, net_cents: 0, deliveries_count: 0, days: {} });
    const driver = driverMap.get(driverId);
    const dayKey = String(delivery.local_day || delivery.delivered_at || '').slice(0, 10);
    if (!driver.days[dayKey]) driver.days[dayKey] = { date: dayKey, production_cents: 0, direct_received_cents: 0, discounts_cents: 0, net_cents: 0, deliveries: [], gains: [], discounts: [] };
    const day = driver.days[dayKey];
    const gross = Number(delivery.driver_gross_cents || 0);
    const directReceived = delivery.delivery_type === 'base' && baseDirectReceivedPayment(delivery.payment_method);
    const receivable = delivery.delivery_type === 'establishment' || (delivery.delivery_type === 'base' && baseReceivablePayment(delivery.payment_method));
    // Cartões e vales indicam como cobrar o pedido/mercadoria. Eles não são produção do cooperado.
    if (!directReceived && !receivable) continue;
    if (directReceived) { driver.direct_received_cents += gross; day.direct_received_cents += gross; }
    else { driver.production_cents += gross; day.production_cents += gross; }
    driver.deliveries_count += 1;
    day.deliveries.push({ ...delivery, financial_class: directReceived ? 'production_received' : 'production_receivable' });
  }
  for (const entry of entries) {
    let driver = driverMap.get(String(entry.driver_id));
    if (!driver) {
      driver = { id: String(entry.driver_id), name: 'Cooperado', production_cents: 0, direct_received_cents: 0, discounts_cents: 0, net_cents: 0, deliveries_count: 0, days: {} };
      driverMap.set(String(entry.driver_id), driver);
    }
    const dayKey = String(entry.reference_date || '').slice(0, 10);
    if (!driver.days[dayKey]) driver.days[dayKey] = { date: dayKey, production_cents: 0, direct_received_cents: 0, discounts_cents: 0, net_cents: 0, deliveries: [], gains: [], discounts: [] };
    if (entry.entry_type === 'debit') {
      driver.discounts_cents += Number(entry.amount_cents || 0);
      driver.days[dayKey].discounts_cents += Number(entry.amount_cents || 0);
      driver.days[dayKey].discounts.push({ id:entry.id, category: entry.category, description: entry.description, amount_cents: Number(entry.amount_cents || 0), settled_cents:Number(entry.settled_cents||0), status: entry.status, reference_date: entry.reference_date });
    } else if (entry.entry_type === 'credit') {
      // Créditos normais de entrega já foram somados pela tabela deliveries.
      // O complemento de garantido também usa category='delivery', porém não possui
      // delivery_id; por isso deve entrar separadamente como produção sem duplicar a corrida.
      const standaloneProduction=entry.category!=='delivery'||!entry.delivery_id||Number(entry.is_guarantee_complement||0)===1;
      if(standaloneProduction){
        const gainAmount=Number(entry.amount_cents || 0);
        driver.production_cents += gainAmount;
        driver.days[dayKey].production_cents += gainAmount;
        driver.days[dayKey].gains.push({ id:entry.id, category:entry.category, description:entry.description, amount_cents:gainAmount, settled_cents:Number(entry.settled_cents||0), status:entry.status, reference_date:entry.reference_date });
      }
    }
  }
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${start}T12:00:00`); date.setDate(date.getDate() + index); return date.toISOString().slice(0, 10);
  });
  for (const driver of driverMap.values()) {
    for (const date of weekDays) {
      if (!driver.days[date]) driver.days[date] = { date, production_cents: 0, direct_received_cents: 0, discounts_cents: 0, net_cents: 0, deliveries: [], gains: [], discounts: [] };
    }
    driver.net_cents = driver.production_cents - driver.discounts_cents;
    driver.days = Object.values(driver.days).sort((a: any, b: any) => a.date.localeCompare(b.date)).map((day: any) => ({ ...day, net_cents: day.production_cents - day.discounts_cents }));
  }

  const establishmentMap = new Map<string, any>();
  for (const delivery of deliveries) {
    const key = String(delivery.establishment_id);
    if (!establishmentMap.has(key)) establishmentMap.set(key, { id: key, name: delivery.delivery_type === 'base' ? `Base: ${delivery.base_name || delivery.establishment_name}` : delivery.establishment_name, total_due_cents: 0, deliveries_count: 0, days: {} });
    const establishment = establishmentMap.get(key);
    const day = String(delivery.local_day || delivery.delivered_at || '').slice(0, 10);
    establishment.total_due_cents += Number(delivery.charge_cents || 0); establishment.deliveries_count += 1;
    establishment.days[day] = (establishment.days[day] || 0) + Number(delivery.charge_cents || 0);
  }
  // O complemento pertence ao estabelecimento do turno e integra o movimento
  // financeiro do período, mas não aumenta a quantidade de entregas realizadas.
  for(const entry of entries){
    if(entry.entry_type!=='credit'||Number(entry.is_guarantee_complement||0)!==1||!entry.establishment_id)continue;
    const key=String(entry.establishment_id);
    if(!establishmentMap.has(key))establishmentMap.set(key,{id:key,name:entry.financial_establishment_name||'Estabelecimento',total_due_cents:0,deliveries_count:0,days:{}});
    const establishment=establishmentMap.get(key);
    const day=String(entry.reference_date||'').slice(0,10);
    const amount=Number(entry.amount_cents||0);
    establishment.total_due_cents+=amount;
    establishment.days[day]=(establishment.days[day]||0)+amount;
  }
  const drivers = [...driverMap.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const establishments = [...establishmentMap.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return c.json({
    ok: true, week_start: start, week_end: end, drivers, establishments,
    totals: {
      establishment_due_cents: establishments.reduce((sum, item) => sum + item.total_due_cents, 0),
      driver_production_cents: drivers.reduce((sum, item) => sum + item.production_cents, 0),
      direct_received_cents: drivers.reduce((sum, item) => sum + item.direct_received_cents, 0),
      discounts_cents: drivers.reduce((sum, item) => sum + item.discounts_cents, 0),
      driver_net_cents: drivers.reduce((sum, item) => sum + item.net_cents, 0),
      deliveries_count: drivers.reduce((sum, item) => sum + Number(item.deliveries_count||0), 0)
    }
  });
});

// Avaliações com nota inicial 5,00 e variação simples de um centésimo.
dispatchV7Routes.get('/ratings', async (c) => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher', 'driver', 'establishment']);
  let where='r.cooperative_id=?',params:any[]=[auth.cooperativeId];
  if(auth.role==='driver'){where+=' AND r.driver_id=?';params.push(auth.driverId);}
  if(auth.role==='establishment'){where+=' AND r.establishment_id=?';params.push(auth.establishmentId);}

  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const fromRaw=cleanText(c.req.query('from'),10),toRaw=cleanText(c.req.query('to'),10);
  const defaultToday=['cooperative_admin','dispatcher'].includes(auth.role);
  const from=fromRaw||(defaultToday?today:''),to=toRaw||(defaultToday?(from||today):'');
  if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to)))return c.json({ok:false,error:'Período inválido.'},400);
  if(from){where+=` AND date(r.created_at,'-3 hours')>=date(?)`;params.push(from);}
  if(to){where+=` AND date(r.created_at,'-3 hours')<=date(?)`;params.push(to);}
  const driverId=cleanText(c.req.query('driver_id'),100);
  if(driverId&&['cooperative_admin','dispatcher'].includes(auth.role)){where+=' AND r.driver_id=?';params.push(driverId);}

  const rows = await c.env.DB.prepare(`
    SELECT r.*,d.display_code,d.delivery_type,d.delivered_at,e.name establishment_name,dr.name driver_name,'delivery' rating_type
    FROM delivery_ratings r JOIN deliveries d ON d.id=r.delivery_id JOIN establishments e ON e.id=r.establishment_id
    LEFT JOIN drivers dr ON dr.id=r.driver_id
    WHERE ${where} ORDER BY r.created_at DESC LIMIT 1000
  `).bind(...params).all<Row>();
  let shiftWhere='sr.cooperative_id=?',shiftParams:any[]=[auth.cooperativeId];
  if(auth.role==='driver'){shiftWhere+=' AND sr.driver_id=?';shiftParams.push(auth.driverId);}
  if(auth.role==='establishment'){shiftWhere+=' AND sr.establishment_id=?';shiftParams.push(auth.establishmentId);}
  if(from){shiftWhere+=` AND date(sr.created_at,'-3 hours')>=date(?)`;shiftParams.push(from);}
  if(to){shiftWhere+=` AND date(sr.created_at,'-3 hours')<=date(?)`;shiftParams.push(to);}
  if(driverId&&['cooperative_admin','dispatcher'].includes(auth.role)){shiftWhere+=' AND sr.driver_id=?';shiftParams.push(driverId);}
  const shiftRows=await c.env.DB.prepare(`SELECT sr.id,NULL delivery_id,sr.cooperative_id,sr.establishment_id,sr.driver_id,NULL customer_id,NULL establishment_score,sr.score driver_score,NULL establishment_tags_json,sr.tags_json driver_tags_json,sr.comment,sr.source,sr.created_at,sr.updated_at,NULL display_code,'establishment' delivery_type,s.end_at delivered_at,e.name establishment_name,dr.name driver_name,'shift' rating_type FROM shift_ratings sr JOIN schedules s ON s.id=sr.schedule_id JOIN establishments e ON e.id=sr.establishment_id JOIN drivers dr ON dr.id=sr.driver_id WHERE ${shiftWhere} ORDER BY sr.created_at DESC LIMIT 1000`).bind(...shiftParams).all<Row>();
  const items = [...(rows.results || []),...(shiftRows.results||[])].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,1000);
  const scoreMap = (kind: 'driver' | 'establishment') => {
    const map = new Map<string, any>();
    for (const item of items) {
      const key = kind === 'driver' ? item.driver_id : item.establishment_id;
      const name = kind === 'driver' ? item.driver_name : item.establishment_name;
      const score = Number(kind === 'driver' ? item.driver_score : item.establishment_score);
      if (!key || !score) continue;
      if (!map.has(key)) map.set(key, { id: key, name, count: 0, scores: [] as number[] });
      const target = map.get(key); target.count += 1; target.scores.push(score);
    }
    return [...map.values()].map(target => {
      let score = 5;
      for (const value of [...target.scores].reverse()) score = Math.round(Math.max(1, Math.min(5, score + (value === 5 ? 0.01 : -0.01))) * 100) / 100;
      const { scores, ...item } = target;
      void scores;
      return { ...item, score };
    }).sort((a, b) => b.score - a.score);
  };
  return c.json({ ok: true, items, driver_scores: scoreMap('driver'), establishment_scores: scoreMap('establishment'), from:from||null, to:to||null, driver_id:driverId||null, method: 'Nota inicial 5,00. Cada avaliação altera a nota em 0,01: nota 5 recupera um centésimo e nota abaixo de 5 reduz um centésimo.' });
});
