from pathlib import Path
import re

ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def replace_between(text,start,end,new,label):
    a=text.find(start)
    if a<0: raise RuntimeError(f'Início não encontrado: {label}')
    b=text.find(end,a)
    if b<0: raise RuntimeError(f'Fim não encontrado: {label}')
    return text[:a]+new+'\n'+text[b:]

# 1) Entrada do cooperado + fuso America/Sao_Paulo.
app_path='public/app.js'
app=read(app_path)
old_block="""function dateOnly(v){if(!v)return '—';const d=new Date(String(v).length===10?`${v}T12:00:00`:v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleDateString('pt-BR')}
function dateTime(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}
function timeOnly(v){return v?String(v).slice(11,16):'—'}
function isoDate(d=new Date()){const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10)}"""
new_block="""const APP_TIME_ZONE='America/Sao_Paulo';
const APP_SQL_UTC=/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?$/;
const APP_WALL_CLOCK=/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::\\d{2})?$/;
function appLocalDateParts(d){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:APP_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d),o=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${o.year}-${o.month}-${o.day}`}
function appInstant(v){const text=String(v||'').trim();if(!text)return null;if(APP_SQL_UTC.test(text))return new Date(text.replace(' ','T')+'Z');if(APP_WALL_CLOCK.test(text))return null;const d=new Date(text);return Number.isNaN(d.getTime())?null:d}
function dateOnly(v){if(!v)return '—';const text=String(v).trim();if(/^\\d{4}-\\d{2}-\\d{2}$/.test(text)){const [y,m,d]=text.split('-');return `${d}/${m}/${y}`}const wall=text.match(APP_WALL_CLOCK);if(wall)return `${wall[3]}/${wall[2]}/${wall[1]}`;const d=appInstant(text);return d?d.toLocaleDateString('pt-BR',{timeZone:APP_TIME_ZONE}):esc(v)}
function dateTime(v){if(!v)return '—';const text=String(v).trim(),wall=text.match(APP_WALL_CLOCK);if(wall)return `${wall[3]}/${wall[2]}/${wall[1]} ${wall[4]}:${wall[5]}`;const d=appInstant(text);return d?d.toLocaleString('pt-BR',{timeZone:APP_TIME_ZONE,dateStyle:'short',timeStyle:'short'}):esc(v)}
function timeOnly(v){if(!v)return '—';const text=String(v).trim(),wall=text.match(APP_WALL_CLOCK);if(wall)return `${wall[4]}:${wall[5]}`;const d=appInstant(text);return d?d.toLocaleTimeString('pt-BR',{timeZone:APP_TIME_ZONE,hour:'2-digit',minute:'2-digit',hour12:false}):String(v).slice(11,16)}
function isoDate(d=new Date()){return appLocalDateParts(d)}"""
if "const APP_TIME_ZONE='America/Sao_Paulo'" not in app:
    if old_block not in app: raise RuntimeError('Bloco central de data/hora não encontrado')
    app=app.replace(old_block,new_block,1)

old_show="const freshDriver=state.user.role==='driver'&&Boolean(state.freshLogin);const targetPage=freshDriver?'dashboard':(location.hash.slice(1)||defaultPage);if(freshDriver){state.freshLogin=false;try{history.replaceState(null,'','#dashboard')}catch{}}navigate(targetPage,false)"
new_show="const freshDriver=state.user.role==='driver'&&(Boolean(state.freshLogin)||(()=>{try{return sessionStorage.getItem('cj_driver_fresh_login')==='1'}catch{return false}})());const targetPage=freshDriver?'dashboard':(location.hash.slice(1)||defaultPage);if(freshDriver){state.freshLogin=false;state.page='dashboard';try{sessionStorage.removeItem('cj_driver_fresh_login')}catch{}try{history.replaceState(null,'','#dashboard')}catch{}}navigate(targetPage,false)"
if "sessionStorage.getItem('cj_driver_fresh_login')" not in app:
    if old_show not in app: raise RuntimeError('showApp/freshDriver não encontrado')
    app=app.replace(old_show,new_show,1)
old_login="state.token=d.token;state.freshLogin=true;localStorage.setItem('lg_token',d.token);try{history.replaceState(null,'','#dashboard')}catch{}await loadMe()"
new_login="state.token=d.token;state.freshLogin=true;state.page='dashboard';try{sessionStorage.setItem('cj_driver_fresh_login','1')}catch{}localStorage.setItem('lg_token',d.token);try{history.replaceState(null,'','#dashboard')}catch{}await loadMe()"
if "sessionStorage.setItem('cj_driver_fresh_login','1')" not in app:
    if old_login not in app: raise RuntimeError('login não encontrado')
    app=app.replace(old_login,new_login,1)
old_logout="function logout(msg=true){localStorage.removeItem('lg_token');state.token='';state.user=null;stopLocation();"
new_logout="function logout(msg=true){localStorage.removeItem('lg_token');try{sessionStorage.removeItem('cj_driver_fresh_login')}catch{}state.token='';state.user=null;stopLocation();"
if old_logout in app: app=app.replace(old_logout,new_logout,1)
write(app_path,app)

# 2) Painel: chegada só muda o estado depois da confirmação do servidor.
driver_path='public/chegaja-v217-driver-navigation.js'
driver=read(driver_path)
driver=driver.replace('/* ChegaJá 14.33.29 — câmera alinhada à rua e instrução compacta */','/* ChegaJá 14.33.31 — chegada/coleta transacional e sem coleta automática */',1)
driver=driver.replace('__CJ_DRIVER_LEAFLET_143329__','__CJ_DRIVER_LEAFLET_143331__')
manual_arrive="""async function manualArrivePickup(){if(A.decision||!A.detail?.id)return;A.decision=true;const before={...A.detail},beforeSince=A.localPickupSince;try{const current=String(A.detail.status||'');if(!['accepted','to_pickup','at_pickup'].includes(current))throw new Error('Esta entrega não está indo para a coleta.');const loc=await getPosition();let confirmed=current==='at_pickup',result=null;if(!confirmed){result=await api('/api/app/v28/driver/auto-location',{method:'POST',body:{...loc,manual:true,stage:'pickup'},timeout:8000});confirmed=String(result?.status||'')==='at_pickup';if(!confirmed){const meters=Math.round(Number(result?.distance_to_pickup_meters));throw new Error(Number.isFinite(meters)?`Você ainda está a ${meters} m da coleta. A chegada não foi registrada.`:'Não foi possível confirmar sua chegada na coleta.')}}A.detail={...A.detail,status:'at_pickup',updated_at:new Date().toISOString()};if(!A.localPickupSince)A.localPickupSince=Date.now();if(String(A.detail.delivery_type||'')!=='establishment'){await syncWait(true);if(!A.wait){try{await api(`/api/app/v16/driver/deliveries/${encodeURIComponent(A.detail.id)}/arrive`,{method:'POST',body:{stage:'pickup',...loc},timeout:6500})}catch{}await syncWait(true)}}else{A.wait=null;A.waitSyncAt=0}clearRoute();renderControls();renderSheet(true);notice('Chegada na coleta registrada. Confirme COLETA REALIZADA somente depois de retirar o pedido.');setTimeout(()=>poll(true),500)}catch(e){A.detail=before;A.localPickupSince=beforeSince;renderControls();renderSheet(true);notice(e.message||'Não foi possível registrar a chegada na coleta.',true)}finally{A.decision=false;applyMetric()}}"""
driver=replace_between(driver,'async function manualArrivePickup(){','async function manualPickup(){',manual_arrive,'manualArrivePickup')

auto_progress="""async function autoProgress(loc,force=false){if(A.decision||!A.detail?.id||A.autoBusy||document.hidden||(!force&&Date.now()-A.lastAuto<4500))return;A.lastAuto=Date.now();A.autoBusy=true;const old=String(A.detail.status||'');try{const d=await api('/api/app/v28/driver/auto-location',{method:'POST',body:loc,timeout:7000});if(d.status&&d.status!==old){A.detail={...A.detail,status:d.status,updated_at:new Date().toISOString()};if(d.status==='at_pickup'){if(!A.localPickupSince)A.localPickupSince=Date.now();if(String(A.detail.delivery_type||'')!=='establishment'){await syncWait(true);if(!A.wait){try{await api(`/api/app/v16/driver/deliveries/${encodeURIComponent(A.detail.id)}/arrive`,{method:'POST',body:{stage:'pickup',...loc},timeout:6500})}catch{}await syncWait(true)}}else{A.wait=null;A.waitSyncAt=0}notice('Você chegou à coleta. Confirme COLETA REALIZADA depois de retirar o pedido.')}updateStops();renderControls();renderSheet(true);await updateRoute(true)}if(d.arrived_delivery){A.arrivedDelivery=true;renderControls();renderSheet(true)}}catch{}finally{A.autoBusy=false}}"""
driver=replace_between(driver,'async function autoProgress(loc,force=false){','async function sendSos(){',auto_progress,'autoProgress')
write(driver_path,driver)

# 3) Backend: GPS pode marcar chegada, mas nunca coleta/saída da coleta.
v28_path='src/routes/platform-v28.ts'
v28=read(v28_path)
old="""    if(['accepted','to_pickup'].includes(String(item.status))&&distance<=gpsTolerance)next='at_pickup';
    else if(item.status==='at_pickup'&&distance>=200)next='in_route';"""
new="""    if(['accepted','to_pickup'].includes(String(item.status))&&distance<=gpsTolerance)next='at_pickup';
    // Nunca avançar at_pickup -> in_route por GPS. A coleta precisa ser confirmada explicitamente pelo cooperado."""
if old not in v28: raise RuntimeError('Transição automática at_pickup -> in_route não encontrada')
v28=v28.replace(old,new,1)
write(v28_path,v28)

# 4) Cache/versionamento.
index_path='public/index.html'
index=read(index_path)
index=index.replace('app-version" content="14.33.29"','app-version" content="14.33.31"')
index=index.replace('/app.js?v=14.33.25&recovery=143325','/app.js?v=14.33.31&recovery=143331')
index=index.replace('/chegaja-v217-driver-navigation.js?v=14.33.29&recovery=143329','/chegaja-v217-driver-navigation.js?v=14.33.31&recovery=143331')
write(index_path,index)

# 5) Regressão atualizada.
test_path='scripts/test-v14153-logo-google-maps.mjs'
test=read(test_path)
test=test.replace('assert.match(index,/app-version" content="14\\.33\\.29"/);','assert.match(index,/app-version" content="14\\.33\\.31"/);')
test=test.replace('assert.match(index,/chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.29&recovery=143329/);','assert.match(index,/chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.31&recovery=143331/);')
test=test.replace('assert.match(driver,/ChegaJá 14\\.33\\.29/);','assert.match(driver,/ChegaJá 14\\.33\\.31/);')
test=test.replace('assert.match(index,/\\/app\\.js\\?v=14\\.33\\.25&recovery=143325/);','assert.match(index,/\\/app\\.js\\?v=14\\.33\\.31&recovery=143331/);')
extra="""
assert.match(app,/APP_TIME_ZONE='America\\/Sao_Paulo'/);
assert.match(app,/APP_SQL_UTC\.test\(text\)/);
assert.match(app,/sessionStorage\.setItem\('cj_driver_fresh_login','1'\)/);
assert.match(app,/sessionStorage\.getItem\('cj_driver_fresh_login'\)/);
assert.match(driver,/async function manualArrivePickup\(\)/);
assert.match(driver,/manual:true,stage:'pickup'/);
assert.match(driver,/Confirme COLETA REALIZADA somente depois de retirar o pedido/);
assert.doesNotMatch(v28,/item\.status==='at_pickup'&&distance>=200/);
assert.match(v28,/Nunca avançar at_pickup -> in_route por GPS/);
"""
if 'Nunca avançar at_pickup -> in_route por GPS' not in test: test += extra
write(test_path,test)

print('ChegaJá 14.33.31: chegada na coleta confirmada antes da UI, estabelecimento sem erro de cronômetro e coleta nunca automática por GPS; login/fuso consolidados.')
