import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { assertRole, bodyJson, cleanText, id } from '../lib/util';
import { distanceMeters } from '../lib/queue';
import { queueWebhookEvent } from '../lib/webhooks';

export const platformV28Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

function validPoint(lat:number,lng:number){
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&Math.abs(lat)+Math.abs(lng)>0.01;
}
function truthy(value:unknown){return value===true||value===1||value==='1'||value==='true';}
function customerMessage(status:string){
  if(status==='at_pickup')return 'O cooperado chegou ao local da coleta.';
  if(status==='in_route')return 'O cooperado está indo até você.';
  return 'O cooperado aceitou sua entrega e está indo para a coleta.';
}
async function delivery(c:any,deliveryId:string,cooperativeId:string):Promise<Row|null>{
  return (await c.env.DB.prepare(`SELECT d.*,e.name establishment_name,b.name base_name,
      COALESCE(NULLIF(b.fuel_km_per_liter,0),(SELECT NULLIF(bx.fuel_km_per_liter,0) FROM bases bx
        WHERE bx.cooperative_id=d.cooperative_id AND bx.deleted_at IS NULL AND COALESCE(bx.fuel_km_per_liter,0)>0 AND COALESCE(bx.fuel_price_cents,0)>0
        ORDER BY CASE WHEN bx.id=d.base_id THEN 0 ELSE 1 END,datetime(COALESCE(bx.updated_at,bx.created_at)) DESC,bx.name LIMIT 1),
        (SELECT NULLIF(cx.fuel_km_per_liter,0) FROM cooperatives cx WHERE cx.id=d.cooperative_id)) fuel_km_per_liter,
      COALESCE(NULLIF(b.fuel_price_cents,0),(SELECT NULLIF(bx.fuel_price_cents,0) FROM bases bx
        WHERE bx.cooperative_id=d.cooperative_id AND bx.deleted_at IS NULL AND COALESCE(bx.fuel_km_per_liter,0)>0 AND COALESCE(bx.fuel_price_cents,0)>0
        ORDER BY CASE WHEN bx.id=d.base_id THEN 0 ELSE 1 END,datetime(COALESCE(bx.updated_at,bx.created_at)) DESC,bx.name LIMIT 1),
        (SELECT NULLIF(cx.fuel_price_cents,0) FROM cooperatives cx WHERE cx.id=d.cooperative_id)) fuel_price_cents,
      COALESCE(b.displacement_rate_cents_per_km,(SELECT bx.displacement_rate_cents_per_km FROM bases bx
        WHERE bx.cooperative_id=d.cooperative_id AND bx.active=1 AND bx.deleted_at IS NULL
        ORDER BY CASE WHEN bx.id=d.base_id THEN 0 ELSE 1 END,bx.name LIMIT 1),0) displacement_rate_cents_per_km,
      COALESCE(b.return_percent,(SELECT bx.return_percent FROM bases bx
        WHERE bx.cooperative_id=d.cooperative_id AND bx.active=1 AND bx.deleted_at IS NULL
        ORDER BY CASE WHEN bx.id=d.base_id THEN 0 ELSE 1 END,bx.name LIMIT 1),0) return_percent
    FROM deliveries d
    JOIN establishments e ON e.id=d.establishment_id
    LEFT JOIN bases b ON b.id=d.base_id
    WHERE d.id=? AND d.cooperative_id=? AND d.deleted_at IS NULL LIMIT 1`)
    .bind(deliveryId,cooperativeId).first()) as Row|null;
}
function needsAcceptance(item:Row,driverId:string){
  if(item.status==='offered'&&!item.assigned_driver_id)return true;
  if(item.status==='assigned'&&item.assigned_driver_id===driverId)return true;
  return item.assigned_driver_id===driverId&&!item.accepted_at&&['accepted','to_pickup','at_pickup'].includes(String(item.status));
}
platformV28Routes.get('/v28/driver/calls/:id',async c=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
  const item=await delivery(c,c.req.param('id'),auth.cooperativeId);
  if(!item)return c.json({ok:false,error:'Entrega não encontrada.'},404);
  const available=(item.status==='offered'&&!item.assigned_driver_id)||(item.status==='assigned'&&item.assigned_driver_id===auth.driverId)||(item.assigned_driver_id===auth.driverId&&!['delivered','cancelled'].includes(item.status));
  if(!available)return c.json({ok:false,error:'Esta entrega não está disponível para você.'},409);
  const driver=await c.env.DB.prepare(`SELECT current_lat,current_lng FROM drivers WHERE id=? AND cooperative_id=?`).bind(auth.driverId,auth.cooperativeId).first<Row>();
  const driverLat=Number(driver?.current_lat),driverLng=Number(driver?.current_lng);
  let distanceToPickup:number|null=null;
  if(validPoint(driverLat,driverLng)&&validPoint(Number(item.pickup_lat),Number(item.pickup_lng)))distanceToPickup=distanceMeters(driverLat,driverLng,Number(item.pickup_lat),Number(item.pickup_lng));
  const plannedDisplacement=Math.max(0,Number(item.actual_displacement_distance_meters||item.displacement_distance_meters||0));
  const effectiveDisplacement=distanceToPickup==null?plannedDisplacement:distanceToPickup;
  const routeDistance=Math.max(0,Number(item.distance_meters||0));
  const totalDistance=routeDistance+effectiveDisplacement;
  const kmPerLiter=Number(item.fuel_km_per_liter||0),fuelPrice=Number(item.fuel_price_cents||0);
  const fuelCostCents=kmPerLiter>0&&fuelPrice>0?Math.round((totalDistance/1000/kmPerLiter)*fuelPrice):null;
  const displacementRate=Math.max(0,Number(item.displacement_rate_cents_per_km||0));
  const calculatedDisplacementCents=Math.round((effectiveDisplacement/1000)*displacementRate);
  const displacementCents=Math.max(0,Number(item.actual_displacement_cents||item.displacement_cents||calculatedDisplacementCents));
  const routeCents=Math.max(0,Number(item.route_charge_cents||item.base_charge_cents||0));
  const returnCents=Math.max(0,Number(item.return_cents||0));
  const serviceCents=Math.max(0,Number(item.service_charge_cents||item.services_cents||0));
  const waitCents=Math.max(0,Number(item.wait_charge_cents||0));
  const cancellationCents=Math.max(0,Number(item.cancellation_charge_cents||0));
  const services=await c.env.DB.prepare(`SELECT service_name,add_cents FROM delivery_services WHERE delivery_id=? ORDER BY service_name`).bind(item.id).all<Row>();
  return c.json({ok:true,item:{...item,requires_acceptance:needsAcceptance(item,auth.driverId),distance_to_pickup_meters:effectiveDisplacement||null,route_distance_meters:routeDistance,total_distance_meters:totalDistance,fuel_cost_cents:fuelCostCents,fuel_km_per_liter:kmPerLiter||null,fuel_price_cents:fuelPrice||null,displacement_rate_cents_per_km:displacementRate,calculated_displacement_cents:calculatedDisplacementCents,displacement_cents:displacementCents,route_charge_cents:routeCents,return_cents:returnCents,service_charge_cents:serviceCents,wait_charge_cents:waitCents,cancellation_charge_cents:cancellationCents,services:services.results||[]}});
});
platformV28Routes.post('/v28/driver/calls/:id/accept',async c=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
  const body=await bodyJson<Row>(c),item=await delivery(c,c.req.param('id'),auth.cooperativeId);
  if(!item)return c.json({ok:false,error:'A entrega não está mais disponível.'},409);
  if(!needsAcceptance(item,auth.driverId))return c.json({ok:false,error:'A entrega já foi aceita ou retirada.'},409);
  const driver=await c.env.DB.prepare(`SELECT online,current_lat,current_lng FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND deleted_at IS NULL`).bind(auth.driverId,auth.cooperativeId).first<Row>();
  if(!driver||Number(driver.online)!==1)return c.json({ok:false,error:'Toque em INICIAR antes de aceitar a entrega.'},409);
  let lat=Number(body.latitude),lng=Number(body.longitude);if(!validPoint(lat,lng)){lat=Number(driver.current_lat);lng=Number(driver.current_lng);}
  let nextStatus='accepted',distanceToPickup:null|number=null;
  if(validPoint(lat,lng)&&validPoint(Number(item.pickup_lat),Number(item.pickup_lng))){distanceToPickup=distanceMeters(lat,lng,Number(item.pickup_lat),Number(item.pickup_lng));nextStatus=distanceToPickup<=100?'at_pickup':'to_pickup';}
  const result=await c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status=?,accepted_at=CURRENT_TIMESTAMP,assignment_source=CASE WHEN status='offered' THEN 'offer_live' ELSE assignment_source END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND ((status='offered' AND assigned_driver_id IS NULL AND accepted_at IS NULL) OR (status='assigned' AND assigned_driver_id=?) OR (assigned_driver_id=? AND accepted_at IS NULL AND status IN ('accepted','to_pickup','at_pickup')))`)
    .bind(auth.driverId,nextStatus,item.id,auth.cooperativeId,auth.driverId,auth.driverId).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Outro cooperado aceitou primeiro.'},409);
  const message=customerMessage(nextStatus);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting'`).bind(item.id,auth.driverId),
    c.env.DB.prepare(`INSERT INTO driver_offer_responses(delivery_id,driver_id,response,responded_at) VALUES (?,?,'accepted',CURRENT_TIMESTAMP) ON CONFLICT(delivery_id,driver_id) DO UPDATE SET response='accepted',responded_at=CURRENT_TIMESTAMP`).bind(item.id,auth.driverId),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),item.id,auth.cooperativeId,item.status,nextStatus,distanceToPickup==null?'Aceita pelo aplicativo':`Aceita a ${distanceToPickup} m da coleta`,auth.id),
    c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,conversation_key,driver_read_at) VALUES (?,?,?,'driver',?,?,?,'customer','customer_driver',CURRENT_TIMESTAMP)`).bind(id(),item.id,auth.cooperativeId,auth.id,auth.name,message)
  ]);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId,item.establishment_id,'delivery.status_changed',{id:item.id,display_code:item.display_code,status:nextStatus}));
  return c.json({ok:true,status:nextStatus,distance_to_pickup_meters:distanceToPickup,message});
});
platformV28Routes.post('/v28/driver/calls/:id/decline',async c=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
  const body=await bodyJson<Row>(c),reason=cleanText(body.reason||'Não consigo realizar esta entrega.',500),item=await delivery(c,c.req.param('id'),auth.cooperativeId);
  if(!item)return c.json({ok:true});
  if(!needsAcceptance(item,auth.driverId))return c.json({ok:false,error:'Esta entrega já foi aceita e não pode mais ser recusada por esta tela.'},409);
  await c.env.DB.prepare(`INSERT INTO driver_offer_responses(delivery_id,driver_id,response,reason,responded_at) VALUES (?,?,'declined',?,CURRENT_TIMESTAMP) ON CONFLICT(delivery_id,driver_id) DO UPDATE SET response='declined',reason=?,responded_at=CURRENT_TIMESTAMP`).bind(item.id,auth.driverId,reason,reason).run();
  if(item.assigned_driver_id===auth.driverId)await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=NULL,status='offered',accepted_at=NULL,assignment_source='declined_live',updated_at=CURRENT_TIMESTAMP WHERE id=? AND assigned_driver_id=? AND accepted_at IS NULL`).bind(item.id,auth.driverId),
    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'offered',?,?)`).bind(id(),item.id,auth.cooperativeId,item.status,`Recusada por ${auth.name}. Motivo: ${reason}`,auth.id)
  ]);
  return c.json({ok:true});
});
platformV28Routes.post('/v28/driver/auto-location',async c=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
  const body=await bodyJson<Row>(c),lat=Number(body.latitude),lng=Number(body.longitude),accuracy=body.accuracy==null?null:Number(body.accuracy),manual=truthy(body.manual),requestedStage=cleanText(body.stage,20);
  if(!validPoint(lat,lng))return c.json({ok:false,error:'Localização inválida.'},400);
  await c.env.DB.prepare(`UPDATE drivers SET current_lat=?,current_lng=?,location_accuracy=?,location_updated_at=CURRENT_TIMESTAMP,last_seen_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND online=1`).bind(lat,lng,accuracy,auth.driverId,auth.cooperativeId).run();
  const item=await c.env.DB.prepare(`SELECT id,display_code,status,pickup_lat,pickup_lng,delivery_lat,delivery_lng,establishment_id FROM deliveries WHERE cooperative_id=? AND assigned_driver_id=? AND accepted_at IS NOT NULL AND deleted_at IS NULL AND status IN ('accepted','to_pickup','at_pickup','picked_up','in_route','problem') ORDER BY created_at LIMIT 1`).bind(auth.cooperativeId,auth.driverId).first<Row>();
  if(!item)return c.json({ok:true,status:null});
  const gpsTolerance=Math.max(100,Math.min(160,Number.isFinite(Number(accuracy))&&Number(accuracy)>0?Number(accuracy)*1.5:100));

  if(['accepted','to_pickup','at_pickup'].includes(String(item.status))&&validPoint(Number(item.pickup_lat),Number(item.pickup_lng))){
    const distance=distanceMeters(lat,lng,Number(item.pickup_lat),Number(item.pickup_lng));let next:string|null=null;
    if(['accepted','to_pickup'].includes(String(item.status))&&distance<=gpsTolerance)next='at_pickup';
    // Nunca avançar at_pickup -> in_route por GPS. A coleta precisa ser confirmada explicitamente pelo cooperado.
    if(!next)return c.json({ok:true,status:item.status,distance_to_pickup_meters:distance});
    const message=customerMessage(next);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE deliveries SET status=?,picked_up_at=CASE WHEN ?='in_route' THEN COALESCE(picked_up_at,CURRENT_TIMESTAMP) ELSE picked_up_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?`).bind(next,next,item.id,item.status),
      c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),item.id,auth.cooperativeId,item.status,next,`Atualização automática por GPS a ${distance} m da coleta`,auth.id),
      c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,conversation_key,driver_read_at) VALUES (?,?,?,'driver',?,?,?,'customer','customer_driver',CURRENT_TIMESTAMP)`).bind(id(),item.id,auth.cooperativeId,auth.id,auth.name,message)
    ]);
    c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId,item.establishment_id,'delivery.status_changed',{id:item.id,display_code:item.display_code,status:next}));
    return c.json({ok:true,status:next,distance_to_pickup_meters:distance,message});
  }

  if(['picked_up','in_route','problem'].includes(String(item.status))&&validPoint(Number(item.delivery_lat),Number(item.delivery_lng))){
    const distance=distanceMeters(lat,lng,Number(item.delivery_lat),Number(item.delivery_lng));
    const already=await c.env.DB.prepare(`SELECT created_at FROM delivery_status_history WHERE delivery_id=? AND notes LIKE 'Chegada ao destino%' ORDER BY created_at DESC LIMIT 1`).bind(item.id).first<Row>();
    if(already)return c.json({ok:true,status:item.status,arrived_delivery:true,delivery_arrived_at:already.created_at,distance_to_delivery_meters:distance});
    const arrived=distance<=gpsTolerance||(manual&&requestedStage==='delivery');
    if(!arrived)return c.json({ok:true,status:item.status,arrived_delivery:false,distance_to_delivery_meters:distance});
    const note=`Chegada ao destino ${manual?'confirmada manualmente':'detectada por GPS'} a ${distance} m`;
    const message='O cooperado chegou ao seu endereço.';
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE deliveries SET updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(item.id),
      c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),item.id,auth.cooperativeId,item.status,item.status,note,auth.id),
      c.env.DB.prepare(`INSERT INTO delivery_messages(id,delivery_id,cooperative_id,sender_type,sender_user_id,sender_name,message,recipient_type,conversation_key,driver_read_at) VALUES (?,?,?,'driver',?,?,?,'customer','customer_driver',CURRENT_TIMESTAMP)`).bind(id(),item.id,auth.cooperativeId,auth.id,auth.name,message)
    ]);
    c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId,item.establishment_id,'delivery.status_changed',{id:item.id,display_code:item.display_code,status:item.status,arrived_delivery:true}));
    return c.json({ok:true,status:item.status,arrived_delivery:true,distance_to_delivery_meters:distance,message});
  }

  return c.json({ok:true,status:item.status});
});
