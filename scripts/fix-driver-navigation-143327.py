from pathlib import Path

ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def replace_line(text,prefix,new,label):
    lines=text.splitlines()
    for i,line in enumerate(lines):
        if line.startswith(prefix):
            lines[i]=new
            return '\n'.join(lines)+('\n' if text.endswith('\n') else '')
    raise RuntimeError(f'Linha não encontrada: {label}')

js_path='public/chegaja-v217-driver-navigation.js'
css_path='public/chegaja-v217-driver-navigation.css'
index_path='public/index.html'
test_path='scripts/test-v14153-logo-google-maps.mjs'

js=read(js_path)
if 'ChegaJá 14.33.27' not in js:
    js=js.replace('/* ChegaJá 14.33.26 — navegação heading-up com bússola, seta e manobras */','/* ChegaJá 14.33.27 — navegação automática, próxima manobra e mapa limpo */',1)
    js=js.replace('__CJ_DRIVER_LEAFLET_143326__','__CJ_DRIVER_LEAFLET_143327__')

    js=replace_line(js,'function applyMapBearing(',"function applyMapBearing(force=false){if(!A.map||typeof A.map.setBearing!=='function')return;if(navigationActive())A.headingUp=true;const b=$('#cj217-bearing');if(b){b.classList.remove('north');const small=b.querySelector('small');if(small)small.textContent='AUTO'}const target=A.headingUp&&navigationActive()?effectiveHeading():0;if(target==null&&!force)return;const wanted=target==null?0:target,current=currentMapBearing(),delta=angleDelta(current,wanted);if(!force&&Math.abs(delta)<1.2)return;const next=force?wanted:normAngle(current+delta*.30);try{A.map.setBearing(next)}catch{}paintHeading();refreshRouteArrowAngles()}",'bearing automático')
    js=replace_line(js,'function toggleBearingMode(',"function toggleBearingMode(){A.headingUp=true;A.manualView=false;A.following=true;requestOrientationPermission().catch(()=>{});applyMapBearing(true);if(navigationActive())frameNavigation(true)}",'botão auto')
    js=replace_line(js,'function drawRouteArrows(',"function drawRouteArrows(){for(const m of A.routeArrows.splice(0))try{m.remove()}catch{}}",'remover setas repetidas')
    js=replace_line(js,'function drawManeuvers(',"function drawManeuvers(steps){for(const m of A.maneuverMarkers.splice(0))try{m.remove()}catch{}if(!A.map||!Array.isArray(steps))return;for(const s of steps){const loc=Array.isArray(s?.location)?point(s.location[0],s.location[1]):null,type=String(s?.maneuver_type||'');if(!valid(loc)||['depart','arrive'].includes(type))continue;const glyph=maneuverGlyph(s),icon=L.divIcon({className:'cj217-maneuver-icon',html:`<span>${glyph}</span>`,iconSize:[34,34],iconAnchor:[17,17]});A.maneuverMarkers.push(L.marker([loc.lat,loc.lng],{icon,keyboard:false,interactive:false,zIndexOffset:3200}).addTo(A.map));if(A.maneuverMarkers.length>=4)break}}",'manobras')
    js=replace_line(js,'function frameNavigation(',"function frameNavigation(force=false){if(!A.map||!valid(A.gps)||!navigationActive()||A.manualView||!A.following)return false;A.headingUp=true;const target=targetPoint();if(!valid(target))return false;const moved=!valid(A.navFrameOrigin)||distance(A.gps,A.navFrameOrigin)>18,targetChanged=!valid(A.navFrameTarget)||distance(target,A.navFrameTarget)>15;if(!force&&!moved&&!targetChanged&&Date.now()-A.navFrameAt<3500){applyMapBearing(false);return false}const d=distance(A.gps,target),zoom=d<100?18.8:d<400?18.5:18.1;A.programmatic=true;try{A.map.setView([A.gps.lat,A.gps.lng],zoom,{animate:false});applyMapBearing(force);A.navFrameAt=Date.now();A.navFrameOrigin={...A.gps};A.navFrameTarget={...target};ensureSelf();updateStops();refreshGuidance()}finally{setTimeout(()=>A.programmatic=false,120)}return true}",'câmera próxima')
    js=replace_line(js,'function maybeSpeakNavigation(',"function maybeSpeakNavigation(nav){if(!nav||!valid(A.gps))return;const targetKey=`${A.detail?.id||''}:${targetKind()}`;if(targetKey!==A.lastVoiceTarget){A.lastVoiceTarget=targetKey;A.lastVoiceText='';A.lastVoiceAt=0}if(nav.arrived){A.nextInstruction={text:targetKind()==='pickup'?'Chegou à coleta':'Chegou ao destino',meters:0,glyph:'✓'};applyMetric();speakPtBr(targetKind()==='pickup'?'Você chegou ao local da coleta.':'Você chegou ao destino da entrega.',true);return}const steps=Array.isArray(nav.route?.steps)?nav.route.steps:[];A.navSteps=steps;drawManeuvers(steps);if(!steps.length)return;let chosen=null;for(const s of steps){const type=String(s?.maneuver_type||'').toLowerCase();if(type==='depart')continue;if(type==='arrive'){if(!chosen)chosen=s;continue}chosen=s;break}if(!chosen)return;const loc=Array.isArray(chosen?.location)?point(chosen.location[0],chosen.location[1]):null,meters=valid(loc)?Math.max(0,Math.round(distance(A.gps,loc))):Math.max(0,Math.round(Number(chosen.distance_meters||0))),glyph=maneuverGlyph(chosen);let text=String(chosen.instruction||'').trim()||'Siga em frente';A.nextInstruction={text,meters,glyph};applyMetric();let spoken=text;if(meters>=40&&meters<=1600&&!/^em\\s/i.test(spoken))spoken=`Em ${meters} metros, ${spoken.charAt(0).toLowerCase()+spoken.slice(1)}`;speakPtBr(spoken)}",'próxima manobra')
    js=replace_line(js,'function applyMetric(',"function applyMetric(){const card=$('#cj199-metric'),label=$('#cj199-metric-label'),value=$('#cj199-metric-value'),hint=$('#cj199-metric-hint');if(!card)return;const action=actionFor(A.detail),navigationCard=Boolean(A.detail&&!action);card.classList.toggle('cj217-action-card',Boolean(action));card.classList.toggle('cj217-navigation-card',navigationCard);card.classList.toggle('busy',A.decision);card.disabled=A.decision;if(action){label.textContent=A.decision?'PROCESSANDO':action.label;value.textContent=A.decision?'AGUARDE…':action.text;hint.textContent=A.decision?'Não feche esta tela':action.hint}else if(A.detail){const nav=A.nextInstruction;label.textContent='NAVEGAÇÃO ATIVA';value.textContent=nav?.text?`${nav.glyph||'↑'} ${nav.text}`:statusText(A.detail.status).toUpperCase();hint.textContent=nav&&Number(nav.meters)>0?`${Math.round(nav.meters)} m • próxima manobra`:'Siga a linha azul; o sentido da marcha fica para cima'}else{label.textContent='GANHOS HOJE';value.textContent=money(A.summary?.earnings_today_cents||0);hint.textContent=`${Number(A.summary?.deliveries_today||0)} entrega(s) concluída(s) hoje`}}",'card navegação')
    write(js_path,js)

css=read(css_path)
if 'ChegaJá 14.33.27' not in css:
    css += """

/* ChegaJá 14.33.27 — navegação limpa e instrução legível */
body.cj199-driver #cj199-map .cj217-route-direction-icon{display:none!important;visibility:hidden!important}
#cj217-bearing small{color:#0d45d8!important}
#cj217-bearing span{color:#0d45d8!important}
#cj199-metric.cj217-navigation-card{min-height:104px!important;padding:13px 18px 12px!important;align-content:center!important}
#cj199-metric.cj217-navigation-card strong{font-size:clamp(24px,6.6vw,33px)!important;line-height:1.02!important;white-space:normal!important;overflow:hidden!important;text-overflow:clip!important;display:-webkit-box!important;-webkit-line-clamp:2!important;-webkit-box-orient:vertical!important;overflow-wrap:anywhere!important}
#cj199-metric.cj217-navigation-card span{font-size:13px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
body.cj199-driver #cj199-map .cj217-maneuver-icon span{width:30px!important;height:30px!important;font-size:17px!important;border-width:2px!important}
@media(max-width:390px){#cj199-metric.cj217-navigation-card{min-height:94px!important;padding:11px 14px!important}#cj199-metric.cj217-navigation-card strong{font-size:clamp(22px,6.5vw,29px)!important}}
"""
    write(css_path,css)

index=read(index_path)
index=index.replace('app-version" content="14.33.26"','app-version" content="14.33.27"')
index=index.replace('chegaja-v217-driver-navigation.js?v=14.33.26&recovery=143326','chegaja-v217-driver-navigation.js?v=14.33.27&recovery=143327')
index=index.replace('chegaja-v217-driver-navigation.css?v=14.33.26&recovery=143326','chegaja-v217-driver-navigation.css?v=14.33.27&recovery=143327')
write(index_path,index)

test=read(test_path)
test=test.replace('14\\.33\\.26','14\\.33\\.27').replace('143326','143327')
test=test.replace("assert.match(driver,/d<180\\?18\\.5/);","assert.match(driver,/d<100\\?18\\.8:d<400\\?18\\.5:18\\.1/);")
anchor="assert.match(driver,/function drawManeuvers\\(steps\\)/);"
extra="""
assert.match(driver,/function toggleBearingMode\\(\\)\\{A\\.headingUp=true/);
assert.doesNotMatch(driver,/A\\.headingUp=!A\\.headingUp/);
assert.match(driver,/if\\(type==='depart'\\)continue/);
assert.match(driver,/próxima manobra/);
assert.match(driverCss,/cj217-route-direction-icon\\{display:none!important/);
assert.match(driverCss,/cj217-navigation-card strong/);
"""
if 'A\\.headingUp=!A\\.headingUp' not in test:
    test=test.replace(anchor,anchor+extra,1)
write(test_path,test)

print('ChegaJá 14.33.27: AUTO obrigatório na navegação, card legível e somente manobras úteis sobre a rota.')
