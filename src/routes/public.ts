import { Hono, type Context } from 'hono';
import type { AppBindings } from '../types';
import { makeAddressConfirmationToken } from '../lib/address';
import { searchAddressCandidates, searchFreeAddressCandidates, type AddressSearchInput } from '../lib/maps';
import { cleanText, id, saoPauloDate } from '../lib/util';
import { queueWebhookEvent } from '../lib/webhooks';
import { cooperativeCreditBalance, reconcileDeliveryCredit } from '../lib/wallet';
import { baseDirectReceivedPayment, baseReceivablePayment } from '../lib/financial-settlement';

export const publicRoutes = new Hono<AppBindings>();


publicRoutes.get('/asset-logo/:type/:id',async c=>{
  const type=String(c.req.param('type')||'');
  if(!['cooperative','establishment','driver'].includes(type))return c.json({ok:false,error:'Tipo de imagem inválido.'},400);
  const row=await c.env.DB.prepare(`SELECT mime_type,data_base64,updated_at FROM branding_assets WHERE entity_type=? AND entity_id=?`).bind(type,c.req.param('id')).first<Row>();
  if(!row)return c.json({ok:false,error:'Imagem não encontrada.'},404);
  const binary=atob(String(row.data_base64||'')),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Response(bytes,{headers:{'Content-Type':String(row.mime_type||'image/png'),'Cache-Control':'public, max-age=86400, immutable'}});
});

publicRoutes.get('/branding/:cooperativeId',async c=>{
  const item=await c.env.DB.prepare(`SELECT id,name,logo_url,primary_color,login_title,login_subtitle,login_footer_text FROM cooperatives WHERE id=? AND status='active' AND deleted_at IS NULL`).bind(c.req.param('cooperativeId')).first<Row>();
  if(!item)return c.json({ok:false,error:'Cooperativa não encontrada.'},404);
  return c.json({ok:true,item});
});

type Row = Record<string, any>;

async function addressDefaults(c: Context<AppBindings>, body: Row) {
  if (body.base_id) {
    const row = await c.env.DB.prepare(`
      SELECT b.cooperative_id,b.city,b.state,c.address_city,c.address_state
      FROM bases b JOIN cooperatives c ON c.id=b.cooperative_id
      WHERE b.id=? AND b.deleted_at IS NULL
    `).bind(cleanText(body.base_id,100)).first<Row>();
    if (row) return { city:row.city||row.address_city||'', state:row.state||row.address_state||'', cooperativeId:row.cooperative_id };
  }
  if (body.establishment_id) {
    const row = await c.env.DB.prepare(`
      SELECT e.cooperative_id,e.city,e.state,c.address_city,c.address_state
      FROM establishments e JOIN cooperatives c ON c.id=e.cooperative_id
      WHERE e.id=? AND e.deleted_at IS NULL
    `).bind(cleanText(body.establishment_id,100)).first<Row>();
    if (row) return { city:row.city||row.address_city||'', state:row.state||row.address_state||'', cooperativeId:row.cooperative_id };
  }
  const row = body.cooperative_id ? await c.env.DB.prepare(`SELECT id,address_city,address_state FROM cooperatives WHERE id=? AND deleted_at IS NULL`)
    .bind(cleanText(body.cooperative_id,100)).first<Row>() : null;
  return { city:row?.address_city||'', state:row?.address_state||'', cooperativeId:row?.id||body.cooperative_id||null };
}

publicRoutes.post('/address/autocomplete', async c => {
  const body=await c.req.json<Row>().catch(()=>({} as Row));
  const defaults=await addressDefaults(c,body);
  const query=cleanText(body.query,350);
  if(query.length<3)return c.json({ok:true,items:[]});
  const state=cleanText(body.state||defaults.state||'RN',80),city=body.restrict_city?cleanText(body.city||defaults.city||'',120):'';
  if(!state)return c.json({ok:false,error:'Estado não configurado.'},400);
  const numberMatch=query.match(/^(.*?)[,\s]+(\d+[A-Za-z0-9\/-]*)\s*(?:,|$)/);
  let found;
  if(numberMatch&&city){
    const input: AddressSearchInput={street:numberMatch[1].trim(),number:numberMatch[2].trim(),neighborhood:'',city,state,postal_code:'',country:'Brasil'};
    found=await searchAddressCandidates(c.env,input);
  }else{
    // Sem restrição de cidade, inclusive quando o texto contém número, a busca livre
    // mantém o escopo em todo o Rio Grande do Norte e aceita nomes de empresas/locais.
    found=await searchFreeAddressCandidates(c.env,query,city,state);
  }
  const items=await Promise.all(found.map(async candidate=>{
    const confirmable=Boolean(candidate.exact_state&&Number.isFinite(candidate.lat)&&Number.isFinite(candidate.lng));
    return {...candidate,confirmable,confirmation_token:confirmable?await makeAddressConfirmationToken(c.env,candidate,defaults.cooperativeId):null};
  }));
  return c.json({ok:true,items,locality:city?`${city}/${state}`:`Rio Grande do Norte/${state}`,scope:city?'city':'state'});
});

publicRoutes.post('/address/search', async c => {
  const body = await c.req.json<Row>().catch(() => ({} as Row));
  const defaults = await addressDefaults(c,body);
  const input: AddressSearchInput = {
    street:cleanText(body.street,250), number:cleanText(body.number,30), neighborhood:cleanText(body.neighborhood,150),
    city:cleanText(body.city||defaults.city,120), state:cleanText(body.state||defaults.state,80),
    postal_code:cleanText(body.postal_code,20), country:'Brasil'
  };
  if(!input.street||!input.number||!input.city||!input.state)return c.json({ok:false,error:'Informe rua, número, cidade e estado para confirmar o endereço.'},400);
  const found=await searchAddressCandidates(c.env,input);
  const items=await Promise.all(found.map(async candidate=>{
    const confirmable=candidate.exact_number&&candidate.exact_city&&candidate.exact_state&&['rooftop','interpolated'].includes(candidate.precision);
    return {
      ...candidate, confirmable,
      confirmation_token:confirmable?await makeAddressConfirmationToken(c.env,candidate,defaults.cooperativeId):null,
      warning:confirmable?null:!candidate.exact_number?'O número não foi confirmado pelo mapa.':!candidate.exact_city||!candidate.exact_state?'O resultado está em outra cidade ou estado.':'A localização é aproximada.'
    };
  }));
  return c.json({ok:true,query:input,items,requires_confirmation:true});
});

async function trackingItem(c: Context<AppBindings>, token: string) {
  return c.env.DB.prepare(`
    SELECT
      d.id,d.cooperative_id,d.establishment_id,d.base_id,d.assigned_driver_id,d.delivery_type,d.tracking_enabled,d.customer_id,
      d.display_code,d.status,d.customer_name,d.recipient_name,d.pickup_address,d.pickup_lat,d.pickup_lng,
      d.pickup_apartment,d.pickup_complement,d.delivery_address,d.delivery_lat,d.delivery_lng,
      d.delivery_apartment,d.delivery_complement,d.notes,d.item_description,d.route_geometry,d.distance_meters,d.duration_seconds,
      d.accepted_at,d.picked_up_at,d.delivered_at,d.updated_at,d.confirmation_code,d.confirmation_required,
      d.finish_without_code_authorized,d.customer_chat_enabled,d.driver_call_enabled,d.cash_payment_location,d.payment_method,
      d.payment_status,d.completion_source,d.customer_confirmed_received_at,d.received_by_name,d.charge_cents,
      d.base_charge_cents,d.wait_charge_cents,d.cancellation_charge_cents,d.paid_cents,d.outstanding_cents,d.credit_used_cents,d.launched_by_name,d.created_by,
      d.launched_by_user_id,d.driver_gross_cents,d.driver_earnings_cents,d.receipt_number,
      e.name establishment_name,e.logo_url,e.tracking_enabled establishment_tracking_enabled,
      b.name base_name,b.tracking_enabled base_tracking_enabled,c.name cooperative_name,c.primary_color cooperative_color,c.phone cooperative_phone,
      c.base_tracking_enabled cooperative_base_tracking,dr.name driver_name,dr.phone driver_phone,dr.vehicle_model,dr.vehicle_plate,dr.photo_url driver_photo_url,
      e.phone establishment_phone,e.email establishment_email,
      dr.current_lat driver_lat,dr.current_lng driver_lng,dr.location_updated_at,r.id rating_id,
      u.name created_by_name
    FROM deliveries d JOIN establishments e ON e.id=d.establishment_id JOIN cooperatives c ON c.id=d.cooperative_id
    LEFT JOIN bases b ON b.id=d.base_id LEFT JOIN drivers dr ON dr.id=d.assigned_driver_id
    LEFT JOIN delivery_ratings r ON r.delivery_id=d.id
    LEFT JOIN users u ON u.id=COALESCE(d.launched_by_user_id,d.created_by)
    WHERE d.tracking_token=? AND d.deleted_at IS NULL LIMIT 1
  `).bind(token).first<Row>();
}
function trackingAllowed(item: Row) {
  return Number(item.tracking_enabled||0)===1 && (item.delivery_type==='base'
    ? Number(item.base_tracking_enabled??item.cooperative_base_tracking??1)===1
    : Number(item.establishment_tracking_enabled??1)===1);
}

publicRoutes.get('/tracking/:token', async c => {
  const item=await trackingItem(c,c.req.param('token'));
  if(!item)return c.json({ok:false,error:'Rastreamento não encontrado ou expirado.'},404);
  if(!trackingAllowed(item))return c.json({ok:false,error:'O rastreamento desta entrega foi desativado pela cooperativa.'},403);
  const show=['accepted','to_pickup','at_pickup','picked_up','in_route'].includes(item.status)&&item.driver_lat!=null&&item.driver_lng!=null;
  return c.json({ok:true,item:{
    id:item.id,display_code:item.display_code,status:item.status,customer_name:item.customer_name,
    pickup_address:item.pickup_address,pickup_lat:item.pickup_lat,pickup_lng:item.pickup_lng,
    pickup_apartment:item.pickup_apartment,pickup_complement:item.pickup_complement,
    delivery_address:item.delivery_address,delivery_lat:item.delivery_lat,delivery_lng:item.delivery_lng,
    delivery_apartment:item.delivery_apartment,delivery_complement:item.delivery_complement,notes:item.notes,item_description:item.item_description,
    route_geometry:item.route_geometry,distance_meters:item.distance_meters,duration_seconds:item.duration_seconds,
    accepted_at:item.accepted_at,picked_up_at:item.picked_up_at,delivered_at:item.delivered_at,updated_at:item.updated_at,
    establishment_name:item.establishment_name,base_name:item.base_name,cooperative_name:item.cooperative_name,cooperative_phone:item.cooperative_phone,delivery_type:item.delivery_type,logo_url:item.logo_url,primary_color:item.cooperative_color||'#721536',
    driver_name:item.driver_name,driver_phone:item.driver_phone,vehicle_model:item.vehicle_model,vehicle_plate:item.vehicle_plate,driver_photo_url:item.driver_photo_url,
    establishment_phone:item.establishment_phone,establishment_email:item.establishment_email,
    driver_lat:show?item.driver_lat:null,driver_lng:show?item.driver_lng:null,location_updated_at:show?item.location_updated_at:null,
    confirmation_code:Number(item.confirmation_required??1)===1||item.confirmation_code?item.confirmation_code:null,
    confirmation_required:Number(item.confirmation_required??1)===1,finish_without_code_authorized:Number(item.finish_without_code_authorized||0)===1,
    customer_chat_enabled:Number(item.customer_chat_enabled??1)===1,driver_call_enabled:Number(item.driver_call_enabled??0)===1,
    cash_payment_location:item.cash_payment_location,payment_method:item.payment_method,completion_source:item.completion_source,customer_confirmed_received_at:item.customer_confirmed_received_at,received_by_name:item.received_by_name,
    payment_status:item.payment_status,charge_cents:item.charge_cents,base_charge_cents:item.base_charge_cents,wait_charge_cents:item.wait_charge_cents,paid_cents:item.paid_cents,outstanding_cents:item.outstanding_cents,
    launched_by_name:item.launched_by_name||item.created_by_name||null,rating_available:item.status==='delivered'&&!item.rating_id,
    rated:Boolean(item.rating_id),receipt_available:item.status==='delivered'&&item.delivery_type==='base'
  }});
});

publicRoutes.get('/tracking/:token/messages', async c => {
  const delivery=await trackingItem(c,c.req.param('token'));
  if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);
  if(!trackingAllowed(delivery))return c.json({ok:false,error:'Acompanhamento desativado.'},403);
  if(Number(delivery.customer_chat_enabled??1)!==1)return c.json({ok:true,items:[],active:false,disabled:true});
  const requested=cleanText(c.req.query('conversation')||'customer_place',40);
  const allowed=['customer_place',...(delivery.assigned_driver_id?['customer_driver']:[])];
  const conversation=allowed.includes(requested)?requested:'customer_place';
  const rows=await c.env.DB.prepare(`SELECT id,sender_type,recipient_type,sender_name,message,conversation_key,created_at
    FROM delivery_messages WHERE delivery_id=? AND conversation_key=? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 300`)
    .bind(delivery.id,conversation).all<Row>();
  await c.env.DB.prepare(`UPDATE delivery_messages SET customer_read_at=COALESCE(customer_read_at,CURRENT_TIMESTAMP)
    WHERE delivery_id=? AND conversation_key=? AND sender_type!='customer' AND customer_read_at IS NULL`)
    .bind(delivery.id,conversation).run();
  return c.json({ok:true,items:rows.results,conversation,active:!['delivered','cancelled'].includes(delivery.status),
    contacts:[{conversation:'customer_place',label:delivery.delivery_type==='base'?(delivery.base_name||'Base/Cooperativa'):(delivery.establishment_name||'Estabelecimento')},
      ...(delivery.assigned_driver_id?[{conversation:'customer_driver',label:delivery.driver_name||'Cooperado'}]:[])]});
});

publicRoutes.post('/tracking/:token/messages', async c => {
  const delivery=await trackingItem(c,c.req.param('token'));
  if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);
  if(!trackingAllowed(delivery))return c.json({ok:false,error:'Acompanhamento desativado.'},403);
  if(Number(delivery.customer_chat_enabled??1)!==1)return c.json({ok:false,error:'O chat foi desativado para esta entrega.'},403);
  if(['delivered','cancelled'].includes(delivery.status))return c.json({ok:false,error:'A conversa foi encerrada.'},409);
  const body=await c.req.json<Row>().catch(() => ({} as Row));
  const message=cleanText(body.message,500),requested=cleanText(body.conversation||'customer_place',40);
  if(!message)return c.json({ok:false,error:'Digite uma mensagem.'},400);
  const allowed=['customer_place',...(delivery.assigned_driver_id?['customer_driver']:[])];
  if(!allowed.includes(requested))return c.json({ok:false,error:'A conversa com o cooperado será liberada quando ele assumir a entrega.'},409);
  const recipientType=requested==='customer_driver'?'driver':delivery.delivery_type==='base'?'cooperative':'establishment';
  const request=await c.env.DB.prepare(`SELECT customer_id FROM customer_requests WHERE delivery_id=? LIMIT 1`).bind(delivery.id).first<Row>();
  await c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,recipient_type,conversation_key,sender_customer_id,sender_name,message,customer_read_at)
    VALUES (?,?,?,'customer',?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(id(),delivery.id,delivery.cooperative_id,recipientType,requested,request?.customer_id||delivery.customer_id||null,String(delivery.customer_name||delivery.recipient_name||'Cliente').slice(0,150),message).run();
  return c.json({ok:true});
});

async function publicCustomerId(c: Context<AppBindings>, delivery: Row) {
  if(delivery.customer_id)return delivery.customer_id as string;
  const row=await c.env.DB.prepare(`SELECT customer_id FROM customer_requests WHERE delivery_id=? AND customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`).bind(delivery.id).first<Row>();
  return row?.customer_id||null;
}

// Chamada de voz dentro do próprio chat (sinalização WebRTC pelo token de rastreio).
publicRoutes.post('/tracking/:token/calls',async c=>{
  const delivery=await trackingItem(c,c.req.param('token'));
  if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);
  if(!trackingAllowed(delivery)||Number(delivery.customer_chat_enabled??1)!==1)return c.json({ok:false,error:'Comunicação indisponível.'},403);
  if(['delivered','cancelled'].includes(delivery.status))return c.json({ok:false,error:'A entrega já foi encerrada.'},409);
  const body=await c.req.json<Row>().catch(()=>({} as Row)),conversation=cleanText(body.conversation||'customer_place',40),offer=String(body.offer_sdp||'');
  if(!['customer_place','customer_driver'].includes(conversation))return c.json({ok:false,error:'Conversa inválida.'},400);
  if(conversation==='customer_driver'&&!delivery.assigned_driver_id)return c.json({ok:false,error:'O cooperado ainda não assumiu a entrega.'},409);
  if(!offer)return c.json({ok:false,error:'Não foi possível iniciar o áudio.'},400);
  const callId=id(),customerId=await publicCustomerId(c,delivery);
  await c.env.DB.prepare(`INSERT INTO delivery_calls(id,delivery_id,cooperative_id,conversation_key,caller_type,caller_customer_id,caller_name,callee_type,offer_sdp)
    VALUES (?,?,?,?,'customer',?,? ,?,?)`).bind(callId,delivery.id,delivery.cooperative_id,conversation,customerId,String(delivery.customer_name||'Cliente').slice(0,150),conversation==='customer_driver'?'driver':'place',offer).run();
  return c.json({ok:true,call_id:callId},201);
});
publicRoutes.get('/tracking/:token/calls/incoming',async c=>{
  const delivery=await trackingItem(c,c.req.param('token'));
  if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);
  const rows=await c.env.DB.prepare(`SELECT id,delivery_id,conversation_key,caller_name,caller_type,created_at FROM delivery_calls
    WHERE delivery_id=? AND callee_type='customer' AND status='ringing' AND datetime(expires_at)>datetime('now') ORDER BY created_at DESC LIMIT 5`).bind(delivery.id).all<Row>();
  return c.json({ok:true,items:rows.results});
});
publicRoutes.get('/tracking/:token/calls/:id',async c=>{const delivery=await trackingItem(c,c.req.param('token'));if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);const row=await c.env.DB.prepare(`SELECT * FROM delivery_calls WHERE id=? AND delivery_id=?`).bind(c.req.param('id'),delivery.id).first<Row>();if(!row)return c.json({ok:false,error:'Chamada não encontrada.'},404);return c.json({ok:true,item:row});});
publicRoutes.post('/tracking/:token/calls/:id/answer',async c=>{const delivery=await trackingItem(c,c.req.param('token'));if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);const body=await c.req.json<Row>().catch(()=>({} as Row));const result=await c.env.DB.prepare(`UPDATE delivery_calls SET status='accepted',answer_sdp=?,answered_at=CURRENT_TIMESTAMP WHERE id=? AND delivery_id=? AND callee_type='customer' AND status='ringing'`).bind(String(body.answer_sdp||''),c.req.param('id'),delivery.id).run();if(!result.meta.changes)return c.json({ok:false,error:'A chamada não está mais disponível.'},409);return c.json({ok:true});});
publicRoutes.post('/tracking/:token/calls/:id/decline',async c=>{const delivery=await trackingItem(c,c.req.param('token'));if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);await c.env.DB.prepare(`UPDATE delivery_calls SET status='declined',ended_at=CURRENT_TIMESTAMP,ended_by='customer' WHERE id=? AND delivery_id=? AND status='ringing'`).bind(c.req.param('id'),delivery.id).run();return c.json({ok:true});});
publicRoutes.post('/tracking/:token/calls/:id/end',async c=>{const delivery=await trackingItem(c,c.req.param('token'));if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);await c.env.DB.prepare(`UPDATE delivery_calls SET status='ended',ended_at=CURRENT_TIMESTAMP,ended_by='customer' WHERE id=? AND delivery_id=? AND status IN ('ringing','accepted')`).bind(c.req.param('id'),delivery.id).run();return c.json({ok:true});});
publicRoutes.post('/tracking/:token/calls/:id/candidates',async c=>{const delivery=await trackingItem(c,c.req.param('token'));if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);const body=await c.req.json<Row>().catch(()=>({} as Row));await c.env.DB.prepare(`INSERT INTO delivery_call_candidates(call_id,sender_type,candidate_json) SELECT ?,'customer',? WHERE EXISTS(SELECT 1 FROM delivery_calls WHERE id=? AND delivery_id=?)`).bind(c.req.param('id'),JSON.stringify(body.candidate||null),c.req.param('id'),delivery.id).run();return c.json({ok:true});});
publicRoutes.get('/tracking/:token/calls/:id/candidates',async c=>{const delivery=await trackingItem(c,c.req.param('token'));if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);const after=Math.max(0,Number(c.req.query('after')||0));const rows=await c.env.DB.prepare(`SELECT id,sender_type,candidate_json FROM delivery_call_candidates WHERE call_id=? AND id>? AND sender_type!='customer' AND EXISTS(SELECT 1 FROM delivery_calls WHERE id=? AND delivery_id=?) ORDER BY id`).bind(c.req.param('id'),after,c.req.param('id'),delivery.id).all<Row>();return c.json({ok:true,items:rows.results});});


async function closeActiveWaitByCustomer(c:Context<AppBindings>,delivery:Row){
  const session=await c.env.DB.prepare(`SELECT * FROM delivery_wait_sessions WHERE delivery_id=? AND status='active' ORDER BY started_at DESC LIMIT 1`).bind(delivery.id).first<Row>();
  if(!session)return;
  const start=Date.parse(String(session.started_at||'').replace(' ','T')+'Z'),elapsed=Number.isFinite(start)?Math.max(0,Math.floor((Date.now()-start)/1000)):0;
  const free=Math.max(0,Number(session.free_seconds||0)),billed=Math.max(0,elapsed-free),charge=Math.max(0,Math.round(billed*Math.max(0,Number(session.rate_cents_per_15m||0))/900));
  await c.env.DB.prepare(`UPDATE delivery_wait_sessions SET ended_at=CURRENT_TIMESTAMP,elapsed_seconds=?,billed_seconds=?,charge_cents=?,status='ended',end_reason='Cliente confirmou o recebimento',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'`).bind(elapsed,billed,charge,session.id).run();
  const totalRow=await c.env.DB.prepare(`SELECT COALESCE(SUM(charge_cents),0) total FROM delivery_wait_sessions WHERE delivery_id=? AND status='ended'`).bind(delivery.id).first<Row>();
  const waitTotal=Number(totalRow?.total||0),total=Number(delivery.base_charge_cents||delivery.charge_cents||0)+waitTotal+Number(delivery.cancellation_charge_cents||0);
  let paid=Number(delivery.paid_cents||0),creditUsed=Number(delivery.credit_used_cents||0);
  const originalCharge=Number(delivery.base_charge_cents||delivery.charge_cents||0);
  // Compatibilidade com entregas cuja corrida foi marcada como paga antes de existir espera,
  // mas o campo paid_cents ainda não havia sido preenchido. Só o valor original é considerado pago.
  if(String(delivery.payment_status||'')==='paid'&&paid<originalCharge)paid=originalCharge;
  if(delivery.payment_method==='credit'&&delivery.customer_id){
    const available=await cooperativeCreditBalance(c.env,delivery.customer_id,delivery.cooperative_id),target=Math.min(total,creditUsed+available);
    if(target!==creditUsed)await reconcileDeliveryCredit(c.env,{deliveryId:delivery.id,cooperativeId:delivery.cooperative_id,customerId:delivery.customer_id,desiredCents:target,displayCode:delivery.display_code,reason:`Espera encerrada quando o cliente confirmou o recebimento.`});
    creditUsed=target;paid=target;
  }
  const outstanding=Math.max(0,total-paid);
  await c.env.DB.prepare(`UPDATE deliveries SET wait_charge_cents=?,charge_cents=?,paid_cents=?,outstanding_cents=?,credit_used_cents=?,payment_status=CASE WHEN ?>=? THEN 'paid' ELSE 'pending' END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(waitTotal,total,paid,outstanding,creditUsed,paid,total,delivery.id).run();
}

async function finishFinancialByCustomer(c: Context<AppBindings>, delivery: Row) {
  if(!delivery.assigned_driver_id) throw new Error('A entrega ainda não possui cooperado responsável.');
  const duplicate=await c.env.DB.prepare(`SELECT 1 ok FROM financial_entries WHERE delivery_id=? AND category='delivery' AND entry_type='credit' AND deleted_at IS NULL`).bind(delivery.id).first();
  if(duplicate)return;
  const gross=Math.max(0,Number(delivery.driver_gross_cents||delivery.driver_earnings_cents||0)||Math.max(0,Number(delivery.charge_cents||0)-Number(delivery.cooperative_fee_cents||0)));
  const taxable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  const direct=delivery.delivery_type==='base'&&baseDirectReceivedPayment(delivery.payment_method);
  const receivable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  if(!direct&&!receivable)return;
  const entryStatus=receivable?'open':'paid',settled=direct?gross:0;
  const coop=taxable?await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(delivery.cooperative_id).first<Row>():null;
  const inss=taxable?Math.round(gross*Number(coop?.inss_percent||0)/100):0,sest=taxable?Math.round(gross*Number(coop?.sest_senat_percent||0)/100):0;
  const statements:D1PreparedStatement[]=[c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'credit','delivery',?,?,?,date('now','-3 hours'),?,NULL)`).bind(id(),delivery.cooperative_id,delivery.assigned_driver_id,delivery.establishment_id,delivery.id,`Entrega ${delivery.display_code}${receivable?'':' • recebido diretamente pelo cooperado'}`,gross,settled,entryStatus)];
  if(inss)statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','INSS','INSS sobre entrega',?,date('now','-3 hours'),NULL)`).bind(id(),delivery.cooperative_id,delivery.assigned_driver_id,delivery.establishment_id,delivery.id,inss));
  if(sest)statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','SEST/SENAT','SEST/SENAT sobre entrega',?,date('now','-3 hours'),NULL)`).bind(id(),delivery.cooperative_id,delivery.assigned_driver_id,delivery.establishment_id,delivery.id,sest));
  await c.env.DB.batch(statements);
}

publicRoutes.post('/tracking/:token/received', async c => {
  const delivery=await trackingItem(c,c.req.param('token'));
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  if(!trackingAllowed(delivery))return c.json({ok:false,error:'Acompanhamento desativado.'},403);
  if(delivery.status==='delivered'){await finishFinancialByCustomer(c,delivery);return c.json({ok:true,already_confirmed:true,message:'O recebimento já foi confirmado.'});}
  if(delivery.status==='cancelled')return c.json({ok:false,error:'Esta entrega foi cancelada.'},409);
  if(!delivery.assigned_driver_id||['new','offered','assigned'].includes(delivery.status))return c.json({ok:false,error:'A entrega ainda não foi assumida por um cooperado.'},409);
  await closeActiveWaitByCustomer(c,delivery);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET status='delivered',customer_confirmed_received_at=CURRENT_TIMESTAMP,completion_source='customer',confirmation_verified_at=CURRENT_TIMESTAMP,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='delivered'`).bind(delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'delivered','Recebimento confirmado pelo cliente no acompanhamento',NULL)`).bind(id(),delivery.id,delivery.cooperative_id,delivery.status),
    c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,recipient_type,sender_name,message,customer_read_at) VALUES (?,?,?,'customer','all',?,'Recebi o pedido. Entrega confirmada pelo cliente.',CURRENT_TIMESTAMP)`).bind(id(),delivery.id,delivery.cooperative_id,String(delivery.customer_name||delivery.recipient_name||'Cliente').slice(0,150))
  ]);
  await finishFinancialByCustomer(c,delivery);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env,delivery.cooperative_id,delivery.establishment_id,'delivery.status_changed',{id:delivery.id,display_code:delivery.display_code,status:'delivered',completion_source:'customer'}));
  return c.json({ok:true,message:'Recebimento confirmado. A entrega foi concluída sem precisar do código.'});
});

publicRoutes.post('/tracking/:token/rating', async c => {
  const delivery=await trackingItem(c,c.req.param('token'));
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  if(delivery.status!=='delivered')return c.json({ok:false,error:'Avaliação liberada após a entrega.'},409);
  if(delivery.rating_id)return c.json({ok:false,error:'Esta entrega já foi avaliada.'},409);
  const body=await c.req.json<Row>().catch(() => ({} as Row));
  const establishmentScore=Number(body.establishment_score);
  const driverScore=delivery.assigned_driver_id?Number(body.driver_score):null;
  if(!Number.isInteger(establishmentScore)||establishmentScore<1||establishmentScore>5||
    (delivery.assigned_driver_id&&(!Number.isInteger(driverScore)||Number(driverScore)<1||Number(driverScore)>5))) {
    return c.json({ok:false,error:'Informe notas de 1 a 5.'},400);
  }
  const request=await c.env.DB.prepare(`SELECT customer_id FROM customer_requests WHERE delivery_id=? LIMIT 1`).bind(delivery.id).first<Row>();
  await c.env.DB.prepare(`
    INSERT INTO delivery_ratings(id,delivery_id,cooperative_id,establishment_id,driver_id,customer_id,establishment_score,driver_score,establishment_tags_json,driver_tags_json,comment,source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'tracking')
  `).bind(id(),delivery.id,delivery.cooperative_id,delivery.establishment_id,delivery.assigned_driver_id||null,request?.customer_id||null,
    establishmentScore,driverScore,JSON.stringify(Array.isArray(body.establishment_tags)?body.establishment_tags:[]),
    JSON.stringify(Array.isArray(body.driver_tags)?body.driver_tags:[]),cleanText(body.comment,1000)||null).run();
  return c.json({ok:true,message:'Avaliação registrada.'},201);
});

publicRoutes.get('/tracking/:token/receipt', async c => {
  const delivery=await trackingItem(c,c.req.param('token'));
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  if(delivery.delivery_type!=='base'||delivery.status!=='delivered')return c.json({ok:false,error:'Recibo disponível após concluir uma entrega da Base.'},409);
  let receipt=await c.env.DB.prepare(`SELECT * FROM delivery_receipts WHERE delivery_id=?`).bind(delivery.id).first<Row>();
  if(!receipt){
    const request=await c.env.DB.prepare(`SELECT customer_id FROM customer_requests WHERE delivery_id=? LIMIT 1`).bind(delivery.id).first<Row>();
    const number=delivery.receipt_number||`REC-${saoPauloDate().replace(/-/g,'')}-${String(delivery.display_code||delivery.id).replace(/[^A-Z0-9]/gi,'').slice(-8)}`;
    const snapshot={receipt_number:number,issued_at:new Date().toISOString(),cooperative_name:delivery.cooperative_name,base_name:delivery.base_name,customer_name:delivery.customer_name,pickup_address:delivery.pickup_address,delivery_address:delivery.delivery_address,display_code:delivery.display_code,payment_method:delivery.payment_method,payment_status:delivery.payment_status,cash_payment_location:delivery.cash_payment_location,amount_cents:delivery.charge_cents,delivered_at:delivery.delivered_at,driver_name:delivery.driver_name};
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO delivery_receipts(id,delivery_id,cooperative_id,customer_id,receipt_number,snapshot_json) VALUES (?,?,?,?,?,?)`).bind(id(),delivery.id,delivery.cooperative_id,request?.customer_id||null,number,JSON.stringify(snapshot)),
      c.env.DB.prepare(`UPDATE deliveries SET receipt_number=? WHERE id=?`).bind(number,delivery.id)
    ]);
    receipt={receipt_number:number,snapshot_json:JSON.stringify(snapshot),issued_at:snapshot.issued_at};
  }
  return c.json({ok:true,receipt:{...JSON.parse(receipt.snapshot_json),receipt_number:receipt.receipt_number,issued_at:receipt.issued_at}});
});
