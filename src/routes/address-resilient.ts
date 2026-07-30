import { Hono, type Context } from 'hono';
import type { AppBindings } from '../types';
import { makeAddressConfirmationToken } from '../lib/address';
import { searchFreeAddressCandidates, type AddressCandidate } from '../lib/maps';
import { cleanText } from '../lib/util';

export const addressResilientRoutes = new Hono<AppBindings>();
type Row = Record<string, any>;

const norm=(value:unknown)=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();

async function defaults(c:Context<AppBindings>,body:Row){
 if(body.base_id){
  const row=await c.env.DB.prepare(`SELECT b.cooperative_id,b.city,b.state,c.address_city,c.address_state FROM bases b JOIN cooperatives c ON c.id=b.cooperative_id WHERE b.id=? AND b.deleted_at IS NULL`).bind(cleanText(body.base_id,100)).first<Row>();
  if(row)return{city:String(row.city||row.address_city||''),state:String(row.state||row.address_state||''),cooperativeId:String(row.cooperative_id||'')};
 }
 if(body.establishment_id){
  const row=await c.env.DB.prepare(`SELECT e.cooperative_id,e.city,e.state,c.address_city,c.address_state FROM establishments e JOIN cooperatives c ON c.id=e.cooperative_id WHERE e.id=? AND e.deleted_at IS NULL`).bind(cleanText(body.establishment_id,100)).first<Row>();
  if(row)return{city:String(row.city||row.address_city||''),state:String(row.state||row.address_state||''),cooperativeId:String(row.cooperative_id||'')};
 }
 const row=body.cooperative_id?await c.env.DB.prepare(`SELECT id,address_city,address_state FROM cooperatives WHERE id=? AND deleted_at IS NULL`).bind(cleanText(body.cooperative_id,100)).first<Row>():null;
 return{city:String(row?.address_city||''),state:String(row?.address_state||''),cooperativeId:String(row?.id||body.cooperative_id||'')};
}

function precision(type:string,category:string):AddressCandidate['precision']{
 if(['house','building','residential'].includes(type)||category==='building')return'rooftop';
 if(['street','road','pedestrian'].includes(type)||category==='highway')return'street';
 return'approximate';
}

async function nominatim(c:Context<AppBindings>,query:string,city:string,state:string):Promise<AddressCandidate[]>{
 const url=new URL(c.env.GEOCODER_URL||'https://nominatim.openstreetmap.org/search');
 url.searchParams.set('q',[query,city,state,'Brasil'].filter(Boolean).join(', '));
 url.searchParams.set('countrycodes','br');
 url.searchParams.set('format','jsonv2');
 url.searchParams.set('addressdetails','1');
 url.searchParams.set('namedetails','1');
 url.searchParams.set('limit','10');
 url.searchParams.set('dedupe','1');
 let response:Response;
 try{response=await fetch(url.toString(),{headers:{'User-Agent':'ChegaJa/14.30 contato@chegaja.app','Accept-Language':'pt-BR'}})}catch{return[]}
 if(!response.ok)return[];
 const payload=await response.json<any[]>().catch(()=>[]),expectedState=norm(state||'RN'),expectedCity=norm(city);
 const items:AddressCandidate[]=[];
 for(const item of payload||[]){
  const address=item.address||{},foundCity=String(address.city||address.town||address.village||address.municipality||address.county||city||''),foundState=String(address.state||state||''),stateCode=String(address['ISO3166-2-lvl4']||'').split('-').pop()||state||'RN';
  const exactState=[norm(foundState),norm(stateCode)].includes(expectedState)||(expectedState==='rn'&&norm(foundState)==='rio grande do norte');
  if(!exactState)continue;
  const placeName=String(item.namedetails?.name||item.name||String(item.display_name||'').split(',')[0]||query);
  const road=String(address.road||address.pedestrian||address.residential||address.street||'');
  const number=String(address.house_number||'S/N'),category=String(item.class||''),type=String(item.type||'');
  const candidate:AddressCandidate={provider:'nominatim',provider_id:String(item.place_id||item.osm_id||''),formatted_address:String(item.display_name||[placeName,city,state].filter(Boolean).join(', ')),display_name:String(item.display_name||''),street:road||placeName,number,neighborhood:String(address.suburb||address.neighbourhood||address.quarter||''),city:foundCity,state:foundState,state_code:stateCode,postal_code:String(address.postcode||''),country:String(address.country||'Brasil'),lat:Number(item.lat),lng:Number(item.lon),precision:precision(type,category),exact_number:number!=='S/N'||['building','amenity','shop','tourism','office','leisure'].includes(category),exact_city:!expectedCity||norm(foundCity)===expectedCity,exact_state:true,place_name:placeName};
  if(Number.isFinite(candidate.lat)&&Number.isFinite(candidate.lng))items.push(candidate);
 }
 const unique=new Map<string,AddressCandidate>();
 for(const item of items){const key=`${item.lat.toFixed(6)}:${item.lng.toFixed(6)}`;if(!unique.has(key))unique.set(key,item)}
 return[...unique.values()].slice(0,8);
}

addressResilientRoutes.post('/address/autocomplete',async c=>{
 const body=await c.req.json<Row>().catch(()=>({} as Row)),query=cleanText(body.query,350);
 if(query.length<3)return c.json({ok:true,items:[]});
 const base=await defaults(c,body),state=cleanText(body.state||base.state||'RN',80),city=body.restrict_city?cleanText(body.city||base.city||'',120):'';
 let found=await searchFreeAddressCandidates(c.env,query,city,state);
 if(!found.length)found=await nominatim(c,query,city,state);
 const items=await Promise.all(found.map(async candidate=>({...candidate,confirmable:true,confirmation_token:await makeAddressConfirmationToken(c.env,candidate,base.cooperativeId||null)})));
 return c.json({ok:true,items,locality:city?`${city}/${state}`:`Rio Grande do Norte/${state}`,scope:city?'city':'state',fallback:items.some(item=>item.provider==='nominatim')});
});
