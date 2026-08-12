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


# ChegaJá 14.33.21
# 1) A rota é pedida ao backend com a posição GPS atual do aparelho.
# 2) A linha azul usa um pane/renderer SVG dedicado acima dos tiles do mapa.
# 3) Enquanto a rota viária é calculada, uma linha imediata já fica visível.
# 4) O alerta de nova entrega usa pulsos quadrados/serrilhados mais perceptíveis,
#    sempre limitado pelo volume físico/configuração do próprio aparelho.

js_path = 'public/chegaja-v217-driver-navigation.js'
js = read(js_path)
if 'ChegaJá 14.33.21' not in js:
    js = replace_once(
        js,
        '/* ChegaJá 14.33.20 — oferta única full-screen e rota resiliente coleta/entrega */',
        '/* ChegaJá 14.33.21 — rota azul dedicada e alerta reforçado de nova entrega */',
        'versão do painel',
    )
    js = js.replace('__CJ_DRIVER_LEAFLET_143320__', '__CJ_DRIVER_LEAFLET_143321__', 1)
    js = replace_once(
        js,
        "audio:null,navTarget:null};",
        "audio:null,navTarget:null,routeRenderer:null};",
        'renderer dedicado da rota',
    )

    ensure_prefix = 'async function ensureMap()'
    lines = js.splitlines()
    found = False
    for i, line in enumerate(lines):
        if line.startswith(ensure_prefix):
            found = True
            line = line.replace(
                'A.map=A.self=A.pickup=A.delivery=A.casing=A.line=null}',
                'A.map=A.self=A.pickup=A.delivery=A.casing=A.line=null;A.routeRenderer=null}',
                1,
            )
            marker = ";A.tile=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'"
            if marker not in line:
                raise RuntimeError('Bloco não encontrado: criação dos tiles do mapa')
            pane_setup = ";const routePane=A.map.getPane('cj217-route-pane')||A.map.createPane('cj217-route-pane');routePane.style.zIndex='625';routePane.style.pointerEvents='none';A.routeRenderer=typeof L.svg==='function'?L.svg({pane:'cj217-route-pane',padding:.5}):null"
            line = line.replace(marker, pane_setup + marker, 1)
            lines[i] = line
            break
    if not found:
        raise RuntimeError('Linha não encontrada: ensureMap')
    js = '\n'.join(lines) + ('\n' if js.endswith('\n') else '')

    draw_route = "function drawRoute(points){if(!A.map||!Array.isArray(points)||points.length<2)return;const path=points.map(p=>point(p.lat,p.lng)).filter(valid);if(path.length<2)return;A.routePoints=path;const pane=A.map.getPane('cj217-route-pane')||A.map.createPane('cj217-route-pane');pane.style.zIndex='625';pane.style.pointerEvents='none';if(!A.routeRenderer&&typeof L.svg==='function')A.routeRenderer=L.svg({pane:'cj217-route-pane',padding:.5});const ll=path.map(p=>[p.lat,p.lng]),renderer=A.routeRenderer||undefined;if(!A.casing)A.casing=L.polyline(ll,{pane:'cj217-route-pane',renderer,color:'#fff',weight:16,opacity:1,lineCap:'round',lineJoin:'round',interactive:false}).addTo(A.map);else A.casing.setLatLngs(ll);if(!A.line)A.line=L.polyline(ll,{pane:'cj217-route-pane',renderer,color:'#075dff',weight:10,opacity:1,lineCap:'round',lineJoin:'round',interactive:false}).addTo(A.map);else A.line.setLatLngs(ll);A.casing.bringToFront?.();A.line.bringToFront?.();A.self?.bringToFront?.()}"
    js = replace_line(js, 'function drawRoute(points)', draw_route, 'desenho da rota')

    update_route = "async function updateRoute(force=false){if(!A.detail||!['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(String(A.detail.status))||A.routeBusy||document.hidden)return;const origin=A.gps;if(!valid(origin))return;let target=targetPoint();if(valid(target)&&!routeDue(force))return;if(!force&&!valid(target)&&Date.now()-A.lastRouteAt<5000)return;A.routeBusy=true;A.lastRouteAt=Date.now();try{let pts=[];if(valid(target)){drawRoute([{...origin},{...target}]);ensureSelf()}try{const nav=await api(`/api/app/v32/driver/navigation?lat=${encodeURIComponent(origin.lat)}&lng=${encodeURIComponent(origin.lng)}`,{timeout:9000}),serverTarget=point(nav.next?.lat,nav.next?.lng);if(valid(serverTarget)){A.navTarget={...serverTarget};target=serverTarget;updateStops();if(A.routePoints.length<2)drawRoute([{...origin},{...target}])}pts=normalizeGeometry(nav.route?.geometry)}catch{}if(!valid(target)&&valid(A.navTarget))target=A.navTarget;if(!valid(target))return;if(pts.length>=2){let nearest=Infinity;for(const p of pts)nearest=Math.min(nearest,distance(origin,p));const endpoint=Math.min(distance(target,pts[0]),distance(target,pts.at(-1)));if(nearest>220||endpoint>260)pts=[]}if(pts.length<2)pts=await osrm(origin,target);if(pts.length<2)pts=[{...origin},{...target}];A.lastRouteOrigin={...origin};A.lastRouteTarget={...target};drawRoute(pts);trimRouteToGps();ensureSelf();updateStops();if(navigationActive()&&!A.manualView&&A.following)followGps();else fitRouteOnce()}finally{A.routeBusy=false}}"
    js = replace_line(js, 'async function updateRoute(force=false)', update_route, 'atualização da rota')

    phone_tone = "function phoneTone(c,at=0,duration=1.15){try{const start=c.currentTime+at,master=c.createGain(),compressor=c.createDynamicsCompressor();compressor.threshold.setValueAtTime(-12,start);compressor.knee.setValueAtTime(8,start);compressor.ratio.setValueAtTime(10,start);compressor.attack.setValueAtTime(.003,start);compressor.release.setValueAtTime(.12,start);master.gain.setValueAtTime(.0001,start);master.gain.exponentialRampToValueAtTime(.78,start+.012);master.gain.setValueAtTime(.78,start+duration-.04);master.gain.exponentialRampToValueAtTime(.0001,start+duration);master.connect(compressor);compressor.connect(c.destination);const tones=[{freq:820,type:'square',gain:.29},{freq:1180,type:'sawtooth',gain:.23},{freq:1560,type:'square',gain:.18}];for(let pulse=0;pulse<6;pulse++){const ps=start+pulse*.18,pe=Math.min(start+duration,ps+.13);for(const tone of tones){const o=c.createOscillator(),g=c.createGain();o.type=tone.type;o.frequency.setValueAtTime(tone.freq+(pulse%2?170:-60),ps);o.frequency.linearRampToValueAtTime(tone.freq+(pulse%2?-90:220),pe);g.gain.setValueAtTime(.0001,ps);g.gain.exponentialRampToValueAtTime(tone.gain,ps+.008);g.gain.setValueAtTime(tone.gain,Math.max(ps+.009,pe-.025));g.gain.exponentialRampToValueAtTime(.0001,pe);o.connect(g);g.connect(master);o.start(ps);o.stop(pe+.025)}}}catch{}}"
    js = replace_line(js, 'function phoneTone(c,at=0,duration=', phone_tone, 'toque reforçado')

    ring_line = "async function ring(){navigator.vibrate?.([650,70,650,70,650,180]);const c=unlockAudio();if(!c)return;try{if(c.state!=='running')await c.resume()}catch{}if(c.state!=='running')return;phoneTone(c,0,1.15);phoneTone(c,1.28,1.15)}"
    js = replace_line(js, 'async function ring()', ring_line, 'padrão do alerta')
    js = js.replace('setInterval(fire,3000)', 'setInterval(fire,2700)')
    write(js_path, js)

# Backend: usa a coordenada atual enviada apenas para calcular a navegação.
nav_path = 'src/routes/platform-v32.ts'
nav = read(nav_path)
if "c.req.query('lat')" not in nav:
    nav = replace_once(
        nav,
        " const lat=Number(driver?.current_lat),lng=Number(driver?.current_lng);\n if(!valid(lat,lng))return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:[],next:null,route:null,arrived:false,arrival_radius_meters:ARRIVAL_RADIUS_METERS});",
        " const requestedLat=Number(c.req.query('lat')),requestedLng=Number(c.req.query('lng')),storedLat=Number(driver?.current_lat),storedLng=Number(driver?.current_lng);\n const useRequested=valid(requestedLat,requestedLng),lat=useRequested?requestedLat:storedLat,lng=useRequested?requestedLng:storedLng;\n if(!valid(lat,lng))return c.json({ok:true,online:Boolean(Number(driver?.online||0)),items:[],next:null,route:null,arrived:false,arrival_radius_meters:ARRIVAL_RADIUS_METERS});",
        'GPS atual na rota backend',
    )
nav = nav.replace("'User-Agent':'ChegaJa/14.33.5'", "'User-Agent':'ChegaJa/14.33.21'")
write(nav_path, nav)

# Bump de cache para impedir que o iPhone continue usando o JS anterior.
index_path = 'public/index.html'
index = read(index_path)
index = index.replace('app-version" content="14.33.20"', 'app-version" content="14.33.21"')
index = index.replace('chegaja-v217-driver-navigation.css?v=14.33.20&recovery=143320', 'chegaja-v217-driver-navigation.css?v=14.33.21&recovery=143321')
index = index.replace('chegaja-v217-driver-navigation.js?v=14.33.20&recovery=143320', 'chegaja-v217-driver-navigation.js?v=14.33.21&recovery=143321')
index = index.replace('chegaja-final.js?v=14.33.20&recovery=143320', 'chegaja-final.js?v=14.33.21&recovery=143321')
write(index_path, index)

css_path = 'public/chegaja-v217-driver-navigation.css'
css = read(css_path).replace('/* ChegaJá 14.33.20 — ÚNICA folha do painel do cooperado. */', '/* ChegaJá 14.33.21 — ÚNICA folha do painel do cooperado. */', 1)
write(css_path, css)

# Atualiza a regressão existente e adiciona verificações específicas.
test_path = 'scripts/test-v14153-logo-google-maps.mjs'
test = read(test_path)
test = test.replace('14\\.33\\.20', '14\\.33\\.21').replace('143320', '143321')
test = test.replace('14.33.20', '14.33.21')
test = test.replace('setInterval\\(fire,3000\\)', 'setInterval\\(fire,2700\\)')
marker = "assert.match(driver,/const NAV_ZOOM=18\\.5/);"
extra = """assert.match(driver,/createPane\\('cj217-route-pane'\\)/);
assert.match(driver,/L\\.svg\\(\\{pane:'cj217-route-pane'/);
assert.match(driver,/navigation\\?lat=/);
assert.match(driver,/type:'square'/);
assert.match(driver,/type:'sawtooth'/);
assert.match(driver,/setInterval\\(fire,2700\\)/);
assert.match(navigation,/c\\.req\\.query\\('lat'\\)/);
assert.match(navigation,/c\\.req\\.query\\('lng'\\)/);"""
if "createPane\\('cj217-route-pane'" not in test:
    test = replace_once(test, marker, marker + '\n' + extra, 'asserts da rota e alerta')
write(test_path, test)

print('ChegaJá 14.33.21 aplicado.')
