import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { assertRole, bodyJson, cleanText, id, nullableText } from '../lib/util';
import { distanceMeters } from '../lib/queue';

export const platformV25Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

function validPoint(lat:number,lng:number){
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&Math.abs(lat)+Math.abs(lng)>=0.01;
}

async function activeSchedule(env:AppBindings['Bindings'],cooperativeId:string,driverId:string,type:string,locationId:string){
  return env.DB.prepare(`SELECT s.id,s.contract_id,s.start_at,s.end_at,s.shift_label,
      COALESCE(b.name,e.name) location_name,COALESCE(b.address,e.address) location_address,
      COALESCE(b.latitude,e.latitude) latitude,COALESCE(b.longitude,e.longitude) longitude
    FROM schedules s
    LEFT JOIN bases b ON b.id=s.base_id
    LEFT JOIN establishments e ON e.id=s.establishment_id
    WHERE s.cooperative_id=? AND s.driver_id=? AND s.deleted_at IS NULL
      AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work'
      AND ((?='base' AND s.base_id=?) OR (?='establishment' AND s.establishment_id=?))
      AND datetime(s.start_at)<=datetime('now','-3 hours','+30 minutes')
      AND datetime(s.end_at)>datetime('now','-3 hours')
    ORDER BY ABS(strftime('%s',s.start_at)-strftime('%s','now','-3 hours')) LIMIT 1`)
    .bind(cooperativeId,driverId,type,locationId,type,locationId).first<Row>();
}

platformV25Routes.get('/v25/driver/checkin/locations',async c=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
  const rows=await c.env.DB.prepare(`SELECT s.id schedule_id,s.contract_id,s.start_at,s.end_at,s.shift_label,
      CASE WHEN s.base_id IS NOT NULL THEN 'base' ELSE 'establishment' END location_type,
      COALESCE(s.base_id,s.establishment_id) location_id,COALESCE(b.name,e.name) location_name,
      COALESCE(b.address,e.address) location_address,COALESCE(b.latitude,e.latitude) latitude,COALESCE(b.longitude,e.longitude) longitude
    FROM schedules s LEFT JOIN bases b ON b.id=s.base_id LEFT JOIN establishments e ON e.id=s.establishment_id
    WHERE s.cooperative_id=? AND s.driver_id=? AND s.deleted_at IS NULL
      AND s.status IN ('scheduled','confirmed') AND COALESCE(s.entry_type,'work')='work'
      AND datetime(s.start_at)<=datetime('now','-3 hours','+30 minutes') AND datetime(s.end_at)>datetime('now','-3 hours')
    ORDER BY s.start_at`).bind(auth.cooperativeId,auth.driverId).all<Row>();
  const active=await c.env.DB.prepare(`SELECT p.*,COALESCE(b.name,e.name) location_name,COALESCE(b.address,e.address) location_address
    FROM presence_sessions p LEFT JOIN bases b ON b.id=p.base_id LEFT JOIN establishments e ON e.id=p.establishment_id
    WHERE p.driver_id=? AND p.checkout_at IS NULL ORDER BY p.checkin_at DESC LIMIT 1`).bind(auth.driverId).first<Row>();
  return c.json({ok:true,items:rows.results||[],active,radius_meters:200});
});

platformV25Routes.post('/v25/driver/checkin',async c=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
  const body=await bodyJson<Row>(c),type=cleanText(body.location_type,20),locationId=cleanText(body.location_id,100);
  const latitude=Number(body.latitude),longitude=Number(body.longitude);
  if(!['base','establishment'].includes(type)||!locationId)return c.json({ok:false,error:'Selecione o local da sua escala.'},400);
  if(!validPoint(latitude,longitude))return c.json({ok:false,error:'Ative a localização precisa para fazer o check-in.'},400);
  const schedule=await activeSchedule(c.env,auth.cooperativeId,auth.driverId,type,locationId);
  if(!schedule)return c.json({ok:false,error:'Você não possui uma escala ativa neste local agora.'},403);
  const localLat=Number(schedule.latitude),localLng=Number(schedule.longitude);
  if(!validPoint(localLat,localLng))return c.json({ok:false,error:'A localização deste local ainda não foi configurada.'},409);
  const distance=distanceMeters(latitude,longitude,localLat,localLng);
  if(distance>200)return c.json({ok:false,error:`Você está a ${distance} m de ${schedule.location_name}. O check-in é permitido até 200 m.`},403);
  const existing=await c.env.DB.prepare(`SELECT p.*,COALESCE(b.name,e.name) location_name FROM presence_sessions p
    LEFT JOIN bases b ON b.id=p.base_id LEFT JOIN establishments e ON e.id=p.establishment_id
    WHERE p.driver_id=? AND p.checkout_at IS NULL ORDER BY p.checkin_at DESC LIMIT 1`).bind(auth.driverId).first<Row>();
  if(existing){
    const same=(type==='base'&&existing.base_id===locationId)||(type==='establishment'&&existing.establishment_id===locationId);
    if(same)return c.json({ok:true,already_checked_in:true,item:existing,message:`Check-in já está ativo em ${schedule.location_name}.`});
    return c.json({ok:false,error:`Você já possui check-in ativo em ${existing.location_name||'outro local'}.`},409);
  }
  const presenceId=id();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO presence_sessions(id,cooperative_id,driver_id,location_type,establishment_id,base_id,schedule_id,contract_id,checkin_lat,checkin_lng,source,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,'geofence','Check-in automático por proximidade de até 200 metros')`)
      .bind(presenceId,auth.cooperativeId,auth.driverId,type,type==='establishment'?locationId:null,type==='base'?locationId:null,schedule.id,schedule.contract_id||null,latitude,longitude),
    c.env.DB.prepare(`UPDATE drivers SET online=1,current_lat=?,current_lng=?,location_updated_at=CURRENT_TIMESTAMP,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=?`)
      .bind(latitude,longitude,auth.driverId,auth.cooperativeId)
  ]);
  return c.json({ok:true,id:presenceId,message:`Check-in confirmado em ${schedule.location_name}.`,distance_meters:distance});
});

platformV25Routes.post('/v25/driver/queue/arrive',async c=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
  const body=await bodyJson<Row>(c),type=cleanText(body.location_type,20),locationId=cleanText(body.location_id,100);
  const latitude=Number(body.latitude),longitude=Number(body.longitude);
  if(!['base','establishment'].includes(type)||!locationId)return c.json({ok:false,error:'Selecione a fila da sua escala.'},400);
  if(!validPoint(latitude,longitude))return c.json({ok:false,error:'Ative a localização precisa para entrar na fila.'},400);

  const activeDelivery=await c.env.DB.prepare(`SELECT id,display_code,status FROM deliveries
    WHERE cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL
      AND status IN ('assigned','accepted','to_pickup','at_pickup','picked_up','in_route','problem')
    ORDER BY created_at LIMIT 1`).bind(auth.cooperativeId,auth.driverId).first<Row>();
  if(activeDelivery)return c.json({ok:false,error:`Você já está com a entrega ${activeDelivery.display_code||''}. Finalize-a antes de entrar na fila.`},409);

  const schedule=await activeSchedule(c.env,auth.cooperativeId,auth.driverId,type,locationId);
  if(!schedule)return c.json({ok:false,error:'Você não possui uma escala ativa neste local agora.'},403);
  const localLat=Number(schedule.latitude),localLng=Number(schedule.longitude);
  if(!validPoint(localLat,localLng))return c.json({ok:false,error:'A localização deste local ainda não foi configurada.'},409);
  const distance=distanceMeters(latitude,longitude,localLat,localLng);
  if(distance>50)return c.json({ok:false,error:`Você está a ${distance} m de ${schedule.location_name}. A fila só é liberada até 50 m.`},403);
  const driver=await c.env.DB.prepare(`SELECT online,status,on_leave FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(auth.driverId,auth.cooperativeId).first<Row>();
  if(!driver||driver.status!=='active'||Number(driver.on_leave||0)===1||Number(driver.online||0)!==1)return c.json({ok:false,error:'Faça o check-in ou fique online antes de entrar na fila.'},409);
  if(type==='establishment'){
    const block=await c.env.DB.prepare(`SELECT reason FROM driver_establishment_blocks WHERE cooperative_id=? AND driver_id=? AND establishment_id=? AND active=1 LIMIT 1`).bind(auth.cooperativeId,auth.driverId,locationId).first<Row>();
    if(block)return c.json({ok:false,error:`Você está bloqueado para atuar neste estabelecimento${block.reason?`: ${block.reason}`:''}.`},403);
  }
  const presence=await c.env.DB.prepare(`SELECT id FROM presence_sessions WHERE driver_id=? AND checkout_at IS NULL AND ((?='base' AND base_id=?) OR (?='establishment' AND establishment_id=?)) ORDER BY checkin_at DESC LIMIT 1`)
    .bind(auth.driverId,type,locationId,type,locationId).first<Row>();
  const existing=await c.env.DB.prepare(`SELECT * FROM waiting_queue WHERE driver_id=? AND status='waiting' LIMIT 1`).bind(auth.driverId).first<Row>();
  if(existing&&((type==='base'&&existing.base_id===locationId)||(type==='establishment'&&existing.establishment_id===locationId)))return c.json({ok:true,item:existing,already_waiting:true});
  const entryId=id(),statements:D1PreparedStatement[]=[];
  if(existing)statements.push(c.env.DB.prepare(`UPDATE waiting_queue SET status='left',left_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(existing.id));
  const order=await c.env.DB.prepare(`SELECT COALESCE(MAX(queue_order),0)+1 next_order FROM waiting_queue WHERE cooperative_id=? AND status='waiting' AND ((?='base' AND base_id=? AND establishment_id IS NULL) OR (?='establishment' AND establishment_id=? AND base_id IS NULL))`)
    .bind(auth.cooperativeId,type,locationId,type,locationId).first<Row>();
  statements.push(c.env.DB.prepare(`INSERT INTO waiting_queue(id,cooperative_id,establishment_id,base_id,driver_id,status,source,notes,arrival_lat,arrival_lng,distance_meters,location_verified,presence_session_id,queue_order)
    VALUES(?,?,?,?,?,'waiting','driver_app',?,?,?,?,1,?,?)`).bind(entryId,auth.cooperativeId,type==='establishment'?locationId:null,type==='base'?locationId:null,auth.driverId,nullableText(body.notes,300),latitude,longitude,distance,presence?.id||null,Math.max(1,Number(order?.next_order||1))));
  await c.env.DB.batch(statements);
  return c.json({ok:true,id:entryId,distance_meters:distance});
});
