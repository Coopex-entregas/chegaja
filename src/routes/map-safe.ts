import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { getMapsRuntimeConfig } from '../lib/platform-config';

export const mapSafeRoutes = new Hono<AppBindings>();
export const publicMapSafeRoutes = new Hono<AppBindings>();
type Row = Record<string, any>;

// A chave usada pelo Maps JavaScript é pública no navegador. Ela deve permanecer
// restrita no Google Cloud ao domínio do ChegaJá e somente às APIs necessárias.
// Esta rota permite que o rastreio do cliente carregue o mesmo provedor selecionado
// pelo Administrador Master sem exigir login.
publicMapSafeRoutes.get('/maps-config', async c => {
  const config=await getMapsRuntimeConfig(c.env);
  const enabled=config.provider==='google'&&Boolean(config.browserKey);
  return c.json({
    ok:true,
    item:{
      provider:enabled?'google':'openstreetmap',
      requested_provider:config.provider,
      enabled,
      api_key:enabled?config.browserKey:null,
      map_id:config.mapId||'DEMO_MAP_ID'
    }
  });
});

mapSafeRoutes.get('/map/self', async c => {
  const auth=c.get('auth');
  if(auth.role!=='driver'||!auth.driverId||!auth.cooperativeId){
    return c.json({ok:false,error:'Acesso exclusivo do cooperado.'},403);
  }
  const driver=await c.env.DB.prepare(`
    SELECT id,name,photo_url,vehicle_model,vehicle_plate,online,
           current_lat,current_lng,location_updated_at,last_seen_at
    FROM drivers
    WHERE id=? AND cooperative_id=? AND deleted_at IS NULL
    LIMIT 1
  `).bind(auth.driverId,auth.cooperativeId).first<Row>();
  return c.json({ok:true,driver});
});

mapSafeRoutes.get('/map/drivers', async c => {
  const auth=c.get('auth');
  const requested=String(c.req.query('cooperative_id')||'').trim();
  let sql=`
    SELECT d.id,d.cooperative_id,d.name,d.photo_url,d.phone,d.vehicle_model,d.vehicle_plate,
           d.online,d.last_seen_at,d.current_lat,d.current_lng,d.location_updated_at,
           c.name cooperative_name
    FROM drivers d
    JOIN cooperatives c ON c.id=d.cooperative_id
    WHERE d.deleted_at IS NULL AND d.status='active'
      AND d.current_lat IS NOT NULL AND d.current_lng IS NOT NULL
  `;
  const params:unknown[]=[];

  if(auth.role==='platform_admin'){
    if(requested){sql+=' AND d.cooperative_id=?';params.push(requested);}
  }else{
    if(!auth.cooperativeId)return c.json({ok:true,items:[]});
    sql+=' AND d.cooperative_id=?';params.push(auth.cooperativeId);
  }

  if(auth.role==='driver'&&auth.driverId){sql+=' AND d.id=?';params.push(auth.driverId);}
  if(auth.role==='establishment'&&auth.establishmentId){
    sql+=` AND (
      EXISTS(SELECT 1 FROM deliveries x WHERE x.assigned_driver_id=d.id AND x.establishment_id=? AND x.deleted_at IS NULL AND x.status NOT IN ('delivered','cancelled'))
      OR EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.establishment_id=? AND s.deleted_at IS NULL AND date(s.start_at)>=date('now','-1 day'))
    )`;
    params.push(auth.establishmentId,auth.establishmentId);
  }

  sql+=' ORDER BY d.online DESC,d.location_updated_at DESC,d.name LIMIT 1500';
  const rows=await c.env.DB.prepare(sql).bind(...params).all<Row>();
  return c.json({ok:true,items:rows.results||[]});
});
