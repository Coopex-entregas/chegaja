from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'Não encontrei alvo para {label}')
    return text.replace(old, new, 1)

# 1) Áudio imediato no painel do cooperado.
p='public/chegaja-v217-driver-navigation.js'
s=read(p)
s=s.replace('/* ChegaJá 14.33.34 — áudio de novas entregas rearmado no iPhone */','/* ChegaJá 14.33.35 — alerta instantâneo e combustível global */')
s=s.replace('if(window.__CJ_DRIVER_LEAFLET_143334__)return;window.__CJ_DRIVER_LEAFLET_143334__=true;','if(window.__CJ_DRIVER_LEAFLET_143335__)return;window.__CJ_DRIVER_LEAFLET_143335__=true;')
state_old="audioBlockedNotice:false,lastArmTestAt:0,navFrameAt:0"
state_new="audioBlockedNotice:false,lastArmTestAt:0,instantAlarmSource:null,instantAlarmGain:null,instantAlarmCtx:null,navFrameAt:0"
s=replace_once(s,state_old,state_new,'estado do áudio instantâneo')

anchor="function disarmAlarmMedia(){if(!A.alarm)return;try{A.alarm.muted=true;A.alarm.pause();A.alarm.currentTime=0}catch{}A.audioArmed=false}"
instant=r'''function ensureInstantAlarmBus(test=false){
 const c=unlockAudio();if(!c||c.state!=='running')return false;
 try{
  if(!A.instantAlarmSource||!A.instantAlarmGain||A.instantAlarmCtx!==c){
   const rate=Math.max(22050,Math.round(c.sampleRate||44100)),seconds=.84,count=Math.floor(rate*seconds),buffer=c.createBuffer(1,count,rate),data=buffer.getChannelData(0);
   for(let i=0;i<count;i++){
    const t=i/rate,cycle=t%.21,on=cycle<.155,edge=Math.min(1,Math.min(cycle,.155-cycle)*110),band=Math.floor(t/.21)%3,f1=[920,1260,1580][band],f2=[1380,1780,2140][band],sq=Math.sin(2*Math.PI*f1*t)>=0?1:-1,saw=2*((t*f2)%1)-1;
    data[i]=on?Math.max(-1,Math.min(1,(.76*sq+.34*saw)*edge)):0;
   }
   const source=c.createBufferSource(),gain=c.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=0;source.connect(gain);gain.connect(c.destination);source.start();source.onended=()=>{if(A.instantAlarmSource===source){A.instantAlarmSource=null;A.instantAlarmGain=null;A.instantAlarmCtx=null}};A.instantAlarmSource=source;A.instantAlarmGain=gain;A.instantAlarmCtx=c;
  }
  A.audioArmed=true;
  if(test){const g=A.instantAlarmGain.gain,t=c.currentTime;g.cancelScheduledValues(t);g.setValueAtTime(.88,t);g.setValueAtTime(0,t+.32);notice('Alerta sonoro ativado.');}
  return true;
 }catch{return false}
}
function setInstantAlarm(active){const c=A.instantAlarmCtx,g=A.instantAlarmGain?.gain;if(!c||!g||c.state!=='running')return false;try{const t=c.currentTime;g.cancelScheduledValues(t);g.setValueAtTime(active?.92:0,t);return true}catch{return false}}
function stopInstantAlarmBus(){setInstantAlarm(false);try{A.instantAlarmSource?.stop()}catch{}A.instantAlarmSource=null;A.instantAlarmGain=null;A.instantAlarmCtx=null}
function disarmAlarmMedia(){stopInstantAlarmBus();if(A.alarm){try{A.alarm.muted=true;A.alarm.pause();A.alarm.currentTime=0}catch{}}A.audioArmed=false}'''
s=replace_once(s,anchor,instant,'barramento de áudio instantâneo')

prime_old="function primeAlarmMedia(test=false){const a=ensureAlarmMedia();if(!a)return false;"
prime_new="function primeAlarmMedia(test=false){const instant=ensureInstantAlarmBus(test);const a=ensureAlarmMedia();if(!a)return instant;"
s=replace_once(s,prime_old,prime_new,'prime do áudio')

ring_old="async function ring(){navigator.vibrate?.([650,70,650,70,650,180]);const media=ensureAlarmMedia();"
ring_new="async function ring(){navigator.vibrate?.([650,70,650,70,650,180]);setInstantAlarm(true);const media=ensureAlarmMedia();"
s=replace_once(s,ring_old,ring_new,'ring instantâneo')

stop_old="function stopOfferAlert(){clearInterval(A.offerAlertTimer);A.offerAlertTimer=null;A.offerAlertCount=0;navigator.vibrate?.(0);if(A.alarm){"
stop_new="function stopOfferAlert(){clearInterval(A.offerAlertTimer);A.offerAlertTimer=null;A.offerAlertCount=0;navigator.vibrate?.(0);setInstantAlarm(false);if(A.alarm){"
s=replace_once(s,stop_old,stop_new,'parada do alerta instantâneo')

# Poll mais rápido para a oferta chegar ao painel e ao som sem atraso perceptível.
s=s.replace("A.pollTimer=setInterval(()=>poll(false),6000)","A.pollTimer=setInterval(()=>poll(false),2500)")
write(p,s)

# 2) Combustível global e dinâmico em entregas antigas e novas.
p='src/routes/platform-v28.ts'
s=read(p)
old_km="""COALESCE(NULLIF(b.fuel_km_per_liter,0),(SELECT NULLIF(bx.fuel_km_per_liter,0) FROM bases bx
        WHERE bx.cooperative_id=d.cooperative_id AND bx.active=1 AND bx.deleted_at IS NULL AND COALESCE(bx.fuel_km_per_liter,0)>0
        ORDER BY CASE WHEN bx.id=d.base_id THEN 0 ELSE 1 END,bx.name LIMIT 1)) fuel_km_per_liter,"""
new_km="""COALESCE(NULLIF(b.fuel_km_per_liter,0),(SELECT NULLIF(bx.fuel_km_per_liter,0) FROM bases bx
        WHERE bx.cooperative_id=d.cooperative_id AND bx.deleted_at IS NULL AND COALESCE(bx.fuel_km_per_liter,0)>0 AND COALESCE(bx.fuel_price_cents,0)>0
        ORDER BY CASE WHEN bx.id=d.base_id THEN 0 ELSE 1 END,datetime(COALESCE(bx.updated_at,bx.created_at)) DESC,bx.name LIMIT 1),
        (SELECT NULLIF(cx.fuel_km_per_liter,0) FROM cooperatives cx WHERE cx.id=d.cooperative_id)) fuel_km_per_liter,"""
s=replace_once(s,old_km,new_km,'km/L global')
old_price="""COALESCE(NULLIF(b.fuel_price_cents,0),(SELECT NULLIF(bx.fuel_price_cents,0) FROM bases bx
        WHERE bx.cooperative_id=d.cooperative_id AND bx.active=1 AND bx.deleted_at IS NULL AND COALESCE(bx.fuel_price_cents,0)>0
        ORDER BY CASE WHEN bx.id=d.base_id THEN 0 ELSE 1 END,bx.name LIMIT 1)) fuel_price_cents,"""
new_price="""COALESCE(NULLIF(b.fuel_price_cents,0),(SELECT NULLIF(bx.fuel_price_cents,0) FROM bases bx
        WHERE bx.cooperative_id=d.cooperative_id AND bx.deleted_at IS NULL AND COALESCE(bx.fuel_km_per_liter,0)>0 AND COALESCE(bx.fuel_price_cents,0)>0
        ORDER BY CASE WHEN bx.id=d.base_id THEN 0 ELSE 1 END,datetime(COALESCE(bx.updated_at,bx.created_at)) DESC,bx.name LIMIT 1),
        (SELECT NULLIF(cx.fuel_price_cents,0) FROM cooperatives cx WHERE cx.id=d.cooperative_id)) fuel_price_cents,"""
s=replace_once(s,old_price,new_price,'preço global do combustível')
write(p,s)

# 3) Ao salvar precificação da Base, espelhar combustível na cooperativa (regra global).
p='src/routes/platform-v16.ts'
s=read(p)
old="""platformV16Routes.put('/v16/base/:id/pricing',async c=>{const auth=tenant(c,['cooperative_admin']);const base=await baseFor(c,auth,c.req.param('id')),body=await bodyJson<Row>(c);await c.env.DB.prepare(`UPDATE bases SET minimum_fee_cents=?,rate_per_km_cents=?,fuel_km_per_liter=?,fuel_price_cents=?,displacement_rate_cents_per_km=?,return_percent=?,cancellation_displacement_multiplier=?,pickup_free_seconds=?,delivery_free_seconds=?,wait_cents_per_15m=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(Math.max(0,toCents(body.minimum_fee)),Math.max(0,toCents(body.rate_per_km)),Math.max(.1,Number(body.fuel_km_per_liter||35)),Math.max(0,toCents(body.fuel_price)),Math.max(0,toCents(body.displacement_rate_per_km)),Math.max(0,Number(body.return_percent||50)),Math.max(0,Number(body.cancellation_displacement_multiplier||2)),Math.max(0,Math.round(Number(body.pickup_free_minutes||0)*60)),Math.max(0,Math.round(Number(body.delivery_free_minutes||0)*60)),Math.max(0,toCents(body.wait_value_15m)),base.id).run();return c.json({ok:true});});"""
new="""platformV16Routes.put('/v16/base/:id/pricing',async c=>{const auth=tenant(c,['cooperative_admin']);const base=await baseFor(c,auth,c.req.param('id')),body=await bodyJson<Row>(c),fuelKm=Math.max(.1,Number(body.fuel_km_per_liter||35)),fuelPrice=Math.max(0,toCents(body.fuel_price));await c.env.DB.batch([c.env.DB.prepare(`UPDATE bases SET minimum_fee_cents=?,rate_per_km_cents=?,fuel_km_per_liter=?,fuel_price_cents=?,displacement_rate_cents_per_km=?,return_percent=?,cancellation_displacement_multiplier=?,pickup_free_seconds=?,delivery_free_seconds=?,wait_cents_per_15m=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(Math.max(0,toCents(body.minimum_fee)),Math.max(0,toCents(body.rate_per_km)),fuelKm,fuelPrice,Math.max(0,toCents(body.displacement_rate_per_km)),Math.max(0,Number(body.return_percent||50)),Math.max(0,Number(body.cancellation_displacement_multiplier||2)),Math.max(0,Math.round(Number(body.pickup_free_minutes||0)*60)),Math.max(0,Math.round(Number(body.delivery_free_minutes||0)*60)),Math.max(0,toCents(body.wait_value_15m)),base.id),c.env.DB.prepare(`UPDATE cooperatives SET fuel_km_per_liter=?,fuel_price_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(fuelKm,fuelPrice,auth.cooperativeId)]);return c.json({ok:true,fuel_km_per_liter:fuelKm,fuel_price_cents:fuelPrice});});"""
s=replace_once(s,old,new,'sincronização global da precificação')
write(p,s)

# 4) Cache/versionamento.
p='public/index.html'
s=read(p)
s=s.replace('meta name="app-version" content="14.33.34"','meta name="app-version" content="14.33.35"')
s=s.replace('/chegaja-v217-driver-navigation.js?v=14.33.34&recovery=143334','/chegaja-v217-driver-navigation.js?v=14.33.35&recovery=143335')
write(p,s)

# 5) Atualizar teste consolidado para a versão atual e novas garantias.
p='scripts/test-v14153-logo-google-maps.mjs'
s=read(p)
s=s.replace('14\\.33\\.33','14\\.33\\.35')
s=s.replace('143333','143335')
s=s.replace("assert.match(driver,/setInterval\\(fire,2700\\)/);\nassert.match(driver,/function alarmWavUrl\\(\\)/);", "assert.match(driver,/setInterval\\(fire,2700\\)/);\nassert.match(driver,/function ensureInstantAlarmBus\\(test=false\\)/);\nassert.match(driver,/function setInstantAlarm\\(active\\)/);\nassert.match(driver,/A\\.pollTimer=setInterval\\(\\(\\)=>poll\\(false\\),2500\\)/);\nassert.match(driver,/function alarmWavUrl\\(\\)/);")
s += "\nassert.match(v28,/SELECT NULLIF\\(cx\\.fuel_km_per_liter,0\\) FROM cooperatives/);\nassert.match(v28,/COALESCE\\(bx\\.fuel_price_cents,0\\)>0/);\n"
write(p,s)

# Sanidade final.
checks={
 'public/chegaja-v217-driver-navigation.js':['14.33.35','ensureInstantAlarmBus','setInstantAlarm(true)','poll(false),2500'],
 'src/routes/platform-v28.ts':['FROM cooperatives cx','fuel_price_cents,0)>0'],
 'src/routes/platform-v16.ts':['UPDATE cooperatives SET fuel_km_per_liter'],
 'public/index.html':['14.33.35','recovery=143335'],
}
for path,needles in checks.items():
    text=read(path)
    for needle in needles:
        if needle not in text: raise SystemExit(f'Validação falhou: {needle} em {path}')
print('ChegaJá 14.33.35 aplicado: áudio instantâneo + combustível global.')
