from pathlib import Path

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f'Bloco não encontrado: {label}')
    return text.replace(old, new, 1)

# 14.33.20: um único fluxo de oferta no v217, assigned sempre exige decisão,
# nenhum banner legado e navegação usa também o alvo retornado pelo backend.

js_path = 'public/chegaja-v217-driver-navigation.js'
js = read(js_path)
if 'ChegaJá 14.33.20' not in js:
    js = replace_once(js,
        '/* ChegaJá 14.33.19 — aceite volta ao mapa, seta visível e rota garantida */',
        '/* ChegaJá 14.33.20 — oferta única full-screen e rota resiliente coleta/entrega */',
        'versão do painel')
    js = js.replace('__CJ_DRIVER_LEAFLET_143319__', '__CJ_DRIVER_LEAFLET_143320__')
    js = replace_once(js,
        "sheetKey:'',touchY:null,audio:null};",
        "sheetKey:'',touchY:null,audio:null,navTarget:null};",
        'estado de alvo da navegação')
    js = replace_once(js,
        "function clearRoute(){A.casing?.remove();A.line?.remove();A.casing=A.line=null;A.routePoints=[];A.lastRouteOrigin=A.lastRouteTarget=null;A.routeFitKey=''}",
        "function clearRoute(){A.casing?.remove();A.line?.remove();A.casing=A.line=null;A.routePoints=[];A.lastRouteOrigin=A.lastRouteTarget=null;A.routeFitKey='';A.navTarget=null}",
        'limpeza da rota')
    js = replace_once(js,
        "function targetPoint(){const x=A.detail;if(!x)return null;const delivery=targetKind()==='delivery',p=point(delivery?x.delivery_lat:x.pickup_lat,delivery?x.delivery_lng:x.pickup_lng);return valid(p)?p:null}",
        "function targetPoint(){const x=A.detail;if(!x)return null;const delivery=targetKind()==='delivery',p=point(delivery?x.delivery_lat:x.pickup_lat,delivery?x.delivery_lng:x.pickup_lng);return valid(p)?p:(valid(A.navTarget)?A.navTarget:null)}",
        'fallback do alvo')
    js = replace_once(js,
        "const p=point(x.pickup_lat,x.pickup_lng),d=point(x.delivery_lat,x.delivery_lng);",
        "const rawP=point(x.pickup_lat,x.pickup_lng),rawD=point(x.delivery_lat,x.delivery_lng),p=valid(rawP)?rawP:(targetKind()==='pickup'&&valid(A.navTarget)?A.navTarget:rawP),d=valid(rawD)?rawD:(targetKind()==='delivery'&&valid(A.navTarget)?A.navTarget:rawD);",
        'marcadores com alvo da navegação')
    js = replace_once(js,
        "function offerRequired(x){return Boolean(x)&&(['offered','assigned'].includes(String(x.status))||Boolean(x.requires_acceptance))&&!x.accepted_at}",
        "function offerRequired(x){if(!x)return false;const status=String(x.status||'');if(status==='offered'||status==='assigned')return true;return Boolean(x.requires_acceptance)&&!x.accepted_at}",
        'assigned sempre pendente')
    js = replace_once(js,
        "if(!offer){host.hidden=true;host.innerHTML='';return}const routeMeters=",
        "if(!offer){host.hidden=true;host.innerHTML='';return}document.body.classList.add('cj217-pending-offer');$('#toast-container')?.replaceChildren();$('#chegaja-ringing')?.remove();const routeMeters=",
        'oferta elimina avisos antigos')

    old_route = "async function updateRoute(force=false){if(!A.detail||!['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(String(A.detail.status))||A.routeBusy||document.hidden||!routeDue(force))return;const origin=A.gps,target=targetPoint();if(!valid(origin)||!valid(target))return;A.routeBusy=true;A.lastRouteAt=Date.now();try{let pts=[];try{const d=await api('/api/app/v32/driver/navigation',{timeout:8000});pts=normalizeGeometry(d.route?.geometry)}catch{}if(pts.length>=2){let nearest=Infinity;for(const p of pts)nearest=Math.min(nearest,distance(origin,p));const endpoint=Math.min(distance(target,pts[0]),distance(target,pts.at(-1)));if(nearest>130||endpoint>180)pts=[]}if(pts.length<2)pts=await osrm(origin,target);if(pts.length<2)pts=[{...origin},{...target}];if(pts.length>=2){A.lastRouteOrigin={...origin};A.lastRouteTarget={...target};drawRoute(pts);trimRouteToGps();ensureSelf();if(navigationActive()&&!A.manualView&&A.following)followGps();else fitRouteOnce()}}finally{A.routeBusy=false}}"
    new_route = "async function updateRoute(force=false){if(!A.detail||!['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(String(A.detail.status))||A.routeBusy||document.hidden)return;const origin=A.gps;if(!valid(origin))return;let target=targetPoint();if(valid(target)&&!routeDue(force))return;if(!force&&!valid(target)&&Date.now()-A.lastRouteAt<5000)return;A.routeBusy=true;A.lastRouteAt=Date.now();try{let pts=[];try{const nav=await api('/api/app/v32/driver/navigation',{timeout:8000}),serverTarget=point(nav.next?.lat,nav.next?.lng);if(valid(serverTarget)){A.navTarget={...serverTarget};if(!valid(target))target=serverTarget;updateStops()}pts=normalizeGeometry(nav.route?.geometry)}catch{}if(!valid(target)&&valid(A.navTarget))target=A.navTarget;if(!valid(target))return;if(pts.length>=2){let nearest=Infinity;for(const p of pts)nearest=Math.min(nearest,distance(origin,p));const endpoint=Math.min(distance(target,pts[0]),distance(target,pts.at(-1)));if(nearest>130||endpoint>180)pts=[]}if(pts.length<2)pts=await osrm(origin,target);if(pts.length<2)pts=[{...origin},{...target}];A.lastRouteOrigin={...origin};A.lastRouteTarget={...target};drawRoute(pts);trimRouteToGps();ensureSelf();updateStops();if(navigationActive()&&!A.manualView&&A.following)followGps();else fitRouteOnce()}finally{A.routeBusy=false}}"
    js = replace_once(js, old_route, new_route, 'rota resiliente')

    old_accept = "const d=await acceptCall(x,loc||{});stopOfferAlert();A.detail={...x,status:String(d.status||'accepted'),accepted_at:new Date().toISOString(),requires_acceptance:false,updated_at:new Date().toISOString()};"
    new_accept = "const d=await acceptCall(x,loc||{});stopOfferAlert();const rawAcceptedStatus=String(d.status||d.delivery?.status||''),acceptedStatus=['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(rawAcceptedStatus)?rawAcceptedStatus:'accepted';A.detail={...x,status:acceptedStatus,accepted_at:new Date().toISOString(),requires_acceptance:false,updated_at:new Date().toISOString()};"
    js = replace_once(js, old_accept, new_accept, 'normalização do aceite')
    write(js_path, js)

# Remove o segundo fluxo antigo de chamada/balloon do arquivo global.
final_path = 'public/chegaja-final.js'
final = read(final_path)
final = replace_once(final,
    "function ringBanner(){let el=$id('chegaja-ringing');if(!el){el=document.createElement('div');el.id='chegaja-ringing';el.className='chegaja-ringing';el.textContent='☎ Nova entrega — toque em Aceitar';document.body.append(el)}return el}",
    "function ringBanner(){return null}",
    'banner legado')
old_start = """function startRing(deliveryId){
    if(state?.user?.role!=='driver')return;
    if(CJ.ringDeliveryId===deliveryId&&CJ.ringTimer)return;
    stopRing();CJ.ringDeliveryId=deliveryId||'assigned';ringBanner();oldPhoneBurst();CJ.ringTimer=setInterval(oldPhoneBurst,2400);
  }"""
new_start = """function startRing(deliveryId){
    stopRing();
    return;
  }"""
final = replace_once(final, old_start, new_start, 'som legado')
final = replace_once(final,
    "if(state.user.role==='driver'&&item.event_type==='delivery_assigned')startRing(item.delivery_id);",
    "if(state.user.role==='driver'&&item.event_type==='delivery_assigned'){stopRing();continue;}",
    'notificação legada do cooperado')
write(final_path, final)

# Backend: status assigned é sempre uma oferta ainda não decidida, mesmo se um dado
# legado tiver preenchido accepted_at incorretamente.
v28_path = 'src/routes/platform-v28.ts'
v28 = read(v28_path)
v28 = replace_once(v28,
    """function needsAcceptance(item:Row,driverId:string){
  if(item.status==='offered'&&!item.assigned_driver_id)return true;
  return item.assigned_driver_id===driverId&&!item.accepted_at&&['assigned','accepted','to_pickup','at_pickup'].includes(String(item.status));
}""",
    """function needsAcceptance(item:Row,driverId:string){
  if(item.status==='offered'&&!item.assigned_driver_id)return true;
  if(item.status==='assigned'&&item.assigned_driver_id===driverId)return true;
  return item.assigned_driver_id===driverId&&!item.accepted_at&&['accepted','to_pickup','at_pickup'].includes(String(item.status));
}""",
    'regra backend assigned')
v28 = replace_once(v28,
    "WHERE id=? AND cooperative_id=? AND accepted_at IS NULL AND ((status='offered' AND assigned_driver_id IS NULL) OR (assigned_driver_id=? AND status IN ('assigned','accepted','to_pickup','at_pickup')))`)",
    "WHERE id=? AND cooperative_id=? AND ((status='offered' AND assigned_driver_id IS NULL AND accepted_at IS NULL) OR (status='assigned' AND assigned_driver_id=?) OR (assigned_driver_id=? AND accepted_at IS NULL AND status IN ('accepted','to_pickup','at_pickup')))`)",
    'where do aceite')
v28 = replace_once(v28,
    ".bind(auth.driverId,nextStatus,item.id,auth.cooperativeId,auth.driverId).run();",
    ".bind(auth.driverId,nextStatus,item.id,auth.cooperativeId,auth.driverId,auth.driverId).run();",
    'bind do aceite')
write(v28_path, v28)

# CSS: durante oferta não existe qualquer balão/toast concorrente.
css_path = 'public/chegaja-v217-driver-navigation.css'
css = read(css_path)
css = css.replace('/* ChegaJá 14.33.19 — ÚNICA folha do painel do cooperado. */','/* ChegaJá 14.33.20 — ÚNICA folha do painel do cooperado. */',1)
if '14.33.20 — sem balão legado' not in css:
    css += """

/* ChegaJá 14.33.20 — sem balão legado; oferta é somente full-screen */
body.cj199-driver #chegaja-ringing{display:none!important;visibility:hidden!important;pointer-events:none!important}
body.cj217-pending-offer #toast-container,body.cj217-pending-offer .toast-container,body.cj217-pending-offer .toast,body.cj217-pending-offer #chegaja-ringing{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}
body.cj217-pending-offer #cj217-offer-screen{display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important}
"""
write(css_path, css)

# Cache da página: inclusive chegaja-final.js, porque o fluxo legado foi removido dele.
index_path = 'public/index.html'
index = read(index_path)
index = index.replace('app-version" content="14.33.19"','app-version" content="14.33.20"')
index = index.replace('chegaja-v217-driver-navigation.css?v=14.33.19&recovery=143319','chegaja-v217-driver-navigation.css?v=14.33.20&recovery=143320')
index = index.replace('chegaja-v217-driver-navigation.js?v=14.33.19&recovery=143319','chegaja-v217-driver-navigation.js?v=14.33.20&recovery=143320')
index = index.replace('chegaja-final.js?v=14.15.9&recovery=143314','chegaja-final.js?v=14.33.20&recovery=143320')
write(index_path, index)

# Regressão específica desta correção.
test_path = 'scripts/test-v14153-logo-google-maps.mjs'
test = read(test_path)
test = test.replace("const navigation=read('src/routes/platform-v32.ts');", "const navigation=read('src/routes/platform-v32.ts');\nconst v28=read('src/routes/platform-v28.ts');\nconst finalJs=read('public/chegaja-final.js');")
test = test.replace('14\\.33\\.19','14\\.33\\.20').replace('143319','143320')
test = test.replace("assert.match(driver,/ChegaJá 14\\.33\\.19/);", "assert.match(driver,/ChegaJá 14\\.33\\.20/);")
test = test.replace("assert.match(driver,/const NAV_ZOOM=18\\.5/);", "assert.match(driver,/const NAV_ZOOM=18\\.5/);\nassert.match(driver,/status==='offered'\\|\\|status==='assigned'/);\nassert.match(driver,/nav\\.next\\?\\.lat/);\nassert.match(driver,/acceptedStatus=\\['accepted','to_pickup'/);\nassert.doesNotMatch(finalJs,/Nova entrega — toque em Aceitar/);\nassert.match(finalJs,/delivery_assigned'\\)\\{stopRing\\(\\);continue;/);\nassert.match(v28,/item\\.status==='assigned'.*return true/);\nassert.match(index,/chegaja-final\\.js\\?v=14\\.33\\.20&recovery=143320/);")
test = test.replace("console.log('ChegaJá 14.33.19: aceite retorna ao mapa, seta e rota validados.');", "console.log('ChegaJá 14.33.20: oferta full-screen única, aceite e rota coleta/entrega validados.');")
write(test_path, test)

print('ChegaJá 14.33.20 aplicado.')
