import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { assertRole } from '../lib/util';
import { distanceMeters } from '../lib/queue';

export const platformV32Routes = new Hono<AppBindings>();
type Row = Record<string, any>;
type Stop = {delivery_id:string;display_code:string;kind:'pickup'|'delivery';label:string;address:string;lat:number;lng:number;status:string};
type Step = {instruction:string;street:string;distance_meters:number;duration_seconds:number;maneuver_type:string;maneuver_modifier:string;location:[number,number]|null};
type Route = {distance_meters:number;duration_seconds:number;geometry:[number,number][];steps:Step[];source:'openstreetmap'};

const ARRIVAL_RADIUS_METERS=35;
const valid=(lat:number,lng:number)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;

function instruction(type:string,modifier:string,street:string){
 const road=street?` na ${street}`:'';
 if(type==='depart')return`Inicie o percurso${road}`;
 if(type==='arrive')return'Você chegou ao destino';
 if(type==='roundabout'||type==='rotary')return`Entre na rotatória${road}`;
 if(type==='merge')return`Entre na via${road}`;
 if(type==='fork')return modifier.includes('left')?`Mantenha-se à esquerda${road}`:`Mantenha-se à direita${road}`;
 if(type==='on ramp')return`Acesse a alça${road}`;
 if(type==='off ramp')return`Saia pela alça${road}`;
 if(modifier==='uturn')return`Faça o retorno${road}`;
 if(modifier.includes('left'))return modifier.includes('slight')?`Vire levemente à esquerda${road}`:modifier.includes('sharp')?`Vire acentuadamente à esquerda${road}`:`Vire à esquerda${road}`;
 if(modifier.includes('right'))return modifier.includes('slight')?`Vire levemente à direita${road}`:modifier.includes('sharp')?`Vire acentuadamente à direita${road}`:`Vire à direita${road}`;
 return`Siga em frente${road}`;
}

async function openStreetMapRoute(env:AppBindings['Bindings'],origin:{lat:number;lng:number},destination:{lat:number;lng:number}):Promise<Route|null>{
 try{
  const base=(env.ROUTER_URL||'https://router.project-osrm.org/route/v1/driving').replace(/\/$/,'');
  const coordinates=`${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const response=await fetch(`${base}/${coordinates}?overview=full&geometries=geojson&steps=true&annotations=false`,{headers:{'User-Agent':'ChegaJa/14.32'}});
  if(!response.ok)return null;
  const payload=await response.json<any>().catch(()=>null),route=payload?.routes?.[0];if(!route)return null;
  const geometry=(route.geometry?.coordinates||[]).map((p:number[])=>[Number(p[1]),Number(p[0])] as [number,number]).filter((p:[number,number])=>valid(p[0],p[1]));
  const steps=(route.legs||[]).flatMap((leg:any)=>leg.steps||[]).map((step:any)=>{
    const type=String(step.maneuver?.type||''),modifier=String(step.maneuver?.modifier||''),street=String(step.name||'');
    const location=Array.isArray(step.maneuver?.location)?[Number(step.maneuver.location[1]),Number(step.maneuver.location[0])] as [number,number]:null;
    return{instruction:instruction(type,modifier,street),street,distance_meters:Math.round(Number(step.distance||0)),duration_seconds:Math.round(Number(step.duration||0)),maneuver_type:type,maneuver_modifier:modifier,location};
  });
  return{distance_meters:Math.round(Number(route.distance||0)),duration_seconds:Math.round(Number(route.duration||0)),geometry,steps,source:'openstreetmap'};
 }catch{return null}
}

platformV32Routes.get('/v32/driver/navigation',async c=>{
 const auth=c.get('auth');assertRole(auth,['driver']);
 if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
 const driver=await c.env.DB.prepare(`SELECT current_lat,current_lng,online FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1`).bind(auth.driverId,auth.cooperativeId).first<Row>();
 const lat=Number(driver?.current_lat),lng=Number(driver?.current_lng);
 if(!valid(lat,lng))return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:[],next:null,route:null,arrived:false,arrival_radius_meters:ARRIVAL_RADIUS_METERS});
 const rows=await c.env.DB.prepare(`SELECT id,display_code,status,pickup_address,pickup_lat,pickup_lng,delivery_address,delivery_lat,delivery_lng,accepted_at,created_at FROM deliveries WHERE cooperative_id=? AND assigned_driver_id=? AND deleted_at IS NULL AND status IN ('accepted','to_pickup','at_pickup','picked_up','in_route','problem') ORDER BY created_at LIMIT 20`).bind(auth.cooperativeId,auth.driverId).all<Row>();
 const stops:Stop[]=[];
 for(const item of rows.results||[]){
  const beforePickup=['accepted','to_pickup','at_pickup','problem'].includes(String(item.status));
  if(beforePickup&&valid(Number(item.pickup_lat),Number(item.pickup_lng)))stops.push({delivery_id:item.id,display_code:item.display_code,kind:'pickup',label:'Coleta',address:item.pickup_address||'',lat:Number(item.pickup_lat),lng:Number(item.pickup_lng),status:item.status});
  else if(valid(Number(item.delivery_lat),Number(item.delivery_lng)))stops.push({delivery_id:item.id,display_code:item.display_code,kind:'delivery',label:'Entrega',address:item.delivery_address||'',lat:Number(item.delivery_lat),lng:Number(item.delivery_lng),status:item.status});
 }
 stops.sort((a,b)=>distanceMeters(lat,lng,a.lat,a.lng)-distanceMeters(lat,lng,b.lat,b.lng));
 const next=stops[0]||null;
 if(!next)return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:[],next:null,route:null,arrived:false,arrival_radius_meters:ARRIVAL_RADIUS_METERS});
 const distanceToTarget=distanceMeters(lat,lng,next.lat,next.lng),arrived=distanceToTarget<=ARRIVAL_RADIUS_METERS;
 if(arrived)return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:stops,next,route:null,arrived:true,distance_to_target_meters:distanceToTarget,arrival_radius_meters:ARRIVAL_RADIUS_METERS,route_source:null});
 const origin={lat,lng},destination={lat:next.lat,lng:next.lng};
 const route=await openStreetMapRoute(c.env,origin,destination);
 return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:stops,next,route,arrived:false,distance_to_target_meters:distanceToTarget,arrival_radius_meters:ARRIVAL_RADIUS_METERS,route_source:route?.source||null});
});