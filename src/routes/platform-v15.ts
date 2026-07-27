import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { assertRole, bodyJson, cleanText, id, nullableText, toCents } from '../lib/util';
import { cooperativeCreditBalance, reconcileDeliveryCredit } from '../lib/wallet';
import { addressJson, addressPoint, readAddressConfirmationToken } from '../lib/address';
import { geocodeAddress, routeBetween, routePrice, type AddressCandidate } from '../lib/maps';
import { queueWebhookEvent } from '../lib/webhooks';
import { deliveryFields } from '../lib/delivery-fields';
import { saveBrandingAsset } from '../lib/branding';
import { baseDirectReceivedPayment, baseReceivablePayment, reconcileDriverFinancialBalance } from '../lib/financial-settlement';

export const platformV15Routes = new Hono<AppBindings>();
type Row = Record<string, any>;
type ConversationKey = 'customer_place'|'customer_driver'|'driver_place';
type CallParty = 'customer'|'driver'|'place';

function tenant(c: Context<AppBindings>, roles: AuthUser['role'][]): AuthUser {
  const auth=c.get('auth');
  assertRole(auth,roles);
  if(!auth.cooperativeId)throw new Error('Cooperativa não vinculada.');
  return auth;
}
function isPlace(auth:AuthUser){return ['cooperative_admin','dispatcher','establishment'].includes(auth.role);}
function senderDbType(auth:AuthUser){return auth.role==='driver'?'driver':auth.role==='establishment'?'establishment':'cooperative';}
function party(auth:AuthUser):CallParty{return auth.role==='driver'?'driver':'place';}
function readColumn(auth:AuthUser){return auth.role==='driver'?'driver_read_at':auth.role==='establishment'?'establishment_read_at':'cooperative_read_at';}
function placeRecipient(delivery:Row){return delivery.delivery_type==='base'?'cooperative':'establishment';}
function validCoordinates(lat:number,lng:number){return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&(Math.abs(lat)+Math.abs(lng)>0.001);}
function allowedConversations(auth:AuthUser):ConversationKey[]{return auth.role==='driver'?['customer_driver','driver_place']:['customer_place','driver_place'];}
function otherParty(conversation:ConversationKey,mine:CallParty):CallParty{
  const pair:Record<ConversationKey,CallParty[]>={customer_place:['customer','place'],customer_driver:['customer','driver'],driver_place:['driver','place']};
  const found=pair[conversation].find(x=>x!==mine);
  if(!found)throw new Error('Conversa inválida para este participante.');
  return found;
}
function actualRecipient(conversation:ConversationKey,auth:AuthUser,delivery:Row){
  if(auth.role==='driver')return conversation==='customer_driver'?'customer':placeRecipient(delivery);
  return conversation==='customer_place'?'customer':'driver';
}

async function deliveryForAuth(c:Context<AppBindings>,auth:AuthUser,deliveryId:string,allowDeleted=false){
  // D1/SQLite limita a quantidade de colunas de um resultado. Como deliveries já
  // possui muitos campos, os dados auxiliares são consultados separadamente.
  const row=await c.env.DB.prepare(`SELECT ${deliveryFields('d')} FROM deliveries d
    WHERE d.id=? AND d.cooperative_id=? ${allowDeleted?'':'AND d.deleted_at IS NULL'} LIMIT 1`)
    .bind(deliveryId,auth.cooperativeId).first<Row>();
  if(!row)throw new Error('Entrega não encontrada.');
  const meta=await c.env.DB.prepare(`SELECT e.name establishment_name,e.phone establishment_phone,b.name base_name,
      dr.name driver_name,dr.phone driver_phone,co.name cooperative_name,co.phone cooperative_phone,
      b.cooperative_fee_percent base_fee_percent,b.rate_per_km_cents base_rate_per_km_cents,b.minimum_fee_cents base_minimum_fee_cents
    FROM deliveries d JOIN establishments e ON e.id=d.establishment_id JOIN cooperatives co ON co.id=d.cooperative_id
    LEFT JOIN bases b ON b.id=d.base_id LEFT JOIN drivers dr ON dr.id=d.assigned_driver_id
    WHERE d.id=? LIMIT 1`).bind(deliveryId).first<Row>();
  Object.assign(row,meta||{});
  if(auth.role==='driver'&&row.assigned_driver_id!==auth.driverId)throw new Error('Acesso não autorizado.');
  if(auth.role==='establishment'&&(row.establishment_id!==auth.establishmentId||row.delivery_type==='base'))throw new Error('Acesso não autorizado.');
  if(['cooperative_admin','dispatcher'].includes(auth.role)&&row.delivery_type!=='base')throw new Error('A cooperativa atua como estabelecimento somente nas entregas da Base.');
  return row;
}

async function amounts(c:Context<AppBindings>,cooperativeId:string,charge:number,feePercent:number,paymentMethod:unknown){
  const coop=await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(cooperativeId).first<Row>();
  const fee=Math.round(charge*Math.max(0,feePercent)/100),gross=Math.max(0,charge-fee);
  const taxable=baseReceivablePayment(paymentMethod);
  const inss=taxable?Math.round(gross*Number(coop?.inss_percent||0)/100):0,sest=taxable?Math.round(gross*Number(coop?.sest_senat_percent||0)/100):0;
  return {fee,gross,net:Math.max(0,gross-inss-sest)};
}

async function finishFinancial(c:Context<AppBindings>,auth:AuthUser,delivery:Row){
  if(!delivery.assigned_driver_id)throw new Error('A entrega ainda não possui cooperado responsável.');
  const exists=await c.env.DB.prepare(`SELECT 1 ok FROM financial_entries WHERE delivery_id=? AND category='delivery' AND entry_type='credit' AND deleted_at IS NULL LIMIT 1`).bind(delivery.id).first();
  if(exists)return;
  const gross=Math.max(0,Number(delivery.driver_gross_cents||delivery.driver_earnings_cents||0)||Math.max(0,Number(delivery.charge_cents||0)-Number(delivery.cooperative_fee_cents||0)));
  const taxable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  const direct=delivery.delivery_type==='base'&&baseDirectReceivedPayment(delivery.payment_method);
  const receivable=delivery.delivery_type==='establishment'||(delivery.delivery_type==='base'&&baseReceivablePayment(delivery.payment_method));
  if(!direct&&!receivable)return;
  const entryStatus=receivable?'open':'paid',settled=direct?gross:0;
  const coop=taxable?await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>():null;
  const inss=taxable?Math.round(gross*Number(coop?.inss_percent||0)/100):0,sest=taxable?Math.round(gross*Number(coop?.sest_senat_percent||0)/100):0;
  const rows:D1PreparedStatement[]=[c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'credit','delivery',?,?,?,date('now','-3 hours'),?,?)`).bind(id(),auth.cooperativeId,delivery.assigned_driver_id,delivery.establishment_id,delivery.id,`Entrega ${delivery.display_code}${receivable?'':' • recebido diretamente pelo cooperado'}`,gross,settled,entryStatus,auth.id)];
  if(inss)rows.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','INSS','INSS sobre entrega',?,date('now','-3 hours'),?)`).bind(id(),auth.cooperativeId,delivery.assigned_driver_id,delivery.establishment_id,delivery.id,inss,auth.id));
  if(sest)rows.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,created_by) VALUES (?,?,?,?,?,'debit','SEST/SENAT','SEST/SENAT sobre entrega',?,date('now','-3 hours'),?)`).bind(id(),auth.cooperativeId,delivery.assigned_driver_id,delivery.establishment_id,delivery.id,sest,auth.id));
  await c.env.DB.batch(rows);
  await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,String(delivery.assigned_driver_id));
}


platformV15Routes.post('/v15/tenant/logo',async c=>{
  const auth=tenant(c,['cooperative_admin']);
  const body=await bodyJson<Row>(c);
  const logoUrl=await saveBrandingAsset(c.env,'cooperative',auth.cooperativeId!,body.data_url);
  await c.env.DB.prepare(`UPDATE cooperatives SET logo_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(logoUrl,auth.cooperativeId).run();
  return c.json({ok:true,logo_url:logoUrl});
});

// Dados necessários para lançar/editar entrega pré-paga da Base.
platformV15Routes.get('/v15/base/delivery-form-data',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const rows=await c.env.DB.prepare(`SELECT c.id,c.name,c.phone,c.email,
    COALESCE((SELECT SUM(CASE WHEN t.entry_type='credit' THEN t.amount_cents ELSE -t.amount_cents END)
      FROM customer_wallet_transactions t JOIN customer_wallets w ON w.id=t.wallet_id
      WHERE w.customer_id=c.id AND t.cooperative_id=? AND t.status='confirmed'),0) balance_cents
    FROM customers c WHERE EXISTS(SELECT 1 FROM cooperative_customers cc WHERE cc.customer_id=c.id AND cc.cooperative_id=? AND cc.status='active')
      OR EXISTS(SELECT 1 FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=?)
    ORDER BY c.name COLLATE NOCASE`).bind(auth.cooperativeId,auth.cooperativeId,auth.cooperativeId).all<Row>();
  return c.json({ok:true,customers:rows.results});
});

platformV15Routes.put('/v15/base/deliveries/:id',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const delivery=await deliveryForAuth(c,auth,c.req.param('id'));
  if(delivery.delivery_type!=='base')return c.json({ok:false,error:'Esta função é exclusiva da Base.'},403);
  if(['delivered','cancelled'].includes(delivery.status))return c.json({ok:false,error:'Entrega finalizada não pode ser alterada.'},409);
  const body=await bodyJson<Row>(c);

  const pickupToken=String(body.pickup_confirmation_token||'').trim();
  const deliveryToken=String(body.delivery_confirmation_token||'').trim();
  const pickupCandidate:AddressCandidate|null=pickupToken?await readAddressConfirmationToken(c.env,pickupToken):null;
  const deliveryCandidate:AddressCandidate|null=deliveryToken?await readAddressConfirmationToken(c.env,deliveryToken):null;
  const changedAddress=Boolean(pickupCandidate||deliveryCandidate);

  const storedPoint=(prefix:'pickup'|'delivery')=>{
    const lat=Number(delivery[`${prefix}_lat`]),lng=Number(delivery[`${prefix}_lng`]);
    if(Number.isFinite(lat)&&Number.isFinite(lng))return {lat,lng};
    try{
      const data=JSON.parse(String(delivery[`${prefix}_address_json`]||'{}'));
      const jsonLat=Number(data.latitude??data.lat),jsonLng=Number(data.longitude??data.lng);
      if(Number.isFinite(jsonLat)&&Number.isFinite(jsonLng))return {lat:jsonLat,lng:jsonLng};
    }catch{}
    return null;
  };

  let distance=Number(delivery.distance_meters||0),duration=Number(delivery.duration_seconds||0),geometry=delivery.route_geometry;
  if(changedAddress){
    const pickupPoint=pickupCandidate?addressPoint(pickupCandidate):storedPoint('pickup');
    const destinationPoint=deliveryCandidate?addressPoint(deliveryCandidate):storedPoint('delivery');
    if(!pickupPoint||!destinationPoint)return c.json({ok:false,error:'Confirme novamente os dois endereços para recalcular a rota.'},409);
    const route=await routeBetween(c.env,[pickupPoint,destinationPoint]);
    if(!route)return c.json({ok:false,error:'Não foi possível calcular a nova rota entre coleta e entrega.'},409);
    distance=route.distance_meters;duration=route.duration_seconds;geometry=JSON.stringify(route.geometry);
  }

  const recalculate=body.recalculate_charge===true||body.recalculate_charge==='true'||body.recalculate_charge==='1';
  const automaticCharge=routePrice(distance,Number(delivery.base_rate_per_km_cents||0),Number(delivery.base_minimum_fee_cents||0),Number(delivery.services_cents||0));
  const charge=recalculate?automaticCharge:(body.charge_value!==undefined&&body.charge_value!==''?Math.max(0,toCents(body.charge_value)):Number(delivery.charge_cents||0));
  if(charge<=0)return c.json({ok:false,error:'Informe um valor maior que zero.'},400);

  const payment=['credit','credito'].includes(cleanText(body.payment_method||delivery.payment_method,30))?'credit':cleanText(body.payment_method||delivery.payment_method,30);
  const paymentStatus=payment==='credit'?'paid':cleanText(body.payment_status||delivery.payment_status||'pending',30);
  const cashPaymentLocation=payment==='dinheiro'?cleanText(body.cash_payment_location||delivery.cash_payment_location,20):null;
  if(payment==='dinheiro'&&!['pickup','delivery'].includes(String(cashPaymentLocation||'')))return c.json({ok:false,error:'Informe se o dinheiro será recebido na coleta ou na entrega.'},400);
  const customerId=nullableText(body.customer_id??delivery.customer_id,100);
  const oldCustomer=nullableText(delivery.customer_id,100);
  if(payment==='credit'&&!customerId)return c.json({ok:false,error:'Selecione o cliente para consumir o crédito pré-pago.'},400);
  if(customerId){
    const customer=await c.env.DB.prepare(`SELECT c.id FROM customers c WHERE c.id=? AND (EXISTS(SELECT 1 FROM cooperative_customers cc WHERE cc.cooperative_id=? AND cc.customer_id=c.id AND cc.status='active') OR EXISTS(SELECT 1 FROM customer_requests r WHERE r.cooperative_id=? AND r.customer_id=c.id))`).bind(customerId,auth.cooperativeId,auth.cooperativeId).first();
    if(!customer)return c.json({ok:false,error:'Cliente não encontrado nesta cooperativa.'},404);
  }

  const driverField=Object.prototype.hasOwnProperty.call(body,'driver_id');
  const driverId=driverField?nullableText(body.driver_id,100):nullableText(delivery.assigned_driver_id,100);
  let driverName=delivery.driver_name||null;
  if(driverId){
    const driver=await c.env.DB.prepare(`SELECT id,name FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND deleted_at IS NULL`).bind(driverId,auth.cooperativeId).first<Row>();
    if(!driver)return c.json({ok:false,error:'Cooperado inválido ou inativo.'},400);
    driverName=driver.name;
  }else driverName=null;
  const assignmentChanged=driverField&&driverId!==nullableText(delivery.assigned_driver_id,100);
  const nextStatus=assignmentChanged?(driverId?'assigned':'new'):delivery.status;

  const oldCredit=Number(delivery.credit_used_cents||0),desired=payment==='credit'?charge:0;
  if(payment==='credit'&&customerId!==oldCustomer){
    const available=await cooperativeCreditBalance(c.env,customerId!,auth.cooperativeId!);
    if(available<desired)return c.json({ok:false,error:`Crédito insuficiente. Disponível: R$ ${(available/100).toFixed(2).replace('.',',')}.`},409);
  }
  if(oldCustomer&&oldCredit>0&&oldCustomer!==customerId){
    await reconcileDeliveryCredit(c.env,{deliveryId:delivery.id,cooperativeId:auth.cooperativeId!,customerId:oldCustomer,desiredCents:0,displayCode:delivery.display_code,reason:`Crédito devolvido porque a Base alterou o cliente da entrega ${delivery.display_code}`});
  }
  let creditResult=null;
  if(customerId){
    creditResult=await reconcileDeliveryCredit(c.env,{deliveryId:delivery.id,cooperativeId:auth.cooperativeId!,customerId,desiredCents:desired,displayCode:delivery.display_code,reason:`Valor da entrega alterado pela Base de R$ ${(Number(delivery.charge_cents||0)/100).toFixed(2).replace('.',',')} para R$ ${(charge/100).toFixed(2).replace('.',',')}`});
  }

  const values=await amounts(c,auth.cooperativeId!,charge,Number(delivery.base_fee_percent||0),payment);
  const finishWithout=body.finish_without_code_authorized===true||body.finish_without_code_authorized==='true'||body.finish_without_code_authorized==='1';
  const pickupAddress=pickupCandidate?.formatted_address||delivery.pickup_address;
  const pickupNeighborhood=pickupCandidate?.neighborhood||delivery.pickup_neighborhood;
  const pickupLat=pickupCandidate?.lat??delivery.pickup_lat;
  const pickupLng=pickupCandidate?.lng??delivery.pickup_lng;
  const pickupJson=pickupCandidate?addressJson(pickupCandidate):delivery.pickup_address_json;
  const pickupPlaceId=pickupCandidate?.provider_id||delivery.pickup_place_id;
  const deliveryAddress=deliveryCandidate?.formatted_address||delivery.delivery_address;
  const deliveryNeighborhood=deliveryCandidate?.neighborhood||delivery.delivery_neighborhood;
  const deliveryLat=deliveryCandidate?.lat??delivery.delivery_lat;
  const deliveryLng=deliveryCandidate?.lng??delivery.delivery_lng;
  const deliveryJson=deliveryCandidate?addressJson(deliveryCandidate):delivery.delivery_address_json;
  const deliveryPlaceId=deliveryCandidate?.provider_id||delivery.delivery_place_id;
  const noteParts=[`Edição rápida da Base. Valor: R$ ${(charge/100).toFixed(2).replace('.',',')}; pagamento: ${payment}.`];
  if(changedAddress)noteParts.push(`Rota recalculada: ${(distance/1000).toFixed(2).replace('.',',')} km.`);
  if(assignmentChanged)noteParts.push(driverId?`Cooperado alterado para ${driverName}.`:'Cooperado removido da entrega.');

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET customer_id=?,charge_cents=?,driver_earnings_cents=?,driver_gross_cents=?,driver_net_cents=?,cooperative_fee_cents=?,payment_method=?,payment_status=?,cash_payment_location=?,assigned_driver_id=?,status=?,assigned_by_role=CASE WHEN ?=1 THEN ? ELSE assigned_by_role END,assigned_by_user_id=CASE WHEN ?=1 THEN ? ELSE assigned_by_user_id END,assignment_source=CASE WHEN ?=1 THEN 'base_quick_edit' ELSE assignment_source END,unassigned_at=CASE WHEN ?=1 AND ? IS NULL THEN CURRENT_TIMESTAMP ELSE unassigned_at END,pickup_address=?,pickup_neighborhood=?,pickup_lat=?,pickup_lng=?,pickup_address_json=?,pickup_place_id=?,delivery_address=?,delivery_neighborhood=?,delivery_lat=?,delivery_lng=?,delivery_address_json=?,delivery_place_id=?,addresses_confirmed=?,distance_meters=?,duration_seconds=?,route_geometry=?,finish_without_code_authorized=?,finish_without_code_authorized_by=CASE WHEN ?=1 THEN ? ELSE NULL END,finish_without_code_authorized_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(customerId,charge,values.gross,values.gross,values.net,values.fee,payment,paymentStatus,cashPaymentLocation,driverId,nextStatus,assignmentChanged?1:0,auth.role,assignmentChanged?1:0,auth.id,assignmentChanged?1:0,assignmentChanged?1:0,driverId,pickupAddress,pickupNeighborhood,pickupLat,pickupLng,pickupJson,pickupPlaceId,deliveryAddress,deliveryNeighborhood,deliveryLat,deliveryLng,deliveryJson,deliveryPlaceId,pickupJson&&deliveryJson?1:Number(delivery.addresses_confirmed||0),distance,duration,geometry,finishWithout?1:0,finishWithout?1:0,auth.id,finishWithout?1:0,delivery.id),
    c.env.DB.prepare(`UPDATE customer_requests SET customer_id=COALESCE(?,customer_id),pickup_address=?,pickup_neighborhood=?,delivery_address=?,delivery_neighborhood=?,quoted_cents=?,payment_method=?,cash_payment_location=?,credit_used_cents=?,distance_meters=?,duration_seconds=?,pickup_address_json=?,delivery_address_json=?,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`)
      .bind(customerId,pickupAddress,pickupNeighborhood,deliveryAddress,deliveryNeighborhood,charge,payment,cashPaymentLocation,desired,distance,duration,pickupJson,deliveryJson,delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`)
      .bind(id(),delivery.id,auth.cooperativeId,delivery.status,nextStatus,noteParts.join(' '),auth.id)
  ]);

  if(assignmentChanged&&driverId)c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,delivery.establishment_id,'delivery.assigned',{id:delivery.id,display_code:delivery.display_code,driver_id:driverId,driver_name:driverName,status:nextStatus}));
  return c.json({ok:true,item:{...delivery,charge_cents:charge,driver_earnings_cents:values.gross,driver_gross_cents:values.gross,driver_net_cents:values.net,cooperative_fee_cents:values.fee,payment_method:payment,payment_status:paymentStatus,cash_payment_location:cashPaymentLocation,customer_id:customerId,credit_used_cents:desired,assigned_driver_id:driverId,driver_name:driverName,status:nextStatus,pickup_address:pickupAddress,pickup_neighborhood:pickupNeighborhood,pickup_lat:pickupLat,pickup_lng:pickupLng,pickup_address_json:pickupJson,pickup_place_id:pickupPlaceId,delivery_address:deliveryAddress,delivery_neighborhood:deliveryNeighborhood,delivery_lat:deliveryLat,delivery_lng:deliveryLng,delivery_address_json:deliveryJson,delivery_place_id:deliveryPlaceId,distance_meters:distance,duration_seconds:duration,route_geometry:geometry,finish_without_code_authorized:finishWithout?1:0},automatic_charge_cents:automaticCharge,credit:creditResult});
});

platformV15Routes.delete('/v15/base/deliveries/:id',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const delivery=await deliveryForAuth(c,auth,c.req.param('id'));
  if(delivery.delivery_type!=='base')return c.json({ok:false,error:'Esta função é exclusiva da Base.'},403);
  if(delivery.status==='delivered')return c.json({ok:false,error:'Entrega concluída permanece no fechamento.'},409);
  const body:Row=await bodyJson<Row>(c).catch(()=>({} as Row));
  const reason=cleanText(body.reason||'Entrega cancelada pela Base',500);
  if(delivery.customer_id&&Number(delivery.credit_used_cents||0)>0){
    await reconcileDeliveryCredit(c.env,{deliveryId:delivery.id,cooperativeId:auth.cooperativeId!,customerId:delivery.customer_id,desiredCents:0,displayCode:delivery.display_code,reason:`${reason}. Crédito devolvido porque a entrega foi excluída.`});
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET status='cancelled',payment_status=CASE WHEN payment_method='credit' THEN 'cancelled' ELSE payment_status END,cancelled_at=CURRENT_TIMESTAMP,deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delivery.id),
    c.env.DB.prepare(`UPDATE customer_requests SET status='cancelled',credit_used_cents=0,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`).bind(delivery.id),
    c.env.DB.prepare(`UPDATE financial_entries SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE delivery_id=? AND deleted_at IS NULL`).bind(delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'cancelled',?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,reason,auth.id)
  ]);
  return c.json({ok:true,refunded_cents:Number(delivery.credit_used_cents||0),reason});
});

platformV15Routes.post('/v15/base/deliveries/:id/complete',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const delivery=await deliveryForAuth(c,auth,c.req.param('id'));
  if(delivery.delivery_type!=='base')return c.json({ok:false,error:'Esta função é exclusiva da Base.'},403);
  if(delivery.status==='delivered')return c.json({ok:true,already_delivered:true});
  if(delivery.status==='cancelled')return c.json({ok:false,error:'Entrega cancelada.'},409);
  const body=await bodyJson<Row>(c),receiver=nullableText(body.received_by_name,150);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET status='delivered',completion_source='base',finish_without_code_authorized=1,finish_without_code_authorized_by=?,finish_without_code_authorized_at=COALESCE(finish_without_code_authorized_at,CURRENT_TIMESTAMP),received_by_name=?,received_by_reported_at=CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE received_by_reported_at END,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(auth.id,receiver,receiver,delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'delivered',?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,receiver?`Base confirmou a entrega. Recebido por: ${receiver}`:'Base confirmou a entrega sem código',auth.id),
    c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,conversation_key,cooperative_read_at) VALUES (?,?,?,'cooperative',?,?,?,'customer','customer_place',CURRENT_TIMESTAMP)`).bind(id(),delivery.id,auth.cooperativeId,auth.id,auth.name,receiver?`✅ A Base confirmou a entrega. Recebido por: ${receiver}.`:'✅ A Base confirmou a entrega.')
  ]);
  await finishFinancial(c,auth,delivery);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,delivery.establishment_id,'delivery.status_changed',{id:delivery.id,display_code:delivery.display_code,status:'delivered',completion_source:'base'}));
  return c.json({ok:true});
});

platformV15Routes.post('/v15/base/deliveries/complete-today',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const body=await bodyJson<Row>(c),baseId=cleanText(body.base_id,100),receiver=nullableText(body.received_by_name,150);
  if(!baseId)return c.json({ok:false,error:'Selecione a Base.'},400);
  const base=await c.env.DB.prepare(`SELECT id,name FROM bases WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(baseId,auth.cooperativeId).first<Row>();
  if(!base)return c.json({ok:false,error:'Base não encontrada.'},404);
  const rows=await c.env.DB.prepare(`SELECT ${deliveryFields('d')} FROM deliveries d WHERE d.cooperative_id=? AND d.base_id=? AND d.delivery_type='base' AND d.deleted_at IS NULL AND d.status NOT IN ('delivered','cancelled') AND date(d.created_at,'-3 hours')=date('now','-3 hours') ORDER BY d.created_at`).bind(auth.cooperativeId,baseId).all<Row>();
  const items=rows.results||[];
  for(const delivery of items){
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE deliveries SET status='delivered',completion_source='base_bulk',finish_without_code_authorized=1,finish_without_code_authorized_by=?,finish_without_code_authorized_at=COALESCE(finish_without_code_authorized_at,CURRENT_TIMESTAMP),received_by_name=COALESCE(?,received_by_name),received_by_reported_at=CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE received_by_reported_at END,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(auth.id,receiver,receiver,delivery.id),
      c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'delivered',?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,receiver?`Base marcou todas as entregas do dia como entregues. Recebido por: ${receiver}`:'Base marcou todas as entregas do dia como entregues.',auth.id),
      c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,conversation_key,cooperative_read_at) VALUES (?,?,?,'cooperative',?,?,?,'customer','customer_place',CURRENT_TIMESTAMP)`).bind(id(),delivery.id,auth.cooperativeId,auth.id,auth.name,'✅ A Base confirmou esta entrega como concluída.')
    ]);
    if(delivery.assigned_driver_id)await finishFinancial(c,auth,delivery);
    c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,delivery.establishment_id,'delivery.status_changed',{id:delivery.id,display_code:delivery.display_code,status:'delivered',completion_source:'base_bulk'}));
  }
  return c.json({ok:true,count:items.length,base_name:base.name});
});

platformV15Routes.post('/v15/driver/deliveries/:id/complete',async c=>{
  const auth=tenant(c,['driver']);
  const delivery=await deliveryForAuth(c,auth,c.req.param('id'));
  if(delivery.status==='delivered')return c.json({ok:true,already_delivered:true});
  if(delivery.status==='cancelled')return c.json({ok:false,error:'Entrega cancelada.'},409);
  if(!['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(delivery.status))return c.json({ok:false,error:'Aceite a entrega antes de concluir.'},409);
  const body=await bodyJson<Row>(c),receiver=nullableText(body.received_by_name,150),required=Number(delivery.confirmation_required??1)===1&&!Number(delivery.finish_without_code_authorized||0),code=cleanText(body.confirmation_code,10);
  if(required&&code!==String(delivery.confirmation_code||''))return c.json({ok:false,error:'Código incorreto. O cliente pode confirmar “Recebi o pedido” ou a Base pode liberar sem código.'},409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET status='delivered',completion_source='driver',confirmation_verified_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE confirmation_verified_at END,received_by_name=?,received_by_reported_at=CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE received_by_reported_at END,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(required?1:0,receiver,receiver,delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'delivered',?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,receiver?`Entrega concluída. Recebido por: ${receiver}`:'Entrega concluída pelo cooperado',auth.id)
  ]);
  await finishFinancial(c,auth,delivery);
  return c.json({ok:true});
});

// Conversas independentes: cliente x local, cliente x cooperado, cooperado x local.
platformV15Routes.get('/v15/deliveries/:id/chat',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']),delivery=await deliveryForAuth(c,auth,c.req.param('id'));
  const conversation=cleanText(c.req.query('conversation'),40) as ConversationKey;
  if(!allowedConversations(auth).includes(conversation))return c.json({ok:false,error:'Conversa inválida.'},400);
  if(conversation==='customer_driver'&&!delivery.assigned_driver_id)return c.json({ok:true,items:[],active:false,waiting_driver:true,conversation});
  const rows=await c.env.DB.prepare(`SELECT id,sender_type,sender_name,message,recipient_type,conversation_key,created_at FROM delivery_messages WHERE delivery_id=? AND conversation_key=? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 400`).bind(delivery.id,conversation).all<Row>();
  const col=readColumn(auth),sender=senderDbType(auth);
  await c.env.DB.prepare(`UPDATE delivery_messages SET ${col}=COALESCE(${col},CURRENT_TIMESTAMP) WHERE delivery_id=? AND conversation_key=? AND sender_type!=? AND ${col} IS NULL`).bind(delivery.id,conversation,sender).run();
  const placeLabel=delivery.delivery_type==='base'?(delivery.base_name||'Base'):(delivery.establishment_name||'Estabelecimento');
  return c.json({ok:true,items:rows.results,conversation,active:!['delivered','cancelled'].includes(delivery.status),sender_type:sender,contacts:auth.role==='driver'?[{conversation:'customer_driver',label:'Cliente'},{conversation:'driver_place',label:placeLabel}]:[{conversation:'customer_place',label:'Cliente'},...(delivery.assigned_driver_id?[{conversation:'driver_place',label:delivery.driver_name||'Cooperado'}]:[])]});
});
platformV15Routes.post('/v15/deliveries/:id/chat',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']),delivery=await deliveryForAuth(c,auth,c.req.param('id'));
  if(['delivered','cancelled'].includes(delivery.status))return c.json({ok:false,error:'A conversa foi encerrada.'},409);
  const body=await bodyJson<Row>(c),conversation=cleanText(body.conversation,40) as ConversationKey,message=cleanText(body.message,500);
  if(!allowedConversations(auth).includes(conversation))return c.json({ok:false,error:'Conversa inválida.'},400);
  if(conversation==='customer_driver'&&!delivery.assigned_driver_id)return c.json({ok:false,error:'A conversa com o cooperado será liberada quando ele assumir.'},409);
  if(!message)return c.json({ok:false,error:'Digite uma mensagem.'},400);
  const sender=senderDbType(auth),col=readColumn(auth),recipient=actualRecipient(conversation,auth,delivery);
  await c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,conversation_key,${col}) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(id(),delivery.id,auth.cooperativeId,sender,auth.id,auth.name,message,recipient,conversation).run();
  return c.json({ok:true});
});
platformV15Routes.get('/v15/messages/unread',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']),col=readColumn(auth),sender=senderDbType(auth),conversations=allowedConversations(auth),marks=conversations.map(()=>'?').join(',');
  const where=[`d.cooperative_id=?`,`d.deleted_at IS NULL`,`m.deleted_at IS NULL`,`m.sender_type!=?`,`m.${col} IS NULL`,`m.conversation_key IN (${marks})`];
  const params:any[]=[auth.cooperativeId,sender,...conversations];
  if(auth.role==='driver'){where.push(`d.assigned_driver_id=?`);params.push(auth.driverId);}
  else if(auth.role==='establishment'){where.push(`d.establishment_id=?`,`d.delivery_type='establishment'`);params.push(auth.establishmentId);}
  else where.push(`d.delivery_type='base'`);
  const rows=await c.env.DB.prepare(`SELECT d.id delivery_id,d.display_code,m.conversation_key,MAX(m.created_at) latest_at,COUNT(*) unread_count,
      (SELECT x.id FROM delivery_messages x WHERE x.delivery_id=d.id AND x.conversation_key=m.conversation_key AND x.deleted_at IS NULL AND x.sender_type!=? AND x.${col} IS NULL ORDER BY x.created_at DESC,x.id DESC LIMIT 1) latest_id,
      (SELECT x.message FROM delivery_messages x WHERE x.delivery_id=d.id AND x.conversation_key=m.conversation_key AND x.deleted_at IS NULL AND x.sender_type!=? AND x.${col} IS NULL ORDER BY x.created_at DESC,x.id DESC LIMIT 1) latest_message
    FROM deliveries d JOIN delivery_messages m ON m.delivery_id=d.id WHERE ${where.join(' AND ')} GROUP BY d.id,d.display_code,m.conversation_key ORDER BY latest_at DESC LIMIT 50`).bind(sender,sender,...params).all<Row>();
  return c.json({ok:true,total:(rows.results||[]).reduce((a,x)=>a+Number(x.unread_count||0),0),items:rows.results});
});

// Sinalização de chamada de voz interna WebRTC.
async function createCall(c:Context<AppBindings>,auth:AuthUser,delivery:Row,conversation:ConversationKey,offer:string){
  if(!allowedConversations(auth).includes(conversation))throw new Error('Conversa inválida para chamada.');
  if(['delivered','cancelled'].includes(delivery.status))throw new Error('A entrega já foi encerrada.');
  const mine=party(auth),callee=otherParty(conversation,mine),callId=id();
  await c.env.DB.prepare(`INSERT INTO delivery_calls(id,delivery_id,cooperative_id,conversation_key,caller_type,caller_user_id,caller_name,callee_type,offer_sdp) VALUES (?,?,?,?,?,?,?,?,?)`).bind(callId,delivery.id,auth.cooperativeId,conversation,mine,auth.id,auth.name,callee,offer).run();
  return callId;
}
platformV15Routes.post('/v15/deliveries/:id/calls',async c=>{const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']),delivery=await deliveryForAuth(c,auth,c.req.param('id')),body=await bodyJson<Row>(c),conversation=cleanText(body.conversation,40) as ConversationKey,offer=String(body.offer_sdp||'');if(!offer)return c.json({ok:false,error:'Oferta da chamada ausente.'},400);return c.json({ok:true,call_id:await createCall(c,auth,delivery,conversation,offer)},201);});
platformV15Routes.get('/v15/calls/incoming',async c=>{const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']),mine=party(auth);const where=[`x.cooperative_id=?`,`x.callee_type=?`,`x.status='ringing'`,`datetime(x.expires_at)>datetime('now')`,`d.deleted_at IS NULL`],params:any[]=[auth.cooperativeId,mine];if(auth.role==='driver'){where.push(`d.assigned_driver_id=?`);params.push(auth.driverId);}else if(auth.role==='establishment'){where.push(`d.establishment_id=?`,`d.delivery_type='establishment'`);params.push(auth.establishmentId);}else where.push(`d.delivery_type='base'`);const rows=await c.env.DB.prepare(`SELECT x.id,x.delivery_id,x.conversation_key,x.caller_name,x.caller_type,x.created_at,d.display_code FROM delivery_calls x JOIN deliveries d ON d.id=x.delivery_id WHERE ${where.join(' AND ')} ORDER BY x.created_at DESC LIMIT 5`).bind(...params).all<Row>();return c.json({ok:true,items:rows.results});});
platformV15Routes.get('/v15/calls/:id',async c=>{const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']);const row=await c.env.DB.prepare(`SELECT x.*,d.assigned_driver_id,d.establishment_id,d.delivery_type FROM delivery_calls x JOIN deliveries d ON d.id=x.delivery_id WHERE x.id=? AND x.cooperative_id=?`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();if(!row)return c.json({ok:false,error:'Chamada não encontrada.'},404);await deliveryForAuth(c,auth,row.delivery_id);return c.json({ok:true,item:row});});
platformV15Routes.post('/v15/calls/:id/answer',async c=>{const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']),body=await bodyJson<Row>(c),answer=String(body.answer_sdp||'');const result=await c.env.DB.prepare(`UPDATE delivery_calls SET status='accepted',answer_sdp=?,answered_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND callee_type=? AND status='ringing'`).bind(answer,c.req.param('id'),auth.cooperativeId,party(auth)).run();if(!result.meta.changes)return c.json({ok:false,error:'A chamada não está mais disponível.'},409);return c.json({ok:true});});
platformV15Routes.post('/v15/calls/:id/decline',async c=>{const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']);await c.env.DB.prepare(`UPDATE delivery_calls SET status='declined',ended_at=CURRENT_TIMESTAMP,ended_by=? WHERE id=? AND cooperative_id=? AND status='ringing'`).bind(party(auth),c.req.param('id'),auth.cooperativeId).run();return c.json({ok:true});});
platformV15Routes.post('/v15/calls/:id/end',async c=>{const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']);await c.env.DB.prepare(`UPDATE delivery_calls SET status='ended',ended_at=CURRENT_TIMESTAMP,ended_by=? WHERE id=? AND cooperative_id=? AND status IN ('ringing','accepted')`).bind(party(auth),c.req.param('id'),auth.cooperativeId).run();return c.json({ok:true});});
platformV15Routes.post('/v15/calls/:id/candidates',async c=>{const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']),body=await bodyJson<Row>(c),candidate=JSON.stringify(body.candidate||null);await c.env.DB.prepare(`INSERT INTO delivery_call_candidates(call_id,sender_type,candidate_json) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM delivery_calls WHERE id=? AND cooperative_id=?)`).bind(c.req.param('id'),party(auth),candidate,c.req.param('id'),auth.cooperativeId).run();return c.json({ok:true});});
platformV15Routes.get('/v15/calls/:id/candidates',async c=>{const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']),after=Math.max(0,Number(c.req.query('after')||0));const rows=await c.env.DB.prepare(`SELECT id,sender_type,candidate_json FROM delivery_call_candidates WHERE call_id=? AND id>? AND sender_type!=? AND EXISTS(SELECT 1 FROM delivery_calls WHERE id=? AND cooperative_id=?) ORDER BY id`).bind(c.req.param('id'),after,party(auth),c.req.param('id'),auth.cooperativeId).all<Row>();return c.json({ok:true,items:rows.results});});

// SOS do cooperado com localização instantânea para Base e cooperados online.
platformV15Routes.post('/v15/driver/deliveries/:id/sos',async c=>{
  const auth=tenant(c,['driver']),delivery=await deliveryForAuth(c,auth,c.req.param('id')),body=await bodyJson<Row>(c),occurrence=cleanText(body.occurrence,800),lat=Number(body.latitude),lng=Number(body.longitude),accuracy=body.accuracy==null?null:Number(body.accuracy);
  if(!occurrence)return c.json({ok:false,error:'Descreva o ocorrido.'},400);if(!validCoordinates(lat,lng))return c.json({ok:false,error:'Não foi possível obter sua localização.'},400);
  const sosId=id();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO delivery_sos(id,delivery_id,cooperative_id,base_id,driver_id,driver_name,occurrence,latitude,longitude,accuracy) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(sosId,delivery.id,auth.cooperativeId,delivery.base_id||null,auth.driverId,auth.name,occurrence,lat,lng,accuracy),
    c.env.DB.prepare(`INSERT INTO notification_events(id,cooperative_id,establishment_id,driver_id,delivery_id,event_type,title,message) VALUES (?,?,?,?,?,'driver_sos','🚨 PEDIDO DE SOCORRO',?)`).bind(id(),auth.cooperativeId,delivery.establishment_id,auth.driverId,delivery.id,`${auth.name}: ${occurrence}`)
  ]);
  return c.json({ok:true,id:sosId});
});

// O SOS também funciona quando o cooperado não possui uma entrega ativa.
platformV15Routes.post('/v15/driver/sos',async c=>{
  const auth=tenant(c,['driver']),body=await bodyJson<Row>(c),occurrence=cleanText(body.occurrence||'Solicitação de ajuda enviada pelo aplicativo.',800),service=cleanText(body.emergency_service,30)||null,lat=Number(body.latitude),lng=Number(body.longitude),accuracy=body.accuracy==null?null:Number(body.accuracy);
  if(!validCoordinates(lat,lng))return c.json({ok:false,error:'Ative a localização para enviar o alerta interno.'},400);
  const base=await c.env.DB.prepare(`SELECT b.id,b.name,((? - b.latitude)*(? - b.latitude) + (? - b.longitude)*(? - b.longitude)) proximity FROM bases b WHERE b.cooperative_id=? AND b.active=1 AND b.deleted_at IS NULL AND b.latitude IS NOT NULL AND b.longitude IS NOT NULL ORDER BY proximity LIMIT 1`).bind(lat,lat,lng,lng,auth.cooperativeId).first<Row>();
  const sosId=id(),label=service?`Serviço indicado: ${service}. ${occurrence}`:occurrence;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO driver_sos_alerts(id,cooperative_id,base_id,driver_id,driver_name,occurrence,emergency_service,latitude,longitude,accuracy) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(sosId,auth.cooperativeId,base?.id||null,auth.driverId,auth.name,label,service,lat,lng,accuracy),
    c.env.DB.prepare(`INSERT INTO notification_events(id,cooperative_id,driver_id,event_type,title,message) VALUES (?,?,?,'driver_sos','🚨 PEDIDO DE SOCORRO',?)`).bind(id(),auth.cooperativeId,auth.driverId,`${auth.name}: ${label}`)
  ]);
  return c.json({ok:true,id:sosId,base_name:base?.name||null});
});

platformV15Routes.get('/v15/sos/active',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','driver','establishment']);
  if(auth.role==='driver'){
    const online=await c.env.DB.prepare(`SELECT online,on_leave,status,last_seen_at FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(auth.driverId,auth.cooperativeId).first<Row>();
    if(Number(online?.online||0)!==1||online?.status!=='active'||Number(online?.on_leave||0)===1||!online?.last_seen_at)return c.json({ok:true,items:[]});
    const recent=await c.env.DB.prepare(`SELECT 1 ok WHERE datetime(?)>=datetime('now','-10 minutes')`).bind(online.last_seen_at).first();
    if(!recent)return c.json({ok:true,items:[]});
  }
  const deliveryRows=await c.env.DB.prepare(`SELECT s.id,s.delivery_id,s.cooperative_id,s.base_id,s.driver_id,s.driver_name,s.occurrence,s.latitude,s.longitude,s.accuracy,s.status,s.created_at,s.helper_driver_id,s.helper_name,s.acknowledged_at,s.silenced_at,s.silenced_until,d.display_code,d.delivery_address,NULL emergency_service,'delivery' source_type FROM delivery_sos s JOIN deliveries d ON d.id=s.delivery_id WHERE s.cooperative_id=? AND s.status='active' ${auth.role==='driver'?'AND s.driver_id!=?':''}`).bind(...(auth.role==='driver'?[auth.cooperativeId,auth.driverId]:[auth.cooperativeId])).all<Row>();
  const generalRows=await c.env.DB.prepare(`SELECT s.id,NULL delivery_id,s.cooperative_id,s.base_id,s.driver_id,s.driver_name,s.occurrence,s.latitude,s.longitude,s.accuracy,s.status,s.created_at,s.helper_driver_id,s.helper_name,s.acknowledged_at,s.silenced_at,s.silenced_until,NULL display_code,NULL delivery_address,s.emergency_service,'general' source_type FROM driver_sos_alerts s WHERE s.cooperative_id=? AND s.status='active' ${auth.role==='driver'?'AND s.driver_id!=?':''}`).bind(...(auth.role==='driver'?[auth.cooperativeId,auth.driverId]:[auth.cooperativeId])).all<Row>();
  const combined:Row[]=[...(deliveryRows.results||[]),...(generalRows.results||[])];const items:Row[]=combined.map((item:Row)=>({...item,assigned_to_me:auth.role==='driver'&&item.helper_driver_id===auth.driverId?1:0,requested_by_me:auth.role==='driver'&&item.driver_id===auth.driverId?1:0})).sort((a:Row,b:Row)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,30);
  return c.json({ok:true,items});
});

// A primeira pessoa que tocar em "Ir ajudar" reserva o chamado de forma atômica.
platformV15Routes.post('/v15/sos/:id/help',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','driver']);
  if(auth.role==='driver'){
    const online=await c.env.DB.prepare(`SELECT online,on_leave,status,last_seen_at FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(auth.driverId,auth.cooperativeId).first<Row>();
    const recent=online?.last_seen_at?await c.env.DB.prepare(`SELECT 1 ok WHERE datetime(?)>=datetime('now','-10 minutes')`).bind(online.last_seen_at).first():null;
    if(Number(online?.online||0)!==1||online?.status!=='active'||Number(online?.on_leave||0)===1||!recent)return c.json({ok:false,error:'Fique online e disponível antes de ir ajudar.'},409);
  }
  const deliverySos=await c.env.DB.prepare(`SELECT *,'delivery' source_type FROM delivery_sos WHERE id=? AND cooperative_id=?`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  const generalSos=deliverySos?null:await c.env.DB.prepare(`SELECT *,'general' source_type FROM driver_sos_alerts WHERE id=? AND cooperative_id=?`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  const sos=deliverySos||generalSos;
  if(!sos||sos.status!=='active')return c.json({ok:false,error:'O pedido de socorro não está mais disponível.'},404);
  if(auth.role==='driver'&&sos.driver_id===auth.driverId)return c.json({ok:false,error:'Este é o seu próprio pedido de socorro.'},400);
  const helperDriverId=auth.role==='driver'?auth.driverId:null,table=sos.source_type==='delivery'?'delivery_sos':'driver_sos_alerts';
  const result=await c.env.DB.prepare(`UPDATE ${table} SET helper_user_id=?,helper_driver_id=?,helper_name=?,acknowledged_at=CURRENT_TIMESTAMP,silenced_at=NULL,silenced_until=NULL WHERE id=? AND cooperative_id=? AND status='active' AND helper_driver_id IS NULL`).bind(auth.id,helperDriverId,auth.name,c.req.param('id'),auth.cooperativeId).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Já existe alguém a caminho para ajudar.'},409);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO notification_events(id,cooperative_id,driver_id,delivery_id,event_type,title,message) VALUES (?,?,?,?,?,'Ajuda a caminho',?)`).bind(id(),auth.cooperativeId,sos.driver_id,sos.delivery_id||null,'driver_sos_help',`${auth.name} está a caminho para ajudar.`),
    ...(helperDriverId?[c.env.DB.prepare(`INSERT INTO notification_events(id,cooperative_id,driver_id,delivery_id,event_type,title,message) VALUES (?,?,?,?,?,'SOS reservado',?)`).bind(id(),auth.cooperativeId,helperDriverId,sos.delivery_id||null,'driver_sos_assignment',`Você reservou o pedido de ajuda de ${sos.driver_name}. Abra o mapa e siga até o local.`)]:[])
  ]);
  const lat=Number(sos.latitude),lng=Number(sos.longitude);
  return c.json({ok:true,helper_name:auth.name,navigation_url:`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}&travelmode=driving`});
});

// Compatibilidade com versões antigas da interface.
platformV15Routes.post('/v15/sos/:id/resolve',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','driver']);
  let result=await c.env.DB.prepare(`UPDATE delivery_sos SET status='resolved',resolved_at=CURRENT_TIMESTAMP,resolved_by=? WHERE id=? AND cooperative_id=? AND status='active'`).bind(auth.id,c.req.param('id'),auth.cooperativeId).run();
  if(!result.meta.changes)result=await c.env.DB.prepare(`UPDATE driver_sos_alerts SET status='resolved',resolved_at=CURRENT_TIMESTAMP,resolved_by=?,helper_name=? WHERE id=? AND cooperative_id=? AND status='active'`).bind(auth.id,auth.name,c.req.param('id'),auth.cooperativeId).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Já existe alguém a caminho para ajudar.'},409);
  return c.json({ok:true});
});

// ChegaJá 14.2 — edição rápida campo a campo, cancelamento preservando histórico e fluxo de ajuda.
platformV15Routes.patch('/v15/base/deliveries/:id/field',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const delivery=await deliveryForAuth(c,auth,c.req.param('id'));
  if(delivery.delivery_type!=='base')return c.json({ok:false,error:'Esta função é exclusiva da Base.'},403);
  if(['delivered','cancelled'].includes(String(delivery.status)))return c.json({ok:false,error:'Entrega encerrada não pode ser alterada.'},409);
  const body=await bodyJson<Row>(c),field=cleanText(body.field,60),value=body.value;
  const allowed=new Set(['customer_name','customer_phone','pickup_address','delivery_address','charge_value','payment_method','payment_status','driver_id','status']);
  if(!allowed.has(field))return c.json({ok:false,error:'Campo não permitido.'},400);
  let nextStatus=String(delivery.status),note='';
  const statements:D1PreparedStatement[]=[];
  if(field==='customer_name'){
    const v=cleanText(value,150);if(!v)return c.json({ok:false,error:'Informe o cliente.'},400);
    statements.push(c.env.DB.prepare(`UPDATE deliveries SET customer_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(v,delivery.id));note=`Cliente alterado para ${v}.`;
  }else if(field==='customer_phone'){
    const v=cleanText(value,50);statements.push(c.env.DB.prepare(`UPDATE deliveries SET customer_phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(v,delivery.id));note='Telefone do cliente alterado.';
  }else if(field==='pickup_address'||field==='delivery_address'){
    const v=cleanText(value,500);if(!v)return c.json({ok:false,error:'Informe o endereço.'},400);
    const prefix=field==='pickup_address'?'pickup':'delivery';
    const changedPoint=await geocodeAddress(c.env,v);
    if(!changedPoint)return c.json({ok:false,error:'Não foi possível localizar este endereço. Informe rua, número, bairro, cidade e estado.'},400);
    const otherPrefix=prefix==='pickup'?'delivery':'pickup';
    let otherPoint:null|{lat:number,lng:number}=null;
    const lat=Number(delivery[`${otherPrefix}_lat`]),lng=Number(delivery[`${otherPrefix}_lng`]);
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&(Math.abs(lat)+Math.abs(lng)>0.001))otherPoint={lat,lng};
    if(!otherPoint){
      const otherAddress=String(delivery[`${otherPrefix}_address`]||'').trim();
      if(otherAddress)otherPoint=await geocodeAddress(c.env,otherAddress);
    }
    if(!otherPoint)return c.json({ok:false,error:'O outro endereço da entrega não pôde ser localizado para recalcular a rota.'},400);
    const route=prefix==='pickup'?await routeBetween(c.env,[changedPoint,otherPoint]):await routeBetween(c.env,[otherPoint,changedPoint]);
    if(!route)return c.json({ok:false,error:'Não foi possível recalcular a rota entre os endereços.'},400);
    statements.push(c.env.DB.prepare(`UPDATE deliveries SET ${prefix}_address=?,${prefix}_lat=?,${prefix}_lng=?,${prefix}_address_json=?,${prefix}_place_id=NULL,addresses_confirmed=1,route_geometry=?,distance_meters=?,duration_seconds=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(changedPoint.display_name||v,changedPoint.lat,changedPoint.lng,JSON.stringify({formatted_address:changedPoint.display_name||v,latitude:changedPoint.lat,longitude:changedPoint.lng}),JSON.stringify({type:'LineString',coordinates:route.geometry.map(point=>[point[1],point[0]])}),route.distance_meters,route.duration_seconds,delivery.id));note=`Endereço de ${prefix==='pickup'?'coleta':'entrega'} alterado e rota recalculada.`;
  }else if(field==='charge_value'){
    const cents=Math.max(0,toCents(value));if(cents<=0)return c.json({ok:false,error:'Informe um valor maior que zero.'},400);
    const values=await amounts(c,auth.cooperativeId!,cents,Number(delivery.base_fee_percent||0),String(delivery.payment_method||''));
    statements.push(c.env.DB.prepare(`UPDATE deliveries SET charge_cents=?,driver_earnings_cents=?,driver_gross_cents=?,driver_net_cents=?,cooperative_fee_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(cents,values.gross,values.gross,values.net,values.fee,delivery.id));note=`Valor alterado para R$ ${(cents/100).toFixed(2).replace('.',',')}.`;
  }else if(field==='payment_method'){
    const v=cleanText(value,40),methods=['pix','dinheiro','cartao_credito','cartao_debito','vale_alimentacao','vale_refeicao','credit','pix_cooperativa'];
    if(!methods.includes(v))return c.json({ok:false,error:'Forma de pagamento inválida.'},400);
    const status=v==='credit'?'paid':String(delivery.payment_status||'pending');
    statements.push(c.env.DB.prepare(`UPDATE deliveries SET payment_method=?,payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(v,status,delivery.id));note=`Forma de pagamento alterada para ${v}.`;
  }else if(field==='payment_status'){
    const v=cleanText(value,30);if(!['pending','paid','partial','cancelled'].includes(v))return c.json({ok:false,error:'Situação de pagamento inválida.'},400);
    statements.push(c.env.DB.prepare(`UPDATE deliveries SET payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(v,delivery.id));note=`Situação do pagamento alterada para ${v}.`;
  }else if(field==='driver_id'){
    const driverId=nullableText(value,100);let driverName='Não atribuído';
    if(driverId){const driver=await c.env.DB.prepare(`SELECT id,name,on_leave,leave_return_date FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND deleted_at IS NULL`).bind(driverId,auth.cooperativeId).first<Row>();if(!driver)return c.json({ok:false,error:'Cooperado inválido ou inativo.'},400);if(Number(driver.on_leave||0)===1)return c.json({ok:false,error:`Cooperado afastado${driver.leave_return_date?` até ${driver.leave_return_date}`:''}.`},409);driverName=String(driver.name);nextStatus='assigned';statements.push(c.env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting'`).bind(delivery.id,driverId));}
    else nextStatus='new';
    statements.push(c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status=?,assignment_source='base_inline_edit',assigned_by_role=?,assigned_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(driverId,nextStatus,auth.role,auth.id,delivery.id));note=`Cooperado alterado para ${driverName}.`;
  }else if(field==='status'){
    const v=cleanText(value,30),statuses=['new','offered','assigned','accepted','to_pickup','at_pickup','picked_up','in_route','problem','delivered','cancelled'];
    if(!statuses.includes(v))return c.json({ok:false,error:'Status inválido.'},400);
    if(v==='assigned'&&!delivery.assigned_driver_id)return c.json({ok:false,error:'Escolha um cooperado antes de usar o status atribuído.'},409);
    nextStatus=v;
    if(v==='cancelled'){
      if(delivery.customer_id&&Number(delivery.credit_used_cents||0)>0)await reconcileDeliveryCredit(c.env,{deliveryId:delivery.id,cooperativeId:auth.cooperativeId!,customerId:delivery.customer_id,desiredCents:0,displayCode:delivery.display_code,reason:`Entrega ${delivery.display_code} cancelada pela Base`});
      statements.push(c.env.DB.prepare(`UPDATE deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,payment_status=CASE WHEN payment_method='credit' THEN 'cancelled' ELSE payment_status END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delivery.id));
      statements.push(c.env.DB.prepare(`UPDATE customer_requests SET status='cancelled',credit_used_cents=0,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`).bind(delivery.id));
      statements.push(c.env.DB.prepare(`UPDATE financial_entries SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE delivery_id=? AND deleted_at IS NULL`).bind(delivery.id));
    }else if(v==='delivered'){
      statements.push(c.env.DB.prepare(`UPDATE deliveries SET status='delivered',delivered_at=CURRENT_TIMESTAMP,completion_source='base',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delivery.id));
    }else statements.push(c.env.DB.prepare(`UPDATE deliveries SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(v,delivery.id));
    note=`Status alterado para ${v}.`;
  }
  statements.push(c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,nextStatus,note,auth.id));
  await c.env.DB.batch(statements);
  if(field==='status'&&nextStatus==='delivered'&&delivery.assigned_driver_id)await finishFinancial(c,auth,delivery);
  return c.json({ok:true,field,value,status:nextStatus});
});

platformV15Routes.post('/v15/sos/:id/silence',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment']);
  const body=await bodyJson<Row>(c).catch(()=>({} as Row));
  const minutes=Math.min(60,Math.max(1,Number(body.minutes||10)));
  let result=await c.env.DB.prepare(`UPDATE delivery_sos SET silenced_at=CURRENT_TIMESTAMP,silenced_until=datetime('now',? || ' minutes') WHERE id=? AND cooperative_id=? AND status='active'`).bind(String(minutes),c.req.param('id'),auth.cooperativeId).run();
  if(!result.meta.changes)result=await c.env.DB.prepare(`UPDATE driver_sos_alerts SET silenced_at=CURRENT_TIMESTAMP,silenced_until=datetime('now',? || ' minutes') WHERE id=? AND cooperative_id=? AND status='active'`).bind(String(minutes),c.req.param('id'),auth.cooperativeId).run();
  return c.json({ok:Boolean(result.meta.changes),silenced_minutes:minutes});
});

platformV15Routes.post('/v15/sos/:id/assign-helper',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment']);const body=await bodyJson<Row>(c),driverId=cleanText(body.driver_id,100);
  const driver=await c.env.DB.prepare(`SELECT id,name,online,on_leave,last_seen_at FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND deleted_at IS NULL`).bind(driverId,auth.cooperativeId).first<Row>();
  if(!driver)return c.json({ok:false,error:'Cooperado de ajuda inválido.'},400);
  if(Number(driver.on_leave||0)===1)return c.json({ok:false,error:'O cooperado escolhido está afastado.'},409);
  const driverRecent=driver.last_seen_at?await c.env.DB.prepare(`SELECT 1 ok WHERE datetime(?)>=datetime('now','-10 minutes')`).bind(driver.last_seen_at).first():null;
  if(Number(driver.online||0)!==1||!driverRecent)return c.json({ok:false,error:'O cooperado escolhido precisa estar online e com o aplicativo ativo.'},409);
  const deliverySos=await c.env.DB.prepare(`SELECT *,'delivery' source_type FROM delivery_sos WHERE id=? AND cooperative_id=? AND status='active'`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  const generalSos=deliverySos?null:await c.env.DB.prepare(`SELECT *,'general' source_type FROM driver_sos_alerts WHERE id=? AND cooperative_id=? AND status='active'`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  const sos=deliverySos||generalSos;if(!sos)return c.json({ok:false,error:'Pedido de ajuda não encontrado.'},404);
  if(sos.driver_id===driver.id)return c.json({ok:false,error:'Não é possível designar o próprio cooperado que pediu ajuda.'},400);
  const table=sos.source_type==='delivery'?'delivery_sos':'driver_sos_alerts';
  const result=await c.env.DB.prepare(`UPDATE ${table} SET helper_user_id=?,helper_driver_id=?,helper_name=?,acknowledged_at=CURRENT_TIMESTAMP,silenced_at=NULL,silenced_until=NULL WHERE id=? AND cooperative_id=? AND status='active' AND (helper_driver_id IS NULL OR helper_driver_id=?)`).bind(auth.id,driver.id,driver.name,c.req.param('id'),auth.cooperativeId,driver.id).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Este SOS já foi assumido por outro cooperado ou não está mais ativo.'},409);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO notification_events(id,cooperative_id,driver_id,delivery_id,event_type,title,message) VALUES (?,?,?,?,?,'Você foi designado para um SOS',?)`).bind(id(),auth.cooperativeId,driver.id,sos.delivery_id||null,'driver_sos_assignment',`Vá ajudar ${sos.driver_name}. Abra o alerta para navegar até o local.`),
    c.env.DB.prepare(`INSERT INTO notification_events(id,cooperative_id,driver_id,delivery_id,event_type,title,message) VALUES (?,?,?,?,?,'Ajuda designada',?)`).bind(id(),auth.cooperativeId,sos.driver_id,sos.delivery_id||null,'driver_sos_help',`${driver.name} foi designado e está sendo avisado.`)
  ]);
  return c.json({ok:true,helper:{id:driver.id,name:driver.name},navigation_url:`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${Number(sos.latitude)},${Number(sos.longitude)}`)}&travelmode=driving`});
});
