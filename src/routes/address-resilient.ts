import { Hono, type Context } from 'hono';
import type { AppBindings } from '../types';
import { makeAddressConfirmationToken } from '../lib/address';
import { searchFreeAddressCandidates, type AddressCandidate } from '../lib/maps';
import { cleanText } from '../lib/util';

export const addressResilientRoutes = new Hono<AppBindings>();
type Row = Record<string, any>;

type AddressResult = AddressCandidate & {
 confirmable:boolean;
 confirmation_token:string|null;
 number_source:'provider'|'typed';
 approximate_number:boolean;
};

const norm=(value:unknown)=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const houseKey=(value:unknown)=>norm(value).replace(/[^a-z0-9]/g,'');
function requestedHouseNumber(query:string){
 const text=String(query||'').trim();
 const matches=[...text.matchAll(/(?:^|[,\s])([0-9]{1,6}[a-zA-Z]?(?:[-\/]?[0-9a-zA-Z]{1,6})?)(?=\s*(?:,|$))/g)];
 return matches.length?String(matches.at(-1)?.[1]||'').trim():'';
}
function withoutHouseNumber(query:string,number:string){
 if(!number)return query.trim();
 return query.replace(new RegExp(`(?:,\\s*|\\s+)${number.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*(?=,|$)`,'i'),' ').replace(/\s*,\s*,/g,',').replace(/\s{2,}/g,' ').replace(/^\s*,|,\s*$/g,'').trim();
}
function exactNumber(candidate:AddressCandidate,number:string){return !number||houseKey(candidate.number)===houseKey(number);}
function withTypedNumber(candidate:AddressCandidate,number:string):AddressCandidate{
 const street=String(candidate.street||candidate.place_name||'').trim();
 const formatted=[street?`${street}, ${number}`:number,candidate.neighborhood,candidate.city,candidate.state_code||candidate.state,candidate.postal_code,candidate.country||'Brasil'].filter(Boolean).join(', ');
 return {...candidate,number,formatted_address:formatted,display_name:formatted,exact_number:false,precision:candidate.precision==='rooftop'?'street':candidate.precision};
}

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

function candidateFromNominatim(item:any,query:string,city:string,state:string):AddressCandidate|null{
 const expectedState=norm(state||'RN'),expectedCity=norm(city),address=item.address||{};
 const foundCity=String(address.city||address.town||address.village||address.municipality||address.county||city||''),foundState=String(address.state||state||''),stateCode=String(address['ISO3166-2-lvl4']||'').split('-').pop()||state||'RN';
 const exactState=[norm(foundState),norm(stateCode)].includes(expectedState)||(expectedState==='rn'&&norm(foundState)==='rio grande do norte');
 if(!exactState)return null;
 const placeName=String(item.namedetails?.name||item.name||String(item.display_name||'').split(',')[0]||query);
 const road=String(address.road||address.pedestrian||address.residential||address.street||'');
 const number=String(address.house_number||'S/N'),category=String(item.class||''),type=String(item.type||'');
 const candidate:AddressCandidate={provider:'nominatim',provider_id:String(item.place_id||item.osm_id||''),formatted_address:String(item.display_name||[placeName,city,state].filter(Boolean).join(', ')),display_name:String(item.display_name||''),street:road||placeName,number,neighborhood:String(address.suburb||address.neighbourhood||address.quarter||''),city:foundCity,state:foundState,state_code:stateCode,postal_code:String(address.postcode||''),country:String(address.country||'Brasil'),lat:Number(item.lat),lng:Number(item.lon),precision:precision(type,category),exact_number:number!=='S/N',exact_city:!expectedCity||norm(foundCity)===expectedCity,exact_state:true,place_name:placeName};
 return Number.isFinite(candidate.lat)&&Number.isFinite(candidate.lng)?candidate:null;
}

async function nominatim(c:Context<AppBindings>,query:string,city:string,state:string,houseNumber=''):Promise<AddressCandidate[]>{
 const endpoint=c.env.GEOCODER_URL||'https://nominatim.openstreetmap.org/search';
 const urls:URL[]=[];
 const addCommon=(url:URL)=>{url.searchParams.set('countrycodes','br');url.searchParams.set('format','jsonv2');url.searchParams.set('addressdetails','1');url.searchParams.set('namedetails','1');url.searchParams.set('limit','10');url.searchParams.set('dedupe','1');urls.push(url)};
 if(houseNumber){
  const road=withoutHouseNumber(query,houseNumber);
  const structured=new URL(endpoint);
  structured.searchParams.set('street',`${houseNumber} ${road}`.trim());
  if(city)structured.searchParams.set('city',city);
  if(state)structured.searchParams.set('state',state);
  structured.searchParams.set('country','Brasil');
  addCommon(structured);
  for(const text of [`${road}, ${houseNumber}`,`${houseNumber} ${road}`,query]){
   const exact=new URL(endpoint);exact.searchParams.set('q',[text,city,state,'Brasil'].filter(Boolean).join(', '));addCommon(exact);
  }
 }else{
  const free=new URL(endpoint);free.searchParams.set('q',[query,city,state,'Brasil'].filter(Boolean).join(', '));addCommon(free);
 }
 const items:AddressCandidate[]=[];
 for(const url of urls){
  let response:Response;try{response=await fetch(url.toString(),{headers:{'User-Agent':'ChegaJa/14.33.3 contato@chegaja.app','Accept-Language':'pt-BR'}})}catch{continue}
  if(!response.ok)continue;
  const payload=await response.json<any[]>().catch(()=>[]);
  for(const item of payload||[]){const candidate=candidateFromNominatim(item,query,city,state);if(candidate)items.push(candidate)}
  if(houseNumber&&items.some(item=>exactNumber(item,houseNumber)))break;
 }
 const unique=new Map<string,AddressCandidate>();for(const item of items){const key=`${item.lat.toFixed(6)}:${item.lng.toFixed(6)}`;if(!unique.has(key))unique.set(key,item)}
 return[...unique.values()].slice(0,10);
}

addressResilientRoutes.post('/address/autocomplete',async c=>{
 const body=await c.req.json<Row>().catch(()=>({} as Row)),query=cleanText(body.query,350);
 if(query.length<3)return c.json({ok:true,items:[]});
 const base=await defaults(c,body),state=cleanText(body.state||base.state||'RN',80),city=body.restrict_city?cleanText(body.city||base.city||'',120):'';
 const requestedNumber=requestedHouseNumber(query);
 let found=await searchFreeAddressCandidates(c.env,query,city,state);
 if(requestedNumber&&!found.some(item=>exactNumber(item,requestedNumber))){
  const precise=await nominatim(c,query,city,state,requestedNumber);
  found=[...precise,...found];
 }else if(!found.length)found=await nominatim(c,query,city,state,requestedNumber);
 const unique=new Map<string,AddressCandidate>();
 for(const candidate of found){const key=`${candidate.lat.toFixed(6)}:${candidate.lng.toFixed(6)}`;if(!unique.has(key))unique.set(key,candidate)}
 const ordered=[...unique.values()].sort((a,b)=>Number(exactNumber(b,requestedNumber))-Number(exactNumber(a,requestedNumber))||Number(b.exact_city)-Number(a.exact_city)||Number(b.precision==='rooftop')-Number(a.precision==='rooftop'));
 const items:AddressResult[]=await Promise.all(ordered.slice(0,8).map(async candidate=>{
  const numberMatches=exactNumber(candidate,requestedNumber);
  const preserveTypedNumber=Boolean(requestedNumber&&!numberMatches);
  const effective=preserveTypedNumber?withTypedNumber(candidate,requestedNumber):candidate;
  const confirmable=Boolean(Number.isFinite(effective.lat)&&Number.isFinite(effective.lng)&&effective.exact_state&&(!requestedNumber||numberMatches||preserveTypedNumber));
  return {...effective,exact_number:requestedNumber?numberMatches:candidate.exact_number,confirmable,number_source:numberMatches?'provider':preserveTypedNumber?'typed':'provider',approximate_number:preserveTypedNumber,confirmation_token:confirmable?await makeAddressConfirmationToken(c.env,effective,base.cooperativeId||null):null};
 }));
 const exactFound=requestedNumber?items.some(item=>item.exact_number&&houseKey(item.number)===houseKey(requestedNumber)):true;
 return c.json({ok:true,items,locality:city?`${city}/${state}`:`Rio Grande do Norte/${state}`,scope:city?'city':'state',requested_number:requestedNumber||null,exact_number_required:Boolean(requestedNumber),exact_number_found:exactFound,typed_number_preserved:Boolean(requestedNumber&&!exactFound&&items.some(item=>item.confirmable)),fallback:items.some(item=>item.provider==='nominatim')});
});
