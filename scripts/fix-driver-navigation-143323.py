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

def replace_line(text, prefix, new_line, label):
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith(prefix):
            lines[i] = new_line
            return '\n'.join(lines) + ('\n' if text.endswith('\n') else '')
    raise RuntimeError(f'Linha não encontrada: {label}')

# ChegaJá 14.33.23
# Navegação do cooperado passa a enquadrar posição atual + rota + destino,
# em vez de centralizar apenas no GPS com zoom fechado.

js_path = 'public/chegaja-v217-driver-navigation.js'
js = read(js_path)
if 'ChegaJá 14.33.23' not in js:
    js = replace_once(
        js,
        '/* ChegaJá 14.33.22 — áudio persistente desbloqueado pelo toque em INICIAR */',
        '/* ChegaJá 14.33.23 — navegação visual enquadra cooperado, trajeto e destino */',
        'versão do painel'
    )
    js = js.replace('__CJ_DRIVER_LEAFLET_143322__', '__CJ_DRIVER_LEAFLET_143323__')
    js = replace_once(
        js,
        'lastArmTestAt:0};',
        'lastArmTestAt:0,navFrameAt:0,navFrameOrigin:null,navFrameTarget:null};',
        'estado do enquadramento de navegação'
    )

    clear_route = "function clearRoute(){A.casing?.remove();A.line?.remove();A.casing=A.line=null;A.routePoints=[];A.lastRouteOrigin=A.lastRouteTarget=null;A.routeFitKey='';A.navTarget=null;A.navFrameAt=0;A.navFrameOrigin=A.navFrameTarget=null}"
    js = replace_line(js, 'function clearRoute()', clear_route, 'limpeza da rota')

    frame = "function frameNavigation(force=false){if(!A.map||!valid(A.gps)||!navigationActive()||A.manualView||!A.following)return false;const target=targetPoint();if(!valid(target))return false;const moved=!valid(A.navFrameOrigin)||distance(A.gps,A.navFrameOrigin)>55,targetChanged=!valid(A.navFrameTarget)||distance(target,A.navFrameTarget)>15;if(!force&&!moved&&!targetChanged&&Date.now()-A.navFrameAt<9000)return false;const base=Array.isArray(A.routePoints)&&A.routePoints.length>=2?A.routePoints:[A.gps,target],points=[...base,{...A.gps},{...target}].filter(valid);if(points.length<2)return false;const bounds=L.latLngBounds(points.map(p=>[p.lat,p.lng]));A.programmatic=true;try{A.map.fitBounds(bounds,{paddingTopLeft:[24,132],paddingBottomRight:[24,148],maxZoom:17,animate:false});A.navFrameAt=Date.now();A.navFrameOrigin={...A.gps};A.navFrameTarget={...target};ensureSelf();updateStops()}finally{setTimeout(()=>A.programmatic=false,120)}return true}"
    fit = "function fitRouteOnce(){if(!A.map||A.manualView||A.routePoints.length<2||!A.detail)return;const key=`${A.detail.id}:${targetKind()}`;if(A.routeFitKey===key)return;A.routeFitKey=key;frameNavigation(true)}"
    js = replace_line(js, 'function fitRouteOnce()', frame + '\n' + fit, 'enquadramento inicial da rota')

    update_route = "async function updateRoute(force=false){if(!A.detail||!['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(String(A.detail.status))||A.routeBusy||document.hidden)return;const origin=A.gps;if(!valid(origin))return;let target=targetPoint();if(valid(target)&&!routeDue(force)){if(navigationActive())frameNavigation(false);return}if(!force&&!valid(target)&&Date.now()-A.lastRouteAt<5000)return;A.routeBusy=true;A.lastRouteAt=Date.now();try{let pts=[];if(valid(target)){drawRoute([{...origin},{...target}]);ensureSelf();updateStops();if(navigationActive())frameNavigation(true)}try{const nav=await api(`/api/app/v32/driver/navigation?lat=${encodeURIComponent(origin.lat)}&lng=${encodeURIComponent(origin.lng)}`,{timeout:9000}),serverTarget=point(nav.next?.lat,nav.next?.lng);if(valid(serverTarget)){A.navTarget={...serverTarget};target=serverTarget;updateStops();if(A.routePoints.length<2)drawRoute([{...origin},{...target}])}pts=normalizeGeometry(nav.route?.geometry)}catch{}if(!valid(target)&&valid(A.navTarget))target=A.navTarget;if(!valid(target))return;if(pts.length>=2){let nearest=Infinity;for(const p of pts)nearest=Math.min(nearest,distance(origin,p));const endpoint=Math.min(distance(target,pts[0]),distance(target,pts.at(-1)));if(nearest>220||endpoint>260)pts=[]}if(pts.length<2)pts=await osrm(origin,target);if(pts.length<2)pts=[{...origin},{...target}];A.lastRouteOrigin={...origin};A.lastRouteTarget={...target};drawRoute(pts);trimRouteToGps();ensureSelf();updateStops();if(navigationActive()&&!A.manualView&&A.following)frameNavigation(true);else fitRouteOnce()}finally{A.routeBusy=false}}"
    js = replace_line(js, 'async function updateRoute()', update_route, 'atualização da rota')

    follow = "function followGps(){if(!A.map||!valid(A.gps)||A.manualView||!A.following)return;if(navigationActive()){frameNavigation(false);return}A.programmatic=true;A.map.panTo([A.gps.lat,A.gps.lng],{animate:false});setTimeout(()=>A.programmatic=false,80)}"
    js = replace_line(js, 'function followGps()', follow, 'acompanhamento do GPS')

    central = "function centralize(){if(!A.map||!valid(A.gps))return notice('Localização ainda não recebida. Toque em INICIAR para ativar o GPS.',true);A.manualView=false;A.following=true;$('#cj199-center')?.classList.remove('manual');if(navigationActive()){frameNavigation(true);return}A.programmatic=true;A.map.setView([A.gps.lat,A.gps.lng],18,{animate:false});setTimeout(()=>A.programmatic=false,90)}"
    js = replace_line(js, 'function centralize()', central, 'botão centralizar')
    write(js_path, js)

css_path = 'public/chegaja-v217-driver-navigation.css'
css = read(css_path)
css = css.replace('/* ChegaJá 14.33.22 — ÚNICA folha do painel do cooperado. */','/* ChegaJá 14.33.23 — ÚNICA folha do painel do cooperado. */',1)
marker = '/* ChegaJá 14.33.20 — sem balão legado; oferta é somente full-screen */'
nav_css = '''/* ChegaJá 14.33.23 — localização e destino destacados na navegação */
body.cj199-driver #cj199-map .cj217-self-icon:before{content:'';position:absolute;left:50%;top:50%;width:58px;height:58px;transform:translate(-50%,-50%);border-radius:50%;background:rgba(20,89,255,.16);border:2px solid rgba(20,89,255,.38);box-shadow:0 0 0 8px rgba(20,89,255,.08);pointer-events:none}
body.cj199-driver #cj199-map .cj217-self-marker{width:42px!important;height:48px!important;filter:drop-shadow(0 6px 8px rgba(7,24,58,.72))!important}
body.cj199-driver #cj199-map .cj217-stop-icon{overflow:visible!important}
body.cj199-driver #cj199-map .cj217-stop-icon span{width:42px!important;height:42px!important;font-size:14px!important;box-shadow:0 6px 18px rgba(7,24,58,.42)!important}
body.cj199-driver #cj199-map .cj217-stop-icon:after{position:absolute;left:50%;top:46px;transform:translateX(-50%);padding:5px 8px;border-radius:999px;background:#fff;color:#0b2f9b;box-shadow:0 4px 12px rgba(7,24,58,.25);font:900 9px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;white-space:nowrap;pointer-events:none}
body.cj199-driver #cj199-map .cj217-stop-icon.pickup:after{content:'COLETA'}
body.cj199-driver #cj199-map .cj217-stop-icon.delivery:after{content:'ENTREGA';color:#b63b00}
body.cj217-active-delivery #cj199-map .leaflet-control-zoom{margin-top:178px!important}
'''
if 'ChegaJá 14.33.23 — localização e destino destacados' not in css:
    if marker in css:
        css = css.replace(marker, nav_css + '\n' + marker, 1)
    else:
        css += '\n' + nav_css
write(css_path, css)

index_path = 'public/index.html'
index = read(index_path)
index = index.replace('app-version" content="14.33.22"','app-version" content="14.33.23"')
index = index.replace('chegaja-v217-driver-navigation.js?v=14.33.22&recovery=143322','chegaja-v217-driver-navigation.js?v=14.33.23&recovery=143323')
index = index.replace('chegaja-v217-driver-navigation.css?v=14.33.22&recovery=143322','chegaja-v217-driver-navigation.css?v=14.33.23&recovery=143323')
write(index_path, index)

test_path = 'scripts/test-v14153-logo-google-maps.mjs'
test = read(test_path)
test = test.replace('14\\.33\\.22','14\\.33\\.23').replace('143322','143323').replace('ChegaJá 14.33.22:','ChegaJá 14.33.23:')
anchor = "assert.match(driver,/navigation\\?lat=/);"
extra = """assert.match(driver,/function frameNavigation\\(force=false\\)/);
assert.match(driver,/fitBounds\\(bounds/);
assert.match(driver,/paddingTopLeft:\\[24,132\\]/);
assert.match(driver,/paddingBottomRight:\\[24,148\\]/);
assert.match(driver,/maxZoom:17/);
assert.match(driver,/navFrameOrigin/);
assert.match(driverCss,/cj217-self-icon:before/);
assert.match(driverCss,/content:'COLETA'/);
assert.match(driverCss,/content:'ENTREGA'/);"""
if 'function frameNavigation' not in test:
    test = replace_once(test, anchor, anchor + '\n' + extra, 'testes da navegação visual')
write(test_path, test)

print('ChegaJá 14.33.23 aplicado: mapa enquadra cooperado, trajeto e destino.')
