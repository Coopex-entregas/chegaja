from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'Não encontrei trecho para {label}')
    return text.replace(old, new, 1)

# Backend: escolher uma única próxima parada usando distância real pelas ruas.
p = Path('src/routes/platform-v32.ts')
s = p.read_text()
s = replace_once(
    s,
    "const ARRIVAL_RADIUS_METERS=35;",
    "const ARRIVAL_RADIUS_METERS=35;\nconst DELIVERY_TIE_METERS=300;\nconst ROUTE_COMPARE_LIMIT=4;",
    'constantes de prioridade',
)
s = replace_once(
    s,
    "SELECT id,display_code,status,pickup_address,pickup_lat,pickup_lng,delivery_address,delivery_lat,delivery_lng,accepted_at,created_at FROM deliveries",
    "SELECT id,display_code,status,pickup_address,pickup_lat,pickup_lng,delivery_address,delivery_lat,delivery_lng,accepted_at,picked_up_at,created_at FROM deliveries",
    'picked_up_at na navegação',
)
s = replace_once(
    s,
    "  const beforePickup=['accepted','to_pickup','at_pickup','problem'].includes(String(item.status));\n  const kind=beforePickup?'pickup':'delivery',address=String(beforePickup?item.pickup_address:item.delivery_address||'').trim();",
    "  const status=String(item.status),collected=Boolean(item.picked_up_at)||['picked_up','in_route'].includes(status),beforePickup=!collected;\n  const kind=beforePickup?'pickup':'delivery',address=String(beforePickup?item.pickup_address:item.delivery_address||'').trim();",
    'estágio real da parada',
)
old_choice = """ stops.sort((a,b)=>distanceMeters(lat,lng,a.lat,a.lng)-distanceMeters(lat,lng,b.lat,b.lng));
 const next=stops[0]||null;
 if(!next)return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:[],next:null,route:null,arrived:false,arrival_radius_meters:ARRIVAL_RADIUS_METERS});
 const distanceToTarget=distanceMeters(lat,lng,next.lat,next.lng),arrived=distanceToTarget<=ARRIVAL_RADIUS_METERS;
 if(arrived)return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:stops,next,route:null,arrived:true,distance_to_target_meters:distanceToTarget,arrival_radius_meters:ARRIVAL_RADIUS_METERS,route_source:null});
 const origin={lat,lng},destination={lat:next.lat,lng:next.lng};
 const route=await openStreetMapRoute(c.env,origin,destination);
 return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:stops,next,route,arrived:false,distance_to_target_meters:distanceToTarget,arrival_radius_meters:ARRIVAL_RADIUS_METERS,route_source:route?.source||null});
"""
new_choice = """ const byAir=stops.map(stop=>({...stop,air_distance_meters:distanceMeters(lat,lng,stop.lat,stop.lng)})).sort((a,b)=>a.air_distance_meters-b.air_distance_meters);
 if(!byAir.length)return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:[],next:null,route:null,arrived:false,arrival_radius_meters:ARRIVAL_RADIUS_METERS});
 const lockedPickup=byAir.find(stop=>stop.status==='at_pickup')||null;
 const candidates:typeof byAir=[];
 const addCandidate=(stop:(typeof byAir)[number]|null|undefined)=>{if(stop&&!candidates.some(x=>x.delivery_id===stop.delivery_id&&x.kind===stop.kind))candidates.push(stop)};
 if(lockedPickup)addCandidate(lockedPickup);
 else{
  byAir.slice(0,2).forEach(addCandidate);
  addCandidate(byAir.find(stop=>stop.kind==='delivery'));
  addCandidate(byAir.find(stop=>stop.kind==='pickup'));
 }
 const origin={lat,lng};
 const evaluated:Array<(typeof byAir)[number]&{route:Route|null;route_distance_meters:number;route_duration_seconds:number|null}>=[];
 for(const stop of candidates.slice(0,ROUTE_COMPARE_LIMIT)){
  const alreadyThere=stop.air_distance_meters<=ARRIVAL_RADIUS_METERS;
  const route=alreadyThere?null:await openStreetMapRoute(c.env,origin,{lat:stop.lat,lng:stop.lng});
  evaluated.push({...stop,route,route_distance_meters:Number(route?.distance_meters||stop.air_distance_meters),route_duration_seconds:route?Number(route.duration_seconds):null});
 }
 let chosen=evaluated[0]||null,selectionReason='shortest_route';
 if(lockedPickup){chosen=evaluated.find(stop=>stop.delivery_id===lockedPickup.delivery_id&&stop.kind==='pickup')||chosen;selectionReason='pickup_in_progress'}
 else{
  evaluated.sort((a,b)=>a.route_distance_meters-b.route_distance_meters);
  chosen=evaluated[0]||null;
  const nearestDelivery=evaluated.filter(stop=>stop.kind==='delivery').sort((a,b)=>a.route_distance_meters-b.route_distance_meters)[0];
  const nearestPickup=evaluated.filter(stop=>stop.kind==='pickup').sort((a,b)=>a.route_distance_meters-b.route_distance_meters)[0];
  if(nearestDelivery&&nearestPickup&&Math.abs(nearestDelivery.route_distance_meters-nearestPickup.route_distance_meters)<=DELIVERY_TIE_METERS){chosen=nearestDelivery;selectionReason='delivery_priority_tie'}
 }
 if(!chosen)return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:[],next:null,route:null,arrived:false,arrival_radius_meters:ARRIVAL_RADIUS_METERS});
 const chosenRoute=chosen.route,{route:_route,...next}=chosen,distanceToTarget=chosen.air_distance_meters,arrived=distanceToTarget<=ARRIVAL_RADIUS_METERS;
 const orderedItems=byAir.map(({air_distance_meters,...stop})=>({...stop,distance_to_target_meters:Math.round(air_distance_meters)}));
 if(arrived)return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:orderedItems,next,route:null,arrived:true,distance_to_target_meters:distanceToTarget,arrival_radius_meters:ARRIVAL_RADIUS_METERS,route_source:null,selection_reason:selectionReason,delivery_tie_meters:DELIVERY_TIE_METERS});
 return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:orderedItems,next,route:chosenRoute,arrived:false,distance_to_target_meters:distanceToTarget,arrival_radius_meters:ARRIVAL_RADIUS_METERS,route_source:chosenRoute?.source||null,selection_reason:selectionReason,delivery_tie_meters:DELIVERY_TIE_METERS});
"""
s = replace_once(s, old_choice, new_choice, 'seleção da próxima parada')
p.write_text(s)

# Frontend: manter a entrega exibida sincronizada com a parada escolhida pelo roteador.
p = Path('public/chegaja-v217-driver-navigation.js')
s = p.read_text()
s = s.replace('/* ChegaJá 14.33.35 — alerta instantâneo e combustível global */','/* ChegaJá 14.33.38 — prioridade clara entre coletas e entregas */',1)
s = s.replace('if(window.__CJ_DRIVER_LEAFLET_143335__)return;window.__CJ_DRIVER_LEAFLET_143335__=true;','if(window.__CJ_DRIVER_LEAFLET_143338__)return;window.__CJ_DRIVER_LEAFLET_143338__=true;',1)
s = replace_once(
    s,
    "detail:null,queue:null,summary:null",
    "detail:null,activeItems:[],navPlan:null,navPlanAt:0,queue:null,summary:null",
    'estado multi-entrega',
)
helpers = """function activeItemById(id){const key=String(id||'');return key?(A.activeItems||[]).find(item=>String(item?.id||'')===key)||null:null}
function basicFromLive(live){A.activeItems=Array.isArray(live?.active_items)?live.active_items.filter(Boolean):[];if(!A.activeItems.length){A.navPlan=null;A.navPlanAt=0}if(live?.call)return live.call;const planned=activeItemById(A.navPlan?.next?.delivery_id),current=activeItemById(A.detail?.id);return planned||current||live?.active||A.activeItems[0]||null}
async function syncDetailToNavigation(next){const wanted=String(next?.delivery_id||'');if(!wanted||wanted===String(A.detail?.id||''))return false;let chosen=activeItemById(wanted);if(!chosen)return false;try{chosen=(await api(`/api/app/v28/driver/calls/${encodeURIComponent(wanted)}`,{timeout:5500})).item||chosen}catch{}A.detail={...chosen};A.arrivedDelivery=Boolean(chosen.delivery_arrived_at);A.wait=null;A.localPickupSince=String(chosen.status)==='at_pickup'?Date.now():0;A.nextInstruction=null;A.lastVoiceText='';A.lastVoiceTarget='';clearRoute();updateStops();renderControls();renderSheet(true);return true}
"""
marker = "async function updateRoute(force=false){"
if helpers not in s:
    if marker not in s: raise SystemExit('Não encontrei updateRoute')
    s=s.replace(marker,helpers+marker,1)
old_nav = "try{let pts=[],nav=null;try{nav=await api(`/api/app/v32/driver/navigation?lat=${encodeURIComponent(origin.lat)}&lng=${encodeURIComponent(origin.lng)}`,{timeout:11000});const serverTarget=point(nav.next?.lat,nav.next?.lng);"
new_nav = "try{let pts=[],nav=null;try{const cached=A.navPlan&&Date.now()-A.navPlanAt<4200?A.navPlan:null;nav=cached||await api(`/api/app/v32/driver/navigation?lat=${encodeURIComponent(origin.lat)}&lng=${encodeURIComponent(origin.lng)}`,{timeout:11000});A.navPlan=nav;A.navPlanAt=Date.now();if(nav.next?.delivery_id&&String(nav.next.delivery_id)!==String(A.detail?.id||''))await syncDetailToNavigation(nav.next);const serverTarget=point(nav.next?.lat,nav.next?.lng);"
s = replace_once(s, old_nav, new_nav, 'sincronização da rota escolhida')
s = replace_once(s, "const basic=live.call||live.active||null;", "const basic=basicFromLive(live);", 'seleção do item ativo')
old_metric = "label.textContent='NAVEGAÇÃO ATIVA';value.textContent=nav?.text?`${nav.glyph||'↑'} ${nav.text}`:statusText(A.detail.status).toUpperCase();hint.textContent=nav&&Number(nav.meters)>0?`${Math.round(nav.meters)} m • próxima manobra`:'Siga a linha azul; o sentido da marcha fica para cima'"
new_metric = "const stopLabel=targetKind()==='delivery'?'ENTREGA':'COLETA',code=String(A.detail.display_code||'').trim();label.textContent=code?`${stopLabel} • ${code}`:stopLabel;value.textContent=nav?.text?`${nav.glyph||'↑'} ${nav.text}`:statusText(A.detail.status).toUpperCase();hint.textContent=nav&&Number(nav.meters)>0?`${Math.round(nav.meters)} m • próxima manobra`:`Próxima parada: ${stopLabel.toLowerCase()}`"
s = replace_once(s, old_metric, new_metric, 'clareza do card de navegação')
s = replace_once(
    s,
    "<small>${offer?'NOVA ENTREGA':'ENTREGA ATUAL'}</small><strong>${esc(x.display_code||'Entrega')}</strong>",
    "<small>${offer?'NOVA ENTREGA':`PRÓXIMA ${targetKind()==='delivery'?'ENTREGA':'COLETA'}`}</small><strong>${esc(x.display_code||'Entrega')}</strong>",
    'clareza da próxima parada no painel',
)
p.write_text(s)

# Cache da versão pública.
p = Path('public/index.html')
s = p.read_text()
s = s.replace('meta name="app-version" content="14.33.36"','meta name="app-version" content="14.33.38"',1)
s = s.replace('/chegaja-v217-driver-navigation.js?v=14.33.36&recovery=143336','/chegaja-v217-driver-navigation.js?v=14.33.38&recovery=143338',1)
p.write_text(s)

# Atualiza somente as expectativas de versão e acrescenta regressão específica.
p = Path('scripts/test-v14153-logo-google-maps.mjs')
s = p.read_text()
s = s.replace('app-version\\" content=\\"14\\.33\\.36\\"','app-version\\" content=\\"14\\.33\\.38\\"')
s = s.replace('chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.36&recovery=143336','chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.38&recovery=143338')
s = s.replace('assert.match(driver,/ChegaJá 14\\.33\\.35/);','assert.match(driver,/ChegaJá 14\\.33\\.38/);')
extra = """
// 14.33.38 — múltiplas paradas: entrega vence empate curto; diferença grande usa menor rota.
assert.match(navigation,/DELIVERY_TIE_METERS=300/);
assert.match(navigation,/delivery_priority_tie/);
assert.match(navigation,/pickup_in_progress/);
assert.match(navigation,/picked_up_at/);
assert.match(driver,/activeItems:\[\]/);
assert.match(driver,/function basicFromLive\(live\)/);
assert.match(driver,/function syncDetailToNavigation\(next\)/);
assert.match(driver,/ENTREGA':'COLETA'/);
"""
if 'múltiplas paradas: entrega vence empate curto' not in s:
    s += extra
p.write_text(s)

print('14.33.38 aplicada: prioridade de entrega/coleta por rota e card explícito.')
