from pathlib import Path

ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def must_replace(text,old,new,label):
    if old not in text: raise RuntimeError(f'Trecho não encontrado: {label}')
    return text.replace(old,new,1)

# Painel do cooperado: mostrar custo estimado de combustível usando a configuração da Base.
driver_path='public/chegaja-v217-driver-navigation.js'
driver=read(driver_path)
driver=must_replace(driver,'/* ChegaJá 14.33.32 — rota azul somente por ruas; sem linha reta de fallback */','/* ChegaJá 14.33.33 — custo de combustível da Base visível ao cooperado */','versão driver')
driver=driver.replace('__CJ_DRIVER_LEAFLET_143332__','__CJ_DRIVER_LEAFLET_143333__')

helper="""function fuelEstimate(x,totalMetersOverride=null){const kmPerLiter=Math.max(0,Number(x?.fuel_km_per_liter||0)),priceCents=Math.max(0,Number(x?.fuel_price_cents||0)),derivedMeters=Math.max(0,Number(x?.total_distance_meters||0),Number(x?.distance_meters||0)+Number(x?.distance_to_pickup_meters||x?.displacement_distance_meters||0)),meters=Math.max(0,Number(totalMetersOverride??derivedMeters)||0),server=x?.fuel_cost_cents==null?null:Number(x.fuel_cost_cents),calculated=kmPerLiter>0&&priceCents>0&&meters>0?Math.round((meters/1000/kmPerLiter)*priceCents):null,cents=Number.isFinite(calculated)?calculated:(Number.isFinite(server)&&server>=0?server:null);return{cents,kmPerLiter,priceCents,meters,configured:kmPerLiter>0&&priceCents>0}}
function fuelReference(f){if(!f?.configured)return'Configuração da Base indisponível';const km=Number.isInteger(f.kmPerLiter)?String(f.kmPerLiter):f.kmPerLiter.toFixed(1).replace('.',',');return`${km} km/L • ${money(f.priceCents)}/L`}
"""
if 'function fuelEstimate(' not in driver:
    driver=must_replace(driver,'function renderOfferScreen(){',helper+'function renderOfferScreen(){','helper combustível')

driver=must_replace(
    driver,
    "establishment=String(x.establishment_name||x.base_name||x.location_name||'').trim();host.hidden=false;",
    "establishment=String(x.establishment_name||x.base_name||x.location_name||'').trim(),fuel=fuelEstimate(x,totalMeters);host.hidden=false;",
    'fuel no offer'
)

offer_old="<div><small>PAGAMENTO</small><strong>${esc(String(x.payment_method||'—').toUpperCase())}</strong></div></section>"
offer_new="<div><small>PAGAMENTO</small><strong>${esc(String(x.payment_method||'—').toUpperCase())}</strong></div><div class=\"cj217-fuel-stat\"><small>COMBUSTÍVEL EST.</small><strong>${fuel.cents==null?'—':money(fuel.cents)}</strong><span>${esc(fuelReference(fuel))}</span></div></section>"
driver=must_replace(driver,offer_old,offer_new,'combustível na oferta')

sheet_anchor="delivery=['picked_up','in_route','problem'].includes(String(x.status));let buttons='';"
driver=must_replace(driver,sheet_anchor,"delivery=['picked_up','in_route','problem'].includes(String(x.status)),fuel=fuelEstimate(x);let buttons='';",'fuel no sheet')

sheet_old="<span><small>TEMPO</small><b>${Math.max(1,Math.round(Number(x.duration_seconds||0)/60))} min</b></span></div>"
sheet_new="<span><small>TEMPO</small><b>${Math.max(1,Math.round(Number(x.duration_seconds||0)/60))} min</b></span><span class=\"cj217-fuel-value\"><small>COMBUSTÍVEL EST.</small><b>${fuel.cents==null?'—':money(fuel.cents)}</b><em>${esc(fuelReference(fuel))}</em></span></div>"
driver=must_replace(driver,sheet_old,sheet_new,'combustível no andamento')
write(driver_path,driver)

# CSS: destacar sem poluir o painel.
css_path='public/chegaja-v217-driver-navigation.css'
css=read(css_path)
css=css.replace('/* ChegaJá 14.33.25 — ÚNICA folha do painel do cooperado. */','/* ChegaJá 14.33.33 — ÚNICA folha do painel do cooperado. */',1)
css_extra="""

/* ChegaJá 14.33.33 — estimativa de combustível do cooperado */
.cj217-offer-stats .cj217-fuel-stat{background:#eefaf2!important;border:1px solid #c9ead4!important}
.cj217-offer-stats .cj217-fuel-stat strong{color:#14753b!important}
.cj217-offer-stats .cj217-fuel-stat span{font-size:9px!important;line-height:1.25!important;color:#52705e!important;font-weight:750!important;overflow-wrap:anywhere!important}
.cj217-values>span.cj217-fuel-value{grid-column:1/-1;background:#eaf8ef;border:1px solid #c8e8d3}
.cj217-values .cj217-fuel-value b{color:#14753b;font-size:15px}
.cj217-values .cj217-fuel-value em{font-style:normal;font-size:9px;line-height:1.25;color:#567164;font-weight:750;white-space:normal;overflow-wrap:anywhere}
"""
if 'ChegaJá 14.33.33 — estimativa de combustível' not in css:
    css += css_extra
write(css_path,css)

# Cache/versionamento.
index_path='public/index.html'
index=read(index_path)
index=must_replace(index,'app-version" content="14.33.32"','app-version" content="14.33.33"','versão index')
index=must_replace(index,'/chegaja-v217-driver-navigation.js?v=14.33.32&recovery=143332','/chegaja-v217-driver-navigation.js?v=14.33.33&recovery=143333','cache js')
index=must_replace(index,'/chegaja-v217-driver-navigation.css?v=14.33.29&recovery=143329','/chegaja-v217-driver-navigation.css?v=14.33.33&recovery=143333','cache css')
write(index_path,index)

# Regressão.
test_path='scripts/test-v14153-logo-google-maps.mjs'
test=read(test_path)
test=test.replace('assert.match(index,/app-version" content="14\\.33\\.32"/);','assert.match(index,/app-version" content="14\\.33\\.33"/);',1)
test=test.replace('assert.match(index,/chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.32&recovery=143332/);','assert.match(index,/chegaja-v217-driver-navigation\\.js\\?v=14\\.33\\.33&recovery=143333/);',1)
test=test.replace('assert.match(index,/chegaja-v217-driver-navigation\\.css\\?v=14\\.33\\.29&recovery=143329/);','assert.match(index,/chegaja-v217-driver-navigation\\.css\\?v=14\\.33\\.33&recovery=143333/);',1)
test=test.replace('assert.match(driver,/ChegaJá 14\\.33\\.32/);','assert.match(driver,/ChegaJá 14\\.33\\.33/);',1)
extra="""

assert.match(driver,/function fuelEstimate\\(x,totalMetersOverride=null\\)/);
assert.match(driver,/fuel_km_per_liter/);
assert.match(driver,/fuel_price_cents/);
assert.match(driver,/fuel_cost_cents/);
assert.match(driver,/COMBUSTÍVEL EST\\./);
assert.match(driver,/fuelReference\\(fuel\\)/);
assert.match(driverCss,/cj217-fuel-stat/);
assert.match(driverCss,/cj217-fuel-value/);
assert.match(v28,/fuelCostCents/);
assert.match(v28,/totalDistance\\/1000\\/kmPerLiter/);
"""
if 'assert.match(driver,/function fuelEstimate' not in test:
    test += extra
write(test_path,test)

print('ChegaJá 14.33.33: custo estimado de combustível exibido antes do aceite e durante a entrega, usando preço/litro e km/L configurados na Base.')
