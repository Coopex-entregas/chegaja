from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'Não encontrei trecho para {label}')
    return text.replace(old, new, 1)

# Backend de espera: chegada, cronômetro e geofence não podem pular etapas.
p = Path('src/routes/platform-v16.ts')
s = p.read_text()
s = s.replace("  if(delivery.delivery_type==='establishment')return c.json({ok:false,error:'Entregas de estabelecimento não possuem cobrança de tempo de espera.'},409);\n", '', 1)
s = replace_once(
    s,
    "  const distance=haversineMeters(lat,lng,targetLat,targetLng);\n  if(distance>100)return c.json({ok:false,error:`Você precisa estar a até 100 metros do local. Distância atual: ${Math.round(distance)} m.`},409);",
    "  const distance=haversineMeters(lat,lng,targetLat,targetLng),accuracy=Number(body.accuracy),arrivalRadius=Math.max(100,Math.min(160,Number.isFinite(accuracy)&&accuracy>0?accuracy*1.5:100));\n  if(distance>arrivalRadius)return c.json({ok:false,error:`Você ainda está a ${Math.round(distance)} m do local. A chegada será liberada ao entrar na área da coleta.`},409);",
    'raio de chegada com precisão do GPS',
)
s = replace_once(
    s,
    "  let free=300,rate=Number(delivery.wait_cents_per_15m??500);\n  if(stage==='pickup'){",
    "  let free=delivery.delivery_type==='establishment'?0:300,rate=delivery.delivery_type==='establishment'?0:Number(delivery.wait_cents_per_15m??500);\n  if(stage==='pickup'&&delivery.delivery_type!=='establishment'){",
    'cronômetro operacional do estabelecimento',
)
s = replace_once(
    s,
    "  const auth=tenant(c,['driver']),body=await bodyJson<Row>(c),lat=Number(body.latitude),lng=Number(body.longitude);\n  if(!Number.isFinite(lat)||!Number.isFinite(lng))return c.json({ok:false,error:'Localização inválida.'},400);\n  const session=await c.env.DB.prepare(`SELECT * FROM delivery_wait_sessions WHERE cooperative_id=? AND driver_id=? AND status='active' ORDER BY started_at DESC LIMIT 1`).bind(auth.cooperativeId,auth.driverId).first<Row>();",
    "  const auth=tenant(c,['driver']),body=await bodyJson<Row>(c),lat=Number(body.latitude),lng=Number(body.longitude),requestedDeliveryId=cleanText(body.delivery_id,100);\n  if(!Number.isFinite(lat)||!Number.isFinite(lng))return c.json({ok:false,error:'Localização inválida.'},400);\n  const session=requestedDeliveryId\n    ? await c.env.DB.prepare(`SELECT * FROM delivery_wait_sessions WHERE cooperative_id=? AND driver_id=? AND delivery_id=? AND status='active' ORDER BY started_at DESC LIMIT 1`).bind(auth.cooperativeId,auth.driverId,requestedDeliveryId).first<Row>()\n    : await c.env.DB.prepare(`SELECT * FROM delivery_wait_sessions WHERE cooperative_id=? AND driver_id=? AND status='active' ORDER BY started_at DESC LIMIT 1`).bind(auth.cooperativeId,auth.driverId).first<Row>();",
    'geofence vinculada à entrega',
)
s = replace_once(
    s,
    "  if(distance<=130||elapsed<20)return c.json({ok:true,active:true,stopped:false,distance_meters:Math.round(distance)});",
    "  if(distance<=200||elapsed<20)return c.json({ok:true,active:true,stopped:false,distance_meters:Math.round(distance)});",
    'geofence de 200 metros',
)
s = s.replace("  if(session.stage==='pickup')await c.env.DB.prepare(`UPDATE deliveries SET status='in_route',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('delivered','cancelled')`).bind(delivery.id).run();\n", '', 1)
s = replace_once(
    s,
    "  const message=`⏱️ Cronômetro de ${stageLabel} encerrado automaticamente ao sair da área. Espera cobrada: ${centsLabel(result.charge_cents)}.`;",
    "  const message=`⏱️ Cronômetro de ${stageLabel} encerrado automaticamente ao se afastar mais de 200 m. ${session.stage==='pickup'?'A coleta ainda precisa ser confirmada pelo cooperado. ':''}Espera cobrada: ${centsLabel(result.charge_cents)}.`;",
    'mensagem do geofence',
)
s = replace_once(
    s,
    "    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,session.stage==='pickup'?'in_route':delivery.status,message,auth.id),",
    "    c.env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,?,?,?)`).bind(id(),delivery.id,auth.cooperativeId,delivery.status,delivery.status,message,auth.id),",
    'histórico sem coleta automática',
)
s = s.replace("  if(snapshot.active.stage==='pickup')await c.env.DB.prepare(`UPDATE deliveries SET status='in_route',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('delivered','cancelled')`).bind(delivery.id).run();\n", '', 1)
s = replace_once(
    s,
    "  const label=snapshot.active.stage==='pickup'?'Coleta concluída':'Tempo na entrega encerrado';",
    "  const label=snapshot.active.stage==='pickup'?'Tempo na coleta encerrado':'Tempo na entrega encerrado';",
    'encerramento manual sem concluir coleta',
)
p.write_text(s)

# Frontend: ações visíveis, cronômetro confiável e rota azul persistente.
p = Path('public/chegaja-v217-driver-navigation.js')
s = p.read_text()
s = s.replace('/* ChegaJá 14.33.39 — chegada vinculada à entrega atual */','/* ChegaJá 14.33.40 — fluxo completo de coleta e rota */',1)
s = s.replace('if(window.__CJ_DRIVER_LEAFLET_143339__)return;window.__CJ_DRIVER_LEAFLET_143339__=true;','if(window.__CJ_DRIVER_LEAFLET_143340__)return;window.__CJ_DRIVER_LEAFLET_143340__=true;',1)
s = replace_once(
    s,
    "if(!A.casing)A.casing=L.polyline(ll,{color:'#fff',weight:14,opacity:.98,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-casing'}).addTo(A.map);else A.casing.setLatLngs(ll);if(!A.line)A.line=L.polyline(ll,{color:'#075dff',weight:8,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-line'}).addTo(A.map);",
    "if(!A.casing)A.casing=L.polyline(ll,{pane:'cj217-route-pane',renderer:A.routeRenderer,color:'#fff',weight:14,opacity:.98,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-casing'}).addTo(A.map);else A.casing.setLatLngs(ll);if(!A.line)A.line=L.polyline(ll,{pane:'cj217-route-pane',renderer:A.routeRenderer,color:'#075dff',weight:8,opacity:1,lineCap:'round',lineJoin:'round',interactive:false,className:'cj217-route-line'}).addTo(A.map);",
    'rota na camada dedicada',
)
old_action = "function actionFor(x){if(!x)return null;if(offerRequired(x))return{label:'NOVA ENTREGA',text:'ACEITAR ENTREGA',hint:'Toque para aceitar',action:'accept'};if(['in_route','problem'].includes(String(x.status)))return{label:'ENTREGA',text:'ENTREGAR',hint:A.arrivedDelivery?'Informe quem recebeu':'Finalize quando entregar',action:'complete'};return null}"
new_action = "function actionFor(x){if(!x)return null;if(offerRequired(x))return{label:'NOVA ENTREGA',text:'ACEITAR ENTREGA',hint:'Toque para aceitar',action:'accept'};const status=String(x.status||'');if(['accepted','to_pickup'].includes(status)){const pickup=point(x.pickup_lat,x.pickup_lng),meters=valid(A.gps)&&valid(pickup)?distance(A.gps,pickup):Infinity;if(meters<=160)return{label:'COLETA',text:'CHEGUEI NA COLETA',hint:'Toque para iniciar o contador',action:'arrivePickup'}}if(status==='at_pickup')return{label:'COLETA',text:'COLETA REALIZADA',hint:'Toque somente após retirar o pedido',action:'pickup'};if(['in_route','problem'].includes(status)&&A.arrivedDelivery)return{label:'ENTREGA',text:'ENTREGAR',hint:'Informe quem recebeu',action:'complete'};return null}\nasync function performPrimaryAction(action){if(action==='arrivePickup')return manualArrivePickup();if(action==='pickup')return manualPickup();if(action==='arriveDelivery')return manualArrive();return performAction(action)}"
s = replace_once(s, old_action, new_action, 'ações principais da coleta')
old_arrive = "async function manualArrivePickup(){if(A.decision||!A.detail?.id)return;A.decision=true;const before={...A.detail},beforeSince=A.localPickupSince;try{const current=String(A.detail.status||'');if(!['accepted','to_pickup','at_pickup'].includes(current))throw new Error('Esta entrega não está indo para a coleta.');const loc=await getPosition();let confirmed=current==='at_pickup',result=null;if(!confirmed){result=await api('/api/app/v28/driver/auto-location',{method:'POST',body:{...loc,manual:true,stage:'pickup',delivery_id:A.detail.id},timeout:8000});confirmed=String(result?.status||'')==='at_pickup';if(!confirmed){const meters=Math.round(Number(result?.distance_to_pickup_meters));throw new Error(Number.isFinite(meters)?`Você ainda está a ${meters} m da coleta. A chegada não foi registrada.`:'Não foi possível confirmar sua chegada na coleta.')}}A.detail={...A.detail,status:'at_pickup',updated_at:new Date().toISOString()};if(!A.localPickupSince)A.localPickupSince=Date.now();if(String(A.detail.delivery_type||'')!=='establishment'){await syncWait(true);if(!A.wait){try{await api(`/api/app/v16/driver/deliveries/${encodeURIComponent(A.detail.id)}/arrive`,{method:'POST',body:{stage:'pickup',...loc},timeout:6500})}catch{}await syncWait(true)}}else{A.wait=null;A.waitSyncAt=0}clearRoute();renderControls();renderSheet(true);notice('Chegada na coleta registrada. Confirme COLETA REALIZADA somente depois de retirar o pedido.');setTimeout(()=>poll(true),500)}catch(e){A.detail=before;A.localPickupSince=beforeSince;renderControls();renderSheet(true);notice(e.message||'Não foi possível registrar a chegada na coleta.',true)}finally{A.decision=false;applyMetric()}}"
new_arrive = "async function manualArrivePickup(){if(A.decision||!A.detail?.id)return;A.decision=true;const before={...A.detail},beforeSince=A.localPickupSince;try{const current=String(A.detail.status||'');if(!['accepted','to_pickup','at_pickup'].includes(current))throw new Error('Esta entrega não está indo para a coleta.');const loc=await getPosition();await api(`/api/app/v16/driver/deliveries/${encodeURIComponent(A.detail.id)}/arrive`,{method:'POST',body:{stage:'pickup',...loc},timeout:8000});A.detail={...A.detail,status:'at_pickup',updated_at:new Date().toISOString()};if(!A.localPickupSince)A.localPickupSince=Date.now();await syncWait(true);clearRoute();renderControls();renderSheet(true);notice('Chegada na coleta registrada. O contador iniciou. Toque em COLETA REALIZADA somente depois de retirar o pedido.');setTimeout(()=>poll(true),400)}catch(e){A.detail=before;A.localPickupSince=beforeSince;renderControls();renderSheet(true);notice(e.message||'Não foi possível registrar a chegada na coleta.',true)}finally{A.decision=false;applyMetric()}}"
s = replace_once(s, old_arrive, new_arrive, 'chegada manual atômica')
old_auto = "if(d.status==='at_pickup'){if(!A.localPickupSince)A.localPickupSince=Date.now();if(String(A.detail.delivery_type||'')!=='establishment'){await syncWait(true);if(!A.wait){try{await api(`/api/app/v16/driver/deliveries/${encodeURIComponent(A.detail.id)}/arrive`,{method:'POST',body:{stage:'pickup',...loc},timeout:6500})}catch{}await syncWait(true)}}else{A.wait=null;A.waitSyncAt=0}notice('Você chegou à coleta. Confirme COLETA REALIZADA depois de retirar o pedido.')}"
new_auto = "if(d.status==='at_pickup'){if(!A.localPickupSince)A.localPickupSince=Date.now();await syncWait(true);if(!A.wait){try{await api(`/api/app/v16/driver/deliveries/${encodeURIComponent(A.detail.id)}/arrive`,{method:'POST',body:{stage:'pickup',...loc},timeout:6500})}catch{}await syncWait(true)}notice('Você chegou à coleta. O contador foi iniciado. Confirme COLETA REALIZADA depois de retirar o pedido.')}"
s = replace_once(s, old_auto, new_auto, 'cronômetro na chegada automática')
needle = "if(d.arrived_delivery){A.arrivedDelivery=true;renderControls();renderSheet(true)}}catch{}finally{A.autoBusy=false}}"
replacement = "if(String(A.detail?.status)==='at_pickup'){try{const geo=await api('/api/app/v16/driver/wait/geofence',{method:'POST',body:{...loc,delivery_id:A.detail.id},timeout:5500});if(geo?.stopped){A.wait=null;A.waitSyncAt=0;renderControls();renderSheet(true);notice('Você se afastou mais de 200 m da coleta. O contador foi encerrado; confirme COLETA REALIZADA para seguir para a entrega.')}}catch{}}if(d.arrived_delivery){A.arrivedDelivery=true;renderControls();renderSheet(true)}}catch{}finally{A.autoBusy=false}}"
s = replace_once(s, needle, replacement, 'geofence do contador no aplicativo')
s = replace_once(
    s,
    "if(pts.length<2)pts=await osrm(origin,target);if(pts.length<2){",
    "if(pts.length<2)pts=await osrm(origin,target);if(pts.length<2&&targetKind()==='delivery'){const stored=normalizeGeometry(A.detail?.route_geometry);if(stored.length>=2)pts=stored}if(pts.length<2){",
    'fallback da geometria armazenada para entrega',
)
s = replace_once(
    s,
    "$('#cj199-metric').onclick=()=>{const a=actionFor(A.detail);if(a)performAction(a.action)};",
    "$('#cj199-metric').onclick=()=>{const a=actionFor(A.detail);if(a)performPrimaryAction(a.action)};",
    'ação principal do card',
)
p.write_text(s)

# Cache e testes.
p = Path('public/index.html')
s = p.read_text()
s = s.replace('meta name="app-version" content="14.33.39"','meta name="app-version" content="14.33.40"',1)
s = s.replace('/chegaja-v217-driver-navigation.js?v=14.33.39&recovery=143339','/chegaja-v217-driver-navigation.js?v=14.33.40&recovery=143340',1)
p.write_text(s)

p = Path('scripts/test-v14153-logo-google-maps.mjs')
s = p.read_text()
s = s.replace('14\\.33\\.39','14\\.33\\.40')
s = s.replace('recovery=143339','recovery=143340')
extra = r'''
// 14.33.40 — fluxo completo da coleta, cronômetro e rota.
assert.match(v16,/distance<=200\|\|elapsed<20/);
assert.doesNotMatch(v16,/snapshot\.active\.stage==='pickup'\)await c\.env\.DB\.prepare\(`UPDATE deliveries SET status='in_route'/);
assert.match(v16,/delivery\.delivery_type==='establishment'\?0:300/);
assert.match(driver,/text:'CHEGUEI NA COLETA'/);
assert.match(driver,/text:'COLETA REALIZADA'/);
assert.match(driver,/performPrimaryAction/);
assert.match(driver,/delivery_id:A\.detail\.id/);
assert.match(driver,/pane:'cj217-route-pane'/);
assert.match(driver,/targetKind\(\)==='delivery'.*route_geometry/);
'''
if '14.33.40 — fluxo completo da coleta' not in s:
    s += extra
p.write_text(s)

print('14.33.40 aplicada: chegada, contador, coleta explícita, geofence 200 m e rota azul persistente.')
