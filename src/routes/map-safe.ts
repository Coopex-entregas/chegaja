import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { bodyJson, toNumber } from '../lib/util';

export const mapSafeRoutes = new Hono<AppBindings>();
export const publicMapSafeRoutes = new Hono<AppBindings>();
type Row = Record<string, any>;

publicMapSafeRoutes.get('/maps-config', async c => c.json({ok:true,item:{provider:'openstreetmap',requested_provider:'openstreetmap',enabled:true,api_key:null,map_id:null,key_source:'none'}}));

mapSafeRoutes.get('/map/self', async c => {
  const auth=c.get('auth');if(auth.role!=='driver'||!auth.driverId||!auth.cooperativeId)return c.json({ok:false,error:'Acesso exclusivo do cooperado.'},403);
  const driver=await c.env.DB.prepare(`SELECT id,name,photo_url,vehicle_model,vehicle_plate,online,current_lat,current_lng,location_accuracy,location_updated_at,last_seen_at FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1`).bind(auth.driverId,auth.cooperativeId).first<Row>();
  return c.json({ok:true,driver});
});

// Logout é uma das poucas ações explícitas que encerram a disponibilidade.
mapSafeRoutes.post('/driver/logout', async c => {
  const auth=c.get('auth');if(auth.role!=='driver'||!auth.driverId||!auth.cooperativeId)return c.json({ok:false,error:'Acesso exclusivo do cooperado.'},403);
  await c.env.DB.prepare(`UPDATE drivers SET online=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=?`).bind(auth.driverId,auth.cooperativeId).run();
  return c.json({ok:true,online:false});
});

// GPS e heartbeat nunca alteram drivers.online.
mapSafeRoutes.post('/map/location', async c => {
  const auth=c.get('auth');if(auth.role!=='driver'||!auth.driverId||!auth.cooperativeId)return c.json({ok:false,error:'Acesso exclusivo do cooperado.'},403);
  const current=await c.env.DB.prepare(`SELECT online FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1`).bind(auth.driverId,auth.cooperativeId).first<Row>();
  if(!current||Number(current.online||0)!==1)return c.json({ok:true,ignored:true,online:false});
  const body=await bodyJson<Row>(c),lat=toNumber(body.latitude),lng=toNumber(body.longitude),accuracy=toNumber(body.accuracy),speed=toNumber(body.speed),heading=toNumber(body.heading),battery=toNumber(body.battery);
  if(lat==null||lng==null||Math.abs(lat)>90||Math.abs(lng)>180)return c.json({ok:false,error:'Localização inválida.'},400);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE drivers SET last_seen_at=CURRENT_TIMESTAMP,current_lat=?,current_lng=?,location_accuracy=?,location_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND online=1`).bind(lat,lng,accuracy,auth.driverId,auth.cooperativeId),
    c.env.DB.prepare(`INSERT INTO driver_locations(cooperative_id,driver_id,latitude,longitude,accuracy,speed,heading,battery) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM driver_locations WHERE driver_id=? AND recorded_at>=datetime('now','-30 seconds'))`).bind(auth.cooperativeId,auth.driverId,lat,lng,accuracy,speed,heading,battery,auth.driverId)
  ]);
  return c.json({ok:true,online:true,stored_at:new Date().toISOString()});
});

mapSafeRoutes.get('/map/drivers', async c => {
  const auth=c.get('auth'),requested=String(c.req.query('cooperative_id')||'').trim();
  if(auth.role==='establishment'){
    if(!auth.establishmentId||!auth.cooperativeId)return c.json({ok:true,items:[],location_allowed:false});
    const establishment=await c.env.DB.prepare(`SELECT id,name,driver_map_enabled FROM establishments WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1`).bind(auth.establishmentId,auth.cooperativeId).first<Row>();
    if(!establishment||Number(establishment.driver_map_enabled||0)!==1)return c.json({ok:true,items:[],location_allowed:false});
    const rows=await c.env.DB.prepare(`
      SELECT d.id,d.cooperative_id,d.name,d.photo_url,d.phone,d.vehicle_model,d.vehicle_plate,
        CASE WHEN d.online=1 THEN 1 ELSE 0 END online,
        CASE WHEN d.last_seen_at IS NOT NULL AND datetime(d.last_seen_at)>=datetime('now','-10 minutes') THEN 1 ELSE 0 END heartbeat_fresh,
        d.last_seen_at,d.current_lat,d.current_lng,d.location_accuracy,d.location_updated_at,? cooperative_name,
        (SELECT s.start_at FROM schedules s WHERE s.driver_id=d.id AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=date('now','-3 hours') ORDER BY s.start_at LIMIT 1) schedule_start,
        (SELECT s.end_at FROM schedules s WHERE s.driver_id=d.id AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=date('now','-3 hours') ORDER BY s.start_at LIMIT 1) schedule_end,
        ? schedule_location
      FROM drivers d
      WHERE d.cooperative_id=? AND d.deleted_at IS NULL AND d.status='active'
        AND EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.establishment_id=? AND s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=date('now','-3 hours'))
      ORDER BY online DESC,d.location_updated_at DESC,d.name LIMIT 300`)
      .bind(String(establishment.name||''),auth.establishmentId,auth.establishmentId,String(establishment.name||''),auth.cooperativeId,auth.establishmentId).all<Row>();
    return c.json({ok:true,items:rows.results||[],location_allowed:true});
  }
  let sql=`SELECT d.id,d.cooperative_id,d.name,d.photo_url,d.phone,d.vehicle_model,d.vehicle_plate,
    CASE WHEN d.online=1 THEN 1 ELSE 0 END online,
    CASE WHEN d.last_seen_at IS NOT NULL AND datetime(d.last_seen_at)>=datetime('now','-10 minutes') THEN 1 ELSE 0 END heartbeat_fresh,
    d.last_seen_at,d.current_lat,d.current_lng,d.location_accuracy,d.location_updated_at,c.name cooperative_name
    FROM drivers d JOIN cooperatives c ON c.id=d.cooperative_id
    WHERE d.deleted_at IS NULL AND d.status='active' AND d.current_lat IS NOT NULL AND d.current_lng IS NOT NULL`;
  const params:unknown[]=[];
  if(auth.role==='platform_admin'){if(requested){sql+=' AND d.cooperative_id=?';params.push(requested)}}else{if(!auth.cooperativeId)return c.json({ok:true,items:[],location_allowed:true});sql+=' AND d.cooperative_id=?';params.push(auth.cooperativeId)}
  if(auth.role==='driver'&&auth.driverId){sql+=' AND d.id=?';params.push(auth.driverId)}
  sql+=' ORDER BY online DESC,d.location_updated_at DESC,d.name LIMIT 1500';
  const rows=await c.env.DB.prepare(sql).bind(...params).all<Row>();return c.json({ok:true,items:rows.results||[],location_allowed:true});
});
