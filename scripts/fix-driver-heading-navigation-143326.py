from pathlib import Path

ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def rep(s,a,b,label):
    if a not in s: raise RuntimeError(f'Bloco não encontrado: {label}')
    return s.replace(a,b,1)

js_path='public/chegaja-v217-driver-navigation.js'
js=read(js_path)
if 'ChegaJá 14.33.26' not in js:
    js=rep(js,'/* ChegaJá 14.33.25 — rota e posição em camadas Leaflet padrão */','/* ChegaJá 14.33.26 — navegação heading-up com bússola, seta e manobras */','versão')
    js=js.replace('__CJ_DRIVER_LEAFLET_143325__','__CJ_DRIVER_LEAFLET_143326__')
    js=rep(js,"voicePtBr:null};","voicePtBr:null,headingUp:true,deviceHeading:null,lastSpeed:0,orientationBound:false,routeArrows:[],maneuverMarkers:[],navSteps:[],nextInstruction:null};",'estado navegação')
    js=rep(js,'<button id="cj199-center" type="button" aria-label="Centralizar na minha localização">◎</button>','<button id="cj199-center" type="button" aria-label="Centralizar na minha localização">◎</button><button id="cj217-bearing" type="button" aria-label="Alternar orientação do mapa"><span>➤</span><small>AUTO</small></button>','botão orientação')

    helpers=r'''function normAngle(v){const n=Number(v);return Number.isFinite(n)?((n%360)+360)%360:null}
function angleDelta(a,b){return((Number(b)-Number(a)+540)%360)-180}
function smoothAngle(old,next,f=.22){const n=normAngle(next);if(n==null)return old;const o=normAngle(old);return o==null?n:normAngle(o+angleDelta(o,n)*f)}
function effectiveHeading(){const speed=Number(A.lastSpeed||window.ChegaJaLastDriverLocation?.speed||0),gps=normAngle(A.lastHeading),device=normAngle(A.deviceHeading);if(speed>=1&&gps!=null)return gps;if(device!=null)return device;return gps}
function orientationReading(e){let h=Number(e?.webkitCompassHeading);if(!Number.isFinite(h)&&Number.isFinite(Number(e?.alpha)))h=360-Number(e.alpha);h=normAngle(h);if(h==null)return;A.deviceHeading=smoothAngle(A.deviceHeading,h,.18);applyMapBearing(false);paintHeading()}
function installOrientationListeners(){if(A.orientationBound)return;A.orientationBound=true;window.addEventListener('deviceorientationabsolute',orientationReading,true);window.addEventListener('deviceorientation',orientationReading,true)}
async function requestOrientationPermission(){installOrientationListeners();try{if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){const r=await DeviceOrientationEvent.requestPermission();return r==='granted'}return true}catch{return false}}
function currentMapBearing(){try{return normAngle(A.map?.getBearing?.())??0}catch{return 0}}
function applyMapBearing(force=false){if(!A.map||typeof A.map.setBearing!=='function')return;const target=A.headingUp&&navigationActive()?effectiveHeading():0;if(target==null&&!force)return;const wanted=target==null?0:target,current=currentMapBearing(),delta=angleDelta(current,wanted);if(!force&&Math.abs(delta)<1.2)return;const next=force?wanted:normAngle(current+delta*.30);try{A.map.setBearing(next)}catch{}paintHeading();refreshRouteArrowAngles();const b=$('#cj217-bearing');if(b){b.classList.toggle('north',!A.headingUp);const small=b.querySelector('small');if(small)small.textContent=A.headingUp?'AUTO':'N'}}
function toggleBearingMode(){A.headingUp=!A.headingUp;A.manualView=false;A.following=true;applyMapBearing(true);if(navigationActive())frameNavigation(true)}
function segmentBearing(a,b){if(!valid(a)||!valid(b))return 0;const lat1=a.lat*Math.PI/180,lat2=b.lat*Math.PI/180,dLon=(b.lng-a.lng)*Math.PI/180,y=Math.sin(dLon)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);return normAngle(Math.atan2(y,x)*180/Math.PI)||0}
function clearGuidance(){for(const m of A.routeArrows.splice(0))try{m.remove()}catch{}for(const m of A.maneuverMarkers.splice(0))try{m.remove()}catch{}A.navSteps=[];A.nextInstruction=null}
function routeArrowIcon(angle){return L.divIcon({className:'cj217-route-direction-icon',html:`<span style="transform:rotate(${angle}deg)">▲</span>`,iconSize:[20,20],iconAnchor:[10,10]})}
function refreshRouteArrowAngles(){const mapBearing=currentMapBearing();for(const m of A.routeArrows){const angle=normAngle(Number(m.__routeBearing||0)-mapBearing)||0;const el=m.getElement?.()?.querySelector('span');if(el)el.style.transform=`rotate(${angle}deg)`}paintHeading()}
function drawRouteArrows(){for(const m of A.routeArrows.splice(0))try{m.remove()}catch{}if(!A.map||A.routePoints.length<2)return;const mapBearing=currentMapBearing();let walked=0,nextAt=180;for(let i=1;i<A.routePoints.length&&A.routeArrows.length<12;i++){const a=A.routePoints[i-1],b=A.routePoints[i],seg=distance(a,b);if(!Number.isFinite(seg)||seg<=0)continue;while(walked+seg>=nextAt&&A.routeArrows.length<12){const t=(nextAt-walked)/seg,p={lat:a.lat+(b.lat-a.lat)*t,lng:a.lng+(b.lng-a.lng)*t},bearing=segmentBearing(a,b),angle=normAngle(bearing-mapBearing)||0,m=L.marker([p.lat,p.lng],{icon:routeArrowIcon(angle),keyboard:false,interactive:false,zIndexOffset:2500}).addTo(A.map);m.__routeBearing=bearing;A.routeArrows.push(m);nextAt+=260}walked+=seg}}
function maneuverGlyph(step){const mod=String(step?.maneuver_modifier||'').toLowerCase(),type=String(step?.maneuver_type||'').toLowerCase();if(type.includes('roundabout')||type.includes('rotary'))return'⟳';if(mod.includes('uturn'))return'↶';if(mod.includes('left'))return'↰';if(mod.includes('right'))return'↱';return'↑'}
function drawManeuvers(steps){for(const m of A.maneuverMarkers.splice(0))try{m.remove()}catch{}if(!A.map||!Array.isArray(steps))return;for(const s of steps){const loc=Array.isArray(s?.location)?point(s.location[0],s.location[1]):null,type=String(s?.maneuver_type||'');if(!valid(loc)||['depart','arrive'].includes(type))continue;const glyph=maneuverGlyph(s),icon=L.divIcon({className:'cj217-maneuver-icon',html:`<span>${glyph}</span>`,iconSize:[34,34],iconAnchor:[17,17]});A.maneuverMarkers.push(L.marker([loc.lat,loc.lng],{icon,keyboard:false,interactive:false,zIndexOffset:3200}).addTo(A.map));if(A.maneuverMarkers.length>=7)break}}
function refreshGuidance(){drawRouteArrows();drawManeuvers(A.navSteps);refreshRouteArrowAngles()}'''
    js=rep(js,'function smoothHeading(raw,speed,accuracy){',helpers+'\nfunction smoothHeading(raw,speed,accuracy){','helpers orientação')

    old_paint="function paintHeading(){const el=A.self?.getElement?.()?.querySelector('.cj217-self-marker');if(el)el.style.transform=`rotate(${Number.isFinite(A.lastHeading)?A.lastHeading:0}deg`)}`"
    new_paint="function paintHeading(){const el=A.self?.getElement?.()?.querySelector('.cj217-self-marker');if(!el)return;const h=effectiveHeading(),mapBearing=currentMapBearing(),angle=h==null?0:normAngle(h-mapBearing);el.style.transform=`rotate(${angle||0}deg)`}"
    js=rep(js,old_paint,new_paint,'pintar heading')

    old_self="function ensureSelf(){if(!A.map||!valid(A.gps))return;const ll=[A.gps.lat,A.gps.lng],pathLike=A.self&&typeof A.self.setStyle==='function'&&typeof A.self.setRadius==='function';if(!pathLike){try{A.self?.remove()}catch{}A.self=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,opacity:1,fillColor:'#1459ff',fillOpacity:1,interactive:false,className:'cj217-current-position'}).addTo(A.map)}else{A.self.setLatLng(ll);A.self.setRadius(8);A.self.setStyle({color:'#fff',weight:3,opacity:1,fillColor:'#1459ff',fillOpacity:1})}A.self.bringToFront?.()}"
    new_self="function ensureSelf(){if(!A.map||!valid(A.gps))return;const ll=[A.gps.lat,A.gps.lng],markerLike=A.self&&typeof A.self.setIcon==='function';if(!markerLike){try{A.self?.remove()}catch{}A.self=L.marker(ll,{icon:selfIcon(),keyboard:false,interactive:false,zIndexOffset:9000,title:'Sua localização'}).addTo(A.map)}else A.self.setLatLng(ll);paintHeading()}"
    js=rep(js,old_self,new_self,'seta cooperado')

    old_map_start="A.map=L.map(host,{zoomControl:true,attributionControl:true,preferCanvas:false,zoomSnap:.5,zoomDelta:.5,fadeAnimation:false,markerZoomAnimation:false}).setView([center.lat,center.lng],valid(A.gps)?18:13);"
    new_map_start="A.map=L.map(host,{zoomControl:true,attributionControl:true,preferCanvas:false,zoomSnap:.5,zoomDelta:.5,fadeAnimation:false,markerZoomAnimation:false,rotate:typeof L.Map?.prototype?.setBearing==='function',bearing:0,touchRotate:true,rotateControl:false}).setView([center.lat,center.lng],valid(A.gps)?18:13);"
    js=rep(js,old_map_start,new_map_start,'mapa rotacionável')

    old_draw="function drawRoute(points){if(!A.map||!Array.isArray(points)||points.length<2)return;const path=points.map(p=>point(p.lat,p.lng)).filter(valid);if(path.length<2)return;A.routePoints=path;const ll=path.map(p=>[p.lat,p.lng]);if(!A.casing)A.casing=L.polyline(ll,{color:'#fff',weight:14,opacity:.98,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-casing'}).addTo(A.map);else A.casing.setLatLngs(ll);if(!A.line)A.line=L.polyline(ll,{color:'#075dff',weight:8,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-line'}).addTo(A.map);else A.line.setLatLngs(ll);A.casing.bringToFront?.();A.line.bringToFront?.();A.self?.bringToFront?.();requestAnimationFrame(()=>{try{A.casing?.redraw?.();A.line?.redraw?.();A.self?.bringToFront?.()}catch{}})}"
    new_draw="function drawRoute(points){if(!A.map||!Array.isArray(points)||points.length<2)return;const path=points.map(p=>point(p.lat,p.lng)).filter(valid);if(path.length<2)return;A.routePoints=path;const ll=path.map(p=>[p.lat,p.lng]);if(!A.casing)A.casing=L.polyline(ll,{color:'#fff',weight:14,opacity:.98,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-casing'}).addTo(A.map);else A.casing.setLatLngs(ll);if(!A.line)A.line=L.polyline(ll,{color:'#075dff',weight:8,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-line'}).addTo(A.map);else A.line.setLatLngs(ll);A.casing.bringToFront?.();A.line.bringToFront?.();ensureSelf();requestAnimationFrame(()=>{try{A.casing?.redraw?.();A.line?.redraw?.();refreshGuidance()}catch{}})}"
    js=rep(js,old_draw,new_draw,'rota com setas')

    old_clear="function clearRoute(){A.casing?.remove();A.line?.remove();A.casing=A.line=null;A.routePoints=[];A.lastRouteOrigin=A.lastRouteTarget=null;A.routeFitKey='';A.navTarget=null;A.navFrameAt=0;A.navFrameOrigin=A.navFrameTarget=null}"
    new_clear="function clearRoute(){A.casing?.remove();A.line?.remove();A.casing=A.line=null;A.routePoints=[];clearGuidance();A.lastRouteOrigin=A.lastRouteTarget=null;A.routeFitKey='';A.navTarget=null;A.navFrameAt=0;A.navFrameOrigin=A.navFrameTarget=null}"
    js=rep(js,old_clear,new_clear,'limpar guidance')

    old_frame="function frameNavigation(force=false){if(!A.map||!valid(A.gps)||!navigationActive()||A.manualView||!A.following)return false;const target=targetPoint();if(!valid(target))return false;const moved=!valid(A.navFrameOrigin)||distance(A.gps,A.navFrameOrigin)>55,targetChanged=!valid(A.navFrameTarget)||distance(target,A.navFrameTarget)>15;if(!force&&!moved&&!targetChanged&&Date.now()-A.navFrameAt<9000)return false;const base=Array.isArray(A.routePoints)&&A.routePoints.length>=2?A.routePoints:[A.gps,target],points=[...base,{...A.gps},{...target}].filter(valid);if(points.length<2)return false;const bounds=L.latLngBounds(points.map(p=>[p.lat,p.lng]));A.programmatic=true;try{A.map.fitBounds(bounds,{paddingTopLeft:[24,132],paddingBottomRight:[24,148],maxZoom:17,animate:false});A.navFrameAt=Date.now();A.navFrameOrigin={...A.gps};A.navFrameTarget={...target};ensureSelf();updateStops()}finally{setTimeout(()=>A.programmatic=false,120)}return true}"
    new_frame="function frameNavigation(force=false){if(!A.map||!valid(A.gps)||!navigationActive()||A.manualView||!A.following)return false;const target=targetPoint();if(!valid(target))return false;const moved=!valid(A.navFrameOrigin)||distance(A.gps,A.navFrameOrigin)>18,targetChanged=!valid(A.navFrameTarget)||distance(target,A.navFrameTarget)>15;if(!force&&!moved&&!targetChanged&&Date.now()-A.navFrameAt<3500){applyMapBearing(false);return false}const d=distance(A.gps,target),zoom=d<180?18.5:d<500?17.8:d<1400?17.2:16.6;A.programmatic=true;try{A.map.setView([A.gps.lat,A.gps.lng],zoom,{animate:false});applyMapBearing(force);A.navFrameAt=Date.now();A.navFrameOrigin={...A.gps};A.navFrameTarget={...target};ensureSelf();updateStops();refreshGuidance()}finally{setTimeout(()=>A.programmatic=false,120)}return true}"
    js=rep(js,old_frame,new_frame,'camera heading-up')

    old_speak="function maybeSpeakNavigation(nav){if(!nav||!valid(A.gps))return;const targetKey=`${A.detail?.id||''}:${targetKind()}`;if(targetKey!==A.lastVoiceTarget){A.lastVoiceTarget=targetKey;A.lastVoiceText='';A.lastVoiceAt=0}if(nav.arrived){speakPtBr(targetKind()==='pickup'?'Você chegou ao local da coleta.':'Você chegou ao destino da entrega.',true);return}const steps=Array.isArray(nav.route?.steps)?nav.route.steps:[];if(!steps.length)return;let chosen=null;for(let i=0;i<steps.length;i++){const s=steps[i],loc=Array.isArray(s?.location)?point(s.location[0],s.location[1]):null,d=valid(loc)?distance(A.gps,loc):Infinity;if(i===0||d<=220){chosen=s;if(d<=220)break}}if(!chosen)return;let text=String(chosen.instruction||'').trim();const meters=Math.round(Number(chosen.distance_meters||0));if(meters>=80&&meters<=1200&&!/^em\\s/i.test(text))text=`Em ${meters} metros, ${text.charAt(0).toLowerCase()+text.slice(1)}`;speakPtBr(text)}"
    new_speak="function maybeSpeakNavigation(nav){if(!nav||!valid(A.gps))return;const targetKey=`${A.detail?.id||''}:${targetKind()}`;if(targetKey!==A.lastVoiceTarget){A.lastVoiceTarget=targetKey;A.lastVoiceText='';A.lastVoiceAt=0}if(nav.arrived){A.nextInstruction={text:targetKind()==='pickup'?'Chegou à coleta':'Chegou ao destino',meters:0,glyph:'✓'};applyMetric();speakPtBr(targetKind()==='pickup'?'Você chegou ao local da coleta.':'Você chegou ao destino da entrega.',true);return}const steps=Array.isArray(nav.route?.steps)?nav.route.steps:[];A.navSteps=steps;drawManeuvers(steps);if(!steps.length)return;let chosen=null;for(let i=0;i<steps.length;i++){const s=steps[i],loc=Array.isArray(s?.location)?point(s.location[0],s.location[1]):null,d=valid(loc)?distance(A.gps,loc):Infinity;if(i===0||d<=220){chosen=s;if(d<=220)break}}if(!chosen)return;let text=String(chosen.instruction||'').trim();const meters=Math.round(Number(chosen.distance_meters||0)),glyph=maneuverGlyph(chosen);A.nextInstruction={text,meters,glyph};applyMetric();let spoken=text;if(meters>=80&&meters<=1200&&!/^em\\s/i.test(spoken))spoken=`Em ${meters} metros, ${spoken.charAt(0).toLowerCase()+spoken.slice(1)}`;speakPtBr(spoken)}"
    js=rep(js,old_speak,new_speak,'manobra visual e voz')

    old_apply="else if(A.detail){label.textContent='NAVEGAÇÃO ATIVA';value.textContent=statusText(A.detail.status).toUpperCase();hint.textContent='Siga a linha azul; o mapa acompanha sua posição em tempo real'}"
    new_apply="else if(A.detail){const nav=A.nextInstruction;label.textContent='NAVEGAÇÃO ATIVA';value.textContent=nav?.text?`${nav.glyph||'↑'} ${nav.text}`:statusText(A.detail.status).toUpperCase();hint.textContent=nav&&Number(nav.meters)>0?`${Math.round(nav.meters)} m • ${targetKind()==='pickup'?'indo para a coleta':'indo para a entrega'}`:'Siga a linha azul; o sentido da marcha fica para cima'}"
    js=rep(js,old_apply,new_apply,'banner manobra')

    old_handle="function handleGpsPosition(p){const next=point(p.coords.latitude,p.coords.longitude),moved=valid(A.lastGps)?distance(A.lastGps,next):Infinity;A.gps=next;A.gpsError=null;A.lastHeading=smoothHeading(p.coords.heading,p.coords.speed,p.coords.accuracy);window.ChegaJaLastDriverLocation={lat:next.lat,lng:next.lng,accuracy:p.coords.accuracy,heading:A.lastHeading,speed:p.coords.speed};ensureSelf();trimRouteToGps();if(A.map&&!A.firstCenter){A.firstCenter=true;centralize()}else followGps();const loc=positionPayload(p),moving=Number(p.coords.speed||0)>.8||moved>10,interval=A.detail?(moving?4000:6500):(moving?7000:12000);if(A.online&&Date.now()-A.lastSent>=interval){A.lastGps={...next};pushLocation(loc).catch(()=>{});autoProgress(loc)}if(A.detail&&moving)updateRoute(false)}"
    new_handle="function handleGpsPosition(p){const next=point(p.coords.latitude,p.coords.longitude),moved=valid(A.lastGps)?distance(A.lastGps,next):Infinity;A.gps=next;A.gpsError=null;A.lastSpeed=Number(p.coords.speed||0);A.lastHeading=smoothHeading(p.coords.heading,p.coords.speed,p.coords.accuracy);window.ChegaJaLastDriverLocation={lat:next.lat,lng:next.lng,accuracy:p.coords.accuracy,heading:A.lastHeading,speed:p.coords.speed};ensureSelf();trimRouteToGps();applyMapBearing(false);if(A.map&&!A.firstCenter){A.firstCenter=true;centralize()}else followGps();const loc=positionPayload(p),moving=A.lastSpeed>.8||moved>10,interval=A.detail?(moving?4000:6500):(moving?7000:12000);if(A.online&&Date.now()-A.lastSent>=interval){A.lastGps={...next};pushLocation(loc).catch(()=>{});autoProgress(loc)}if(A.detail&&moving)updateRoute(false)}"
    js=rep(js,old_handle,new_handle,'gps + bearing')

    js=rep(js,'async function toggleOnline(){unlockAudio();primeAlarmMedia(!A.online);','async function toggleOnline(){requestOrientationPermission().catch(()=>{});unlockAudio();primeAlarmMedia(!A.online);','permissão orientação')
    js=rep(js,"$('#cj199-center').onclick=centralize;","$('#cj199-center').onclick=centralize;$('#cj217-bearing').onclick=toggleBearingMode;installOrientationListeners();",'bind orientação')
    js=rep(js,"installAudioArm();startGps();primeAlarmMedia(false);","installAudioArm();installOrientationListeners();startGps();primeAlarmMedia(false);",'mount orientação')
    write(js_path,js)

css_path='public/chegaja-v217-driver-navigation.css'
css=read(css_path)
css=css.replace('/* ChegaJá 14.33.24 — ÚNICA folha do painel do cooperado. */','/* ChegaJá 14.33.26 — ÚNICA folha do painel do cooperado. */',1)
if 'ChegaJá 14.33.26 — navegação heading-up' not in css:
    css += r'''

/* ChegaJá 14.33.26 — navegação heading-up e visual mais limpo */
body.cj199-driver #cj199-map .leaflet-tile-pane{filter:saturate(.68) brightness(1.04) contrast(.92)!important}
#cj217-bearing{position:absolute;z-index:22;right:18px;top:178px;width:56px;height:56px;border:0;border-radius:50%;background:#fff;color:#0d45d8;box-shadow:0 8px 24px #0d214f30;display:grid;place-content:center;gap:0;text-align:center;font-weight:950}
#cj217-bearing span{font-size:22px;line-height:18px;transform:rotate(-90deg)}#cj217-bearing small{font-size:7px;line-height:10px;letter-spacing:.08em}#cj217-bearing.north span{transform:rotate(-90deg);color:#667085}#cj217-bearing.north small{color:#667085}
body.cj199-driver #cj199-map .cj217-self-icon{background:transparent!important;border:0!important;overflow:visible!important}
body.cj199-driver #cj199-map .cj217-self-marker{position:relative!important;display:block!important;width:28px!important;height:34px!important;background:#1459ff!important;clip-path:polygon(50% 0,94% 100%,50% 78%,6% 100%)!important;border:2px solid #fff!important;filter:drop-shadow(0 4px 5px rgba(7,24,58,.68))!important;transform-origin:50% 50%!important;transition:transform .18s linear!important}
body.cj199-driver #cj199-map .cj217-self-marker i{position:absolute!important;left:50%!important;top:50%!important;width:5px!important;height:5px!important;transform:translate(-50%,-50%)!important;border-radius:50%!important;background:#fff!important}
body.cj199-driver #cj199-map .cj217-route-direction-icon{background:transparent!important;border:0!important;pointer-events:none!important}
body.cj199-driver #cj199-map .cj217-route-direction-icon span{width:20px;height:20px;display:grid;place-items:center;color:#075dff;font-size:15px;line-height:1;text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff;transform-origin:50% 50%}
body.cj199-driver #cj199-map .cj217-maneuver-icon{background:transparent!important;border:0!important;pointer-events:none!important}
body.cj199-driver #cj199-map .cj217-maneuver-icon span{width:32px;height:32px;display:grid;place-items:center;border-radius:50%;background:#fff;color:#075dff;border:2px solid #075dff;box-shadow:0 4px 12px rgba(7,24,58,.28);font:950 19px/1 system-ui,sans-serif}
@media(max-width:390px){#cj217-bearing{right:12px;top:158px;width:50px;height:50px}}
'''
write(css_path,css)

index_path='public/index.html'
index=read(index_path)
index=index.replace('app-version" content="14.33.25"','app-version" content="14.33.26"')
index=index.replace('chegaja-v217-driver-navigation.js?v=14.33.25&recovery=143325','chegaja-v217-driver-navigation.js?v=14.33.26&recovery=143326')
index=index.replace('chegaja-v217-driver-navigation.css?v=14.33.25&recovery=143325','chegaja-v217-driver-navigation.css?v=14.33.26&recovery=143326')
leaflet_tag='<script src="/vendor/leaflet/leaflet.js?recovery=143314"></script>'
rotate_tag=leaflet_tag+'<script src="https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate.js" crossorigin="anonymous"></script>'
if 'leaflet-rotate@0.2.8' not in index:
    index=index.replace(leaflet_tag,rotate_tag,1)
write(index_path,index)

test_path='scripts/test-v14153-logo-google-maps.mjs'
test=read(test_path)
test=test.replace('14\\.33\\.25','14\\.33\\.26').replace('143325','143326').replace('ChegaJá 14.33.25:','ChegaJá 14.33.26:')
test=test.replace("assert.match(driver,/L\\.circleMarker\\(ll/);","assert.match(driver,/L\\.marker\\(ll/);")
anchor="assert.match(driver,/function maybeSpeakNavigation\\(nav\\)/);"
extra="""
assert.match(index,/leaflet-rotate@0\\.2\\.8\\/dist\\/leaflet-rotate\\.js/);
assert.match(driver,/rotate:typeof L\\.Map\\?\\.prototype\\?\\.setBearing/);
assert.match(driver,/function applyMapBearing\\(force=false\\)/);
assert.match(driver,/DeviceOrientationEvent\\.requestPermission/);
assert.match(driver,/webkitCompassHeading/);
assert.match(driver,/function drawRouteArrows\\(\\)/);
assert.match(driver,/function drawManeuvers\\(steps\\)/);
assert.match(driver,/id=\"cj217-bearing\"/);
assert.match(driverCss,/#cj217-bearing/);
assert.match(driverCss,/leaflet-tile-pane\\{filter:saturate/);
"""
if 'function applyMapBearing' not in test:
    test=test.replace(anchor,anchor+extra,1)
write(test_path,test)

print('ChegaJá 14.33.26 aplicado: heading-up, giroscópio/bússola, seta, manobras e mapa limpo.')
