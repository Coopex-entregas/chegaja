import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { assertRole, bodyJson, cleanText, id, nullableText, toCents } from '../lib/util';
import { hashPassword, randomToken } from '../lib/crypto';
import { addressJson, addressPoint, readAddressConfirmationToken } from '../lib/address';
import { routeBetween, routePrice, type AddressCandidate, type GeoPoint } from '../lib/maps';
import { cooperativeCreditBalance, reconcileDeliveryCredit } from '../lib/wallet';
import { queueWebhookEvent } from '../lib/webhooks';
import { dispatchNextDriver } from '../lib/auto-dispatch';
import { deliveryFields } from '../lib/delivery-fields';
import { processScheduledDeliveries } from '../lib/scheduled-deliveries';
import { baseDirectReceivedPayment, baseReceivablePayment, reconcileDriverFinancialBalance } from '../lib/financial-settlement';

export const platformV16Routes = new Hono<AppBindings>();
export const publicV16Routes = new Hono<AppBindings>();
type Row = Record<string, any>;
type WaitStage = 'pickup'|'delivery'|'service';

function tenant(c: Context<AppBindings>, roles: AuthUser['role'][]): AuthUser {
  const auth=c.get('auth');
  assertRole(auth,roles);
  if(!auth.cooperativeId)throw new Error('Cooperativa não vinculada.');
  return auth;
}
function yes(value:unknown){return value===true||value==='true'||value==='1'||value===1||value==='on';}
function dispatchMode(value:unknown){const mode=cleanText(value||'none',20).toLowerCase();return ['manual','automatic'].includes(mode)?mode:'none';}
function scheduledDateTime(body:Row){
  if(cleanText(body.service_time_mode||'now',20)!=='scheduled')return null;
  const date=cleanText(body.scheduled_date,10),time=cleanText(body.scheduled_time,5);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw new Error('Informe a data e o horário da entrega agendada.');
  const value=new Date(`${date}T${time}:00-03:00`);
  if(Number.isNaN(value.getTime()))throw new Error('Data ou horário do agendamento inválido.');
  if(value.getTime()<Date.now()-60000)throw new Error('O horário agendado não pode estar no passado.');
  return value.toISOString();
}
function storedComplement(block:unknown,complement:unknown){
  if(block===undefined)return nullableText(complement,300);
  const blockText=nullableText(block,100),raw=String(complement??'').trim().replace(/^Bloco:\s*[^•\n]+(?:\s*•\s*)?/i,'').trim();
  return nullableText([blockText?`Bloco: ${blockText}`:'',raw].filter(Boolean).join(' • '),300);
}
function centsLabel(value:number){return `R$ ${(Math.max(0,value)/100).toFixed(2).replace('.',',')}`;}
function validStatus(value:string){return ['new','assigned','accepted','to_pickup','at_pickup','picked_up','in_route','delivered','cancelled','problem'].includes(value);}
function elapsedSeconds(startedAt:string,endedAt?:string|null){
  const start=Date.parse(String(startedAt).replace(' ','T')+'Z');
  const end=endedAt?Date.parse(String(endedAt).replace(' ','T')+'Z'):Date.now();
  if(!Number.isFinite(start)||!Number.isFinite(end))return 0;
  return Math.max(0,Math.floor((end-start)/1000));
}
function waitAmount(elapsed:number,free:number,rate:number){
  const billed=Math.max(0,elapsed-Math.max(0,free));
  return {billed,charge:Math.max(0,Math.round(billed*Math.max(0,rate)/900))};
}
function haversineMeters(lat1:number,lng1:number,lat2:number,lng2:number){
  const rad=(value:number)=>value*Math.PI/180,earth=6371000;
  const dLat=rad(lat2-lat1),dLng=rad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLng/2)**2;
  return earth*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function normalizePayment(value:unknown){
  const raw=cleanText(value||'pix',40).toLowerCase();
  if(['credit','credito','credito_antecipado','crédito antecipado','credito_automatico','crédito automático','prepaid','pre_pago'].includes(raw))return 'credit';
  if(['pix_cooperativa','pix-cooperativa','pix cooperativa'].includes(raw))return 'pix_cooperativa';
  if(raw==='dinheiro')return 'dinheiro';
  if(['cartao_credito','cartão de crédito','cartao de credito','credito_cartao'].includes(raw))return 'cartao_credito';
  if(['cartao_debito','cartão de débito','cartao de debito','debito_cartao'].includes(raw))return 'cartao_debito';
  if(['vale_alimentacao','vale alimentação','vale alimentacao'].includes(raw))return 'vale_alimentacao';
  if(['vale_refeicao','vale refeição','vale refeicao'].includes(raw))return 'vale_refeicao';
  return 'pix';
}
function taxableBasePayment(method:unknown){return baseReceivablePayment(normalizePayment(method));}
async function uniqueConfirmationCode(c:Context<AppBindings>,phone:string|null){
  const used=new Set<string>();
  if(phone){
    const rows=await c.env.DB.prepare(`SELECT DISTINCT confirmation_code FROM deliveries WHERE confirmation_code IS NOT NULL AND (customer_phone=? OR recipient_phone=?) LIMIT 9000`).bind(phone,phone).all<Row>();
    for(const row of rows.results||[])used.add(String(row.confirmation_code));
  }
  const buffer=new Uint32Array(1);
  for(let attempt=0;attempt<200;attempt+=1){
    crypto.getRandomValues(buffer);
    const code=String(1000+(buffer[0]%9000));
    if(!used.has(code))return code;
  }
  for(let value=1000;value<=9999;value+=1)if(!used.has(String(value)))return String(value);
  throw new Error('Não foi possível gerar o código de confirmação.');
}

async function baseFor(c:Context<AppBindings>,auth:AuthUser,baseId:string){
  const base=await c.env.DB.prepare(`SELECT b.*,e.id virtual_establishment_id,e.name virtual_establishment_name
    FROM bases b LEFT JOIN establishments e ON e.id=b.virtual_establishment_id
    WHERE b.id=? AND b.cooperative_id=? AND b.deleted_at IS NULL LIMIT 1`).bind(baseId,auth.cooperativeId).first<Row>();
  if(!base)throw new Error('Base não encontrada.');
  if(auth.role==='dispatcher'){
    const count=await c.env.DB.prepare(`SELECT COUNT(*) total FROM base_attendants WHERE cooperative_id=? AND active=1`).bind(auth.cooperativeId).first<Row>();
    if(Number(count?.total||0)>0){
      const linked=await c.env.DB.prepare(`SELECT 1 ok FROM base_attendants WHERE cooperative_id=? AND base_id=? AND user_id=? AND active=1`).bind(auth.cooperativeId,baseId,auth.id).first();
      if(!linked)throw new Error('Este atendente não está vinculado a esta Base.');
    }
  }
  return base;
}

async function deliveryFor(c:Context<AppBindings>,auth:AuthUser,deliveryId:string){
  const row=await c.env.DB.prepare(`SELECT
      d.id,d.cooperative_id,d.establishment_id,d.source,d.customer_id,d.customer_mode,d.customer_name,d.customer_phone,
      d.pickup_contact_name,d.pickup_phone,d.pickup_address,d.pickup_neighborhood,d.pickup_apartment,d.pickup_complement,d.pickup_lat,d.pickup_lng,d.pickup_address_json,d.pickup_place_id,
      d.recipient_name,d.recipient_phone,d.delivery_address,d.delivery_neighborhood,d.delivery_apartment,d.delivery_complement,d.delivery_lat,d.delivery_lng,d.delivery_address_json,d.delivery_place_id,
      d.item_description,d.amount_to_collect_cents,d.notes,d.status,d.charge_cents,d.base_charge_cents,d.route_charge_cents,d.displacement_distance_meters,d.displacement_cents,d.return_required,d.return_cents,
      d.service_charge_cents,d.services_cents,d.wait_charge_cents,d.cancellation_charge_cents,d.paid_cents,d.outstanding_cents,d.credit_used_cents,
      d.driver_earnings_cents,d.driver_gross_cents,d.driver_net_cents,d.cooperative_fee_cents,d.payment_method,d.payment_status,d.cash_payment_location,
      d.tracking_token,d.created_by,d.created_at,d.updated_at,d.launched_by_user_id,d.launched_by_name,d.display_code,d.delivery_type,d.base_id,
      d.assigned_driver_id,d.assigned_by_role,d.assigned_by_user_id,d.assignment_source,d.distance_meters,d.duration_seconds,d.route_geometry,d.addresses_confirmed,
      d.wait_free_seconds,d.wait_rate_cents_per_15m,d.confirmation_required,d.confirmation_code,d.finish_without_code_authorized,d.finish_without_code_authorized_by,
      d.customer_confirmed_received_at,d.completion_source,d.received_by_name,d.delivered_at,d.cancelled_at,
      b.name base_name,b.rate_per_km_cents,b.minimum_fee_cents,b.cooperative_fee_percent base_fee_percent,
      b.pickup_free_seconds,b.delivery_free_seconds,b.wait_cents_per_15m,b.return_percent,b.displacement_rate_cents_per_km,
      b.cancellation_displacement_multiplier,b.fuel_km_per_liter,b.fuel_price_cents,e.name establishment_name,
      dr.name driver_name,dr.current_lat driver_lat,dr.current_lng driver_lng,dr.location_updated_at,
      u.name created_by_name
    FROM deliveries d JOIN establishments e ON e.id=d.establishment_id LEFT JOIN bases b ON b.id=d.base_id
    LEFT JOIN drivers dr ON dr.id=d.assigned_driver_id LEFT JOIN users u ON u.id=COALESCE(d.launched_by_user_id,d.created_by)
    WHERE d.id=? AND d.cooperative_id=? AND d.deleted_at IS NULL LIMIT 1`).bind(deliveryId,auth.cooperativeId).first<Row>();
  if(!row)throw new Error('Entrega não encontrada.');
  if(auth.role==='driver'&&row.assigned_driver_id!==auth.driverId)throw new Error('Acesso não autorizado.');
  if(auth.role==='establishment'&&(row.establishment_id!==auth.establishmentId||row.delivery_type==='base'))throw new Error('Acesso não autorizado.');
  if(['cooperative_admin','dispatcher'].includes(auth.role)&&row.delivery_type!=='base')throw new Error('A cooperativa só edita entregas da Base nesta tela.');
  return row;
}

async function valuesFor(c:Context<AppBindings>,cooperativeId:string,charge:number,feePercent:number,paymentMethod:unknown){
  const fee=Math.round(charge*Math.max(0,feePercent)/100),gross=Math.max(0,charge-fee);
  if(!taxableBasePayment(paymentMethod))return {fee,gross,net:gross};
  const coop=await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(cooperativeId).first<Row>();
  const inss=Math.round(gross*Number(coop?.inss_percent||0)/100),sest=Math.round(gross*Number(coop?.sest_senat_percent||0)/100);
  return {fee,gross,net:Math.max(0,gross-inss-sest)};
}

async function nextCode(c:Context<AppBindings>,cooperativeId:string){
  const row=await c.env.DB.prepare(`INSERT INTO cooperative_sequences(cooperative_id,sequence_name,current_value,updated_at)
    VALUES (?,'delivery',1,CURRENT_TIMESTAMP) ON CONFLICT(cooperative_id,sequence_name)
    DO UPDATE SET current_value=current_value+1,updated_at=CURRENT_TIMESTAMP RETURNING current_value`).bind(cooperativeId).first<Row>();
  return `BASE-${String(row?.current_value||Date.now()).padStart(6,'0')}`;
}

async function selectedServices(c:Context<AppBindings>,cooperativeId:string,baseId:string,raw:unknown){
  const ids=Array.isArray(raw)?raw.map(String).filter(Boolean).slice(0,30):[];
  if(!ids.length)return {items:[] as Row[],total:0,waitService:null as Row|null};
  const marks=ids.map(()=>'?').join(',');
  const rows=await c.env.DB.prepare(`SELECT id,name,add_cents,free_wait_seconds,wait_cents_per_15m,wait_tracking_enabled
    FROM services WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL AND (base_id IS NULL OR base_id=?) AND id IN (${marks})`).bind(cooperativeId,baseId,...ids).all<Row>();
  const items=rows.results||[];
  return {items,total:items.reduce((sum,x)=>sum+Number(x.add_cents||0),0),waitService:items.find(x=>Number(x.wait_tracking_enabled??1)===1)||null};
}

async function candidateFrom(body:Row,key:string,c:Context<AppBindings>){
  const token=String(body[key]||'').trim();
  return token?await readAddressConfirmationToken(c.env,token):null;
}
function candidatePoint(candidate:AddressCandidate|null):GeoPoint|null{return candidate?addressPoint(candidate):null;}

async function quoteBase(c:Context<AppBindings>,auth:AuthUser,body:Row){
  const base=await baseFor(c,auth,cleanText(body.base_id,100));
  const pickup=await candidateFrom(body,'pickup_confirmation_token',c),delivery=await candidateFrom(body,'delivery_confirmation_token',c);
  if(!pickup||!delivery)throw new Error('Confirme os endereços de coleta e entrega.');
  const route=await routeBetween(c.env,[addressPoint(pickup),addressPoint(delivery)]);
  if(!route)throw new Error('Não foi possível calcular a rota.');
  const services=await selectedServices(c,auth.cooperativeId!,base.id,body.service_ids);
  const routeCharge=routePrice(route.distance_meters,Number(base.rate_per_km_cents||0),Number(base.minimum_fee_cents||0),0);
  let displacementDistance=0;
  const manualKm=Number(body.displacement_km);
  if(Number.isFinite(manualKm)&&manualKm>0)displacementDistance=Math.round(manualKm*1000);
  else if(base.latitude!=null&&base.longitude!=null){
    const displacement=await routeBetween(c.env,[{lat:Number(base.latitude),lng:Number(base.longitude)},addressPoint(pickup)]);
    displacementDistance=Number(displacement?.distance_meters||0);
  }
  const displacementCents=Math.round(displacementDistance/1000*Number(base.displacement_rate_cents_per_km||0));
  const hasReturn=yes(body.return_required),returnCents=hasReturn?Math.round(routeCharge*Number(base.return_percent||50)/100):0;
  const baseCharge=routeCharge+displacementCents+returnCents+services.total;
  const fuelLiters=Number(base.fuel_km_per_liter||0)>0?((route.distance_meters+displacementDistance)/1000)/Number(base.fuel_km_per_liter):0;
  const fuelCost=Math.round(fuelLiters*Number(base.fuel_price_cents||0));
  return {base,pickup,delivery,route,services,breakdown:{route_charge_cents:routeCharge,displacement_distance_meters:displacementDistance,displacement_cents:displacementCents,return_required:hasReturn?1:0,return_cents:returnCents,service_charge_cents:services.total,base_charge_cents:baseCharge,fuel_cost_cents:fuelCost,fuel_liters:fuelLiters}};
}

async function customerData(c:Context<AppBindings>,auth:AuthUser,body:Row){
  const mode=body.customer_mode==='registered'?'registered':'guest';
  if(mode==='registered'){
    const customerId=cleanText(body.customer_id,100);
    const customer=await c.env.DB.prepare(`SELECT c.id,c.name,c.phone,c.email FROM customers c WHERE c.id=? AND
      (EXISTS(SELECT 1 FROM cooperative_customers cc WHERE cc.cooperative_id=? AND cc.customer_id=c.id AND cc.status='active')
      OR EXISTS(SELECT 1 FROM customer_requests r WHERE r.cooperative_id=? AND r.customer_id=c.id))`).bind(customerId,auth.cooperativeId,auth.cooperativeId).first<Row>();
    if(!customer)throw new Error('Selecione um cliente cadastrado.');
    return {mode,customerId:customer.id,name:customer.name,phone:customer.phone,email:customer.email};
  }
  const name=cleanText(body.customer_name,150),phone=cleanText(body.customer_phone,50);
  if(!name)throw new Error('Informe o nome do cliente avulso.');
  return {mode,customerId:null,name,phone,email:null};
}

async function reconcileCreditFlexible(c:Context<AppBindings>,delivery:Row,desired:number,reason:string){
  if(!delivery.customer_id)return {applied:Number(delivery.credit_used_cents||0),outstanding:desired};
  const current=Number(delivery.credit_used_cents||0),delta=Math.max(0,desired-current),available=await cooperativeCreditBalance(c.env,delivery.customer_id,delivery.cooperative_id);
  const target=delta>available?current+available:desired;
  if(target!==current)await reconcileDeliveryCredit(c.env,{deliveryId:delivery.id,cooperativeId:delivery.cooperative_id,customerId:delivery.customer_id,desiredCents:target,displayCode:delivery.display_code,reason});
  return {applied:target,outstanding:Math.max(0,desired-target)};
}

async function closeWait(c:Context<AppBindings>,auth:AuthUser,delivery:Row,session:Row,details:{reason?:string,lat?:number|null,lng?:number|null}={}){
  if(delivery.delivery_type==='establishment'){
    const elapsed=elapsedSeconds(session.started_at);
    await c.env.DB.prepare(`UPDATE delivery_wait_sessions SET ended_at=CURRENT_TIMESTAMP,elapsed_seconds=?,billed_seconds=0,charge_cents=0,status='ended',ended_by=?,end_lat=?,end_lng=?,end_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'`).bind(elapsed,auth.id,details.lat??null,details.lng??null,nullableText(details.reason||'Sem cobrança para estabelecimento',120),session.id).run();
    return {elapsed_seconds:elapsed,billed_seconds:0,charge_cents:0,wait_charge_cents:0,total_cents:Number(delivery.charge_cents||0),outstanding_cents:Number(delivery.outstanding_cents||0),driver_net_cents:Number(delivery.driver_net_cents||0)};
  }
  const elapsed=elapsedSeconds(session.started_at),calc=waitAmount(elapsed,Number(session.free_seconds||0),Number(session.rate_cents_per_15m||0));
  await c.env.DB.prepare(`UPDATE delivery_wait_sessions SET ended_at=CURRENT_TIMESTAMP,elapsed_seconds=?,billed_seconds=?,charge_cents=?,status='ended',ended_by=?,end_lat=?,end_lng=?,end_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'`)
    .bind(elapsed,calc.billed,calc.charge,auth.id,details.lat??null,details.lng??null,nullableText(details.reason,120),session.id).run();
  const totalRow=await c.env.DB.prepare(`SELECT COALESCE(SUM(charge_cents),0) total FROM delivery_wait_sessions WHERE delivery_id=? AND status='ended'`).bind(delivery.id).first<Row>();
  const waitTotal=Number(totalRow?.total||0),total=Number(delivery.base_charge_cents||delivery.charge_cents||0)+waitTotal+Number(delivery.cancellation_charge_cents||0);
  let paid=Number(delivery.paid_cents||0),creditUsed=Number(delivery.credit_used_cents||0);
  const originalCharge=Number(delivery.base_charge_cents||delivery.charge_cents||0);
  // Compatibilidade com entregas cuja corrida foi marcada como paga antes de existir espera,
  // mas o campo paid_cents ainda não havia sido preenchido. Só o valor original é considerado pago.
  if(String(delivery.payment_status||'')==='paid'&&paid<originalCharge)paid=originalCharge;
  if(delivery.payment_method==='credit'&&delivery.customer_id){
    const credit=await reconcileCreditFlexible(c,delivery,total,`Cobrança de espera da entrega ${delivery.display_code}: ${calc.billed} segundo(s) após a tolerância.`);
    creditUsed=credit.applied;paid=credit.applied;
  }
  const outstanding=Math.max(0,total-paid);
  const amounts=await valuesFor(c,delivery.cooperative_id,total,Number(delivery.base_fee_percent||0),delivery.payment_method);
  await c.env.DB.prepare(`UPDATE deliveries SET wait_charge_cents=?,charge_cents=?,paid_cents=?,outstanding_cents=?,credit_used_cents=?,driver_earnings_cents=?,driver_gross_cents=?,driver_net_cents=?,cooperative_fee_cents=?,payment_status=CASE WHEN ?>= ? THEN 'paid' ELSE 'pending' END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(waitTotal,total,paid,outstanding,creditUsed,amounts.gross,amounts.gross,amounts.net,amounts.fee,paid,total,delivery.id).run();
  return {elapsed_seconds:elapsed,billed_seconds:calc.billed,charge_cents:calc.charge,wait_charge_cents:waitTotal,total_cents:total,outstanding_cents:outstanding,driver_net_cents:amounts.net};
}

async function waitSnapshot(c:Context<AppBindings>,deliveryId:string){
  const rows=await c.env.DB.prepare(`SELECT * FROM delivery_wait_sessions WHERE delivery_id=? ORDER BY created_at DESC LIMIT 20`).bind(deliveryId).all<Row>();
  const items:Row[]=(rows.results||[]).map((x:Row)=>{
    const elapsed=x.status==='active'?elapsedSeconds(x.started_at):Number(x.elapsed_seconds||0),calc=waitAmount(elapsed,Number(x.free_seconds||0),Number(x.rate_cents_per_15m||0));
    return {...x,elapsed_seconds:elapsed,billed_seconds:x.status==='active'?calc.billed:Number(x.billed_seconds||0),charge_cents:x.status==='active'?calc.charge:Number(x.charge_cents||0),free_remaining_seconds:Math.max(0,Number(x.free_seconds||0)-elapsed),charging:elapsed>Number(x.free_seconds||0)};
  });
  return {active:items.find(x=>x.status==='active')||null,items};
}

async function finishFinancial(c:Context<AppBindings>,auth:AuthUser,delivery:Row,replaceExisting=false){
  if(!delivery.assigned_driver_id)throw new Error('A entrega ainda não possui cooperado responsável.');
  const previousCredit=replaceExisting?await c.env.DB.prepare(`SELECT status,amount_cents,settled_cents,description FROM financial_entries WHERE delivery_id=? AND category='delivery' AND entry_type='credit' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`).bind(delivery.id).first<Row>():null;
  const previouslySettled=Boolean(previousCredit&&!String(previousCredit.description||'').toLowerCase().includes('recebido diretamente pelo cooperado')&&(previousCredit.status==='paid'||Number(previousCredit.settled_cents||0)>=Number(previousCredit.amount_cents||0)));
  if(replaceExisting)await c.env.DB.prepare(`UPDATE financial_entries SET status='cancelled',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=? AND category IN ('delivery','INSS','SEST/SENAT') AND deleted_at IS NULL`).bind(delivery.id).run();
  const exists=await c.env.DB.prepare(`SELECT 1 ok FROM financial_entries WHERE delivery_id=? AND category='delivery' AND entry_type='credit' AND status!='cancelled' AND deleted_at IS NULL LIMIT 1`).bind(delivery.id).first();
  if(exists)return;
  const current=await c.env.DB.prepare(`SELECT ${deliveryFields()} FROM deliveries WHERE id=?`).bind(delivery.id).first<Row>();
  const cancelled=String(current?.status||'')==='cancelled';
  const gross=cancelled
    ? Math.max(0,Number(current?.driver_gross_cents||0))
    : Math.max(0,Number(current?.driver_gross_cents||current?.driver_earnings_cents||0)||Math.max(0,Number(current?.charge_cents||0)-Number(current?.cooperative_fee_cents||0)));
  if(gross<=0)return;
  const taxable=current?.delivery_type==='establishment'||(current?.delivery_type==='base'&&taxableBasePayment(current?.payment_method));
  const direct=current?.delivery_type==='base'&&baseDirectReceivedPayment(current?.payment_method);
  const receivable=current?.delivery_type==='establishment'||(current?.delivery_type==='base'&&baseReceivablePayment(current?.payment_method));
  // Cartão, vale-refeição e vale-alimentação da Base servem apenas para informar
  // como cobrar o produto/refeição. Não são produção do cooperado.
  if(!direct&&!receivable){
    await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,String(current?.assigned_driver_id||''));
    return;
  }
  const entryStatus=previouslySettled?'paid':receivable?'open':'paid',settled=entryStatus==='paid'?gross:0;
  let inss=0,sest=0;
  if(taxable){
    const coop=await c.env.DB.prepare(`SELECT inss_percent,sest_senat_percent FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>();
    inss=Math.round(gross*Number(coop?.inss_percent||0)/100);
    sest=Math.round(gross*Number(coop?.sest_senat_percent||0)/100);
  }
  const statements:D1PreparedStatement[]=[c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'credit','delivery',?,?,?,date(COALESCE(?,CURRENT_TIMESTAMP),'-3 hours'),?,?)`).bind(id(),auth.cooperativeId,current?.assigned_driver_id,current?.establishment_id,current?.id,`${cancelled?'Deslocamento por cancelamento':'Entrega'} ${current?.display_code}${direct?' • recebido diretamente pelo cooperado':''}`,gross,settled,current?.delivered_at||current?.cancelled_at||current?.updated_at,entryStatus,auth.id)];
  if(inss)statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'debit','INSS','INSS sobre entrega',?,?,date(COALESCE(?,CURRENT_TIMESTAMP),'-3 hours'),?,?)`).bind(id(),auth.cooperativeId,current?.assigned_driver_id,current?.establishment_id,current?.id,inss,previouslySettled?inss:0,current?.delivered_at||current?.cancelled_at||current?.updated_at,previouslySettled?'paid':'open',auth.id));
  if(sest)statements.push(c.env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status,created_by) VALUES (?,?,?,?,?,'debit','SEST/SENAT','SEST/SENAT sobre entrega',?,?,date(COALESCE(?,CURRENT_TIMESTAMP),'-3 hours'),?,?)`).bind(id(),auth.cooperativeId,current?.assigned_driver_id,current?.establishment_id,current?.id,sest,previouslySettled?sest:0,current?.delivered_at||current?.cancelled_at||current?.updated_at,previouslySettled?'paid':'open',auth.id));
  await c.env.DB.batch(statements);
  await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,String(current?.assigned_driver_id));
}

// Mapa operacional da Base: cooperados online, escalados, em fila ou com entrega ativa nesta Base.
platformV16Routes.get('/v16/base/live-map',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']),baseId=cleanText(c.req.query('base_id'),100);
  await processScheduledDeliveries(c.env,50);
  if(!baseId)return c.json({ok:false,error:'Selecione uma Base.'},400);
  const base=await baseFor(c,auth,baseId);
  const rows=await c.env.DB.prepare(`WITH queue_here AS (
      SELECT q.id,q.driver_id,q.arrived_at,q.queue_order,
        ROW_NUMBER() OVER(ORDER BY CASE WHEN q.queue_order>0 THEN q.queue_order ELSE 2147483647 END,datetime(q.arrived_at),q.id) queue_position
      FROM waiting_queue q
      WHERE q.cooperative_id=? AND q.base_id=? AND q.establishment_id IS NULL AND q.status='waiting'
    ), driver_state AS (
      SELECT d.id,d.name,d.phone,d.vehicle_model,d.vehicle_plate,d.current_lat,d.current_lng,d.location_accuracy,d.location_updated_at,d.last_seen_at,
        CASE WHEN d.online=1 AND datetime(d.last_seen_at)>=datetime('now','-10 minutes') THEN 1 ELSE 0 END online,
        q.id queue_id,q.arrived_at,q.queue_order,q.queue_position,
        CASE WHEN EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.base_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=date('now','-3 hours')) THEN 1 ELSE 0 END scheduled_here,
        (SELECT COUNT(*) FROM deliveries x WHERE x.assigned_driver_id=d.id AND x.base_id=? AND x.deleted_at IS NULL AND x.status NOT IN ('delivered','cancelled')) active_delivery_count
      FROM drivers d LEFT JOIN queue_here q ON q.driver_id=d.id
      WHERE d.cooperative_id=? AND d.status='active' AND d.deleted_at IS NULL
    )
    SELECT * FROM driver_state
    WHERE online=1 OR queue_id IS NOT NULL OR scheduled_here=1 OR active_delivery_count>0
    ORDER BY CASE WHEN queue_position IS NULL THEN 1 ELSE 0 END,queue_position,online DESC,name COLLATE NOCASE`)
    .bind(auth.cooperativeId,baseId,baseId,baseId,auth.cooperativeId).all<Row>();
  return c.json({ok:true,base:{id:base.id,name:base.name,address:base.address,latitude:base.latitude,longitude:base.longitude,checkin_radius_meters:base.checkin_radius_meters},items:rows.results});
});

// Formulário completo da Base: clientes, endereços anteriores, serviços, cooperados e atendentes.
platformV16Routes.get('/v16/base/delivery-form-data',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  await processScheduledDeliveries(c.env,50);
  const baseId=cleanText(c.req.query('base_id'),100);
  if(baseId)await baseFor(c,auth,baseId);
  const customers=await c.env.DB.prepare(`SELECT c.id,c.name,c.phone,c.email,
      COALESCE((SELECT SUM(CASE WHEN t.entry_type='credit' THEN t.amount_cents ELSE -t.amount_cents END) FROM customer_wallet_transactions t JOIN customer_wallets w ON w.id=t.wallet_id WHERE w.customer_id=c.id AND t.cooperative_id=? AND t.status='confirmed'),0) balance_cents,
      (SELECT a.address FROM customer_addresses a WHERE a.customer_id=c.id ORDER BY a.created_at DESC LIMIT 1) last_address,
      (SELECT a.neighborhood FROM customer_addresses a WHERE a.customer_id=c.id ORDER BY a.created_at DESC LIMIT 1) last_neighborhood,
      (SELECT a.city FROM customer_addresses a WHERE a.customer_id=c.id ORDER BY a.created_at DESC LIMIT 1) last_city,
      (SELECT a.reference FROM customer_addresses a WHERE a.customer_id=c.id ORDER BY a.created_at DESC LIMIT 1) last_reference,
      (SELECT r.pickup_address_json FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=? AND r.pickup_address_json IS NOT NULL ORDER BY r.created_at DESC LIMIT 1) last_pickup_address_json,
      (SELECT r.delivery_address_json FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=? AND r.delivery_address_json IS NOT NULL ORDER BY r.created_at DESC LIMIT 1) last_delivery_address_json,
      (SELECT r.pickup_apartment FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=? ORDER BY r.created_at DESC LIMIT 1) last_pickup_apartment,
      (SELECT r.pickup_complement FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=? ORDER BY r.created_at DESC LIMIT 1) last_pickup_complement,
      (SELECT r.delivery_apartment FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=? ORDER BY r.created_at DESC LIMIT 1) last_delivery_apartment,
      (SELECT r.delivery_complement FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=? ORDER BY r.created_at DESC LIMIT 1) last_delivery_complement
    FROM customers c WHERE EXISTS(SELECT 1 FROM cooperative_customers cc WHERE cc.customer_id=c.id AND cc.cooperative_id=? AND cc.status='active')
      OR EXISTS(SELECT 1 FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=?) ORDER BY c.name COLLATE NOCASE`).bind(auth.cooperativeId,auth.cooperativeId,auth.cooperativeId,auth.cooperativeId,auth.cooperativeId,auth.cooperativeId,auth.cooperativeId,auth.cooperativeId,auth.cooperativeId).all<Row>();
  const services=await c.env.DB.prepare(`SELECT * FROM services WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL AND (?='' OR base_id IS NULL OR base_id=?) ORDER BY name`).bind(auth.cooperativeId,baseId,baseId).all<Row>();
  const drivers=await c.env.DB.prepare(`SELECT d.id,
      CASE WHEN q.id IS NOT NULL THEN
        CAST((SELECT COUNT(*) FROM waiting_queue q2 WHERE q2.cooperative_id=d.cooperative_id AND q2.base_id=? AND q2.establishment_id IS NULL AND q2.status='waiting'
          AND (CASE WHEN q2.queue_order>0 THEN q2.queue_order ELSE 2147483647 END < CASE WHEN q.queue_order>0 THEN q.queue_order ELSE 2147483647 END
            OR (q2.queue_order=q.queue_order AND datetime(q2.arrived_at)<=datetime(q.arrived_at)))) AS TEXT)||'º NA FILA — '||d.name
        ELSE d.name END name,
      d.name real_name,d.phone,d.online,d.last_seen_at,d.current_lat,d.current_lng,d.status,q.id queue_id,q.queue_order,q.arrived_at
    FROM drivers d LEFT JOIN waiting_queue q ON q.driver_id=d.id AND q.cooperative_id=d.cooperative_id AND q.base_id=? AND q.establishment_id IS NULL AND q.status='waiting'
    WHERE d.cooperative_id=? AND d.status='active' AND COALESCE(d.on_leave,0)=0 AND d.deleted_at IS NULL
    ORDER BY CASE WHEN q.id IS NULL THEN 1 ELSE 0 END,CASE WHEN q.queue_order>0 THEN q.queue_order ELSE 2147483647 END,datetime(q.arrived_at),d.name COLLATE NOCASE`)
    .bind(baseId,baseId,auth.cooperativeId).all<Row>();
  const attendants=baseId?await c.env.DB.prepare(`SELECT u.id,u.name,u.email,u.username,u.status FROM base_attendants a JOIN users u ON u.id=a.user_id WHERE a.cooperative_id=? AND a.base_id=? AND a.active=1 AND u.deleted_at IS NULL ORDER BY u.name`).bind(auth.cooperativeId,baseId).all<Row>():{results:[]};
  return c.json({ok:true,customers:customers.results,services:services.results,drivers:drivers.results,attendants:attendants.results,current_attendant:{id:auth.id,name:auth.name}});
});

platformV16Routes.get('/v16/base/deliveries/:id/edit-data',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']),delivery=await deliveryFor(c,auth,c.req.param('id'));
  const serviceRows=await c.env.DB.prepare(`SELECT service_id FROM delivery_services WHERE delivery_id=?`).bind(delivery.id).all<Row>();
  return c.json({ok:true,item:delivery,service_ids:(serviceRows.results||[]).map(x=>x.service_id)});
});

platformV16Routes.post('/v16/base/quote',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']),body=await bodyJson<Row>(c),quote=await quoteBase(c,auth,body);
  return c.json({ok:true,quote:{...quote.breakdown,distance_meters:quote.route.distance_meters,duration_seconds:quote.route.duration_seconds,route_geometry:quote.route.geometry,pickup_address:quote.pickup.formatted_address,delivery_address:quote.delivery.formatted_address,free_wait_seconds:Number(quote.services.waitService?.free_wait_seconds??quote.base.pickup_free_seconds??900),wait_cents_per_15m:Number(quote.services.waitService?.wait_cents_per_15m??quote.base.wait_cents_per_15m??500)}});
});

platformV16Routes.post('/v16/base/orders',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']),body=await bodyJson<Row>(c),quote=await quoteBase(c,auth,body),customer=await customerData(c,auth,body);
  const base=quote.base;if(!base.virtual_establishment_id)throw new Error('A Base não possui estabelecimento virtual configurado.');
  const manualCharge=body.charge_value!==undefined&&body.charge_value!==''?Math.max(0,toCents(body.charge_value)):null;
  const baseCharge=manualCharge!==null?manualCharge:Number(quote.breakdown.base_charge_cents||0),payment=normalizePayment(body.payment_method),amountToCollect=0;
  if(baseCharge<=0)throw new Error('Informe um valor maior que zero.');
  if(payment==='credit'){
    if(!customer.customerId)throw new Error('Crédito pré-pago exige cliente cadastrado.');
    const available=await cooperativeCreditBalance(c.env,customer.customerId,auth.cooperativeId!);
    if(available<baseCharge)throw new Error(`Crédito insuficiente. Saldo disponível: ${centsLabel(available)}.`);
  }

  const scheduledFor=scheduledDateTime(body),mode=dispatchMode(body.dispatch_mode);
  const requestedDriverId=mode==='manual'?nullableText(body.driver_id,100):null;
  let driver:Row|null=null;
  if(requestedDriverId){driver=await c.env.DB.prepare(`SELECT id,name FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND COALESCE(on_leave,0)=0 AND deleted_at IS NULL`).bind(requestedDriverId,auth.cooperativeId).first<Row>();if(!driver)throw new Error('Cooperado inválido, inativo ou afastado.');}
  const assignedDriverId=!scheduledFor&&mode==='manual'?requestedDriverId:null;
  const plannedDriverId=scheduledFor&&mode==='manual'?requestedDriverId:null;
  const displayCode=await nextCode(c,auth.cooperativeId!),deliveryId=id(),trackingToken=randomToken(24),status=assignedDriverId?'assigned':'new',confirmationRequired=!yes(body.finish_without_code_authorized),confirmationCode=confirmationRequired?await uniqueConfirmationCode(c,customer.phone||nullableText(body.recipient_phone,50)):null;
  const amounts=await valuesFor(c,auth.cooperativeId!,baseCharge,Number(base.cooperative_fee_percent||0),payment);
  const waitFree=Number(quote.services.waitService?.free_wait_seconds??base.pickup_free_seconds??900),waitRate=Number(quote.services.waitService?.wait_cents_per_15m??base.wait_cents_per_15m??500);
  let paid=cleanText(body.payment_status||'pending',30)==='paid'?baseCharge:0;if(payment==='credit')paid=0;
  const pickupJson=addressJson(quote.pickup),deliveryJson=addressJson(quote.delivery);
  const pickupComplement=storedComplement(body.pickup_block,body.pickup_complement)||nullableText(quote.pickup.place_name,300);
  const destinationComplement=storedComplement(body.delivery_block,body.delivery_complement)||nullableText(quote.delivery.place_name,300);
  const initialSource=scheduledFor?`scheduled_${mode}`:(assignedDriverId?'base_manual_creation':mode==='automatic'?'auto_dispatch_requested':null);
  await c.env.DB.prepare(`INSERT INTO deliveries(
    id,cooperative_id,establishment_id,source,customer_id,customer_mode,customer_name,customer_phone,pickup_contact_name,pickup_phone,
    pickup_address,pickup_neighborhood,pickup_apartment,pickup_complement,pickup_lat,pickup_lng,pickup_address_json,pickup_place_id,
    recipient_name,recipient_phone,delivery_address,delivery_neighborhood,delivery_apartment,delivery_complement,delivery_lat,delivery_lng,delivery_address_json,delivery_place_id,
    item_description,amount_to_collect_cents,status,charge_cents,base_charge_cents,route_charge_cents,displacement_distance_meters,displacement_cents,return_required,return_cents,
    service_charge_cents,services_cents,wait_charge_cents,cancellation_charge_cents,paid_cents,outstanding_cents,driver_earnings_cents,driver_gross_cents,driver_net_cents,cooperative_fee_cents,
    payment_method,payment_status,cash_payment_location,notes,tracking_token,created_by,launched_by_user_id,launched_by_name,display_code,delivery_type,base_id,
    assigned_driver_id,assigned_by_role,assigned_by_user_id,assignment_source,distance_meters,duration_seconds,route_geometry,addresses_confirmed,wait_free_seconds,wait_rate_cents_per_15m,
    finish_without_code_authorized,finish_without_code_authorized_by,finish_without_code_authorized_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    deliveryId,auth.cooperativeId,base.virtual_establishment_id,'base_counter_v16',customer.customerId,customer.mode,customer.name,customer.phone,
    nullableText(body.pickup_contact_name,150),nullableText(body.pickup_phone,50),quote.pickup.formatted_address,quote.pickup.neighborhood||null,nullableText(body.pickup_apartment,100),pickupComplement,quote.pickup.lat,quote.pickup.lng,pickupJson,quote.pickup.provider_id||null,
    nullableText(body.recipient_name,150),nullableText(body.recipient_phone,50),quote.delivery.formatted_address,quote.delivery.neighborhood||null,nullableText(body.delivery_apartment,100),destinationComplement,quote.delivery.lat,quote.delivery.lng,deliveryJson,quote.delivery.provider_id||null,
    nullableText(body.item_description,500),amountToCollect,status,baseCharge,baseCharge,quote.breakdown.route_charge_cents,quote.breakdown.displacement_distance_meters,quote.breakdown.displacement_cents,quote.breakdown.return_required,quote.breakdown.return_cents,
    quote.breakdown.service_charge_cents,quote.breakdown.service_charge_cents,0,0,paid,Math.max(0,baseCharge-paid),amounts.gross,amounts.gross,amounts.net,amounts.fee,payment,payment==='credit'?'pending':cleanText(body.payment_status||'pending',30),payment==='dinheiro'?nullableText(body.cash_payment_location,20):null,nullableText(body.notes,1500),trackingToken,auth.id,auth.id,auth.name,displayCode,'base',base.id,
    assignedDriverId,assignedDriverId?auth.role:null,assignedDriverId?auth.id:null,initialSource,quote.route.distance_meters,quote.route.duration_seconds,JSON.stringify(quote.route.geometry),1,waitFree,waitRate,
    yes(body.finish_without_code_authorized)?1:0,yes(body.finish_without_code_authorized)?auth.id:null,yes(body.finish_without_code_authorized)?new Date().toISOString():null
  ).run();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET confirmation_required=?,confirmation_code=? WHERE id=?`).bind(confirmationRequired?1:0,confirmationCode,deliveryId),
    c.env.DB.prepare(`INSERT INTO delivery_schedules(delivery_id,scheduled_for,dispatch_mode,planned_driver_id,dispatch_processed_at,updated_at)
      VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(delivery_id) DO UPDATE SET scheduled_for=excluded.scheduled_for,dispatch_mode=excluded.dispatch_mode,planned_driver_id=excluded.planned_driver_id,dispatch_processed_at=excluded.dispatch_processed_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(deliveryId,scheduledFor,mode,plannedDriverId,!scheduledFor&&mode!=='automatic'?new Date().toISOString():null)
  ]);
  if(quote.services.items.length)await c.env.DB.batch(quote.services.items.map(service=>c.env.DB.prepare(`INSERT INTO delivery_services(delivery_id,service_id,service_name,add_cents) VALUES (?,?,?,?)`).bind(deliveryId,service.id,service.name,service.add_cents)));
  const requestId=id();
  const scheduleText=scheduledFor?` Agendada para ${new Date(scheduledFor).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}.`:'';
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO customer_requests(id,cooperative_id,customer_id,customer_name,customer_phone,pickup_address,pickup_neighborhood,pickup_contact_name,pickup_phone,delivery_address,delivery_neighborhood,recipient_name,recipient_phone,item_description,amount_to_collect_cents,payment_method,quoted_cents,notes,status,delivery_id,base_id,services_cents,distance_meters,duration_seconds,credit_used_cents,pickup_address_json,delivery_address_json,pickup_apartment,pickup_complement,delivery_apartment,delivery_complement,cash_payment_location) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'converted',?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(requestId,auth.cooperativeId,customer.customerId,customer.name,customer.phone,quote.pickup.formatted_address,quote.pickup.neighborhood||null,nullableText(body.pickup_contact_name,150),nullableText(body.pickup_phone,50),quote.delivery.formatted_address,quote.delivery.neighborhood||null,nullableText(body.recipient_name,150),nullableText(body.recipient_phone,50),nullableText(body.item_description,500),amountToCollect,payment,baseCharge,nullableText(body.notes,1500),deliveryId,base.id,quote.breakdown.service_charge_cents,quote.route.distance_meters,quote.route.duration_seconds,0,pickupJson,deliveryJson,nullableText(body.pickup_apartment,100),pickupComplement,nullableText(body.delivery_apartment,100),destinationComplement,payment==='dinheiro'?nullableText(body.cash_payment_location,20):null),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,new_status,notes,changed_by) VALUES (?,?,?,?,?,?)`).bind(id(),deliveryId,auth.cooperativeId,status,`Entrega lançada por ${auth.name}.${scheduleText} Atribuição: ${mode==='automatic'?'automática':mode==='manual'?'manual':'não definida'}.`,auth.id)
  ]);
  await c.env.DB.prepare(`UPDATE customer_requests SET confirmation_code=? WHERE id=?`).bind(confirmationCode,requestId).run();
  if(customer.customerId&&customer.mode==='registered')await c.env.DB.prepare(`INSERT OR IGNORE INTO cooperative_customers(cooperative_id,customer_id,status,created_by) VALUES (?,?,'active',?)`).bind(auth.cooperativeId,customer.customerId,auth.id).run();
  if(assignedDriverId)await c.env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND base_id=? AND establishment_id IS NULL AND status='waiting'`).bind(deliveryId,assignedDriverId,base.id).run();
  if(payment==='credit'){
    await reconcileDeliveryCredit(c.env,{deliveryId,cooperativeId:auth.cooperativeId!,customerId:customer.customerId,desiredCents:baseCharge,displayCode,reason:`Crédito utilizado na entrega lançada por ${auth.name}`,requestId});
    await c.env.DB.prepare(`UPDATE deliveries SET paid_cents=?,outstanding_cents=0,payment_status='paid' WHERE id=?`).bind(baseCharge,deliveryId).run();
  }
  let finalStatus=status,autoDispatch=null as any;
  if(!scheduledFor&&mode==='automatic'){autoDispatch=await dispatchNextDriver(c.env,deliveryId,auth.id,true);if(autoDispatch?.assigned){finalStatus='assigned';await c.env.DB.prepare(`UPDATE delivery_schedules SET dispatch_processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`).bind(deliveryId).run();}}
  c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,base.virtual_establishment_id,'delivery.created',{id:deliveryId,display_code:displayCode,status:finalStatus,delivery_type:'base',base_id:base.id,launched_by_name:auth.name,scheduled_for:scheduledFor,dispatch_mode:mode}));
  return c.json({ok:true,item:{id:deliveryId,display_code:displayCode,tracking_token:trackingToken,tracking_url:`${c.env.APP_URL.replace(/\/$/,'')}/r/${trackingToken}`,status:finalStatus,charge_cents:baseCharge,confirmation_code:confirmationCode,launched_by_name:auth.name,scheduled_for:scheduledFor,dispatch_mode:mode,planned_driver_id:plannedDriverId,planned_driver_name:driver?.name||null,auto_dispatch:autoDispatch}},201);
});

// Edição rápida completa, incluindo cliente, status, cooperado, valor, pagamento e endereços.
platformV16Routes.put('/v16/base/deliveries/:id',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']),before=await deliveryFor(c,auth,c.req.param('id')),body=await bodyJson<Row>(c);
  if(before.delivery_type!=='base')throw new Error('Esta função é exclusiva da Base.');
  const base=await baseFor(c,auth,before.base_id),customer=await customerData(c,auth,body);
  const pickupCandidate=await candidateFrom(body,'pickup_confirmation_token',c),deliveryCandidate=await candidateFrom(body,'delivery_confirmation_token',c);
  let pickupAddress=before.pickup_address,pickupLat=before.pickup_lat,pickupLng=before.pickup_lng,pickupJson=before.pickup_address_json,pickupPlace=before.pickup_place_id,pickupNeighborhood=before.pickup_neighborhood;
  let destinationAddress=before.delivery_address,destinationLat=before.delivery_lat,destinationLng=before.delivery_lng,destinationJson=before.delivery_address_json,destinationPlace=before.delivery_place_id,destinationNeighborhood=before.delivery_neighborhood;
  if(pickupCandidate){pickupAddress=pickupCandidate.formatted_address;pickupLat=pickupCandidate.lat;pickupLng=pickupCandidate.lng;pickupJson=addressJson(pickupCandidate);pickupPlace=pickupCandidate.provider_id;pickupNeighborhood=pickupCandidate.neighborhood;}
  if(deliveryCandidate){destinationAddress=deliveryCandidate.formatted_address;destinationLat=deliveryCandidate.lat;destinationLng=deliveryCandidate.lng;destinationJson=addressJson(deliveryCandidate);destinationPlace=deliveryCandidate.provider_id;destinationNeighborhood=deliveryCandidate.neighborhood;}
  let distance=Number(before.distance_meters||0),duration=Number(before.duration_seconds||0),geometry=before.route_geometry;
  if(pickupCandidate||deliveryCandidate){
    const route=await routeBetween(c.env,[{lat:Number(pickupLat),lng:Number(pickupLng)},{lat:Number(destinationLat),lng:Number(destinationLng)}]);
    if(!route)throw new Error('Não foi possível recalcular a nova rota.');distance=route.distance_meters;duration=route.duration_seconds;geometry=JSON.stringify(route.geometry);
  }
  const driverField=Object.prototype.hasOwnProperty.call(body,'driver_id'),driverId=driverField?nullableText(body.driver_id,100):before.assigned_driver_id;let driverName=before.driver_name;
  if(driverId){const driver=await c.env.DB.prepare(`SELECT id,name FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND deleted_at IS NULL`).bind(driverId,auth.cooperativeId).first<Row>();if(!driver)throw new Error('Cooperado inválido.');driverName=driver.name;}else driverName=null;
  const requestedStatus=cleanText(body.status||before.status,30),status=before.status==='delivered'?'delivered':requestedStatus;if(!validStatus(status))throw new Error('Status inválido.');if(status==='delivered'&&!driverId)throw new Error('Selecione o cooperado antes de concluir.');
  const serviceData=await selectedServices(c,auth.cooperativeId!,base.id,body.service_ids);
  const automaticRoute=routePrice(distance,Number(base.rate_per_km_cents||0),Number(base.minimum_fee_cents||0),0),routeCharge=body.route_charge_value!==undefined&&body.route_charge_value!==''?toCents(body.route_charge_value):Number(before.route_charge_cents||automaticRoute);
  const manualBase=body.charge_value!==undefined&&body.charge_value!==''?Math.max(0,toCents(body.charge_value)):Number(before.base_charge_cents||before.charge_cents||0);
  const serviceCharge=Object.prototype.hasOwnProperty.call(body,'service_ids')?serviceData.total:Number(before.service_charge_cents||before.services_cents||0),returnRequired=yes(body.return_required),returnCents=returnRequired?Math.round(routeCharge*Number(base.return_percent||50)/100):0;
  const componentTotal=routeCharge+Number(before.displacement_cents||0)+returnCents+serviceCharge;
  const baseCharge=yes(body.recalculate_charge)?componentTotal:manualBase;
  const waitCharge=Number(before.wait_charge_cents||0),cancelled=status==='cancelled',cancellationCharge=cancelled&&yes(body.cancel_after_arrival)?Math.round(Number(before.displacement_cents||0)*Number(base.cancellation_displacement_multiplier||2)):0,total=cancelled?(yes(body.cancel_after_arrival)?cancellationCharge+waitCharge:0):baseCharge+waitCharge;
  const payment=normalizePayment(body.payment_method||before.payment_method||'pix'),finishWithoutCode=yes(body.finish_without_code_authorized),amountToCollect=0;
  let paid=body.paid_value!==undefined&&body.paid_value!==''?Math.max(0,toCents(body.paid_value)):Number(before.paid_cents||0);if(cleanText(body.payment_status||before.payment_status,30)==='paid')paid=total;if(cleanText(body.payment_status||before.payment_status,30)==='pending'&&body.paid_value===undefined)paid=0;if(cancelled&&payment!=='credit')paid=Math.min(paid,total);
  let creditUsed=Number(before.credit_used_cents||0);
  if(before.customer_id&&before.customer_id!==customer.customerId&&creditUsed>0)await reconcileDeliveryCredit(c.env,{deliveryId:before.id,cooperativeId:auth.cooperativeId!,customerId:before.customer_id,desiredCents:0,displayCode:before.display_code,reason:`Crédito devolvido porque ${auth.name} alterou o cliente.`});
  if(payment==='credit'){
    if(!customer.customerId)throw new Error('Crédito pré-pago exige cliente cadastrado.');
    const deliveryCredit={...before,customer_id:customer.customerId,credit_used_cents:before.customer_id===customer.customerId?creditUsed:0};
    const credit=await reconcileCreditFlexible(c,deliveryCredit,total,`Valor da entrega alterado por ${auth.name}.`);creditUsed=credit.applied;paid=credit.applied;
  }else if(customer.customerId&&creditUsed>0){await reconcileDeliveryCredit(c.env,{deliveryId:before.id,cooperativeId:auth.cooperativeId!,customerId:customer.customerId,desiredCents:0,displayCode:before.display_code,reason:`Pagamento alterado por ${auth.name}.`});creditUsed=0;}
  const outstanding=Math.max(0,total-paid);
  // Entrega cancelada só gera ganho quando houve deslocamento cobrado.
  // Espera, serviço, rota e valor normal da entrega não entram no ganho após cancelamento.
  const financialCharge=cancelled?cancellationCharge:total;
  const amount=await valuesFor(c,auth.cooperativeId!,financialCharge,Number(base.cooperative_fee_percent||0),payment);
  const oldStatus=before.status,nextStatus=status==='new'&&driverId?'assigned':status;
  await c.env.DB.prepare(`UPDATE deliveries SET customer_id=?,customer_mode=?,customer_name=?,customer_phone=?,pickup_contact_name=?,pickup_phone=?,pickup_address=?,pickup_neighborhood=?,pickup_apartment=?,pickup_complement=?,pickup_lat=?,pickup_lng=?,pickup_address_json=?,pickup_place_id=?,recipient_name=?,recipient_phone=?,delivery_address=?,delivery_neighborhood=?,delivery_apartment=?,delivery_complement=?,delivery_lat=?,delivery_lng=?,delivery_address_json=?,delivery_place_id=?,item_description=?,amount_to_collect_cents=?,notes=?,assigned_driver_id=?,status=?,charge_cents=?,base_charge_cents=?,route_charge_cents=?,return_required=?,return_cents=?,service_charge_cents=?,services_cents=?,cancellation_charge_cents=?,paid_cents=?,outstanding_cents=?,credit_used_cents=?,driver_earnings_cents=?,driver_gross_cents=?,driver_net_cents=?,cooperative_fee_cents=?,payment_method=?,payment_status=?,cash_payment_location=?,distance_meters=?,duration_seconds=?,route_geometry=?,addresses_confirmed=?,finish_without_code_authorized=?,finish_without_code_authorized_by=CASE WHEN ?=1 THEN ? ELSE NULL END,finish_without_code_authorized_at=CASE WHEN ?=1 THEN COALESCE(finish_without_code_authorized_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP,cancelled_at=CASE WHEN ?='cancelled' THEN CURRENT_TIMESTAMP ELSE cancelled_at END,delivered_at=CASE WHEN ?='delivered' THEN COALESCE(delivered_at,CURRENT_TIMESTAMP) ELSE delivered_at END,completion_source=CASE WHEN ?='delivered' THEN 'base' ELSE completion_source END WHERE id=?`).bind(
    customer.customerId,customer.mode,customer.name,customer.phone,nullableText(body.pickup_contact_name,150),nullableText(body.pickup_phone,50),pickupAddress,pickupNeighborhood,nullableText(body.pickup_apartment,100),storedComplement(body.pickup_block,body.pickup_complement),pickupLat,pickupLng,pickupJson,pickupPlace,nullableText(body.recipient_name,150),nullableText(body.recipient_phone,50),destinationAddress,destinationNeighborhood,nullableText(body.delivery_apartment,100),storedComplement(body.delivery_block,body.delivery_complement),destinationLat,destinationLng,destinationJson,destinationPlace,nullableText(body.item_description,500),amountToCollect,nullableText(body.notes,1500),driverId,nextStatus,total,baseCharge,routeCharge,returnRequired?1:0,returnCents,serviceCharge,serviceCharge,cancellationCharge,paid,outstanding,creditUsed,amount.gross,amount.gross,amount.net,amount.fee,payment,outstanding===0?'paid':'pending',payment==='dinheiro'?nullableText(body.cash_payment_location,20):null,distance,duration,geometry,pickupJson&&destinationJson?1:0,finishWithoutCode?1:0,finishWithoutCode?1:0,auth.id,finishWithoutCode?1:0,nextStatus,nextStatus,nextStatus,before.id
  ).run();
  const confirmationCode=finishWithoutCode?null:(before.confirmation_code||await uniqueConfirmationCode(c,customer.phone||nullableText(body.recipient_phone,50)));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET confirmation_required=?,confirmation_code=? WHERE id=?`).bind(finishWithoutCode?0:1,confirmationCode,before.id),
    c.env.DB.prepare(`UPDATE customer_requests SET confirmation_code=? WHERE delivery_id=?`).bind(confirmationCode,before.id)
  ]);
  const receivedByName=nullableText(body.received_by_name,150);
  if(nextStatus==='delivered'){
    await c.env.DB.prepare(`UPDATE deliveries SET received_by_name=?,received_by_reported_at=CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE received_by_reported_at END WHERE id=?`)
      .bind(receivedByName,receivedByName,before.id).run();
  }
  if(Object.prototype.hasOwnProperty.call(body,'service_ids')){await c.env.DB.prepare(`DELETE FROM delivery_services WHERE delivery_id=?`).bind(before.id).run();if(serviceData.items.length)await c.env.DB.batch(serviceData.items.map(service=>c.env.DB.prepare(`INSERT INTO delivery_services(delivery_id,service_id,service_name,add_cents) VALUES (?,?,?,?)`).bind(before.id,service.id,service.name,service.add_cents)));}
  await c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),before.id,auth.cooperativeId,oldStatus,nextStatus,`Edição rápida feita por ${auth.name}. Cliente: ${customer.name}; valor: ${centsLabel(total)}; pago: ${centsLabel(paid)}; restante: ${centsLabel(outstanding)}.`,auth.id).run();
  if(nextStatus==='delivered'){const active=(await waitSnapshot(c,before.id)).active;if(active)await closeWait(c,auth,{...before,base_charge_cents:baseCharge,charge_cents:total,payment_method:payment,customer_id:customer.customerId,paid_cents:paid,credit_used_cents:creditUsed},active);await finishFinancial(c,auth,{...before,assigned_driver_id:driverId},before.status==='delivered');}
  if(nextStatus==='cancelled'){
    // Cancela qualquer lançamento anterior da entrega.
    await c.env.DB.prepare(`UPDATE financial_entries SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE delivery_id=? AND deleted_at IS NULL`).bind(before.id).run();
    // Somente cancelamento com deslocamento confirmado gera crédito ao cooperado.
    if(driverId&&cancellationCharge>0){
      await finishFinancial(c,auth,{...before,assigned_driver_id:driverId});
    }else if(driverId){
      await reconcileDriverFinancialBalance(c.env,auth.cooperativeId!,String(driverId));
    }
  }
  return c.json({ok:true,item:{...before,customer_id:customer.customerId,customer_mode:customer.mode,customer_name:customer.name,customer_phone:customer.phone,driver_name:driverName,assigned_driver_id:driverId,status:nextStatus,charge_cents:total,base_charge_cents:baseCharge,route_charge_cents:routeCharge,return_required:returnRequired?1:0,return_cents:returnCents,service_charge_cents:serviceCharge,services_cents:serviceCharge,cancellation_charge_cents:cancellationCharge,paid_cents:paid,outstanding_cents:outstanding,credit_used_cents:creditUsed,payment_method:payment,payment_status:outstanding===0?'paid':'pending',amount_to_collect_cents:amountToCollect,pickup_address:pickupAddress,pickup_apartment:nullableText(body.pickup_apartment,100),pickup_complement:storedComplement(body.pickup_block,body.pickup_complement),delivery_address:destinationAddress,delivery_apartment:nullableText(body.delivery_apartment,100),delivery_complement:storedComplement(body.delivery_block,body.delivery_complement),distance_meters:distance,duration_seconds:duration,finish_without_code_authorized:finishWithoutCode?1:0,confirmation_code:confirmationCode,received_by_name:nextStatus==='delivered'?receivedByName:before.received_by_name,launched_by_name:before.launched_by_name||before.created_by_name}});
});

// Configuração da Base e serviços.
platformV16Routes.get('/v16/base/:id/pricing',async c=>{const auth=tenant(c,['cooperative_admin','dispatcher']),base=await baseFor(c,auth,c.req.param('id'));const services=await c.env.DB.prepare(`SELECT * FROM services WHERE cooperative_id=? AND deleted_at IS NULL AND (base_id IS NULL OR base_id=?) ORDER BY name`).bind(auth.cooperativeId,base.id).all<Row>();return c.json({ok:true,base,services:services.results});});
platformV16Routes.put('/v16/base/:id/pricing',async c=>{const auth=tenant(c,['cooperative_admin']);const base=await baseFor(c,auth,c.req.param('id')),body=await bodyJson<Row>(c),fuelKm=Math.max(.1,Number(body.fuel_km_per_liter||35)),fuelPrice=Math.max(0,toCents(body.fuel_price));await c.env.DB.batch([c.env.DB.prepare(`UPDATE bases SET minimum_fee_cents=?,rate_per_km_cents=?,fuel_km_per_liter=?,fuel_price_cents=?,displacement_rate_cents_per_km=?,return_percent=?,cancellation_displacement_multiplier=?,pickup_free_seconds=?,delivery_free_seconds=?,wait_cents_per_15m=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(Math.max(0,toCents(body.minimum_fee)),Math.max(0,toCents(body.rate_per_km)),fuelKm,fuelPrice,Math.max(0,toCents(body.displacement_rate_per_km)),Math.max(0,Number(body.return_percent||50)),Math.max(0,Number(body.cancellation_displacement_multiplier||2)),Math.max(0,Math.round(Number(body.pickup_free_minutes||0)*60)),Math.max(0,Math.round(Number(body.delivery_free_minutes||0)*60)),Math.max(0,toCents(body.wait_value_15m)),base.id),c.env.DB.prepare(`UPDATE cooperatives SET fuel_km_per_liter=?,fuel_price_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(fuelKm,fuelPrice,auth.cooperativeId)]);return c.json({ok:true,fuel_km_per_liter:fuelKm,fuel_price_cents:fuelPrice});});
platformV16Routes.post('/v16/base/:id/services',async c=>{const auth=tenant(c,['cooperative_admin']);const base=await baseFor(c,auth,c.req.param('id')),body=await bodyJson<Row>(c),name=cleanText(body.name,150);if(!name)return c.json({ok:false,error:'Informe o nome do serviço.'},400);const serviceId=id();await c.env.DB.prepare(`INSERT INTO services(id,cooperative_id,base_id,name,description,add_cents,free_wait_seconds,wait_cents_per_15m,wait_tracking_enabled) VALUES (?,?,?,?,?,?,?,?,?)`).bind(serviceId,auth.cooperativeId,base.id,name,nullableText(body.description,500),Math.max(0,toCents(body.add_value)),Math.max(0,Math.round(Number(body.free_minutes||0)*60)),Math.max(0,toCents(body.wait_value_15m)),yes(body.wait_tracking_enabled)?1:0).run();return c.json({ok:true,id:serviceId},201);});
platformV16Routes.put('/v16/base/:baseId/services/:serviceId',async c=>{const auth=tenant(c,['cooperative_admin']);await baseFor(c,auth,c.req.param('baseId'));const body=await bodyJson<Row>(c);const result=await c.env.DB.prepare(`UPDATE services SET name=?,add_cents=?,free_wait_seconds=?,wait_cents_per_15m=?,wait_tracking_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND deleted_at IS NULL AND (base_id IS NULL OR base_id=?)`).bind(cleanText(body.name,150),Math.max(0,toCents(body.add_value)),Math.max(0,Math.round(Number(body.free_minutes||0)*60)),Math.max(0,toCents(body.wait_value_15m)),yes(body.wait_tracking_enabled)?1:0,c.req.param('serviceId'),auth.cooperativeId,c.req.param('baseId')).run();if(!result.meta.changes)return c.json({ok:false,error:'Serviço não encontrado.'},404);return c.json({ok:true});});

// Atendentes da Base.
platformV16Routes.get('/v16/base/:id/attendants',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  await baseFor(c,auth,c.req.param('id'));
  const rows=await c.env.DB.prepare(`SELECT a.id assignment_id,a.active,u.id,u.name,u.email,u.username,u.status,u.last_login_at,u.created_at
    FROM base_attendants a JOIN users u ON u.id=a.user_id
    WHERE a.cooperative_id=? AND a.base_id=? ORDER BY a.active DESC,u.name`).bind(auth.cooperativeId,c.req.param('id')).all<Row>();
  let availableUsers:Row[]=[];
  if(auth.role==='cooperative_admin'){
    const available=await c.env.DB.prepare(`SELECT u.id,u.name,u.email,u.username
      FROM users u
     WHERE u.cooperative_id=? AND u.role='dispatcher' AND u.status='active' AND u.deleted_at IS NULL
       AND NOT EXISTS(SELECT 1 FROM base_attendants a WHERE a.base_id=? AND a.user_id=u.id AND a.active=1)
     ORDER BY u.name`).bind(auth.cooperativeId,c.req.param('id')).all<Row>();
    availableUsers=available.results||[];
  }
  return c.json({ok:true,items:rows.results||[],available_users:availableUsers});
});
platformV16Routes.post('/v16/base/:id/attendants',async c=>{
  const auth=tenant(c,['cooperative_admin']);
  const base=await baseFor(c,auth,c.req.param('id')),body=await bodyJson<Row>(c);
  const existingUserId=cleanText(body.user_id,100);
  if(existingUserId){
    const user=await c.env.DB.prepare(`SELECT id FROM users WHERE id=? AND cooperative_id=? AND role='dispatcher' AND status='active' AND deleted_at IS NULL`).bind(existingUserId,auth.cooperativeId).first<Row>();
    if(!user)return c.json({ok:false,error:'O operador selecionado não está ativo ou não pertence a esta cooperativa.'},400);
    await c.env.DB.prepare(`INSERT INTO base_attendants(id,cooperative_id,base_id,user_id,active,created_by)
      VALUES (?,?,?,?,1,?) ON CONFLICT(base_id,user_id) DO UPDATE SET active=1,updated_at=CURRENT_TIMESTAMP`).bind(id(),auth.cooperativeId,base.id,user.id,auth.id).run();
    return c.json({ok:true,id:user.id,linked:true});
  }
  const name=cleanText(body.name,150),email=cleanText(body.email,200).toLowerCase(),username=nullableText(body.username,100),password=String(body.password||'');
  if(!name||!email||password.length<8)return c.json({ok:false,error:'Informe nome, e-mail e senha com pelo menos 8 caracteres.'},400);
  const hashed=await hashPassword(password),userId=id();
  try{await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO users(id,cooperative_id,name,email,username,password_hash,password_salt,role,status) VALUES (?,?,?,?,?,?,?,'dispatcher','active')`).bind(userId,auth.cooperativeId,name,email,username,hashed.hash,hashed.salt),
    c.env.DB.prepare(`INSERT INTO base_attendants(id,cooperative_id,base_id,user_id,created_by) VALUES (?,?,?,?,?)`).bind(id(),auth.cooperativeId,base.id,userId,auth.id),
  ]);}catch{return c.json({ok:false,error:'E-mail ou usuário já cadastrado.'},409);}
  return c.json({ok:true,id:userId},201);
});
platformV16Routes.put('/v16/base/:baseId/attendants/:userId',async c=>{const auth=tenant(c,['cooperative_admin']);await baseFor(c,auth,c.req.param('baseId'));const body=await bodyJson<Row>(c),active=yes(body.active);await c.env.DB.batch([c.env.DB.prepare(`UPDATE base_attendants SET active=?,updated_at=CURRENT_TIMESTAMP WHERE cooperative_id=? AND base_id=? AND user_id=?`).bind(active?1:0,auth.cooperativeId,c.req.param('baseId'),c.req.param('userId')),c.env.DB.prepare(`UPDATE users SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND role='dispatcher'`).bind(active?'active':'inactive',c.req.param('userId'),auth.cooperativeId)]);return c.json({ok:true});});

// Cronômetro do cooperado.
platformV16Routes.get('/v16/deliveries/:id/wait',async c=>{const auth=tenant(c,['cooperative_admin','dispatcher','establishment','driver']),delivery=await deliveryFor(c,auth,c.req.param('id')),snapshot=await waitSnapshot(c,delivery.id);return c.json({ok:true,delivery:{id:delivery.id,display_code:delivery.display_code,charge_cents:delivery.charge_cents,base_charge_cents:delivery.base_charge_cents,wait_charge_cents:delivery.wait_charge_cents,outstanding_cents:delivery.outstanding_cents,paid_cents:delivery.paid_cents,launched_by_name:delivery.launched_by_name||delivery.created_by_name},...snapshot});});
platformV16Routes.post('/v16/driver/deliveries/:id/arrive',async c=>{
  const auth=tenant(c,['driver']),delivery=await deliveryFor(c,auth,c.req.param('id')),body=await bodyJson<Row>(c),stage=cleanText(body.stage,20) as WaitStage;
  if(!['pickup','delivery'].includes(stage))return c.json({ok:false,error:'Etapa inválida.'},400);
  if(['delivered','cancelled'].includes(delivery.status))return c.json({ok:false,error:'Entrega encerrada.'},409);
  if(delivery.delivery_type==='establishment')return c.json({ok:false,error:'Entregas de estabelecimento não possuem cobrança de tempo de espera.'},409);
  const lat=Number(body.latitude),lng=Number(body.longitude),targetLat=stage==='pickup'?Number(delivery.pickup_lat):Number(delivery.delivery_lat),targetLng=stage==='pickup'?Number(delivery.pickup_lng):Number(delivery.delivery_lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return c.json({ok:false,error:'Ative a localização para registrar a chegada.'},400);
  if(!Number.isFinite(targetLat)||!Number.isFinite(targetLng))return c.json({ok:false,error:'O endereço desta etapa não possui localização confirmada.'},409);
  const distance=haversineMeters(lat,lng,targetLat,targetLng);
  if(distance>100)return c.json({ok:false,error:`Você precisa estar a até 100 metros do local. Distância atual: ${Math.round(distance)} m.`},409);
  await c.env.DB.prepare(`UPDATE drivers SET current_lat=?,current_lng=?,location_accuracy=?,location_updated_at=CURRENT_TIMESTAMP,last_seen_at=CURRENT_TIMESTAMP,online=1 WHERE id=? AND cooperative_id=?`).bind(lat,lng,Number(body.accuracy)||null,auth.driverId,auth.cooperativeId).run();
  const snapshot=await waitSnapshot(c,delivery.id);
  if(snapshot.active){
    if(snapshot.active.stage===stage)return c.json({ok:true,already_active:true,active:snapshot.active});
    return c.json({ok:false,error:'Finalize o cronômetro atual antes de iniciar outra etapa.'},409);
  }
  let free=300,rate=Number(delivery.wait_cents_per_15m??500);
  if(stage==='pickup'){
    const service=await c.env.DB.prepare(`SELECT s.wait_cents_per_15m FROM delivery_services ds JOIN services s ON s.id=ds.service_id WHERE ds.delivery_id=? AND s.active=1 AND s.deleted_at IS NULL ORDER BY s.name LIMIT 1`).bind(delivery.id).first<Row>();
    if(service){free=900;rate=Number(service.wait_cents_per_15m??rate);}
  }
  const sessionId=id(),nextStatus=stage==='pickup'?'at_pickup':'in_route',message=stage==='pickup'?`📍 ${auth.name} chegou ao local de coleta. O cronômetro começou automaticamente.`:`📍 ${auth.name} chegou ao endereço de entrega. O cronômetro começou automaticamente.`;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO delivery_wait_sessions(id,delivery_id,cooperative_id,base_id,driver_id,stage,free_seconds,rate_cents_per_15m,started_by,start_lat,start_lng) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(sessionId,delivery.id,auth.cooperativeId,delivery.base_id,auth.driverId,stage,free,rate,auth.id,lat,lng),
    c.env.DB.prepare(`UPDATE deliveries SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(nextStatus,delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,nextStatus,message,auth.id),
    c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,conversation_key,driver_read_at) VALUES (?,?,?,'driver',?,?,?,'customer','customer_driver',CURRENT_TIMESTAMP)`).bind(id(),delivery.id,auth.cooperativeId,auth.id,auth.name,message)
  ]);
  return c.json({ok:true,id:sessionId,stage,free_seconds:free,rate_cents_per_15m:rate,distance_meters:Math.round(distance)});
});

platformV16Routes.post('/v16/driver/wait/geofence',async c=>{
  const auth=tenant(c,['driver']),body=await bodyJson<Row>(c),lat=Number(body.latitude),lng=Number(body.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return c.json({ok:false,error:'Localização inválida.'},400);
  const session=await c.env.DB.prepare(`SELECT * FROM delivery_wait_sessions WHERE cooperative_id=? AND driver_id=? AND status='active' ORDER BY started_at DESC LIMIT 1`).bind(auth.cooperativeId,auth.driverId).first<Row>();
  if(!session)return c.json({ok:true,active:false});
  const delivery=await deliveryFor(c,auth,session.delivery_id),targetLat=session.stage==='pickup'?Number(delivery.pickup_lat):Number(delivery.delivery_lat),targetLng=session.stage==='pickup'?Number(delivery.pickup_lng):Number(delivery.delivery_lng);
  if(!Number.isFinite(targetLat)||!Number.isFinite(targetLng))return c.json({ok:true,active:true,stopped:false});
  const distance=haversineMeters(lat,lng,targetLat,targetLng),elapsed=elapsedSeconds(session.started_at);
  if(distance<=130||elapsed<20)return c.json({ok:true,active:true,stopped:false,distance_meters:Math.round(distance)});
  const stageLabel=session.stage==='pickup'?'coleta':'entrega',result=await closeWait(c,auth,delivery,session,{reason:`Saiu da área de ${stageLabel}`,lat,lng});
  if(session.stage==='pickup')await c.env.DB.prepare(`UPDATE deliveries SET status='in_route',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('delivered','cancelled')`).bind(delivery.id).run();
  const message=`⏱️ Cronômetro de ${stageLabel} encerrado automaticamente ao sair da área. Espera cobrada: ${centsLabel(result.charge_cents)}.`;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,session.stage==='pickup'?'in_route':delivery.status,message,auth.id),
    c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,conversation_key,driver_read_at) VALUES (?,?,?,'driver',?,?,?,'customer','customer_driver',CURRENT_TIMESTAMP)`).bind(id(),delivery.id,auth.cooperativeId,auth.id,auth.name,message)
  ]);
  return c.json({ok:true,active:false,stopped:true,stage:session.stage,distance_meters:Math.round(distance),result});
});

platformV16Routes.post('/v16/driver/deliveries/:id/wait/stop',async c=>{
  const auth=tenant(c,['driver']),delivery=await deliveryFor(c,auth,c.req.param('id')),body=await bodyJson<Row>(c),snapshot=await waitSnapshot(c,delivery.id);
  if(!snapshot.active)return c.json({ok:true,already_stopped:true});
  const reason=cleanText(body.reason||'Encerrado pelo cooperado',120),lat=Number(body.latitude),lng=Number(body.longitude);
  const result=await closeWait(c,auth,delivery,snapshot.active,{reason,lat:Number.isFinite(lat)?lat:null,lng:Number.isFinite(lng)?lng:null});
  if(snapshot.active.stage==='pickup')await c.env.DB.prepare(`UPDATE deliveries SET status='in_route',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('delivered','cancelled')`).bind(delivery.id).run();
  const label=snapshot.active.stage==='pickup'?'Coleta concluída':'Tempo na entrega encerrado';
  await c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,conversation_key,driver_read_at) VALUES (?,?,?,'driver',?,?,?,'customer','customer_driver',CURRENT_TIMESTAMP)`).bind(id(),delivery.id,auth.cooperativeId,auth.id,auth.name,`⏱️ ${label}. Espera cobrada: ${centsLabel(result.charge_cents)}.`).run();
  return c.json({ok:true,result,stage:snapshot.active.stage});
});
platformV16Routes.post('/v16/driver/deliveries/:id/complete',async c=>{const auth=tenant(c,['driver']),delivery=await deliveryFor(c,auth,c.req.param('id'));if(delivery.status==='delivered'){await finishFinancial(c,auth,delivery);return c.json({ok:true,already_delivered:true});}if(delivery.status==='cancelled')return c.json({ok:false,error:'Entrega cancelada.'},409);const body=await bodyJson<Row>(c),receiver=nullableText(body.received_by_name,150),required=Number(delivery.confirmation_required??1)===1&&!Number(delivery.finish_without_code_authorized||0),code=cleanText(body.confirmation_code,10);if(required&&code!==String(delivery.confirmation_code||''))return c.json({ok:false,error:'Código incorreto. O cliente também pode confirmar que recebeu.'},409);const snapshot=await waitSnapshot(c,delivery.id);if(snapshot.active)await closeWait(c,auth,delivery,snapshot.active,{reason:'Entrega finalizada'});await c.env.DB.batch([c.env.DB.prepare(`UPDATE deliveries SET status='delivered',completion_source='driver',confirmation_verified_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE confirmation_verified_at END,received_by_name=?,received_by_reported_at=CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE received_by_reported_at END,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(required?1:0,receiver,receiver,delivery.id),c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'delivered',?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,receiver?`Recebido por ${receiver}.`:'Entrega concluída pelo cooperado.',auth.id)]);await finishFinancial(c,auth,delivery);return c.json({ok:true});});

// Rastreamento público do cronômetro.
publicV16Routes.get('/tracking/:token/wait',async c=>{const delivery=await c.env.DB.prepare(`SELECT d.id,d.display_code,d.charge_cents,d.base_charge_cents,d.wait_charge_cents,d.outstanding_cents,d.paid_cents,d.launched_by_name,u.name created_by_name FROM deliveries d LEFT JOIN users u ON u.id=COALESCE(d.launched_by_user_id,d.created_by) WHERE d.tracking_token=? AND d.deleted_at IS NULL LIMIT 1`).bind(c.req.param('token')).first<Row>();if(!delivery)return c.json({ok:false,error:'Rastreamento não encontrado.'},404);const snapshot=await waitSnapshot(c,delivery.id);return c.json({ok:true,delivery:{...delivery,launched_by_name:delivery.launched_by_name||delivery.created_by_name},...snapshot});});
