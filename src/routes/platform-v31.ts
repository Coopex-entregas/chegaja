import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { assertRole } from '../lib/util';
import { distanceMeters } from '../lib/queue';
import { navigationRoute } from '../lib/maps';

export const platformV31Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

type Stop = {delivery_id:string;display_code:string;kind:'pickup'|'delivery';label:string;address:string;lat:number;lng:number;status:string};

function valid(lat:number,lng:number){return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;}

platformV31Routes.get('/v31/driver/navigation',async c=>{
  const auth=c.get('auth');assertRole(auth,['driver']);
  if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
  const driver=await c.env.DB.prepare(`SELECT current_lat,current_lng,online FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1`).bind(auth.driverId,auth.cooperativeId).first<Row>();
  const lat=Number(driver?.current_lat),lng=Number(driver?.current_lng);
  if(!valid(lat,lng))return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:[],next:null,route:null});
  const rows=await c.env.DB.prepare(`SELECT id,display_code,status,pickup_address,pickup_lat,pickup_lng,delivery_address,delivery_lat,delivery_lng,accepted_at,created_at
    FROM deliveries WHERE cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL
      AND status IN ('accepted','to_pickup','at_pickup','picked_up','in_route','problem')
    ORDER BY created_at LIMIT 20`).bind(auth.cooperativeId,auth.driverId).all<Row>();
  const stops:Stop[]=[];
  for(const item of rows.results||[]){
    const beforePickup=['accepted','to_pickup','at_pickup','problem'].includes(String(item.status));
    if(beforePickup&&valid(Number(item.pickup_lat),Number(item.pickup_lng)))stops.push({delivery_id:item.id,display_code:item.display_code,kind:'pickup',label:'Coleta',address:item.pickup_address||'',lat:Number(item.pickup_lat),lng:Number(item.pickup_lng),status:item.status});
    else if(valid(Number(item.delivery_lat),Number(item.delivery_lng)))stops.push({delivery_id:item.id,display_code:item.display_code,kind:'delivery',label:'Entrega',address:item.delivery_address||'',lat:Number(item.delivery_lat),lng:Number(item.delivery_lng),status:item.status});
  }
  stops.sort((a,b)=>distanceMeters(lat,lng,a.lat,a.lng)-distanceMeters(lat,lng,b.lat,b.lng));
  const next=stops[0]||null;
  if(!next)return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:[],next:null,route:null});
  const route=await navigationRoute(c.env,{lat,lng},{lat:next.lat,lng:next.lng});
  return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:stops,next,route});
});
