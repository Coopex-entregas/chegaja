import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { getMapsRuntimeConfig } from '../lib/platform-config';
import { bodyJson, toNumber } from '../lib/util';

export const mapSafeRoutes = new Hono<AppBindings>();
export const publicMapSafeRoutes = new Hono<AppBindings>();
type Row = Record<string, any>;

publicMapSafeRoutes.get('/maps-config', async c => {
  const config=await getMapsRuntimeConfig(c.env);
  const enabled=config.provider==='google'&&Boolean(config.browserKey);
  return c.json({ok:true,item:{provider:enabled?'google':'openstreetmap',requested_provider:config.provider,enabled,api_key:enabled?config.browserKey:null,map_id:config.mapId||'DEMO_MAP_ID'}});
});

mapSafeRoutes.get('/map/self', async c => {
  const auth=c.get('auth');
  if(auth.role!=='driver'||!auth.driverId||!auth.cooperativeId)return c.json({ok:false,error:'Acesso exclusivo do cooperado.'},403);
  const driver=await c.env.DB.prepare(`SELECT id,name,photo_url,vehicle_model,vehicle_plate,online,current_lat,current_lng,location_updated_at,last_seen_at FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1`).bind(auth.driverId,auth.cooperativeId).first<Row>();
  return c.json({ok:true,driver});
});

// Atualização leve: mantém a posição atual em tempo real, mas grava histórico no máximo
// uma vez a cada 30 segundos. Isso evita milhões de linhas desnecessárias no D1.
mapSafeRoutes.post('/map/location', async c => {
  const auth=c.get('auth');
  if(auth.role!=='driver'||!auth.driverId||!auth.cooperativeId)return c.json({ok:false,error:'Acesso exclusivo do cooperado.'},403);
  const body=await bodyJson<Row>(c),lat=toNumber(body.latitude),lng=toNumber(body.longitude),accuracy=toNumber(body.accuracy),speed=toNumber(body.speed),heading=toNumber(body.heading),battery=toNumber(body.battery);
  if(lat==null||lng==null||Math.abs(lat)>90||Math.abs(lng)>180)return c.json({ok:false,error:'Localização inválida.'},400);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE drivers SET online=1,last_seen_at=CURRENT_TIMESTAMP,current_lat=?,current_lng=?,location_accuracy=?,location_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=?`).bind(lat,lng,accuracy,auth.driverId,auth.cooperativeId),
    c.env.DB.prepare(`INSERT INTO driver_locations(cooperative_id,driver_id,latitude,longitude,accuracy,speed,heading,battery) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM driver_locations WHERE driver_id=? AND recorded_at>=datetime('now','-30 seconds'))`).bind(auth.cooperativeId,auth.driverId,lat,lng,accuracy,speed,heading,battery,auth.driverId)
  ]);
  return c.json({ok:true,stored_at:new Date().toISOString()});
});

mapSafeRoutes.get('/map/drivers', async c => {
  const auth=c.get('auth'),requested=String(c.req.query('cooperative_id')||'').trim();
  let sql=`SELECT d.id,d.cooperative_id,d.name,d.photo_url,d.phone,d.vehicle_model,d.vehicle_plate,d.online,d.last_seen_at,d.current_lat,d.current_lng,d.location_updated_at,c.name cooperative_name FROM drivers d JOIN cooperatives c ON c.id=d.cooperative_id WHERE d.deleted_at IS NULL AND d.status='active' AND d.current_lat IS NOT NULL AND d.current_lng IS NOT NULL`;
  const params:unknown[]=[];
  if(auth.role==='platform_admin'){if(requested){sql+=' AND d.cooperative_id=?';params.push(requested)}}else{if(!auth.cooperativeId)return c.json({ok:true,items:[]});sql+=' AND d.cooperative_id=?';params.push(auth.cooperativeId)}
  if(auth.role==='driver'&&auth.driverId){sql+=' AND d.id=?';params.push(auth.driverId)}
  if(auth.role==='establishment'&&auth.establishmentId){sql+=` AND (EXISTS(SELECT 1 FROM deliveries x WHERE x.assigned_driver_id=d.id AND x.establishment_id=? AND x.deleted_at IS NULL AND x.status NOT IN ('delivered','cancelled')) OR EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.establishment_id=? AND s.deleted_at IS NULL AND date(s.start_at)>=date('now','-1 day')))`;params.push(auth.establishmentId,auth.establishmentId)}
  sql+=' ORDER BY d.online DESC,d.location_updated_at DESC,d.name LIMIT 1500';
  const rows=await c.env.DB.prepare(sql).bind(...params).all<Row>();
  return c.json({ok:true,items:rows.results||[]});
});
