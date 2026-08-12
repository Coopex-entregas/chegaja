import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { assertRole, bodyJson, cleanText, id } from '../lib/util';
import { distanceMeters } from '../lib/queue';

export const platformV32Routes = new Hono<AppBindings>();
type Row = Record<string, any>;
type Stop = {delivery_id:string;display_code:string;kind:'pickup'|'delivery';label:string;address:string;lat:number;lng:number;status:string};
type Step = {instruction:string;street:string;distance_meters:number;duration_seconds:number;maneuver_type:string;maneuver_modifier:string;location:[number,number]|null};
type Route = {distance_meters:number;duration_seconds:number;geometry:[number,number][];steps:Step[];source:'openstreetmap'};

const ARRIVAL_RADIUS_METERS=35;
const valid=(lat:number,lng:number)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&(Math.abs(lat)+Math.abs(lng)>0.001);

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
  const response=await fetch(`${base}/${coordinates}?overview=full&geometries=geojson&steps=true&annotations=false`,{headers:{'User-Agent':'ChegaJa/14.33.21'}});
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
 const requestedLat=Number(c.req.query('lat')),requestedLng=Number(c.req.query('lng')),storedLat=Number(driver?.current_lat),storedLng=Number(driver?.current_lng);
 const useRequested=valid(requestedLat,requestedLng),lat=useRequested?requestedLat:storedLat,lng=useRequested?requestedLng:storedLng;
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

// SOS resiliente: usa a leitura enviada pelo aparelho e, se ela falhar, a última
// posição válida persistida do cooperado. O destino institucional é o local da
// escala em andamento; cooperados online recebem o alerta pelo feed de SOS.
platformV32Routes.post('/v32/driver/sos',async c=>{
 const auth=c.get('auth');assertRole(auth,['driver']);
 if(!auth.cooperativeId||!auth.driverId)return c.json({ok:false,error:'Cooperado não vinculado.'},403);
 const body=await bodyJson<Row>(c).catch(()=>({} as Row));
 const driver=await c.env.DB.prepare(`SELECT id,name,current_lat,current_lng,last_seen_at FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1`).bind(auth.driverId,auth.cooperativeId).first<Row>();
 if(!driver)return c.json({ok:false,error:'Cooperado não encontrado.'},404);
 let lat=Number(body.latitude),lng=Number(body.longitude),accuracy=body.accuracy==null?null:Number(body.accuracy),locationSource='device';
 if(!valid(lat,lng)){
  lat=Number(driver.current_lat);lng=Number(driver.current_lng);accuracy=null;locationSource='last_known';
 }
 if(!valid(lat,lng))return c.json({ok:false,error:'Ainda não há uma localização válida. Aguarde o mapa localizar você e tente novamente.'},400);
 const occurrence=cleanText(body.occurrence||'Solicitação de ajuda enviada pelo aplicativo.',800)||'Solicitação de ajuda enviada pelo aplicativo.';
 const schedule=await c.env.DB.prepare(`
   SELECT s.id,s.base_id,s.establishment_id,s.contract_id,s.start_at,s.end_at,
          b.name base_name,e.name establishment_name,ct.name contract_name
     FROM schedules s
     LEFT JOIN bases b ON b.id=s.base_id
     LEFT JOIN establishments e ON e.id=s.establishment_id
     LEFT JOIN contracts ct ON ct.id=s.contract_id
    WHERE s.cooperative_id=? AND s.driver_id=? AND s.deleted_at IS NULL
      AND COALESCE(s.status,'active') NOT IN ('cancelled','draft')
      AND datetime(s.start_at)<=datetime('now','-3 hours')
      AND datetime(s.end_at)>=datetime('now','-3 hours')
    ORDER BY datetime(s.start_at) DESC LIMIT 1
 `).bind(auth.cooperativeId,auth.driverId).first<Row>();
 const nearestBase=await c.env.DB.prepare(`SELECT id,name,((? - latitude)*(? - latitude) + (? - longitude)*(? - longitude)) proximity FROM bases WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY proximity LIMIT 1`).bind(lat,lat,lng,lng,auth.cooperativeId).first<Row>();
 const baseId=schedule?.base_id||nearestBase?.id||null;
 const locationType=schedule?.establishment_id?'establishment':schedule?.base_id?'base':schedule?.contract_id?'contract':nearestBase?.id?'base':'cooperative';
 const locationName=String(schedule?.establishment_name||schedule?.base_name||schedule?.contract_name||nearestBase?.name||'Base da cooperativa');
 const sosId=id();
 const statements:D1PreparedStatement[]=[
  c.env.DB.prepare(`INSERT INTO driver_sos_alerts(id,cooperative_id,base_id,driver_id,driver_name,occurrence,latitude,longitude,accuracy) VALUES (?,?,?,?,?,?,?,?,?)`).bind(sosId,auth.cooperativeId,baseId,auth.driverId,driver.name||auth.name,occurrence,lat,lng,accuracy),
  c.env.DB.prepare(`INSERT INTO notification_events(id,cooperative_id,establishment_id,driver_id,event_type,title,message) VALUES (?,?,?,?,?,'🚨 PEDIDO DE SOCORRO',?)`).bind(id(),auth.cooperativeId,schedule?.establishment_id||null,auth.driverId,'driver_sos',`${driver.name||auth.name} pediu socorro em ${locationName}: ${occurrence}`),
 ];
 const online=await c.env.DB.prepare(`SELECT id FROM drivers WHERE cooperative_id=? AND id<>? AND status='active' AND deleted_at IS NULL AND online=1 AND on_leave=0 AND last_seen_at IS NOT NULL AND datetime(last_seen_at)>=datetime('now','-10 minutes')`).bind(auth.cooperativeId,auth.driverId).all<Row>();
 for(const helper of online.results||[]){
  statements.push(c.env.DB.prepare(`INSERT INTO notification_events(id,cooperative_id,driver_id,event_type,title,message) VALUES (?,?,?,?,?,?)`).bind(id(),auth.cooperativeId,helper.id,'driver_sos','🚨 PEDIDO DE SOCORRO',`${driver.name||auth.name} precisa de ajuda em ${locationName}.`));
 }
 await c.env.DB.batch(statements);
 return c.json({ok:true,id:sosId,location_name:locationName,location_type:locationType,location_source:locationSource,online_drivers_notified:(online.results||[]).length,message:`Socorro enviado para ${locationName} e para os cooperados online.`},201);
});