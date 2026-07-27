import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { assertRole, bodyJson, cleanText } from '../lib/util';
import { getMapsRuntimeConfig, mapsConfigForAdmin, saveMapsRuntimeConfig } from '../lib/platform-config';
import { audit } from '../lib/audit';

export const platformV23Routes = new Hono<AppBindings>();
type Row = Record<string, unknown>;

const truthy = (value: unknown) => value === true || value === 'true' || value === 1 || value === '1';
async function googlePayload(url:string, init?:RequestInit) {
  let response:Response;
  try { response=await fetch(url,init); }
  catch { throw new Error('Não foi possível conectar aos serviços do Google Maps.'); }
  const payload=await response.json<any>().catch(()=>null);
  if(!response.ok)throw new Error(cleanText(payload?.error?.message||payload?.error_message||`HTTP ${response.status}`,260));
  return payload;
}

platformV23Routes.get('/platform/maps-settings', async c => {
  const auth = c.get('auth');
  assertRole(auth, ['platform_admin']);
  const config = await getMapsRuntimeConfig(c.env, true);
  return c.json({ ok:true, item:mapsConfigForAdmin(config) });
});

platformV23Routes.put('/platform/maps-settings', async c => {
  const auth = c.get('auth');
  assertRole(auth, ['platform_admin']);
  const body = await bodyJson<Row>(c);
  const current = await getMapsRuntimeConfig(c.env, true);
  const before = mapsConfigForAdmin(current);
  const provider = cleanText(body.provider || before.provider, 30).toLowerCase();
  if (!['google','openstreetmap'].includes(provider)) return c.json({ ok:false, error:'Escolha Google Maps ou OpenStreetMap.' }, 400);

  const serverInput=cleanText(body.server_key,500),browserInput=cleanText(body.browser_key,500);
  const serverAvailable=Boolean(serverInput||(!truthy(body.clear_server_key)&&current.serverKey));
  const browserAvailable=Boolean(browserInput||(!truthy(body.clear_browser_key)&&current.browserKey));
  if(provider==='google'&&(!serverAvailable||!browserAvailable)){
    return c.json({ok:false,error:'Para ativar o Google, mantenha ou informe as duas chaves: servidor e navegador.'},400);
  }

  const config = await saveMapsRuntimeConfig(c.env, {
    provider,
    serverKey:body.server_key,
    browserKey:body.browser_key,
    mapId:body.map_id,
    clearServerKey:body.clear_server_key,
    clearBrowserKey:body.clear_browser_key
  });
  const after = mapsConfigForAdmin(config);
  await audit(c, 'update', 'platform_maps_settings', 'global', before, after, null);
  return c.json({ ok:true, item:after });
});

platformV23Routes.post('/platform/maps-settings/test', async c => {
  const auth = c.get('auth');
  assertRole(auth, ['platform_admin']);
  const config = await getMapsRuntimeConfig(c.env, true);
  if (config.provider !== 'google') return c.json({ ok:true, provider:'openstreetmap', message:'OpenStreetMap selecionado. O sistema não realizou chamadas ao Google.' });
  if (!config.serverKey) return c.json({ ok:false, error:'Cadastre a chave do servidor do Google Maps antes de testar.' }, 400);

  try {
    const geocodeUrl=new URL('https://maps.googleapis.com/maps/api/geocode/json');
    geocodeUrl.searchParams.set('address','Natal Shopping, Natal, Rio Grande do Norte, Brasil');geocodeUrl.searchParams.set('region','br');geocodeUrl.searchParams.set('language','pt-BR');geocodeUrl.searchParams.set('key',config.serverKey);
    const geocode=await googlePayload(geocodeUrl.toString());
    if(String(geocode?.status)!=='OK')throw new Error(cleanText(geocode?.error_message||`Geocoding API: ${geocode?.status||'sem resposta'}`,260));
    const point=geocode.results?.[0]?.geometry?.location;
    if(!point)throw new Error('A Geocoding API não retornou coordenadas.');

    const places=await googlePayload('https://places.googleapis.com/v1/places:searchText',{
      method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':config.serverKey,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location'},
      body:JSON.stringify({textQuery:'Natal Shopping, Natal RN',languageCode:'pt-BR',regionCode:'BR',maxResultCount:1})
    });
    if(!places?.places?.length)throw new Error('A Places API (New) não retornou resultado.');

    const routes=await googlePayload('https://routes.googleapis.com/directions/v2:computeRoutes',{
      method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':config.serverKey,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration'},
      body:JSON.stringify({origin:{location:{latLng:{latitude:-5.7945,longitude:-35.211}}},destination:{location:{latLng:{latitude:Number(point.lat),longitude:Number(point.lng)}}},travelMode:'DRIVE',routingPreference:'TRAFFIC_AWARE',languageCode:'pt-BR',units:'METRIC'})
    });
    if(!routes?.routes?.length)throw new Error('A Routes API não retornou uma rota.');

    return c.json({ok:true,provider:'google',message:'Geocoding, Places (New) e Routes validadas pela chave do servidor.',sample:geocode.results?.[0]?.formatted_address||'Natal - RN'});
  } catch(error) {
    return c.json({ok:false,error:`O Google recusou ou não concluiu o teste: ${cleanText(error instanceof Error?error.message:String(error),300)}. Confira faturamento, APIs e restrições da chave.`},400);
  }
});
