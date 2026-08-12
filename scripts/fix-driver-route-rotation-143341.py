from pathlib import Path
import re

DRIVER=Path('public/chegaja-v217-driver-navigation.js')
OP=Path('public/chegaja-v201-operational.js')
INDEX=Path('public/index.html')
TEST=Path('scripts/test-v14153-logo-google-maps.mjs')

driver=DRIVER.read_text()
op=OP.read_text()
index=INDEX.read_text()
test=TEST.read_text()

# Versão do cooperado.
driver=driver.replace('/* ChegaJá 14.33.40 — fluxo completo de coleta e rota */','/* ChegaJá 14.33.41 — rota contínua e rotação estável */')
driver=driver.replace('__CJ_DRIVER_LEAFLET_143340__','__CJ_DRIVER_LEAFLET_143341__')

# A rota deve usar a overlayPane padrão. O leaflet-rotate mantém esta pane dentro da rotatePane.
# A pane SVG customizada da 14.33.40 deixava a linha fora/atrás da árvore de rotação em alguns iPhones.
driver=re.sub(
    r"const routePane=A\.map\.getPane\('cj217-route-pane'\).*?A\.routeRenderer=typeof L\.svg==='function'\?L\.svg\(\{pane:'cj217-route-pane',padding:\.5\}\):null;A\.tile=",
    "A.routeRenderer=null;A.tile=",
    driver,
    count=1,
)
new_draw="function drawRoute(points){if(!A.map||!Array.isArray(points)||points.length<2)return;const path=points.map(p=>point(p.lat,p.lng)).filter(valid);if(path.length<2)return;A.routePoints=path;const ll=path.map(p=>[p.lat,p.lng]);if(!A.casing)A.casing=L.polyline(ll,{color:'#fff',weight:14,opacity:.98,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-casing'}).addTo(A.map);else A.casing.setLatLngs(ll);if(!A.line)A.line=L.polyline(ll,{color:'#075dff',weight:8,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-line'}).addTo(A.map);else A.line.setLatLngs(ll);A.casing.bringToFront?.();A.line.bringToFront?.();ensureSelf();requestAnimationFrame(()=>{try{A.casing?.redraw?.();A.line?.redraw?.();refreshGuidance();applyMapBearing(false)}catch{}})}"
driver=re.sub(r"function drawRoute\(points\)\{.*?\}\nfunction clearRoute",new_draw+"\nfunction clearRoute",driver,count=1,flags=re.S)

# Não apaga a rota atual antes da nova parada ter uma geometria válida; ela é substituída pelo próximo drawRoute.
driver=driver.replace("A.nextInstruction=null;A.lastVoiceText='';A.lastVoiceTarget='';clearRoute();updateStops();renderControls();renderSheet(true);return true", "A.nextInstruction=null;A.lastVoiceText='';A.lastVoiceTarget='';A.lastRouteTarget=null;A.routeFitKey='';updateStops();renderControls();renderSheet(true);return true")

# Estado e permissão de orientação no iPhone. Após recarregar já online, o primeiro toque rearma a bússola.
driver=driver.replace("orientationBound:false,routeArrows:[]", "orientationBound:false,orientationPermission:'unknown',orientationBusy:false,routeArrows:[]")
new_permission="""async function requestOrientationPermission(){installOrientationListeners();if(A.orientationBusy)return A.orientationPermission==='granted';A.orientationBusy=true;try{if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){const r=await DeviceOrientationEvent.requestPermission();A.orientationPermission=r==='granted'?'granted':'denied';return r==='granted'}A.orientationPermission='granted';return true}catch{A.orientationPermission='denied';return false}finally{A.orientationBusy=false}}
function armOrientationFromGesture(){if(A.orientationPermission==='granted'){if(navigationActive())applyMapBearing(false);return}if(A.orientationPermission==='denied'||A.orientationBusy)return;requestOrientationPermission().then(ok=>{if(ok&&navigationActive()){A.headingUp=true;A.manualView=false;A.following=true;applyMapBearing(true);frameNavigation(false)}}).catch(()=>{})}"""
driver=re.sub(r"async function requestOrientationPermission\(\)\{.*?\}\nfunction currentMapBearing",new_permission+"\nfunction currentMapBearing",driver,count=1,flags=re.S)

driver=re.sub(
    r"function toggleBearingMode\(\)\{.*?\}\nfunction segmentBearing",
    "function toggleBearingMode(){A.headingUp=true;A.manualView=false;A.following=true;requestOrientationPermission().then(ok=>{if(!ok)return notice('Ative o acesso ao movimento e orientação do Safari para girar o mapa.',true);applyMapBearing(true);if(navigationActive())frameNavigation(true)}).catch(()=>{})}\nfunction segmentBearing",
    driver,
    count=1,
    flags=re.S,
)

driver=driver.replace("async function toggleOnline(){requestOrientationPermission().catch(()=>{});unlockAudio();", "async function toggleOnline(){requestOrientationPermission().then(ok=>{if(ok)applyMapBearing(true)}).catch(()=>{});unlockAudio();")
driver=driver.replace("for(const ev of['pointerdown','touchstart','click'])document.addEventListener(ev,unlockAudio,{capture:true,passive:true})", "for(const ev of['pointerdown','touchstart','click'])document.addEventListener(ev,()=>{unlockAudio();armOrientationFromGesture()},{capture:true,passive:true})")
driver=driver.replace("try{await ensureMap()}catch(e){notice(e.message,true)}await poll(true);", "try{await ensureMap()}catch(e){notice(e.message,true)}if(A.orientationPermission==='granted')applyMapBearing(true);await poll(true);")

# Base/estabelecimento: nenhuma linha de rota. Bloqueia adapter, Leaflet direto e remove SVG legado.
op=op.replace('/* ChegaJá 14.33.37 — mapa operacional sem rota administrativa; linha azul somente no cooperado */','/* ChegaJá 14.33.41 — nenhuma rota na Base/estabelecimento; rota somente no cooperado */')
op=op.replace('__cj201Operational143337','__cj201Operational143341')
# Injeta bloqueio de L.Polyline diretamente no mapa administrativo.
needle="if(addGeoJSON)adapter.addGeoJSON=(raw,opt={})=>administrativeRole()&&administrativeMapHost(host||adapter.host)?null:addGeoJSON(raw,opt);\n }"
replacement="""if(addGeoJSON)adapter.addGeoJSON=(raw,opt={})=>administrativeRole()&&administrativeMapHost(host||adapter.host)?null:addGeoJSON(raw,opt);
  const raw=adapter.raw;
  if(raw?.addLayer&&!raw.addLayer.__cjAdminPolylineBlocked){
   const rawAdd=raw.addLayer.bind(raw);
   const guardedLayer=(layer,...rest)=>{if(administrativeRole()&&administrativeMapHost(host||adapter.host)&&window.L&&layer instanceof L.Polyline&&!(layer instanceof L.Polygon)){try{layer.remove?.()}catch{}return raw}return rawAdd(layer,...rest)};
   guardedLayer.__cjAdminPolylineBlocked=true;raw.addLayer=guardedLayer;
  }
 }"""
if needle not in op:
    raise SystemExit('Não encontrei o bloco stripAdapterRoutes para bloquear Polyline administrativa.')
op=op.replace(needle,replacement,1)
op=op.replace("for(const path of $$('.leaflet-overlay-pane svg path',host))try{path.remove()}catch{}", "for(const path of $$('.leaflet-pane svg path',host))try{path.remove()}catch{}")

# Índice: versão nova e leaflet-rotate local, sem dependência externa em tempo de uso.
index=re.sub(r'<!-- ChegaJá [^>]+: publicação da prioridade multi-entrega\. -->','<!-- ChegaJá 14.33.41: rota exclusiva do cooperado e rotação local. -->',index,count=1)
index=re.sub(r'<meta name="app-version" content="[^"]+" />','<meta name="app-version" content="14.33.41" />',index,count=1)
index=index.replace('<script src="https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate.js" crossorigin="anonymous"></script>','<script src="/vendor/leaflet/leaflet-rotate.js?v=0.2.8&recovery=143341"></script>')
index=re.sub(r'/chegaja-v201-operational\.js\?v=[^"&]+&recovery=\d+','/chegaja-v201-operational.js?v=14.33.41&recovery=143341',index,count=1)
index=re.sub(r'/chegaja-v217-driver-navigation\.js\?v=[^"&]+&recovery=\d+','/chegaja-v217-driver-navigation.js?v=14.33.41&recovery=143341',index,count=1)

# Regressão: a rota volta corretamente para overlayPane padrão.
test=test.replace("assert.match(driver,/L\\.polyline\\(ll,\\{pane:'cj217-route-pane',renderer:A\\.routeRenderer,color:'#075dff'/);","assert.match(driver,/L\\.polyline\\(ll,\\{color:'#075dff'/);")
# Atualiza apenas referências de cache/versão mais recente quando existirem.
test=test.replace('14.33.40&recovery=143340','14.33.41&recovery=143341')

DRIVER.write_text(driver)
OP.write_text(op)
INDEX.write_text(index)
TEST.write_text(test)
print('14.33.41 aplicada: rota contínua no cooperado, rotação rearmada e nenhuma Polyline administrativa.')
