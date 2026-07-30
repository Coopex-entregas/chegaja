import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { assertRole, bodyJson, cleanText } from '../lib/util';
import { distanceMeters } from '../lib/queue';

export const platformV30Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

function validPoint(lat:number,lng:number){return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&Math.abs(lat)+Math.abs(lng)>0.01;}

platformV30Routes.post('/v30/driver/destination-arrival',async c=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
  const body=await bodyJson<Row>(c),lat=Number(body.latitude),lng=Number(body.longitude);
  if(!validPoint(lat,lng))return c.json({ok:false,error:'Localização inválida.'},400);
  const item=await c.env.DB.prepare(`SELECT d.id,d.display_code,d.status,d.delivery_lat,d.delivery_lng,d.delivery_address,d.charge_cents,d.wait_charge_cents,d.service_charge_cents,d.return_cents,d.displacement_cents,d.confirmation_required,d.finish_without_code_authorized,d.confirmation_code,d.base_id,
      COALESCE(b.delivery_confirmation_required,1) base_confirmation_required
    FROM deliveries d LEFT JOIN bases b ON b.id=d.base_id
    WHERE d.cooperative_id=? AND d.assigned_driver_id=? AND d.accepted_at IS NOT NULL AND d.deleted_at IS NULL AND d.status='in_route'
    ORDER BY d.created_at LIMIT 1`).bind(auth.cooperativeId,auth.driverId).first<Row>();
  if(!item)return c.json({ok:true,arrived:false});
  if(!validPoint(Number(item.delivery_lat),Number(item.delivery_lng)))return c.json({ok:true,arrived:false,delivery_id:item.id});
  const distance=distanceMeters(lat,lng,Number(item.delivery_lat),Number(item.delivery_lng));
  const arrived=distance<=100;
  const requiresCode=Number(item.base_confirmation_required??1)===1&&Number(item.confirmation_required??1)===1&&!Number(item.finish_without_code_authorized||0);
  return c.json({ok:true,arrived,distance_meters:distance,delivery_id:item.id,item:{...item,requires_code:requiresCode,total_cents:Number(item.charge_cents||0)+Number(item.wait_charge_cents||0)}});
});

platformV30Routes.get('/v30/base/:id/completion-settings',async c=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);
  if(!auth.cooperativeId)return c.json({ok:false,error:'Cooperativa não vinculada.'},403);
  const item=await c.env.DB.prepare(`SELECT id,name,COALESCE(delivery_confirmation_required,1) delivery_confirmation_required FROM bases WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!item)return c.json({ok:false,error:'Base não encontrada.'},404);
  return c.json({ok:true,item});
});

platformV30Routes.put('/v30/base/:id/completion-settings',async c=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin']);
  if(!auth.cooperativeId)return c.json({ok:false,error:'Cooperativa não vinculada.'},403);
  const body=await bodyJson<Row>(c),required=body.delivery_confirmation_required===true||body.delivery_confirmation_required==='true'||body.delivery_confirmation_required==='1'||body.delivery_confirmation_required===1;
  const result=await c.env.DB.prepare(`UPDATE bases SET delivery_confirmation_required=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(required?1:0,c.req.param('id'),auth.cooperativeId).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Base não encontrada.'},404);
  return c.json({ok:true,delivery_confirmation_required:required});
});
