import { Hono, type Context, type Next } from 'hono';
import type { AppBindings } from '../types';
import { addressJson, addressPoint, readAddressConfirmationToken } from '../lib/address';
import { hashPassword, randomToken, signJwt, verifyJwt, verifyPassword } from '../lib/crypto';
import { routeBetween, routePrice } from '../lib/maps';
import { bodyJson, cleanText, id, nullableText, toCents } from '../lib/util';
import { assignNextBaseDriver, type QueueAssignment } from '../lib/queue';
import { cooperativeCreditBalance, reconcileDeliveryCredit } from '../lib/wallet';
import { baseDirectReceivedPayment, baseReceivablePayment } from '../lib/financial-settlement';

export const clientRoutes = new Hono<AppBindings>();
type Row = Record<string, any>;
type CustomerToken = {
  kind:'customer';
  accountId:string;
  customerId:string;
  cooperativeId:string;
  cooperativeName?:string|null;
  guest?:boolean;
  name:string;
  email?:string|null;
  phone?:string|null;
  exp:number;
};

function normalizedPhone(value: unknown) {
  let digits=String(value||'').replace(/\D/g,'');
  if(digits.startsWith('55')&&digits.length>11)digits=digits.slice(2);
  return digits;
}

function phoneSql(column:string){
  return `replace(replace(replace(replace(replace(replace(COALESCE(${column},''),' ',''),'-',''),'(',''),')',''),'+',''),'.','')`;
}

async function activeCooperative(c:Context<AppBindings>,cooperativeId:string){
  return c.env.DB.prepare(`SELECT id,name,logo_url,primary_color,login_title,login_subtitle,login_footer_text FROM cooperatives WHERE id=? AND status='active' AND deleted_at IS NULL`)
    .bind(cooperativeId).first<Row>();
}

function normalizeDeliveryPayment(value: unknown) {
  const raw=String(value||'pix').trim().toLowerCase();
  if(['credit','credito','credito_antecipado','crédito antecipado'].includes(raw))return 'credit';
  if(['pix_cooperativa','pix cooperativa','pix-cooperativa'].includes(raw))return 'pix_cooperativa';
  if(['dinheiro','cash'].includes(raw))return 'dinheiro';
  if(['cartao_credito','cartão de crédito','cartao de credito','credito_cartao'].includes(raw))return 'cartao_credito';
  if(['cartao_debito','cartão de débito','cartao de debito','debito_cartao'].includes(raw))return 'cartao_debito';
  if(['vale_alimentacao','vale alimentação','vale alimentacao'].includes(raw))return 'vale_alimentacao';
  if(['vale_refeicao','vale refeição','vale refeicao'].includes(raw))return 'vale_refeicao';
  return 'pix';
}

async function customerAuth(c: Context<AppBindings>, next: Next) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return c.json({ ok:false, error:'Cliente não autenticado.' }, 401);
  try {
    const payload = await verifyJwt<CustomerToken>(token, c.env.JWT_SECRET);
    if (payload.kind !== 'customer'||!payload.cooperativeId) throw new Error();
    const active=await c.env.DB.prepare(`SELECT 1 ok FROM customer_accounts a JOIN cooperative_customers cc ON cc.customer_id=a.customer_id JOIN cooperatives cp ON cp.id=cc.cooperative_id WHERE a.id=? AND a.customer_id=? AND a.status='active' AND cc.cooperative_id=? AND cc.status='active' AND cp.status='active' AND cp.deleted_at IS NULL LIMIT 1`)
      .bind(payload.accountId,payload.customerId,payload.cooperativeId).first();
    if(!active)throw new Error();
    (c as any).set('customer', payload);
    await next();
  } catch {
    return c.json({ ok:false, error:'Sessão do cliente inválida.' }, 401);
  }
}

async function nextCode(c: Context<AppBindings>, cooperativeId: string) {
  const row = await c.env.DB.prepare(`
    INSERT INTO cooperative_sequences (cooperative_id,sequence_name,current_value,updated_at)
    VALUES (?,'delivery',1,CURRENT_TIMESTAMP)
    ON CONFLICT(cooperative_id,sequence_name)
    DO UPDATE SET current_value=current_value+1,updated_at=CURRENT_TIMESTAMP
    RETURNING current_value
  `).bind(cooperativeId).first<{ current_value:number }>();
  return `CJ-${String(row?.current_value || Date.now()).padStart(6, '0')}`;
}

async function uniqueCode(c: Context<AppBindings>, phone: string | null) {
  const used = new Set<string>();
  if (phone) {
    const rows = await c.env.DB.prepare(`SELECT DISTINCT confirmation_code FROM deliveries WHERE confirmation_code IS NOT NULL AND (customer_phone=? OR recipient_phone=?) LIMIT 9000`)
      .bind(phone, phone).all<{ confirmation_code:string }>();
    for (const row of rows.results || []) used.add(String(row.confirmation_code));
  }
  const buffer = new Uint32Array(1);
  for (let i=0; i<200; i+=1) {
    crypto.getRandomValues(buffer);
    const code = String(1000 + buffer[0] % 9000);
    if (!used.has(code)) return code;
  }
  for (let n=1000; n<=9999; n+=1) if (!used.has(String(n))) return String(n);
  throw new Error('Não foi possível gerar o código de confirmação.');
}

async function safeAssignNextBaseDriver(c:Context<AppBindings>,input:{cooperativeId:string;baseId:string;deliveryId:string;changedBy?:string|null}):Promise<QueueAssignment>{
  try{return await assignNextBaseDriver(c.env,input)}
  catch(error){console.error('Falha na atribuição automática do pedido',input.deliveryId,error);return {assigned:false}}
}

async function getServices(c: Context<AppBindings>, cooperativeId: string, raw: unknown) {
  const ids = Array.isArray(raw) ? raw.map(String).filter(Boolean).slice(0,40) : [];
  if (!ids.length) return { items: [] as Row[], total: 0 };
  const marks = ids.map(()=>'?').join(',');
  const rows = await c.env.DB.prepare(`SELECT id,name,add_cents FROM services WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL AND id IN (${marks})`)
    .bind(cooperativeId, ...ids).all<Row>();
  const items = rows.results || [];
  return { items, total: items.reduce((sum,row)=>sum+Number(row.add_cents||0),0) };
}

clientRoutes.get('/social-config', c => c.json({
  ok:true,
  providers:{ google:Boolean(c.env.GOOGLE_CLIENT_ID), microsoft:Boolean(c.env.MICROSOFT_CLIENT_ID), apple:Boolean(c.env.APPLE_CLIENT_ID) },
  message:'Os acessos sociais são ativados ao informar as credenciais no Cloudflare.'
}));

clientRoutes.post('/register', async c => {
  const body = await bodyJson<Row>(c);
  const name = cleanText(body.name,150);
  const email = cleanText(body.email,200).toLowerCase() || null;
  const phone = normalizedPhone(body.phone) || null;
  const password = String(body.password || '');
  if (!name || (!email && !phone) || password.length < 8) return c.json({ok:false,error:'Informe nome, celular ou e-mail e senha de pelo menos 8 caracteres.'},400);
  const cooperativeId=cleanText(body.cooperative_id,100);
  if(!cooperativeId)return c.json({ok:false,error:'Abra o cadastro pelo link enviado pela cooperativa.'},400);
  const cooperative=await activeCooperative(c,cooperativeId);
  if(!cooperative)return c.json({ok:false,error:'O link desta cooperativa não está disponível.'},404);

  const phoneExpression=phoneSql('a.phone');
  const existing=await c.env.DB.prepare(`SELECT a.id,a.customer_id,a.password_hash,a.password_salt,a.status,c.name,c.email customer_email,c.phone customer_phone,cc.status cooperative_status
    FROM customer_accounts a JOIN customers c ON c.id=a.customer_id
    LEFT JOIN cooperative_customers cc ON cc.customer_id=a.customer_id AND cc.cooperative_id=?
    WHERE a.provider='password' AND (lower(trim(COALESCE(a.email,c.email,'')))=? OR (?!='' AND ${phoneExpression} IN (?,?))) LIMIT 1`)
    .bind(cooperativeId,email||'',phone||'',phone||'',phone?`55${phone}`:'').first<Row>();
  if(existing){
    if(existing.status!=='active'||!existing.password_hash||!(await verifyPassword(password,existing.password_salt,existing.password_hash)))return c.json({ok:false,error:'Este celular ou e-mail já está cadastrado. Entre com a senha correta para vincular à cooperativa.'},409);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE customers SET name=?,phone=COALESCE(?,phone),email=COALESCE(?,email),updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(name,phone,email,existing.customer_id),
      c.env.DB.prepare(`INSERT INTO cooperative_customers(cooperative_id,customer_id,status) VALUES (?,?,'active') ON CONFLICT(cooperative_id,customer_id) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP`).bind(cooperativeId,existing.customer_id)
    ]);
    const token=await signJwt({kind:'customer',accountId:existing.id,customerId:existing.customer_id,cooperativeId,cooperativeName:cooperative.name,guest:false,name,email:email||existing.customer_email,phone:phone||existing.customer_phone},c.env.JWT_SECRET,30*86400);
    return c.json({ok:true,token,customer:{id:existing.customer_id,name,email:email||existing.customer_email,phone:phone||existing.customer_phone,cooperative_id:cooperativeId,cooperative_name:cooperative.name}},200);
  }
  const customerId=id(), accountId=id(), walletId=id(), hashed=await hashPassword(password);
  try {
    const statements:any[]=[
      c.env.DB.prepare(`INSERT INTO customers (id,name,phone,email) VALUES (?,?,?,?)`).bind(customerId,name,phone||'',email),
      c.env.DB.prepare(`INSERT INTO customer_accounts (id,customer_id,provider,email,phone,password_hash,password_salt,verified_at) VALUES (?,?,'password',?,?,?,?,CURRENT_TIMESTAMP)`).bind(accountId,customerId,email,phone,hashed.hash,hashed.salt),
      c.env.DB.prepare(`INSERT INTO customer_wallets (id,customer_id,balance_cents) VALUES (?,?,0)`).bind(walletId,customerId)
    ];
    if(cooperativeId)statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO cooperative_customers(cooperative_id,customer_id,status) VALUES (?,?,'active')`).bind(cooperativeId,customerId));
    await c.env.DB.batch(statements);
  } catch {
    return c.json({ok:false,error:'Este celular ou e-mail já está cadastrado.'},409);
  }
  const token=await signJwt({kind:'customer',accountId,customerId,cooperativeId,cooperativeName:cooperative.name,guest:false,name,email,phone},c.env.JWT_SECRET,30*86400);
  return c.json({ok:true,token,customer:{id:customerId,name,email,phone,cooperative_id:cooperativeId,cooperative_name:cooperative.name}},201);
});

clientRoutes.post('/login', async c => {
  const body=await bodyJson<Row>(c), login=cleanText(body.login,200).toLowerCase(), phone=normalizedPhone(body.login), password=String(body.password||''),cooperativeId=cleanText(body.cooperative_id,100);
  if(!cooperativeId)return c.json({ok:false,error:'Abra o acesso pelo link enviado pela cooperativa.'},400);
  const cooperative=await activeCooperative(c,cooperativeId);
  if(!cooperative)return c.json({ok:false,error:'O link desta cooperativa não está disponível.'},404);
  const expression=phoneSql('COALESCE(a.phone,c.phone)');
  const row=await c.env.DB.prepare(`SELECT a.id,a.customer_id,a.provider,a.email,a.phone,a.password_hash,a.password_salt,a.status,c.name,c.email customer_email,c.phone customer_phone,cc.status cooperative_status
    FROM customer_accounts a JOIN customers c ON c.id=a.customer_id
    LEFT JOIN cooperative_customers cc ON cc.customer_id=a.customer_id AND cc.cooperative_id=?
    WHERE a.status='active' AND a.provider='password' AND (lower(trim(COALESCE(a.email,c.email,'')))=? OR (?!='' AND ${expression} IN (?,?))) LIMIT 1`)
    .bind(cooperativeId,login,phone,phone,phone?`55${phone}`:'').first<Row>();
  if(!row||!row.password_hash||!(await verifyPassword(password,row.password_salt,row.password_hash)))return c.json({ok:false,error:'Celular/e-mail ou senha incorretos.'},401);
  if(['inactive','blocked'].includes(String(row.cooperative_status||'')))return c.json({ok:false,error:'Seu acesso está inativo nesta cooperativa. Fale com o atendimento.'},403);
  if(!row.cooperative_status)await c.env.DB.prepare(`INSERT INTO cooperative_customers(cooperative_id,customer_id,status) VALUES (?,?,'active')`).bind(cooperativeId,row.customer_id).run();
  const token=await signJwt({kind:'customer',accountId:row.id,customerId:row.customer_id,cooperativeId,cooperativeName:cooperative.name,guest:false,name:row.name,email:row.email||row.customer_email,phone:row.phone||row.customer_phone},c.env.JWT_SECRET,30*86400);
  return c.json({ok:true,token,customer:{id:row.customer_id,name:row.name,email:row.email||row.customer_email,phone:row.phone||row.customer_phone,cooperative_id:cooperativeId,cooperative_name:cooperative.name}});
});


clientRoutes.post('/guest', async c => {
  const body=await bodyJson<Row>(c),name=cleanText(body.name,150),phone=normalizedPhone(body.phone)||null,email=cleanText(body.email,200).toLowerCase()||null;
  if(!name||(!phone&&!email))return c.json({ok:false,error:'Informe seu nome e um celular ou e-mail.'},400);
  const cooperativeId=cleanText(body.cooperative_id,100);
  if(!cooperativeId)return c.json({ok:false,error:'Abra o pedido pelo link enviado pela cooperativa.'},400);
  const cooperative=await activeCooperative(c,cooperativeId);
  if(!cooperative)return c.json({ok:false,error:'O link desta cooperativa não está disponível.'},404);
  const customerId=id(),accountId=id(),walletId=id(),subject=randomToken(18);
  const statements:any[]=[
    c.env.DB.prepare(`INSERT INTO customers(id,name,phone,email) VALUES (?,?,?,?)`).bind(customerId,name,phone||'',email),
    c.env.DB.prepare(`INSERT INTO customer_accounts(id,customer_id,provider,provider_subject,email,phone,status,verified_at) VALUES (?,?,'guest',?,?,?,?,CURRENT_TIMESTAMP)`).bind(accountId,customerId,subject,email,phone,'active'),
    c.env.DB.prepare(`INSERT INTO customer_wallets(id,customer_id,balance_cents) VALUES (?,?,0)`).bind(walletId,customerId)
  ];
  if(cooperativeId)statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO cooperative_customers(cooperative_id,customer_id,status) VALUES (?,?,'active')`).bind(cooperativeId,customerId));
  await c.env.DB.batch(statements);
  const token=await signJwt({kind:'customer',accountId,customerId,cooperativeId,cooperativeName:cooperative.name,guest:true,name,email,phone},c.env.JWT_SECRET,7*86400);
  return c.json({ok:true,token,customer:{id:customerId,name,email,phone,guest:true,cooperative_id:cooperativeId,cooperative_name:cooperative.name}},201);
});

clientRoutes.get('/catalog', async c => {
  const cooperativeId=cleanText(c.req.query('cooperative_id')||c.req.query('coop'),100);
  const cooperativeWhere=cooperativeId?' AND id=?':'';
  const cooperatives=await c.env.DB.prepare(`SELECT id,name,logo_url,primary_color,address,address_city,address_state,base_tracking_enabled,login_title,login_subtitle,login_footer_text FROM cooperatives WHERE status='active' AND deleted_at IS NULL${cooperativeWhere} ORDER BY name`).bind(...(cooperativeId?[cooperativeId]:[])).all();
  const bases=await c.env.DB.prepare(`SELECT b.id,b.cooperative_id,b.name,b.address,b.city,b.state,b.minimum_fee_cents,b.rate_per_km_cents,b.tracking_enabled,c.name cooperative_name FROM bases b JOIN cooperatives c ON c.id=b.cooperative_id WHERE b.active=1 AND b.deleted_at IS NULL AND c.status='active'${cooperativeId?' AND b.cooperative_id=?':''} ORDER BY c.name,b.name`).bind(...(cooperativeId?[cooperativeId]:[])).all();
  const services=await c.env.DB.prepare(`SELECT id,cooperative_id,base_id,name,description,add_cents FROM services WHERE active=1 AND deleted_at IS NULL${cooperativeId?' AND cooperative_id=?':''} ORDER BY name`).bind(...(cooperativeId?[cooperativeId]:[])).all();
  return c.json({ok:true,cooperatives:cooperatives.results,bases:bases.results,services:services.results});
});

clientRoutes.post('/quote', async c => {
  const body=await bodyJson<Row>(c);
  const base=await c.env.DB.prepare(`SELECT * FROM bases WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`)
    .bind(cleanText(body.base_id,100),cleanText(body.cooperative_id,100)).first<Row>();
  if(!base)return c.json({ok:false,error:'Base indisponível.'},404);
  const pickup=await readAddressConfirmationToken(c.env,body.pickup_confirmation_token);
  const destination=await readAddressConfirmationToken(c.env,body.delivery_confirmation_token);
  const basePoint=Number.isFinite(Number(base.latitude))&&Number.isFinite(Number(base.longitude))?{lat:Number(base.latitude),lng:Number(base.longitude)}:null;
  const route=await routeBetween(c.env,basePoint?[basePoint,addressPoint(pickup),addressPoint(destination)]:[addressPoint(pickup),addressPoint(destination)]);
  if(!route)return c.json({ok:false,error:'Não foi possível calcular a rota pelas ruas.'},400);
  const services=await getServices(c,base.cooperative_id,body.service_ids);
  const charge=routePrice(route.distance_meters,Number(base.rate_per_km_cents),Number(base.minimum_fee_cents),services.total);
  return c.json({ok:true,quote:{charge_cents:charge,services_cents:services.total,distance_meters:route.distance_meters,duration_seconds:route.duration_seconds,pickup,destination,geometry:route.geometry,services:services.items}});
});

clientRoutes.use('/me',customerAuth);
clientRoutes.use('/wallet',customerAuth);
clientRoutes.use('/wallet/*',customerAuth);
clientRoutes.use('/orders',customerAuth);
clientRoutes.use('/orders/*',customerAuth);

clientRoutes.get('/me',async c=>{
  const user=(c as any).get('customer') as CustomerToken;
  const customer=await c.env.DB.prepare(`SELECT c.id,c.name,c.phone,c.email,c.created_at,c.updated_at,cp.id cooperative_id,cp.name cooperative_name,cp.logo_url cooperative_logo_url,cp.primary_color cooperative_primary_color,a.provider account_provider FROM customers c JOIN customer_accounts a ON a.id=? AND a.customer_id=c.id JOIN cooperative_customers cc ON cc.customer_id=c.id AND cc.cooperative_id=? AND cc.status='active' JOIN cooperatives cp ON cp.id=cc.cooperative_id WHERE c.id=?`).bind(user.accountId,user.cooperativeId,user.customerId).first<Row>();
  return c.json({ok:true,customer:{...customer,guest:customer?.account_provider==='guest'}});
});
clientRoutes.get('/wallet',async c=>{
  const user=(c as any).get('customer') as CustomerToken;
  const wallet=await c.env.DB.prepare(`SELECT id,customer_id,updated_at FROM customer_wallets WHERE customer_id=?`).bind(user.customerId).first<Row>();
  const balance=await cooperativeCreditBalance(c.env,user.customerId,user.cooperativeId);
  const cooperative=await activeCooperative(c,user.cooperativeId);
  const transactions=wallet?await c.env.DB.prepare(`SELECT t.id,t.entry_type,t.category,t.amount_cents,t.description,t.status,t.created_at,t.delivery_id,t.reason,d.display_code FROM customer_wallet_transactions t LEFT JOIN deliveries d ON d.id=t.delivery_id WHERE t.wallet_id=? AND t.cooperative_id=? ORDER BY t.created_at DESC LIMIT 200`).bind(wallet.id,user.cooperativeId).all<Row>():{results:[]};
  const pending=await c.env.DB.prepare(`SELECT id,amount_cents,payment_method,status,proof_url,created_at,updated_at FROM credit_purchase_requests WHERE customer_id=? AND cooperative_id=? ORDER BY created_at DESC LIMIT 50`).bind(user.customerId,user.cooperativeId).all<Row>();
  return c.json({ok:true,wallet:{...(wallet||{}),balance_cents:balance,cooperative_id:user.cooperativeId,cooperative_name:cooperative?.name||user.cooperativeName||''},transactions:transactions.results,purchase_requests:pending.results});
});
clientRoutes.post('/wallet/topups',async c=>{
  const user=(c as any).get('customer') as CustomerToken,body=await bodyJson<Row>(c),amount=Math.max(0,toCents(body.amount)),cooperativeId=user.cooperativeId;
  if(amount<100)return c.json({ok:false,error:'Valor mínimo de crédito: R$ 1,00.'},400);
  const cooperative=await activeCooperative(c,cooperativeId);if(!cooperative)return c.json({ok:false,error:'Cooperativa indisponível.'},400);
  const requestId=id();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO credit_purchase_requests (id,customer_id,cooperative_id,amount_cents,payment_method,proof_url) VALUES (?,?,?,?,?,?)`).bind(requestId,user.customerId,cooperativeId,amount,cleanText(body.payment_method||'pix',30),nullableText(body.proof_url,1000)),
    c.env.DB.prepare(`INSERT INTO notification_events(id,cooperative_id,event_type,title,message) VALUES (?,?,'credit_requested','Nova solicitação de crédito',?)`).bind(id(),cooperativeId,`${user.name||'Cliente'} solicitou R$ ${(amount/100).toFixed(2).replace('.',',')} em crédito.`)
  ]);
  return c.json({ok:true,id:requestId,message:`Solicitação enviada para ${cooperative.name} e mantida como pendente até a aprovação.`},201);
});

clientRoutes.get('/orders',async c=>{
  const user=(c as any).get('customer') as CustomerToken;
  const rows=await c.env.DB.prepare(`
    SELECT r.*,c.name cooperative_name,b.name base_name,d.display_code,d.status delivery_status,d.tracking_token,
      d.tracking_enabled,d.confirmation_code,d.cash_payment_location,d.receipt_number,dr.id rating_id
    FROM customer_requests r JOIN cooperatives c ON c.id=r.cooperative_id LEFT JOIN bases b ON b.id=r.base_id
    LEFT JOIN deliveries d ON d.id=r.delivery_id LEFT JOIN delivery_ratings dr ON dr.delivery_id=d.id
    WHERE r.customer_id=? AND r.cooperative_id=? ORDER BY r.created_at DESC
  `).bind(user.customerId,user.cooperativeId).all<Row>();
  const items=(rows.results||[]).map((row:Row)=>({
    ...row,
    tracking_url:Number(row.tracking_enabled||0)===1&&row.tracking_token?`${c.env.APP_URL.replace(/\/$/,'')}/r/${row.tracking_token}`:null,
    receipt_url:row.delivery_status==='delivered'&&row.tracking_token?`${c.env.APP_URL.replace(/\/$/,'')}/api/public/tracking/${row.tracking_token}/receipt`:null,
    can_rate:row.delivery_status==='delivered'&&!row.rating_id
  }));
  return c.json({ok:true,items});
});

clientRoutes.post('/orders/:id/reorder',async c=>{
  const user=(c as any).get('customer') as CustomerToken;
  const source=await c.env.DB.prepare(`SELECT
      r.id request_source_id,r.cooperative_id,r.payment_method request_payment_method,r.quoted_cents,r.notes request_notes,
      d.id source_delivery_id,d.establishment_id,d.customer_name,d.customer_phone,d.pickup_contact_name,d.pickup_phone,
      d.pickup_address,d.pickup_neighborhood,d.recipient_name,d.recipient_phone,d.delivery_address,d.delivery_neighborhood,
      d.item_description,d.amount_to_collect_cents,d.pickup_lat,d.pickup_lng,d.delivery_lat,d.delivery_lng,d.charge_cents,d.driver_earnings_cents,
      d.cooperative_fee_cents,d.payment_method,d.notes,d.display_code,d.delivery_type,d.base_id,d.distance_meters,
      d.duration_seconds,d.route_geometry,d.driver_gross_cents,d.driver_net_cents,d.services_cents,d.tracking_enabled,
      d.pickup_address_json,d.delivery_address_json,d.pickup_place_id,d.delivery_place_id,d.addresses_confirmed,
      d.cash_payment_location,d.customer_chat_enabled,d.driver_call_enabled,d.pickup_apartment,d.pickup_complement,
      d.delivery_apartment,d.delivery_complement,b.active base_active,b.deleted_at base_deleted
    FROM customer_requests r JOIN deliveries d ON d.id=r.delivery_id
    JOIN bases b ON b.id=r.base_id WHERE r.id=? AND r.customer_id=? AND r.cooperative_id=? LIMIT 1`)
    .bind(c.req.param('id'),user.customerId,user.cooperativeId).first<Row>();
  if(!source)return c.json({ok:false,error:'Pedido não encontrado no seu histórico.'},404);
  if(!Number(source.base_active||0)||source.base_deleted)return c.json({ok:false,error:'A Base deste pedido não está disponível.'},409);
  const payment=normalizeDeliveryPayment(source.request_payment_method||source.payment_method||'pix');
  const charge=Number(source.quoted_cents||source.charge_cents||0);
  if(payment==='credit'){
    const balance=await cooperativeCreditBalance(c.env,user.customerId,source.cooperative_id);
    if(balance<charge)return c.json({ok:false,error:`Crédito insuficiente. Disponível: R$ ${(balance/100).toFixed(2).replace('.',',')}.`},409);
  }
  const requestId=id(),deliveryId=id(),trackingToken=randomToken(24),displayCode=await nextCode(c,source.cooperative_id),confirmationCode=await uniqueCode(c,source.recipient_phone||source.customer_phone||user.phone||null);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO deliveries(
      id,cooperative_id,establishment_id,source,customer_id,customer_name,customer_phone,pickup_contact_name,pickup_phone,pickup_address,pickup_neighborhood,
      recipient_name,recipient_phone,delivery_address,delivery_neighborhood,item_description,amount_to_collect_cents,pickup_lat,pickup_lng,delivery_lat,delivery_lng,status,
      charge_cents,driver_earnings_cents,cooperative_fee_cents,payment_method,payment_status,notes,tracking_token,display_code,delivery_type,base_id,
      distance_meters,duration_seconds,route_geometry,driver_gross_cents,driver_net_cents,services_cents,tracking_enabled,pickup_address_json,
      delivery_address_json,pickup_place_id,delivery_place_id,addresses_confirmed,cash_payment_location,confirmation_code,
      confirmation_required,finish_without_code_authorized,customer_chat_enabled,driver_call_enabled,pickup_apartment,pickup_complement,
      delivery_apartment,delivery_complement,cloned_from_delivery_id,credit_used_cents
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'offered',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(deliveryId,source.cooperative_id,source.establishment_id,'customer_reorder',user.customerId,source.customer_name||user.name,source.customer_phone||user.phone||'',source.pickup_contact_name,source.pickup_phone,source.pickup_address,source.pickup_neighborhood,
        source.recipient_name,source.recipient_phone,source.delivery_address,source.delivery_neighborhood,source.item_description,source.delivery_type==='base'?0:Number(source.amount_to_collect_cents||0),source.pickup_lat,source.pickup_lng,source.delivery_lat,source.delivery_lng,
        charge,source.driver_earnings_cents,source.cooperative_fee_cents,payment,payment==='credit'?'paid':'pending',source.request_notes||source.notes,trackingToken,displayCode,source.delivery_type,source.base_id,
        source.distance_meters,source.duration_seconds,source.route_geometry,source.driver_gross_cents,source.driver_net_cents,source.services_cents,source.tracking_enabled,source.pickup_address_json,
        source.delivery_address_json,source.pickup_place_id,source.delivery_place_id,source.addresses_confirmed,source.cash_payment_location,confirmationCode,
        1,0,source.customer_chat_enabled,source.driver_call_enabled,source.pickup_apartment,source.pickup_complement,
        source.delivery_apartment,source.delivery_complement,source.source_delivery_id,payment==='credit'?charge:0),
    c.env.DB.prepare(`INSERT INTO customer_requests(id,cooperative_id,customer_id,customer_name,customer_phone,pickup_address,pickup_neighborhood,pickup_contact_name,pickup_phone,delivery_address,delivery_neighborhood,recipient_name,recipient_phone,item_description,amount_to_collect_cents,payment_method,quoted_cents,notes,status,delivery_id,base_id,services_cents,distance_meters,duration_seconds,credit_used_cents,pickup_address_json,delivery_address_json,cash_payment_location,confirmation_code,pickup_apartment,pickup_complement,delivery_apartment,delivery_complement) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'converted',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(requestId,source.cooperative_id,user.customerId,source.customer_name||user.name,source.customer_phone||user.phone||'',source.pickup_address,source.pickup_neighborhood,source.pickup_contact_name,source.pickup_phone,source.delivery_address,source.delivery_neighborhood,source.recipient_name,source.recipient_phone,source.item_description,source.delivery_type==='base'?0:Number(source.amount_to_collect_cents||0),payment,charge,source.request_notes||source.notes,deliveryId,source.base_id,source.services_cents,source.distance_meters,source.duration_seconds,payment==='credit'?charge:0,source.pickup_address_json,source.delivery_address_json,source.cash_payment_location,confirmationCode,source.pickup_apartment,source.pickup_complement,source.delivery_apartment,source.delivery_complement),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,new_status,notes) VALUES (?,?,?,'offered','Pedido repetido pelo cliente a partir do histórico')`).bind(id(),deliveryId,source.cooperative_id),
    c.env.DB.prepare(`INSERT OR IGNORE INTO cooperative_customers(cooperative_id,customer_id) VALUES (?,?)`).bind(source.cooperative_id,user.customerId)
  ]);
  const services=await c.env.DB.prepare(`SELECT service_id,service_name,add_cents FROM delivery_services WHERE delivery_id=?`).bind(source.source_delivery_id).all<Row>();
  if((services.results||[]).length)await c.env.DB.batch((services.results||[]).map(x=>c.env.DB.prepare(`INSERT INTO delivery_services(delivery_id,service_id,service_name,add_cents) VALUES (?,?,?,?)`).bind(deliveryId,x.service_id,x.service_name,x.add_cents)));
  if(payment==='credit')await reconcileDeliveryCredit(c.env,{deliveryId,cooperativeId:source.cooperative_id,customerId:user.customerId,desiredCents:charge,displayCode,reason:`Crédito consumido ao repetir o pedido ${source.display_code}`,requestId});
  const automaticAssignment=await safeAssignNextBaseDriver(c,{cooperativeId:source.cooperative_id,baseId:source.base_id,deliveryId,changedBy:null});
  return c.json({ok:true,order:{id:requestId,delivery_id:deliveryId,display_code:displayCode,status:automaticAssignment.assigned?'assigned':'offered',charge_cents:charge,tracking_url:Number(source.tracking_enabled||0)===1?`${c.env.APP_URL.replace(/\/$/,'')}/r/${trackingToken}`:null}},201);
});

clientRoutes.post('/orders', async c => {
  const user=(c as any).get('customer') as CustomerToken;
  const body=await bodyJson<Row>(c);
  const base=await c.env.DB.prepare(`SELECT b.*,c.base_tracking_enabled,c.inss_percent,c.sest_senat_percent FROM bases b JOIN cooperatives c ON c.id=b.cooperative_id WHERE b.id=? AND b.cooperative_id=? AND b.active=1 AND b.deleted_at IS NULL`)
    .bind(cleanText(body.base_id,100),user.cooperativeId).first<Row>();
  if(!base)return c.json({ok:false,error:'Base indisponível.'},404);
  const pickup=await readAddressConfirmationToken(c.env,body.pickup_confirmation_token);
  const destination=await readAddressConfirmationToken(c.env,body.delivery_confirmation_token);
  const basePoint=Number.isFinite(Number(base.latitude))&&Number.isFinite(Number(base.longitude))?{lat:Number(base.latitude),lng:Number(base.longitude)}:null;
  const route=await routeBetween(c.env,basePoint?[basePoint,addressPoint(pickup),addressPoint(destination)]:[addressPoint(pickup),addressPoint(destination)]);
  if(!route)return c.json({ok:false,error:'Não foi possível calcular a rota pelas ruas.'},400);
  const services=await getServices(c,base.cooperative_id,body.service_ids);
  const charge=routePrice(route.distance_meters,Number(base.rate_per_km_cents),Number(base.minimum_fee_cents),services.total);
  const amountToCollect=0;
  const customer=await c.env.DB.prepare(`SELECT * FROM customers WHERE id=?`).bind(user.customerId).first<Row>();
  const payment=normalizeDeliveryPayment(body.payment_method||'pix');
  const cashPayment=['dinheiro','cash'].includes(payment);
  const cashLocation=cashPayment?cleanText(body.cash_payment_location,20):null;
  if(cashPayment&&!['pickup','delivery'].includes(String(cashLocation)))return c.json({ok:false,error:'Informe se o dinheiro será pago na coleta ou na entrega.'},400);
  let wallet:Row|null=null;
  if(payment==='credit'){
    wallet=await c.env.DB.prepare(`SELECT w.*,COALESCE((SELECT SUM(CASE WHEN t.entry_type='credit' THEN t.amount_cents ELSE -t.amount_cents END) FROM customer_wallet_transactions t WHERE t.wallet_id=w.id AND t.cooperative_id=? AND t.status='confirmed'),0) cooperative_balance_cents FROM customer_wallets w WHERE w.customer_id=?`).bind(base.cooperative_id,user.customerId).first<Row>();
    if(!wallet||Number(wallet.cooperative_balance_cents)<charge)return c.json({ok:false,error:'Crédito pré-pago insuficiente nesta cooperativa.'},409);
  }
  const requestId=id(),deliveryId=id(),trackingToken=randomToken(24),displayCode=await nextCode(c,base.cooperative_id);
  const fee=Math.round(charge*Number(base.cooperative_fee_percent||0)/100),gross=charge-fee;
  const taxable=baseReceivablePayment(payment);
  const inss=taxable?Math.round(gross*Number(base.inss_percent||0)/100):0,sest=taxable?Math.round(gross*Number(base.sest_senat_percent||0)/100):0,net=Math.max(0,gross-inss-sest);
  const confirmationCode=await uniqueCode(c,cleanText(body.recipient_phone||customer?.phone||user.phone,50)||null);
  const confirmationRequired=1;
  const finishWithoutCode=0;
  const trackingEnabled=Number(base.tracking_enabled??base.base_tracking_enabled??1)===1;
  const pickupText=pickup.formatted_address,deliveryText=destination.formatted_address;
  const statements:any[]=[
    c.env.DB.prepare(`INSERT OR IGNORE INTO cooperative_customers (cooperative_id,customer_id) VALUES (?,?)`).bind(base.cooperative_id,user.customerId),
    c.env.DB.prepare(`INSERT INTO deliveries (
      id,cooperative_id,establishment_id,source,customer_name,customer_phone,pickup_contact_name,pickup_phone,pickup_address,pickup_neighborhood,
      recipient_name,recipient_phone,delivery_address,delivery_neighborhood,item_description,amount_to_collect_cents,pickup_lat,pickup_lng,delivery_lat,delivery_lng,status,
      charge_cents,driver_earnings_cents,cooperative_fee_cents,payment_method,payment_status,notes,tracking_token,display_code,delivery_type,base_id,
      distance_meters,duration_seconds,route_geometry,driver_gross_cents,driver_net_cents,services_cents,tracking_enabled,pickup_address_json,
      delivery_address_json,pickup_place_id,delivery_place_id,addresses_confirmed,cash_payment_location,confirmation_code,
      confirmation_required,finish_without_code_authorized,customer_chat_enabled,driver_call_enabled,
      pickup_apartment,pickup_complement,delivery_apartment,delivery_complement
    ) VALUES (?,?,?,'customer_app_v7',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'offered',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(deliveryId,base.cooperative_id,base.virtual_establishment_id,customer?.name||user.name,customer?.phone||user.phone||'',nullableText(body.pickup_contact_name,150),nullableText(body.pickup_phone,50),pickupText,pickup.neighborhood||null,nullableText(body.recipient_name,150),nullableText(body.recipient_phone,50),deliveryText,destination.neighborhood||null,nullableText(body.item_description,500),amountToCollect,pickup.lat,pickup.lng,destination.lat,destination.lng,charge,gross,fee,payment,payment==='credit'?'paid':'pending',nullableText(body.notes,1500),trackingToken,displayCode,'base',base.id,route.distance_meters,route.duration_seconds,JSON.stringify(route.geometry),gross,net,services.total,trackingEnabled?1:0,addressJson(pickup),addressJson(destination),pickup.provider_id||null,destination.provider_id||null,1,cashLocation,confirmationCode,confirmationRequired,finishWithoutCode,Number(base.customer_chat_enabled??1),Number(base.driver_call_enabled??0),nullableText(body.pickup_apartment,80),nullableText(body.pickup_complement,250),nullableText(body.delivery_apartment,80),nullableText(body.delivery_complement,250)),
    c.env.DB.prepare(`UPDATE deliveries SET customer_id=?,credit_used_cents=? WHERE id=?`).bind(user.customerId,payment==='credit'?charge:0,deliveryId),
    c.env.DB.prepare(`INSERT INTO customer_requests (
      id,cooperative_id,customer_id,customer_name,customer_phone,pickup_address,pickup_neighborhood,pickup_contact_name,pickup_phone,
      delivery_address,delivery_neighborhood,recipient_name,recipient_phone,item_description,amount_to_collect_cents,payment_method,quoted_cents,notes,status,
      delivery_id,base_id,services_cents,distance_meters,duration_seconds,credit_used_cents,pickup_address_json,delivery_address_json,
      cash_payment_location,confirmation_code,pickup_apartment,pickup_complement,delivery_apartment,delivery_complement
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'converted',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(requestId,base.cooperative_id,user.customerId,customer?.name||user.name,customer?.phone||user.phone||'',pickupText,pickup.neighborhood||null,nullableText(body.pickup_contact_name,150),nullableText(body.pickup_phone,50),deliveryText,destination.neighborhood||null,nullableText(body.recipient_name,150),nullableText(body.recipient_phone,50),nullableText(body.item_description,500),amountToCollect,payment,charge,nullableText(body.notes,1500),deliveryId,base.id,services.total,route.distance_meters,route.duration_seconds,payment==='credit'?charge:0,addressJson(pickup),addressJson(destination),cashLocation,confirmationCode,nullableText(body.pickup_apartment,80),nullableText(body.pickup_complement,250),nullableText(body.delivery_apartment,80),nullableText(body.delivery_complement,250)),
    c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,new_status,notes) VALUES (?,?,?,'offered','Solicitada pelo aplicativo ChegaJá com endereços confirmados')`).bind(id(),deliveryId,base.cooperative_id)
  ];
  for(const service of services.items)statements.push(c.env.DB.prepare(`INSERT INTO delivery_services (delivery_id,service_id,service_name,add_cents) VALUES (?,?,?,?)`).bind(deliveryId,service.id,service.name,service.add_cents));
  await c.env.DB.batch(statements);
  if(payment==='credit')await reconcileDeliveryCredit(c.env,{deliveryId,cooperativeId:base.cooperative_id,customerId:user.customerId,desiredCents:charge,displayCode,reason:`Crédito consumido ao confirmar o pedido ${displayCode}`,requestId});
  const automaticAssignment=await safeAssignNextBaseDriver(c,{cooperativeId:base.cooperative_id,baseId:base.id,deliveryId,changedBy:null});
  const finalStatus=automaticAssignment.assigned?'assigned':'offered';
  return c.json({ok:true,order:{id:requestId,delivery_id:deliveryId,display_code:displayCode,status:finalStatus,assigned_driver_id:automaticAssignment.driverId||null,assigned_driver_name:automaticAssignment.driverName||null,charge_cents:charge,confirmation_code:confirmationCode,tracking_enabled:trackingEnabled,tracking_url:trackingEnabled?`${c.env.APP_URL.replace(/\/$/,'')}/r/${trackingToken}`:null}},201);
});

// ChegaJá 14.2 — cancelamento pelo cliente preservando o histórico na Base.
clientRoutes.post('/orders/:id/cancel',async c=>{
  const user=(c as any).get('customer') as CustomerToken;
  const row=await c.env.DB.prepare(`SELECT r.id request_id,r.delivery_id,r.status request_status,r.credit_used_cents,d.status delivery_status,d.display_code,d.credit_used_cents delivery_credit FROM customer_requests r LEFT JOIN deliveries d ON d.id=r.delivery_id WHERE r.id=? AND r.customer_id=? AND r.cooperative_id=? LIMIT 1`).bind(c.req.param('id'),user.customerId,user.cooperativeId).first<Row>();
  if(!row)return c.json({ok:false,error:'Pedido não encontrado.'},404);
  if(['delivered','cancelled'].includes(String(row.delivery_status||row.request_status)))return c.json({ok:false,error:'Este pedido já foi encerrado.'},409);
  const body=await bodyJson<Row>(c).catch(()=>({} as Row)),reason=cleanText(body.reason||'Cancelado pelo cliente',500);
  const credit=Number(row.delivery_credit||row.credit_used_cents||0);
  if(row.delivery_id&&credit>0)await reconcileDeliveryCredit(c.env,{deliveryId:row.delivery_id,cooperativeId:user.cooperativeId,customerId:user.customerId,desiredCents:0,displayCode:row.display_code||'Pedido',reason:`${reason}. Crédito devolvido.`});
  const statements:D1PreparedStatement[]=[c.env.DB.prepare(`UPDATE customer_requests SET status='cancelled',credit_used_cents=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.request_id)];
  if(row.delivery_id){statements.push(c.env.DB.prepare(`UPDATE deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,payment_status=CASE WHEN payment_method='credit' THEN 'cancelled' ELSE payment_status END,credit_used_cents=0,driver_earnings_cents=0,driver_gross_cents=0,driver_net_cents=0,cooperative_fee_cents=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.delivery_id));statements.push(c.env.DB.prepare(`UPDATE financial_entries SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE delivery_id=? AND deleted_at IS NULL`).bind(row.delivery_id));statements.push(c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes) VALUES (?,?,?,?,'cancelled',?)`).bind(id(),row.delivery_id,user.cooperativeId,row.delivery_status,reason));}
  await c.env.DB.batch(statements);return c.json({ok:true,refunded_cents:credit});
});
