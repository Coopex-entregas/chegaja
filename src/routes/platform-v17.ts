import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { assertRole, bodyJson, cleanText, id, nullableText } from '../lib/util';
import { cooperativeCreditBalance, reconcileDeliveryCredit } from '../lib/wallet';
import { dispatchNextDriver, expireAndRedispatch } from '../lib/auto-dispatch';

export const platformV17Routes=new Hono<AppBindings>();
type Row=Record<string,any>;

function tenant(c:Context<AppBindings>,roles:AuthUser['role'][]){
  const auth=c.get('auth');assertRole(auth,roles);if(!auth.cooperativeId)throw new Error('Cooperativa não vinculada.');return auth;
}
function yes(value:unknown){return value===true||value===1||value==='1'||value==='true'||value==='on';}
function toCentsLoose(value:unknown){const text=String(value??'0').trim().replace(/\./g,'').replace(',','.');const n=Number(text);return Number.isFinite(n)?Math.max(0,Math.round(n*100)):0;}

platformV17Routes.get('/v17/base/:id/auto-dispatch',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const base=await c.env.DB.prepare(`SELECT id,name,auto_dispatch_enabled,auto_dispatch_response_seconds,auto_dispatch_max_active FROM bases WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!base)return c.json({ok:false,error:'Base não encontrada.'},404);
  return c.json({ok:true,base});
});

platformV17Routes.put('/v17/base/:id/auto-dispatch',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);const body=await bodyJson<Row>(c);
  const enabled=yes(body.enabled),seconds=Math.max(10,Math.min(120,Number(body.response_seconds||25))),maxActive=Math.max(1,Math.min(10,Number(body.max_active||3)));
  const result=await c.env.DB.prepare(`UPDATE bases SET auto_dispatch_enabled=?,auto_dispatch_response_seconds=?,auto_dispatch_max_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(enabled?1:0,seconds,maxActive,c.req.param('id'),auth.cooperativeId).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Base não encontrada.'},404);
  if(enabled){
    const deliveries=await c.env.DB.prepare(`SELECT id FROM deliveries WHERE base_id=? AND cooperative_id=? AND delivery_type='base' AND assigned_driver_id IS NULL AND status='new' AND deleted_at IS NULL ORDER BY created_at LIMIT 20`).bind(c.req.param('id'),auth.cooperativeId).all<Row>();
    for(const delivery of deliveries.results||[])await dispatchNextDriver(c.env,String(delivery.id),auth.id);
  }
  return c.json({ok:true,enabled,response_seconds:seconds,max_active:maxActive});
});

platformV17Routes.post('/v17/base/:id/auto-dispatch/tick',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const base=await c.env.DB.prepare(`SELECT id FROM bases WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first();
  if(!base)return c.json({ok:false,error:'Base não encontrada.'},404);
  const expired=await expireAndRedispatch(c.env,c.req.param('id'),auth.id);
  const waiting=await c.env.DB.prepare(`SELECT id FROM deliveries WHERE base_id=? AND cooperative_id=? AND delivery_type='base' AND assigned_driver_id IS NULL AND status='new' AND deleted_at IS NULL ORDER BY created_at LIMIT 20`).bind(c.req.param('id'),auth.cooperativeId).all<Row>();
  const dispatched=[];for(const delivery of waiting.results||[])dispatched.push(await dispatchNextDriver(c.env,String(delivery.id),auth.id));
  return c.json({ok:true,expired,dispatched});
});

platformV17Routes.post('/v17/driver/deliveries/:id/reject',async c=>{
  const auth=tenant(c,['driver']);const body=await bodyJson<Row>(c),reason=cleanText(body.reason,500);
  if(reason.length<3)return c.json({ok:false,error:'Informe o motivo da recusa.'},400);
  const delivery=await c.env.DB.prepare(`SELECT id,cooperative_id,base_id,status,assigned_driver_id,assignment_source,display_code FROM deliveries WHERE id=? AND cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId,auth.driverId).first<Row>();
  if(!delivery)return c.json({ok:false,error:'Esta entrega não está mais atribuída a você.'},409);
  if(delivery.status!=='assigned')return c.json({ok:false,error:'A entrega já foi aceita ou não pode mais ser recusada.'},409);
  const attempt=await c.env.DB.prepare(`SELECT id FROM delivery_offer_attempts WHERE delivery_id=? AND driver_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1`).bind(delivery.id,auth.driverId).first<Row>();
  await c.env.DB.batch([
    attempt?c.env.DB.prepare(`UPDATE delivery_offer_attempts SET status='rejected',rejection_reason=?,responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(reason,attempt.id):c.env.DB.prepare(`INSERT INTO delivery_offer_attempts(id,cooperative_id,base_id,delivery_id,driver_id,status,rejection_reason,responded_at) VALUES (?,?,?,?,?,'rejected',?,CURRENT_TIMESTAMP)`).bind(id(),delivery.cooperative_id,delivery.base_id,delivery.id,auth.driverId,reason),
    c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=NULL,status='new',assignment_source='driver_rejected',updated_at=CURRENT_TIMESTAMP WHERE id=? AND assigned_driver_id=? AND status='assigned'`).bind(delivery.id,auth.driverId),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,'assigned','new',?,?)`).bind(id(),delivery.id,delivery.cooperative_id,`Recusada por ${auth.name}. Motivo: ${reason}`,auth.id)
  ]);
  const next=await dispatchNextDriver(c.env,delivery.id,auth.id);
  return c.json({ok:true,next});
});

platformV17Routes.get('/v17/base/deliveries/:id/offers',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const delivery=await c.env.DB.prepare(`SELECT id,display_code FROM deliveries WHERE id=? AND cooperative_id=? AND delivery_type='base' AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  const rows=await c.env.DB.prepare(`SELECT o.id,o.status,o.rejection_reason,o.distance_to_pickup_meters,o.active_deliveries,o.deliveries_today,o.score,o.offered_at,o.expires_at,o.responded_at,d.name driver_name
    FROM delivery_offer_attempts o JOIN drivers d ON d.id=o.driver_id WHERE o.delivery_id=? ORDER BY o.created_at DESC`).bind(delivery.id).all<Row>();
  return c.json({ok:true,delivery,items:rows.results});
});

platformV17Routes.get('/v17/driver/deliveries/:id/metrics',async c=>{
  const auth=tenant(c,['driver']);
  const row=await c.env.DB.prepare(`SELECT d.id,d.display_code,d.status,d.pickup_lat,d.pickup_lng,d.delivery_lat,d.delivery_lng,d.distance_meters,d.duration_seconds,d.route_geometry,d.base_charge_cents,d.wait_charge_cents,d.charge_cents,d.paid_cents,d.outstanding_cents,d.driver_earnings_cents,d.driver_gross_cents,d.driver_net_cents,d.cooperative_fee_cents,d.payment_method,d.payment_status,d.assignment_source,
      b.fuel_km_per_liter,b.fuel_price_cents,b.name base_name,dr.current_lat driver_lat,dr.current_lng driver_lng,
      o.expires_at offer_expires_at,o.status offer_status,o.distance_to_pickup_meters
    FROM deliveries d JOIN bases b ON b.id=d.base_id JOIN drivers dr ON dr.id=d.assigned_driver_id
    LEFT JOIN delivery_offer_attempts o ON o.id=(SELECT x.id FROM delivery_offer_attempts x WHERE x.delivery_id=d.id AND x.driver_id=dr.id ORDER BY x.created_at DESC LIMIT 1)
    WHERE d.id=? AND d.cooperative_id=? AND d.assigned_driver_id=? AND d.deleted_at IS NULL LIMIT 1`).bind(c.req.param('id'),auth.cooperativeId,auth.driverId).first<Row>();
  if(!row)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  return c.json({ok:true,item:row});
});

platformV17Routes.post('/v17/base/deliveries/:id/settle-outstanding',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);const body=await bodyJson<Row>(c);
  const delivery=await c.env.DB.prepare(`SELECT id,cooperative_id,customer_id,display_code,charge_cents,paid_cents,outstanding_cents,credit_used_cents FROM deliveries WHERE id=? AND cooperative_id=? AND delivery_type='base' AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!delivery)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  const outstanding=Math.max(0,Number(delivery.outstanding_cents||0));if(!outstanding)return c.json({ok:false,error:'Esta entrega não possui valor pendente.'},409);
  const source=cleanText(body.source||'external',20)==='credit'?'credit':'external',method=cleanText(body.payment_method||'pix',40),notes=nullableText(body.notes,500),proof=nullableText(body.proof_url,1000);
  let creditUsed=Number(delivery.credit_used_cents||0);
  if(source==='credit'){
    if(!delivery.customer_id)return c.json({ok:false,error:'Esta entrega não possui cliente cadastrado para usar crédito.'},409);
    const available=await cooperativeCreditBalance(c.env,delivery.customer_id,auth.cooperativeId!);
    if(available<outstanding)return c.json({ok:false,error:'O cliente não possui crédito suficiente para quitar o restante.'},409);
    creditUsed+=outstanding;
    await reconcileDeliveryCredit(c.env,{deliveryId:delivery.id,cooperativeId:auth.cooperativeId!,customerId:delivery.customer_id,desiredCents:creditUsed,displayCode:delivery.display_code,reason:`Quitação do restante da entrega por ${auth.name}.`});
  }
  const paid=Math.min(Number(delivery.charge_cents||0),Number(delivery.paid_cents||0)+outstanding);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET paid_cents=?,outstanding_cents=0,credit_used_cents=?,payment_status='paid',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(paid,creditUsed,delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_payments(id,cooperative_id,delivery_id,customer_id,amount_cents,payment_method,source,notes,proof_url,received_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id(),auth.cooperativeId,delivery.id,delivery.customer_id,outstanding,method,source,notes,proof,auth.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) SELECT ?,id,cooperative_id,status,status,?,? FROM deliveries WHERE id=?`).bind(id(),`Restante de R$ ${(outstanding/100).toFixed(2).replace('.',',')} quitado por ${auth.name} via ${source==='credit'?'crédito do cliente':method}.`,auth.id,delivery.id)
  ]);
  return c.json({ok:true,paid_cents:paid,outstanding_cents:0});
});

platformV17Routes.get('/v17/base/:id/payments',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const rows=await c.env.DB.prepare(`SELECT p.*,d.display_code,u.name received_by_name FROM delivery_payments p JOIN deliveries d ON d.id=p.delivery_id JOIN users u ON u.id=p.received_by WHERE p.cooperative_id=? AND d.base_id=? ORDER BY p.created_at DESC LIMIT 100`).bind(auth.cooperativeId,c.req.param('id')).all<Row>();
  return c.json({ok:true,items:rows.results});
});
