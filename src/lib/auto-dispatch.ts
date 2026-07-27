import type { Env } from '../types';
import { id } from './util';

type Row = Record<string, any>;

function haversineMeters(lat1:number|null,lng1:number|null,lat2:number|null,lng2:number|null){
  if([lat1,lng1,lat2,lng2].some(value=>value==null||!Number.isFinite(Number(value))))return 9999999;
  const rad=(value:number)=>value*Math.PI/180,earth=6371000;
  const a1=Number(lat1),b1=Number(lng1),a2=Number(lat2),b2=Number(lng2);
  if(Math.abs(a1)>90||Math.abs(a2)>90||Math.abs(b1)>180||Math.abs(b2)>180)return 9999999;
  if(Math.abs(a1)+Math.abs(b1)<0.01||Math.abs(a2)+Math.abs(b2)<0.01)return 9999999;
  const dLat=rad(a2-a1),dLng=rad(b2-b1);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a1))*Math.cos(rad(a2))*Math.sin(dLng/2)**2;
  return Math.round(earth*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)));
}

export async function dispatchNextDriver(env:Env,deliveryId:string,changedBy:string|null=null,force=false){
  const delivery=await env.DB.prepare(`SELECT d.id,d.cooperative_id,d.base_id,d.status,d.assigned_driver_id,d.pickup_lat,d.pickup_lng,d.display_code,ds.scheduled_for,
      b.auto_dispatch_enabled,b.auto_dispatch_response_seconds,b.auto_dispatch_max_active
    FROM deliveries d JOIN bases b ON b.id=d.base_id LEFT JOIN delivery_schedules ds ON ds.delivery_id=d.id
    WHERE d.id=? AND d.delivery_type='base' AND d.deleted_at IS NULL LIMIT 1`).bind(deliveryId).first<Row>();
  if(!delivery||(!force&&Number(delivery.auto_dispatch_enabled)!==1))return {assigned:false,reason:'disabled'};
  if(['accepted','to_pickup','at_pickup','picked_up','in_route','delivered','cancelled'].includes(String(delivery.status)))return {assigned:false,reason:'closed'};
  const scheduledAt=delivery.scheduled_for?Date.parse(String(delivery.scheduled_for)):0;
  if(Number.isFinite(scheduledAt)&&scheduledAt>Date.now()+1000)return {assigned:false,reason:'scheduled'};

  const pending=await env.DB.prepare(`SELECT id,driver_id,expires_at FROM delivery_offer_attempts WHERE delivery_id=? AND status='pending' LIMIT 1`).bind(delivery.id).first<Row>();
  if(pending){
    if(pending.expires_at&&Date.parse(String(pending.expires_at).replace(' ','T')+'Z')<=Date.now()){
      await env.DB.batch([
        env.DB.prepare(`UPDATE delivery_offer_attempts SET status='expired',responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`).bind(pending.id),
        env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=NULL,status='new',assignment_source='auto_dispatch_timeout',updated_at=CURRENT_TIMESTAMP WHERE id=? AND assigned_driver_id=? AND status='assigned'`).bind(delivery.id,pending.driver_id)
      ]);
    }else return {assigned:true,driverId:pending.driver_id,reason:'pending'};
  }

  const rows=await env.DB.prepare(`SELECT d.id,d.name,d.current_lat,d.current_lng,d.location_updated_at,d.last_seen_at,
      (SELECT COUNT(*) FROM deliveries a WHERE a.assigned_driver_id=d.id AND a.deleted_at IS NULL AND a.status NOT IN ('delivered','cancelled')) active_deliveries,
      (SELECT COUNT(*) FROM deliveries t WHERE t.assigned_driver_id=d.id AND t.deleted_at IS NULL AND date(t.created_at,'-3 hours')=date('now','-3 hours')) deliveries_today,
      (SELECT MAX(datetime(t.updated_at)) FROM deliveries t WHERE t.assigned_driver_id=d.id) last_assignment_at,
      q.queue_order,q.arrived_at
    FROM drivers d
    LEFT JOIN waiting_queue q ON q.driver_id=d.id AND q.base_id=? AND q.establishment_id IS NULL AND q.status='waiting'
    WHERE d.cooperative_id=? AND d.status='active' AND d.deleted_at IS NULL
      AND d.online=1 AND datetime(d.last_seen_at)>=datetime('now','-10 minutes')
      AND d.location_updated_at IS NOT NULL AND datetime(d.location_updated_at)>=datetime('now','-10 minutes')
      AND EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.base_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=date('now','-3 hours'))
      AND NOT EXISTS(SELECT 1 FROM delivery_offer_attempts o WHERE o.delivery_id=? AND o.driver_id=d.id AND o.status IN ('rejected','expired','cancelled'))
    ORDER BY d.name COLLATE NOCASE`).bind(delivery.base_id,delivery.cooperative_id,delivery.base_id,delivery.id).all<Row>();

  const maxActive=Math.max(1,Number(delivery.auto_dispatch_max_active||3));
  const candidates:Row[]=(rows.results||[]).filter((driver:Row)=>Number(driver.active_deliveries||0)<maxActive).map((driver:Row):Row=>{
    const distance=haversineMeters(driver.current_lat,driver.current_lng,delivery.pickup_lat,delivery.pickup_lng);
    const active=Number(driver.active_deliveries||0),today=Number(driver.deliveries_today||0);
    const idleMinutes=driver.last_assignment_at?Math.max(0,(Date.now()-Date.parse(String(driver.last_assignment_at).replace(' ','T')+'Z'))/60000):240;
    const queueBonus=driver.queue_order!=null?Math.max(0,40-Number(driver.queue_order||0)*3):0;
    // Menor pontuação vence: proximidade pesa 50%, equilíbrio 30% e tempo ocioso 20%.
    const score=(distance/1000)*50+(today*18+active*35)-Math.min(120,idleMinutes)*0.2-queueBonus;
    return {...driver,distance,active,today,score};
  }).filter((driver:Row)=>driver.distance>0&&driver.distance<=150000).sort((a:Row,b:Row)=>a.score-b.score||a.distance-b.distance||a.today-b.today);

  const selected=candidates[0];
  if(!selected){
    await env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=NULL,status='new',assignment_source='auto_dispatch_waiting',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('new','assigned')`).bind(delivery.id).run();
    return {assigned:false,reason:'no_driver'};
  }

  const attemptId=id(),seconds=Math.max(10,Math.min(120,Number(delivery.auto_dispatch_response_seconds||25)));
  const expiresAt=new Date(Date.now()+seconds*1000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO delivery_offer_attempts(id,cooperative_id,base_id,delivery_id,driver_id,status,distance_to_pickup_meters,active_deliveries,deliveries_today,score,expires_at) VALUES (?,?,?,?,?,'pending',?,?,?,?,?)`)
      .bind(attemptId,delivery.cooperative_id,delivery.base_id,delivery.id,selected.id,selected.distance,selected.active,selected.today,selected.score,expiresAt),
    env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status='assigned',assigned_by_role='system',assigned_by_user_id=?,assignment_source='auto_dispatch',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('new','assigned')`)
      .bind(selected.id,changedBy,delivery.id),
    env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting' AND base_id=? AND establishment_id IS NULL`)
      .bind(delivery.id,selected.id,delivery.base_id),
    env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'assigned',?,?)`)
      .bind(id(),delivery.id,delivery.cooperative_id,delivery.status,`Distribuição automática para ${selected.name}. Distância até a coleta: ${(selected.distance/1000).toFixed(1)} km.`,changedBy)
  ]);
  return {assigned:true,driverId:selected.id,driverName:selected.name,attemptId,expiresAt,distanceMeters:selected.distance};
}

export async function expireAndRedispatch(env:Env,baseId:string,changedBy:string|null=null){
  const rows=await env.DB.prepare(`SELECT o.id,o.delivery_id,o.driver_id FROM delivery_offer_attempts o JOIN deliveries d ON d.id=o.delivery_id
    WHERE o.base_id=? AND o.status='pending' AND o.expires_at IS NOT NULL AND datetime(o.expires_at)<=datetime('now') AND d.status='assigned'`).bind(baseId).all<Row>();
  const results=[];
  for(const row of rows.results||[]){
    await env.DB.batch([
      env.DB.prepare(`UPDATE delivery_offer_attempts SET status='expired',responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`).bind(row.id),
      env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=NULL,status='new',assignment_source='auto_dispatch_timeout',updated_at=CURRENT_TIMESTAMP WHERE id=? AND assigned_driver_id=? AND status='assigned'`).bind(row.delivery_id,row.driver_id)
    ]);
    results.push(await dispatchNextDriver(env,String(row.delivery_id),changedBy));
  }
  return results;
}
