import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { assertRole, bodyJson, cleanText, toCents } from '../lib/util';

export const platformV29Routes = new Hono<AppBindings>();
export const publicV29Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

platformV29Routes.get('/v29/cooperative/operational-costs',async c=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin','dispatcher']);
  if(!auth.cooperativeId)return c.json({ok:false,error:'Cooperativa não vinculada.'},403);
  const item=await c.env.DB.prepare(`SELECT id,name,
      COALESCE(NULLIF(fuel_km_per_liter,0),(SELECT NULLIF(b.fuel_km_per_liter,0) FROM bases b WHERE b.cooperative_id=cooperatives.id AND b.active=1 AND b.deleted_at IS NULL ORDER BY b.name LIMIT 1),35) fuel_km_per_liter,
      COALESCE(NULLIF(fuel_price_cents,0),(SELECT NULLIF(b.fuel_price_cents,0) FROM bases b WHERE b.cooperative_id=cooperatives.id AND b.active=1 AND b.deleted_at IS NULL ORDER BY b.name LIMIT 1),0) fuel_price_cents,
      COALESCE(NULLIF(displacement_rate_cents_per_km,0),(SELECT NULLIF(b.displacement_rate_cents_per_km,0) FROM bases b WHERE b.cooperative_id=cooperatives.id AND b.active=1 AND b.deleted_at IS NULL ORDER BY b.name LIMIT 1),0) displacement_rate_cents_per_km
    FROM cooperatives WHERE id=? AND deleted_at IS NULL LIMIT 1`).bind(auth.cooperativeId).first<Row>();
  if(!item)return c.json({ok:false,error:'Cooperativa não encontrada.'},404);
  return c.json({ok:true,item});
});

platformV29Routes.put('/v29/cooperative/operational-costs',async c=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin']);
  if(!auth.cooperativeId)return c.json({ok:false,error:'Cooperativa não vinculada.'},403);
  const body=await bodyJson<Row>(c);
  const consumption=Math.max(.1,Number(body.fuel_km_per_liter||35));
  const fuelPrice=Math.max(0,toCents(body.fuel_price));
  const displacementRate=Math.max(0,toCents(body.displacement_rate_per_km));
  await c.env.DB.prepare(`UPDATE cooperatives SET fuel_km_per_liter=?,fuel_price_cents=?,displacement_rate_cents_per_km=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL`)
    .bind(consumption,fuelPrice,displacementRate,auth.cooperativeId).run();
  return c.json({ok:true,item:{fuel_km_per_liter:consumption,fuel_price_cents:fuelPrice,displacement_rate_cents_per_km:displacementRate}});
});

platformV29Routes.get('/v29/base/form-fixes', async c => {
  const auth=c.get('auth');
  assertRole(auth,['cooperative_admin','dispatcher']);
  if(!auth.cooperativeId)return c.json({ok:false,error:'Cooperativa não vinculada.'},403);
  const baseId=cleanText(c.req.query('base_id'),100);
  const services=await c.env.DB.prepare(`SELECT id,cooperative_id,base_id,name,description,add_cents,free_wait_seconds,wait_cents_per_15m,wait_tracking_enabled,COALESCE(active,1) active
    FROM services WHERE cooperative_id=? AND deleted_at IS NULL AND COALESCE(active,1)=1
      AND (?='' OR base_id IS NULL OR base_id=?) ORDER BY name COLLATE NOCASE`)
    .bind(auth.cooperativeId,baseId,baseId).all<Row>();
  const registered=await c.env.DB.prepare(`SELECT DISTINCT c.id
    FROM customers c
    JOIN cooperative_customers cc ON cc.customer_id=c.id AND cc.cooperative_id=? AND cc.status='active'
    JOIN customer_accounts a ON a.customer_id=c.id AND a.status='active' AND a.provider<>'guest'
    ORDER BY c.id`).bind(auth.cooperativeId).all<Row>();
  return c.json({ok:true,services:services.results||[],registered_customer_ids:(registered.results||[]).map(x=>String(x.id))});
});

platformV29Routes.post('/v29/base/services/:id/activate',async c=>{
  const auth=c.get('auth');assertRole(auth,['cooperative_admin']);
  if(!auth.cooperativeId)return c.json({ok:false,error:'Cooperativa não vinculada.'},403);
  const result=await c.env.DB.prepare(`UPDATE services SET active=1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`)
    .bind(c.req.param('id'),auth.cooperativeId).run();
  if(!result.meta.changes)return c.json({ok:false,error:'Serviço não encontrado.'},404);
  return c.json({ok:true});
});

publicV29Routes.get('/v29/services',async c=>{
  const cooperativeId=cleanText(c.req.query('cooperative_id')||c.req.query('coop'),100);
  if(!cooperativeId)return c.json({ok:false,error:'Cooperativa não informada.'},400);
  const baseId=cleanText(c.req.query('base_id'),100);
  const rows=await c.env.DB.prepare(`SELECT id,cooperative_id,base_id,name,description,add_cents,COALESCE(active,1) active
    FROM services WHERE cooperative_id=? AND deleted_at IS NULL AND COALESCE(active,1)=1
      AND (?='' OR base_id IS NULL OR base_id=?) ORDER BY name COLLATE NOCASE`)
    .bind(cooperativeId,baseId,baseId).all<Row>();
  return c.json({ok:true,items:rows.results||[]});
});