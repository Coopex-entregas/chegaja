from pathlib import Path


def once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'Não encontrei trecho para {label}')
    return text.replace(old, new, 1)

# 1) Backend: o GPS precisa validar exatamente a entrega exibida no app.
p = Path('src/routes/platform-v28.ts')
s = p.read_text()
s = once(
    s,
    "type Row = Record<string, any>;\n",
    "type Row = Record<string, any>;\nconst DRIVER_ARRIVAL_RADIUS_METERS=100;\n",
    'raio de chegada do cooperado',
)
s = once(
    s,
    "  const body=await bodyJson<Row>(c),lat=Number(body.latitude),lng=Number(body.longitude),accuracy=body.accuracy==null?null:Number(body.accuracy),manual=truthy(body.manual),requestedStage=cleanText(body.stage,20);",
    "  const body=await bodyJson<Row>(c),lat=Number(body.latitude),lng=Number(body.longitude),accuracy=body.accuracy==null?null:Number(body.accuracy),manual=truthy(body.manual),requestedStage=cleanText(body.stage,20),requestedDeliveryId=cleanText(body.delivery_id,80);",
    'delivery_id do GPS',
)
old_item = """  const item=await c.env.DB.prepare(`SELECT id,display_code,status,pickup_lat,pickup_lng,delivery_lat,delivery_lng,establishment_id FROM deliveries WHERE cooperative_id=? AND assigned_driver_id=? AND accepted_at IS NOT NULL AND deleted_at IS NULL AND status IN ('accepted','to_pickup','at_pickup','picked_up','in_route','problem') ORDER BY created_at LIMIT 1`).bind(auth.cooperativeId,auth.driverId).first<Row>();
  if(!item)return c.json({ok:true,status:null});
  const gpsTolerance=Math.max(100,Math.min(160,Number.isFinite(Number(accuracy))&&Number(accuracy)>0?Number(accuracy)*1.5:100));
"""
new_item = """  const activeSql=`SELECT id,display_code,status,pickup_lat,pickup_lng,delivery_lat,delivery_lng,establishment_id FROM deliveries WHERE cooperative_id=? AND assigned_driver_id=? AND accepted_at IS NOT NULL AND deleted_at IS NULL AND status IN ('accepted','to_pickup','at_pickup','picked_up','in_route','problem')`;
  const item=requestedDeliveryId
    ? await c.env.DB.prepare(`${activeSql} AND id=? LIMIT 1`).bind(auth.cooperativeId,auth.driverId,requestedDeliveryId).first<Row>()
    : await c.env.DB.prepare(`${activeSql} ORDER BY created_at LIMIT 1`).bind(auth.cooperativeId,auth.driverId).first<Row>();
  if(!item){
    if(requestedDeliveryId)return c.json({ok:false,error:'Esta entrega não está ativa para este cooperado.'},409);
    return c.json({ok:true,status:null});
  }
  const gpsTolerance=Math.max(DRIVER_ARRIVAL_RADIUS_METERS,Math.min(160,Number.isFinite(Number(accuracy))&&Number(accuracy)>0?Number(accuracy)*1.5:DRIVER_ARRIVAL_RADIUS_METERS));
"""
s = once(s, old_item, new_item, 'seleção da entrega no auto-location')
p.write_text(s)

# 2) Navegação: o raio visual de chegada deve coincidir com o mínimo aceito pelo GPS.
p = Path('src/routes/platform-v32.ts')
s = p.read_text()
s = once(s, 'const ARRIVAL_RADIUS_METERS=35;', 'const ARRIVAL_RADIUS_METERS=100;', 'raio visual de chegada')
p.write_text(s)

# 3) Frontend: todas as atualizações GPS carregam o ID da entrega atual.
p = Path('public/chegaja-v217-driver-navigation.js')
s = p.read_text()
s = s.replace('/* ChegaJá 14.33.38 — prioridade clara entre coletas e entregas */','/* ChegaJá 14.33.39 — chegada vinculada à entrega atual */',1)
s = s.replace('if(window.__CJ_DRIVER_LEAFLET_143338__)return;window.__CJ_DRIVER_LEAFLET_143338__=true;','if(window.__CJ_DRIVER_LEAFLET_143339__)return;window.__CJ_DRIVER_LEAFLET_143339__=true;',1)
s = once(
    s,
    "body:{...loc,manual:true,stage:'pickup'}",
    "body:{...loc,manual:true,stage:'pickup',delivery_id:A.detail.id}",
    'chegada manual na coleta',
)
s = once(
    s,
    "body:{...loc,manual:true,stage:'delivery'}",
    "body:{...loc,manual:true,stage:'delivery',delivery_id:A.detail.id}",
    'chegada manual na entrega',
)
s = once(
    s,
    "body:loc,timeout:7000});if(d.status&&d.status!==old)",
    "body:{...loc,delivery_id:A.detail.id},timeout:7000});if(d.status&&d.status!==old)",
    'progresso automático por GPS',
)
old_instruction = """const loc=Array.isArray(chosen?.location)?point(chosen.location[0],chosen.location[1]):null,meters=valid(loc)?Math.max(0,Math.round(distance(A.gps,loc))):Math.max(0,Math.round(Number(chosen.distance_meters||0))),glyph=maneuverGlyph(chosen);let text=String(chosen.instruction||'').trim()||'Siga em frente';A.nextInstruction={text,meters,glyph};applyMetric();let spoken=text;"""
new_instruction = """const loc=Array.isArray(chosen?.location)?point(chosen.location[0],chosen.location[1]):null,meters=valid(loc)?Math.max(0,Math.round(distance(A.gps,loc))):Math.max(0,Math.round(Number(chosen.distance_meters||0)));let glyph=maneuverGlyph(chosen),text=String(chosen.instruction||'').trim()||'Siga em frente';const chosenType=String(chosen?.maneuver_type||'').toLowerCase();if(chosenType==='arrive'&&!nav.arrived){const label=targetKind()==='pickup'?'Coleta':'Entrega';text=`${label} a ${meters} m`;glyph='↑'}A.nextInstruction={text,meters,glyph};applyMetric();let spoken=text;"""
s = once(s, old_instruction, new_instruction, 'instrução de chegada sem falso positivo')
p.write_text(s)

# 4) Cache público.
p = Path('public/index.html')
s = p.read_text()
s = s.replace('meta name="app-version" content="14.33.38"','meta name="app-version" content="14.33.39"',1)
s = s.replace('/chegaja-v217-driver-navigation.js?v=14.33.38&recovery=143338','/chegaja-v217-driver-navigation.js?v=14.33.39&recovery=143339',1)
p.write_text(s)

# 5) Regressão.
p = Path('scripts/test-v14153-logo-google-maps.mjs')
s = p.read_text()
s = s.replace('app-version\\" content=\\"14\\.33\\.38\\"','app-version\\" content=\\"14\\.33\\.39\\"')
s = s.replace('chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.38&recovery=143338','chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.39&recovery=143339')
s = s.replace('assert.match(driver,/ChegaJá 14\\.33\\.38/);','assert.match(driver,/ChegaJá 14\\.33\\.39/);')
extra = r'''
// 14.33.39 — chegada sempre vinculada à entrega que está na tela.
assert.match(v28,/DRIVER_ARRIVAL_RADIUS_METERS=100/);
assert.match(v28,/requestedDeliveryId=cleanText\(body\.delivery_id,80\)/);
assert.match(v28,/AND id=\? LIMIT 1/);
assert.match(navigation,/ARRIVAL_RADIUS_METERS=100/);
assert.match(driver,/stage:'pickup',delivery_id:A\.detail\.id/);
assert.match(driver,/stage:'delivery',delivery_id:A\.detail\.id/);
assert.match(driver,/body:\{\.\.\.loc,delivery_id:A\.detail\.id\}/);
assert.match(driver,/chosenType==='arrive'&&!nav\.arrived/);
assert.match(driver,/text=`\$\{label\} a \$\{meters\} m`/);
'''
if '14.33.39 — chegada sempre vinculada' not in s:
    s += extra
p.write_text(s)

print('14.33.39 aplicada: chegada e GPS vinculados à entrega atual, sem falso chegou.')
