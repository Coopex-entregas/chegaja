from pathlib import Path

js_path = Path('public/chegaja-v217-driver-navigation.js')
index_path = Path('public/index.html')
js = js_path.read_text(encoding='utf-8')
index = index_path.read_text(encoding='utf-8')

if '14.33.34' in js and '143334' in js:
    print('Áudio 14.33.34 já aplicado.')
else:
    js = js.replace('/* ChegaJá 14.33.33 — custo de combustível da Base visível ao cooperado */', '/* ChegaJá 14.33.34 — áudio de novas entregas rearmado no iPhone */', 1)
    js = js.replace('if(window.__CJ_DRIVER_LEAFLET_143333__)return;window.__CJ_DRIVER_LEAFLET_143333__=true;', 'if(window.__CJ_DRIVER_LEAFLET_143334__)return;window.__CJ_DRIVER_LEAFLET_143334__=true;', 1)

    old_media = "a.style.display='none';a.id='cj217-alarm-audio';document.body.appendChild(a);A.alarm=a;return a"
    new_media = "a.style.display='none';a.id='cj217-alarm-audio';a.dataset.soundName='Alerta ChegaJá';a.setAttribute('aria-label','Alerta ChegaJá');document.body.appendChild(a);A.alarm=a;return a"
    if old_media not in js:
        raise SystemExit('Não encontrei ensureAlarmMedia para nomear o alerta.')
    js = js.replace(old_media, new_media, 1)

    old_arm = "function installAudioArm(){if(A.audioArmBound)return;A.audioArmBound=true;const arm=e=>{unlockAudio();const start=Boolean(e.target?.closest?.('#cj199-start'));primeAlarmMedia(start&&!A.online)};document.addEventListener('pointerdown',arm,{capture:true,passive:true});document.addEventListener('touchstart',arm,{capture:true,passive:true})}"
    new_arm = "function installAudioArm(){if(A.audioArmBound)return;A.audioArmBound=true;const arm=e=>{unlockAudio();const start=Boolean(e.target?.closest?.('#cj199-start')),firstOnlineGesture=A.online&&!A.audioArmed&&!offerRequired(A.detail);primeAlarmMedia((start&&!A.online)||firstOnlineGesture)};for(const ev of['pointerdown','touchstart','click'])document.addEventListener(ev,arm,{capture:true,passive:true})}"
    if old_arm not in js:
        raise SystemExit('Não encontrei installAudioArm atual.')
    js = js.replace(old_arm, new_arm, 1)

    old_phone = "async function ring(){navigator.vibrate?.([650,70,650,70,650,180]);const media=ensureAlarmMedia();if(media){media.volume=1;media.muted=false;if(media.paused){try{const play=media.play();play?.then?.(()=>{A.audioArmed=true;A.audioBlockedNotice=false}).catch?.(()=>{A.audioArmed=false;if(!A.audioBlockedNotice){A.audioBlockedNotice=true;notice('Som bloqueado pelo celular. Toque uma vez na tela para liberar o alerta.',true)}})}catch{}}}const c=unlockAudio();if(!c)return;try{if(c.state!=='running')await c.resume()}catch{}if(c.state==='running'){phoneTone(c,0,1.15);phoneTone(c,1.28,1.15)}}"
    new_phone = "function speakOfferFallback(){try{if(!window.speechSynthesis||typeof SpeechSynthesisUtterance==='undefined')return;const u=new SpeechSynthesisUtterance('Nova entrega');u.lang='pt-BR';u.rate=1;u.pitch=1;u.volume=1;window.speechSynthesis.cancel();window.speechSynthesis.speak(u)}catch{}}\nasync function ring(){navigator.vibrate?.([650,70,650,70,650,180]);const media=ensureAlarmMedia();if(media){media.volume=1;media.muted=false;if(media.paused){try{const play=media.play();play?.then?.(()=>{A.audioArmed=true;A.audioBlockedNotice=false}).catch?.(()=>{A.audioArmed=false;speakOfferFallback();if(!A.audioBlockedNotice){A.audioBlockedNotice=true;notice('Som bloqueado pelo celular. Toque uma vez na tela para liberar o Alerta ChegaJá.',true)}})}catch{speakOfferFallback()}}}const c=unlockAudio();if(!c){if(!A.audioArmed)speakOfferFallback();return}try{if(c.state!=='running')await c.resume()}catch{}if(c.state==='running'){phoneTone(c,0,1.15);phoneTone(c,1.28,1.15)}else if(!A.audioArmed)speakOfferFallback()}"
    if old_phone not in js:
        raise SystemExit('Não encontrei ring atual.')
    js = js.replace(old_phone, new_phone, 1)

    old_mount = "await poll(true);if(A.online&&valid(A.gps))pushLocation"
    new_mount = "await poll(true);if(A.online&&!A.audioArmed)notice('Toque uma vez na tela para ativar o som das novas entregas.');if(A.online&&valid(A.gps))pushLocation"
    if old_mount not in js:
        raise SystemExit('Não encontrei o ponto de rearme no mount.')
    js = js.replace(old_mount, new_mount, 1)

    js_path.write_text(js, encoding='utf-8')

index = index.replace('content="14.33.33"', 'content="14.33.34"')
index = index.replace('/chegaja-v217-driver-navigation.js?v=14.33.33&recovery=143333', '/chegaja-v217-driver-navigation.js?v=14.33.34&recovery=143334')
index_path.write_text(index, encoding='utf-8')

print('ChegaJá 14.33.34 preparado: Alerta ChegaJá rearmado em qualquer gesto após recarga.')
