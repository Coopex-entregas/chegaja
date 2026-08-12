from pathlib import Path

ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,t): (ROOT/p).write_text(t,encoding='utf-8')
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

# Painel do cooperado: Leaflet padrão para posição e rota.
js_path='public/chegaja-v217-driver-navigation.js'
js=read(js_path)
if 'ChegaJá 14.33.25' not in js:
    js=replace_once(js,'/* ChegaJá 14.33.24 — rota real, marcador compacto e voz brasileira */','/* ChegaJá 14.33.25 — rota e posição em camadas Leaflet padrão */','versão JS')
    js=js.replace('__CJ_DRIVER_LEAFLET_143324__','__CJ_DRIVER_LEAFLET_143325__')
    js=js.replace('preferCanvas:true','preferCanvas:false',1)
    ensure_self="function ensureSelf(){if(!A.map||!valid(A.gps))return;const ll=[A.gps.lat,A.gps.lng],pathLike=A.self&&typeof A.self.setStyle==='function'&&typeof A.self.setRadius==='function';if(!pathLike){try{A.self?.remove()}catch{}A.self=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,opacity:1,fillColor:'#1459ff',fillOpacity:1,interactive:false,className:'cj217-current-position'}).addTo(A.map)}else{A.self.setLatLng(ll);A.self.setRadius(8);A.self.setStyle({color:'#fff',weight:3,opacity:1,fillColor:'#1459ff',fillOpacity:1})}A.self.bringToFront?.()}"
    js=replace_line(js,'function ensureSelf()',ensure_self,'posição padrão Leaflet')
    draw_route="function drawRoute(points){if(!A.map||!Array.isArray(points)||points.length<2)return;const path=points.map(p=>point(p.lat,p.lng)).filter(valid);if(path.length<2)return;A.routePoints=path;const ll=path.map(p=>[p.lat,p.lng]);if(!A.casing)A.casing=L.polyline(ll,{color:'#fff',weight:14,opacity:.98,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-casing'}).addTo(A.map);else A.casing.setLatLngs(ll);if(!A.line)A.line=L.polyline(ll,{color:'#075dff',weight:8,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-line'}).addTo(A.map);else A.line.setLatLngs(ll);A.casing.bringToFront?.();A.line.bringToFront?.();A.self?.bringToFront?.();requestAnimationFrame(()=>{try{A.casing?.redraw?.();A.line?.redraw?.();A.self?.bringToFront?.()}catch{}})}"
    js=replace_line(js,'function drawRoute(points)',draw_route,'rota padrão Leaflet')
    write(js_path,js)

css_path='public/chegaja-v217-driver-navigation.css'
css=read(css_path)
css=css.replace('/* ChegaJá 14.33.24 — ÚNICA folha do painel do cooperado. */','/* ChegaJá 14.33.25 — ÚNICA folha do painel do cooperado. */',1)
if 'ChegaJá 14.33.25 — rota Leaflet padrão' not in css:
    css += """

/* ChegaJá 14.33.25 — rota Leaflet padrão, sempre acima do mapa */
body.cj199-driver #cj199-map .leaflet-overlay-pane{z-index:500!important;display:block!important;visibility:visible!important;opacity:1!important}
body.cj199-driver #cj199-map .leaflet-overlay-pane svg{display:block!important;visibility:visible!important;opacity:1!important;overflow:visible!important}
body.cj199-driver #cj199-map path.cj217-route-casing{stroke:#fff!important;stroke-width:14px!important;stroke-opacity:.98!important;fill:none!important}
body.cj199-driver #cj199-map path.cj217-route-line{stroke:#075dff!important;stroke-width:8px!important;stroke-opacity:1!important;fill:none!important}
body.cj199-driver #cj199-map path.cj217-current-position{stroke:#fff!important;stroke-width:3px!important;fill:#1459ff!important;fill-opacity:1!important;stroke-opacity:1!important}
"""
write(css_path,css)

# Login novo sempre em Início; refresh/reabertura preserva o hash/aba atual.
app_path='public/app.js'
app=read(app_path)
old="const defaultPage=state.user.role==='dispatcher'?'bases':'dashboard';navigate(location.hash.slice(1)||defaultPage,false)}"
new="const defaultPage=state.user.role==='dispatcher'?'bases':'dashboard';const freshDriver=state.user.role==='driver'&&Boolean(state.freshLogin);const targetPage=freshDriver?'dashboard':(location.hash.slice(1)||defaultPage);if(freshDriver){state.freshLogin=false;try{history.replaceState(null,'','#dashboard')}catch{}}navigate(targetPage,false)}"
if old in app: app=app.replace(old,new,1)
login_old="state.token=d.token;localStorage.setItem('lg_token',d.token);await loadMe()"
login_new="state.token=d.token;state.freshLogin=true;localStorage.setItem('lg_token',d.token);try{history.replaceState(null,'','#dashboard')}catch{}await loadMe()"
if login_old in app: app=app.replace(login_old,login_new,1)
logout_old="function logout(msg=true){localStorage.removeItem('lg_token');state.token='';state.user=null;stopLocation();if(msg)toast('Sessão encerrada.');showAuth('login')}"
logout_new="function logout(msg=true){localStorage.removeItem('lg_token');state.token='';state.user=null;stopLocation();try{history.replaceState(null,'','#dashboard')}catch{}if(msg)toast('Sessão encerrada.');showAuth('login')}"
if logout_old in app: app=app.replace(logout_old,logout_new,1)
write(app_path,app)

# Cache/versionamento.
index_path='public/index.html'
index=read(index_path)
index=index.replace('app-version" content="14.33.24"','app-version" content="14.33.25"')
index=index.replace('chegaja-v217-driver-navigation.js?v=14.33.24&recovery=143324','chegaja-v217-driver-navigation.js?v=14.33.25&recovery=143325')
index=index.replace('chegaja-v217-driver-navigation.css?v=14.33.24&recovery=143324','chegaja-v217-driver-navigation.css?v=14.33.25&recovery=143325')
index=index.replace('/app.js?v=14.33.17&recovery=143318','/app.js?v=14.33.25&recovery=143325')
write(index_path,index)

# Regressão.
test_path='scripts/test-v14153-logo-google-maps.mjs'
test=read(test_path)
test=test.replace('14\\.33\\.24','14\\.33\\.25').replace('143324','143325').replace('ChegaJá 14.33.24:','ChegaJá 14.33.25:')
test=test.replace("assert.match(driver,/createPane\\('cj217-route-pane'\\)/);\nassert.match(driver,/L\\.svg\\(\\{pane:'cj217-route-pane'/);","assert.match(driver,/preferCanvas:false/);\nassert.match(driver,/L\\.circleMarker\\(ll/);\nassert.match(driver,/className:'cj217-route-line'/);")
if "freshLogin=true" not in test:
    test += "\nassert.match(app,/state\\.freshLogin=true/);\nassert.match(app,/freshDriver=.*state\\.freshLogin/);\nassert.match(app,/targetPage=freshDriver\\?'dashboard'/);\nassert.match(index,/\\/app\\.js\\?v=14\\.33\\.25&recovery=143325/);\nassert.match(driver,/L\\.circleMarker\\(ll/);\nassert.match(driver,/L\\.polyline\\(ll,\\{color:'#075dff'/);\n"
write(test_path,test)

print('ChegaJá 14.33.25 aplicado: posição/rota Leaflet padrão e abas corrigidas.')
