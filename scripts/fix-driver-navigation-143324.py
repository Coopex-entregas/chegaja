from pathlib import Path

ROOT=Path('.')

def read(path): return (ROOT/path).read_text(encoding='utf-8')
def write(path,text): (ROOT/path).write_text(text,encoding='utf-8')
def replace_once(text,old,new,label):
    if old not in text: raise RuntimeError(f'Bloco não encontrado: {label}')
    return text.replace(old,new,1)
def replace_line(text,prefix,new_line,label):
    lines=text.splitlines()
    for i,line in enumerate(lines):
        if line.startswith(prefix):
            lines[i]=new_line
            return '\n'.join(lines)+('\n' if text.endswith('\n') else '')
    raise RuntimeError(f'Linha não encontrada: {label}')

def insert_before_line(text,prefix,block,label):
    lines=text.splitlines()
    for i,line in enumerate(lines):
        if line.startswith(prefix):
            lines[i:i]=block.splitlines()
            return '\n'.join(lines)+('\n' if text.endswith('\n') else '')
    raise RuntimeError(f'Linha não encontrada para inserir: {label}')

# Frontend único do cooperado
js_path='public/chegaja-v217-driver-navigation.js'
js=read(js_path)
if 'ChegaJá 14.33.24' not in js:
    js=replace_once(js,'/* ChegaJá 14.33.23 — navegação visual enquadra cooperado, trajeto e destino */','/* ChegaJá 14.33.24 — rota real, marcador compacto e voz brasileira */','versão JS')
    js=js.replace('__CJ_DRIVER_LEAFLET_143323__','__CJ_DRIVER_LEAFLET_143324__')
    js=replace_once(js,'navFrameTarget:null};','navFrameTarget:null,lastVoiceText:\'\',lastVoiceAt:0,lastVoiceTarget:\'\',voicePtBr:null};','estado da voz')

    voice_block="""function ptBrVoice(){if(!('speechSynthesis'in window))return null;const voices=window.speechSynthesis.getVoices?.()||[];const voice=voices.find(v=>String(v.lang||'').toLowerCase()==='pt-br')||voices.find(v=>String(v.lang||'').toLowerCase().startsWith('pt-br'))||null;if(voice)A.voicePtBr=voice;return voice||A.voicePtBr||null}
function speakPtBr(text,force=false){text=String(text||'').trim();if(!text||!('speechSynthesis'in window)||typeof SpeechSynthesisUtterance==='undefined')return false;const voice=ptBrVoice();if(!voice)return false;if(!force&&text===A.lastVoiceText&&Date.now()-A.lastVoiceAt<45000)return false;try{const u=new SpeechSynthesisUtterance(text);u.lang='pt-BR';u.voice=voice;u.rate=1.02;u.pitch=1;u.volume=1;window.speechSynthesis.cancel();window.speechSynthesis.speak(u);A.lastVoiceText=text;A.lastVoiceAt=Date.now();return true}catch{return false}}
function maybeSpeakNavigation(nav){if(!nav||!valid(A.gps))return;const targetKey=`${A.detail?.id||''}:${targetKind()}`;if(targetKey!==A.lastVoiceTarget){A.lastVoiceTarget=targetKey;A.lastVoiceText='';A.lastVoiceAt=0}if(nav.arrived){speakPtBr(targetKind()==='pickup'?'Você chegou ao local da coleta.':'Você chegou ao destino da entrega.',true);return}const steps=Array.isArray(nav.route?.steps)?nav.route.steps:[];if(!steps.length)return;let chosen=null;for(let i=0;i<steps.length;i++){const s=steps[i],loc=Array.isArray(s?.location)?point(s.location[0],s.location[1]):null,d=valid(loc)?distance(A.gps,loc):Infinity;if(i===0||d<=220){chosen=s;if(d<=220)break}}if(!chosen)return;let text=String(chosen.instruction||'').trim();const meters=Math.round(Number(chosen.distance_meters||0));if(meters>=80&&meters<=1200&&!/^em\s/i.test(text))text=`Em ${meters} metros, ${text.charAt(0).toLowerCase()+text.slice(1)}`;speakPtBr(text)}
if('speechSynthesis'in window){window.speechSynthesis.addEventListener?.('voiceschanged',()=>ptBrVoice());setTimeout(()=>ptBrVoice(),400)}"""
    js=insert_before_line(js,'async function updateRoute(',voice_block,'voz pt-BR')

    old_prefix='async function updateRoute('
    update_route="async function updateRoute(force=false){if(!A.detail||!['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(String(A.detail.status))||A.routeBusy||document.hidden)return;const origin=A.gps;if(!valid(origin))return;let target=targetPoint();if(valid(target)&&!routeDue(force)){if(navigationActive())frameNavigation(false);return}if(!force&&!valid(target)&&Date.now()-A.lastRouteAt<5000)return;A.routeBusy=true;A.lastRouteAt=Date.now();try{let pts=[],nav=null;if(valid(target)){drawRoute([{...origin},{...target}]);ensureSelf();updateStops();if(navigationActive())frameNavigation(true)}try{nav=await api(`/api/app/v32/driver/navigation?lat=${encodeURIComponent(origin.lat)}&lng=${encodeURIComponent(origin.lng)}`,{timeout:11000});const serverTarget=point(nav.next?.lat,nav.next?.lng);if(valid(serverTarget)){A.navTarget={...serverTarget};target=serverTarget;updateStops();drawRoute([{...origin},{...target}]);frameNavigation(true)}pts=normalizeGeometry(nav.route?.geometry);maybeSpeakNavigation(nav)}catch{}if(!valid(target)&&valid(A.navTarget))target=A.navTarget;if(!valid(target)){notice('Não consegui localizar o endereço da coleta/entrega no mapa.',true);return}if(pts.length>=2){let nearest=Infinity;for(const p of pts)nearest=Math.min(nearest,distance(origin,p));const endpoint=Math.min(distance(target,pts[0]),distance(target,pts.at(-1)));if(nearest>260||endpoint>320)pts=[]}if(pts.length<2)pts=await osrm(origin,target);if(pts.length<2)pts=[{...origin},{...target}];A.lastRouteOrigin={...origin};A.lastRouteTarget={...target};drawRoute(pts);trimRouteToGps();ensureSelf();updateStops();if(navigationActive()&&!A.manualView&&A.following)frameNavigation(true);else fitRouteOnce()}finally{A.routeBusy=false}}"
    js=replace_line(js,old_prefix,update_route,'rota com destino resolvido e voz')
    write(js_path,js)

# CSS: remover halo gigante e reduzir seta/pontos
css_path='public/chegaja-v217-driver-navigation.css'
css=read(css_path)
css=css.replace('/* ChegaJá 14.33.23 — ÚNICA folha do painel do cooperado. */','/* ChegaJá 14.33.24 — ÚNICA folha do painel do cooperado. */',1)
if 'ChegaJá 14.33.24 — marcador proporcional' not in css:
    css += """

/* ChegaJá 14.33.24 — marcador proporcional às ruas */
body.cj199-driver #cj199-map .cj217-self-icon:before{display:none!important;content:none!important}
body.cj199-driver #cj199-map .cj217-self-marker{width:22px!important;height:27px!important;border:2px solid #fff!important;filter:drop-shadow(0 3px 4px rgba(7,24,58,.62))!important}
body.cj199-driver #cj199-map .cj217-self-marker i{width:4px!important;height:4px!important}
body.cj199-driver #cj199-map .cj217-stop-icon span{width:30px!important;height:30px!important;font-size:11px!important;border-width:2px!important}
body.cj199-driver #cj199-map .cj217-stop-icon:after{top:34px!important;font-size:8px!important;padding:4px 6px!important}
"""
write(css_path,css)

# Backend: se uma entrega antiga tiver endereço sem coordenadas, resolve e persiste.
ts_path='src/routes/platform-v32.ts'
ts=read(ts_path)
if 'ChegaJa/14.33.24' not in ts:
    ts=ts.replace("'User-Agent':'ChegaJa/14.33.21'","'User-Agent':'ChegaJa/14.33.24'",1)
    anchor="const ARRIVAL_RADIUS_METERS=35;\nconst valid=(lat:number,lng:number)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&(Math.abs(lat)+Math.abs(lng)>0.001);"
    replacement=anchor+"""
const geocodeCache=new Map<string,{at:number,value:{lat:number;lng:number}|null}>();
async function geocodeAddress(address:string){
 const key=String(address||'').trim().toLowerCase();if(!key)return null;
 const cached=geocodeCache.get(key);if(cached&&Date.now()-cached.at<10*60*1000)return cached.value;
 const queries=[String(address||'').trim(),`${String(address||'').trim()}, Rio Grande do Norte, Brasil`];
 for(const q of queries){
  try{const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&addressdetails=0&q=${encodeURIComponent(q)}`;const r=await fetch(url,{headers:{'User-Agent':'ChegaJa/14.33.24 (COOPEX Entregas RN)','Accept-Language':'pt-BR,pt;q=0.9'}});if(!r.ok)continue;const data=await r.json<any[]>().catch(()=>[]),first=data?.[0],lat=Number(first?.lat),lng=Number(first?.lon);if(valid(lat,lng)){const value={lat,lng};geocodeCache.set(key,{at:Date.now(),value});return value}}catch{}
 }
 geocodeCache.set(key,{at:Date.now(),value:null});return null;
}"""
    ts=replace_once(ts,anchor,replacement,'helper de geocodificação')

    old=""" const stops:Stop[]=[];
 for(const item of rows.results||[]){
  const beforePickup=['accepted','to_pickup','at_pickup','problem'].includes(String(item.status));
  if(beforePickup&&valid(Number(item.pickup_lat),Number(item.pickup_lng)))stops.push({delivery_id:item.id,display_code:item.display_code,kind:'pickup',label:'Coleta',address:item.pickup_address||'',lat:Number(item.pickup_lat),lng:Number(item.pickup_lng),status:item.status});
  else if(valid(Number(item.delivery_lat),Number(item.delivery_lng)))stops.push({delivery_id:item.id,display_code:item.display_code,kind:'delivery',label:'Entrega',address:item.delivery_address||'',lat:Number(item.delivery_lat),lng:Number(item.delivery_lng),status:item.status});
 }"""
    new=""" const stops:Stop[]=[];let geocodeBudget=1;
 for(const item of rows.results||[]){
  const beforePickup=['accepted','to_pickup','at_pickup','problem'].includes(String(item.status));
  const kind=beforePickup?'pickup':'delivery',address=String(beforePickup?item.pickup_address:item.delivery_address||'').trim();
  let targetLat=Number(beforePickup?item.pickup_lat:item.delivery_lat),targetLng=Number(beforePickup?item.pickup_lng:item.delivery_lng);
  if(!valid(targetLat,targetLng)&&address&&geocodeBudget>0){
   geocodeBudget--;const geo=await geocodeAddress(address);if(geo){targetLat=geo.lat;targetLng=geo.lng;if(beforePickup)await c.env.DB.prepare(`UPDATE deliveries SET pickup_lat=?,pickup_lng=?,updated_at=datetime('now') WHERE id=? AND cooperative_id=?`).bind(targetLat,targetLng,item.id,auth.cooperativeId).run();else await c.env.DB.prepare(`UPDATE deliveries SET delivery_lat=?,delivery_lng=?,updated_at=datetime('now') WHERE id=? AND cooperative_id=?`).bind(targetLat,targetLng,item.id,auth.cooperativeId).run()}
  }
  if(valid(targetLat,targetLng))stops.push({delivery_id:item.id,display_code:item.display_code,kind,label:beforePickup?'Coleta':'Entrega',address,lat:targetLat,lng:targetLng,status:item.status});
 }"""
    ts=replace_once(ts,old,new,'resolução de coordenadas da entrega')
    write(ts_path,ts)

# Cache da versão
index_path='public/index.html'
index=read(index_path)
index=index.replace('app-version" content="14.33.23"','app-version" content="14.33.24"')
index=index.replace('chegaja-v217-driver-navigation.js?v=14.33.23&recovery=143323','chegaja-v217-driver-navigation.js?v=14.33.24&recovery=143324')
index=index.replace('chegaja-v217-driver-navigation.css?v=14.33.23&recovery=143323','chegaja-v217-driver-navigation.css?v=14.33.24&recovery=143324')
write(index_path,index)

# Atualiza teste regressivo e acrescenta garantias novas
test_path='scripts/test-v14153-logo-google-maps.mjs'
test=read(test_path)
test=test.replace('14\\.33\\.23','14\\.33\\.24').replace('143323','143324').replace('ChegaJá 14.33.23:','ChegaJá 14.33.24:')
anchor="assert.match(driver,/maxZoom:17/);"
extra="""\nassert.match(driver,/function ptBrVoice\\(\\)/);\nassert.match(driver,/lang='pt-BR'/);\nassert.match(driver,/function maybeSpeakNavigation\\(nav\\)/);\nassert.doesNotMatch(driverCss,/cj217-self-icon:before\\{content:''/);\nassert.match(driverCss,/cj217-self-icon:before\\{display:none!important/);\nassert.match(navigation,/function geocodeAddress\\(address:string\\)/);\nassert.match(navigation,/nominatim\\.openstreetmap\\.org/);\nassert.match(navigation,/UPDATE deliveries SET pickup_lat=/);\nassert.match(navigation,/UPDATE deliveries SET delivery_lat=/);"""
if 'function ptBrVoice' not in test:
    test=test.replace(anchor,anchor+extra,1)
write(test_path,test)

print('ChegaJá 14.33.24 aplicado: geocodificação, rota real, marcador compacto e voz pt-BR.')
