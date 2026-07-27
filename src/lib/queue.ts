import type { Env } from '../types';
import { id } from './util';

export type QueueAssignment = {
  assigned: boolean;
  driverId?: string;
  driverName?: string;
  queueId?: string;
};

export function distanceMeters(aLat:number,aLng:number,bLat:number,bLng:number):number {
  if([aLat,aLng,bLat,bLng].some(value=>!Number.isFinite(value)))return 0;
  if(Math.abs(aLat)>90||Math.abs(bLat)>90||Math.abs(aLng)>180||Math.abs(bLng)>180)return 0;
  if(Math.abs(aLat)+Math.abs(aLng)<0.01||Math.abs(bLat)+Math.abs(bLng)<0.01)return 0;
  const r=6371000;
  const rad=(v:number)=>v*Math.PI/180;
  const dLat=rad(bLat-aLat),dLng=rad(bLng-aLng);
  const x=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2;
  const meters=Math.round(2*r*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)));
  return meters>150000?0:meters;
}

type QueueLocation =
  | { type:'base'; baseId:string; establishmentId?:never }
  | { type:'establishment'; establishmentId:string; baseId?:never };

async function assignNextWaitingDriver(
  env:Env,
  input:{cooperativeId:string;deliveryId:string;changedBy?:string|null;} & QueueLocation
):Promise<QueueAssignment> {
  const locationColumn=input.type==='base'?'base_id':'establishment_id';
  const locationId=input.type==='base'?input.baseId:input.establishmentId;
  const otherColumn=input.type==='base'?'establishment_id':'base_id';
  const deliveryType=input.type==='base'?'base':'establishment';
  const delivery=await env.DB.prepare(`SELECT d.id,d.status,d.assigned_driver_id,d.display_code,d.establishment_id,d.base_id,d.delivery_type,d.pickup_lat,d.pickup_lng,COALESCE(b.displacement_rate_cents_per_km,0) displacement_rate_cents_per_km
    FROM deliveries d LEFT JOIN bases b ON b.id=d.base_id WHERE d.id=? AND d.cooperative_id=? AND d.${locationColumn}=? AND d.delivery_type=? AND d.deleted_at IS NULL`)
    .bind(input.deliveryId,input.cooperativeId,locationId,deliveryType).first<Record<string,any>>();
  if(!delivery||delivery.assigned_driver_id||!['new','offered'].includes(String(delivery.status)))return {assigned:false};

  const scheduleCondition=input.type==='base'
    ? `EXISTS(SELECT 1 FROM schedules s WHERE s.cooperative_id=q.cooperative_id AND s.driver_id=q.driver_id
        AND s.base_id=q.base_id AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work'
        AND date(s.start_at)=date('now','-3 hours'))`
    : `(EXISTS(SELECT 1 FROM schedules s WHERE s.cooperative_id=q.cooperative_id AND s.driver_id=q.driver_id
        AND s.establishment_id=q.establishment_id AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work'
        AND date(s.start_at)=date('now','-3 hours'))
      OR EXISTS(SELECT 1 FROM establishment_driver_permissions p WHERE p.driver_id=q.driver_id
        AND p.establishment_id=q.establishment_id AND p.active=1 AND date(p.service_date)=date('now','-3 hours')))`;
  const presenceCondition=input.type==='base'
    ? `AND EXISTS(SELECT 1 FROM presence_sessions p WHERE p.driver_id=q.driver_id AND p.base_id=q.base_id AND p.checkout_at IS NULL)`
    : ``;

  const next=await env.DB.prepare(`SELECT q.id queue_id,q.driver_id,d.name driver_name,d.current_lat,d.current_lng,q.queue_order
    FROM waiting_queue q JOIN drivers d ON d.id=q.driver_id
    WHERE q.cooperative_id=? AND q.${locationColumn}=? AND q.${otherColumn} IS NULL
      AND q.status='waiting' AND q.location_verified=1
      AND d.cooperative_id=q.cooperative_id AND d.status='active' AND COALESCE(d.on_leave,0)=0 AND d.deleted_at IS NULL
      ${input.type==='establishment'?`AND NOT EXISTS(SELECT 1 FROM driver_establishment_blocks x WHERE x.cooperative_id=q.cooperative_id AND x.driver_id=q.driver_id AND x.establishment_id=q.establishment_id AND x.active=1)`:''}
      AND ${scheduleCondition}
      ${presenceCondition}
    ORDER BY CASE WHEN q.queue_order>0 THEN q.queue_order ELSE 2147483647 END,datetime(q.arrived_at),q.id LIMIT 1`)
    .bind(input.cooperativeId,locationId).first<Record<string,any>>();
  if(!next)return {assigned:false};

  const source=input.type==='base'?'base_queue_auto':'establishment_queue_auto';
  const label=input.type==='base'?'Base':'estabelecimento';
  const actualDistance=next.current_lat!=null&&next.current_lng!=null&&delivery.pickup_lat!=null&&delivery.pickup_lng!=null
    ?distanceMeters(Number(next.current_lat),Number(next.current_lng),Number(delivery.pickup_lat),Number(delivery.pickup_lng)):0;
  const actualCents=Math.round(actualDistance/1000*Number(delivery.displacement_rate_cents_per_km||0));
  const update=await env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status='assigned',assigned_by_role='system',
    assigned_by_user_id=?,assignment_source=?,actual_displacement_distance_meters=?,actual_displacement_cents=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND assigned_driver_id IS NULL AND status IN ('new','offered')`)
    .bind(next.driver_id,input.changedBy||null,source,actualDistance,actualCents,input.deliveryId).run();
  if(!update.meta.changes)return {assigned:false};

  await env.DB.batch([
    env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='waiting'`).bind(input.deliveryId,next.queue_id),
    env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by)
      VALUES (?,?,?,?,'assigned',?,?)`).bind(id(),input.deliveryId,input.cooperativeId,delivery.status,
      `Atribuição automática pela lista de espera do ${label} para ${next.driver_name}`,input.changedBy||null)
  ]);
  return {assigned:true,driverId:String(next.driver_id),driverName:String(next.driver_name),queueId:String(next.queue_id)};
}

export async function assignNextBaseDriver(env:Env, input:{cooperativeId:string;baseId:string;deliveryId:string;changedBy?:string|null;}):Promise<QueueAssignment> {
  return assignNextWaitingDriver(env,{...input,type:'base'});
}

export async function assignNextEstablishmentDriver(env:Env, input:{cooperativeId:string;establishmentId:string;deliveryId:string;changedBy?:string|null;}):Promise<QueueAssignment> {
  return assignNextWaitingDriver(env,{...input,type:'establishment'});
}
