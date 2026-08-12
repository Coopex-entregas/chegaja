from pathlib import Path

# 14.33.32 consolidada: publicação direta para carregar a correção de rota em produção.
ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def replace_between(text,start,end,new,label):
    a=text.find(start)
    if a<0: raise RuntimeError(f'Início não encontrado: {label}')
    b=text.find(end,a)
    if b<0: raise RuntimeError(f'Fim não encontrado: {label}')
    return text[:a]+new+'\n'+text[b:]

# Painel do cooperado: nunca desenhar linha reta como rota provisória/fallback.
driver_path='public/chegaja-v217-driver-navigation.js'
driver=read(driver_path)
driver=driver.replace('/* ChegaJá 14.33.31 — chegada/coleta transacional e sem coleta automática */','/* ChegaJá 14.33.32 — rota azul somente por ruas; sem linha reta de fallback */',1)
driver=driver.replace('__CJ_DRIVER_LEAFLET_143331__','__CJ_DRIVER_LEAFLET_143332__')
if 'routeRetryTimer:null' not in driver:
    driver=driver.replace('nextInstruction:null};','nextInstruction:null,routeRetryTimer:null};',1)

new_update="""async function updateRoute(force=false){if(!A.detail||!['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(String(A.detail.status))||A.routeBusy||document.hidden)return;const origin=A.gps;if(!valid(origin))return;let target=targetPoint();if(valid(target)&&!routeDue(force)){if(navigationActive())frameNavigation(false);return}if(!force&&!valid(target)&&Date.now()-A.lastRouteAt<5000)return;A.routeBusy=true;A.lastRouteAt=Date.now();try{let pts=[],nav=null;try{nav=await api(`/api/app/v32/driver/navigation?lat=${encodeURIComponent(origin.lat)}&lng=${encodeURIComponent(origin.lng)}`,{timeout:11000});const serverTarget=point(nav.next?.lat,nav.next?.lng);if(valid(serverTarget)){A.navTarget={...serverTarget};target=serverTarget;updateStops()}pts=normalizeGeometry(nav.route?.geometry);maybeSpeakNavigation(nav)}catch{}if(!valid(target)&&valid(A.navTarget))target=A.navTarget;if(!valid(target)){notice('Não consegui localizar o endereço da coleta/entrega no mapa.',true);return}if(pts.length>=2){let nearest=Infinity;for(const p of pts)nearest=Math.min(nearest,distance(origin,p));const endpoint=Math.min(distance(target,pts[0]),distance(target,pts.at(-1)));if(nearest>260||endpoint>320)pts=[]}if(pts.length<2)pts=await osrm(origin,target);if(pts.length<2){ensureSelf();updateStops();if(navigationActive()&&A.routePoints.length>=2&&!A.manualView&&A.following)frameNavigation(false);clearTimeout(A.routeRetryTimer);A.routeRetryTimer=setTimeout(()=>{A.routeRetryTimer=null;updateRoute(true)},2500);return}clearTimeout(A.routeRetryTimer);A.routeRetryTimer=null;A.lastRouteOrigin={...origin};A.lastRouteTarget={...target};drawRoute(pts);trimRouteToGps();ensureSelf();updateStops();if(navigationActive()&&!A.manualView&&A.following)frameNavigation(true);else fitRouteOnce()}finally{A.routeBusy=false}}"""
driver=replace_between(driver,'async function updateRoute(force=false){','function followGps(){',new_update,'updateRoute')
write(driver_path,driver)

# Versão/cache do JS do cooperado.
index_path='public/index.html'
index=read(index_path)
index=index.replace('app-version" content="14.33.31"','app-version" content="14.33.32"',1)
index=index.replace('/chegaja-v217-driver-navigation.js?v=14.33.31&recovery=143331','/chegaja-v217-driver-navigation.js?v=14.33.32&recovery=143332',1)
write(index_path,index)

# Regressão: proibir linha reta como navegação.
test_path='scripts/test-v14153-logo-google-maps.mjs'
test=read(test_path)
test=test.replace('assert.match(index,/app-version" content="14\\.33\\.31"/);','assert.match(index,/app-version" content="14\\.33\\.32"/);',1)
test=test.replace('assert.match(index,/chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.31&recovery=143331/);','assert.match(index,/chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.32&recovery=143332/);',1)
test=test.replace('assert.match(driver,/ChegaJá 14\\.33\\.31/);','assert.match(driver,/ChegaJá 14\\.33\\.32/);',1)
test=test.replace("assert.match(driver,/pts=\\[\\{\\.\\.\\.origin\\},\\{\\.\\.\\.target\\}\\]/);","assert.doesNotMatch(driver,/pts=\\[\\{\\.\\.\\.origin\\},\\{\\.\\.\\.target\\}\\]/);",1)
extra="""
assert.doesNotMatch(driver,/drawRoute\\(\\[\\{\\.\\.\\.origin\\},\\{\\.\\.\\.target\\}\\]\\)/);
assert.match(driver,/routeRetryTimer/);
assert.match(driver,/setTimeout\\(\\(\\)=>\\{A\\.routeRetryTimer=null;updateRoute\\(true\\)\\},2500\\)/);
"""
if 'routeRetryTimer=null;updateRoute' not in test:
    test += extra
write(test_path,test)

print('ChegaJá 14.33.32: rota azul preserva a última geometria válida e nunca vira linha reta; falha de rota agenda novo cálculo em 2,5 s.')
