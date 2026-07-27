import type { Env } from '../types';
import { getMapsRuntimeConfig } from './platform-config';

export interface GeoPoint { lat: number; lng: number; display_name?: string }
export interface RouteResult { distance_meters: number; duration_seconds: number; geometry: [number, number][] }
export interface NavigationStep {
  instruction: string;
  street: string;
  distance_meters: number;
  duration_seconds: number;
  maneuver_type: string;
  maneuver_modifier: string;
  location: [number, number] | null;
}
export interface NavigationRouteResult extends RouteResult { steps: NavigationStep[] }
export interface AddressSearchInput {
  street: string;
  number: string;
  neighborhood?: string;
  city: string;
  state: string;
  postal_code?: string;
  country?: string;
}
export interface AddressCandidate extends GeoPoint {
  provider: 'google' | 'nominatim';
  provider_id: string;
  formatted_address: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  state_code: string;
  postal_code: string;
  country: string;
  precision: 'rooftop' | 'interpolated' | 'street' | 'approximate';
  exact_number: boolean;
  exact_city: boolean;
  exact_state: boolean;
  place_name?: string;
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try { return await fetch(url, init); }
  catch (error) {
    console.warn('Serviço externo de mapas indisponível:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

const norm = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
function component(components: any[], type: string, short = false): string {
  const found = components.find(item => Array.isArray(item.types) && item.types.includes(type));
  return String(found ? (short ? found.short_name : found.long_name) : '');
}
function componentV1(components: any[], type: string, short = false): string {
  const found = components.find(item => Array.isArray(item.types) && item.types.includes(type));
  return String(found ? (short ? found.shortText : found.longText) : '');
}
function googlePrecision(value: string): AddressCandidate['precision'] {
  if (value === 'ROOFTOP') return 'rooftop';
  if (value === 'RANGE_INTERPOLATED') return 'interpolated';
  if (value === 'GEOMETRIC_CENTER') return 'street';
  return 'approximate';
}
function nominatimPrecision(type: string, category: string): AddressCandidate['precision'] {
  if (['house', 'building', 'residential'].includes(type) || category === 'building') return 'rooftop';
  if (['street', 'road', 'pedestrian'].includes(type) || category === 'highway') return 'street';
  return 'approximate';
}

export function formatStructuredAddress(input: AddressSearchInput): string {
  return [
    `${input.street.trim()}, ${input.number.trim()}`,
    input.neighborhood?.trim(), input.city.trim(), input.state.trim(), input.postal_code?.trim(), input.country || 'Brasil'
  ].filter(Boolean).join(', ');
}

export async function searchFreeAddressCandidates(env: Env, queryValue: string, cityValue = '', stateValue = 'RN'): Promise<AddressCandidate[]> {
  const query = queryValue.trim();
  const city = cityValue.trim();
  const state = stateValue.trim() || 'RN';
  if (query.length < 3) return [];
  const expectedCity = norm(city), expectedState = norm(state);
  const output: AddressCandidate[] = [];
  const mapsConfig = await getMapsRuntimeConfig(env);
  const googleKey = mapsConfig.provider === 'google' ? mapsConfig.serverKey : '';
  const localityText = [city,state,'Brasil'].filter(Boolean).join(', ');
  const cityMatches = (foundCity: string) => !expectedCity || norm(foundCity) === expectedCity;
  const stateMatches = (foundState: string, foundStateCode: string) => {
    const found=[norm(foundState),norm(foundStateCode)];
    return found.includes(expectedState)||(expectedState==='rn'&&found.includes('rio grande do norte'));
  };

  if (googleKey) {
    const makeGoogleCandidate=(item:any,isV1=false):AddressCandidate|null=>{
      const components=item.addressComponents||item.address_components||[];
      const read=(type:string,short=false)=>isV1?componentV1(components,type,short):component(components,type,short);
      const foundNumber=read('street_number');
      const foundCity=read('administrative_area_level_2')||read('locality')||read('sublocality_level_1');
      const foundState=read('administrative_area_level_1'),foundStateCode=read('administrative_area_level_1',true);
      const route=read('route'),placeName=String(item.displayName?.text||item.name||query);
      const location=item.location||item.geometry?.location||{};
      const candidate:AddressCandidate={
        provider:'google',provider_id:String(item.id||item.place_id||''),
        formatted_address:String(item.formattedAddress||item.formatted_address||`${placeName}, ${localityText}`),
        display_name:String(item.formattedAddress||item.formatted_address||''),
        street:route||placeName,number:foundNumber||'S/N',
        neighborhood:read('sublocality_level_1')||read('neighborhood')||'',
        city:foundCity||city,state:foundState||state,state_code:foundStateCode||state,
        postal_code:read('postal_code')||'',country:read('country')||'Brasil',
        lat:Number(location.latitude??location.lat),lng:Number(location.longitude??location.lng),
        precision:'rooftop',exact_number:Boolean(foundNumber)||Boolean(placeName),
        exact_city:cityMatches(foundCity||city),exact_state:stateMatches(foundState||state,foundStateCode||state),place_name:placeName
      };
      return Number.isFinite(candidate.lat)&&Number.isFinite(candidate.lng)&&candidate.exact_state?candidate:null;
    };

    // Places API (New): encontra empresas, shoppings, hospitais, bairros e municípios.
    const newPlacesResponse=await safeFetch('https://places.googleapis.com/v1/places:searchText',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Goog-Api-Key':googleKey,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents'},
      body:JSON.stringify({textQuery:`${query}, ${localityText}`,languageCode:'pt-BR',regionCode:'BR',maxResultCount:8})
    });
    if(newPlacesResponse?.ok){
      const payload=await newPlacesResponse.json<any>().catch(()=>null);
      for(const item of payload?.places||[]){const candidate=makeGoogleCandidate(item,true);if(candidate)output.push(candidate);}
    }

    // Compatibilidade com projetos que ainda possuem somente o Places legado.
    if(!output.length){
      const placesUrl = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
      placesUrl.searchParams.set('query', `${query}, ${localityText}`);
      placesUrl.searchParams.set('region','br');placesUrl.searchParams.set('language','pt-BR');placesUrl.searchParams.set('key',googleKey);
      const placesResponse = await safeFetch(placesUrl.toString());
      if (placesResponse?.ok) {
        const placesPayload = await placesResponse.json<any>().catch(()=>null);
        for (const place of (placesPayload?.results || []).slice(0,6)) {
          const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
          detailsUrl.searchParams.set('place_id',String(place.place_id||''));detailsUrl.searchParams.set('fields','place_id,name,formatted_address,geometry,address_components');detailsUrl.searchParams.set('language','pt-BR');detailsUrl.searchParams.set('key',googleKey);
          const detailsResponse=await safeFetch(detailsUrl.toString());
          const detailsPayload=detailsResponse?.ok?await detailsResponse.json<any>().catch(()=>null):null;
          const candidate=makeGoogleCandidate(detailsPayload?.result||place,false);if(candidate)output.push(candidate);
        }
      }
    }

    // Geocoding cobre ruas, bairros e cidades quando o Places não retornar um comércio.
    if(!output.length){
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('address', `${query}, ${localityText}`);url.searchParams.set('components', `administrative_area:${state}|country:BR`);url.searchParams.set('region', 'br');url.searchParams.set('language', 'pt-BR');url.searchParams.set('key', googleKey);
      const response = await safeFetch(url.toString());
      if (response?.ok) {
        const payload = await response.json<any>().catch(() => null);
        for (const item of (payload?.results || []).slice(0, 8)) {
          const components = item.address_components || [];
          const foundNumber = component(components, 'street_number');
          const foundCity = component(components, 'administrative_area_level_2') || component(components, 'locality') || component(components, 'sublocality_level_1');
          const foundState = component(components, 'administrative_area_level_1'),foundStateCode = component(components, 'administrative_area_level_1', true);
          const route = component(components, 'route');
          const premise = component(components, 'premise') || component(components, 'establishment') || component(components, 'point_of_interest');
          const placeName = premise || (/^[^,]+/.exec(query)?.[0] || query);
          const candidate: AddressCandidate = {provider:'google',provider_id:String(item.place_id || ''),formatted_address:String(item.formatted_address || `${query}, ${localityText}`),display_name:String(item.formatted_address || ''),street:route || placeName || query,number:foundNumber || 'S/N',neighborhood:component(components, 'sublocality_level_1') || component(components, 'neighborhood') || '',city:foundCity || city,state:foundState || state,state_code:foundStateCode || state,postal_code:component(components, 'postal_code') || '',country:component(components, 'country') || 'Brasil',lat:Number(item.geometry?.location?.lat),lng:Number(item.geometry?.location?.lng),precision:googlePrecision(String(item.geometry?.location_type || '')),exact_number:Boolean(foundNumber) || Boolean(premise),exact_city:cityMatches(foundCity||city),exact_state:stateMatches(foundState||state,foundStateCode||state),place_name:placeName};
          if (Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng) && candidate.exact_state) output.push(candidate);
        }
      }
    }
  }

  if (mapsConfig.provider === 'openstreetmap' && !output.some(item => item.exact_state && (item.place_name || item.exact_number))) {
    const url = new URL(env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', `${query}, ${localityText}`);
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('namedetails', '1');
    url.searchParams.set('limit', '10');
    url.searchParams.set('dedupe', '1');
    const response = await safeFetch(url.toString(), { headers:{'User-Agent':'ChegaJa/14.13 contato@chegaja.app','Accept-Language':'pt-BR'} });
    if (response?.ok) {
      const payload = await response.json<any[]>().catch(() => []);
      for (const item of payload || []) {
        const address = item.address || {};
        const foundCityRaw = String(address.city || address.town || address.village || address.municipality || address.county || '');
        const foundStateRaw = String(address.state || '');
        const foundStateCodeRaw = String(address['ISO3166-2-lvl4'] || '').split('-').pop() || '';
        const foundCity = foundCityRaw || city, foundState = foundStateRaw || state, foundStateCode = foundStateCodeRaw || state;
        const placeName = String(item.namedetails?.name || item.name || String(item.display_name || '').split(',')[0] || query);
        const route = String(address.road || address.pedestrian || address.residential || address.street || '');
        const number = String(address.house_number || 'S/N');
        const candidate: AddressCandidate = {
          provider:'nominatim', provider_id:String(item.place_id || item.osm_id || ''),
          formatted_address:String(item.display_name || `${query}, ${localityText}`), display_name:String(item.display_name || ''),
          street:route || placeName || query, number, neighborhood:String(address.suburb || address.neighbourhood || address.quarter || ''),
          city:foundCity, state:foundState, state_code:foundStateCode, postal_code:String(address.postcode || ''), country:String(address.country || 'Brasil'),
          lat:Number(item.lat), lng:Number(item.lon), precision:nominatimPrecision(String(item.type || ''), String(item.class || '')),
          exact_number:number !== 'S/N' || ['building','amenity','shop','tourism','office','leisure'].includes(String(item.class || '')),
          exact_city:cityMatches(foundCity), exact_state:stateMatches(foundState,foundStateCode), place_name:placeName
        };
        if (Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng) && candidate.exact_state) output.push(candidate);
      }
    }
  }

  const unique = new Map<string,AddressCandidate>();
  for (const item of output) {
    if (!item.exact_state) continue;
    const key=`${item.lat.toFixed(6)}:${item.lng.toFixed(6)}`;
    if (!unique.has(key)) unique.set(key,item);
  }
  return [...unique.values()].sort((a,b)=>(Number(Boolean(b.place_name))-Number(Boolean(a.place_name)))+(Number(b.exact_city)-Number(a.exact_city))+(Number(b.exact_number)-Number(a.exact_number))).slice(0,8);
}

export async function searchAddressCandidates(env: Env, input: AddressSearchInput): Promise<AddressCandidate[]> {
  const street = input.street.trim();
  const number = input.number.trim();
  const city = input.city.trim();
  const state = input.state.trim();
  if (!street || !number || !city || !state) return [];

  const expectedCity = norm(city);
  const expectedState = norm(state);
  const expectedNumber = norm(number);
  const output: AddressCandidate[] = [];
  const mapsConfig = await getMapsRuntimeConfig(env);
  const googleKey = mapsConfig.provider === 'google' ? mapsConfig.serverKey : '';

  if (googleKey) {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', formatStructuredAddress(input));
    url.searchParams.set('components', `administrative_area:${state}|country:BR`);
    url.searchParams.set('region', 'br');
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('key', googleKey);
    const response = await safeFetch(url.toString());
    if (response?.ok) {
      const payload = await response.json<any>().catch(() => null);
      for (const item of (payload?.results || []).slice(0, 8)) {
        const components = item.address_components || [];
        const foundNumber = component(components, 'street_number');
        const foundCity = component(components, 'administrative_area_level_2') || component(components, 'locality') || component(components, 'sublocality_level_1');
        const foundState = component(components, 'administrative_area_level_1');
        const foundStateCode = component(components, 'administrative_area_level_1', true);
        const candidate: AddressCandidate = {
          provider: 'google', provider_id: String(item.place_id || ''),
          formatted_address: String(item.formatted_address || formatStructuredAddress(input)),
          display_name: String(item.formatted_address || ''),
          street: component(components, 'route') || street,
          number: foundNumber || number,
          neighborhood: component(components, 'sublocality_level_1') || component(components, 'neighborhood') || input.neighborhood || '',
          city: foundCity || city, state: foundState || state, state_code: foundStateCode || state,
          postal_code: component(components, 'postal_code') || input.postal_code || '', country: component(components, 'country') || 'Brasil',
          lat: Number(item.geometry?.location?.lat), lng: Number(item.geometry?.location?.lng),
          precision: googlePrecision(String(item.geometry?.location_type || '')),
          exact_number: norm(foundNumber) === expectedNumber,
          exact_city: norm(foundCity) === expectedCity,
          exact_state: [norm(foundState), norm(foundStateCode)].includes(expectedState)
        };
        if (Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)) output.push(candidate);
      }
    }
  }

  if (mapsConfig.provider === 'openstreetmap' && !output.some(item => item.exact_number && item.exact_city && item.exact_state && ['rooftop', 'interpolated'].includes(item.precision))) {
    const url = new URL(env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search');
    // A busca livre preserva bairro, número, cidade e UF no mesmo contexto. Usar
    // county para bairro fazia o Nominatim procurar municípios errados.
    url.searchParams.set('q', formatStructuredAddress(input));
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '10');
    url.searchParams.set('dedupe', '1');
    const response = await safeFetch(url.toString(), { headers: { 'User-Agent':'ChegaJa/12.5 contato@chegaja.app', 'Accept-Language':'pt-BR' } });
    if (response?.ok) {
      const payload = await response.json<any[]>().catch(() => []);
      for (const item of payload || []) {
        const address = item.address || {};
        const foundNumber = String(address.house_number || '');
        const foundCity = String(address.city || address.town || address.village || address.municipality || address.county || '');
        const foundState = String(address.state || '');
        const foundStateCode = String(address['ISO3166-2-lvl4'] || '').split('-').pop() || foundState;
        const candidate: AddressCandidate = {
          provider:'nominatim', provider_id:String(item.place_id || item.osm_id || ''),
          formatted_address:String(item.display_name || formatStructuredAddress(input)), display_name:String(item.display_name || ''),
          street:String(address.road || address.pedestrian || address.residential || address.street || street), number:foundNumber || number,
          neighborhood:String(address.suburb || address.neighbourhood || address.quarter || input.neighborhood || ''),
          city:foundCity || city, state:foundState || state, state_code:foundStateCode || state,
          postal_code:String(address.postcode || input.postal_code || ''), country:String(address.country || 'Brasil'),
          lat:Number(item.lat), lng:Number(item.lon),
          precision:nominatimPrecision(String(item.type || ''), String(item.class || '')),
          exact_number:norm(foundNumber) === expectedNumber,
          exact_city:norm(foundCity) === expectedCity,
          exact_state:[norm(foundState), norm(foundStateCode)].includes(expectedState)
        };
        if (Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)) output.push(candidate);
      }
    }
  }

  const unique = new Map<string, AddressCandidate>();
  for (const candidate of output) {
    const key = `${candidate.lat.toFixed(6)}:${candidate.lng.toFixed(6)}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  const candidates = [...unique.values()];
  const sameRegion = candidates.filter(item => item.exact_city && item.exact_state);
  const regionSafe = sameRegion.length ? sameRegion : candidates.filter(item => item.exact_state);
  const score = (item: AddressCandidate) =>
    (item.exact_number ? 100 : 0) + (item.exact_city ? 30 : 0) + (item.exact_state ? 20 : 0) +
    ({ rooftop:15, interpolated:10, street:4, approximate:0 }[item.precision]);
  return regionSafe.sort((a,b) => score(b)-score(a)).slice(0,6);
}

export async function geocodeAddress(env: Env, address: string): Promise<GeoPoint | null> {
  const query = address.trim();
  if (!query) return null;
  const mapsConfig = await getMapsRuntimeConfig(env);
  const googleKey = mapsConfig.provider === 'google' ? mapsConfig.serverKey : '';
  if (googleKey) {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query); url.searchParams.set('components','country:BR');
    url.searchParams.set('region','br'); url.searchParams.set('key',googleKey); url.searchParams.set('language','pt-BR');
    const response = await safeFetch(url.toString());
    if (response?.ok) {
      const payload = await response.json<any>().catch(()=>null), item=payload?.results?.[0];
      if(item?.geometry?.location)return{lat:item.geometry.location.lat,lng:item.geometry.location.lng,display_name:item.formatted_address};
    }
  }
  // Se o Master escolheu Google, não esconda falhas usando outro provedor.
  if (mapsConfig.provider === 'google') return null;
  const url=new URL(env.GEOCODER_URL||'https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q',query);url.searchParams.set('format','jsonv2');url.searchParams.set('limit','1');url.searchParams.set('countrycodes','br');
  const response=await safeFetch(url.toString(),{headers:{'User-Agent':'ChegaJa/12.5 contato@chegaja.app','Accept-Language':'pt-BR'}});
  if(!response?.ok)return null;
  const payload=await response.json<any[]>().catch(()=>[]),item=payload?.[0];
  return item?{lat:Number(item.lat),lng:Number(item.lon),display_name:item.display_name}:null;
}

export async function routeBetween(env: Env, points: GeoPoint[]): Promise<RouteResult | null> {
  if(points.length<2)return null;
  const mapsConfig = await getMapsRuntimeConfig(env);
  const googleKey = mapsConfig.provider === 'google' ? mapsConfig.serverKey : '';
  if(googleKey){
    const body={origin:{location:{latLng:{latitude:points[0].lat,longitude:points[0].lng}}},destination:{location:{latLng:{latitude:points.at(-1)!.lat,longitude:points.at(-1)!.lng}}},intermediates:points.slice(1,-1).map(point=>({location:{latLng:{latitude:point.lat,longitude:point.lng}}})),travelMode:'DRIVE',routingPreference:'TRAFFIC_AWARE',languageCode:'pt-BR',units:'METRIC',polylineQuality:'HIGH_QUALITY',polylineEncoding:'GEO_JSON_LINESTRING'};
    const response=await safeFetch('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':googleKey,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring'},body:JSON.stringify(body)});
    if(response?.ok){const payload=await response.json<any>().catch(()=>null),route=payload?.routes?.[0],coordinates=route?.polyline?.geoJsonLinestring?.coordinates||[];if(route)return{distance_meters:Number(route.distanceMeters||0),duration_seconds:Number(String(route.duration||'0s').replace('s',''))||0,geometry:coordinates.map((point:number[])=>[Number(point[1]),Number(point[0])] as [number,number])};}
  }
  if (mapsConfig.provider === 'google') return null;
  const base=(env.ROUTER_URL||'https://router.project-osrm.org/route/v1/driving').replace(/\/$/,'');
  const coordinates=points.map(point=>`${point.lng},${point.lat}`).join(';');
  const response=await safeFetch(`${base}/${coordinates}?overview=full&geometries=geojson&steps=false`,{headers:{'User-Agent':'ChegaJa/12.5'}});
  if(!response?.ok)return null;
  const payload=await response.json<any>().catch(()=>null),route=payload?.routes?.[0];
  return route?{distance_meters:Math.round(Number(route.distance||0)),duration_seconds:Math.round(Number(route.duration||0)),geometry:(route.geometry?.coordinates||[]).map((point:number[])=>[Number(point[1]),Number(point[0])] as [number,number])}:null;
}

function navigationInstruction(type: string, modifier: string, street: string): string {
  const road = street ? ` na ${street}` : '';
  if (type === 'depart') return `Inicie o percurso${road}`;
  if (type === 'arrive') return 'Você chegou ao destino';
  if (type === 'roundabout' || type === 'rotary') return `Entre na rotatória${road}`;
  if (type === 'merge') return `Entre na via${road}`;
  if (type === 'fork') return modifier.includes('left') ? `Mantenha-se à esquerda${road}` : `Mantenha-se à direita${road}`;
  if (type === 'on ramp') return `Acesse a alça${road}`;
  if (type === 'off ramp') return `Saia pela alça${road}`;
  if (modifier === 'uturn') return `Faça o retorno${road}`;
  if (modifier.includes('left')) return modifier.includes('slight') ? `Vire levemente à esquerda${road}` : modifier.includes('sharp') ? `Vire acentuadamente à esquerda${road}` : `Vire à esquerda${road}`;
  if (modifier.includes('right')) return modifier.includes('slight') ? `Vire levemente à direita${road}` : modifier.includes('sharp') ? `Vire acentuadamente à direita${road}` : `Vire à direita${road}`;
  return `Siga em frente${road}`;
}

export async function navigationRoute(env: Env, origin: GeoPoint, destination: GeoPoint): Promise<NavigationRouteResult | null> {
  const mapsConfig = await getMapsRuntimeConfig(env);
  const googleKey = mapsConfig.provider === 'google' ? mapsConfig.serverKey : '';
  if (googleKey) {
    const body={
      origin:{location:{latLng:{latitude:origin.lat,longitude:origin.lng}}},
      destination:{location:{latLng:{latitude:destination.lat,longitude:destination.lng}}},
      travelMode:'DRIVE',routingPreference:'TRAFFIC_AWARE',languageCode:'pt-BR',units:'METRIC',
      polylineQuality:'HIGH_QUALITY',polylineEncoding:'GEO_JSON_LINESTRING'
    };
    const fieldMask=[
      'routes.distanceMeters','routes.duration','routes.polyline.geoJsonLinestring',
      'routes.legs.steps.distanceMeters','routes.legs.steps.staticDuration',
      'routes.legs.steps.navigationInstruction','routes.legs.steps.startLocation'
    ].join(',');
    const response=await safeFetch('https://routes.googleapis.com/directions/v2:computeRoutes',{
      method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':googleKey,'X-Goog-FieldMask':fieldMask},body:JSON.stringify(body)
    });
    if(response?.ok){
      const payload=await response.json<any>().catch(()=>null),route=payload?.routes?.[0];
      if(route){
        const coordinates=route?.polyline?.geoJsonLinestring?.coordinates||[];
        const steps=(route.legs||[]).flatMap((leg:any)=>leg.steps||[]).map((step:any)=>{
          const rawManeuver=String(step.navigationInstruction?.maneuver||'STRAIGHT').toLowerCase();
          const location=step.startLocation?.latLng
            ? [Number(step.startLocation.latLng.latitude),Number(step.startLocation.latLng.longitude)] as [number,number]
            : null;
          return {
            instruction:String(step.navigationInstruction?.instructions||'Siga pela rota'),
            street:'',
            distance_meters:Math.round(Number(step.distanceMeters||0)),
            duration_seconds:Math.round(Number(String(step.staticDuration||'0s').replace('s',''))||0),
            maneuver_type:rawManeuver,
            maneuver_modifier:'',
            location
          };
        });
        return {
          distance_meters:Number(route.distanceMeters||0),
          duration_seconds:Number(String(route.duration||'0s').replace('s',''))||0,
          geometry:coordinates.map((point:number[])=>[Number(point[1]),Number(point[0])] as [number,number]),
          steps
        };
      }
    }
  }

  if (mapsConfig.provider === 'google') return null;
  const base=(env.ROUTER_URL||'https://router.project-osrm.org/route/v1/driving').replace(/\/$/,'');
  const coordinates=`${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const response=await safeFetch(`${base}/${coordinates}?overview=full&geometries=geojson&steps=true&annotations=false`,{headers:{'User-Agent':'ChegaJa/14.15.9'}});
  if(response?.ok){
    const payload=await response.json<any>().catch(()=>null),route=payload?.routes?.[0];
    if(route){
      const steps=(route.legs||[]).flatMap((leg:any)=>leg.steps||[]).map((step:any)=>{
        const type=String(step.maneuver?.type||''),modifier=String(step.maneuver?.modifier||''),street=String(step.name||'');
        const location=Array.isArray(step.maneuver?.location)?[Number(step.maneuver.location[1]),Number(step.maneuver.location[0])] as [number,number]:null;
        return {instruction:navigationInstruction(type,modifier,street),street,distance_meters:Math.round(Number(step.distance||0)),duration_seconds:Math.round(Number(step.duration||0)),maneuver_type:type,maneuver_modifier:modifier,location};
      });
      return {distance_meters:Math.round(Number(route.distance||0)),duration_seconds:Math.round(Number(route.duration||0)),geometry:(route.geometry?.coordinates||[]).map((point:number[])=>[Number(point[1]),Number(point[0])] as [number,number]),steps};
    }
  }
  const fallback=await routeBetween(env,[origin,destination]);
  return fallback?{...fallback,steps:[{instruction:'Siga pela rota até o destino',street:'',distance_meters:fallback.distance_meters,duration_seconds:fallback.duration_seconds,maneuver_type:'continue',maneuver_modifier:'straight',location:[destination.lat,destination.lng]}]}:null;
}

export function routePrice(distanceMeters:number,ratePerKmCents:number,minimumCents:number,servicesCents=0){
  const distanceValue=Math.ceil(Math.max(0,distanceMeters)/1000*Math.max(0,ratePerKmCents));
  return Math.max(Math.max(0,minimumCents),distanceValue)+Math.max(0,servicesCents);
}
