import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { audit } from '../lib/audit';
import { assertRole, bodyJson, cleanText, id, nullableText, saoPauloDate, toCents } from '../lib/util';
import { queueWebhookEvent } from '../lib/webhooks';
import { distanceMeters } from '../lib/queue';
import { expandJsonRow } from '../lib/rows';
import { deliveryFields } from '../lib/delivery-fields';

export const platformV10Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

function tenant(c: Context<AppBindings>, roles: AuthUser['role'][]): AuthUser {
  const auth = c.get('auth');
  assertRole(auth, roles);
  if (!auth.cooperativeId) throw new Error('Cooperativa não vinculada.');
  return auth;
}

function validPoint(lat:number,lng:number):boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat)<=90 && Math.abs(lng)<=180 && Math.abs(lat)+Math.abs(lng)>=0.01;
}

function period(c: Context<AppBindings>) {
  const today = saoPauloDate();
  const from = cleanText(c.req.query('from') || `${today.slice(0,8)}01`, 10);
  const to = cleanText(c.req.query('to') || today, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Período inválido.');
  return { from, to };
}

async function deliveryForAssignment(c: Context<AppBindings>, auth: AuthUser, deliveryId: string) {
  const delivery = expandJsonRow(await c.env.DB.prepare(`SELECT ${deliveryFields('d')},json_object('establishment_name',e.name,'base_name',b.name,'displacement_rate_cents_per_km',b.displacement_rate_cents_per_km) related_json
    FROM deliveries d JOIN establishments e ON e.id=d.establishment_id LEFT JOIN bases b ON b.id=d.base_id
    WHERE d.id=? AND d.cooperative_id=? AND d.deleted_at IS NULL`).bind(deliveryId,auth.cooperativeId).first<Row>());
  if (!delivery) throw new Error('Entrega não encontrada.');
  const allowed = delivery.delivery_type === 'base'
    ? ['cooperative_admin','dispatcher'].includes(auth.role)
    : auth.role === 'establishment' && auth.establishmentId === delivery.establishment_id;
  if (!allowed) throw new Error(delivery.delivery_type === 'base'
    ? 'Somente a cooperativa atribui entregas da Base.'
    : 'Somente o estabelecimento atribui as próprias entregas de balcão.');
  return delivery;
}

async function candidateDrivers(c: Context<AppBindings>, delivery: Row) {
  const locationId = delivery.delivery_type === 'base' ? delivery.base_id : delivery.establishment_id;
  const localCondition = delivery.delivery_type === 'base'
    ? `EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.base_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work' AND s.start_at>=datetime(date('now','-3 hours')) AND s.start_at<datetime(date('now','-3 hours'),'+1 day'))`
    : `(EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work' AND s.start_at>=datetime(date('now','-3 hours')) AND s.start_at<datetime(date('now','-3 hours'),'+1 day'))
       OR EXISTS(SELECT 1 FROM establishment_driver_permissions p WHERE p.driver_id=d.id AND p.establishment_id=? AND p.active=1 AND date(p.service_date)=date('now','-3 hours')))`;
  const queueJoin = delivery.delivery_type === 'base'
    ? `q.base_id=? AND q.establishment_id IS NULL`
    : `q.establishment_id=? AND q.base_id IS NULL`;
  // A ordem acompanha os placeholders da fila, cooperativa e elegibilidade do local.
  const params: any[] = delivery.delivery_type === 'base'
    ? [locationId, delivery.cooperative_id, locationId]
    : [locationId, delivery.cooperative_id, locationId, locationId];
  const rows = await c.env.DB.prepare(`SELECT d.id,d.name,d.phone,d.vehicle_model,d.vehicle_plate,d.current_lat,d.current_lng,d.location_updated_at,
      d.online,q.id queue_id,q.arrived_at,q.queue_order,
      CASE WHEN q.id IS NULL THEN 0 ELSE 1 END in_waiting_queue
    FROM drivers d
    LEFT JOIN waiting_queue q ON q.driver_id=d.id AND q.status='waiting' AND ${queueJoin}
    WHERE d.cooperative_id=? AND d.status='active' AND COALESCE(d.on_leave,0)=0 AND d.deleted_at IS NULL
      AND (q.id IS NOT NULL OR (d.online=1 AND datetime(d.last_seen_at)>=datetime('now','-30 minutes')))
      AND ${localCondition}
    ORDER BY CASE WHEN q.id IS NULL THEN 1 ELSE 0 END,
      CASE WHEN q.queue_order>0 THEN q.queue_order ELSE 2147483647 END,
      datetime(q.arrived_at),d.name COLLATE NOCASE`).bind(...params).all<Row>();
  return (rows.results || []).map((item: Row, index: number): Row => ({
    ...item,
    queue_position: item.queue_id ? index + 1 : null,
    recommended: index === 0
  }));
}

platformV10Routes.get('/v10/queue/locations', async (c) => {
  const auth = tenant(c,['driver']);
  const schedules = await c.env.DB.prepare(`SELECT location_type,location_id,location_name,MIN(start_at) start_at,MAX(end_at) end_at
    FROM (
      SELECT CASE WHEN s.base_id IS NOT NULL THEN 'base' ELSE 'establishment' END location_type,
        COALESCE(s.base_id,s.establishment_id) location_id,COALESCE(b.name,e.name) location_name,s.start_at,s.end_at
      FROM schedules s LEFT JOIN establishments e ON e.id=s.establishment_id LEFT JOIN bases b ON b.id=s.base_id
      WHERE s.cooperative_id=? AND s.driver_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work'
        AND s.start_at>=datetime(date('now','-3 hours')) AND s.start_at<datetime(date('now','-3 hours'),'+1 day')
      UNION ALL
      SELECT 'establishment' location_type,p.establishment_id location_id,e.name location_name,
        datetime(p.service_date||' 00:00:00') start_at,datetime(p.service_date||' 23:59:59') end_at
      FROM establishment_driver_permissions p JOIN establishments e ON e.id=p.establishment_id
      WHERE p.cooperative_id=? AND p.driver_id=? AND p.active=1 AND date(p.service_date)=date('now','-3 hours')
        AND e.active=1 AND e.deleted_at IS NULL
    ) eligible
    GROUP BY location_type,location_id,location_name ORDER BY start_at`).bind(auth.cooperativeId,auth.driverId,auth.cooperativeId,auth.driverId).all<Row>();
  const active = await c.env.DB.prepare(`
    SELECT ranked.* FROM (
      SELECT q.*,COALESCE(b.name,e.name) location_name,
        CASE WHEN q.base_id IS NOT NULL THEN 'base' ELSE 'establishment' END location_type,
        ROW_NUMBER() OVER(
          PARTITION BY COALESCE(q.base_id,''),COALESCE(q.establishment_id,'')
          ORDER BY CASE WHEN q.queue_order>0 THEN q.queue_order ELSE 2147483647 END,datetime(q.arrived_at),q.id
        ) queue_position,
        COUNT(*) OVER(
          PARTITION BY COALESCE(q.base_id,''),COALESCE(q.establishment_id,'')
        ) queue_total
      FROM waiting_queue q
      LEFT JOIN establishments e ON e.id=q.establishment_id
      LEFT JOIN bases b ON b.id=q.base_id
      WHERE q.cooperative_id=? AND q.status='waiting'
    ) ranked
    WHERE ranked.driver_id=?
    LIMIT 1
  `).bind(auth.cooperativeId,auth.driverId).first<Row>();
  return c.json({ok:true,items:schedules.results,active});
});

platformV10Routes.post('/v10/queue/arrive', async (c) => {
  const auth = tenant(c,['driver']);
  const body = await bodyJson<Row>(c);
  const type = cleanText(body.location_type,20), locationId = cleanText(body.location_id,100);
  if (!['establishment','base'].includes(type) || !locationId) return c.json({ok:false,error:'Selecione o local da sua escala.'},400);
  const latitude=Number(body.latitude),longitude=Number(body.longitude);
  if(!validPoint(latitude,longitude))return c.json({ok:false,error:'Ative a localização precisa do aparelho para confirmar que você chegou ao local.'},400);
  const online = await c.env.DB.prepare(`SELECT 1 ok FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND COALESCE(on_leave,0)=0 AND online=1 AND datetime(last_seen_at)>=datetime('now','-10 minutes') AND deleted_at IS NULL`).bind(auth.driverId,auth.cooperativeId).first();
  if (!online) return c.json({ok:false,error:type==='base'?'Faça o check-in pelo QR Code da Base para ficar online antes de entrar na lista de espera.':'Fique online antes de entrar na lista de espera do estabelecimento.'},409);
  const schedule = type === 'base'
    ? await c.env.DB.prepare(`SELECT 1 ok FROM schedules WHERE cooperative_id=? AND driver_id=? AND base_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND COALESCE(entry_type,'work')='work' AND date(start_at)=date('now','-3 hours') LIMIT 1`).bind(auth.cooperativeId,auth.driverId,locationId).first()
    : await c.env.DB.prepare(`SELECT 1 ok WHERE EXISTS(
        SELECT 1 FROM schedules WHERE cooperative_id=? AND driver_id=? AND establishment_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND COALESCE(entry_type,'work')='work' AND date(start_at)=date('now','-3 hours')
      ) OR EXISTS(
        SELECT 1 FROM establishment_driver_permissions WHERE cooperative_id=? AND driver_id=? AND establishment_id=? AND active=1 AND date(service_date)=date('now','-3 hours')
      ) LIMIT 1`).bind(auth.cooperativeId,auth.driverId,locationId,auth.cooperativeId,auth.driverId,locationId).first();
  if (!schedule) return c.json({ok:false,error:'Você não está escalado neste local hoje.'},403);
  let distance=0,presenceSessionId:string|null=null;
  if(type==='base'){
    const base=await c.env.DB.prepare(`SELECT id,latitude,longitude,checkin_radius_meters FROM bases WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(locationId,auth.cooperativeId).first<Row>();
    const baseLat=Number(base?.latitude),baseLng=Number(base?.longitude);
    if(!base||!validPoint(baseLat,baseLng))return c.json({ok:false,error:'A localização da Base ainda não foi configurada corretamente.'},409);
    distance=distanceMeters(latitude,longitude,baseLat,baseLng);
    const radius=Math.max(30,Number(base.checkin_radius_meters||30));
    if(distance>radius)return c.json({ok:false,error:`Você está a ${distance} m da Base. A entrada na fila é permitida somente dentro de ${radius} m.`},403);
    let presence=await c.env.DB.prepare(`SELECT id FROM presence_sessions WHERE driver_id=? AND base_id=? AND checkout_at IS NULL ORDER BY checkin_at DESC LIMIT 1`).bind(auth.driverId,locationId).first<Row>();
    if(!presence){
      const presenceId=id();
      await c.env.DB.prepare(`INSERT INTO presence_sessions(id,cooperative_id,driver_id,location_type,base_id,checkin_lat,checkin_lng,source,notes) VALUES (?,?,?,'base',?,?,?,'geofence','Chegada confirmada pelo botão Cheguei dentro do raio da Base')`).bind(presenceId,auth.cooperativeId,auth.driverId,locationId,latitude,longitude).run();
      presence={id:presenceId};
    }
    presenceSessionId=String(presence.id);
  }else{
    const establishment=await c.env.DB.prepare(`SELECT id,latitude,longitude,queue_radius_meters FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(locationId,auth.cooperativeId).first<Row>();
    const establishmentLat=Number(establishment?.latitude),establishmentLng=Number(establishment?.longitude);
    if(!establishment||!validPoint(establishmentLat,establishmentLng))return c.json({ok:false,error:'A localização do estabelecimento ainda não foi configurada corretamente.'},409);
    distance=distanceMeters(latitude,longitude,establishmentLat,establishmentLng);
    const radius=Math.max(30,Math.min(2000,Number(establishment.queue_radius_meters||250)));
    if(distance>radius)return c.json({ok:false,error:`Você está a ${distance} m do estabelecimento. A fila só é liberada dentro de ${radius} m.`},403);
    const block=await c.env.DB.prepare(`SELECT reason FROM driver_establishment_blocks WHERE cooperative_id=? AND driver_id=? AND establishment_id=? AND active=1 LIMIT 1`).bind(auth.cooperativeId,auth.driverId,locationId).first<Row>();
    if(block)return c.json({ok:false,error:`Você está bloqueado para atuar neste estabelecimento${block.reason?`: ${block.reason}`:''}.`},403);
  }
  const existing = await c.env.DB.prepare(`SELECT * FROM waiting_queue WHERE driver_id=? AND status='waiting' LIMIT 1`).bind(auth.driverId).first<Row>();
  if (existing && ((type==='base'&&existing.base_id===locationId)||(type==='establishment'&&existing.establishment_id===locationId))) return c.json({ok:true,item:existing,already_waiting:true});
  const entryId=id();
  const statements:D1PreparedStatement[]=[];
  if(existing) statements.push(c.env.DB.prepare(`UPDATE waiting_queue SET status='left',left_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(existing.id));
  const orderRow=await c.env.DB.prepare(`SELECT COALESCE(MAX(queue_order),0)+1 next_order FROM waiting_queue
    WHERE cooperative_id=? AND status='waiting' AND ((?='base' AND base_id=? AND establishment_id IS NULL) OR (?='establishment' AND establishment_id=? AND base_id IS NULL))`)
    .bind(auth.cooperativeId,type,locationId,type,locationId).first<Row>();
  const queueOrder=Math.max(1,Number(orderRow?.next_order||1));
  statements.push(c.env.DB.prepare(`INSERT INTO waiting_queue (id,cooperative_id,establishment_id,base_id,driver_id,status,source,notes,arrival_lat,arrival_lng,distance_meters,location_verified,presence_session_id,queue_order) VALUES (?,?,?,?,?,'waiting','driver_app',?,?,?,?,1,?,?)`).bind(entryId,auth.cooperativeId,type==='establishment'?locationId:null,type==='base'?locationId:null,auth.driverId,nullableText(body.notes,300),latitude,longitude,distance,presenceSessionId,queueOrder));
  await c.env.DB.batch(statements);
  return c.json({ok:true,id:entryId});
});

platformV10Routes.post('/v10/queue/leave', async (c) => {
  const auth = tenant(c,['driver']);
  await c.env.DB.prepare(`UPDATE waiting_queue SET status='left',left_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting'`).bind(auth.driverId).run();
  return c.json({ok:true});
});

platformV10Routes.get('/v10/queue', async (c) => {
  const auth = tenant(c,['cooperative_admin','dispatcher','establishment','driver']);
  await c.env.DB.prepare(`UPDATE waiting_queue SET status='left',left_at=COALESCE(left_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
    WHERE cooperative_id=? AND status='waiting' AND (
      datetime(arrived_at)<datetime('now','-12 hours') OR driver_id IN (
        SELECT id FROM drivers WHERE cooperative_id=? AND (status!='active' OR COALESCE(on_leave,0)=1 OR deleted_at IS NOT NULL)
      )
    )`).bind(auth.cooperativeId,auth.cooperativeId).run();
  let sql=`SELECT q.*,d.name driver_name,d.phone,d.vehicle_model,d.vehicle_plate,d.online,d.last_seen_at,
      COALESCE(b.name,e.name) location_name,
      CASE WHEN q.base_id IS NOT NULL THEN 'base' ELSE 'establishment' END location_type,
      ROW_NUMBER() OVER(PARTITION BY COALESCE(q.base_id,''),COALESCE(q.establishment_id,'') ORDER BY CASE WHEN q.queue_order>0 THEN q.queue_order ELSE 2147483647 END,datetime(q.arrived_at),q.id) queue_position
    FROM waiting_queue q JOIN drivers d ON d.id=q.driver_id
    LEFT JOIN establishments e ON e.id=q.establishment_id LEFT JOIN bases b ON b.id=q.base_id
    WHERE q.cooperative_id=? AND q.status='waiting'`;
  const params:any[]=[auth.cooperativeId];
  if(auth.role==='establishment'){sql+=` AND q.establishment_id=?`;params.push(auth.establishmentId);}
  if(auth.role==='driver'){sql+=` AND q.driver_id=?`;params.push(auth.driverId);}
  if(c.req.query('establishment_id')&&auth.role!=='establishment'){sql+=` AND q.establishment_id=?`;params.push(c.req.query('establishment_id'));}
  if(c.req.query('base_id')){sql+=` AND q.base_id=?`;params.push(c.req.query('base_id'));}
  sql+=` ORDER BY location_name,queue_position`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all<Row>();
  return c.json({ok:true,items:rows.results});
});


platformV10Routes.put('/v10/queue/reorder', async (c) => {
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment']);
  const body=await bodyJson<Row>(c),type=cleanText(body.location_type,20),locationId=cleanText(body.location_id,100);
  const queueIds=Array.isArray(body.queue_ids)?body.queue_ids.map((value:any)=>cleanText(value,100)).filter(Boolean):[];
  if(!['base','establishment'].includes(type)||!locationId||!queueIds.length)return c.json({ok:false,error:'Informe a fila e a nova sequência.'},400);
  if(type==='base'&&!['cooperative_admin','dispatcher'].includes(auth.role))return c.json({ok:false,error:'Somente a Base pode reorganizar esta fila.'},403);
  if(type==='establishment'&&auth.role==='establishment'&&auth.establishmentId!==locationId)return c.json({ok:false,error:'Fila de outro estabelecimento.'},403);
  const locationColumn=type==='base'?'base_id':'establishment_id';
  const rows=await c.env.DB.prepare(`SELECT id FROM waiting_queue WHERE cooperative_id=? AND ${locationColumn}=? AND status='waiting'`).bind(auth.cooperativeId,locationId).all<Row>();
  const allowed=new Set((rows.results||[]).map((row:Row)=>String(row.id)));
  if(queueIds.some((queueId:string)=>!allowed.has(queueId))||queueIds.length!==allowed.size)return c.json({ok:false,error:'A fila mudou. Atualize a tela e tente novamente.'},409);
  await c.env.DB.batch(queueIds.map((queueId:string,index:number)=>c.env.DB.prepare(`UPDATE waiting_queue SET queue_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND status='waiting'`).bind(index+1,queueId,auth.cooperativeId)));
  return c.json({ok:true});
});

platformV10Routes.get('/v10/deliveries/:id/eligible-drivers', async (c) => {
  const auth = tenant(c,['cooperative_admin','dispatcher','establishment']);
  const delivery = await deliveryForAssignment(c,auth,c.req.param('id'));
  const eligible = await candidateDrivers(c,delivery);
  const includeAll = c.req.query('include_all')==='1' && delivery.delivery_type==='base' && ['cooperative_admin','dispatcher'].includes(auth.role);
  if(!includeAll)return c.json({ok:true,items:eligible,recommended_driver_id:eligible[0]?.id||null});
  const active=await c.env.DB.prepare(`SELECT id,name,phone,vehicle_model,vehicle_plate,current_lat,current_lng,location_updated_at,online,last_seen_at
    FROM drivers WHERE cooperative_id=? AND status='active' AND COALESCE(on_leave,0)=0 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`).bind(auth.cooperativeId).all<Row>();
  const eligibleMap=new Map((eligible||[]).map((item:Row)=>[String(item.id),item]));
  const items=(active.results||[]).map((item:Row)=>{
    const available=eligibleMap.get(String(item.id));
    return available?{...item,...available,eligible_now:true}:{...item,queue_position:null,recommended:false,eligible_now:false};
  }).sort((a:Row,b:Row)=>Number(Boolean(b.eligible_now))-Number(Boolean(a.eligible_now))||Number(Boolean(b.online))-Number(Boolean(a.online))||String(a.name).localeCompare(String(b.name),'pt-BR'));
  return c.json({ok:true,items,recommended_driver_id:eligible[0]?.id||null,includes_all_active:true});
});

platformV10Routes.post('/v10/deliveries/:id/assignment', async (c) => {
  const auth = tenant(c,['cooperative_admin','dispatcher','establishment']);
  const delivery = await deliveryForAssignment(c,auth,c.req.param('id'));
  if(['delivered','cancelled'].includes(delivery.status)) return c.json({ok:false,error:'Esta entrega já foi encerrada.'},409);
  const body=await bodyJson<Row>(c),action=cleanText(body.action||'assign',30);
  if(action==='unassign'||action==='offer_all'){
    const next=action==='offer_all'?'offered':'new';
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=NULL,status=?,unassigned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(next,delivery.id),
      c.env.DB.prepare(`UPDATE delivery_schedules SET planned_driver_id=NULL,dispatch_mode=CASE WHEN scheduled_for IS NOT NULL THEN 'none' ELSE dispatch_mode END,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`).bind(delivery.id),
      c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,next,action==='offer_all'?'Disponibilizada aos cooperados elegíveis':'Atribuição removida',auth.id)
    ]);
    return c.json({ok:true,status:next});
  }
  const driverId=cleanText(body.driver_id,100),candidates=await candidateDrivers(c,delivery);
  let driver=candidates.find((x:Row)=>x.id===driverId)||null;
  if(!driver&&delivery.delivery_type==='base'&&['cooperative_admin','dispatcher'].includes(auth.role)){
    driver=await c.env.DB.prepare(`SELECT id,name,phone,vehicle_model,vehicle_plate,current_lat,current_lng,online,last_seen_at
      FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND COALESCE(on_leave,0)=0 AND deleted_at IS NULL LIMIT 1`).bind(driverId,auth.cooperativeId).first<Row>();
  }
  if(!driver)return c.json({ok:false,error:delivery.delivery_type==='base'?'Selecione um cooperado ativo e que não esteja afastado.':'O cooperado precisa estar online e escalado neste local hoje.'},409);
  const scheduledAt=delivery.scheduled_for?Date.parse(String(delivery.scheduled_for)):0;
  const futureScheduled=Number.isFinite(scheduledAt)&&scheduledAt>Date.now()+60000;
  if(futureScheduled){
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE deliveries SET assignment_source='scheduled_manual_planned',assigned_driver_id=NULL,status='new',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delivery.id),
      c.env.DB.prepare(`INSERT INTO delivery_schedules(delivery_id,scheduled_for,dispatch_mode,planned_driver_id,dispatch_processed_at,updated_at)
        VALUES (?,?,'manual',?,NULL,CURRENT_TIMESTAMP)
        ON CONFLICT(delivery_id) DO UPDATE SET dispatch_mode='manual',planned_driver_id=excluded.planned_driver_id,dispatch_processed_at=NULL,updated_at=CURRENT_TIMESTAMP`)
        .bind(delivery.id,delivery.scheduled_for,driverId),
      c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,'new',`Cooperado ${driver.name} reservado para a entrega agendada`,auth.id)
    ]);
    return c.json({ok:true,planned:true,driver_id:driverId,driver_name:driver.name});
  }
  const actualDistance=driver.current_lat!=null&&driver.current_lng!=null&&delivery.pickup_lat!=null&&delivery.pickup_lng!=null
    ?Math.round(distanceMeters(Number(driver.current_lat),Number(driver.current_lng),Number(delivery.pickup_lat),Number(delivery.pickup_lng))):0;
  const actualCents=Math.round(actualDistance/1000*Number(delivery.displacement_rate_cents_per_km||0));
  const statements:D1PreparedStatement[]=[
    c.env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status='assigned',assigned_by_role=?,assigned_by_user_id=?,assignment_source=?,actual_displacement_distance_meters=?,actual_displacement_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(driverId,auth.role,auth.id,delivery.delivery_type==='base'?'cooperative_base':'establishment_counter',actualDistance,actualCents,delivery.id),
    c.env.DB.prepare(`INSERT INTO delivery_status_history (id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'assigned',?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,`Atribuída a ${driver.name}`,auth.id),
    c.env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='waiting' AND ((? IS NOT NULL AND base_id=?) OR (? IS NOT NULL AND establishment_id=?))`).bind(delivery.id,driverId,delivery.base_id,delivery.base_id,delivery.establishment_id,delivery.establishment_id)
  ];
  await c.env.DB.batch(statements);
  c.executionCtx.waitUntil(queueWebhookEvent(c.env,auth.cooperativeId!,delivery.establishment_id,'delivery.assigned',{id:delivery.id,display_code:delivery.display_code,driver_id:driverId,driver_name:driver.name,status:'assigned'}));
  return c.json({ok:true,recommended:Boolean(driver.recommended)});
});

function reportScope(auth:AuthUser,c:Context<AppBindings>){
  const filters:string[]=[`d.cooperative_id=?`,`d.deleted_at IS NULL`];const params:any[]=[auth.cooperativeId];
  if(auth.role==='establishment'){filters.push(`d.establishment_id=?`,`COALESCE(d.delivery_type,'establishment')!='base'`);params.push(auth.establishmentId);}
  else {
    filters.push(`d.delivery_type='base'`);
    if(c.req.query('base_id')){filters.push(`d.base_id=?`);params.push(c.req.query('base_id'));}
  }
  return {filters,params};
}

function guaranteeReportScope(auth:AuthUser,c:Context<AppBindings>){
  const filters:string[]=[`gs.cooperative_id=?`,`gs.establishment_id IS NOT NULL`,`COALESCE(gs.complement_cents,0)>0`];
  const params:any[]=[auth.cooperativeId];
  if(auth.role==='establishment'){
    filters.push(`gs.establishment_id=?`);params.push(auth.establishmentId);
  }else if(c.req.query('establishment_id')){
    filters.push(`gs.establishment_id=?`);params.push(c.req.query('establishment_id'));
  }else if(c.req.query('base_id')){
    // Garantido pertence somente a turnos de estabelecimento.
    filters.push(`1=0`);
  }
  return {filters,params};
}

platformV10Routes.get('/v10/reports/deliveries',async(c)=>{
  const auth=tenant(c,['cooperative_admin','dispatcher','establishment']);const {from,to}=period(c),scope=reportScope(auth,c);
  const where=[...scope.filters,`date(COALESCE(d.delivered_at,d.created_at)) BETWEEN date(?) AND date(?)`];const params=[...scope.params,from,to];
  const summary=await c.env.DB.prepare(`SELECT COUNT(*) total_orders,
      COALESCE(SUM(CASE WHEN d.status='delivered' THEN d.charge_cents ELSE 0 END),0) amount_due_cents,
      COALESCE(SUM(CASE WHEN d.status='delivered' THEN d.driver_gross_cents ELSE 0 END),0) driver_gross_cents,
      COALESCE(SUM(CASE WHEN d.status='delivered' THEN d.cooperative_fee_cents ELSE 0 END),0) cooperative_fee_cents,
      COALESCE(SUM(CASE WHEN d.status='delivered' THEN d.distance_meters ELSE 0 END),0) distance_meters,
      SUM(CASE WHEN d.status='delivered' THEN 1 ELSE 0 END) delivered_count,
      SUM(CASE WHEN d.status NOT IN ('delivered','cancelled') THEN 1 ELSE 0 END) active_count,
      SUM(CASE WHEN d.payment_status='paid' THEN d.charge_cents ELSE 0 END) paid_cents,
      SUM(CASE WHEN d.payment_status='pending' AND d.status!='cancelled' THEN d.charge_cents ELSE 0 END) pending_cents
    FROM deliveries d WHERE ${where.join(' AND ')}`).bind(...params).first<Row>();
  const group=cleanText(c.req.query('group')||'day',10);const expr=group==='year'?`strftime('%Y',COALESCE(d.delivered_at,d.created_at))`:group==='month'?`strftime('%Y-%m',COALESCE(d.delivered_at,d.created_at))`:group==='week'?`strftime('%Y-W%W',COALESCE(d.delivered_at,d.created_at))`:`date(COALESCE(d.delivered_at,d.created_at))`;
  const grouped=await c.env.DB.prepare(`SELECT ${expr} period,COUNT(*) total_orders,SUM(CASE WHEN d.status='delivered' THEN d.charge_cents ELSE 0 END) amount_cents,SUM(CASE WHEN d.status='delivered' THEN 1 ELSE 0 END) delivered_count FROM deliveries d WHERE ${where.join(' AND ')} GROUP BY period ORDER BY period DESC`).bind(...params).all<Row>();
  const items=await c.env.DB.prepare(`SELECT d.id,d.display_code,d.created_at,d.delivered_at,d.status,d.payment_status,d.customer_name,d.delivery_address,d.charge_cents,d.distance_meters,d.delivery_type,e.name establishment_name,b.name base_name,dr.name driver_name FROM deliveries d JOIN establishments e ON e.id=d.establishment_id LEFT JOIN bases b ON b.id=d.base_id LEFT JOIN drivers dr ON dr.id=d.assigned_driver_id WHERE ${where.join(' AND ')} ORDER BY COALESCE(d.delivered_at,d.created_at) DESC LIMIT 1500`).bind(...params).all<Row>();

  const guaranteeScope=guaranteeReportScope(auth,c);
  const guaranteeWhere=[...guaranteeScope.filters,`date(s.end_at) BETWEEN date(?) AND date(?)`];
  const guaranteeParams=[...guaranteeScope.params,from,to];
  const guaranteeSummary=await c.env.DB.prepare(`SELECT
      COUNT(*) complement_count,
      COUNT(DISTINCT date(s.end_at)) complement_days,
      COALESCE(SUM(gs.guaranteed_cents),0) guaranteed_cents,
      COALESCE(SUM(gs.eligible_delivery_cents),0) eligible_delivery_cents,
      COALESCE(SUM(gs.complement_cents),0) complement_cents
    FROM guarantee_settlements gs
    JOIN schedules s ON s.id=gs.schedule_id AND s.deleted_at IS NULL
    WHERE ${guaranteeWhere.join(' AND ')}`).bind(...guaranteeParams).first<Row>();
  const guaranteeByWeekday=await c.env.DB.prepare(`SELECT
      CAST(strftime('%w',s.end_at) AS INTEGER) weekday,
      COUNT(*) complement_count,
      COUNT(DISTINCT date(s.end_at)) complement_days,
      COALESCE(SUM(gs.guaranteed_cents),0) guaranteed_cents,
      COALESCE(SUM(gs.eligible_delivery_cents),0) eligible_delivery_cents,
      COALESCE(SUM(gs.complement_cents),0) complement_cents
    FROM guarantee_settlements gs
    JOIN schedules s ON s.id=gs.schedule_id AND s.deleted_at IS NULL
    WHERE ${guaranteeWhere.join(' AND ')}
    GROUP BY CAST(strftime('%w',s.end_at) AS INTEGER)
    ORDER BY CASE CAST(strftime('%w',s.end_at) AS INTEGER)
      WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 3 THEN 3 WHEN 4 THEN 4 WHEN 5 THEN 5 WHEN 6 THEN 6 ELSE 7 END`).bind(...guaranteeParams).all<Row>();
  const guaranteeItems=await c.env.DB.prepare(`SELECT
      gs.id,gs.schedule_id,date(s.end_at) day,s.start_at,s.end_at,
      dr.name driver_name,e.name establishment_name,
      gs.guaranteed_cents,gs.eligible_delivery_cents,gs.complement_cents
    FROM guarantee_settlements gs
    JOIN schedules s ON s.id=gs.schedule_id AND s.deleted_at IS NULL
    JOIN establishments e ON e.id=gs.establishment_id
    JOIN drivers dr ON dr.id=gs.driver_id
    WHERE ${guaranteeWhere.join(' AND ')}
    ORDER BY datetime(s.end_at) DESC,dr.name COLLATE NOCASE
    LIMIT 1500`).bind(...guaranteeParams).all<Row>();
  return c.json({
    ok:true,from,to,summary,grouped:grouped.results,items:items.results,
    guarantee_summary:guaranteeSummary||{},
    guarantee_by_weekday:guaranteeByWeekday.results||[],
    guarantee_items:guaranteeItems.results||[]
  });
});

platformV10Routes.get('/v10/reports/financial',async(c)=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const {from,to}=period(c),coop=auth.cooperativeId!;
  const delivery=await c.env.DB.prepare(`SELECT COUNT(*) total_orders,
      COALESCE(SUM(charge_cents),0) billed_cents,COALESCE(SUM(driver_gross_cents),0) driver_gross_cents,
      COALESCE(SUM(driver_net_cents),0) driver_net_cents,COALESCE(SUM(cooperative_fee_cents),0) cooperative_revenue_cents,
      COALESCE(SUM(distance_meters),0) distance_meters
    FROM deliveries WHERE cooperative_id=? AND status='delivered' AND deleted_at IS NULL AND date(delivered_at,'-3 hours') BETWEEN date(?) AND date(?)`).bind(coop,from,to).first<Row>();
  const guarantee=await c.env.DB.prepare(`SELECT
      COALESCE(SUM(CASE WHEN l.entry_kind='complement' AND f.entry_type='credit' THEN f.amount_cents ELSE 0 END),0) complement_cents,
      COALESCE(SUM(CASE WHEN l.entry_kind IN ('inss','sest_senat') AND f.entry_type='debit' THEN f.amount_cents ELSE 0 END),0) complement_deductions_cents
    FROM guarantee_settlement_financial_entries l
    JOIN financial_entries f ON f.id=l.financial_entry_id
    WHERE f.cooperative_id=? AND f.status!='cancelled' AND f.deleted_at IS NULL
      AND date(f.reference_date) BETWEEN date(?) AND date(?)`).bind(coop,from,to).first<Row>();
  const complementCents=Number(guarantee?.complement_cents||0);
  const complementDeductions=Number(guarantee?.complement_deductions_cents||0);
  const deductions=await c.env.DB.prepare(`SELECT COALESCE(SUM(amount_cents),0) deductions_cents FROM financial_entries WHERE cooperative_id=? AND entry_type='debit' AND status!='cancelled' AND deleted_at IS NULL AND date(reference_date) BETWEEN date(?) AND date(?)`).bind(coop,from,to).first<Row>();
  const expenses=await c.env.DB.prepare(`SELECT COALESCE(SUM(amount_cents),0) expenses_cents FROM cooperative_expenses WHERE cooperative_id=? AND status='active' AND deleted_at IS NULL AND date(reference_date) BETWEEN date(?) AND date(?)`).bind(coop,from,to).first<Row>();

  const deliveryBreakdown=await c.env.DB.prepare(`SELECT COALESCE(d.base_id,d.establishment_id) location_id,COALESCE(b.name,e.name,'Sem local') location_name,
      CASE WHEN d.base_id IS NULL THEN 'establishment' ELSE 'base' END location_type,COUNT(*) total_orders,
      COALESCE(SUM(d.charge_cents),0) billed_cents,COALESCE(SUM(d.driver_gross_cents),0) driver_gross_cents,
      COALESCE(SUM(d.cooperative_fee_cents),0) cooperative_revenue_cents
    FROM deliveries d JOIN establishments e ON e.id=d.establishment_id LEFT JOIN bases b ON b.id=d.base_id
    WHERE d.cooperative_id=? AND d.status='delivered' AND d.deleted_at IS NULL AND date(d.delivered_at,'-3 hours') BETWEEN date(?) AND date(?)
    GROUP BY d.base_id,d.establishment_id,location_id,location_name ORDER BY billed_cents DESC`).bind(coop,from,to).all<Row>();
  const complementBreakdown=await c.env.DB.prepare(`SELECT f.establishment_id location_id,COALESCE(e.name,'Estabelecimento') location_name,
      'establishment' location_type,0 total_orders,COALESCE(SUM(f.amount_cents),0) billed_cents,
      COALESCE(SUM(f.amount_cents),0) driver_gross_cents,0 cooperative_revenue_cents
    FROM guarantee_settlement_financial_entries l
    JOIN financial_entries f ON f.id=l.financial_entry_id
    LEFT JOIN establishments e ON e.id=f.establishment_id
    WHERE l.entry_kind='complement' AND f.cooperative_id=? AND f.entry_type='credit'
      AND f.status!='cancelled' AND f.deleted_at IS NULL AND date(f.reference_date) BETWEEN date(?) AND date(?)
    GROUP BY f.establishment_id,e.name`).bind(coop,from,to).all<Row>();
  const breakdownMap=new Map<string,Row>();
  for(const row of [...(deliveryBreakdown.results||[]),...(complementBreakdown.results||[])]){
    const key=`${row.location_type}:${row.location_id||row.location_name}`;
    const current=breakdownMap.get(key)||{location_id:row.location_id,location_name:row.location_name,location_type:row.location_type,total_orders:0,billed_cents:0,driver_gross_cents:0,cooperative_revenue_cents:0};
    current.total_orders+=Number(row.total_orders||0);
    current.billed_cents+=Number(row.billed_cents||0);
    current.driver_gross_cents+=Number(row.driver_gross_cents||0);
    current.cooperative_revenue_cents+=Number(row.cooperative_revenue_cents||0);
    breakdownMap.set(key,current);
  }
  const breakdown=[...breakdownMap.values()].sort((a,b)=>Number(b.billed_cents||0)-Number(a.billed_cents||0));

  const deliveryDaily=await c.env.DB.prepare(`SELECT date(delivered_at,'-3 hours') day,COALESCE(SUM(charge_cents),0) billed_cents,
      COALESCE(SUM(cooperative_fee_cents),0) cooperative_revenue_cents,COUNT(*) total_orders
    FROM deliveries WHERE cooperative_id=? AND status='delivered' AND deleted_at IS NULL
      AND date(delivered_at,'-3 hours') BETWEEN date(?) AND date(?)
    GROUP BY date(delivered_at,'-3 hours') ORDER BY day`).bind(coop,from,to).all<Row>();
  const complementDaily=await c.env.DB.prepare(`SELECT date(f.reference_date) day,COALESCE(SUM(f.amount_cents),0) billed_cents,
      0 cooperative_revenue_cents,0 total_orders
    FROM guarantee_settlement_financial_entries l
    JOIN financial_entries f ON f.id=l.financial_entry_id
    WHERE l.entry_kind='complement' AND f.cooperative_id=? AND f.entry_type='credit'
      AND f.status!='cancelled' AND f.deleted_at IS NULL AND date(f.reference_date) BETWEEN date(?) AND date(?)
    GROUP BY date(f.reference_date) ORDER BY day`).bind(coop,from,to).all<Row>();
  const dailyMap=new Map<string,Row>();
  for(const row of [...(deliveryDaily.results||[]),...(complementDaily.results||[])]){
    const key=String(row.day||'');
    const current=dailyMap.get(key)||{day:key,billed_cents:0,cooperative_revenue_cents:0,total_orders:0};
    current.billed_cents+=Number(row.billed_cents||0);
    current.cooperative_revenue_cents+=Number(row.cooperative_revenue_cents||0);
    current.total_orders+=Number(row.total_orders||0);
    dailyMap.set(key,current);
  }
  const daily=[...dailyMap.values()].sort((a,b)=>String(a.day).localeCompare(String(b.day)));

  const summary={
    ...delivery,
    billed_cents:Number(delivery?.billed_cents||0)+complementCents,
    driver_gross_cents:Number(delivery?.driver_gross_cents||0)+complementCents,
    driver_net_cents:Number(delivery?.driver_net_cents||0)+Math.max(0,complementCents-complementDeductions),
    deductions_cents:Number(deductions?.deductions_cents||0),
    expenses_cents:Number(expenses?.expenses_cents||0),
    net_result_cents:Number(delivery?.cooperative_revenue_cents||0)-Number(expenses?.expenses_cents||0),
    guarantee_complement_cents:complementCents
  };
  return c.json({ok:true,from,to,summary,breakdown,daily});
});

platformV10Routes.get('/v10/expenses',async(c)=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);const {from,to}=period(c),locationKey=cleanText(c.req.query('location_key'),150);
  let sql=`SELECT x.*,e.name establishment_name,b.name base_name,u.name created_by_name,
    CASE WHEN x.base_id IS NOT NULL THEN 'base' WHEN x.establishment_id IS NOT NULL THEN 'establishment' ELSE 'general' END location_type,
    COALESCE(x.base_id,x.establishment_id) location_id,COALESCE(b.name,e.name,'Geral') location_name
    FROM cooperative_expenses x LEFT JOIN establishments e ON e.id=x.establishment_id LEFT JOIN bases b ON b.id=x.base_id LEFT JOIN users u ON u.id=x.created_by
    WHERE x.cooperative_id=? AND x.deleted_at IS NULL AND date(x.reference_date) BETWEEN date(?) AND date(?)`;
  const params:any[]=[auth.cooperativeId,from,to];
  if(locationKey.startsWith('base:')){sql+=` AND x.base_id=?`;params.push(locationKey.slice(5));}
  else if(locationKey.startsWith('est:')){sql+=` AND x.establishment_id=?`;params.push(locationKey.slice(4));}
  else if(locationKey==='general')sql+=` AND x.base_id IS NULL AND x.establishment_id IS NULL`;
  sql+=` ORDER BY x.reference_date DESC,x.created_at DESC`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all<Row>(),items=rows.results||[];
  const total_cents=(items as Row[]).reduce((sum,row)=>sum+(row.status==='active'?Number(row.amount_cents||0):0),0);
  return c.json({ok:true,from,to,items,summary:{total_cents,count:items.length}});
});

platformV10Routes.post('/v10/expenses',async(c)=>{
  const auth=tenant(c,['cooperative_admin']);const b=await bodyJson<Row>(c),amount=toCents(b.amount),description=cleanText(b.description,500),category=cleanText(b.category,100),reference=cleanText(b.reference_date,10);
  if(!amount||!description||!category||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(reference))return c.json({ok:false,error:'Informe categoria, descrição, valor e data.'},400);
  let establishmentId=nullableText(b.establishment_id,100),baseId=nullableText(b.base_id,100);const locationKey=cleanText(b.location_key,150);
  if(locationKey.startsWith('base:')){baseId=locationKey.slice(5);establishmentId=null;}
  else if(locationKey.startsWith('est:')){establishmentId=locationKey.slice(4);baseId=null;}
  else if(locationKey==='general'){establishmentId=null;baseId=null;}
  if(establishmentId&&baseId)return c.json({ok:false,error:'Escolha somente um estabelecimento, uma Base ou Geral.'},400);
  if(establishmentId){const scope=await c.env.DB.prepare(`SELECT id FROM establishments WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(establishmentId,auth.cooperativeId).first();if(!scope)return c.json({ok:false,error:'Estabelecimento inválido.'},400);}
  if(baseId){const scope=await c.env.DB.prepare(`SELECT id FROM bases WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(baseId,auth.cooperativeId).first();if(!scope)return c.json({ok:false,error:'Base inválida.'},400);}
  const expenseId=id();
  await c.env.DB.prepare(`INSERT INTO cooperative_expenses (id,cooperative_id,establishment_id,base_id,category,description,amount_cents,reference_date,attachment_url,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(expenseId,auth.cooperativeId,establishmentId,baseId,category,description,amount,reference,nullableText(b.attachment_url,700),auth.id).run();
  await audit(c,'create','cooperative_expense',expenseId,null,{category,description,amount,reference,establishment_id:establishmentId,base_id:baseId},auth.cooperativeId||undefined);
  return c.json({ok:true,id:expenseId},201);
});

platformV10Routes.delete('/v10/expenses/:id',async(c)=>{
  const auth=tenant(c,['cooperative_admin']);const before=await c.env.DB.prepare(`SELECT * FROM cooperative_expenses WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!before)return c.json({ok:false,error:'Despesa não encontrada.'},404);
  await c.env.DB.prepare(`UPDATE cooperative_expenses SET status='cancelled',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(before.id).run();
  await audit(c,'delete','cooperative_expense',before.id,before,null,auth.cooperativeId||undefined);return c.json({ok:true});
});

platformV10Routes.get('/v10/base/customers',async(c)=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const rows=await c.env.DB.prepare(`SELECT c.id,c.name,c.phone,c.email,c.created_at,
      COALESCE((SELECT SUM(CASE WHEN t.entry_type='credit' THEN t.amount_cents ELSE -t.amount_cents END) FROM customer_wallet_transactions t JOIN customer_wallets w ON w.id=t.wallet_id WHERE w.customer_id=c.id AND t.cooperative_id=?),0) balance_cents,
      (SELECT COUNT(*) FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=?) total_orders,
      (SELECT MAX(r.created_at) FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=?) last_order_at
    FROM customers c WHERE EXISTS(SELECT 1 FROM cooperative_customers cc WHERE cc.customer_id=c.id AND cc.cooperative_id=? AND cc.status='active')
      OR (NOT EXISTS(SELECT 1 FROM cooperative_customers cc0 WHERE cc0.customer_id=c.id AND cc0.cooperative_id=?)
        AND (EXISTS(SELECT 1 FROM customer_requests r WHERE r.customer_id=c.id AND r.cooperative_id=?)
          OR EXISTS(SELECT 1 FROM customer_wallets w JOIN customer_wallet_transactions t ON t.wallet_id=w.id WHERE w.customer_id=c.id AND t.cooperative_id=?)))
    ORDER BY c.name COLLATE NOCASE`).bind(auth.cooperativeId,auth.cooperativeId,auth.cooperativeId,auth.cooperativeId,auth.cooperativeId,auth.cooperativeId,auth.cooperativeId).all<Row>();
  return c.json({ok:true,items:rows.results});
});

platformV10Routes.post('/v10/base/customers',async(c)=>{
  const auth=tenant(c,['cooperative_admin']);
  const body=await bodyJson<Row>(c);
  const name=cleanText(body.name,150),phone=cleanText(body.phone,50),email=cleanText(body.email,200).toLowerCase();
  if(!name||(!phone&&!email))return c.json({ok:false,error:'Informe o nome e pelo menos um telefone ou e-mail.'},400);
  let customer:Row|null=null;
  if(email)customer=await c.env.DB.prepare(`SELECT * FROM customers WHERE lower(trim(email))=? ORDER BY created_at DESC LIMIT 1`).bind(email).first<Row>();
  if(!customer&&phone)customer=await c.env.DB.prepare(`SELECT * FROM customers WHERE trim(phone)=? ORDER BY created_at DESC LIMIT 1`).bind(phone).first<Row>();
  const customerId=customer?.id||id();
  const statements:D1PreparedStatement[]=[];
  if(!customer){
    statements.push(c.env.DB.prepare(`INSERT INTO customers (id,name,phone,email) VALUES (?,?,?,?)`).bind(customerId,name,phone,email||null));
  }else{
    statements.push(c.env.DB.prepare(`UPDATE customers SET name=?,phone=CASE WHEN ?!='' THEN ? ELSE phone END,email=CASE WHEN ?!='' THEN ? ELSE email END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(name,phone,phone,email,email,customerId));
  }
  statements.push(c.env.DB.prepare(`INSERT INTO cooperative_customers (cooperative_id,customer_id,status,created_by) VALUES (?,?,'active',?) ON CONFLICT(cooperative_id,customer_id) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP`).bind(auth.cooperativeId,customerId,auth.id));
  let wallet=await c.env.DB.prepare(`SELECT id FROM customer_wallets WHERE customer_id=?`).bind(customerId).first<Row>();
  if(!wallet){wallet={id:id()};statements.push(c.env.DB.prepare(`INSERT INTO customer_wallets (id,customer_id,balance_cents) VALUES (?,?,0)`).bind(wallet.id,customerId));}
  await c.env.DB.batch(statements);
  await audit(c,'create','cooperative_customer',customerId,null,{name,phone,email},auth.cooperativeId||undefined);
  return c.json({ok:true,item:{id:customerId,name,phone,email,balance_cents:0}},201);
});

platformV10Routes.post('/v10/base/customers/:id/credit',async(c)=>{
  const auth=tenant(c,['cooperative_admin']);
  const customerId=cleanText(c.req.param('id'),100),body=await bodyJson<Row>(c),mode=cleanText(body.mode||'add',20);
  const amount=toCents(body.amount),description=cleanText(body.description||'Ajuste manual de crédito pela cooperativa',500);
  if(!['add','remove','set'].includes(mode))return c.json({ok:false,error:'Tipo de ajuste inválido.'},400);
  if(mode!=='set'&&amount<=0)return c.json({ok:false,error:'Informe um valor maior que zero.'},400);
  const customer=await c.env.DB.prepare(`SELECT c.* FROM customers c JOIN cooperative_customers cc ON cc.customer_id=c.id WHERE c.id=? AND cc.cooperative_id=? AND cc.status='active'`).bind(customerId,auth.cooperativeId).first<Row>();
  if(!customer)return c.json({ok:false,error:'Cliente não encontrado nesta cooperativa.'},404);
  let wallet=await c.env.DB.prepare(`SELECT id,balance_cents FROM customer_wallets WHERE customer_id=?`).bind(customerId).first<Row>();
  if(!wallet){wallet={id:id(),balance_cents:0};await c.env.DB.prepare(`INSERT INTO customer_wallets (id,customer_id,balance_cents) VALUES (?,?,0)`).bind(wallet.id,customerId).run();}
  const balanceRow=await c.env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN t.entry_type='credit' THEN t.amount_cents ELSE -t.amount_cents END),0) balance_cents FROM customer_wallet_transactions t WHERE t.wallet_id=? AND t.cooperative_id=? AND t.status='confirmed'`).bind(wallet.id,auth.cooperativeId).first<Row>();
  const current=Number(balanceRow?.balance_cents||0),delta=mode==='set'?amount-current:mode==='remove'?-Math.abs(amount):Math.abs(amount);
  if(delta===0)return c.json({ok:true,balance_cents:current});
  const entryType=delta>0?'credit':'debit',category=mode==='set'?'manual_balance_adjustment':delta>0?'manual_credit':'manual_debit';
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO cooperative_customers (cooperative_id,customer_id,status,created_by) VALUES (?,?,'active',?) ON CONFLICT(cooperative_id,customer_id) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP`).bind(auth.cooperativeId,customerId,auth.id),
    c.env.DB.prepare(`UPDATE customer_wallets SET balance_cents=balance_cents+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delta,wallet.id),
    c.env.DB.prepare(`INSERT INTO customer_wallet_transactions (id,wallet_id,cooperative_id,entry_type,category,amount_cents,description,reason) VALUES (?,?,?,?,?,?,?,?)`).bind(id(),wallet.id,auth.cooperativeId,entryType,category,Math.abs(delta),description,`Ajuste realizado por ${auth.name}`)
  ]);
  await audit(c,'credit','customer_wallet',customerId,{balance_cents:current},{balance_cents:current+delta,delta_cents:delta,description},auth.cooperativeId||undefined);
  return c.json({ok:true,balance_cents:current+delta});
});

platformV10Routes.put('/v10/base/customers/:id',async(c)=>{
  const auth=tenant(c,['cooperative_admin']);const customerId=cleanText(c.req.param('id'),100),body=await bodyJson<Row>(c);
  const before=await c.env.DB.prepare(`SELECT c.id,c.name,c.phone,c.email FROM customers c JOIN cooperative_customers cc ON cc.customer_id=c.id WHERE c.id=? AND cc.cooperative_id=? AND cc.status='active'`).bind(customerId,auth.cooperativeId).first<Row>();
  if(!before)return c.json({ok:false,error:'Cliente não encontrado nesta cooperativa.'},404);
  const name=cleanText(body.name||before.name,150),phone=cleanText(body.phone??before.phone,50),email=cleanText(body.email??before.email,200).toLowerCase()||null;
  if(!name||(!phone&&!email))return c.json({ok:false,error:'Informe o nome e pelo menos um telefone ou e-mail.'},400);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE customers SET name=?,phone=?,email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(name,phone,email,customerId),
    c.env.DB.prepare(`UPDATE customer_accounts SET email=CASE WHEN provider='password' THEN ? ELSE email END,phone=CASE WHEN provider='password' THEN ? ELSE phone END,updated_at=CURRENT_TIMESTAMP WHERE customer_id=?`).bind(email,phone,customerId)
  ]);
  await audit(c,'update','cooperative_customer',customerId,before,{name,phone,email},auth.cooperativeId||undefined);
  return c.json({ok:true,item:{id:customerId,name,phone,email}});
});

platformV10Routes.get('/v10/base/customers/:id/history',async(c)=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);const customerId=cleanText(c.req.param('id'),100);
  const customer=await c.env.DB.prepare(`SELECT c.id,c.name,c.phone,c.email FROM customers c JOIN cooperative_customers cc ON cc.customer_id=c.id WHERE c.id=? AND cc.cooperative_id=? AND cc.status='active'`).bind(customerId,auth.cooperativeId).first<Row>();
  if(!customer)return c.json({ok:false,error:'Cliente não encontrado nesta cooperativa.'},404);
  const wallet=await c.env.DB.prepare(`SELECT id FROM customer_wallets WHERE customer_id=?`).bind(customerId).first<Row>();
  const transactions=wallet?await c.env.DB.prepare(`SELECT t.id,t.entry_type,t.category,t.amount_cents,t.description,t.reason,t.status,t.created_at,t.delivery_id,d.display_code FROM customer_wallet_transactions t LEFT JOIN deliveries d ON d.id=t.delivery_id WHERE t.wallet_id=? AND t.cooperative_id=? ORDER BY t.created_at DESC LIMIT 500`).bind(wallet.id,auth.cooperativeId).all<Row>():{results:[]};
  const orders=await c.env.DB.prepare(`SELECT r.id,r.delivery_id,r.quoted_cents,r.credit_used_cents,r.status,r.created_at,r.pickup_address,r.delivery_address,d.display_code,d.status delivery_status FROM customer_requests r LEFT JOIN deliveries d ON d.id=r.delivery_id WHERE r.customer_id=? AND r.cooperative_id=? ORDER BY r.created_at DESC LIMIT 200`).bind(customerId,auth.cooperativeId).all<Row>();
  const balance=Number((await c.env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN t.entry_type='credit' THEN t.amount_cents ELSE -t.amount_cents END),0) balance_cents FROM customer_wallet_transactions t JOIN customer_wallets w ON w.id=t.wallet_id WHERE w.customer_id=? AND t.cooperative_id=? AND t.status='confirmed'`).bind(customerId,auth.cooperativeId).first<Row>())?.balance_cents||0);
  return c.json({ok:true,customer,balance_cents:balance,transactions:transactions.results,orders:orders.results});
});

platformV10Routes.delete('/v10/base/customers/:id',async(c)=>{
  const auth=tenant(c,['cooperative_admin']);const customerId=cleanText(c.req.param('id'),100);
  const before=await c.env.DB.prepare(`SELECT c.id,c.name,c.phone,c.email,cc.status FROM customers c JOIN cooperative_customers cc ON cc.customer_id=c.id WHERE c.id=? AND cc.cooperative_id=? AND cc.status='active'`).bind(customerId,auth.cooperativeId).first<Row>();
  if(!before)return c.json({ok:false,error:'Cliente não encontrado nesta cooperativa.'},404);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE cooperative_customers SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE cooperative_id=? AND customer_id=?`).bind(auth.cooperativeId,customerId),
    c.env.DB.prepare(`UPDATE credit_purchase_requests SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE cooperative_id=? AND customer_id=? AND status='pending'`).bind(auth.cooperativeId,customerId)
  ]);
  await audit(c,'delete','cooperative_customer',customerId,before,{status:'inactive'},auth.cooperativeId||undefined);
  return c.json({ok:true});
});
