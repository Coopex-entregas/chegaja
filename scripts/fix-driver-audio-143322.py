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

# ChegaJá 14.33.22
# O alerta deixa de depender somente do AudioContext. Um HTMLAudioElement com WAV
# sintetizado fica previamente iniciado/mudo após gesto do usuário. Na oferta ele
# apenas é desmutado, evitando o bloqueio de autoplay que silenciava o telefone.

js_path = 'public/chegaja-v217-driver-navigation.js'
js = read(js_path)
if 'ChegaJá 14.33.22' not in js:
    js = replace_once(js,
        '/* ChegaJá 14.33.21 — rota azul dedicada e alerta reforçado de nova entrega */',
        '/* ChegaJá 14.33.22 — áudio persistente desbloqueado pelo toque em INICIAR */',
        'versão do painel')
    js = js.replace('__CJ_DRIVER_LEAFLET_143321__', '__CJ_DRIVER_LEAFLET_143322__')
    js = replace_once(js,
        'audio:null,navTarget:null,routeRenderer:null};',
        'audio:null,navTarget:null,routeRenderer:null,alarm:null,alarmUrl:null,audioArmed:false,audioArmBound:false,audioBlockedNotice:false,lastArmTestAt:0};',
        'estado do áudio persistente')

    unlock = "function unlockAudio(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;A.audio=A.audio||new C();const c=A.audio;c.resume?.().catch?.(()=>{});if(!c.__cjPrimed){try{const o=c.createOscillator(),g=c.createGain();g.gain.value=.00001;o.frequency.value=440;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.025);c.__cjPrimed=true}catch{}}return c}catch{return null}}"
    audio_helpers = r'''function alarmWavUrl(){if(A.alarmUrl)return A.alarmUrl;try{const rate=22050,seconds=2.45,count=Math.floor(rate*seconds),buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer),put=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};put(0,'RIFF');v.setUint32(4,36+count*2,true);put(8,'WAVE');put(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,count*2,true);for(let i=0;i<count;i++){const t=i/rate,cycle=t%0.31,on=cycle<0.205,band=Math.floor(t/.31)%3,f1=[880,1220,1540][band],f2=[1320,1710,2050][band],sq=Math.sin(2*Math.PI*f1*t)>=0?1:-1,saw=2*((t*f2)%1)-1,edge=Math.min(1,Math.min(cycle,.205-cycle)*80),sample=on?Math.max(-1,Math.min(1,(.78*sq+.38*saw)*edge)):0;v.setInt16(44+i*2,Math.round(sample*32767),true)}A.alarmUrl=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));return A.alarmUrl}catch{return null}}
function ensureAlarmMedia(){if(A.alarm)return A.alarm;const src=alarmWavUrl();if(!src)return null;try{const a=new Audio();a.src=src;a.preload='auto';a.loop=true;a.playsInline=true;a.volume=1;a.muted=true;a.setAttribute('playsinline','');a.setAttribute('webkit-playsinline','');a.style.display='none';a.id='cj217-alarm-audio';document.body.appendChild(a);A.alarm=a;return a}catch{return null}}
function primeAlarmMedia(test=false){const a=ensureAlarmMedia();if(!a)return false;const now=Date.now();if(test&&now-A.lastArmTestAt<1100)return true;if(test)A.lastArmTestAt=now;if(!a.paused){A.audioArmed=true;if(test){a.volume=1;a.muted=false;setTimeout(()=>{if(A.alarm===a&&!offerRequired(A.detail))a.muted=true},360)}return true}a.volume=1;a.muted=!test;try{const p=a.play();if(p?.then)p.then(()=>{A.audioArmed=true;A.audioBlockedNotice=false;if(test){notice('Alerta sonoro ativado.');setTimeout(()=>{if(A.alarm===a&&!offerRequired(A.detail))a.muted=true},360)}}).catch(()=>{A.audioArmed=false;if(!A.audioBlockedNotice){A.audioBlockedNotice=true;notice('O celular bloqueou o som. Toque em INICIAR novamente para liberar o áudio.',true)}});else A.audioArmed=true;return true}catch{A.audioArmed=false;return false}}
function disarmAlarmMedia(){if(!A.alarm)return;try{A.alarm.muted=true;A.alarm.pause();A.alarm.currentTime=0}catch{}A.audioArmed=false}
function installAudioArm(){if(A.audioArmBound)return;A.audioArmBound=true;const arm=e=>{unlockAudio();const start=Boolean(e.target?.closest?.('#cj199-start'));primeAlarmMedia(start&&!A.online)};document.addEventListener('pointerdown',arm,{capture:true,passive:true});document.addEventListener('touchstart',arm,{capture:true,passive:true})}'''
    js = replace_once(js, unlock, unlock + '\n' + audio_helpers, 'helpers de áudio persistente')

    ring = "async function ring(){navigator.vibrate?.([650,70,650,70,650,180]);const media=ensureAlarmMedia();if(media){media.volume=1;media.muted=false;if(media.paused){try{const play=media.play();play?.then?.(()=>{A.audioArmed=true;A.audioBlockedNotice=false}).catch?.(()=>{A.audioArmed=false;if(!A.audioBlockedNotice){A.audioBlockedNotice=true;notice('Som bloqueado pelo celular. Toque uma vez na tela para liberar o alerta.',true)}})}catch{}}}const c=unlockAudio();if(!c)return;try{if(c.state!=='running')await c.resume()}catch{}if(c.state==='running'){phoneTone(c,0,1.15);phoneTone(c,1.28,1.15)}}"
    js = replace_line(js, 'async function ring()', ring, 'disparo duplo do alerta')

    stop = "function stopOfferAlert(){clearInterval(A.offerAlertTimer);A.offerAlertTimer=null;A.offerAlertCount=0;navigator.vibrate?.(0);if(A.alarm){try{A.alarm.muted=true;A.alarm.volume=1}catch{}}const host=$('#cj217-offer-screen');if(host&&!offerRequired(A.detail)){host.hidden=true;host.innerHTML=''}}"
    js = replace_line(js, 'function stopOfferAlert()', stop, 'parada do alerta')

    js = js.replace('async function toggleOnline(){unlockAudio();', 'async function toggleOnline(){unlockAudio();primeAlarmMedia(!A.online);', 1)
    js = js.replace("A.online=false;stopGps();notice('Você está offline.')", "A.online=false;stopGps();disarmAlarmMedia();notice('Você está offline.')", 1)
    js = js.replace("async function logoutDriver(){stopGps();", "async function logoutDriver(){stopGps();disarmAlarmMedia();", 1)
    js = js.replace("ensureApp(content);startGps();", "ensureApp(content);installAudioArm();startGps();primeAlarmMedia(false);", 1)
    write(js_path, js)

index_path = 'public/index.html'
index = read(index_path)
index = index.replace('app-version" content="14.33.21"', 'app-version" content="14.33.22"')
index = index.replace('chegaja-v217-driver-navigation.js?v=14.33.21&recovery=143321', 'chegaja-v217-driver-navigation.js?v=14.33.22&recovery=143322')
index = index.replace('chegaja-v217-driver-navigation.css?v=14.33.21&recovery=143321', 'chegaja-v217-driver-navigation.css?v=14.33.22&recovery=143322')
write(index_path, index)

css_path = 'public/chegaja-v217-driver-navigation.css'
css = read(css_path).replace('/* ChegaJá 14.33.21 — ÚNICA folha do painel do cooperado. */','/* ChegaJá 14.33.22 — ÚNICA folha do painel do cooperado. */',1)
write(css_path, css)

test_path = 'scripts/test-v14153-logo-google-maps.mjs'
test = read(test_path)
test = test.replace('14\\.33\\.21','14\\.33\\.22').replace('143321','143322').replace('14.33.21','14.33.22')
marker = "assert.match(driver,/setInterval\\(fire,2700\\)/);"
extra = """assert.match(driver,/function alarmWavUrl\\(\\)/);
assert.match(driver,/new Audio\\(\\)/);
assert.match(driver,/function primeAlarmMedia\\(test=false\\)/);
assert.match(driver,/installAudioArm\\(\\)/);
assert.match(driver,/primeAlarmMedia\\(!A\\.online\\)/);
assert.match(driver,/media\\.muted=false/);"""
if 'function alarmWavUrl' not in test:
    test = replace_once(test, marker, marker + '\n' + extra, 'testes de áudio persistente')
write(test_path, test)

print('ChegaJá 14.33.22 aplicado: áudio persistente armado pelo gesto do usuário.')
