import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from '../types';
import { addressJson, addressPoint, readAddressConfirmationToken } from '../lib/address';
import { randomToken, sha256 } from '../lib/crypto';
import { routeBetween, routePrice, searchAddressCandidates, type AddressCandidate, type AddressSearchInput } from '../lib/maps';
import { queueWebhookEvent } from '../lib/webhooks';
import { bodyJson, cleanText, id, nullableText, toCents } from '../lib/util';
import { deliveryFields } from '../lib/delivery-fields';

interface ApiClient {
  id: string;
  cooperative_id: string;
  establishment_id: string | null;
  scopes: string;
}

type Row = Record<string, any>;

async function nextOrderCode(c: Context<AppBindings>, cooperativeId: string, prefix = 'LG') {
  const row = await c.env.DB.prepare(`
    INSERT INTO cooperative_sequences (cooperative_id,sequence_name,current_value,updated_at)
    VALUES (?,'delivery',1,CURRENT_TIMESTAMP)
    ON CONFLICT(cooperative_id,sequence_name) DO UPDATE SET current_value=current_value+1,updated_at=CURRENT_TIMESTAMP
    RETURNING current_value
  `).bind(cooperativeId).first<{ current_value: number }>();
  return `${prefix || 'LG'}-${String(row?.current_value || Date.now()).padStart(6, '0')}`;
}

async function apiClient(c: Context<AppBindings>, requiredScope: string): Promise<ApiClient | Response> {
  const header = c.req.header('Authorization') || '';
  const raw = header.startsWith('Bearer ') ? header.slice(7) : c.req.header('X-API-Key') || '';
  if (!raw) return c.json({ ok: false, error: 'Chave de API ausente.' }, 401);
  const hash = await sha256(raw);
  const client = await c.env.DB.prepare(`
    SELECT id,cooperative_id,establishment_id,scopes
    FROM api_clients WHERE key_hash=? AND status='active' LIMIT 1
  `).bind(hash).first<ApiClient>();
  if (!client) return c.json({ ok: false, error: 'Chave de API inválida.' }, 401);
  if (!client.scopes.split(',').map(value => value.trim()).includes(requiredScope)) {
    return c.json({ ok: false, error: 'Escopo não autorizado.' }, 403);
  }
  await c.env.DB.prepare(`UPDATE api_clients SET last_used_at=CURRENT_TIMESTAMP WHERE id=?`).bind(client.id).run();
  return client;
}

function storedCandidate(raw: unknown): AddressCandidate | null {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || !value.street || !value.number || !value.city || !value.state) return null;
    const lat = Number(value.latitude ?? value.lat);
    const lng = Number(value.longitude ?? value.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      provider: value.provider || 'confirmed',
      provider_id: value.provider_id || value.place_id || '',
      formatted_address: value.formatted_address || [value.street, value.number, value.neighborhood, value.city, value.state, value.postal_code].filter(Boolean).join(', '),
      display_name: value.formatted_address || '',
      street: String(value.street),
      number: String(value.number),
      neighborhood: String(value.neighborhood || ''),
      city: String(value.city),
      state: String(value.state),
      state_code: String(value.state_code || value.state),
      postal_code: String(value.postal_code || ''),
      country: String(value.country || 'Brasil'),
      lat,
      lng,
      precision: value.precision || 'rooftop',
      exact_number: true,
      exact_city: true,
      exact_state: true
    };
  } catch {
    return null;
  }
}

function structuredInput(raw: unknown, fallbackCity = '', fallbackState = ''): AddressSearchInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Row;
  const input: AddressSearchInput = {
    street: cleanText(value.street || value.logradouro, 250),
    number: cleanText(value.number || value.numero, 30),
    neighborhood: cleanText(value.neighborhood || value.bairro, 150),
    city: cleanText(value.city || value.cidade || fallbackCity, 120),
    state: cleanText(value.state || value.uf || fallbackState, 80),
    postal_code: cleanText(value.postal_code || value.cep, 20),
    country: 'Brasil'
  };
  return input.street && input.number && input.city && input.state ? input : null;
}

async function resolveConfirmedAddress(
  c: Context<AppBindings>,
  token: unknown,
  json: unknown,
  fallbackCity = '',
  fallbackState = ''
): Promise<AddressCandidate> {
  if (String(token || '').trim()) return readAddressConfirmationToken(c.env, token);
  const input = structuredInput(json, fallbackCity, fallbackState);
  if (!input) {
    throw new Error('Envie o endereço em JSON com street, number, city e state, ou envie confirmation_token.');
  }
  const candidates = await searchAddressCandidates(c.env, input);
  const candidate = candidates.find(item => item.exact_number && item.exact_city && item.exact_state && ['rooftop', 'interpolated'].includes(item.precision));
  if (!candidate) {
    throw new Error('O endereço e o número não foram confirmados com precisão na cidade informada. Consulte /api/public/address/search e envie o confirmation_token retornado.');
  }
  return candidate;
}

async function uniqueConfirmationCode(c: Context<AppBindings>, phone: string | null): Promise<string> {
  const used = new Set<string>();
  if (phone) {
    const rows = await c.env.DB.prepare(`
      SELECT DISTINCT confirmation_code FROM deliveries
      WHERE confirmation_code IS NOT NULL AND (customer_phone=? OR recipient_phone=?) LIMIT 9000
    `).bind(phone, phone).all<{ confirmation_code: string }>();
    for (const row of rows.results || []) used.add(String(row.confirmation_code));
  }
  const buffer = new Uint32Array(1);
  for (let attempt = 0; attempt < 300; attempt += 1) {
    crypto.getRandomValues(buffer);
    const code = String(1000 + (buffer[0] % 9000));
    if (!used.has(code)) return code;
  }
  for (let value = 1000; value <= 9999; value += 1) if (!used.has(String(value))) return String(value);
  throw new Error('Não foi possível gerar o código de confirmação.');
}

export const integrationRoutes = new Hono<AppBindings>();

integrationRoutes.post('/orders', async c => {
  const client = await apiClient(c, 'orders:write');
  if (client instanceof Response) return client;
  const body = await bodyJson<Row>(c);
  const establishmentId = client.establishment_id || cleanText(body.establishment_id, 100);
  if (!establishmentId) return c.json({ ok: false, error: 'establishment_id é obrigatório para esta chave.' }, 400);

  const establishment = await c.env.DB.prepare(`
    SELECT e.*,c.address_city cooperative_city,c.address_state cooperative_state,c.inss_percent,c.sest_senat_percent,c.cooperative_fee_percent cooperative_default_fee
    FROM establishments e JOIN cooperatives c ON c.id=e.cooperative_id
    WHERE e.id=? AND e.cooperative_id=? AND e.active=1 AND e.deleted_at IS NULL
  `).bind(establishmentId, client.cooperative_id).first<Row>();
  if (!establishment) return c.json({ ok: false, error: 'Estabelecimento inválido.' }, 400);

  const externalId = cleanText(body.external_id, 150);
  if (!externalId) return c.json({ ok: false, error: 'external_id é obrigatório.' }, 400);
  const source = cleanText(body.source || 'integration', 50);
  const existing = await c.env.DB.prepare(`
    SELECT id,display_code,status,tracking_token,tracking_enabled,updated_at
    FROM deliveries WHERE cooperative_id=? AND source=? AND external_id=? AND deleted_at IS NULL LIMIT 1
  `).bind(client.cooperative_id, source, externalId).first<Row>();
  if (existing) {
    return c.json({
      ok: true,
      duplicate: true,
      order: {
        ...existing,
        tracking_url: Number(existing.tracking_enabled || 0) === 1
          ? `${c.env.APP_URL.replace(/\/$/, '')}/r/${existing.tracking_token}`
          : null
      }
    });
  }

  const contractId: null = null;


  let origin: AddressCandidate;
  if (body.pickup_confirmation_token || body.pickup?.confirmation_token) {
    origin = await resolveConfirmedAddress(c, body.pickup_confirmation_token || body.pickup?.confirmation_token, null);
  } else {
    origin = storedCandidate(establishment.address_json) as AddressCandidate;
    if (!origin || Number(establishment.address_confirmed || 0) !== 1) {
      return c.json({
        ok: false,
        error: 'O estabelecimento precisa confirmar seu endereço, com número, no painel antes de receber pedidos pela API.'
      }, 409);
    }
  }

  const destination = await resolveConfirmedAddress(
    c,
    body.delivery_confirmation_token || body.delivery?.confirmation_token,
    body.delivery_address_json || body.delivery?.address_json || body.delivery,
    establishment.city || establishment.cooperative_city || '',
    establishment.state || establishment.cooperative_state || ''
  );
  const route = await routeBetween(c.env, [addressPoint(origin), addressPoint(destination)]);
  if (!route) return c.json({ ok: false, error: 'Não foi possível calcular a rota pelas ruas entre os endereços confirmados.' }, 400);

  const serviceIds = Array.isArray(body.service_ids) ? body.service_ids.map(String).filter(Boolean).slice(0, 40) : [];
  let services: Row[] = [];
  if (serviceIds.length) {
    const marks = serviceIds.map(() => '?').join(',');
    const result = await c.env.DB.prepare(`
      SELECT id,name,add_cents FROM services
      WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL
        AND (establishment_id=? OR establishment_id IS NULL) AND id IN (${marks})
    `).bind(client.cooperative_id, establishmentId, ...serviceIds).all<Row>();
    services = (result.results || []) as Row[];
  }
  const servicesCents = services.reduce((sum, item) => sum + Number(item.add_cents || 0), 0);
  const suppliedAmount = body.amount ?? body.charge_value;
  const chargeCents = suppliedAmount !== undefined && suppliedAmount !== null && suppliedAmount !== ''
    ? Math.max(0, toCents(suppliedAmount))
    : routePrice(route.distance_meters, Number(establishment.rate_per_km_cents || 0), Number(establishment.minimum_fee_cents || 0), servicesCents);
  const feePercent = Number(establishment.cooperative_fee_percent ?? establishment.cooperative_default_fee ?? 0);
  const cooperativeFee = body.cooperative_amount !== undefined
    ? Math.max(0, toCents(body.cooperative_amount))
    : Math.round(chargeCents * feePercent / 100);
  const driverGross = body.driver_amount !== undefined
    ? Math.max(0, toCents(body.driver_amount))
    : Math.max(0, chargeCents - cooperativeFee);
  // Integrações criam entregas de estabelecimento: INSS e SEST/SENAT não são descontados aqui.
  const driverNet = driverGross;

  const paymentMethod = cleanText(body.payment_method || 'outro', 50).toLowerCase();
  const cashPaymentLocation = paymentMethod === 'dinheiro' ? cleanText(body.cash_payment_location, 20) : null;
  if (paymentMethod === 'dinheiro' && !['pickup', 'delivery'].includes(String(cashPaymentLocation))) {
    return c.json({ ok: false, error: 'Para pagamento em dinheiro, informe cash_payment_location como pickup ou delivery.' }, 400);
  }

  const customerPhone = nullableText(body.delivery?.customer_phone || body.customer_phone, 50);
  const recipientPhone = nullableText(body.delivery?.recipient_phone || body.recipient_phone || body.delivery?.phone, 50);
  const deliveryId = id();
  const trackingToken = randomToken(24);
  const displayCode = await nextOrderCode(c, client.cooperative_id, establishment.order_prefix || 'LG');
  const confirmationCode = await uniqueConfirmationCode(c, recipientPhone || customerPhone || null);
  const trackingEnabled = Number(establishment.tracking_enabled ?? 1) === 1;

  await c.env.DB.prepare(`INSERT INTO deliveries (
    id,cooperative_id,establishment_id,contract_id,external_id,source,customer_name,customer_phone,
    pickup_contact_name,pickup_phone,pickup_address,pickup_neighborhood,recipient_name,recipient_phone,
    delivery_address,delivery_neighborhood,item_description,pickup_lat,pickup_lng,delivery_lat,delivery_lng,
    status,charge_cents,driver_earnings_cents,cooperative_fee_cents,payment_method,payment_status,notes,
    tracking_token,display_code,delivery_type,distance_meters,duration_seconds,route_geometry,driver_gross_cents,
    driver_net_cents,services_cents,tracking_enabled,pickup_address_json,delivery_address_json,pickup_place_id,
    delivery_place_id,addresses_confirmed,cash_payment_location,confirmation_code
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?,'establishment',?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    deliveryId, client.cooperative_id, establishmentId, contractId, externalId, source,
    nullableText(body.delivery?.customer_name || body.customer_name, 150), customerPhone,
    nullableText(body.pickup?.contact_name || body.pickup_contact_name || establishment.name, 150),
    nullableText(body.pickup?.phone || body.pickup_phone || establishment.phone, 50),
    origin.formatted_address, origin.neighborhood || null,
    nullableText(body.delivery?.recipient_name || body.recipient_name, 150), recipientPhone,
    destination.formatted_address, destination.neighborhood || null,
    nullableText(body.description || body.item_description, 500),
    origin.lat, origin.lng, destination.lat, destination.lng,
    chargeCents, driverGross, cooperativeFee, paymentMethod,
    cleanText(body.payment_status || 'pending', 30), nullableText(body.notes, 1500), trackingToken, displayCode,
    route.distance_meters, route.duration_seconds, JSON.stringify(route.geometry), driverGross, driverNet,
    servicesCents, trackingEnabled ? 1 : 0, addressJson(origin), addressJson(destination),
    origin.provider_id || null, destination.provider_id || null, 1, cashPaymentLocation, confirmationCode
  ).run();

  if (services.length) {
    await c.env.DB.batch(services.map(service => c.env.DB.prepare(`
      INSERT INTO delivery_services (delivery_id,service_id,service_name,add_cents) VALUES (?,?,?,?)
    `).bind(deliveryId, service.id, service.name, service.add_cents)));
  }
  await c.env.DB.prepare(`
    INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,new_status,notes)
    VALUES (?,?,?,'new','Recebida pela API com endereços JSON confirmados')
  `).bind(id(), deliveryId, client.cooperative_id).run();

  const response = {
    id: deliveryId,
    display_code: displayCode,
    external_id: externalId,
    source,
    status: 'new',
    charge_cents: chargeCents,
    distance_meters: route.distance_meters,
    duration_seconds: route.duration_seconds,
    confirmation_code: confirmationCode,
    tracking_enabled: trackingEnabled,
    tracking_url: trackingEnabled ? `${c.env.APP_URL.replace(/\/$/, '')}/r/${trackingToken}` : null
  };
  c.executionCtx.waitUntil(queueWebhookEvent(c.env, client.cooperative_id, establishmentId, 'delivery.created', response));
  return c.json({ ok: true, order: response }, 201);
});

integrationRoutes.get('/orders/:externalId', async c => {
  const client = await apiClient(c, 'orders:read');
  if (client instanceof Response) return client;
  const source = cleanText(c.req.query('source') || 'integration', 50);
  let sql = `SELECT id,external_id,source,status,assigned_driver_id,accepted_at,picked_up_at,delivered_at,cancelled_at,
    distance_meters,duration_seconds,tracking_enabled,created_at,updated_at
    FROM deliveries WHERE cooperative_id=? AND source=? AND external_id=? AND deleted_at IS NULL`;
  const params: unknown[] = [client.cooperative_id, source, c.req.param('externalId')];
  if (client.establishment_id) { sql += ` AND establishment_id=?`; params.push(client.establishment_id); }
  const order = await c.env.DB.prepare(sql).bind(...params).first();
  if (!order) return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
  return c.json({ ok: true, order });
});

integrationRoutes.post('/orders/:externalId/cancel', async c => {
  const client = await apiClient(c, 'orders:write');
  if (client instanceof Response) return client;
  const source = cleanText(c.req.query('source') || 'integration', 50);
  let sql = `SELECT ${deliveryFields()} FROM deliveries WHERE cooperative_id=? AND source=? AND external_id=? AND deleted_at IS NULL`;
  const params: unknown[] = [client.cooperative_id, source, c.req.param('externalId')];
  if (client.establishment_id) { sql += ` AND establishment_id=?`; params.push(client.establishment_id); }
  const order = await c.env.DB.prepare(sql).bind(...params).first<Row>();
  if (!order) return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
  if (order.status === 'delivered') return c.json({ ok: false, error: 'Pedido já entregue.' }, 409);
  const payload: { reason?: string } = await bodyJson<{ reason?: string }>(c).catch(() => ({} as { reason?: string }));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,driver_earnings_cents=0,driver_gross_cents=0,driver_net_cents=0,cooperative_fee_cents=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(order.id),
    c.env.DB.prepare(`UPDATE financial_entries SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE delivery_id=? AND deleted_at IS NULL`).bind(order.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes)
      VALUES (?,?,?,?,'cancelled',?)`).bind(id(), order.id, order.cooperative_id, order.status, nullableText(payload.reason, 500))
  ]);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env, order.cooperative_id, order.establishment_id, 'delivery.status_changed', {
    id: order.id, external_id: order.external_id, old_status: order.status, status: 'cancelled'
  }));
  return c.json({ ok: true, order: { id: order.id, status: 'cancelled' } });
});
