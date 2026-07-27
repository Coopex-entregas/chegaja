/* ===== ligerim-overrides.js ===== */
/* Ligerim 4.0 — módulos operacionais, financeiros e aplicativo do cliente */
Object.assign(statusText,{pending:'Pendente',approved:'Aprovado',rejected:'Recusado',closed:'Fechado',draft:'Rascunho',offered:'Disponível',checkout:'Check-out',checkin:'Check-in',converted:'Convertido',credit:'Crédito',debit:'Débito'});

const lg={customerToken:localStorage.getItem('ligerim_customer_token')||'',customer:null,quote:null,catalog:null,trackingMap:null,routeMap:null};
const km=v=>`${(Number(v||0)/1000).toLocaleString('pt-BR',{maximumFractionDigits:2})} km`;
const mins=v=>`${Math.max(1,Math.round(Number(v||0)/60))} min`;
const inputMoney=c=>Number(c||0)/100;
const copyText=async t=>{try{await navigator.clipboard.writeText(t);toast('Copiado para a área de transferência.')}catch{prompt('Copie o conteúdo:',t)}};
function addressLine(x,prefix=''){return [x[`${prefix}address`],x[`${prefix}neighborhood`]].filter(Boolean).join(' • ')}
function serviceChecks(items,selected=[]){return `<div class="full service-grid">${items.map(s=>`<label class="service-option"><input type="checkbox" name="service_ids[]" value="${esc(s.id)}" ${selected.includes(s.id)?'checked':''}><span><strong>${esc(s.name)}</strong><small>${esc(s.description||'')}${s.add_cents?` • +${money(s.add_cents)}`:''}</small></span></label>`).join('')||'<span class="muted">Nenhum serviço adicional cadastrado.</span>'}</div>`}
function routeSummary(q){return `<div class="route-summary"><div><small>Distância pela rota</small><strong>${km(q.distance_meters)}</strong></div><div><small>Tempo estimado</small><strong>${mins(q.duration_seconds)}</strong></div><div><small>Serviços adicionais</small><strong>${money(q.services_cents)}</strong></div><div><small>Valor da entrega</small><strong>${money(q.charge_cents)}</strong></div></div>`}
function renderLineMap(id,geometry=[],markers=[]){setTimeout(()=>{const el=document.getElementById(id);if(!el||typeof L==='undefined')return;const map=L.map(id);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);const pts=(geometry||[]).map(p=>[Number(p[0]),Number(p[1])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));if(pts.length){L.polyline(pts,{weight:5,opacity:.8}).addTo(map);map.fitBounds(pts,{padding:[28,28]})}else map.setView([-5.7945,-35.211],12);markers.forEach(m=>{if(m.lat!=null&&m.lng!=null)L.marker([m.lat,m.lng]).addTo(map).bindPopup(m.label||'Local')});},40)}
function parseGeometry(v){if(Array.isArray(v))return v;try{return JSON.parse(v||'[]')}catch{return[]}}
async function lgBase(force=false){const key=state.user?.cooperative_id||'tenant';if(!force&&state.cache.lgBaseKey===key)return state.cache;const role=state.user.role;const requests=[];if(['cooperative_admin','dispatcher'].includes(role))requests.push(api('/api/app/establishments').catch(()=>({items:[]})),api('/api/app/drivers').catch(()=>({items:[]})),api('/api/app/contracts').catch(()=>({items:[]})),api('/api/app/shift-templates').catch(()=>({items:[]})));else requests.push(Promise.resolve({items:[]}),Promise.resolve({items:[]}),Promise.resolve({items:[]}),Promise.resolve({items:[]}));requests.push(api('/api/app/tenant/bases').catch(()=>({items:[]})),api('/api/app/tenant/services').catch(()=>({items:[]})));const [e,d,c,s,b,sv]=await Promise.all(requests);Object.assign(state.cache,{lgBaseKey:key,establishments:e.items||[],drivers:d.items||[],contracts:c.items||[],shifts:s.items||[],bases:b.items||[],services:sv.items||[]});return state.cache}
function clearTenantCache(){state.cache.baseKey='';state.cache.lgBaseKey=''}

/* MASTER: apenas cooperativas, indicadores e auditoria */
pages.dashboard=async()=>{
 if(state.user.role==='platform_admin')return masterDashboard();
 const d=await api('/api/app/tenant/overview'),x=d.data||{};
 if(state.user.role==='cooperative_admin'||state.user.role==='dispatcher'){
   const active=await api('/api/app/tenant/deliveries?status=new').catch(()=>({items:[]}));
   $('#page-content').innerHTML=cards([{icon:'♟',value:x.drivers_active||0,label:'Cooperados ativos'},{icon:'●',value:x.drivers_online||0,label:'Cooperados online'},{icon:'▤',value:x.establishments||0,label:'Estabelecimentos'},{icon:'➜',value:x.active_deliveries||0,label:'Entregas em andamento'},{icon:'✓',value:x.deliveries_today||0,label:'Pedidos de hoje'},{icon:'＄',value:money(x.month_volume_cents),label:'Volume no mês'},{icon:'◈',value:money(x.month_profit_cents),label:'Resultado da cooperativa'}])+panel('Ações rápidas',`<div class="quick-actions"><button class="quick-action" data-go="deliveries"><strong>Central de entregas</strong><span>Atribuir pedidos e acompanhar rotas.</span></button><button class="quick-action" data-go="schedules"><strong>Montar escalas</strong><span>Organizar cooperados por contrato ou base.</span></button><button class="quick-action" data-go="closings"><strong>Fechamento semanal</strong><span>Apurar segunda a domingo.</span></button></div>`)+panel('Pedidos aguardando atribuição',table([{label:'Pedido',render:r=>`<strong>${esc(r.display_code||r.id)}</strong>`},{label:'Origem',render:r=>esc(r.establishment_name||r.base_name||'')},{label:'Cliente',key:'customer_name'},{label:'Entrega',key:'delivery_address',wrap:true},{label:'Valor',render:r=>money(r.charge_cents)}],active.items||[]));$$('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));return;
 }
 if(state.user.role==='establishment'){
   const dl=await api('/api/app/tenant/deliveries');
   $('#page-content').innerHTML=cards([{icon:'➜',value:x.active||0,label:'Entregas ativas'},{icon:'✓',value:x.deliveries_today||0,label:'Pedidos hoje'},{icon:'＄',value:money(x.month_cents),label:'Movimento do mês'}])+panel('Atalhos',`<div class="quick-actions"><button class="quick-action" data-go="deliveries"><strong>Lançar entrega de balcão</strong><span>O número é gerado automaticamente.</span></button><button class="quick-action" data-go="integrations"><strong>Integrar meu sistema</strong><span>API e retorno por webhook.</span></button><button class="quick-action" data-go="tracking"><strong>Acompanhar cooperados</strong><span>Veja somente os que atendem seu estabelecimento.</span></button></div>`)+panel('Últimas entregas',deliveryTable(dl.items?.slice(0,8)||[],false));$$('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));return;
 }
 const dl=await api('/api/app/tenant/deliveries');
 $('#page-content').innerHTML=cards([{icon:'➜',value:x.active||0,label:'Entregas ativas'},{icon:'✓',value:x.deliveries_today||0,label:'Entregas hoje'},{icon:'＄',value:money(x.available_cents),label:'Valor disponível'},{icon:'▦',value:x.schedules_week||0,label:'Escalas próximas'}])+panel('Meu trabalho agora',deliveryTable(dl.items?.filter(r=>!['delivered','cancelled'].includes(r.status)).slice(0,8)||[],true));bindLigerimDeliveryActions(dl.items||[]);
};
async function masterDashboard(){
 const today=isoDate(),first=`${today.slice(0,8)}01`,from=state.cache.masterFrom||first,to=state.cache.masterTo||today,coop=state.selectedCoop||'';
 const d=await api(`/api/app/platform/overview${query({from,to,cooperative_id:coop})}`),t=d.totals||{};
 const tools=`<div class="toolbar"><input id="master-from" type="date" value="${from}"><input id="master-to" type="date" value="${to}"><button id="master-apply" class="btn primary">Aplicar</button></div>`;
 $('#page-content').innerHTML=cards([{icon:'◉',value:t.cooperatives||0,label:'Cooperativas selecionadas'},{icon:'♟',value:t.drivers||0,label:'Total de cooperados'},{icon:'●',value:t.active||0,label:'Cooperados ativos'},{icon:'＄',value:money(t.volume_cents),label:'Volume das entregas'},{icon:'◈',value:money(t.profit_cents),label:'Resultado das cooperativas'}])+panel('Visão por cooperativa',table([{label:'Cooperativa',key:'name'},{label:'Status',render:r=>badge(r.status)},{label:'Cooperados',key:'drivers_total'},{label:'Ativos',key:'drivers_active'},{label:'Estabelecimentos',key:'establishments_active'},{label:'Entregas',key:'deliveries_period'},{label:'Volume',render:r=>money(r.volume_cents)},{label:'Resultado',render:r=>`<strong>${money(r.profit_cents)}</strong>`}],d.items||[]),tools);
 $('#master-apply').onclick=()=>{state.cache.masterFrom=$('#master-from').value;state.cache.masterTo=$('#master-to').value;pages.dashboard()};
}

pages.cooperatives=async()=>{const d=await api('/api/app/platform/cooperatives');$('#page-content').innerHTML=panel('Cooperativas da plataforma',table([{label:'Cooperativa',render:r=>`<strong>${esc(r.name)}</strong><br><small>${esc(r.legal_name||'')}</small>`},{label:'CNPJ',key:'cnpj'},{label:'Administrador',render:r=>`<strong>${esc(r.admin_name||'—')}</strong><br><small>${esc(r.admin_email||'')}</small>`},{label:'Contato',render:r=>`${esc(r.phone||'—')}<br><small>${esc(r.email||'')}</small>`},{label:'Status',render:r=>badge(r.status)}],d.items,r=>`<button class="table-action" data-edit-coop="${r.id}">Editar</button>`),'<button class="btn primary" id="new-coop">Nova cooperativa</button>');$('#new-coop').onclick=()=>ligerimCoopForm();$$('[data-edit-coop]').forEach(b=>b.onclick=()=>ligerimCoopForm(d.items.find(x=>x.id===b.dataset.editCoop)))};
function ligerimCoopForm(item={}){openModal(item.id?'Editar cooperativa':'Cadastrar cooperativa',`<form id="lg-coop-form" class="form-grid">${field('Nome da cooperativa','name',item.name,'text','required')}${field('Razão social','legal_name',item.legal_name)}${field('CNPJ','cnpj',item.cnpj)}${field('E-mail institucional / contato','email',item.email,'email')}${field('Telefone','phone',item.phone)}${textarea('Endereço','address',item.address)}${selectField('Status','status',[{id:'active',name:'Ativa'},{id:'blocked',name:'Bloqueada'},{id:'inactive',name:'Inativa'}],item.status||'active','Selecione','required')}<div class="full notice"><strong>Acesso do administrador da cooperativa</strong><br>O administrador poderá entrar com o e-mail abaixo ou com o e-mail institucional da cooperativa.</div>${field('Nome do administrador','admin_name',item.admin_name||'','text','required')}${field('E-mail de acesso do administrador','admin_email',item.admin_email||'','email','required')}${field(item.id?'Nova senha (deixe vazia para manter)':'Senha inicial','admin_password','','password',item.id?'minlength="8" autocomplete="new-password"':'required minlength="8" autocomplete="new-password"')}${item.id?'':`${field('INSS (%)','inss_percent',4,'number','step="0.01" min="0"')}${field('SEST/SENAT (%)','sest_senat_percent',.5,'number','step="0.01" min="0"')}${field('Taxa mínima padrão','default_minimum',12,'number','step="0.01" min="0"')}${field('Valor padrão por km','default_km',2.5,'number','step="0.01" min="0"')}${field('Taxa da cooperativa (%)','cooperative_fee_percent',0,'number','step="0.01" min="0"')}`}${buttons()}</form>`);$('#lg-coop-form').onsubmit=async e=>{e.preventDefault();try{loading(true);const body=formObject(e.currentTarget);const result=await api(`/api/app/platform/cooperatives${item.id?`/${item.id}`:''}`,{method:item.id?'PUT':'POST',body});closeModal();const access=result.admin_login||body.admin_email;toast(`Cooperativa salva. Acesso: ${access}`);if(!item.id){setTimeout(()=>alert(`Cooperativa cadastrada com sucesso.\n\nE-mail de acesso: ${access}\nTambém é possível entrar com o e-mail institucional informado.\n\nUse a senha criada neste cadastro.`),50)}await renderMasterFilter();pages.cooperatives()}catch(err){toast(err.message,'error')}finally{loading(false)}}}

pages.audit=async()=>{const d=await api('/api/app/platform/audit');$('#page-content').innerHTML=panel('Auditoria geral da plataforma',table([{label:'Data',render:r=>dateTime(r.created_at)},{label:'Cooperativa',key:'cooperative_name'},{label:'Usuário',key:'user_name'},{label:'Ação',key:'action'},{label:'Registro',render:r=>`${esc(r.entity_type)}<br><code>${esc(r.entity_id||'')}</code>`}],d.items,r=>`<button class="table-action" data-lg-audit="${r.id}">Detalhes</button>`));$$('[data-lg-audit]').forEach(b=>b.onclick=()=>{const r=d.items.find(x=>String(x.id)===b.dataset.lgAudit);openModal('Registro de auditoria',`<div class="detail-grid"><div><small>Ação</small><strong>${esc(r.action)}</strong></div><div><small>Usuário</small><strong>${esc(r.user_name||'Sistema')}</strong></div><div class="full"><small>Antes</small><div class="code-box">${esc(pretty(r.before_json))}</div></div><div class="full"><small>Depois</small><div class="code-box">${esc(pretty(r.after_json))}</div></div></div>`)})};

/* ESTABELECIMENTOS com precificação por rota */
establishmentForm=function(item={}){openModal(item.id?'Editar estabelecimento':'Novo estabelecimento',`<form id="est-form" class="form-grid">${field('Nome fantasia','name',item.name,'text','required')}${field('Razão social','legal_name',item.legal_name)}${field('CNPJ','cnpj',item.cnpj)}${field('Telefone','phone',item.phone)}${field('E-mail comercial','email',item.email,'email')}${textarea('Endereço completo da coleta','address',item.address,'required placeholder="Rua, número, bairro, cidade e estado"')}${field('Cidade','city',item.city)}${field('Estado','state',item.state)}${field('CEP','postal_code',item.postal_code)}${field('Valor por km pela rota','rate_per_km',inputMoney(item.rate_per_km_cents||250),'number','step="0.01" min="0" required')}${field('Taxa mínima','minimum_fee',inputMoney(item.minimum_fee_cents||1200),'number','step="0.01" min="0" required')}${field('Taxa da cooperativa (%)','cooperative_fee_percent',item.cooperative_fee_percent||0,'number','step="0.01" min="0"')}${field('Prefixo dos pedidos','order_prefix',item.order_prefix||'LG','text','maxlength="12"')}${item.id?'':`<div class="full notice"><strong>Acesso do estabelecimento</strong><br>Ele poderá lançar pedidos de balcão, acompanhar entregas e configurar sua integração.</div>${field('E-mail de acesso','access_email',item.email,'email')}${field('Senha inicial','access_password','','password','minlength="8"')}`}${buttons()}</form>`);$('#est-form').onsubmit=async e=>{e.preventDefault();const b=formObject(e.currentTarget);try{loading(true);let eid=item.id;if(item.id)await api(`/api/app/establishments/${item.id}`,{method:'PUT',body:b});else{const d=await api('/api/app/establishments',{method:'POST',body:b});eid=d.item.id;if(b.access_email&&b.access_password)await api(`/api/app/establishments/${eid}/access`,{method:'POST',body:{name:b.name,email:b.access_email,password:b.access_password}})}closeModal();clearTenantCache();toast('Estabelecimento salvo.');pages.establishments()}catch(err){toast(err.message,'error')}finally{loading(false)}}};

/* BASES */
pages.bases=async()=>{const d=await api('/api/app/tenant/bases');$('#page-content').innerHTML=panel('Bases da cooperativa',`<div class="notice">Na modalidade Base, o cliente informa o endereço de coleta e entrega. Cooperados escalados nessa base recebem as corridas disponíveis.</div>`+table([{label:'Base',key:'name'},{label:'Endereço',key:'address',wrap:true},{label:'Taxa mínima',render:r=>money(r.minimum_fee_cents)},{label:'Valor/km',render:r=>money(r.rate_per_km_cents)},{label:'Escalados hoje',key:'scheduled_today'},{label:'Status',render:r=>badge(r.active?'active':'inactive')}],d.items,r=>state.user.role==='cooperative_admin'?`<button class="table-action" data-qr-base="${r.id}">QR</button><button class="table-action" data-edit-base="${r.id}">Editar</button>`:''),state.user.role==='cooperative_admin'?'<button class="btn primary" id="new-base">Nova base</button>':'');$('#new-base')?.addEventListener('click',()=>baseForm());$$('[data-edit-base]').forEach(b=>b.onclick=()=>baseForm(d.items.find(x=>x.id===b.dataset.editBase)));$$('[data-qr-base]').forEach(b=>b.onclick=()=>showLocationQr(d.items.find(x=>x.id===b.dataset.qrBase),'base'))};
function baseForm(item={}){openModal(item.id?'Editar base':'Nova base',`<form id="base-form" class="form-grid">${field('Nome da base','name',item.name,'text','required')}${textarea('Endereço completo','address',item.address,'required')}${field('Cidade','city',item.city)}${field('Estado','state',item.state)}${field('CEP','postal_code',item.postal_code)}${field('Taxa mínima','minimum_fee',inputMoney(item.minimum_fee_cents||1200),'number','step="0.01" min="0" required')}${field('Valor por km','rate_per_km',inputMoney(item.rate_per_km_cents||250),'number','step="0.01" min="0" required')}${field('Taxa da cooperativa (%)','cooperative_fee_percent',item.cooperative_fee_percent||0,'number','step="0.01" min="0"')}${item.id?`<label class="checkbox-row full"><input type="checkbox" name="active" ${item.active?'checked':''}> Base ativa</label>`:''}${buttons()}</form>`);$('#base-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/tenant/bases${item.id?`/${item.id}`:''}`,{method:item.id?'PUT':'POST',body:formObject(e.currentTarget)});closeModal();clearTenantCache();toast('Base salva.');pages.bases()}catch(err){toast(err.message,'error')}finally{loading(false)}}}
function showLocationQr(item,type){const token=type==='base'?item.qr_token:item.checkin_token,qr=qrcode(0,'M');qr.addData(token);qr.make();const svg=qr.createSvgTag(7,4);openModal(`QR — ${item.name}`,`<div class="qr-wrap"><p>O cooperado lê ao chegar para fazer <strong>check-in</strong> e lê novamente ao sair para fazer <strong>check-out</strong>.</p>${svg}<div class="code-box">${esc(token)}</div><button class="btn primary" id="copy-location-qr">Copiar código</button></div>`);$('#copy-location-qr').onclick=()=>copyText(token)}

/* SERVIÇOS */
pages.services=async()=>{const base=await lgBase(true),d=await api('/api/app/tenant/services');$('#page-content').innerHTML=panel('Serviços adicionais',table([{label:'Serviço',render:r=>`<strong>${esc(r.name)}</strong><br><small>${esc(r.description||'')}</small>`},{label:'Aplicado em',render:r=>esc(r.base_name||r.establishment_name||'Toda a cooperativa')},{label:'Adicional',render:r=>money(r.add_cents)},{label:'Status',render:r=>badge(r.active?'active':'inactive')}],d.items,r=>state.user.role==='cooperative_admin'?`<button class="table-action" data-edit-service="${r.id}">Editar</button>`:''),state.user.role==='cooperative_admin'?'<button class="btn primary" id="new-service">Novo serviço</button>':'');$('#new-service')?.addEventListener('click',()=>serviceForm({},base));$$('[data-edit-service]').forEach(b=>b.onclick=()=>serviceForm(d.items.find(x=>x.id===b.dataset.editService),base))};
function serviceForm(item={},base=state.cache){openModal(item.id?'Editar serviço':'Novo serviço',`<form id="service-form" class="form-grid">${field('Nome','name',item.name,'text','required')}${field('Valor adicional','add_value',inputMoney(item.add_cents),'number','step="0.01" min="0" required')}${selectField('Base específica','base_id',base.bases||[],item.base_id,'Todas/nenhuma')}${selectField('Estabelecimento específico','establishment_id',base.establishments||[],item.establishment_id,'Todos/nenhum')}${textarea('Descrição','description',item.description)}${item.id?`<label class="checkbox-row full"><input type="checkbox" name="active" ${item.active?'checked':''}> Serviço ativo</label>`:''}${buttons()}</form>`);$('#service-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/tenant/services${item.id?`/${item.id}`:''}`,{method:item.id?'PUT':'POST',body:formObject(e.currentTarget)});closeModal();clearTenantCache();toast('Serviço salvo.');pages.services()}catch(err){toast(err.message,'error')}finally{loading(false)}}}

/* ESCALAS por contrato/base */
pages.schedules=async()=>{const base=await lgBase(true),mode=state.cache.scheduleMode||'week',ref=state.cache.scheduleRef||isoDate();let from,to;if(mode==='month')[from,to]=monthBounds(ref);else{from=mondayOf(ref);to=addDays(from,6)}const d=await api(`/api/app/tenant/schedules${query({from,to})}`);const count={};(d.items||[]).forEach(r=>{const k=`${r.driver_id}|${r.contract_name||r.base_name||r.establishment_name||'Sem local'}`;count[k]=(count[k]||0)+1});const tools=`<div class="toolbar"><select id="sch-mode"><option value="week" ${mode==='week'?'selected':''}>Semana</option><option value="month" ${mode==='month'?'selected':''}>Mês</option></select><input id="sch-ref" type="date" value="${ref}">${['cooperative_admin','dispatcher'].includes(state.user.role)?'<button class="btn primary" id="new-sch">Nova escala</button>':''}</div>`;let body;if(mode==='week'){body=`<div class="calendar-list">${Array.from({length:7},(_,i)=>{const date=addDays(from,i),items=(d.items||[]).filter(x=>String(x.start_at).slice(0,10)===date);return `<div class="calendar-day"><h3>${['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'][i]} • ${dateOnly(date)}</h3>${items.map(x=>`<div class="schedule-chip"><strong>${esc(x.driver_name)}</strong><div>${timeOnly(x.start_at)}–${timeOnly(x.end_at)} • ${esc(x.shift_label||'Turno')}</div><div>${esc(x.contract_name||x.base_name||x.establishment_name||'')}</div><small>${count[`${x.driver_id}|${x.contract_name||x.base_name||x.establishment_name||'Sem local'}`]} vez(es) no período</small>${['cooperative_admin','dispatcher'].includes(state.user.role)?`<div class="actions"><button class="table-action" data-edit-sch="${x.id}">Editar</button><button class="table-action" data-del-sch="${x.id}">Excluir</button></div>`:''}</div>`).join('')||'<span class="muted">Sem escala</span>'}</div>`}).join('')}</div>`}else body=table([{label:'Data',render:r=>dateOnly(String(r.start_at).slice(0,10))},{label:'Cooperado',key:'driver_name'},{label:'Horário',render:r=>`${timeOnly(r.start_at)}–${timeOnly(r.end_at)}`},{label:'Contrato/Base',render:r=>esc(r.contract_name||r.base_name||r.establishment_name||'')},{label:'Turno',key:'shift_label'},{label:'Quantidade no período',render:r=>count[`${r.driver_id}|${r.contract_name||r.base_name||r.establishment_name||'Sem local'}`]}],d.items,r=>['cooperative_admin','dispatcher'].includes(state.user.role)?`<button class="table-action" data-edit-sch="${r.id}">Editar</button><button class="table-action" data-del-sch="${r.id}">Excluir</button>`:'');$('#page-content').innerHTML=panel('Escala de segunda a domingo',body,tools);$('#sch-mode').onchange=e=>{state.cache.scheduleMode=e.target.value;pages.schedules()};$('#sch-ref').onchange=e=>{state.cache.scheduleRef=e.target.value;pages.schedules()};$('#new-sch')?.addEventListener('click',()=>scheduleGenerateForm(base));$$('[data-edit-sch]').forEach(b=>b.onclick=()=>scheduleEditForm(d.items.find(x=>x.id===b.dataset.editSch),base));$$('[data-del-sch]').forEach(b=>b.onclick=()=>removeEntity(`/api/app/tenant/schedules/${b.dataset.delSch}`,'Excluir esta escala?',pages.schedules))};
function targetFields(base,item={}){return `${selectField('Estabelecimento','establishment_id',base.establishments||[],item.establishment_id,'Selecione se for contrato')}${selectField('Base','base_id',base.bases||[],item.base_id,'Selecione se for modalidade Base')}${selectField('Contrato','contract_id',base.contracts||[],item.contract_id,'Opcional')}`}
function scheduleGenerateForm(base){openModal('Criar escalas no período',`<form id="sch-gen-form" class="form-grid">${selectField('Cooperado','driver_id',base.drivers||[],'','Selecione','required')}${selectField('Horário fixo','shift_template_id',base.shifts||[],'','Selecione','required')}${targetFields(base)}${field('Data inicial','start_date',mondayOf(isoDate()),'date','required')}${field('Data final','end_date',addDays(mondayOf(isoDate()),6),'date','required')}${field('Garantido por escala','guaranteed_value',0,'number','step="0.01" min="0"')}<div class="full"><strong>Dias da semana</strong><div class="weekday-grid">${[['Dom',0],['Seg',1],['Ter',2],['Qua',3],['Qui',4],['Sex',5],['Sáb',6]].map(([n,v])=>`<label class="check-card"><input type="checkbox" name="weekdays[]" value="${v}" ${v>=1&&v<=5?'checked':''}>${n}</label>`).join('')}</div></div>${textarea('Observações','notes')}${buttons('Criar escalas')}</form>`);$('#sch-gen-form').onsubmit=async e=>{e.preventDefault();const b=formObject(e.currentTarget);b.weekdays=(b.weekdays||[]).map(Number);try{loading(true);await api('/api/app/tenant/schedules/generate',{method:'POST',body:b});closeModal();toast('Escalas criadas.');pages.schedules()}catch(err){if(err.status===409&&err.data?.conflicts&&confirm(`${err.message}\nDeseja criar mesmo assim?`)){b.allow_conflicts=true;await api('/api/app/tenant/schedules/generate',{method:'POST',body:b});closeModal();toast('Escalas criadas com conflitos sinalizados.');pages.schedules()}else toast(err.message,'error')}finally{loading(false)}}}
function scheduleEditForm(item,base){openModal('Editar escala',`<form id="sch-edit-form" class="form-grid">${selectField('Cooperado','driver_id',base.drivers||[],item.driver_id,'Selecione','required')}${targetFields(base,item)}${field('Turno','shift_label',item.shift_label)}${field('Início','start_at',String(item.start_at).slice(0,16),'datetime-local','required')}${field('Fim','end_at',String(item.end_at).slice(0,16),'datetime-local','required')}${field('Garantido','guaranteed_value',inputMoney(item.guaranteed_cents),'number','step="0.01" min="0"')}${selectField('Status','status',[{id:'scheduled',name:'Agendada'},{id:'confirmed',name:'Confirmada'},{id:'completed',name:'Concluída'},{id:'absent',name:'Ausente'}],item.status)}${textarea('Observações','notes',item.notes)}${buttons()}</form>`);$('#sch-edit-form').onsubmit=async e=>{e.preventDefault();const b=formObject(e.currentTarget);try{loading(true);await api(`/api/app/tenant/schedules/${item.id}`,{method:'PUT',body:b});closeModal();toast('Escala atualizada.');pages.schedules()}catch(err){if(err.status===409&&confirm(`${err.message}\nSalvar mesmo assim?`)){b.allow_conflicts=true;await api(`/api/app/tenant/schedules/${item.id}`,{method:'PUT',body:b});closeModal();toast('Escala atualizada com conflito.');pages.schedules()}else toast(err.message,'error')}finally{loading(false)}}}

/* ENTREGAS */
function deliveryTable(items,withActions=true){return table([{label:'Pedido',render:r=>`<strong>${esc(r.display_code||r.external_id||r.id)}</strong><br><small>${dateTime(r.created_at)}</small>`},{label:'Origem',render:r=>`<strong>${esc(r.establishment_name||r.base_name||'')}</strong><br><small>${esc(r.source||'')}</small>`},{label:'Cliente',render:r=>`${esc(r.customer_name||r.recipient_name||'—')}<br><small>${esc(r.customer_phone||r.recipient_phone||'')}</small>`},{label:'Endereço de entrega',key:'delivery_address',wrap:true},{label:'Rota',render:r=>`${km(r.distance_meters)}<br><small>${mins(r.duration_seconds)}</small>`},{label:'Cooperado',key:'driver_name'},{label:'Valor',render:r=>money(r.charge_cents)},{label:'Status',render:r=>badge(r.status)}],items,withActions?r=>deliveryActionButtons(r):null)}
function deliveryActionButtons(r){let out=`<button class="table-action" data-lg-view="${r.id}">Ver</button>`;if(['cooperative_admin','dispatcher'].includes(state.user.role)&&!['delivered','cancelled'].includes(r.status))out+=`<button class="table-action" data-lg-assign="${r.id}">Atribuir</button>`;if(state.user.role==='driver'&&['new','offered','assigned'].includes(r.status))out+=`<button class="table-action" data-lg-accept="${r.id}">Aceitar</button>`;if(state.user.role==='driver'&&r.assigned_driver_id===state.user.driver_id&&!['delivered','cancelled'].includes(r.status))out+=`<button class="table-action" data-lg-status="${r.id}">Status</button>`;if(r.tracking_token)out+=`<button class="table-action" data-lg-track="${r.id}">Link</button>`;return out}
pages.deliveries=async()=>{const base=await lgBase(true),status=state.cache.lgDeliveryStatus||'',d=await api(`/api/app/tenant/deliveries${query({status})}`),tools=`<div class="toolbar"><select id="lg-del-status"><option value="">Todos os status</option>${['new','offered','assigned','accepted','to_pickup','at_pickup','picked_up','in_route','delivered','cancelled','problem'].map(s=>`<option value="${s}" ${status===s?'selected':''}>${statusText[s]}</option>`).join('')}</select>${state.user.role==='establishment'?'<button class="btn primary" id="counter-delivery">Nova entrega de balcão</button>':''}${['cooperative_admin','dispatcher'].includes(state.user.role)?'<button class="btn primary" id="admin-counter-delivery">Nova entrega</button>':''}</div>`;$('#page-content').innerHTML=panel(state.user.role==='driver'?'Minhas entregas':'Central de entregas',deliveryTable(d.items||[],true),tools);$('#lg-del-status').onchange=e=>{state.cache.lgDeliveryStatus=e.target.value;pages.deliveries()};$('#counter-delivery')?.addEventListener('click',()=>counterDeliveryForm(base));$('#admin-counter-delivery')?.addEventListener('click',()=>counterDeliveryForm(base));bindLigerimDeliveryActions(d.items||[],base)};
function bindLigerimDeliveryActions(items,base=state.cache){$$('[data-lg-view]').forEach(b=>b.onclick=()=>deliveryLigerimDetail(items.find(x=>x.id===b.dataset.lgView)));$$('[data-lg-assign]').forEach(b=>b.onclick=()=>assignLigerim(items.find(x=>x.id===b.dataset.lgAssign),base));$$('[data-lg-accept]').forEach(b=>b.onclick=async()=>{try{await api(`/api/app/driver/deliveries/${b.dataset.lgAccept}/accept`,{method:'POST'});toast('Entrega aceita.');pages.deliveries()}catch(e){toast(e.message,'error')}});$$('[data-lg-status]').forEach(b=>b.onclick=()=>driverStatusForm(items.find(x=>x.id===b.dataset.lgStatus)));$$('[data-lg-track]').forEach(b=>b.onclick=()=>{const r=items.find(x=>x.id===b.dataset.lgTrack);copyText(`${location.origin}/r/${r.tracking_token}`)})}
function counterDeliveryForm(base){const selectedEst=state.user.role==='establishment'?state.user.establishment_id:'';openModal('Nova entrega de balcão',`<form id="counter-form" class="form-grid">${state.user.role==='establishment'?`<input type="hidden" name="establishment_id" value="${esc(selectedEst||'')}">`:selectField('Estabelecimento','establishment_id',base.establishments||[],'','Selecione','required')}${field('Nome do cliente','customer_name')}${field('Telefone do cliente','customer_phone','','tel')}${field('Nome de quem recebe','recipient_name')}${field('Telefone de quem recebe','recipient_phone','','tel')}${textarea('Endereço completo de entrega','delivery_address','','required placeholder="Rua, número, bairro, cidade e estado"')}${field('Bairro de entrega','delivery_neighborhood')}${field('Descrição do item','item_description')}${selectField('Forma de pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'pix_cooperativa',name:'PIX Cooperativa'},{id:'credit',name:'Crédito antecipado'}],'pix','Selecione')}${selectField('Status do pagamento','payment_status',[{id:'pending',name:'Pendente'},{id:'paid',name:'Pago'}],'pending')}${field('Valor manual (opcional)','charge_value','','number','step="0.01" min="0" placeholder="Vazio = cálculo pela rota"')}${serviceChecks(base.services||[])}${textarea('Observações para o cooperado','notes')}${`<div class="full quote-result" id="counter-quote">O sistema calcula a distância pela rota e aplica a taxa mínima.</div>`}<div class="form-actions"><button class="btn soft" type="button" id="counter-quote-btn">Calcular valor</button><button class="btn primary" type="submit">Gerar pedido</button></div></form>`);const quote=async()=>{const b=formObject($('#counter-form'));if(!b.delivery_address)throw new Error('Informe o endereço de entrega.');const q=await api('/api/app/quotes/establishment',{method:'POST',body:b});$('#counter-quote').innerHTML=routeSummary(q.quote);return q.quote};$('#counter-quote-btn').onclick=async()=>{try{loading(true);await quote()}catch(e){toast(e.message,'error')}finally{loading(false)}};$('#counter-form').onsubmit=async e=>{e.preventDefault();try{loading(true);const b=formObject(e.currentTarget),r=await api('/api/app/establishment/deliveries',{method:'POST',body:b});closeModal();toast(`Pedido ${r.item.display_code} criado.`);pages.deliveries()}catch(err){toast(err.message,'error')}finally{loading(false)}}}
function assignLigerim(item,base){openModal(`Atribuir ${item.display_code||''}`,`<form id="assign-lg" class="form-grid">${selectField('Cooperado','driver_id',base.drivers||[],'','Selecione','required')}<div class="full notice">Ao atribuir, o link de rastreamento já poderá ser enviado ao cliente. A posição aparece enquanto a rota estiver ativa.</div>${buttons('Atribuir')}</form>`);$('#assign-lg').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/tenant/deliveries/${item.id}/assign`,{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Entrega atribuída.');pages.deliveries()}catch(err){toast(err.message,'error')}finally{loading(false)}}}
function driverStatusForm(item){const next={accepted:['to_pickup','cancelled','problem'],assigned:['accepted'],to_pickup:['at_pickup','problem'],at_pickup:['picked_up','problem'],picked_up:['in_route','problem'],in_route:['delivered','problem'],problem:['in_route','cancelled']}[item.status]||[];openModal(`Atualizar ${item.display_code||''}`,`<form id="driver-status-form" class="form-grid">${selectField('Novo status','status',next.map(x=>({id:x,name:statusText[x]})),'','Selecione','required')}${textarea('Observação','notes')}${buttons('Atualizar')}</form>`);$('#driver-status-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/driver/deliveries/${item.id}/status`,{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Status atualizado.');pages.deliveries()}catch(err){toast(err.message,'error')}finally{loading(false)}}}
function deliveryLigerimDetail(x){const geometry=parseGeometry(x.route_geometry),tracking=`${location.origin}/r/${x.tracking_token}`;openModal(`Pedido ${x.display_code||x.id}`,`<div class="detail-grid"><div><small>Status</small>${badge(x.status)}</div><div><small>Valor</small><strong>${money(x.charge_cents)}</strong></div><div><small>Coleta</small><strong>${esc(x.pickup_address)}</strong></div><div><small>Entrega</small><strong>${esc(x.delivery_address)}</strong></div><div><small>Cooperado</small><strong>${esc(x.driver_name||'Aguardando')}</strong></div><div><small>Rota</small><strong>${km(x.distance_meters)} • ${mins(x.duration_seconds)}</strong></div><div class="full"><small>Cliente/contato</small><strong>${esc(x.customer_name||x.recipient_name||'—')} • ${esc(x.customer_phone||x.recipient_phone||'')}</strong></div><div class="full"><small>Observações</small><strong>${esc(x.notes||'Sem observações')}</strong></div></div><div id="lg-detail-map" class="map small"></div><div class="form-actions"><button class="btn primary" id="copy-track-detail">Copiar link de rastreamento</button></div>`);$('#copy-track-detail').onclick=()=>copyText(tracking);renderLineMap('lg-detail-map',geometry,[{lat:x.pickup_lat,lng:x.pickup_lng,label:'Coleta'},{lat:x.delivery_lat,lng:x.delivery_lng,label:'Entrega'}])}

/* ROTA DO COOPERADO */
pages.routes=async()=>{const d=await api('/api/app/tenant/deliveries'),active=(d.items||[]).filter(x=>x.assigned_driver_id===state.user.driver_id&&!['delivered','cancelled'].includes(x.status));$('#page-content').innerHTML=panel('Montar minha rota',`<div class="notice">Selecione as entregas. O ChegaJá calcula a sequência e mostra o percurso dentro do aplicativo.</div><form id="route-plan-form"><div class="route-select-list">${active.map(x=>`<label class="route-select"><input type="checkbox" name="delivery_ids[]" value="${x.id}" checked><span><strong>${esc(x.display_code)}</strong><small>${esc(x.pickup_address)} → ${esc(x.delivery_address)}</small></span><em>${money(x.charge_cents)}</em></label>`).join('')||empty('Nenhuma entrega ativa','Aceite ou aguarde a atribuição de uma entrega.')}</div>${active.length?'<div class="form-actions"><button class="btn primary" type="submit">Calcular minha rota</button></div>':''}</form>`)+`<section id="route-result"></section>`;$('#route-plan-form')?.addEventListener('submit',async e=>{e.preventDefault();try{loading(true);const b=formObject(e.currentTarget),r=await api('/api/app/driver/route-plan',{method:'POST',body:{delivery_ids:b.delivery_ids||[]}}),p=r.plan;$('#route-result').innerHTML=panel('Rota calculada',routeSummary({distance_meters:p.distance_meters,duration_seconds:p.duration_seconds,services_cents:0,charge_cents:active.reduce((s,x)=>s+Number(x.charge_cents||0),0)})+`<div id="driver-route-map" class="map"></div><div class="route-stops">${(p.stops||[]).map((s,i)=>`<div class="route-stop"><b>${i+1}</b><span><strong>${s.stop_type==='pickup'?'Coleta':'Entrega'} — ${esc(s.display_code||'')}</strong><small>${esc(s.address)}</small></span></div>`).join('')}</div>`);renderLineMap('driver-route-map',parseGeometry(p.geometry),(p.stops||[]).map(s=>({lat:s.latitude,lng:s.longitude,label:s.address}))) }catch(err){toast(err.message,'error')}finally{loading(false)}})};

/* RASTREAMENTO DOS ONLINE */
pages.tracking=async()=>{const d=await api('/api/app/tenant/online-drivers');$('#page-content').innerHTML=panel('Cooperados online',`<div class="notice">O estabelecimento visualiza somente cooperados que atendem pedidos ativos ou estão escalados nele.</div><div id="lg-live-map" class="map"></div>`)+panel('Lista',table([{label:'Cooperado',key:'name'},{label:'Telefone',key:'phone'},{label:'Moto/placa',render:r=>esc([r.vehicle_model,r.vehicle_plate].filter(Boolean).join(' • ')||'—')},{label:'Situação',render:r=>badge(r.online?'active':'inactive')},{label:'Atualização',render:r=>dateTime(r.location_updated_at||r.last_seen_at)}],d.items||[]));setTimeout(()=>{const map=L.map('lg-live-map').setView([-5.7945,-35.211],12);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);const pts=[];(d.items||[]).filter(r=>r.online&&r.current_lat!=null).forEach(r=>{L.marker([r.current_lat,r.current_lng]).addTo(map).bindPopup(`<strong>${esc(r.name)}</strong><br>${esc(r.vehicle_plate||'')}<br>${dateTime(r.location_updated_at)}`);pts.push([r.current_lat,r.current_lng])});if(pts.length)map.fitBounds(pts,{padding:[30,30]})},20)};

/* PRESENÇA QR */
pages.attendance=async()=>{const d=await api('/api/app/tenant/presence'),items=d.items||[],openSession=state.user.role==='driver'?items.find(x=>!x.checkout_at):null,tools=state.user.role==='driver'?'<button class="btn primary" id="scan-lg-qr">Ler QR Code</button>':'';$('#page-content').innerHTML=(state.user.role==='driver'?panel('Presença atual',openSession?`<div class="attendance-current"><div><small>Local</small><strong>${esc(openSession.establishment_name||openSession.base_name)}</strong></div><div><small>Check-in</small><strong>${dateTime(openSession.checkin_at)}</strong></div><div><small>Saída</small><strong>Leia o mesmo QR</strong></div></div>`:empty('Nenhum check-in aberto','Leia o QR ao chegar no estabelecimento ou base.'),tools):'')+panel('Histórico de check-in e check-out',table([{label:'Cooperado',key:'driver_name'},{label:'Local',render:r=>esc(r.establishment_name||r.base_name)},{label:'Entrada',render:r=>dateTime(r.checkin_at)},{label:'Saída',render:r=>r.checkout_at?dateTime(r.checkout_at):'<strong class="positive">Em andamento</strong>'},{label:'Origem',key:'source'}],items));$('#scan-lg-qr')?.addEventListener('click',openQrScanner)};
submitAttendanceToken=async function(token){if(qrScanBusy||!String(token||'').trim())return;qrScanBusy=true;try{let latitude=null,longitude=null;try{const p=await currentPosition();latitude=p.coords.latitude;longitude=p.coords.longitude}catch{}const d=await api('/api/app/driver/presence/scan',{method:'POST',body:{token:String(token).trim(),latitude,longitude}});stopQrScanner();closeModal();toast(d.action==='checkout'?`Check-out realizado em ${d.location_name}.`:`Check-in realizado em ${d.location_name}.`);pages.attendance()}catch(e){qrScanBusy=false;toast(e.message,'error')}};

/* FINANCEIRO */
pages.settings=async()=>{const d=await api('/api/app/tenant/settings'),x=d.item||{};$('#page-content').innerHTML=panel('Configurações da cooperativa',`<form id="tenant-settings" class="form-grid">${field('Nome','name',x.name,'text','required')}${field('E-mail','email',x.email,'email')}${field('Telefone','phone',x.phone)}${textarea('Endereço','address',x.address)}${field('INSS (%)','inss_percent',x.inss_percent,'number','step="0.01" min="0"')}${field('SEST/SENAT (%)','sest_senat_percent',x.sest_senat_percent,'number','step="0.01" min="0"')}${field('Taxa mínima padrão','default_minimum',inputMoney(x.default_minimum_cents),'number','step="0.01" min="0"')}${field('Valor padrão por km','default_km',inputMoney(x.default_km_cents),'number','step="0.01" min="0"')}${field('Taxa da cooperativa (%)','cooperative_fee_percent',x.cooperative_fee_percent,'number','step="0.01" min="0"')}${buttons('Salvar configurações')}</form>`);$('#tenant-settings').onsubmit=async e=>{e.preventDefault();try{loading(true);await api('/api/app/tenant/settings',{method:'PUT',body:formObject(e.currentTarget)});toast('Configurações salvas.')}catch(err){toast(err.message,'error')}finally{loading(false)}}};
pages.deductions=async()=>{const month=state.cache.dedMonth||isoDate().slice(0,7),d=await api(`/api/app/tenant/deductions?month=${month}`);$('#page-content').innerHTML=panel('Impostos e rateios',`<div class="notice">INSS e SEST/SENAT são calculados por entrega conforme as configurações da cooperativa. Aqui você cadastra outros descontos semanais, mensais ou percentuais.</div>`+table([{label:'Nome',key:'name'},{label:'Tipo',render:r=>({percentage:'Percentual',fixed_weekly:'Valor semanal',fixed_monthly:'Valor mensal'}[r.calculation_type])},{label:'Padrão',render:r=>r.calculation_type==='percentage'?`${r.default_value}%`:money(Number(r.default_value||0)*100)},{label:`Valor em ${month}`,render:r=>r.month_value==null?'Usa o padrão':(r.calculation_type==='percentage'?`${r.month_value}%`:money(Number(r.month_value)*100))},{label:'Status',render:r=>badge(r.active?'active':'inactive')}],d.items,r=>`<button class="table-action" data-edit-ded="${r.id}">Editar</button><button class="table-action" data-month-ded="${r.id}">Valor do mês</button>`),`<div class="toolbar"><input id="ded-month" type="month" value="${month}"><button class="btn primary" id="new-ded">Novo imposto/rateio</button></div>`);$('#ded-month').onchange=e=>{state.cache.dedMonth=e.target.value;pages.deductions()};$('#new-ded').onclick=()=>deductionForm();$$('[data-edit-ded]').forEach(b=>b.onclick=()=>deductionForm(d.items.find(x=>x.id===b.dataset.editDed)));$$('[data-month-ded]').forEach(b=>b.onclick=()=>deductionMonthForm(d.items.find(x=>x.id===b.dataset.monthDed),month))};
function deductionForm(item={}){openModal(item.id?'Editar desconto':'Novo imposto/rateio',`<form id="ded-form" class="form-grid">${field('Nome','name',item.name,'text','required')}${selectField('Cálculo','calculation_type',[{id:'percentage',name:'Percentual sobre produção'},{id:'fixed_weekly',name:'Valor fixo semanal'},{id:'fixed_monthly',name:'Valor fixo mensal'}],item.calculation_type,'Selecione','required')}${field('Valor padrão','default_value',item.default_value||0,'number','step="0.01" min="0" required')}${field('Ordem','sort_order',item.sort_order||0,'number','min="0"')}${item.id?`<label class="checkbox-row full"><input name="active" type="checkbox" ${item.active?'checked':''}> Ativo</label>`:''}${buttons()}</form>`);$('#ded-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/tenant/deductions${item.id?`/${item.id}`:''}`,{method:item.id?'PUT':'POST',body:formObject(e.currentTarget)});closeModal();toast('Configuração salva.');pages.deductions()}catch(err){toast(err.message,'error')}finally{loading(false)}}}
function deductionMonthForm(item,month){openModal(`Valor de ${item.name}`,`<form id="ded-month-form" class="form-grid">${field('Mês','reference_month',month,'month','required')}${field(item.calculation_type==='percentage'?'Percentual (%)':'Valor (R$)','value',item.month_value??item.default_value,'number','step="0.01" min="0" required')}${buttons('Aplicar no mês')}</form>`);$('#ded-month-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/tenant/deductions/${item.id}/month`,{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Valor mensal salvo.');pages.deductions()}catch(err){toast(err.message,'error')}finally{loading(false)}}}

pages.closings=async()=>{const week=state.cache.closeWeek||mondayOf(isoDate()),[history,preview]=await Promise.all([api('/api/app/tenant/weekly-closes'),api('/api/app/tenant/weekly-close/preview',{method:'POST',body:{week_start:week}})]);$('#page-content').innerHTML=cards([{icon:'＄',value:money(preview.totals.gross_cents),label:'Produção bruta'},{icon:'％',value:money(preview.totals.deductions_cents),label:'Descontos'},{icon:'↗',value:money(preview.totals.advances_cents),label:'Adiantamentos'},{icon:'✓',value:money(preview.totals.net_cents),label:'Líquido a receber'}])+panel(`Prévia: ${dateOnly(preview.week_start)} a ${dateOnly(preview.week_end)}`,table([{label:'Cooperado',key:'name'},{label:'Bruto',render:r=>money(r.gross_cents)},{label:'Descontos',render:r=>money(r.deductions_cents)},{label:'Adiantamentos',render:r=>money(r.advances_cents)},{label:'Líquido',render:r=>`<strong>${money(r.net_cents)}</strong>`},{label:'Detalhes',render:r=>(r.deduction_details||[]).map(x=>`${esc(x.name)}: ${money(x.amount_cents)}`).join('<br>')||'—'}],preview.items),`<div class="toolbar"><input id="close-week" type="date" value="${week}"><button class="btn" id="preview-close">Atualizar</button><button class="btn primary" id="confirm-close">Fechar semana</button></div>`)+panel('Fechamentos anteriores',table([{label:'Semana',render:r=>`${dateOnly(r.week_start)} a ${dateOnly(r.week_end)}`},{label:'Bruto',render:r=>money(r.total_gross_cents)},{label:'Descontos',render:r=>money(r.total_deductions_cents)},{label:'Adiantamentos',render:r=>money(r.total_advances_cents)},{label:'Líquido',render:r=>money(r.total_net_cents)},{label:'Status',render:r=>badge(r.status)}],history.items));const update=()=>{state.cache.closeWeek=mondayOf($('#close-week').value);pages.closings()};$('#preview-close').onclick=update;$('#confirm-close').onclick=async()=>{if(!confirm(`Fechar os valores de ${dateOnly(preview.week_start)} a ${dateOnly(preview.week_end)}?`))return;try{loading(true);await api('/api/app/tenant/weekly-close',{method:'POST',body:{week_start:preview.week_start}});toast('Semana fechada.');pages.closings()}catch(e){toast(e.message,'error')}finally{loading(false)}}};

pages.advances=async()=>{const d=await api('/api/app/advances');if(state.user.role==='driver'){$('#page-content').innerHTML=cards([{icon:'＄',value:money(d.available_cents),label:'Disponível após descontos'}])+panel('Solicitar adiantamento',`<form id="advance-request" class="form-grid">${field('Valor solicitado','amount','','number','step="0.01" min="0.01" required')}${textarea('Observação','notes')}${buttons('Solicitar')}</form>`)+panel('Meus pedidos',table([{label:'Data',render:r=>dateTime(r.created_at)},{label:'Solicitado',render:r=>money(r.requested_cents)},{label:'Aprovado',render:r=>money(r.approved_cents)},{label:'Disponível no pedido',render:r=>money(r.available_at_request_cents)},{label:'Status',render:r=>badge(r.status)},{label:'Observação',key:'admin_notes'}],d.items));$('#advance-request').onsubmit=async e=>{e.preventDefault();try{loading(true);await api('/api/app/advances',{method:'POST',body:formObject(e.currentTarget)});toast('Adiantamento solicitado.');pages.advances()}catch(err){toast(err.message,'error')}finally{loading(false)}};return}$('#page-content').innerHTML=panel('Solicitações de adiantamento',table([{label:'Cooperado',key:'driver_name'},{label:'Data',render:r=>dateTime(r.created_at)},{label:'Solicitado',render:r=>money(r.requested_cents)},{label:'Saldo disponível',render:r=>money(r.available_at_request_cents)},{label:'Aprovado',render:r=>money(r.approved_cents)},{label:'Status',render:r=>badge(r.status)}],d.items,r=>r.status==='pending'?`<button class="table-action" data-review-adv="${r.id}">Analisar</button>`:''));$$('[data-review-adv]').forEach(b=>b.onclick=()=>advanceReview(d.items.find(x=>x.id===b.dataset.reviewAdv)))};
function advanceReview(item){openModal('Analisar adiantamento',`<form id="adv-review" class="form-grid"><div class="full notice">Disponível após descontos: <strong>${money(item.available_at_request_cents)}</strong></div>${selectField('Decisão','decision',[{id:'approved',name:'Aprovar'},{id:'rejected',name:'Recusar'}],'approved','Selecione','required')}${field('Valor aprovado','approved_value',inputMoney(item.requested_cents),'number','step="0.01" min="0"')}${textarea('Observação','notes')}${buttons('Concluir')}</form>`);$('#adv-review').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/advances/${item.id}/review`,{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Solicitação analisada.');pages.advances()}catch(err){toast(err.message,'error')}finally{loading(false)}}}

pages.financial=async()=>{if(state.user.role==='driver'){const from=state.cache.finFrom||mondayOf(isoDate()),to=state.cache.finTo||addDays(from,6),d=await api(`/api/app/driver/finance${query({from,to})}`),s=d.summary||{};$('#page-content').innerHTML=cards([{icon:'＋',value:money(s.credits_cents),label:'Produção/créditos'},{icon:'－',value:money(s.debits_cents),label:'Descontos'},{icon:'＄',value:money(s.net_cents),label:'Líquido no período'}])+panel('Meus lançamentos',table([{label:'Data',render:r=>dateOnly(r.reference_date)},{label:'Descrição',key:'description'},{label:'Categoria',key:'category'},{label:'Tipo',render:r=>badge(r.entry_type)},{label:'Valor',render:r=>`<strong class="${r.entry_type==='credit'?'positive':'negative'}">${r.entry_type==='credit'?'+':'-'} ${money(r.amount_cents)}</strong>`},{label:'Status',render:r=>badge(r.status)}],d.items),`<div class="toolbar"><input id="fin-from" type="date" value="${from}"><input id="fin-to" type="date" value="${to}"><button id="fin-apply" class="btn primary">Filtrar</button></div>`);$('#fin-apply').onclick=()=>{state.cache.finFrom=$('#fin-from').value;state.cache.finTo=$('#fin-to').value;pages.financial()};return}return pages.closings()};

pages.credits=async()=>{const d=await api('/api/app/tenant/credit-requests');$('#page-content').innerHTML=panel('Compra antecipada de créditos',table([{label:'Cliente',render:r=>`<strong>${esc(r.customer_name)}</strong><br><small>${esc(r.customer_phone||r.customer_email||'')}</small>`},{label:'Valor',render:r=>money(r.amount_cents)},{label:'Pagamento',key:'payment_method'},{label:'Data',render:r=>dateTime(r.created_at)},{label:'Status',render:r=>badge(r.status)}],d.items,r=>r.status==='pending'?`<button class="table-action" data-credit-approve="${r.id}">Aprovar</button><button class="table-action" data-credit-reject="${r.id}">Recusar</button>`:''));$$('[data-credit-approve]').forEach(b=>b.onclick=()=>reviewCredit(b.dataset.creditApprove,'approved'));$$('[data-credit-reject]').forEach(b=>b.onclick=()=>reviewCredit(b.dataset.creditReject,'rejected'))};
async function reviewCredit(id,decision){if(!confirm(decision==='approved'?'Confirmar o crédito para o cliente?':'Recusar a solicitação?'))return;try{await api(`/api/app/tenant/credit-requests/${id}/review`,{method:'POST',body:{decision}});toast('Solicitação atualizada.');pages.credits()}catch(e){toast(e.message,'error')}}

/* INTEGRAÇÕES: mantém chaves/webhooks e adiciona conectores */
const oldIntegrations=pages.integrations;
pages.integrations=async()=>{await oldIntegrations();const base=await lgBase(),d=await api('/api/app/tenant/connectors').catch(()=>({items:[]}));$('#page-content').insertAdjacentHTML('beforeend',panel('Conectores dos sistemas dos estabelecimentos',`<div class="notice">Para receber pedidos, a forma recomendada é gerar uma chave de API acima. O endereço é <code>${location.origin}/api/v1/orders</code>. O conector abaixo registra os dados técnicos do sistema do estabelecimento.</div>`+table([{label:'Nome',key:'name'},{label:'Estabelecimento',key:'establishment_name'},{label:'Modo',key:'mode'},{label:'URL do sistema',key:'base_url',wrap:true},{label:'Status',render:r=>badge(r.status)},{label:'Última sincronização',render:r=>dateTime(r.last_sync_at)}],d.items),'<button class="btn primary" id="new-connector">Novo conector</button>'));$('#new-connector').onclick=()=>connectorForm(base)};
function connectorForm(base){openModal('Novo conector',`<form id="connector-form" class="form-grid">${state.user.role==='establishment'?'':selectField('Estabelecimento','establishment_id',base.establishments||[],'','Selecione','required')}${field('Nome da integração','name','','text','required')}${selectField('Modo','mode',[{id:'inbound',name:'Sistema envia para o ChegaJá'},{id:'pull',name:'ChegaJá consulta o sistema'}],'inbound')}${field('URL base do sistema','base_url','','url')}${field('Caminho dos pedidos','orders_path','/orders')}${selectField('Autenticação','auth_type',[{id:'none',name:'Sem autenticação'},{id:'bearer',name:'Bearer token'},{id:'header',name:'Cabeçalho personalizado'}],'bearer')}${field('Nome do cabeçalho','auth_header','Authorization')}${field('Segredo/token','secret','','password')}${buttons()}</form>`);$('#connector-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api('/api/app/tenant/connectors',{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Conector registrado.');pages.integrations()}catch(err){toast(err.message,'error')}finally{loading(false)}}}

/* CLIENTE — cadastro, carteira, solicitação Base */
function customerHeaders(){return lg.customerToken?{Authorization:`Bearer ${lg.customerToken}`}:{}}
async function clientApi(path,opt={}){return api(`/api/client${path}`,{...opt,headers:{...(opt.headers||{}),...customerHeaders()}})}
customerApp=async function(){showCustomer();try{lg.catalog=await clientApi('/catalog')}catch(e){$('#customer-content').innerHTML=empty('Não foi possível carregar',e.message);return}if(lg.customerToken){try{const m=await clientApi('/me');lg.customer=m.customer;return renderCustomerHome()}catch{localStorage.removeItem('ligerim_customer_token');lg.customerToken=''}}renderCustomerAccess()};
function renderCustomerAccess(){const p=lg.catalog;$('#customer-content').innerHTML=`<section class="customer-hero"><p class="eyebrow">ChegaJá para clientes</p><h1>Chame uma entrega de onde estiver</h1><p>Cadastre-se com seu celular ou qualquer e-mail: Gmail, Hotmail, Outlook ou iCloud.</p></section><div class="customer-auth-grid"><section class="customer-card"><h2>Entrar</h2><form id="customer-login" class="form-grid">${field('Celular ou e-mail','login','','text','required')}${field('Senha','password','','password','required')}${buttons('Entrar')}</form></section><section class="customer-card"><h2>Criar conta</h2><form id="customer-register" class="form-grid">${field('Nome','name','','text','required')}${field('Celular','phone','','tel')}${field('E-mail','email','','email')}${field('Senha','password','','password','required minlength="8"')}<div class="full notice">O cadastro aceita qualquer provedor de e-mail, incluindo Gmail, Hotmail, Outlook e iCloud. Login social direto exige integração OAuth contratada e credenciais dos provedores.</div>${buttons('Criar conta')}</form></section></div>`;$('#customer-login').onsubmit=async e=>{e.preventDefault();try{loading(true);const d=await clientApi('/login',{method:'POST',body:formObject(e.currentTarget)});lg.customerToken=d.token;lg.customer=d.customer;localStorage.setItem('ligerim_customer_token',d.token);renderCustomerHome()}catch(err){toast(err.message,'error')}finally{loading(false)}};$('#customer-register').onsubmit=async e=>{e.preventDefault();try{loading(true);const d=await clientApi('/register',{method:'POST',body:formObject(e.currentTarget)});lg.customerToken=d.token;lg.customer=d.customer;localStorage.setItem('ligerim_customer_token',d.token);renderCustomerHome()}catch(err){toast(err.message,'error')}finally{loading(false)}}}
async function renderCustomerHome(tab='request'){const [wallet,orders]=await Promise.all([clientApi('/wallet'),clientApi('/orders')]);const balance=wallet.wallet?.balance_cents||0;$('#customer-content').innerHTML=`<section class="client-app-head"><div><p class="eyebrow">Olá, ${esc(lg.customer?.name||'cliente')}</p><h1>O que você precisa enviar?</h1></div><div class="wallet-pill"><small>Meus créditos</small><strong>${money(balance)}</strong></div></section><nav class="client-tabs"><button data-c-tab="request" class="${tab==='request'?'active':''}">Pedir entrega</button><button data-c-tab="orders" class="${tab==='orders'?'active':''}">Meus pedidos</button><button data-c-tab="wallet" class="${tab==='wallet'?'active':''}">Créditos</button><button id="customer-logout">Sair</button></nav><div id="client-tab-body"></div>`;$$('[data-c-tab]').forEach(b=>b.onclick=()=>renderCustomerHome(b.dataset.cTab));$('#customer-logout').onclick=()=>{localStorage.removeItem('ligerim_customer_token');lg.customerToken='';lg.customer=null;renderCustomerAccess()};if(tab==='orders')renderCustomerOrders(orders.items||[]);else if(tab==='wallet')renderCustomerWallet(wallet);else renderCustomerRequest(balance)}
function renderCustomerRequest(balance){const cat=lg.catalog||{},bases=cat.bases||[];$('#client-tab-body').innerHTML=`<section class="customer-card"><form id="client-order" class="form-grid">${selectField('Cooperativa','cooperative_id',cat.cooperatives||[],'','Selecione','required')}<label>Base<select name="base_id" id="client-base" required><option value="">Selecione a cooperativa primeiro</option></select></label>${textarea('Endereço completo de coleta','pickup_address','','required placeholder="Rua, número, bairro, cidade e estado"')}${field('Bairro da coleta','pickup_neighborhood')}${field('Nome/contato na coleta','pickup_contact_name')}${field('Telefone da coleta','pickup_phone','','tel')}${textarea('Endereço completo de entrega','delivery_address','','required placeholder="Rua, número, bairro, cidade e estado"')}${field('Bairro da entrega','delivery_neighborhood')}${field('Nome de quem recebe','recipient_name')}${field('Telefone de quem recebe','recipient_phone','','tel')}${field('O que será transportado','item_description')}${selectField('Forma de pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'cash',name:'Dinheiro'},{id:'credit',name:`Créditos ChegaJá (${money(balance)})`}],'pix','Selecione','required')}<div class="full" id="client-services"></div>${textarea('Detalhes da coleta e da entrega','notes')}<div class="full quote-result" id="client-quote-result">Selecione a base e informe os endereços para calcular pela rota.</div><div class="form-actions"><button class="btn soft" type="button" id="client-quote-btn">Ver valor e rota</button><button class="btn primary" type="submit">Confirmar entrega</button></div></form></section>`;const coop=$('#client-order [name=cooperative_id]'),baseSel=$('#client-base');coop.onchange=()=>{const list=(bases||[]).filter(x=>x.cooperative_id===coop.value);baseSel.innerHTML=`<option value="">Selecione</option>${list.map(x=>`<option value="${x.id}">${esc(x.name)} • mín. ${money(x.minimum_fee_cents)}</option>`).join('')}`;$('#client-services').innerHTML=''};baseSel.onchange=()=>{const list=(cat.services||[]).filter(x=>x.cooperative_id===coop.value&&(!x.base_id||x.base_id===baseSel.value));$('#client-services').innerHTML=`<strong>Serviços adicionais</strong>${serviceChecks(list)}`};const doQuote=async()=>{const b=formObject($('#client-order'));if(!b.base_id||!b.pickup_address||!b.delivery_address)throw new Error('Selecione a base e informe coleta e entrega.');const q=await clientApi('/quote',{method:'POST',body:b});lg.quote=q.quote;$('#client-quote-result').innerHTML=routeSummary(q.quote);return q.quote};$('#client-quote-btn').onclick=async()=>{try{loading(true);await doQuote()}catch(e){toast(e.message,'error')}finally{loading(false)}};$('#client-order').onsubmit=async e=>{e.preventDefault();try{loading(true);const q=await doQuote(),b=formObject(e.currentTarget);if(!confirm(`Confirmar a entrega por ${money(q.charge_cents)}?`))return;const r=await clientApi('/orders',{method:'POST',body:b});toast(`Pedido ${r.order.display_code} criado.`);renderCustomerHome('orders')}catch(err){toast(err.message,'error')}finally{loading(false)}}}
function renderCustomerOrders(items){$('#client-tab-body').innerHTML=`<section class="customer-card">${table([{label:'Pedido',render:r=>`<strong>${esc(r.display_code||'Aguardando')}</strong><br><small>${dateTime(r.created_at)}</small>`},{label:'Cooperativa/Base',render:r=>`${esc(r.cooperative_name)}<br><small>${esc(r.base_name||'')}</small>`},{label:'Coleta',key:'pickup_address',wrap:true},{label:'Entrega',key:'delivery_address',wrap:true},{label:'Valor',render:r=>money(r.quoted_cents)},{label:'Status',render:r=>badge(r.delivery_status||r.status)}],items,r=>r.tracking_token?`<button class="table-action" data-client-track="${r.tracking_token}">Rastrear</button>`:'')}</section>`;$$('[data-client-track]').forEach(b=>b.onclick=()=>location.href=`/r/${b.dataset.clientTrack}`)}
function renderCustomerWallet(data){$('#client-tab-body').innerHTML=`${cards([{icon:'◈',value:money(data.wallet?.balance_cents),label:'Saldo pré-pago'}])}<section class="customer-card"><h2>Comprar créditos</h2><form id="client-topup" class="form-grid">${selectField('Cooperativa','cooperative_id',lg.catalog?.cooperatives||[],'','Selecione','required')}${field('Valor','amount','','number','step="0.01" min="1" required')}${selectField('Pagamento','payment_method',[{id:'pix',name:'PIX'}],'pix')}${field('Link do comprovante (opcional)','proof_url','','url')}${buttons('Solicitar crédito')}</form></section><section class="customer-card"><h2>Movimentações</h2>${table([{label:'Data',render:r=>dateTime(r.created_at)},{label:'Descrição',key:'description'},{label:'Tipo',render:r=>badge(r.entry_type)},{label:'Valor',render:r=>money(r.amount_cents)}],data.transactions||[])}</section>`;$('#client-topup').onsubmit=async e=>{e.preventDefault();try{loading(true);const r=await clientApi('/wallet/topups',{method:'POST',body:formObject(e.currentTarget)});toast(r.message);renderCustomerHome('wallet')}catch(err){toast(err.message,'error')}finally{loading(false)}}}

/* LINK PÚBLICO DE RASTREIO */
publicTracking=async function(token){$('#auth-screen').classList.add('hidden');$('#app-shell').classList.add('hidden');$('#customer-screen').classList.add('hidden');const screen=$('#tracking-screen');screen.classList.remove('hidden');const refresh=async()=>{try{const d=await api(`/api/public/tracking/${encodeURIComponent(token)}`),x=d.item,geometry=parseGeometry(x.route_geometry),steps=['assigned','accepted','to_pickup','at_pickup','picked_up','in_route','delivered'],idx=steps.indexOf(x.status);screen.innerHTML=`<div class="tracking-card"><header class="tracking-head"><div class="tracking-brand"><img src="/icons/icon-official.png" alt=""><div><p class="eyebrow">ChegaJá em tempo real</p><h1>${esc(x.display_code||'Sua entrega')}</h1><p>${esc(x.establishment_name||x.base_name||'')}</p></div></div>${badge(x.status)}</header><div class="tracking-body"><div class="tracking-address"><div class="address-box"><small>Coleta</small><strong>${esc(x.pickup_address)}</strong></div><div class="address-box"><small>Entrega</small><strong>${esc(x.delivery_address)}</strong></div></div><div class="tracking-timeline">${steps.map((s,i)=>`<div class="tracking-step ${i<=idx?'done':''}"><span class="step-dot"></span><div><strong>${statusText[s]}</strong>${i===idx?'<small>Status atual</small>':''}</div></div>`).join('')}</div><div id="public-map" class="map small"></div><div class="tracking-info"><span><small>Cooperado</small><strong>${esc(x.driver_name||'Aguardando atribuição')}</strong></span><span><small>Distância</small><strong>${km(x.distance_meters)}</strong></span><span><small>Previsão da rota</small><strong>${mins(x.duration_seconds)}</strong></span><span><small>Atualizado</small><strong>${dateTime(x.location_updated_at||x.updated_at)}</strong></span></div><p class="muted">A localização do cooperado é exibida somente enquanto a entrega está em andamento.</p></div></div>`;renderLineMap('public-map',geometry,[{lat:x.pickup_lat,lng:x.pickup_lng,label:'Coleta'},{lat:x.delivery_lat,lng:x.delivery_lng,label:'Entrega'},{lat:x.driver_lat,lng:x.driver_lng,label:x.driver_name||'Cooperado'}])}catch(e){screen.innerHTML=`<div class="tracking-card"><div class="tracking-body">${empty('Rastreamento indisponível',e.message)}</div></div>`}};await refresh();clearInterval(state.timer);state.timer=setInterval(refresh,10000)};

/* Inicialização depois de todos os módulos */


/* ===== ligerim-v6.js ===== */
/* Ligerim 6.0 — despacho correto, aplicativo móvel do cooperado e alertas sonoros */
const v6 = {
  notificationTimer: null,
  notificationCursor: 0,
  heartbeatTimer: null,
  selectedRoute: new Set(),
  lastHome: null,
  audioUnlocked: false
};

const sound = {
  context: null,
  async unlock() {
    try {
      if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)();
      if (this.context.state === 'suspended') await this.context.resume();
      v6.audioUnlocked = true;
      updateSoundButton();
    } catch {}
  },
  tone(frequency, start, duration, gain = 0.12, type = 'sine') {
    if (!this.context || this.context.state !== 'running') return;
    const osc = this.context.createOscillator();
    const amp = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, this.context.currentTime + start);
    amp.gain.setValueAtTime(0.0001, this.context.currentTime + start);
    amp.gain.exponentialRampToValueAtTime(gain, this.context.currentTime + start + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + start + duration);
    osc.connect(amp).connect(this.context.destination);
    osc.start(this.context.currentTime + start);
    osc.stop(this.context.currentTime + start + duration + 0.03);
  },
  async play(name) {
    await this.unlock();
    const patterns = {
      online: [[660,0,.13],[880,.16,.18]],
      offline: [[620,0,.14],[390,.17,.22]],
      new_order: [[880,0,.12],[880,.18,.12],[1040,.36,.17],[1040,.62,.2]],
      assigned: [[740,0,.12],[980,.16,.12],[1220,.32,.25]],
      accepted: [[840,0,.18]],
      status: [[720,0,.1],[860,.13,.14]],
      completed: [[660,0,.12],[880,.14,.12],[1120,.28,.28]],
      problem: [[260,0,.28],[220,.32,.35]],
      message: [[1000,0,.08],[1200,.11,.11]],
      created: [[700,0,.1],[900,.12,.16]]
    };
    (patterns[name] || patterns.status).forEach(([f,s,d]) => this.tone(f,s,d,name==='problem'?.16:.11,name==='problem'?'square':'sine'));
  }
};

document.addEventListener('pointerdown', () => sound.unlock(), { once: true });

function ensureSoundButton() {
  if ($('#sound-toggle')) return;
  const actions = $('.topbar-actions');
  if (!actions) return;
  const button = document.createElement('button');
  button.id = 'sound-toggle';
  button.className = 'btn small sound-toggle';
  button.type = 'button';
  button.onclick = async () => {
    await sound.unlock();
    await sound.play('status');
    toast('Sons ativados neste aparelho.');
  };
  actions.prepend(button);
  updateSoundButton();
}

function updateSoundButton() {
  const button = $('#sound-toggle');
  if (button) button.textContent = v6.audioUnlocked ? '🔊 Sons ativos' : '🔈 Ativar sons';
}

function eventSound(type) {
  if (['counter_order_created','base_order_created'].includes(type)) return 'new_order';
  if (type === 'delivery_assigned') return 'assigned';
  if (type === 'delivery_accepted') return 'accepted';
  if (type === 'delivery_completed') return 'completed';
  if (type === 'delivery_problem') return 'problem';
  if (type === 'driver_online') return 'online';
  if (type === 'driver_offline') return 'offline';
  return 'status';
}

async function initializeNotifications() {
  stopNotifications();
  if (!state.user || state.user.role === 'platform_admin') return;
  try {
    const initial = await api('/api/app/v6/notifications?initial=1');
    v6.notificationCursor = Number(initial.cursor || 0);
  } catch { return; }
  v6.notificationTimer = setInterval(pollNotifications, 7000 + Math.floor(Math.random() * 4000));
}

async function pollNotifications() {
  if (!state.user || document.visibilityState === 'hidden') return;
  try {
    const data = await api(`/api/app/v6/notifications?after=${v6.notificationCursor}`);
    v6.notificationCursor = Math.max(v6.notificationCursor, Number(data.cursor || 0));
    for (const item of data.items || []) {
      await sound.play(eventSound(item.event_type));
      toast(`${item.title}${item.message ? ` — ${item.message}` : ''}`, item.event_type === 'delivery_problem' ? 'error' : 'success');
      if (state.user.role === 'driver' && ['delivery_assigned','delivery_completed','delivery_status_changed'].includes(item.event_type) && ['dashboard','deliveries','routes'].includes(state.page)) {
        setTimeout(() => navigate(state.page, false), 300);
      }
      if (['cooperative_admin','dispatcher','establishment'].includes(state.user.role) && ['counter_order_created','base_order_created','delivery_completed'].includes(item.event_type) && state.page === 'deliveries') {
        setTimeout(() => pages.deliveries(), 300);
      }
    }
  } catch {}
}

function stopNotifications() {
  if (v6.notificationTimer) clearInterval(v6.notificationTimer);
  v6.notificationTimer = null;
}

function applyRoleLayout() {
  document.body.classList.toggle('driver-app-mode', state.user?.role === 'driver');
  document.body.classList.toggle('customer-app-mode', !$('#customer-screen')?.classList.contains('hidden'));
  ensureSoundButton();
}

const originalLoadMeV6 = loadMe;
loadMe = async function() {
  await originalLoadMeV6();
  applyRoleLayout();
  await initializeNotifications();
};

const originalLogoutV6 = logout;
logout = function(message = true) {
  stopNotifications();
  if (v6.heartbeatTimer) clearInterval(v6.heartbeatTimer);
  v6.heartbeatTimer = null;
  document.body.classList.remove('driver-app-mode');
  return originalLogoutV6(message);
};

function getPositionSoft() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      position => resolve(position),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  });
}

function startV6Heartbeat() {
  if (v6.heartbeatTimer) clearInterval(v6.heartbeatTimer);
  v6.heartbeatTimer = null;
  if (typeof startLocation === 'function') startLocation();
}

toggleOnline = async function() {
  try {
    loading(true);
    await sound.unlock();
    if (!state.online) {
      const position = await getPositionSoft();
      await api('/api/app/v6/driver/online', { method: 'POST', body: {
        online: true,
        latitude: position?.coords.latitude,
        longitude: position?.coords.longitude,
        accuracy: position?.coords.accuracy
      }});
      state.online = true;
      startLocation();
      startV6Heartbeat();
      await sound.play('online');
      toast(position ? 'Você está online e com o GPS ativo.' : 'Você está online. Autorize a localização para aparecer no mapa.');
    } else {
      await api('/api/app/v6/driver/online', { method: 'POST', body: { online: false } });
      state.online = false;
      stopLocation();
      if (v6.heartbeatTimer) clearInterval(v6.heartbeatTimer);
      v6.heartbeatTimer = null;
      await sound.play('offline');
      toast('Você está offline.');
    }
    updateOnlineControl();
    if (state.page === 'dashboard') pages.dashboard();
  } catch (error) {
    toast(error.message, 'error');
  } finally { loading(false); }
};

startLocation = function() {
  if (state.watchId !== null || !navigator.geolocation || !state.online) return;
  let lastSent = 0;
  state.watchId = navigator.geolocation.watchPosition(async position => {
    if (!state.online || Date.now() - lastSent < 7000) return;
    lastSent = Date.now();
    api('/api/app/v6/driver/location', { method: 'POST', body: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      speed: position.coords.speed,
      heading: position.coords.heading
    }}).catch(() => {});
  }, error => {
    if (error.code === 1) toast('Ative a localização do celular para aparecer no mapa.', 'error');
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
};

const originalRenderNavV6 = renderNav;
renderNav = function() {
  if (state.user?.role !== 'driver') return originalRenderNavV6();
  const entries = [
    ['dashboard','⌂','Início'],
    ['deliveries','▣','Entregas'],
    ['routes','➜','Rota'],
    ['financial','＄','Ganhos'],
    ['attendance','⌁','Presença'],
    ['account','●','Perfil']
  ];
  $('#sidebar-nav').innerHTML = `<div class="driver-mobile-nav">${entries.map(([page,icon,label]) => `<button class="nav-item ${state.page===page?'active':''}" data-page="${page}"><span>${icon}</span>${label}</button>`).join('')}</div>`;
  $$('[data-page]').forEach(button => button.onclick = () => navigate(button.dataset.page));
};

function driverStatusButton(delivery) {
  const action = {
    assigned: ['Aceitar','accept'],
    accepted: ['Ir buscar','to_pickup'],
    to_pickup: ['Cheguei','at_pickup'],
    at_pickup: ['Coletado','picked_up'],
    picked_up: ['Iniciar entrega','in_route'],
    in_route: ['Finalizar','delivered']
  }[delivery.status];
  if (!action) return '';
  return `<button class="driver-main-action" data-driver-action="${action[1]}" data-delivery="${delivery.id}">${action[0]}</button>`;
}

function driverNextAddress(delivery) {
  return ['picked_up','in_route'].includes(delivery.status) ? delivery.delivery_address : delivery.pickup_address;
}

function driverCard(delivery, selectable = false) {
  const place = delivery.delivery_type === 'base' ? (delivery.base_name || 'Base') : delivery.establishment_name;
  return `<article class="driver-order-card status-${esc(delivery.status)}">
    <header>
      ${selectable ? `<label class="route-check"><input type="checkbox" data-route-select="${delivery.id}" ${v6.selectedRoute.has(delivery.id)?'checked':''}><span></span></label>` : ''}
      <div><small>${esc(delivery.display_code || 'Entrega')}</small><strong>${esc(place || 'ChegaJá')}</strong></div>
      ${badge(delivery.status)}
    </header>
    <div class="driver-order-money"><span>Você recebe</span><strong>${money(delivery.driver_net_cents || delivery.driver_earnings_cents)}</strong></div>
    <div class="driver-address-flow">
      <div><i>1</i><span><small>Coleta</small><strong>${esc(delivery.pickup_address)}</strong></span></div>
      <div><i>2</i><span><small>Entrega</small><strong>${esc(delivery.delivery_address)}</strong></span></div>
    </div>
    <div class="driver-order-meta"><span>${km(delivery.distance_meters)}</span><span>${mins(delivery.duration_seconds)}</span><span>${esc(delivery.payment_method || 'Pagamento não informado')}</span></div>
    <div class="driver-order-buttons">
      ${driverStatusButton(delivery)}
      <button class="driver-secondary-action" data-driver-map="${delivery.id}">Navegar</button>
      <button class="driver-secondary-action" data-driver-detail="${delivery.id}">Detalhes</button>
      <button class="driver-secondary-action" data-driver-chat="${delivery.id}">Chat</button>
    </div>
  </article>`;
}

async function driverAction(delivery, action) {
  try {
    loading(true);
    if (action === 'accept') {
      await api(`/api/app/v6/driver/deliveries/${delivery.id}/accept`, { method: 'POST', body: {} });
      await sound.play('accepted');
    } else {
      if (action === 'delivered' && !confirm('Confirmar que esta entrega foi finalizada?')) return;
      await api(`/api/app/v6/driver/deliveries/${delivery.id}/status`, { method: 'POST', body: { status: action } });
      await sound.play(action === 'delivered' ? 'completed' : 'status');
    }
    toast(action === 'delivered' ? 'Entrega finalizada e lançada nos seus ganhos.' : 'Entrega atualizada.');
    await navigate(state.page, false);
  } catch (error) { toast(error.message, 'error'); }
  finally { loading(false); }
}

function openDriverMap(delivery) {
  const address = driverNextAddress(delivery);
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener');
}

function driverDetailV6(delivery) {
  openModal(delivery.display_code || 'Detalhes', `<div class="driver-detail-mobile">
    <div class="driver-detail-amount"><small>Valor líquido estimado</small><strong>${money(delivery.driver_net_cents || delivery.driver_earnings_cents)}</strong></div>
    <section><small>Cliente</small><strong>${esc(delivery.customer_name || delivery.recipient_name || 'Cliente')}</strong><p>${esc(delivery.customer_phone || delivery.recipient_phone || '')}</p></section>
    <section><small>Coleta</small><strong>${esc(delivery.pickup_address)}</strong><p>${esc(delivery.pickup_contact_name || '')} ${esc(delivery.pickup_phone || '')}</p></section>
    <section><small>Entrega</small><strong>${esc(delivery.delivery_address)}</strong><p>${esc(delivery.recipient_name || '')} ${esc(delivery.recipient_phone || '')}</p></section>
    <section><small>Item e observações</small><p>${esc(delivery.item_description || 'Não informado')}<br>${esc(delivery.notes || '')}</p></section>
    <section><small>Pagamento</small><strong>${esc(delivery.payment_method || 'Não informado')}</strong></section>
    <div class="driver-order-buttons"><button class="driver-main-action" id="detail-map">Navegar</button><button class="driver-secondary-action" id="detail-track">Copiar rastreio</button></div>
  </div>`);
  $('#detail-map').onclick = () => openDriverMap(delivery);
  $('#detail-track').onclick = () => copyText(`${location.origin}/r/${delivery.tracking_token}`);
}

async function openDeliveryChat(delivery) {
  const render = async () => {
    const data = await api(`/api/app/tenant/deliveries/${delivery.id}/messages`);
    openModal(`Chat • ${delivery.display_code}`, `<div class="delivery-chat">
      <div class="chat-messages">${(data.items || []).map(message => `<div class="chat-message ${message.sender_type === 'driver' ? 'mine' : ''}"><small>${esc(message.sender_name)} • ${dateTime(message.created_at)}</small><p>${esc(message.message)}</p></div>`).join('') || '<div class="empty">Nenhuma mensagem.</div>'}</div>
      ${data.active ? `<form id="driver-chat-form" class="chat-form"><input name="message" maxlength="500" placeholder="Digite uma mensagem" required><button class="btn primary">Enviar</button></form>` : '<p class="muted">Conversa encerrada com a finalização da entrega.</p>'}
    </div>`);
    const form = $('#driver-chat-form');
    if (form) form.onsubmit = async event => {
      event.preventDefault();
      await api(`/api/app/tenant/deliveries/${delivery.id}/messages`, { method: 'POST', body: formObject(form) });
      await sound.play('message');
      await render();
    };
  };
  try { await render(); } catch (error) { toast(error.message, 'error'); }
}

function bindDriverCards(deliveries) {
  $$('[data-driver-action]').forEach(button => button.onclick = () => driverAction(deliveries.find(item => item.id === button.dataset.delivery), button.dataset.driverAction));
  $$('[data-driver-map]').forEach(button => button.onclick = () => openDriverMap(deliveries.find(item => item.id === button.dataset.driverMap)));
  $$('[data-driver-detail]').forEach(button => button.onclick = () => driverDetailV6(deliveries.find(item => item.id === button.dataset.driverDetail)));
  $$('[data-driver-chat]').forEach(button => button.onclick = () => openDeliveryChat(deliveries.find(item => item.id === button.dataset.driverChat)));
  $$('[data-route-select]').forEach(input => input.onchange = () => input.checked ? v6.selectedRoute.add(input.dataset.routeSelect) : v6.selectedRoute.delete(input.dataset.routeSelect));
}

const originalDashboardV6 = pages.dashboard;
pages.dashboard = async function() {
  if (state.user.role !== 'driver') return originalDashboardV6();
  const data = await api('/api/app/v6/driver/home');
  v6.lastHome = data;
  state.online = Boolean(data.driver?.online);
  updateOnlineControl();
  const active = data.active_deliveries || [];
  $('#page-content').innerHTML = `<section class="driver-home-head ${state.online?'online':'offline'}">
      <div><small>${state.online?'VOCÊ ESTÁ ONLINE':'VOCÊ ESTÁ OFFLINE'}</small><h1>${state.online?'Pronto para entregar':'Fique online para receber'}</h1><p>${state.online?'As entregas atribuídas aparecerão aqui.':'Toque no botão para começar.'}</p></div>
      <button id="driver-home-online" class="driver-online-button">${state.online?'Ficar offline':'Ficar online'}</button>
    </section>
    <div class="driver-finance-strip"><div><small>Produção semanal</small><strong>${money(data.finance?.gross_cents)}</strong></div><div><small>Descontos</small><strong>${money(data.finance?.deductions_cents)}</strong></div><div><small>A receber</small><strong>${money(data.finance?.net_cents)}</strong></div></div>
    <section class="driver-mini-stats"><div><strong>${active.length}</strong><span>Em andamento</span></div><div><strong>${data.completed_today || 0}</strong><span>Finalizadas hoje</span></div><div><strong>${(data.schedules || []).length}</strong><span>Escalas hoje</span></div></section>
    <div class="driver-section-title"><h2>Entregas atuais</h2><button class="btn small" id="driver-refresh-home">Atualizar</button></div>
    <div class="driver-order-list">${active.map(item => driverCard(item)).join('') || empty('Nenhuma entrega atribuída', state.online ? 'Aguarde uma atribuição do estabelecimento ou da Base.' : 'Fique online para começar.')}</div>`;
  $('#driver-home-online').onclick = toggleOnline;
  $('#driver-refresh-home').onclick = () => pages.dashboard();
  bindDriverCards(active);
};

const originalDeliveriesV6 = pages.deliveries;
pages.deliveries = async function() {
  if (state.user.role === 'driver') {
    const [home, history] = await Promise.all([
      api('/api/app/v6/driver/home'),
      api('/api/app/tenant/deliveries?status=delivered').catch(() => ({ items: [] }))
    ]);
    const active = home.active_deliveries || [];
    const delivered = (history.items || []).filter(item => item.assigned_driver_id === state.user.driver_id).slice(0, 30);
    $('#page-content').innerHTML = `<div class="driver-section-title"><div><p class="eyebrow">Meu trabalho</p><h2>Entregas</h2></div><button class="driver-route-button" id="make-route-selected">Montar rota</button></div>
      <div class="driver-tabs"><button class="active" data-driver-tab="active">Ativas (${active.length})</button><button data-driver-tab="history">Histórico</button></div>
      <div id="driver-delivery-tab" class="driver-order-list">${active.map(item => driverCard(item, true)).join('') || empty('Nenhuma entrega ativa','As novas atribuições aparecerão aqui.')}</div>`;
    bindDriverCards(active);
    $('#make-route-selected').onclick = () => buildSelectedRoute(active);
    $$('[data-driver-tab]').forEach(button => button.onclick = () => {
      $$('[data-driver-tab]').forEach(x => x.classList.toggle('active', x === button));
      const isHistory = button.dataset.driverTab === 'history';
      $('#driver-delivery-tab').innerHTML = isHistory
        ? delivered.map(item => driverCard(item, false)).join('') || empty('Sem entregas finalizadas')
        : active.map(item => driverCard(item, true)).join('') || empty('Nenhuma entrega ativa');
      bindDriverCards(isHistory ? delivered : active);
    });
    return;
  }
  return operationsDeliveriesV6();
};

async function operationsDeliveriesV6() {
  const [data, base] = await Promise.all([api('/api/app/tenant/deliveries'), lgBase(true)]);
  const items = data.items || [];
  const canCreateCounter = state.user.role === 'establishment';
  const canCreateBase = ['cooperative_admin','dispatcher'].includes(state.user.role);
  const tools = `<div class="toolbar">${canCreateCounter ? '<button class="btn primary" id="new-counter-order">Nova entrega de balcão</button>' : ''}${canCreateBase ? '<button class="btn primary" id="new-base-order">Nova entrega da Base</button>' : ''}</div>`;
  $('#page-content').innerHTML = panel('Central de entregas', table([
    { label:'Pedido', render:item=>`<strong>${esc(item.display_code||'—')}</strong><br><small>${dateTime(item.created_at)}</small>` },
    { label:'Origem', render:item=>`${item.delivery_type==='base'?'<span class="badge">BASE</span>':'<span class="badge">BALCÃO</span>'}<br><small>${esc(item.base_name||item.establishment_name||'')}</small>` },
    { label:'Cliente', render:item=>`<strong>${esc(item.customer_name||item.recipient_name||'Cliente')}</strong><br><small>${esc(item.customer_phone||item.recipient_phone||'')}</small>` },
    { label:'Entrega', key:'delivery_address', wrap:true },
    { label:'Cooperado', key:'driver_name' },
    { label:'Valor', render:item=>money(item.charge_cents) },
    { label:'Status', render:item=>badge(item.status) }
  ], items, item => {
    const authority = item.delivery_type === 'base'
      ? ['cooperative_admin','dispatcher'].includes(state.user.role)
      : state.user.role === 'establishment';
    return `<button class="table-action" data-op-detail="${item.id}">Ver</button>${authority && !['delivered','cancelled'].includes(item.status) ? `<button class="table-action" data-op-assign="${item.id}">Atribuir</button>` : ''}<button class="table-action" data-op-track="${item.tracking_token}">Rastreio</button>`;
  }), tools);
  $('#new-counter-order')?.addEventListener('click', () => counterOrderForm(base));
  $('#new-base-order')?.addEventListener('click', () => baseOrderForm(base));
  $$('[data-op-detail]').forEach(button => button.onclick = () => deliveryDetail(items.find(item => item.id === button.dataset.opDetail)));
  $$('[data-op-track]').forEach(button => button.onclick = () => copyText(`${location.origin}/r/${button.dataset.opTrack}`));
  $$('[data-op-assign]').forEach(button => button.onclick = () => assignV6(items.find(item => item.id === button.dataset.opAssign)));
}

function counterOrderForm(base) {
  const services = (base.services || []).filter(service => !service.base_id);
  openModal('Nova entrega de balcão', `<form id="counter-order-form" class="form-grid">
    ${field('Nome do cliente','customer_name','','text','required')}${field('Telefone','customer_phone','','tel','required')}
    ${field('Quem recebe','recipient_name')}${field('Telefone de quem recebe','recipient_phone','','tel')}
    ${textarea('Endereço completo da entrega','delivery_address','','required placeholder="Rua, número, bairro, cidade e estado"')}
    ${field('Bairro da entrega','delivery_neighborhood')}${field('Item','item_description')}
    ${selectField('Pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'pix_cooperativa',name:'PIX Cooperativa'},{id:'credit',name:'Crédito antecipado'}],'pix','Selecione','required')}
    <div class="full"><strong>Serviços adicionais</strong>${serviceChecks(services)}</div>
    ${field('Valor manual (opcional)','charge_value','','number','step="0.01" min="0" placeholder="Calculado pela rota"')}
    ${textarea('Observações','notes')}${buttons('Criar entrega')}</form>`);
  $('#counter-order-form').onsubmit = async event => {
    event.preventDefault();
    try {
      loading(true);
      const result = await api('/api/app/v6/establishment/orders', { method:'POST', body:formObject(event.currentTarget) });
      closeModal();
      await sound.play('created');
      toast(`Entrega ${result.item.display_code} criada. Agora atribua um cooperado online.`);
      pages.deliveries();
    } catch (error) { toast(error.message,'error'); }
    finally { loading(false); }
  };
}

function baseOrderForm(base) {
  openModal('Nova entrega da Base', `<form id="base-order-form" class="form-grid">
    ${selectField('Base','base_id',base.bases||[],'','Selecione','required')}
    ${field('Nome do cliente','customer_name','','text','required')}${field('Telefone','customer_phone','','tel','required')}
    ${field('Contato na coleta','pickup_contact_name')}${field('Telefone da coleta','pickup_phone','','tel')}
    ${textarea('Endereço completo da coleta','pickup_address','','required')}${field('Bairro da coleta','pickup_neighborhood')}
    ${field('Quem recebe','recipient_name')}${field('Telefone de quem recebe','recipient_phone','','tel')}
    ${textarea('Endereço completo da entrega','delivery_address','','required')}${field('Bairro da entrega','delivery_neighborhood')}
    ${field('Item','item_description')}${selectField('Pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'pix_cooperativa',name:'PIX Cooperativa'},{id:'credit',name:'Crédito antecipado'}],'pix','Selecione','required')}
    <div class="full" id="base-order-services"></div>
    ${field('Valor manual (opcional)','charge_value','','number','step="0.01" min="0" placeholder="Calculado pela rota"')}${textarea('Observações','notes')}${buttons('Criar entrega')}</form>`);
  const form = $('#base-order-form');
  form.base_id.onchange = () => {
    const services = (base.services||[]).filter(service => !service.base_id || service.base_id === form.base_id.value);
    $('#base-order-services').innerHTML = `<strong>Serviços adicionais</strong>${serviceChecks(services)}`;
  };
  form.onsubmit = async event => {
    event.preventDefault();
    try {
      loading(true);
      const result = await api('/api/app/v6/base/orders', { method:'POST', body:formObject(event.currentTarget) });
      closeModal();
      await sound.play('created');
      toast(`Entrega ${result.item.display_code} criada. Agora atribua um cooperado da Base.`);
      pages.deliveries();
    } catch (error) { toast(error.message,'error'); }
    finally { loading(false); }
  };
}

async function assignV6(delivery) {
  try {
    loading(true);
    const data = await api(`/api/app/v6/deliveries/${delivery.id}/eligible-drivers`);
    openModal('Atribuir cooperado', `<form id="v6-assign-form" class="form-grid">
      <div class="full notice">Aparecem somente cooperados online e escalados ou liberados para este local hoje.</div>
      ${selectField('Cooperado','driver_id',data.items||[],delivery.assigned_driver_id,'Selecione','required')}${buttons('Atribuir')}</form>`);
    $('#v6-assign-form').onsubmit = async event => {
      event.preventDefault();
      try {
        loading(true);
        await api(`/api/app/v6/deliveries/${delivery.id}/assign`, { method:'POST', body:formObject(event.currentTarget) });
        closeModal();
        await sound.play('assigned');
        toast('Entrega atribuída. O cooperado recebeu o aviso sonoro.');
        pages.deliveries();
      } catch (error) { toast(error.message,'error'); }
      finally { loading(false); }
    };
  } catch (error) { toast(error.message,'error'); }
  finally { loading(false); }
}

async function buildSelectedRoute(deliveries) {
  const ids = [...v6.selectedRoute].filter(id => deliveries.some(item => item.id === id));
  if (!ids.length) return toast('Selecione as entregas que deseja colocar na rota.', 'error');
  try {
    loading(true);
    const result = await api('/api/app/driver/route-plan', { method:'POST', body:{ delivery_ids:ids } });
    state.cache.v6RoutePlan = result.plan;
    await sound.play('status');
    navigate('routes');
  } catch (error) { toast(error.message,'error'); }
  finally { loading(false); }
}

const originalRoutesV6 = pages.routes;
pages.routes = async function() {
  if (state.user.role !== 'driver') return originalRoutesV6 ? originalRoutesV6() : pages.dashboard();
  let plan = state.cache.v6RoutePlan;
  const home = await api('/api/app/v6/driver/home');
  const active = home.active_deliveries || [];
  if (!plan) {
    $('#page-content').innerHTML = `<div class="driver-section-title"><div><p class="eyebrow">Organize as paradas</p><h2>Minha rota</h2></div><button id="route-build-now" class="driver-route-button">Montar rota</button></div>
      <p class="driver-help">Selecione uma ou mais entregas. A coleta sempre vem antes da entrega e o sistema ordena as paradas mais próximas.</p>
      <div class="driver-order-list">${active.map(item => driverCard(item,true)).join('') || empty('Nenhuma entrega para montar rota')}</div>`;
    bindDriverCards(active);
    $('#route-build-now').onclick = () => buildSelectedRoute(active);
    return;
  }
  $('#page-content').innerHTML = `<section class="driver-route-summary"><div><small>Distância</small><strong>${km(plan.distance_meters)}</strong></div><div><small>Tempo estimado</small><strong>${mins(plan.duration_seconds)}</strong></div><button id="open-route-maps" class="driver-main-action">Abrir no Maps</button></section>
    <div id="driver-route-map" class="map driver-route-map"></div>
    <section class="driver-route-stops"><h2>Ordem das paradas</h2>${(plan.stops||[]).map((stop,index)=>`<div><i>${index+1}</i><span><small>${stop.stop_type==='pickup'?'Coletar':'Entregar'} • ${esc(stop.display_code)}</small><strong>${esc(stop.address)}</strong></span></div>`).join('')}</section>
    <button id="clear-route-plan" class="btn full">Montar outra rota</button>`;
  renderLineMap('driver-route-map', plan.geometry, (plan.stops||[]).map(stop => ({lat:stop.latitude,lng:stop.longitude,label:stop.stop_type==='pickup'?'Coleta':'Entrega'})));
  $('#open-route-maps').onclick = () => window.open(plan.navigation_url,'_blank','noopener');
  $('#clear-route-plan').onclick = () => { state.cache.v6RoutePlan = null; v6.selectedRoute.clear(); pages.routes(); };
};

const originalFinancialV6 = pages.financial;
pages.financial = async function() {
  if (state.user.role !== 'driver') return originalFinancialV6();
  const from = state.cache.finFrom || mondayOf(isoDate());
  const to = state.cache.finTo || addDays(from,6);
  const data = await api(`/api/app/driver/finance${query({from,to})}`);
  const summary = data.summary || {};
  $('#page-content').innerHTML = `<section class="driver-wallet-card"><small>GANHOS LÍQUIDOS NO PERÍODO</small><strong>${money(summary.earnings_cents??Math.max(0,Number(summary.credits_cents||0)-Number(summary.debits_cents||0)))}</strong><span>${dateOnly(from)} até ${dateOnly(to)}</span></section>
    <div class="driver-finance-strip"><div><small>Produção</small><strong>${money(summary.credits_cents)}</strong></div><div><small>Descontos</small><strong>${money(summary.debits_cents)}</strong></div><div><small>A receber</small><strong>${money(summary.net_cents)}</strong></div><div><small>Recebido diretamente</small><strong>${money(summary.direct_received_cents)}</strong></div></div>
    <section class="driver-finance-list"><header><h2>Movimentações</h2><div><input id="v6-fin-from" type="date" value="${from}"><input id="v6-fin-to" type="date" value="${to}"><button id="v6-fin-filter" class="btn small">Filtrar</button></div></header>
      ${(data.items||[]).map(item=>`<article><div><strong>${esc(item.description)}</strong><small>${dateOnly(item.reference_date)} • ${esc(item.category)}</small></div><b class="${item.entry_type==='credit'?'positive':'negative'}">${item.entry_type==='credit'?'+':'-'} ${money(item.amount_cents)}</b></article>`).join('') || empty('Nenhuma movimentação no período')}</section>`;
  $('#v6-fin-filter').onclick = () => { state.cache.finFrom=$('#v6-fin-from').value; state.cache.finTo=$('#v6-fin-to').value; pages.financial(); };
};

// A tela do cliente é sempre tratada como aplicativo móvel, mesmo quando aberta no computador.
const originalShowCustomerV6 = showCustomer;
showCustomer = function() {
  originalShowCustomerV6();
  document.body.classList.add('customer-app-mode');
};

// A inicialização final ocorre no módulo v7.


/* ===== ligerim-v7.js ===== */
/* Ligerim 7.0 — endereços JSON confirmados, fechamento detalhado, avaliações, recibos e código de entrega */
const v7 = { addressCandidates:new Map(), trackingTimer:null };

pageMeta.ratings = ['Avaliações','★'];
pageMeta.trackingSettings = ['Permissões de rastreio','⌖'];
if (navByRole.cooperative_admin) {
  const op = navByRole.cooperative_admin.find(group => group[0] === 'Operação');
  const cfg = navByRole.cooperative_admin.find(group => group[0] === 'Configuração');
  if (op && !op[1].includes('ratings')) op[1].push('ratings');
  if (cfg && !cfg[1].includes('trackingSettings')) cfg[1].unshift('trackingSettings');
}
if (navByRole.dispatcher) {
  const op = navByRole.dispatcher.find(group => group[0] === 'Operação');
  if (op && !op[1].includes('ratings')) op[1].push('ratings');
}

function addressFields(prefix, title, defaults={}) {
  return `<fieldset class="address-confirm-card full" data-address-block="${esc(prefix)}">
    <legend>${esc(title)}</legend>
    <label class="full address-live-search-label">Buscar endereço ou nome do local
      <input type="search" data-address-autocomplete="${esc(prefix)}" autocomplete="off" placeholder="Ex.: Natal Shopping, Av. Salgado Filho 2234" aria-autocomplete="list" aria-controls="${esc(prefix)}-live-results">
    </label>
    <div class="address-live-results" id="${esc(prefix)}-live-results" data-address-live-results="${esc(prefix)}" role="listbox"></div>
    <div class="address-grid">
      ${field('Rua, avenida ou local',`${prefix}_street`,defaults.street||'','text','required autocomplete="street-address"')}
      ${field('Número',`${prefix}_number`,defaults.number||'','text','required inputmode="text"')}
      ${field('Bairro',`${prefix}_neighborhood`,defaults.neighborhood||'')}
      ${field('Cidade',`${prefix}_city`,defaults.city||'Natal','text','required')}
      ${field('Estado',`${prefix}_state`,defaults.state||'RN','text','required maxlength="2"')}
      ${field('CEP',`${prefix}_postal_code`,defaults.postal_code||'','text','inputmode="numeric"')}
    </div>
    <input type="hidden" name="${prefix}_confirmation_token" value="">
    <button type="button" class="btn soft address-search-btn" data-address-search="${esc(prefix)}">Localizar e confirmar endereço</button>
    <div class="address-confirm-result" id="${esc(prefix)}-address-results">
      <span class="muted">Comece a digitar acima. Use ↓ e ↑ para escolher e Enter para confirmar.</span>
    </div>
  </fieldset>`;
}

function addressSearchBody(form, prefix, context={}) {
  const value = name => form.elements[`${prefix}_${name}`]?.value || '';
  return {
    street:value('street'), number:value('number'), neighborhood:value('neighborhood'), city:value('city'),
    state:value('state'), postal_code:value('postal_code'), ...context
  };
}

function selectedAddressSummary(item) {
  const precision = {rooftop:'Número exato',interpolated:'Número interpolado',street:'Apenas rua',approximate:'Aproximado'}[item.precision] || item.precision;
  return `<div class="confirmed-address"><strong>✓ Endereço confirmado</strong><span>${esc(item.formatted_address)}</span><small>${esc(item.provider.toUpperCase())} • ${esc(precision)} • ${Number(item.lat).toFixed(6)}, ${Number(item.lng).toFixed(6)}</small></div>`;
}

function bindAddressSearch(form, prefix, contextProvider=()=>({})) {
  const button = form.querySelector(`[data-address-search="${prefix}"]`);
  const liveInput = form.querySelector(`[data-address-autocomplete="${prefix}"]`);
  const liveResults = form.querySelector(`[data-address-live-results="${prefix}"]`);
  if (!button && !liveInput) return;
  let timer=null,candidates=[],activeIndex=-1,requestId=0;
  const token=()=>form.elements[`${prefix}_confirmation_token`];
  const reset = () => { if(token())token().value=''; };
  const target=()=>form.querySelector(`#${prefix}-address-results`);
  ['street','number','neighborhood','city','state','postal_code'].forEach(name => form.elements[`${prefix}_${name}`]?.addEventListener('input',reset));

  const applyCandidate=item=>{
    if(!item?.confirmation_token)return toast('Escolha um resultado confirmado.','error');
    token().value=item.confirmation_token;
    form.elements[`${prefix}_street`].value=item.street||item.place_name||'';
    form.elements[`${prefix}_number`].value=item.number||'S/N';
    form.elements[`${prefix}_neighborhood`].value=item.neighborhood||'';
    form.elements[`${prefix}_city`].value=item.city||form.elements[`${prefix}_city`].value||'';
    form.elements[`${prefix}_state`].value=item.state_code||item.state||'RN';
    form.elements[`${prefix}_postal_code`].value=item.postal_code||'';
    const complement=form.elements[`${prefix}_complement`];
    if(complement&&!String(complement.value||'').trim()&&item.place_name)complement.value=item.place_name;
    if(liveInput)liveInput.value=item.place_name&&item.formatted_address&&!item.formatted_address.toLocaleLowerCase('pt-BR').startsWith(String(item.place_name).toLocaleLowerCase('pt-BR'))?`${item.place_name} — ${item.formatted_address}`:item.formatted_address;
    if(liveResults)liveResults.innerHTML='';
    const box=target();if(box)box.innerHTML=selectedAddressSummary(item);
    activeIndex=-1;
  };
  const paintActive=()=>{
    if(!liveResults)return;
    liveResults.querySelectorAll('[data-live-address-index]').forEach((el,index)=>{el.classList.toggle('active',index===activeIndex);el.setAttribute('aria-selected',index===activeIndex?'true':'false')});
    liveResults.querySelector('[data-live-address-index].active')?.scrollIntoView({block:'nearest'});
  };
  const renderCandidates=(items,message='')=>{
    candidates=items||[];activeIndex=-1;
    if(!liveResults)return;
    if(!candidates.length){liveResults.innerHTML=message?`<span class="address-warning">${esc(message)}</span>`:'';return;}
    liveResults.innerHTML=candidates.map((item,index)=>`<button type="button" role="option" aria-selected="false" data-live-address-index="${index}" ${item.confirmable?'':'disabled'}><strong>${esc(item.place_name||item.street||'Endereço')}</strong><span>${esc(item.formatted_address)}</span><small>${item.confirmable?'Selecionar endereço':'Resultado aproximado — refine a busca'}</small></button>`).join('');
    liveResults.querySelectorAll('[data-live-address-index]').forEach(el=>el.onclick=()=>applyCandidate(candidates[Number(el.dataset.liveAddressIndex)]));
  };
  const autocomplete=async queryValue=>{
    const value=String(queryValue||'').trim();
    reset();
    if(value.length<3){renderCandidates([],'Digite pelo menos 3 caracteres.');return;}
    const current=++requestId;
    if(liveResults)liveResults.innerHTML='<span class="muted">Buscando em todo o Rio Grande do Norte…</span>';
    try{
      const context=contextProvider()||{};
      const data=await api('/api/public/address/autocomplete',{method:'POST',body:{query:value,city:form.elements[`${prefix}_city`]?.value||'',state:form.elements[`${prefix}_state`]?.value||'RN',...context}});
      if(current!==requestId)return;
      renderCandidates(data.items||[],(data.items||[]).length?'':'Nenhum endereço encontrado. Tente rua e número ou o nome do local.');
    }catch(error){if(current===requestId)renderCandidates([],error.message||'Não foi possível buscar o endereço.');}
  };
  if(liveInput){
    liveInput.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>autocomplete(liveInput.value),280)});
    liveInput.addEventListener('keydown',event=>{
      const enabled=[...liveResults?.querySelectorAll('[data-live-address-index]:not(:disabled)')||[]];
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();if(!enabled.length)return;
        const indexes=enabled.map(el=>Number(el.dataset.liveAddressIndex)),pos=indexes.indexOf(activeIndex);
        activeIndex=event.key==='ArrowDown'?indexes[(pos+1+indexes.length)%indexes.length]:indexes[(pos-1+indexes.length)%indexes.length];paintActive();
      }else if(event.key==='Enter'){
        if(candidates.length){event.preventDefault();const item=candidates[activeIndex>=0?activeIndex:candidates.findIndex(x=>x.confirmable)];if(item?.confirmable)applyCandidate(item);}
      }else if(event.key==='Escape'){if(liveResults)liveResults.innerHTML='';activeIndex=-1;}
    });
  }
  if(button)button.onclick = async () => {
    const body = addressSearchBody(form,prefix,contextProvider());
    if (!body.street || !body.number || !body.city || !body.state) return toast('Informe rua/local, número, cidade e estado.','error');
    try {
      loading(true);
      const data = await api('/api/public/address/search',{method:'POST',body});
      if (!(data.items||[]).length) { const box=target();if(box)box.innerHTML = `<div class="address-warning">Nenhum endereço compatível foi encontrado em ${esc(body.city)}/${esc(body.state)}.</div>`;return; }
      v7.addressCandidates.set(prefix,data.items);
      renderCandidates(data.items||[]);
      const box=target();if(box)box.innerHTML='<span class="muted">Selecione uma das opções encontradas acima.</span>';
      liveInput?.focus();
    } catch (error) { toast(error.message,'error'); }
    finally { loading(false); }
  };
}

function requireConfirmed(form,prefix) {
  const label={pickup:'coleta',delivery:'entrega',base_address:'Base',est_address:'estabelecimento'}[prefix]||'endereço';
  if (!form.elements[`${prefix}_confirmation_token`]?.value) throw new Error(`Confirme o endereço de ${label} antes de continuar.`);
}
function bindCashLocation(form) {
  const payment=form.elements.payment_method, box=form.querySelector('[data-cash-location]');
  if(!payment)return;
  const collect=form.elements.amount_to_collect,collectBox=collect?.closest('label');
  const update=()=>{
    if(box)box.classList.toggle('hidden',payment.value!=='dinheiro');
    if(collectBox)collectBox.classList.toggle('hidden',payment.value==='cortesia');
    if(collect&&payment.value==='cortesia')collect.value='0';
  };
  payment.addEventListener('change',update);update();
}

establishmentForm = function(item={}) {
  let current={};
  try { current=JSON.parse(item.address_json||'{}'); } catch {}
  const defaults={street:current.street||'',number:current.number||'',neighborhood:current.neighborhood||'',city:current.city||item.city||'Natal',state:current.state_code||current.state||item.state||'RN',postal_code:current.postal_code||item.postal_code||''};
  openModal(item.id?'Editar estabelecimento':'Novo estabelecimento',`<form id="est-form-v7" class="form-grid">
    <label class="full cj143-file cj147-upload-box">Foto ou logo do estabelecimento<input id="cj143-est-logo" type="file" accept="image/*"><input type="hidden" name="logo_data_url"><small>Escolha uma imagem. Aguarde aparecer a prévia antes de salvar.</small>${item.logo_url?`<img class="cj147-upload-preview" src="${esc(item.logo_url)}" alt="Logo atual">`:''}</label>
    ${field('Nome fantasia','name',item.name,'text','required')}${field('Razão social','legal_name',item.legal_name)}${field('CNPJ','cnpj',item.cnpj)}
    ${field('Telefone','phone',item.phone)}${field('E-mail comercial','email',item.email,'email')}
    ${item.id&&item.address_confirmed?`<div class="full confirmed-address"><strong>✓ Endereço atual confirmado</strong><span>${esc(item.address||'')}</span><small>Localize novamente somente para trocar o endereço.</small></div>`:''}
    ${addressFields('est_address',item.id?'Novo endereço de coleta (opcional)':'Endereço exato da coleta',defaults)}
    ${field('Valor por km pela rota','rate_per_km',inputMoney(item.rate_per_km_cents||250),'number','step="0.01" min="0" required')}
    ${field('Taxa mínima','minimum_fee',inputMoney(item.minimum_fee_cents||1200),'number','step="0.01" min="0" required')}
    ${field('Taxa da cooperativa (%)','cooperative_fee_percent',item.cooperative_fee_percent||0,'number','step="0.01" min="0"')}
    ${field('Prefixo dos pedidos','order_prefix',item.order_prefix||'LG','text','maxlength="12"')}
    ${item.id?`<label class="checkbox-row full"><input type="checkbox" name="active" ${item.active?'checked':''}> Estabelecimento ativo</label>`:`<div class="full notice"><strong>Acesso do estabelecimento</strong><br>Ele poderá lançar pedidos de balcão, acompanhar entregas e configurar sua integração.</div>${field('E-mail de acesso','access_email',item.email,'email')}${field('Senha inicial','access_password','','password','minlength="8"')}`}
    ${buttons()}
  </form>`);
  const form=$('#est-form-v7');
  bindAddressSearch(form,'est_address',()=>({cooperative_id:state.user.cooperative_id,establishment_id:item.id||''}));
  form.onsubmit=async event=>{
    event.preventDefault();
    try{
      loading(true);
      if(!item.id) requireConfirmed(form,'est_address');
      const body=formObject(form), token=form.elements.est_address_confirmation_token.value;
      body.address=item.address||[body.est_address_street,body.est_address_number,body.est_address_neighborhood,body.est_address_city,body.est_address_state,body.est_address_postal_code].filter(Boolean).join(', ');
      body.city=body.est_address_city;body.state=body.est_address_state;body.postal_code=body.est_address_postal_code;
      let establishmentId=item.id;
      if(item.id) await api(`/api/app/establishments/${item.id}`,{method:'PUT',body});
      else { const result=await api('/api/app/establishments',{method:'POST',body}); establishmentId=result.item.id; }
      if(token) await api(`/api/app/v7/establishments/${establishmentId}/address`,{method:'PUT',body:{confirmation_token:token}});
      if(!item.id&&body.access_email&&body.access_password) await api(`/api/app/establishments/${establishmentId}/access`,{method:'POST',body:{name:body.name,email:body.access_email,password:body.access_password}});
      closeModal();clearTenantCache();toast('Estabelecimento salvo com endereço confirmado.');pages.establishments();
    }catch(error){toast(error.message,'error')}finally{loading(false)}
  };
};

counterOrderForm = async function(base) {
  let establishment=(base.establishments||[]).find(item=>item.id===state.user.establishment_id)||{};
  try { const profile=await api('/api/app/v7/establishment/profile'); establishment=profile.item||establishment; } catch {}
  const needsOrigin=!Number(establishment.address_confirmed||0);
  const services=(base.services||[]).filter(service=>!service.base_id);
  openModal('Nova entrega de balcão',`<form id="counter-order-form" class="form-grid">
    ${needsOrigin?`<div class="full notice"><strong>Primeiro uso:</strong> confirme o endereço e o número do estabelecimento. Ele será salvo como origem das próximas entregas.</div>${addressFields('pickup','Endereço do estabelecimento',{city:establishment.city||'Natal',state:establishment.state||'RN'})}`:''}
    ${field('Nome do cliente','customer_name','','text','required')}${field('Telefone do cliente','customer_phone','','tel','required')}
    ${field('Quem recebe','recipient_name')}${field('Telefone de quem recebe','recipient_phone','','tel')}
    ${addressFields('delivery','Endereço de entrega',{city:establishment.city||'Natal',state:establishment.state||'RN'})}
    ${field('Item','item_description')}
    ${selectField('Pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'pix_cooperativa',name:'PIX Cooperativa'},{id:'credit',name:'Crédito antecipado'}],'pix','Selecione','required')}
    <label class="hidden" data-cash-location>Receber dinheiro em<select name="cash_payment_location"><option value="pickup">Na coleta</option><option value="delivery">Na entrega</option></select></label>
    <div class="full"><strong>Serviços adicionais</strong>${serviceChecks(services)}</div>
    ${field('Valor manual (opcional)','charge_value','','number','step="0.01" min="0" placeholder="Vazio = valor pela rota"')}
    ${textarea('Observações','notes')}${buttons('Criar entrega')}</form>`);
  const form=$('#counter-order-form');
  if(needsOrigin)bindAddressSearch(form,'pickup',()=>({establishment_id:state.user.establishment_id}));
  bindAddressSearch(form,'delivery',()=>({establishment_id:state.user.establishment_id}));bindCashLocation(form);
  form.onsubmit=async event=>{
    event.preventDefault();
    try{
      loading(true);requireConfirmed(form,'delivery');
      if(needsOrigin){requireConfirmed(form,'pickup');await api('/api/app/v7/establishment/address',{method:'PUT',body:{confirmation_token:form.elements.pickup_confirmation_token.value}});}
      const result=await api('/api/app/v7/establishment/orders',{method:'POST',body:formObject(form)});
      closeModal();await sound.play('created');toast(`Entrega ${result.item.display_code} criada. Código do cliente: ${result.item.confirmation_code}`);state.cache.lgBaseKey='';pages.deliveries();
    }catch(error){toast(error.message,'error')}finally{loading(false)}
  };
};

baseForm = function(item={}) {
  let current={};
  try { current=JSON.parse(item.address_json||'{}'); } catch {}
  const defaults={
    street:current.street||'',number:current.number||'',neighborhood:current.neighborhood||'',
    city:current.city||item.city||'Natal',state:current.state_code||current.state||item.state||'RN',postal_code:current.postal_code||item.postal_code||''
  };
  openModal(item.id?'Editar Base':'Nova Base',`<form id="base-form-v7" class="form-grid">
    ${field('Nome da Base','name',item.name,'text','required')}
    ${item.id&&item.address_confirmed?`<div class="full confirmed-address"><strong>✓ Endereço atual confirmado</strong><span>${esc(item.address||'')}</span><small>Localize novamente somente para trocar o endereço.</small></div>`:''}
    ${addressFields('base_address',item.id?'Novo endereço da Base (opcional)':'Endereço exato da Base',defaults)}
    ${field('Taxa mínima','minimum_fee',inputMoney(item.minimum_fee_cents||1200),'number','step="0.01" min="0" required')}
    ${field('Valor por km','rate_per_km',inputMoney(item.rate_per_km_cents||250),'number','step="0.01" min="0" required')}
    ${field('Taxa da cooperativa (%)','cooperative_fee_percent',item.cooperative_fee_percent||0,'number','step="0.01" min="0"')}
    ${item.id?`<label class="checkbox-row full"><input type="checkbox" name="active" ${item.active?'checked':''}> Base ativa</label>`:''}
    ${buttons()}
  </form>`);
  const form=$('#base-form-v7');
  bindAddressSearch(form,'base_address',()=>({cooperative_id:state.user.cooperative_id,base_id:item.id||''}));
  form.onsubmit=async event=>{
    event.preventDefault();
    try{
      loading(true);
      if(!item.id) requireConfirmed(form,'base_address');
      const body=formObject(form);
      body.confirmation_token=form.elements.base_address_confirmation_token.value||null;
      await api(`/api/app/v7/bases${item.id?`/${item.id}`:''}`,{method:item.id?'PUT':'POST',body});
      closeModal();clearTenantCache();toast('Base salva com endereço confirmado.');pages.bases();
    }catch(error){toast(error.message,'error')}finally{loading(false)}
  };
};

baseOrderForm = function(base) {
  openModal('Nova entrega da Base',`<form id="base-order-form" class="form-grid">
    ${selectField('Base','base_id',base.bases||[],'','Selecione','required')}
    ${field('Nome do cliente','customer_name','','text','required')}${field('Telefone do cliente','customer_phone','','tel','required')}
    ${field('Contato na coleta','pickup_contact_name')}${field('Telefone da coleta','pickup_phone','','tel')}
    ${addressFields('pickup','Endereço de coleta',{city:'Natal',state:'RN'})}
    ${field('Quem recebe','recipient_name')}${field('Telefone de quem recebe','recipient_phone','','tel')}
    ${addressFields('delivery','Endereço de entrega',{city:'Natal',state:'RN'})}
    ${field('Item','item_description')}
    ${selectField('Pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'pix_cooperativa',name:'PIX Cooperativa'},{id:'credit',name:'Crédito antecipado'}],'pix','Selecione','required')}
    <label class="hidden" data-cash-location>Receber dinheiro em<select name="cash_payment_location"><option value="pickup">Na coleta</option><option value="delivery">Na entrega</option></select></label>
    <div class="full" id="base-order-services"></div>
    ${field('Valor manual (opcional)','charge_value','','number','step="0.01" min="0" placeholder="Vazio = cálculo por rota"')}${textarea('Observações','notes')}${buttons('Criar entrega')}</form>`);
  const form=$('#base-order-form');
  const context=()=>({base_id:form.base_id.value});
  bindAddressSearch(form,'pickup',context);bindAddressSearch(form,'delivery',context);bindCashLocation(form);
  form.base_id.onchange=()=>{const selected=(base.bases||[]).find(x=>x.id===form.base_id.value);if(selected){for(const p of ['pickup','delivery']){form.elements[`${p}_city`].value=selected.city||'Natal';form.elements[`${p}_state`].value=selected.state||'RN';}}const list=(base.services||[]).filter(service=>!service.base_id||service.base_id===form.base_id.value);$('#base-order-services').innerHTML=`<strong>Serviços adicionais</strong>${serviceChecks(list)}`;};
  form.onsubmit=async event=>{event.preventDefault();try{loading(true);requireConfirmed(form,'pickup');requireConfirmed(form,'delivery');const result=await api('/api/app/v7/base/orders',{method:'POST',body:formObject(form)});closeModal();await sound.play('created');toast(`Entrega ${result.item.display_code} criada. Código do cliente: ${result.item.confirmation_code}`);pages.deliveries()}catch(error){toast(error.message,'error')}finally{loading(false)}};
};

// Central de entregas com remoção, clonagem e rastreio controlado.
operationsDeliveriesV6 = async function() {
  const [data,base]=await Promise.all([api('/api/app/tenant/deliveries'),lgBase(true)]),items=data.items||[];
  const canCounter=state.user.role==='establishment',canBase=['cooperative_admin','dispatcher'].includes(state.user.role);
  const tools=`<div class="toolbar">${canCounter?'<button class="btn primary" id="new-counter-order">Nova entrega de balcão</button>':''}${canBase?'<button class="btn primary" id="new-base-order">Nova entrega da Base</button>':''}</div>`;
  $('#page-content').innerHTML=panel('Central de entregas',table([
    {label:'Pedido',render:item=>`<strong>${esc(item.display_code||'—')}</strong><br><small>${dateTime(item.created_at)}</small>`},
    {label:'Origem',render:item=>`${item.delivery_type==='base'?'<span class="badge">BASE</span>':'<span class="badge">BALCÃO</span>'}<br><small>${esc(item.base_name||item.establishment_name||'')}</small>`},
    {label:'Cliente',render:item=>`<strong>${esc(item.customer_name||item.recipient_name||'Cliente')}</strong><br><small>${esc(item.customer_phone||item.recipient_phone||'')}</small>`},
    {label:'Entrega',key:'delivery_address',wrap:true},{label:'Cooperado',key:'driver_name'},{label:'Valor',render:item=>money(item.charge_cents)},{label:'Status',render:item=>badge(item.status)}
  ],items,item=>{
    const authority=item.delivery_type==='base'?canBase:canCounter;
    const active=!['delivered','cancelled'].includes(item.status);
    return `<button class="table-action" data-op-detail="${item.id}">Ver</button>${authority&&active?`<button class="table-action" data-op-assign="${item.id}">Atribuir</button>`:''}${Number(item.tracking_enabled??1)===1&&item.tracking_token?`<button class="table-action" data-op-track="${item.tracking_token}">Rastreio</button>`:''}${canBase&&item.delivery_type==='base'?`<button class="table-action" data-op-clone="${item.id}">Clonar</button>`:''}${authority&&item.status!=='delivered'?`<button class="table-action danger" data-op-remove="${item.id}">Remover</button>`:''}`;
  }),tools);
  $('#new-counter-order')?.addEventListener('click',()=>counterOrderForm(base));$('#new-base-order')?.addEventListener('click',()=>baseOrderForm(base));
  $$('[data-op-detail]').forEach(button=>button.onclick=()=>deliveryDetail(items.find(item=>item.id===button.dataset.opDetail)));
  $$('[data-op-track]').forEach(button=>button.onclick=()=>copyText(`${location.origin}/r/${button.dataset.opTrack}`));
  $$('[data-op-assign]').forEach(button=>button.onclick=()=>assignV6(items.find(item=>item.id===button.dataset.opAssign)));
  $$('[data-op-remove]').forEach(button=>button.onclick=async()=>{if(!confirm('Remover e cancelar esta entrega?'))return;try{await api(`/api/app/v7/deliveries/${button.dataset.opRemove}`,{method:'DELETE'});toast('Entrega removida.');pages.deliveries()}catch(error){toast(error.message,'error')}});
  $$('[data-op-clone]').forEach(button=>button.onclick=async()=>{if(!confirm('Clonar esta entrega da Base com novo número e novo código?'))return;try{loading(true);const result=await api(`/api/app/v7/base/deliveries/${button.dataset.opClone}/clone`,{method:'POST',body:{}});toast(`Nova entrega ${result.item.display_code} criada.`);await pages.deliveries();loading(false);if(result.item?.id&&window.ChegaJaV32?.assignFromBase)await window.ChegaJaV32.assignFromBase(result.item.id)}catch(error){toast(error.message,'error')}finally{loading(false)}});
};

// Cooperado conclui exclusivamente com o código do cliente.
driverStatusButton = function(delivery) {
  const action={assigned:['Aceitar','accept'],accepted:['Ir buscar','to_pickup'],to_pickup:['Cheguei','at_pickup'],at_pickup:['Coletado','picked_up'],picked_up:['Iniciar entrega','in_route'],in_route:['Confirmar entrega','confirm_delivery']}[delivery.status];
  return action?`<button class="driver-main-action" data-driver-action="${action[1]}" data-delivery="${delivery.id}">${action[0]}</button>`:'';
};
driverAction = async function(delivery,action) {
  if(action==='confirm_delivery'){
    openModal(`Confirmar ${delivery.display_code}`,`<form id="delivery-code-form" class="form-grid"><div class="full notice">Peça ao cliente o código de 4 dígitos exibido no acompanhamento. O telefone do cliente da Base permanece protegido.</div>${field('Código de entrega','confirmation_code','','text','required inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="one-time-code"')}${buttons('Finalizar entrega')}</form>`);
    $('#delivery-code-form').onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/v7/driver/deliveries/${delivery.id}/confirm-delivery`,{method:'POST',body:formObject(event.currentTarget)});closeModal();await sound.play('completed');toast('Entrega finalizada e lançada no financeiro.');navigate(state.page,false)}catch(error){toast(error.message,'error')}finally{loading(false)}};
    return;
  }
  try{loading(true);if(action==='accept'){await api(`/api/app/v6/driver/deliveries/${delivery.id}/accept`,{method:'POST',body:{}});await sound.play('accepted')}else{await api(`/api/app/v6/driver/deliveries/${delivery.id}/status`,{method:'POST',body:{status:action}});await sound.play('status')}toast('Entrega atualizada.');await navigate(state.page,false)}catch(error){toast(error.message,'error')}finally{loading(false)}
};

// Fechamento semanal detalhado.
pages.closings = async function() {
  const week=state.cache.closeWeek||mondayOf(isoDate());
  const base=await lgBase();
  const driverId=state.cache.closeDriver||'',establishmentId=state.cache.closeEst||'';
  await api('/api/app/financial/reconcile',{method:'POST',body:{driver_id:driverId}}).catch(()=>{});
  const detail=await api(`/api/app/v7/weekly-summary${query({week_start:week,driver_id:driverId,establishment_id:establishmentId})}`);
  const history=await api('/api/app/tenant/weekly-closes');
  const filters=`<div class="toolbar"><input id="close-week" type="date" value="${week}">${selectField('','close-driver',base.drivers||[],driverId,'Todos os cooperados')}${selectField('','close-est',base.establishments||[],establishmentId,'Todos os estabelecimentos')}<button class="btn" id="close-filter">Filtrar</button><button class="btn primary" id="confirm-close">Fechar semana</button></div>`;
  const driverRows=(detail.drivers||[]).map(driver=>`<article class="closing-driver-card"><header><div><strong>${esc(driver.name)}</strong><small>${driver.deliveries_count} entregas</small></div><div><span>Produção p/ fechamento <b>${money(driver.production_cents)}</b></span><span>Já recebida <b>${money(driver.direct_received_cents)}</b></span><span>Descontos <b>${money(driver.discounts_cents)}</b></span><span>${Number(driver.net_cents)<0?'Saldo pendente':'A receber'} <b>${money(driver.net_cents)}</b></span></div></header><div class="closing-days">${driver.days.map(day=>`<section><button type="button" class="closing-day-toggle" data-close-day="${driver.id}:${day.date}"><span>＋</span><strong>${dateOnly(day.date)}</strong><em>${day.deliveries.length} entregas</em><b>${money(day.production_cents)} − ${money(day.discounts_cents)} = ${money(day.net_cents)}</b><small>Já recebido: ${money(day.direct_received_cents)}</small></button><div class="closing-day-detail hidden" id="close-${driver.id}-${day.date}">${day.deliveries.map(delivery=>`<div><span>${esc(delivery.display_code)} • ${esc(delivery.establishment_name||delivery.base_name||'')}</span><small>${esc(delivery.delivery_address)} • ${delivery.financial_class==='production_received'?'produção já recebida':'produção para fechamento'}</small><strong>${money(delivery.driver_gross_cents)}</strong></div>`).join('')||'<p class="muted">Sem entregas.</p>'}</div></section>`).join('')}</div></article>`).join('')||empty('Nenhuma produção nesta semana');
  $('#page-content').innerHTML=cards([{icon:'▣',value:detail.totals.deliveries_count,label:'Entregas concluídas'},{icon:'＋',value:money(detail.totals.driver_production_cents),label:'Produção para fechamento'},{icon:'✓',value:money(detail.totals.direct_received_cents),label:'Produção já recebida'},{icon:'％',value:money(detail.totals.discounts_cents),label:'Descontos dos cooperados'},{icon:'=',value:money(detail.totals.driver_net_cents),label:Number(detail.totals.driver_net_cents)<0?'Saldo pendente':'Líquido a pagar'}])+panel(`Fechamento: ${dateOnly(detail.week_start)} a ${dateOnly(detail.week_end)}`,`<div class="notice"><strong>Ordem dos descontos:</strong> INSS, SEST/SENAT, adiantamentos, impostos e rateios, depois as demais despesas. Produção já recebida pelo cooperado na Base não paga descontos.</div>${driverRows}`,filters)+panel('Movimento por estabelecimento e Base',table([{label:'Estabelecimento/Base',key:'name'},{label:'Entregas',key:'deliveries_count'},{label:'Valor das entregas',render:item=>`<strong>${money(item.total_due_cents)}</strong>`},{label:'Por dia',render:item=>Object.entries(item.days||{}).map(([day,value])=>`${dateOnly(day)}: ${money(value)}`).join('<br>')}],detail.establishments||[]))+panel('Fechamentos anteriores',table([{label:'Semana',render:item=>`${dateOnly(item.week_start)} a ${dateOnly(item.week_end)}`},{label:'Produção para fechamento',render:item=>money(item.total_gross_cents)},{label:'Descontos',render:item=>money(Number(item.total_deductions_cents||0)+Number(item.total_advances_cents||0))},{label:'Saldo',render:item=>money(item.total_net_cents)},{label:'Status',render:item=>badge(item.status)}],history.items||[]));
  $$('[data-close-day]').forEach(button=>button.onclick=()=>{const id=`#close-${button.dataset.closeDay.replace(':','-')}`;$(id)?.classList.toggle('hidden');button.querySelector('span').textContent=$(id)?.classList.contains('hidden')?'＋':'−'});
  $('#close-filter').onclick=()=>{state.cache.closeWeek=mondayOf($('#close-week').value);state.cache.closeDriver=$('#close-driver').value;state.cache.closeEst=$('#close-est').value;pages.closings()};
  $('#confirm-close').onclick=async()=>{if(!confirm(`Fechar oficialmente a semana de ${dateOnly(detail.week_start)} a ${dateOnly(detail.week_end)}?`))return;try{loading(true);await api('/api/app/tenant/weekly-close',{method:'POST',body:{week_start:detail.week_start}});toast('Semana fechada. Os descontos sem saldo foram levados para a próxima semana.');pages.closings()}catch(error){toast(error.message,'error')}finally{loading(false)}};
};

pages.ratings = async function() {
  const today=isoDate(),from=state.cache.ratingFrom||today,to=state.cache.ratingTo||today,driverId=state.cache.ratingDriver||'';
  const base=await lgBase().catch(()=>({drivers:[]}));
  const data=await api(`/api/app/v7/ratings${query({from,to,driver_id:driverId})}`);
  const filters=`<div class="ratings-filter-bar"><label>Data inicial<input id="rating-from" type="date" value="${esc(from)}"></label><label>Data final<input id="rating-to" type="date" value="${esc(to)}"></label>${selectField('Cooperado','rating-driver',base.drivers||[],driverId,'Todos os cooperados')}<button class="btn primary" id="rating-filter">Filtrar avaliações</button><button class="btn" id="rating-today">Hoje</button></div>`;
  $('#page-content').innerHTML=`${panel('Filtros das avaliações',filters)}<div class="notice"><strong>Por padrão, a tela mostra somente as avaliações de hoje.</strong> Selecione um período e um cooperado, ou mantenha “Todos os cooperados”.</div>${panel('Notas dos cooperados no período',table([{label:'Cooperado',key:'name'},{label:'Nota',render:item=>`<strong class="rating-score">★ ${Number(item.score).toFixed(2)}</strong>`},{label:'Avaliações',key:'count'}],data.driver_scores||[]))}${panel('Notas dos estabelecimentos no período',table([{label:'Estabelecimento',key:'name'},{label:'Nota',render:item=>`<strong class="rating-score">★ ${Number(item.score).toFixed(2)}</strong>`},{label:'Avaliações',key:'count'}],data.establishment_scores||[]))}${panel(`Avaliações de ${dateOnly(from)} até ${dateOnly(to)}`,table([{label:'Data',render:item=>dateTime(item.created_at)},{label:'Origem',render:item=>item.rating_type==='shift'?'<strong>Fim de turno</strong>':esc(item.display_code||'Entrega')},{label:'Estabelecimento',render:item=>`${esc(item.establishment_name)}${item.establishment_score?`<br>★ ${item.establishment_score}`:''}`},{label:'Cooperado',render:item=>`${esc(item.driver_name||'—')}<br>${item.driver_score?`★ ${item.driver_score}`:'—'}`},{label:'Comentário',key:'comment',wrap:true}],data.items||[]))}`;
  $('#rating-filter').onclick=()=>{const nextFrom=$('#rating-from').value,nextTo=$('#rating-to').value;if(!nextFrom||!nextTo)return toast('Informe as duas datas.','error');if(nextFrom>nextTo)return toast('A data inicial não pode ser maior que a final.','error');state.cache.ratingFrom=nextFrom;state.cache.ratingTo=nextTo;state.cache.ratingDriver=$('#rating-driver').value;pages.ratings()};
  $('#rating-today').onclick=()=>{state.cache.ratingFrom=today;state.cache.ratingTo=today;state.cache.ratingDriver='';pages.ratings()};
};

pages.trackingSettings = async function() {
  const data=await api('/api/app/v7/tracking-settings');
  const switchRow=(kind,item)=>`<div class="tracking-setting-row"><div><strong>${esc(item.name)}</strong><small>${kind==='bases'?'Clientes da Base':'Clientes do estabelecimento'}</small></div><label class="switch"><input type="checkbox" data-track-setting="${kind}:${item.id}" ${Number(item.tracking_enabled)===1?'checked':''}><span></span></label></div>`;
  $('#page-content').innerHTML=panel('Controle de rastreamento',`<div class="notice">A cooperativa pode ativar ou desativar a visualização do cooperado para cada estabelecimento e para cada Base. A entrega continua funcionando quando o rastreamento está desligado.</div><div class="tracking-setting-row featured"><div><strong>Padrão dos clientes da Base</strong><small>Controle geral para novos pedidos</small></div><label class="switch"><input id="base-track-default" type="checkbox" ${data.base_tracking_enabled?'checked':''}><span></span></label></div><h3>Estabelecimentos</h3>${(data.establishments||[]).map(item=>switchRow('establishments',item)).join('')||empty()}<h3>Bases</h3>${(data.bases||[]).map(item=>switchRow('bases',item)).join('')||empty()}`);
  $('#base-track-default').onchange=async event=>{try{await api('/api/app/v7/tracking-settings/base-default',{method:'PUT',body:{enabled:event.target.checked}});toast('Permissão atualizada.')}catch(error){event.target.checked=!event.target.checked;toast(error.message,'error')}};
  $$('[data-track-setting]').forEach(input=>input.onchange=async()=>{const [kind,id]=input.dataset.trackSetting.split(':');try{await api(`/api/app/v7/tracking-settings/${kind}/${id}`,{method:'PUT',body:{enabled:input.checked}});toast('Permissão atualizada.')}catch(error){input.checked=!input.checked;toast(error.message,'error')}});
};

// Aplicativo do cliente da Base, com endereço confirmado, código, recibo e avaliações.
renderCustomerRequest = function(balance) {
  const catalog=lg.catalog||{},bases=catalog.bases||[];
  $('#client-tab-body').innerHTML=`<section class="customer-card"><form id="client-order" class="form-grid">
    ${selectField('Cooperativa','cooperative_id',catalog.cooperatives||[],'','Selecione','required')}<label>Base<select name="base_id" id="client-base" required><option value="">Selecione a cooperativa primeiro</option></select></label>
    ${addressFields('pickup','Endereço de coleta',{city:'Natal',state:'RN'})}${field('Nome/contato na coleta','pickup_contact_name')}${field('Telefone da coleta','pickup_phone','','tel')}
    ${addressFields('delivery','Endereço de entrega',{city:'Natal',state:'RN'})}${field('Nome de quem recebe','recipient_name')}${field('Telefone de quem recebe','recipient_phone','','tel')}
    ${field('O que será transportado','item_description')}${selectField('Forma de pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'credit',name:`Créditos ChegaJá (${money(balance)})`}],'pix','Selecione','required')}
    <label class="hidden" data-cash-location>Onde o dinheiro será pago?<select name="cash_payment_location"><option value="pickup">Na coleta</option><option value="delivery">Na entrega</option></select></label>
    <div class="full" id="client-services"></div>${textarea('Detalhes da coleta e da entrega','notes')}
    <div class="full quote-result" id="client-quote-result">Confirme os dois endereços para calcular a distância exata pela rota.</div><div class="form-actions"><button class="btn soft" type="button" id="client-quote-btn">Ver valor e rota</button><button class="btn primary" type="submit">Confirmar entrega</button></div></form></section>`;
  const form=$('#client-order'),coop=form.elements.cooperative_id,baseSelect=$('#client-base');
  const context=()=>({cooperative_id:coop.value,base_id:baseSelect.value});bindAddressSearch(form,'pickup',context);bindAddressSearch(form,'delivery',context);bindCashLocation(form);
  coop.onchange=()=>{const list=bases.filter(item=>item.cooperative_id===coop.value);baseSelect.innerHTML=`<option value="">Selecione</option>${list.map(item=>`<option value="${item.id}">${esc(item.name)} • mín. ${money(item.minimum_fee_cents)}</option>`).join('')}`;$('#client-services').innerHTML=''};
  baseSelect.onchange=()=>{const selected=bases.find(item=>item.id===baseSelect.value);if(selected){for(const prefix of ['pickup','delivery']){form.elements[`${prefix}_city`].value=selected.city||'Natal';form.elements[`${prefix}_state`].value=selected.state||'RN';}}const list=(catalog.services||[]).filter(item=>item.cooperative_id===coop.value&&(!item.base_id||item.base_id===baseSelect.value));$('#client-services').innerHTML=`<strong>Serviços adicionais</strong>${serviceChecks(list)}`;};
  const quote=async()=>{requireConfirmed(form,'pickup');requireConfirmed(form,'delivery');const result=await clientApi('/quote',{method:'POST',body:formObject(form)});lg.quote=result.quote;$('#client-quote-result').innerHTML=routeSummary(result.quote);return result.quote};
  $('#client-quote-btn').onclick=async()=>{try{loading(true);await quote()}catch(error){toast(error.message,'error')}finally{loading(false)}};
  form.onsubmit=async event=>{event.preventDefault();try{loading(true);const q=await quote();if(!confirm(`Confirmar a entrega por ${money(q.charge_cents)}?`))return;const result=await clientApi('/orders',{method:'POST',body:formObject(form)});toast(`Pedido ${result.order.display_code} criado. Seu código é ${result.order.confirmation_code}.`);renderCustomerHome('orders')}catch(error){toast(error.message,'error')}finally{loading(false)}};
};

renderCustomerOrders = function(items) {
  $('#client-tab-body').innerHTML=`<section class="customer-card"><div class="client-order-cards">${items.map(item=>`<article class="client-order-card"><header><div><strong>${esc(item.display_code||'Aguardando')}</strong><small>${dateTime(item.created_at)} • ${esc(item.base_name||'Base')}</small></div>${badge(item.delivery_status||item.status)}</header><div class="confirmation-code"><small>CÓDIGO PARA FINALIZAR</small><strong>${esc(item.confirmation_code||'----')}</strong><span>Informe somente ao cooperado quando receber o pedido.</span></div><div class="client-route-mini"><span><small>Coleta</small>${esc(item.pickup_address)}</span><span><small>Entrega</small>${esc(item.delivery_address)}</span></div><footer><strong>${money(item.quoted_cents)}</strong><div>${item.tracking_url?`<button class="btn small" data-client-track="${esc(item.tracking_url)}">Rastrear e conversar</button>`:''}${item.receipt_url?`<button class="btn small" data-client-receipt="${esc(item.receipt_url)}">Recibo</button>`:''}</div></footer></article>`).join('')||empty('Nenhum pedido')}</div></section>`;
  $$('[data-client-track]').forEach(button=>button.onclick=()=>location.href=button.dataset.clientTrack);
  $$('[data-client-receipt]').forEach(button=>button.onclick=()=>openReceipt(button.dataset.clientReceipt));
};

async function openReceipt(url) {
  try{const data=await api(url),r=data.receipt;openModal(`Recibo ${r.receipt_number}`,`<div class="receipt" id="print-receipt"><img src="/icons/logo-official.png" alt="ChegaJá"><h2>Recibo de entrega</h2><p><strong>${esc(r.receipt_number)}</strong></p><dl><dt>Cooperativa</dt><dd>${esc(r.cooperative_name)}</dd><dt>Base</dt><dd>${esc(r.base_name)}</dd><dt>Cliente</dt><dd>${esc(r.customer_name)}</dd><dt>Pedido</dt><dd>${esc(r.display_code)}</dd><dt>Coleta</dt><dd>${esc(r.pickup_address)}</dd><dt>Entrega</dt><dd>${esc(r.delivery_address)}</dd><dt>Pagamento</dt><dd>${esc(r.payment_method)} ${r.cash_payment_location?`• ${r.cash_payment_location==='pickup'?'na coleta':'na entrega'}`:''}</dd><dt>Valor</dt><dd>${money(r.amount_cents)}</dd><dt>Concluída</dt><dd>${dateTime(r.delivered_at)}</dd></dl></div><div class="form-actions"><button class="btn primary" id="print-receipt-button">Imprimir ou salvar PDF</button></div>`);$('#print-receipt-button').onclick=()=>window.print()}catch(error){toast(error.message,'error')}
}

// Rastreamento público com código, chat, recibo e avaliação.
publicTracking = async function(token) {
  $('#auth-screen').classList.add('hidden');$('#app-shell').classList.add('hidden');$('#customer-screen').classList.add('hidden');
  const screen=$('#tracking-screen');screen.classList.remove('hidden');
  const render=async()=>{
    try{
      const data=await api(`/api/public/tracking/${encodeURIComponent(token)}`),item=data.item,geometry=parseGeometry(item.route_geometry),steps=['assigned','accepted','to_pickup','at_pickup','picked_up','in_route','delivered'],index=steps.indexOf(item.status);
      screen.innerHTML=`<div class="tracking-card"><header class="tracking-head"><div class="tracking-brand"><img src="/icons/icon-official.png" alt=""><div><p class="eyebrow">ChegaJá em tempo real</p><h1>${esc(item.display_code||'Sua entrega')}</h1><p>${esc(item.establishment_name||item.base_name||'')}</p></div></div>${badge(item.status)}</header><div class="tracking-body">
        <div class="public-code"><small>CÓDIGO DE CONFIRMAÇÃO</small><strong>${esc(item.confirmation_code||'----')}</strong><span>Informe ao cooperado somente quando o pedido chegar.</span></div>
        <div class="tracking-address"><div class="address-box"><small>Coleta</small><strong>${esc(item.pickup_address)}</strong></div><div class="address-box"><small>Entrega</small><strong>${esc(item.delivery_address)}</strong></div></div>
        <div class="tracking-timeline">${steps.map((step,i)=>`<div class="tracking-step ${i<=index?'done':''}"><span class="step-dot"></span><div><strong>${statusText[step]}</strong>${i===index?'<small>Status atual</small>':''}</div></div>`).join('')}</div>
        <div id="public-map" class="map small"></div><div class="tracking-info"><span><small>Cooperado</small><strong>${esc(item.driver_name||'Aguardando')}</strong></span><span><small>Distância pela rota</small><strong>${km(item.distance_meters)}</strong></span><span><small>Previsão</small><strong>${mins(item.duration_seconds)}</strong></span><span><small>Pagamento</small><strong>${esc(item.payment_method||'—')} ${item.cash_payment_location?`• ${item.cash_payment_location==='pickup'?'na coleta':'na entrega'}`:''}</strong></span></div>
        <section class="public-chat"><header><h2>Conversa da entrega</h2><button class="btn small" id="refresh-public-chat">Atualizar</button></header><div id="public-chat-messages"></div><form id="public-chat-form" class="chat-form"><input name="message" maxlength="500" placeholder="Mensagem para o cooperado"><button class="btn primary">Enviar</button></form></section>
        ${item.rating_available?`<section class="public-rating"><h2>Avalie a entrega</h2><form id="public-rating-form" class="form-grid"><label>Estabelecimento<select name="establishment_score" required>${[5,4,3,2,1].map(n=>`<option value="${n}">${'★'.repeat(n)} (${n})</option>`).join('')}</select></label><label>Cooperado<select name="driver_score" required>${[5,4,3,2,1].map(n=>`<option value="${n}">${'★'.repeat(n)} (${n})</option>`).join('')}</select></label>${textarea('Comentário','comment')}<button class="btn primary full">Enviar avaliação</button></form></section>`:''}
        ${item.receipt_available?'<button class="btn full" id="public-receipt">Gerar meu recibo</button>':''}
      </div></div>`;
      renderLineMap('public-map',geometry,[{lat:item.pickup_lat,lng:item.pickup_lng,label:'Coleta'},{lat:item.delivery_lat,lng:item.delivery_lng,label:'Entrega'},{lat:item.driver_lat,lng:item.driver_lng,label:item.driver_name||'Cooperado'}]);
      const loadMessages=async()=>{try{const messages=await api(`/api/public/tracking/${encodeURIComponent(token)}/messages`);$('#public-chat-messages').innerHTML=(messages.items||[]).map(message=>`<div class="chat-message ${message.sender_type==='customer'?'mine':''}"><small>${esc(message.sender_name)} • ${dateTime(message.created_at)}</small><p>${esc(message.message)}</p></div>`).join('')||'<p class="muted">Nenhuma mensagem.</p>';$('#public-chat-form')?.classList.toggle('hidden',!messages.active)}catch{}};
      await loadMessages();$('#refresh-public-chat')?.addEventListener('click',loadMessages);$('#public-chat-form')?.addEventListener('submit',async event=>{event.preventDefault();try{await api(`/api/public/tracking/${encodeURIComponent(token)}/messages`,{method:'POST',body:formObject(event.currentTarget)});const activeForm=$('#public-chat-form');if(activeForm?.isConnected)activeForm.elements.message.value='';await loadMessages()}catch(error){toast(error.message,'error')}});
      $('#public-rating-form')?.addEventListener('submit',async event=>{event.preventDefault();try{await api(`/api/public/tracking/${encodeURIComponent(token)}/rating`,{method:'POST',body:formObject(event.currentTarget)});toast('Obrigado pela avaliação.');await render()}catch(error){toast(error.message,'error')}});
      $('#public-receipt')?.addEventListener('click',()=>openReceipt(`/api/public/tracking/${encodeURIComponent(token)}/receipt`));
    }catch(error){screen.innerHTML=`<div class="tracking-card"><div class="tracking-body">${empty('Rastreamento indisponível',error.message)}</div></div>`}
  };
  await render();clearInterval(v7.trackingTimer);v7.trackingTimer=setInterval(()=>{if(!document.hidden&&!screen.querySelector('input:focus,textarea:focus,select:focus'))render()},12000);
};

// Inicialização transferida para o módulo Ligerim 8.0.


/* ===== ligerim-v8.js ===== */
/* Ligerim 8.0 — escala em grade, impressão, trocas e permissões por usuário */
const v8Modules=[
 ['dashboard','Visão geral'],['users','Usuários'],['establishments','Estabelecimentos'],['drivers','Cooperados'],
 ['contracts','Contratos'],['bases','Bases'],['services','Serviços adicionais'],['shifts','Horários fixos'],
 ['schedules','Escalas'],['attendance','Check-in e check-out'],['deliveries','Entregas'],['tracking','Cooperados online'],
 ['financial','Ganhos e descontos'],['closings','Fechamento semanal'],['advances','Adiantamentos'],['credits','Créditos de clientes'],
 ['prices','Tabela por contrato'],['integrations','Integrações e API'],['settings','Configurações']
];
const v8PageModule={dashboard:'dashboard',users:'users',establishments:'establishments',drivers:'drivers',contracts:'contracts',bases:'bases',services:'services',shifts:'shifts',schedules:'schedules',attendance:'attendance',deliveries:'deliveries',tracking:'tracking',team:'deliveries',routes:'deliveries',financial:'financial',deductions:'financial',closings:'closings',advances:'advances',credits:'credits',prices:'prices',integrations:'integrations',settings:'settings'};
function v8Permission(module,action='view'){
 if(!state.user)return false;
 if(state.user.role==='platform_admin'||state.user.role==='driver'||state.user.role==='establishment')return true;
 if(!state.user.has_custom_permissions)return true;
 const p=state.user.permissions?.[module];return Boolean(p?.[action]);
}
function v8PageAllowed(page){if(page==='account')return true;return v8Permission(v8PageModule[page]||page,'view')}
renderNav=function(){const groups=navByRole[state.user.role]||[];$('#sidebar-nav').innerHTML=groups.map(([g,pages])=>{const allowed=pages.filter(v8PageAllowed);return allowed.length?`<div class="nav-section">${esc(g)}</div>${allowed.map(p=>`<button class="nav-item ${state.page===p?'active':''}" data-page="${p}"><span>${pageMeta[p]?.[1]||'•'}</span>${pageMeta[p]?.[0]||p}</button>`).join('')}`:''}).join('');$$('[data-page]').forEach(b=>b.onclick=()=>navigate(b.dataset.page))};
canEdit=function(){if(!state.user)return false;if(state.user.role==='platform_admin')return true;const module=v8PageModule[state.page];return ['cooperative_admin','dispatcher'].includes(state.user.role)&&(!module||v8Permission(module,'edit')||v8Permission(module,'create'))};

function v8PermissionMatrix(current=[],unrestricted=false){
 const map=Object.fromEntries((current||[]).map(x=>[x.module_key,x]));
 return `<div class="full permission-box"><div class="permission-head"><label class="check-card permission-unrestricted"><input id="permission-unrestricted" type="checkbox" ${unrestricted?'checked':''}> Acesso completo, sem restrições personalizadas</label><div><button type="button" class="btn small" id="permission-view-all">Marcar visualização</button><button type="button" class="btn small" id="permission-all">Marcar tudo</button><button type="button" class="btn small" id="permission-clear">Limpar</button></div></div><div class="permission-table-wrap"><table class="permission-table"><thead><tr><th>Aba</th><th>Ver</th><th>Criar</th><th>Editar</th><th>Excluir</th></tr></thead><tbody>${v8Modules.map(([key,name])=>{const p=map[key]||{};return `<tr data-module="${key}"><td>${esc(name)}</td>${['view','create','edit','delete'].map(a=>`<td><input type="checkbox" data-perm="${a}" ${p[`can_${a}`]||p[a]?'checked':''}></td>`).join('')}</tr>`}).join('')}</tbody></table></div></div>`;
}
function v8BindPermissionMatrix(){
 const toggle=()=>{$('.permission-table-wrap')?.classList.toggle('disabled',$('#permission-unrestricted')?.checked)};$('#permission-unrestricted')?.addEventListener('change',toggle);toggle();
 $('#permission-view-all')?.addEventListener('click',()=>$$('[data-perm="view"]').forEach(x=>x.checked=true));
 $('#permission-all')?.addEventListener('click',()=>$$('[data-perm]').forEach(x=>x.checked=true));
 $('#permission-clear')?.addEventListener('click',()=>$$('[data-perm]').forEach(x=>x.checked=false));
}
function v8ReadPermissions(){if($('#permission-unrestricted')?.checked)return[];return $$('.permission-table tbody tr').map(row=>({module_key:row.dataset.module,can_view:row.querySelector('[data-perm="view"]').checked,can_create:row.querySelector('[data-perm="create"]').checked,can_edit:row.querySelector('[data-perm="edit"]').checked,can_delete:row.querySelector('[data-perm="delete"]').checked})).filter(x=>x.can_view||x.can_create||x.can_edit||x.can_delete)}

pages.users=async()=>{const base=await baseData();const d=await api(`/api/app/users${query(scopeParams())}`);$('#page-content').innerHTML=panel('Usuários e acessos',table([{label:'Nome',key:'name'},{label:'E-mail',key:'email'},{label:'Perfil',render:r=>esc(roles[r.role]||r.role)},{label:'Vínculo',render:r=>esc(r.establishment_name||r.driver_name||'Administração')},{label:'Último acesso',render:r=>dateTime(r.last_login_at)},{label:'Status',render:r=>badge(r.status)}],d.items,r=>r.role==='platform_admin'?'<span class="muted">Acesso Master protegido</span>':`${v8Permission('users','edit')?`<button class="table-action" data-edit-user="${r.id}">Editar e permissões</button>`:''}${v8Permission('users','delete')?`<button class="table-action" data-del-user="${r.id}">Excluir</button>`:''}`),v8Permission('users','create')?'<button class="btn primary" id="new-user">Novo usuário da cooperativa</button>':'');$('#new-user')?.addEventListener('click',()=>v8UserForm({},base));$$('[data-edit-user]').forEach(b=>b.onclick=()=>v8UserForm(d.items.find(x=>x.id===b.dataset.editUser),base));$$('[data-del-user]').forEach(b=>b.onclick=()=>removeEntity(`/api/app/users/${b.dataset.delUser}`,'Excluir este acesso?',pages.users))};
async function v8UserForm(item={},base=state.cache){let perms=[],unrestricted=true;if(item.id){try{const d=await api(`/api/app/users/${item.id}/permissions`);perms=d.items||[];unrestricted=!d.custom}catch{}}const profileOptions=['cooperative_admin','dispatcher','establishment','driver'].map(r=>`<option value="${r}" ${item.role===r?'selected':''}>${roles[r]}</option>`).join('');openModal(item.id?'Editar usuário e permissões':'Novo usuário',`<form id="v8-user-form" class="form-grid">${field('Nome','name',item.name,'text','required')}${field('E-mail','email',item.email,'email','required')}${field('Usuário opcional','username',item.username)}<label>Perfil<select name="role" required><option value="">Selecione</option>${profileOptions}</select></label>${selectField('Estabelecimento (perfil estabelecimento)','establishment_id',base.establishments||[],item.establishment_id,'Nenhum')}${selectField('Cooperado (perfil cooperado)','driver_id',base.drivers||[],item.driver_id,'Nenhum')}${field(item.id?'Nova senha (opcional)':'Senha inicial','password','','password',item.id?'minlength="8"':'required minlength="8"')}<label>Status<select name="status"><option value="active">Ativo</option><option value="blocked" ${item.status==='blocked'?'selected':''}>Bloqueado</option><option value="inactive" ${item.status==='inactive'?'selected':''}>Inativo</option></select></label>${v8PermissionMatrix(perms,unrestricted)}${buttons()}</form>`);v8BindPermissionMatrix();$('#v8-user-form').onsubmit=async e=>{e.preventDefault();const b=scopeBody(formObject(e.currentTarget)),permissions=v8ReadPermissions();try{loading(true);const result=await api(`/api/app/users${item.id?`/${item.id}`:''}`,{method:item.id?'PUT':'POST',body:b});const userId=item.id||result.id;await api(`/api/app/users/${userId}/permissions`,{method:'PUT',body:{permissions}});closeModal();toast('Usuário e permissões salvos.');pages.users()}catch(err){toast(err.message,'error')}finally{loading(false)}}}

pages.shifts=async()=>{const [d,contracts]=await Promise.all([api(`/api/app/shift-templates${query(scopeParams())}`),api(`/api/app/contracts${query(scopeParams())}`)]);$('#page-content').innerHTML=panel('Horários fixos por contrato',`<div class="notice">Cadastre todos os horários usados em cada contrato. Eles ficam disponíveis na grade semanal e podem ser alterados ou removidos a qualquer momento.</div>`+table([{label:'Contrato',render:r=>esc(r.contract_name||'Geral / qualquer contrato')},{label:'Nome',key:'name'},{label:'Horário',render:r=>`<strong>${esc(r.start_time)} às ${esc(r.end_time)}</strong>`},{label:'Turno',key:'shift_label'},{label:'Status',render:r=>badge(r.active?'active':'inactive')}],d.items,r=>`${v8Permission('shifts','edit')?`<button class="table-action" data-edit-shift="${r.id}">Editar</button>`:''}${v8Permission('shifts','delete')?`<button class="table-action" data-del-shift="${r.id}">Excluir</button>`:''}`),v8Permission('shifts','create')?'<button class="btn primary" id="new-shift">Novo horário fixo</button>':'');$('#new-shift')?.addEventListener('click',()=>v8ShiftForm({},contracts.items||[]));$$('[data-edit-shift]').forEach(b=>b.onclick=()=>v8ShiftForm(d.items.find(x=>x.id===b.dataset.editShift),contracts.items||[]));$$('[data-del-shift]').forEach(b=>b.onclick=()=>removeEntity(`/api/app/shift-templates/${b.dataset.delShift}`,'Excluir este horário?',pages.shifts))};
function v8ShiftForm(item={},contracts=[]){openModal(item.id?'Editar horário fixo':'Novo horário fixo',`<form id="v8-shift-form" class="form-grid">${selectField('Contrato','contract_id',contracts,item.contract_id,'Geral / qualquer contrato')}${field('Nome do horário','name',item.name,'text','required placeholder="Ex.: 08:00 às 16:00"')}${field('Turno','shift_label',item.shift_label||'DIA','text','required')}${field('Hora inicial','start_time',item.start_time,'time','required')}${field('Hora final','end_time',item.end_time,'time','required')}${buttons()}</form>`);$('#v8-shift-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/shift-templates${item.id?`/${item.id}`:''}`,{method:item.id?'PUT':'POST',body:scopeBody(formObject(e.currentTarget))});closeModal();state.cache.baseKey='';state.cache.lgBaseKey='';toast('Horário salvo.');pages.shifts()}catch(err){toast(err.message,'error')}finally{loading(false)}}}

function v8LocalOptions(base,selected){const options=[];(base.contracts||[]).forEach(x=>options.push({value:`contract:${x.id}`,name:x.name}));(base.bases||[]).forEach(x=>options.push({value:`base:${x.id}`,name:`BASE — ${x.name}`}));(base.establishments||[]).filter(x=>!(base.contracts||[]).some(c=>c.establishment_id===x.id)).forEach(x=>options.push({value:`establishment:${x.id}`,name:`ESTABELECIMENTO — ${x.name}`}));return `<option value="">Selecione</option>${options.map(x=>`<option value="${x.value}" ${x.value===selected?'selected':''}>${esc(x.name)}</option>`).join('')}`}
function v8SelectedLocal(item){return item.contract_id?`contract:${item.contract_id}`:item.base_id?`base:${item.base_id}`:item.establishment_id?`establishment:${item.establishment_id}`:''}
function v8ShiftOptions(base,contractId,selected){return `<option value="">Horário manual</option>${(base.shifts||[]).filter(x=>!x.contract_id||x.contract_id===contractId).map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''} data-start="${x.start_time}" data-end="${x.end_time}" data-label="${esc(x.shift_label)}">${esc(x.name)} • ${x.start_time}–${x.end_time}</option>`).join('')}`}
function v8Weekday(date){const names=['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];return names[new Date(`${date}T12:00:00`).getDay()]}
function v8DateLabel(date){const [y,m,d]=String(date).split('-');return `${d}/${m}/${String(y).slice(2)}-${v8Weekday(date)}`}
function v8RowHtml(item,base,isNew=false){const date=String(item.start_at||item.date||isoDate()).slice(0,10),start=String(item.start_at||'').slice(11,16)||'08:00',end=String(item.end_at||'').slice(11,16)||'17:00',selectedLocal=v8SelectedLocal(item),contractId=item.contract_id||'';return `<tr class="schedule-grid-row ${item.has_conflict?'schedule-conflict':''}" data-id="${item.id||''}" data-new="${isNew?'1':'0'}"><td><input class="grid-date" type="date" value="${date}"></td><td><input class="grid-order" type="number" min="1" value="${item.sort_order||''}" placeholder="Auto"></td><td><input class="grid-shift" value="${esc(item.shift_label||'DIA')}" maxlength="40"></td><td><select class="grid-template">${v8ShiftOptions(base,contractId,item.shift_template_id)}</select><div class="grid-time-pair"><input class="grid-start" type="time" value="${start}"><span>às</span><input class="grid-end" type="time" value="${end}"></div></td><td><select class="grid-local">${v8LocalOptions(base,selectedLocal)}</select></td><td><select class="grid-driver"><option value="">Selecione</option>${(base.drivers||[]).map(x=>`<option value="${x.id}" ${x.id===item.driver_id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></td><td class="grid-alert">${item.has_conflict?'<span class="conflict-pill">Conflito</span>':'<span class="ok-pill">Livre</span>'}</td><td><div class="actions"><button class="table-action primary" data-grid-save>Salvar</button>${!isNew?`<button class="table-action" data-grid-clone>Clonar</button><button class="table-action danger" data-grid-delete>Excluir</button>`:'<button class="table-action" data-grid-cancel>Cancelar</button>'}</div></td></tr>`}
function v8RowBody(row){const local=row.querySelector('.grid-local').value,[kind,targetId]=local.split(':');return{date:row.querySelector('.grid-date').value,sort_order:row.querySelector('.grid-order').value,shift_label:row.querySelector('.grid-shift').value,shift_template_id:row.querySelector('.grid-template').value,start_time:row.querySelector('.grid-start').value,end_time:row.querySelector('.grid-end').value,driver_id:row.querySelector('.grid-driver').value,contract_id:kind==='contract'?targetId:'',base_id:kind==='base'?targetId:'',establishment_id:kind==='establishment'?targetId:''}}
function v8BindGridRow(row,base){const local=row.querySelector('.grid-local'),template=row.querySelector('.grid-template');local.onchange=()=>{const [kind,id]=local.value.split(':');template.innerHTML=v8ShiftOptions(base,kind==='contract'?id:'',template.value)};template.onchange=()=>{const opt=template.selectedOptions[0];if(opt?.dataset.start){row.querySelector('.grid-start').value=opt.dataset.start;row.querySelector('.grid-end').value=opt.dataset.end;row.querySelector('.grid-shift').value=opt.dataset.label||'TURNO'}};row.querySelector('[data-grid-cancel]')?.addEventListener('click',()=>row.remove());row.querySelector('[data-grid-save]')?.addEventListener('click',async()=>{const body=v8RowBody(row),id=row.dataset.id;try{loading(true);await api(`/api/app/schedule-grid${id?`/${id}`:''}`,{method:id?'PUT':'POST',body});toast('Linha da escala salva.');state.cache.baseKey='';await pages.schedules()}catch(err){if(err.status===409&&confirm(`${err.message}\nDeseja manter as duas escalas mesmo assim?`)){body.allow_conflict=true;await api(`/api/app/schedule-grid${id?`/${id}`:''}`,{method:id?'PUT':'POST',body});toast('Escala salva com alerta de conflito.');await pages.schedules()}else toast(err.message,'error')}finally{loading(false)}});row.querySelector('[data-grid-delete]')?.addEventListener('click',async()=>{if(!confirm('Retirar esta linha da escala?'))return;try{await api(`/api/app/schedule-grid/${row.dataset.id}`,{method:'DELETE'});toast('Linha retirada.');pages.schedules()}catch(e){toast(e.message,'error')}});row.querySelector('[data-grid-clone]')?.addEventListener('click',async()=>{const date=prompt('Data da cópia (AAAA-MM-DD):',row.querySelector('.grid-date').value);if(!date)return;try{await api(`/api/app/schedule-grid/${row.dataset.id}/clone`,{method:'POST',body:{date}});toast('Escala clonada.');pages.schedules()}catch(e){toast(e.message,'error')}})}
function v8SchedulePrint(items,order){const rows=[...(items||[])];rows.sort(order==='alphabetical'?(a,b)=>String(a.driver_name).localeCompare(String(b.driver_name),'pt-BR')||String(a.start_at).localeCompare(String(b.start_at)):(a,b)=>String(a.start_at).localeCompare(String(b.start_at))||String(a.contract_name||a.base_name||a.establishment_name).localeCompare(String(b.contract_name||b.base_name||b.establishment_name),'pt-BR')||Number(a.sort_order||999)-Number(b.sort_order||999));let sheet=$('#schedule-print-sheet');if(!sheet){sheet=document.createElement('section');sheet.id='schedule-print-sheet';document.body.append(sheet)}sheet.innerHTML=`<header><img src="/icons/logo-official.png" alt="ChegaJá"><div><h1>ESCALA DE TRABALHO</h1><p>${esc(state.user.cooperative_name||'Cooperativa')} • ${dateOnly(state.cache.scheduleFrom)} a ${dateOnly(state.cache.scheduleTo)}</p></div></header><table><thead><tr><th>DATA</th><th>Q</th><th>TURNO</th><th>HORÁRIOS</th><th>CONTRATO</th><th>NOME DO COOPERADO</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.has_conflict?'print-conflict':''}"><td>${v8DateLabel(String(r.start_at).slice(0,10))}</td><td>${r.sort_order||''}</td><td>${esc(r.shift_label||'')}</td><td>${timeOnly(r.start_at)} às ${timeOnly(r.end_at)}</td><td>${esc(r.contract_name||r.base_name||r.establishment_name||'')}</td><td>${esc(r.driver_name)}</td></tr>`).join('')}</tbody></table><footer>Gerado pelo ChegaJá em ${new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</footer>`;document.body.classList.add('schedule-printing');window.print();setTimeout(()=>document.body.classList.remove('schedule-printing'),500)}

pages.schedules=async()=>{const base=await lgBase(true),from=state.cache.scheduleFrom||mondayOf(isoDate()),to=state.cache.scheduleTo||addDays(from,6),order=state.cache.scheduleOrder||'day';state.cache.scheduleFrom=from;state.cache.scheduleTo=to;const params={from,to,order,driver_id:state.cache.scheduleDriver||'',contract_id:state.cache.scheduleContract||''};const d=await api(`/api/app/schedule-grid${query(params)}`);state.cache.scheduleItems=d.items||[];const manage=['cooperative_admin','dispatcher'].includes(state.user.role)&&v8Permission('schedules','edit');const create=['cooperative_admin','dispatcher'].includes(state.user.role)&&v8Permission('schedules','create');const tools=`<div class="schedule-tools"><input id="schedule-from" type="date" value="${from}"><span>até</span><input id="schedule-to" type="date" value="${to}"><select id="schedule-driver-filter"><option value="">Todos os cooperados</option>${(base.drivers||[]).map(x=>`<option value="${x.id}" ${state.cache.scheduleDriver===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><select id="schedule-contract-filter"><option value="">Todos os contratos</option>${(base.contracts||[]).map(x=>`<option value="${x.id}" ${state.cache.scheduleContract===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><select id="schedule-order"><option value="day" ${order==='day'?'selected':''}>Por dia e contrato</option><option value="alphabetical" ${order==='alphabetical'?'selected':''}>Ordem alfabética</option></select><button class="btn" id="schedule-apply">Filtrar</button><button class="btn" id="schedule-print">Imprimir</button>${create?'<button class="btn primary" id="schedule-add-row">Acrescentar linha</button>':''}<button class="btn soft" id="schedule-swaps">Trocas</button></div>`;const grid=manage?`<div class="schedule-grid-help">Edite a linha diretamente. Todos os campos podem ser trocados. Linhas em vermelho indicam que o mesmo cooperado está em dois locais no mesmo horário.</div><div class="table-wrap schedule-grid-wrap"><table class="schedule-grid"><thead><tr><th>DATA</th><th>Q</th><th>TURNO</th><th>HORÁRIOS</th><th>CONTRATO / LOCAL</th><th>NOME DO COOPERADO</th><th>ALERTA</th><th>AÇÕES</th></tr></thead><tbody id="schedule-grid-body">${(d.items||[]).map(x=>v8RowHtml(x,base)).join('')}</tbody></table></div>`:table([{label:'Data',render:r=>v8DateLabel(String(r.start_at).slice(0,10))},{label:'Q',key:'sort_order'},{label:'Turno',key:'shift_label'},{label:'Horários',render:r=>`${timeOnly(r.start_at)} às ${timeOnly(r.end_at)}`},{label:'Contrato',render:r=>esc(r.contract_name||r.base_name||r.establishment_name||'')},{label:'Cooperado',key:'driver_name'},{label:'Alerta',render:r=>r.has_conflict?'<span class="conflict-pill">Conflito</span>':'<span class="ok-pill">Livre</span>'}],d.items);$('#page-content').innerHTML=panel('Escala editável como planilha',grid,tools)+`<div id="schedule-swaps-area"></div>`;$$('.schedule-grid-row').forEach(row=>v8BindGridRow(row,base));$('#schedule-add-row')?.addEventListener('click',()=>{const tbody=$('#schedule-grid-body'),wrapper=document.createElement('tbody');wrapper.innerHTML=v8RowHtml({date:from,shift_label:'DIA'},base,true);const row=wrapper.firstElementChild;tbody.prepend(row);v8BindGridRow(row,base);row.querySelector('input,select')?.focus()});$('#schedule-apply').onclick=()=>{state.cache.scheduleFrom=$('#schedule-from').value;state.cache.scheduleTo=$('#schedule-to').value;state.cache.scheduleDriver=$('#schedule-driver-filter').value;state.cache.scheduleContract=$('#schedule-contract-filter').value;state.cache.scheduleOrder=$('#schedule-order').value;pages.schedules()};$('#schedule-print').onclick=()=>v8SchedulePrint(d.items||[],$('#schedule-order').value);$('#schedule-swaps').onclick=()=>v8RenderSwaps(base);if(state.user.role==='driver')v8RenderSwaps(base,true)};

async function v8RenderSwaps(base,inline=false){try{const [list,options]=await Promise.all([api('/api/app/schedule-swaps'),state.user.role==='driver'?api('/api/app/schedule-swaps/options'):Promise.resolve({items:state.cache.scheduleItems||[]})]);const own=(options.items||[]).filter(x=>x.driver_id===state.user.driver_id),other=(options.items||[]).filter(x=>x.driver_id!==state.user.driver_id);const actions=state.user.role==='driver'?`<button class="btn primary" id="new-swap-request">Solicitar troca</button>`:['cooperative_admin','dispatcher'].includes(state.user.role)?`<button class="btn primary" id="direct-swap">Trocar duas escalas</button>`:'';const html=panel('Trocas de escala',table([{label:'Solicitante',key:'requester_name'},{label:'Escala do solicitante',render:r=>`${dateTime(r.source_start)} • ${esc(r.source_local)}`},{label:'Outro cooperado',key:'target_name'},{label:'Escala desejada',render:r=>`${dateTime(r.target_start)} • ${esc(r.target_local)}`},{label:'Status',render:r=>badge(r.status)}],list.items,r=>state.user.role==='driver'&&r.status==='pending'&&r.requested_to_driver_id===state.user.driver_id?`<button class="table-action primary" data-swap-accept="${r.id}">Aceitar</button><button class="table-action" data-swap-reject="${r.id}">Recusar</button>`:state.user.role==='driver'&&r.status==='pending'&&r.requested_by_driver_id===state.user.driver_id?`<button class="table-action" data-swap-cancel="${r.id}">Cancelar</button>`:''),actions);if(inline)$('#schedule-swaps-area').innerHTML=html;else openModal('Trocas de escala',html);$('#new-swap-request')?.addEventListener('click',()=>{openModal('Solicitar troca de turno',`<form id="swap-request-form" class="form-grid">${selectField('Minha escala','source_schedule_id',own.map(x=>({id:x.id,name:`${dateTime(x.start_at)} • ${x.local_name}`})),'','Selecione','required')}${selectField('Escala de outro cooperado','target_schedule_id',other.map(x=>({id:x.id,name:`${x.driver_name} • ${dateTime(x.start_at)} • ${x.local_name}`})),'','Selecione','required')}${textarea('Mensagem','message','Gostaria de trocar esta escala com você.')}${buttons('Enviar solicitação')}</form>`);$('#swap-request-form').onsubmit=async e=>{e.preventDefault();try{const result=await api('/api/app/schedule-swaps',{method:'POST',body:formObject(e.currentTarget)});if(result.action_required==='accept'&&result.request_id){if(!confirm('O outro cooperado já solicitou exatamente esta troca. Deseja aceitar agora?'))return toast('A solicitação original continua aguardando sua resposta.');await api(`/api/app/schedule-swaps/${result.request_id}/respond`,{method:'POST',body:{decision:'accepted'}});closeModal();toast('Troca aceita. As duas escalas foram atualizadas.')}else{closeModal();toast(result.existing?'Esta troca já está aguardando resposta.':'Solicitação enviada ao outro cooperado.')}pages.schedules()}catch(err){toast(err.message,'error')}}});$('#direct-swap')?.addEventListener('click',()=>{const all=options.items||state.cache.scheduleItems||[];openModal('Trocar duas escalas',`<form id="direct-swap-form" class="form-grid">${selectField('Primeira escala','source_schedule_id',all.map(x=>({id:x.id,name:`${x.driver_name} • ${dateTime(x.start_at)} • ${x.local_name||x.contract_name||x.base_name||x.establishment_name}`})),'','Selecione','required')}${selectField('Segunda escala','target_schedule_id',all.map(x=>({id:x.id,name:`${x.driver_name} • ${dateTime(x.start_at)} • ${x.local_name||x.contract_name||x.base_name||x.establishment_name}`})),'','Selecione','required')}${buttons('Confirmar troca')}</form>`);$('#direct-swap-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/app/schedule-swaps/direct',{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Cooperados trocados nas duas escalas.');pages.schedules()}catch(err){toast(err.message,'error')}}});$$('[data-swap-accept]').forEach(b=>b.onclick=()=>v8RespondSwap(b.dataset.swapAccept,'accepted'));$$('[data-swap-reject]').forEach(b=>b.onclick=()=>v8RespondSwap(b.dataset.swapReject,'rejected'));$$('[data-swap-cancel]').forEach(b=>b.onclick=async()=>{await api(`/api/app/schedule-swaps/${b.dataset.swapCancel}/cancel`,{method:'POST'});toast('Solicitação cancelada.');pages.schedules()})}catch(e){toast(e.message,'error')}}
async function v8RespondSwap(id,decision){try{await api(`/api/app/schedule-swaps/${id}/respond`,{method:'POST',body:{decision}});toast(decision==='accepted'?'Troca realizada.':'Troca recusada.');pages.schedules()}catch(e){toast(e.message,'error')}}


const v8OriginalNavigate=navigate;
navigate=async function(page,push=true){
 if(state.user&&state.user.has_custom_permissions&&!v8PageAllowed(page)){
  const rolePages=(navByRole[state.user.role]||[]).flatMap(x=>x[1]);
  page=rolePages.find(v8PageAllowed)||'account';
 }
 return v8OriginalNavigate(page,push);
};

// Inicialização transferida para o módulo Ligerim 9.0.


/* ===== ligerim-v9.js ===== */
/* Ligerim 9.0 — tempo real, confirmação configurável, chat, temas, ofertas e garantia */
const v9={publicStatusTimer:null,publicChatTimer:null,driverChatTimer:null,lastPublicMessage:'',lastPublicStatus:'',addressTimer:null};

pageMeta.operationalSettings=['Identidade e regras','⚙'];
if(navByRole.cooperative_admin){const cfg=navByRole.cooperative_admin.find(x=>x[0]==='Configuração');if(cfg&&!cfg[1].includes('operationalSettings'))cfg[1].unshift('operationalSettings')}

function v9HexRgb(hex){const h=String(hex||'#0D257A').replace('#','');return h.length===6?[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]:[13,37,122]}
function v9Theme(color){const c=/^#[0-9a-f]{6}$/i.test(color||'')?color:'#0D257A',rgb=v9HexRgb(c);document.documentElement.style.setProperty('--brand',c);document.documentElement.style.setProperty('--brand-rgb',rgb.join(','));document.documentElement.style.setProperty('--wine',c);document.documentElement.style.setProperty('--wine-2',c);document.documentElement.style.setProperty('--wine-dark',`rgb(${rgb.map(v=>Math.max(0,Math.round(v*.65))).join(',')})`);document.documentElement.style.setProperty('--wine-soft',`rgba(${rgb.join(',')},.08)`);document.querySelector('meta[name="theme-color"]')?.setAttribute('content',c)}
const v9LoadMe=loadMe;loadMe=async function(){await v9LoadMe();v9Theme(state.user?.primary_color);};

const v9OldEventSound=eventSound;
eventSound=function(type){if(type==='delivery_message'||type==='approach_alert')return'message';if(type==='delivery_unassigned')return'problem';return v9OldEventSound(type)};
initializeNotifications=async function(){stopNotifications();if(!state.user||state.user.role==='platform_admin')return;try{const initial=await api('/api/app/v6/notifications?initial=1');v6.notificationCursor=Number(initial.cursor||0)}catch{return}v6.notificationTimer=setInterval(pollNotifications,2500)};

function v9EmojiBar(input){return `<div class="emoji-bar">${['😀','👍','🙏','📍','🏠','✅','🚪','📦'].map(e=>`<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>`}
function v9BindEmojis(root,input){$$('[data-emoji]',root).forEach(b=>b.onclick=()=>{input.value+=b.dataset.emoji;input.focus()})}

// Entrega de balcão: apenas nome, telefone opcional e endereço confirmado enquanto digita.
counterOrderForm=async function(base){
 let establishment=(base.establishments||[]).find(x=>x.id===state.user.establishment_id)||{};
 try{const d=await api('/api/app/v7/establishment/profile');establishment=d.item||establishment}catch{}
 openModal('Nova entrega de balcão',`<form id="counter-order-v9" class="form-grid counter-simple">
  ${field('Nome do cliente','customer_name','','text','required autocomplete="name"')}
  ${field('Telefone (opcional)','customer_phone','','tel','autocomplete="tel"')}
  <label class="full">Endereço da entrega<input id="counter-address-search" name="delivery_address" autocomplete="off" required placeholder="Digite rua, bairro, cidade ou estabelecimento no RN"></label>
  <input type="hidden" name="delivery_confirmation_token"><input type="hidden" name="payment_method" value="pix">
  <div id="counter-address-results" class="full address-live-results"><span class="muted">Digite a rua e o número. Selecione o endereço correto antes de criar.</span></div>
  ${buttons('Criar entrega')}
 </form>`);
 const form=$('#counter-order-v9'),input=$('#counter-address-search'),results=$('#counter-address-results');
 const clear=()=>{form.elements.delivery_confirmation_token.value='';results.dataset.confirmed='0'};input.oninput=()=>{clear();clearTimeout(v9.addressTimer);const q=input.value.trim();if(q.length<5){results.innerHTML='<span class="muted">Continue digitando rua e número.</span>';return}v9.addressTimer=setTimeout(async()=>{try{results.innerHTML='<span class="muted">Buscando endereço…</span>';const d=await api('/api/public/address/autocomplete',{method:'POST',body:{query:q,establishment_id:establishment.id}});results.innerHTML=(d.items||[]).map((x,i)=>`<button type="button" class="address-live-option" data-address-index="${i}" ${x.confirmable?'':'disabled'}><strong>${esc(x.formatted_address)}</strong><small>${x.confirmable?'Número confirmado':'Resultado sem precisão suficiente'}</small></button>`).join('')||`<span class="address-warning">${esc(d.message||'Endereço não encontrado na cidade do estabelecimento.')}</span>`;$$('[data-address-index]',results).forEach(b=>b.onclick=()=>{const x=d.items[Number(b.dataset.addressIndex)];input.value=x.formatted_address;form.elements.delivery_confirmation_token.value=x.confirmation_token;results.dataset.confirmed='1';results.innerHTML=selectedAddressSummary(x)})}catch(e){results.innerHTML=`<span class="address-warning">${esc(e.message)}</span>`}},450)};
 form.onsubmit=async e=>{e.preventDefault();const formEl=e.currentTarget;if(!formEl.elements.delivery_confirmation_token.value)return toast('Selecione um endereço confirmado na lista.','error');try{loading(true);const r=await api('/api/app/v7/establishment/orders',{method:'POST',body:formObject(formEl)});closeModal();await sound.play('created');toast(`Entrega ${r.item.display_code} criada. Atribua um cooperado.`);pages.deliveries()}catch(err){toast(err.message,'error')}finally{loading(false)}};
};

// Atribuir, trocar, retirar ou ofertar a todos.
assignV6=async function(delivery){try{loading(true);const d=await api(`/api/app/v6/deliveries/${delivery.id}/eligible-drivers`);openModal(`Atribuição • ${delivery.display_code}`,`<div class="assignment-v9"><div class="notice">Somente cooperados online, escalados ou incluídos neste local hoje aparecem abaixo.</div><form id="assign-v9" class="form-grid">${selectField('Cooperado','driver_id',d.items||[],delivery.assigned_driver_id,'Selecione um cooperado')}<div class="form-actions assignment-actions"><button type="button" class="btn" id="unassign-v9">Deixar não atribuída</button><button type="button" class="btn soft" id="offer-all-v9">Oferecer a todos</button><button type="submit" class="btn primary">${delivery.assigned_driver_id?'Trocar cooperado':'Atribuir'}</button></div></form></div>`);const form=$('#assign-v9');form.onsubmit=async e=>{e.preventDefault();const id=form.elements.driver_id.value;if(!id)return toast('Selecione um cooperado.','error');await api(`/api/app/v9/deliveries/${delivery.id}/assignment`,{method:'POST',body:{driver_id:id}});closeModal();await sound.play('assigned');toast('Atribuição atualizada.');pages.deliveries()};$('#unassign-v9').onclick=async()=>{if(!confirm('Retirar a atribuição e voltar para não atribuída?'))return;await api(`/api/app/v9/deliveries/${delivery.id}/assignment`,{method:'POST',body:{action:'unassign'}});closeModal();await sound.play('problem');pages.deliveries()};$('#offer-all-v9').onclick=async()=>{if(!confirm('Disponibilizar para todos os cooperados elegíveis e online?'))return;await api(`/api/app/v9/deliveries/${delivery.id}/assignment`,{method:'POST',body:{action:'offer_all'}});closeModal();await sound.play('new_order');pages.deliveries()}}catch(e){toast(e.message,'error')}finally{loading(false)}};

// Tela de operações com liberação individual sem código.
const v9Operations=operationsDeliveriesV6;
operationsDeliveriesV6=async function(){await v9Operations();const data=await api('/api/app/tenant/deliveries');const map=new Map((data.items||[]).map(x=>[x.id,x]));$$('[data-op-detail]').forEach(btn=>{const row=btn.closest('tr'),item=map.get(btn.dataset.opDetail);if(!row||!item||['delivered','cancelled'].includes(item.status))return;const authority=item.delivery_type==='base'?['cooperative_admin','dispatcher'].includes(state.user.role):state.user.role==='establishment';if(authority){const actionCell=row.querySelector('.actions');if(actionCell&&!actionCell.querySelector('[data-no-code]'))actionCell.insertAdjacentHTML('beforeend',`<button class="table-action" data-no-code="${item.id}">${item.finish_without_code_authorized?'Exigir código':'Liberar sem código'}</button>`);}});$$('[data-no-code]').forEach(btn=>btn.onclick=async()=>{const item=map.get(btn.dataset.noCode),enabled=!Boolean(Number(item.finish_without_code_authorized));if(!confirm(enabled?'Permitir que esta entrega seja finalizada sem o código?':'Voltar a exigir o código nesta entrega?'))return;try{await api(`/api/app/v9/deliveries/${item.id}/allow-no-code`,{method:'POST',body:{enabled}});toast('Regra da entrega atualizada.');pages.deliveries()}catch(e){toast(e.message,'error')}})};

// Ofertas disponíveis ao cooperado.
const v9Dashboard=pages.dashboard;pages.dashboard=async function(){await v9Dashboard();if(state.user?.role!=='driver'||!state.online)return;try{const d=await api('/api/app/v9/driver/offers');if(!(d.items||[]).length)return;$('#page-content').insertAdjacentHTML('beforeend',`<div class="driver-section-title"><h2>Entregas disponíveis</h2><span>${d.items.length}</span></div><div class="driver-order-list offers-v9">${d.items.map(x=>driverCard(x)).join('')}</div>`);$$('.offers-v9 [data-driver-action]').forEach(b=>b.onclick=async()=>{const item=d.items.find(x=>x.id===b.dataset.delivery);try{await api(`/api/app/v9/driver/offers/${item.id}/accept`,{method:'POST'});await sound.play('accepted');toast('Entrega aceita.');pages.dashboard()}catch(e){toast(e.message,'error')}});$$('.offers-v9 [data-driver-detail]').forEach(b=>b.onclick=()=>driverDetailV6(d.items.find(x=>x.id===b.dataset.driverDetail)));$$('.offers-v9 [data-driver-map]').forEach(b=>b.onclick=()=>openDriverMap(d.items.find(x=>x.id===b.dataset.driverMap)))}catch{}};

// Finalização com código apenas quando a regra exigir.
driverStatusButton=function(delivery){if(delivery.status==='offered')return`<button class="driver-main-action" data-driver-action="offer_accept" data-delivery="${delivery.id}">Aceitar</button>`;const a={assigned:['Aceitar','accept'],accepted:['Ir buscar','to_pickup'],to_pickup:['Cheguei','at_pickup'],at_pickup:['Coletado','picked_up'],picked_up:['Iniciar entrega','in_route'],in_route:['Finalizar','complete_v9']}[delivery.status];return a?`<button class="driver-main-action" data-driver-action="${a[1]}" data-delivery="${delivery.id}">${a[0]}</button>`:''};
driverAction=async function(delivery,action){if(action==='complete_v9'){const required=Number(delivery.confirmation_required??1)===1&&!Number(delivery.finish_without_code_authorized||0);openModal(`Finalizar ${delivery.display_code}`,`<form id="complete-v9" class="form-grid"><div class="full notice">${required?'Peça ao cliente o código de 4 dígitos.':'Esta entrega está autorizada a finalizar sem código.'}</div>${required?field('Código de confirmação','confirmation_code','','text','required inputmode="numeric" maxlength="4" pattern="[0-9]{4}"'):''}${buttons(required?'Confirmar entrega':'Finalizar sem código')}</form>`);$('#complete-v9').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{loading(true);await api(`/api/app/v9/driver/deliveries/${delivery.id}/complete`,{method:'POST',body:formObject(f)});closeModal();await sound.play('completed');toast('Entrega finalizada e lançada no financeiro.');navigate(state.page,false)}catch(err){toast(err.message,'error')}finally{loading(false)}};return}if(action==='offer_accept'){try{await api(`/api/app/v9/driver/offers/${delivery.id}/accept`,{method:'POST'});await sound.play('accepted');navigate(state.page,false)}catch(e){toast(e.message,'error')}return}try{loading(true);if(action==='accept'){await api(`/api/app/v6/driver/deliveries/${delivery.id}/accept`,{method:'POST',body:{}});await sound.play('accepted')}else{await api(`/api/app/v6/driver/deliveries/${delivery.id}/status`,{method:'POST',body:{status:action}});await sound.play('status')}toast('Entrega atualizada.');await navigate(state.page,false)}catch(e){toast(e.message,'error')}finally{loading(false)}};

// Detalhes: nenhuma chamada abre o aplicativo de telefone. A voz usa o chat interno.
const v9DriverDetail=driverDetailV6;driverDetailV6=function(delivery){v9DriverDetail(delivery);const root=$('.driver-detail-mobile');if(!root)return;root.insertAdjacentHTML('beforeend','<p class="privacy-mini"><strong>Ligação interna:</strong> feche os detalhes e use o botão “Chat/Ligar”. A chamada acontece dentro do ChegaJá.</p>')};

// Chat interno em atualização automática, sem recarregar a página.
openDeliveryChat=async function(delivery){clearInterval(v9.driverChatTimer);openModal(`Chat • ${delivery.display_code}`,`<div class="delivery-chat realtime-chat"><div id="driver-chat-messages" class="chat-messages"><p class="muted">Carregando…</p></div><form id="driver-chat-v9" class="chat-form"><input name="message" maxlength="500" placeholder="Digite uma mensagem" required><button class="btn primary">Enviar</button></form><div id="driver-emoji"></div></div>`);const root=$('.realtime-chat'),form=$('#driver-chat-v9'),input=form?.elements.message,last={id:''};const load=async(notify=false)=>{try{const d=await api(`/api/app/tenant/deliveries/${delivery.id}/messages`),items=d.items||[],latest=items.at(-1);if(notify&&latest&&last.id&&latest.id!==last.id&&latest.sender_type!=='driver')await sound.play('message');if(latest)last.id=latest.id;const box=$('#driver-chat-messages');if(box){box.innerHTML=items.map(m=>`<div class="chat-message ${m.sender_type==='driver'?'mine':''}"><small>${esc(m.sender_name)} • ${dateTime(m.created_at)}</small><p>${esc(m.message)}</p></div>`).join('')||'<p class="muted">Nenhuma mensagem.</p>';box.scrollTop=box.scrollHeight}if(form)form.classList.toggle('hidden',!d.active)}catch(e){if(form)form.classList.add('hidden')}};if(form){$('#driver-emoji').innerHTML=v9EmojiBar(input);v9BindEmojis(root,input);form.onsubmit=async e=>{e.preventDefault();const formEl=e.currentTarget,msg=formEl.elements.message.value.trim();if(!msg)return;try{formEl.querySelector('button').disabled=true;await api(`/api/app/tenant/deliveries/${delivery.id}/messages`,{method:'POST',body:{message:msg}});if(formEl.isConnected)formEl.elements.message.value='';await load(false)}catch(err){toast(err.message,'error')}finally{if(formEl.isConnected)formEl.querySelector('button').disabled=false}}}await load(false);v9.driverChatTimer=setInterval(()=>{if(!$('#modal').classList.contains('hidden')&&$('#driver-chat-messages'))load(true);else clearInterval(v9.driverChatTimer)},2000)};
const v9CloseModal=closeModal;closeModal=function(){clearInterval(v9.driverChatTimer);v9.driverChatTimer=null;return v9CloseModal()};

// Configuração da identidade e das regras por estabelecimento/Base.
pages.operationalSettings=async function(){const d=await api('/api/app/v9/settings'),modes=[{id:'required',name:'Código obrigatório'},{id:'optional',name:'Código opcional / pode finalizar sem código'},{id:'disabled',name:'Sem código'}];const row=(type,x)=>`<article class="settings-place" data-setting-place="${type}:${x.id}"><header><strong>${esc(x.name)}</strong></header><label>Confirmação<select data-k="confirmation_mode">${modes.map(m=>`<option value="${m.id}" ${m.id===x.confirmation_mode?'selected':''}>${m.name}</option>`).join('')}</select></label><label class="switch-line"><input type="checkbox" data-k="tracking_enabled" ${Number(x.tracking_enabled)===1?'checked':''}> Rastreio do cliente</label>${type==='establishments'?`<label class="switch-line"><input type="checkbox" data-k="driver_map_enabled" ${Number(x.driver_map_enabled)===1?'checked':''}> Estabelecimento vê cooperados no mapa</label>`:''}<label class="switch-line"><input type="checkbox" data-k="customer_chat_enabled" ${Number(x.customer_chat_enabled)===1?'checked':''}> Chat cliente–cooperado</label><label class="switch-line"><input type="checkbox" data-k="driver_call_enabled" ${Number(x.driver_call_enabled)===1?'checked':''}> Permitir ligação direta</label><button class="btn primary small" data-save-setting>Salvar</button></article>`;$('#page-content').innerHTML=panel('Cor da cooperativa',`<form id="theme-v9" class="theme-form"><input type="color" name="primary_color" value="${esc(d.cooperative?.primary_color||'#0D257A')}"><div><strong>Identidade visual</strong><small>A cor é aplicada ao painel, ao estabelecimento, ao cooperado e ao cliente.</small></div><button class="btn primary">Aplicar cor</button></form>`)+panel('Regras dos estabelecimentos',`<div class="settings-grid">${(d.establishments||[]).map(x=>row('establishments',x)).join('')}</div>`)+panel('Regras das Bases',`<div class="settings-grid">${(d.bases||[]).map(x=>row('bases',x)).join('')}</div>`);$('#theme-v9').onsubmit=async e=>{e.preventDefault();const color=e.currentTarget.elements.primary_color.value;await api('/api/app/v9/settings/theme',{method:'PUT',body:{primary_color:color}});v9Theme(color);toast('Cor aplicada.')};$$('[data-save-setting]').forEach(b=>b.onclick=async()=>{const card=b.closest('[data-setting-place]'),[type,id]=card.dataset.settingPlace.split(':'),body={};$$('[data-k]',card).forEach(el=>body[el.dataset.k]=el.type==='checkbox'?el.checked:el.value);try{await api(`/api/app/v9/settings/${type}/${id}`,{method:'PUT',body});toast('Configuração salva.')}catch(e){toast(e.message,'error')}})};

// Escala do estabelecimento: vê somente a própria e pode inserir ou alterar suas linhas.
const v9Schedules=pages.schedules;pages.schedules=async function(){if(state.user?.role!=='establishment')return v9Schedules();const from=state.cache.scheduleFrom||mondayOf(isoDate()),to=state.cache.scheduleTo||addDays(from,6);state.cache.scheduleFrom=from;state.cache.scheduleTo=to;const [d,opt]=await Promise.all([api(`/api/app/schedule-grid${query({from,to,order:'day'})}`),api('/api/app/v9/establishment/schedule-options')]);const base={drivers:opt.drivers||[],shifts:opt.shifts||[],contracts:[],bases:[],establishments:opt.establishment?[opt.establishment]:[]};const tools=`<div class="schedule-tools"><input id="schedule-from" type="date" value="${from}"><input id="schedule-to" type="date" value="${to}"><button class="btn" id="schedule-apply">Filtrar</button><button class="btn" id="schedule-print">Imprimir</button><button class="btn primary" id="schedule-add-row">Acrescentar cooperado</button></div>`;$('#page-content').innerHTML=panel('Minha escala da semana',`<div class="notice">O estabelecimento vê e edita somente a própria escala. A cooperativa acompanha as alterações.</div><div class="table-wrap schedule-grid-wrap"><table class="schedule-grid"><thead><tr><th>DATA</th><th>Q</th><th>TURNO</th><th>HORÁRIOS</th><th>ESTABELECIMENTO</th><th>COOPERADO</th><th>ALERTA</th><th>AÇÕES</th></tr></thead><tbody id="schedule-grid-body">${(d.items||[]).map(x=>v8RowHtml(x,base)).join('')}</tbody></table></div>`,tools);$$('.schedule-grid-row').forEach(r=>v8BindGridRow(r,base));$('#schedule-add-row').onclick=()=>{const wrap=document.createElement('tbody');wrap.innerHTML=v8RowHtml({date:from,shift_label:'DIA',establishment_id:state.user.establishment_id},base,true);const r=wrap.firstElementChild;$('#schedule-grid-body').prepend(r);v8BindGridRow(r,base)};$('#schedule-apply').onclick=()=>{state.cache.scheduleFrom=$('#schedule-from').value;state.cache.scheduleTo=$('#schedule-to').value;pages.schedules()};$('#schedule-print').onclick=()=>v8SchedulePrint(d.items||[],'day')};

// Cliente: login, cadastro ou pedido avulso.
renderCustomerAccess=async function(){let social={providers:{}};try{social=await clientApi('/social-config')}catch{}$('#customer-content').innerHTML=`<section class="customer-hero"><p class="eyebrow">ChegaJá para clientes</p><h1>Peça uma entrega</h1><p>Entre, crie sua conta ou faça um pedido avulso.</p></section><div class="customer-auth-grid v9"><section class="customer-card"><h2>Entrar</h2><form id="customer-login" class="form-grid">${field('Celular ou e-mail','login','','text','required')}${field('Senha','password','','password','required')}${buttons('Entrar')}</form><div class="social-buttons"><button class="btn" disabled title="Configure OAuth no Cloudflare">Google ${social.providers?.google?'configurado':'— configurar'}</button><button class="btn" disabled title="Configure OAuth no Cloudflare">Apple/iCloud ${social.providers?.apple?'configurado':'— configurar'}</button></div></section><section class="customer-card"><h2>Criar conta</h2><form id="customer-register" class="form-grid">${field('Nome','name','','text','required')}${field('Celular','phone','','tel')}${field('E-mail','email','','email')}${field('Senha','password','','password','required minlength="8"')}${buttons('Criar conta')}</form></section><section class="customer-card guest-card"><h2>Pedir sem cadastro</h2><p>O acesso avulso permanece válido por 7 dias.</p><form id="customer-guest" class="form-grid">${field('Nome','name','','text','required')}${field('Celular','phone','','tel')}${field('E-mail (opcional)','email','','email')}${buttons('Continuar como avulso')}</form></section></div>`;const enter=d=>{lg.customerToken=d.token;lg.customer=d.customer;localStorage.setItem('ligerim_customer_token',d.token);renderCustomerHome()};$('#customer-login').onsubmit=async e=>{e.preventDefault();try{loading(true);enter(await clientApi('/login',{method:'POST',body:formObject(e.currentTarget)}))}catch(err){toast(err.message,'error')}finally{loading(false)}};$('#customer-register').onsubmit=async e=>{e.preventDefault();try{loading(true);enter(await clientApi('/register',{method:'POST',body:formObject(e.currentTarget)}))}catch(err){toast(err.message,'error')}finally{loading(false)}};$('#customer-guest').onsubmit=async e=>{e.preventDefault();try{loading(true);enter(await clientApi('/guest',{method:'POST',body:formObject(e.currentTarget)}))}catch(err){toast(err.message,'error')}finally{loading(false)}}};

// Rastreamento público estável: status a cada 5 s, chat a cada 2 s e sem destruir o formulário.
publicTracking=async function(token){$('#auth-screen').classList.add('hidden');$('#app-shell').classList.add('hidden');$('#customer-screen').classList.add('hidden');const screen=$('#tracking-screen');screen.classList.remove('hidden');clearInterval(v9.publicStatusTimer);clearInterval(v9.publicChatTimer);let current=null,lastMessage='';screen.innerHTML=`<div class="tracking-card v9-tracking"><header id="public-head" class="tracking-head"></header><div class="tracking-body"><div id="public-code-v9"></div><div class="privacy-banner"><strong>Proteja seus dados</strong><span>Não forneça seu telefone pessoal ao entregador. Converse pelo chat seguro desta entrega.</span></div><div id="public-address-v9" class="tracking-address"></div><div id="public-timeline-v9" class="tracking-timeline"></div><div id="public-map" class="map small"></div><div id="public-info-v9" class="tracking-info"></div><section class="public-chat"><header><h2>Conversa da entrega</h2><button class="btn small" id="public-sound-v9">🔈 Ativar sons</button></header><div id="public-chat-messages"></div><form id="public-chat-form" class="chat-form"><input name="message" maxlength="500" placeholder="Mensagem para o cooperado"><button class="btn primary">Enviar</button></form><div id="public-emojis"></div></section><div id="public-extra-v9"></div></div></div>`;const form=$('#public-chat-form'),input=form.elements.message;$('#public-emojis').innerHTML=v9EmojiBar(input);v9BindEmojis(screen,input);$('#public-sound-v9').onclick=async()=>{await sound.unlock();await sound.play('status');$('#public-sound-v9').textContent='🔊 Sons ativos'};
 const loadStatus=async()=>{try{const d=await api(`/api/public/tracking/${encodeURIComponent(token)}`),x=d.item;current=x;v9Theme(x.primary_color);if(v9.lastPublicStatus&&v9.lastPublicStatus!==x.status)await sound.play(x.status==='delivered'?'completed':'status');v9.lastPublicStatus=x.status;$('#public-head').innerHTML=`<div class="tracking-brand"><img src="/icons/icon-official.png" alt=""><div><p class="eyebrow">${esc(x.cooperative_name||'ChegaJá')}</p><h1>${esc(x.display_code||'Sua entrega')}</h1><p>${esc(x.establishment_name||x.base_name||'')}</p></div></div>${badge(x.status)}`;$('#public-code-v9').innerHTML=x.confirmation_code?`<div class="public-code"><small>CÓDIGO DE CONFIRMAÇÃO</small><strong>${esc(x.confirmation_code)}</strong><span>${x.confirmation_required?'Informe somente quando receber o pedido.':'Código opcional nesta entrega.'}</span></div>`:`<div class="public-code optional"><small>CONFIRMAÇÃO</small><strong>SEM CÓDIGO</strong><span>O responsável autorizou a conclusão sem código.</span></div>`;$('#public-address-v9').innerHTML=`<div class="address-box"><small>Coleta</small><strong>${esc(x.pickup_address)}</strong></div><div class="address-box"><small>Entrega</small><strong>${esc(x.delivery_address)}</strong></div>`;const steps=['assigned','accepted','to_pickup','at_pickup','picked_up','in_route','delivered'],idx=steps.indexOf(x.status);$('#public-timeline-v9').innerHTML=steps.map((s,i)=>`<div class="tracking-step ${i<=idx?'done':''}"><span class="step-dot"></span><div><strong>${statusText[s]}</strong>${i===idx?'<small>Status atual</small>':''}</div></div>`).join('');$('#public-info-v9').innerHTML=`<span><small>Cooperado</small><strong>${esc(x.driver_name||'Aguardando')}</strong></span><span><small>Distância</small><strong>${km(x.distance_meters)}</strong></span><span><small>Previsão</small><strong>${mins(x.duration_seconds)}</strong></span><span><small>Atualizado</small><strong>${dateTime(x.location_updated_at||x.updated_at)}</strong></span>`;const oldMap=$('#public-map');if(oldMap){const fresh=oldMap.cloneNode(false);oldMap.replaceWith(fresh)}renderLineMap('public-map',parseGeometry(x.route_geometry),[{lat:x.pickup_lat,lng:x.pickup_lng,label:'Coleta'},{lat:x.delivery_lat,lng:x.delivery_lng,label:'Entrega'},{lat:x.driver_lat,lng:x.driver_lng,label:x.driver_name||'Cooperado'}]);form.classList.toggle('hidden',!x.customer_chat_enabled||['delivered','cancelled','new','offered'].includes(x.status));$('#public-extra-v9').innerHTML=`${x.rating_available?`<section class="public-rating"><h2>Avalie a entrega</h2><form id="public-rating-v9" class="form-grid"><label>Estabelecimento<select name="establishment_score">${[5,4,3,2,1].map(n=>`<option value="${n}">${'★'.repeat(n)} (${n})</option>`).join('')}</select></label><label>Cooperado<select name="driver_score">${[5,4,3,2,1].map(n=>`<option value="${n}">${'★'.repeat(n)} (${n})</option>`).join('')}</select></label>${textarea('Comentário','comment')}<button class="btn primary full">Enviar avaliação</button></form></section>`:''}${x.receipt_available?'<button class="btn full" id="public-receipt-v9">Gerar recibo</button>':''}`;$('#public-rating-v9')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{await api(`/api/public/tracking/${encodeURIComponent(token)}/rating`,{method:'POST',body:formObject(f)});toast('Obrigado pela avaliação.');await loadStatus()}catch(err){toast(err.message,'error')}});$('#public-receipt-v9')?.addEventListener('click',()=>openReceipt(`/api/public/tracking/${encodeURIComponent(token)}/receipt`))}catch(e){screen.innerHTML=`<div class="tracking-card"><div class="tracking-body">${empty('Rastreamento indisponível',e.message)}</div></div>`;clearInterval(v9.publicStatusTimer);clearInterval(v9.publicChatTimer)}};
 const loadMessages=async(notify=true)=>{try{const d=await api(`/api/public/tracking/${encodeURIComponent(token)}/messages`),items=d.items||[],latest=items.at(-1);if(notify&&latest&&lastMessage&&latest.id!==lastMessage&&latest.sender_type!=='customer')await sound.play('message');if(latest)lastMessage=latest.id;const box=$('#public-chat-messages');if(box){box.innerHTML=items.map(m=>`<div class="chat-message ${m.sender_type==='customer'?'mine':''}"><small>${esc(m.sender_name)} • ${dateTime(m.created_at)}</small><p>${esc(m.message)}</p></div>`).join('')||'<p class="muted">Nenhuma mensagem.</p>';box.scrollTop=box.scrollHeight}form.classList.toggle('hidden',!d.active)}catch{}};
 form.onsubmit=async e=>{e.preventDefault();const formEl=e.currentTarget,msg=formEl.elements.message.value.trim();if(!msg)return;const button=formEl.querySelector('button');try{button.disabled=true;await api(`/api/public/tracking/${encodeURIComponent(token)}/messages`,{method:'POST',body:{message:msg}});if(formEl.isConnected)formEl.elements.message.value='';await loadMessages(false)}catch(err){toast(err.message,'error')}finally{if(formEl.isConnected)button.disabled=false}};await loadStatus();await loadMessages(false);v9.publicStatusTimer=setInterval(()=>{if(!document.hidden)loadStatus()},5000);v9.publicChatTimer=setInterval(()=>{if(!document.hidden)loadMessages(true)},2000)};

// Garante o complemento antes de abrir o fechamento semanal.
const v9Closings=pages.closings;pages.closings=async function(){if(['cooperative_admin','dispatcher'].includes(state.user?.role))await api('/api/app/v9/guarantees/settle',{method:'POST',body:{}}).catch(()=>{});return v9Closings()};

// Inicialização final.
// A inicialização é executada pelo último módulo, depois de todas as correções.


/* ===== ligerim-v10.js ===== */
/* Ligerim 10.0 — estabelecimento único, escala exclusiva da cooperativa e integração gerenciada pela cooperativa */
(function(){
  const removePages=(groups,blocked)=>groups.map(([title,pages])=>[title,pages.filter(p=>!blocked.includes(p))]).filter(([,pages])=>pages.length);

  pageMeta.shifts=['Horários dos estabelecimentos','◷'];
  pageMeta.schedules=['Escala da cooperativa','▦'];
  pageMeta.integrations=['Integrações dos estabelecimentos','⌘'];
  pageMeta.team=['Minha equipe escalada','♟'];
  delete pageMeta.contracts;
  delete pageMeta.prices;

  navByRole.cooperative_admin=[
    ['Minha cooperativa',['dashboard','users','establishments','drivers','bases','services','shifts']],
    ['Operação',['schedules','attendance','deliveries','tracking']],
    ['Financeiro',['financial','deductions','closings','advances','credits']],
    ['Integrações',['integrations']],
    ['Configuração',['settings','account']]
  ];
  navByRole.dispatcher=[
    ['Operação',['dashboard','establishments','drivers','bases','services','shifts','schedules','attendance','deliveries','tracking']],
    ['Integrações',['integrations']],
    ['Conta',['account']]
  ];
  navByRole.establishment=[['Meu estabelecimento',['dashboard','deliveries','team','tracking','schedules','account']]];

  if(typeof v8Modules!=='undefined'){
    for(let i=v8Modules.length-1;i>=0;i--){if(['contracts','prices'].includes(v8Modules[i][0]))v8Modules.splice(i,1)}
    const shift=v8Modules.find(x=>x[0]==='shifts');if(shift)shift[1]='Horários dos estabelecimentos';
  }
  if(typeof v8PageModule!=='undefined'){delete v8PageModule.contracts;delete v8PageModule.prices;}

  baseData=async function(force=false){
    const key=`v10:${state.selectedCoop||state.user.cooperative_id||'all'}`;
    if(!force&&state.cache.baseKey===key)return state.cache;
    const q=query(scopeParams());
    const [ests,drivers,shifts]=await Promise.all([
      api(`/api/app/establishments${q}`),api(`/api/app/drivers${q}`),api(`/api/app/shift-templates${q}`)
    ]);
    Object.assign(state.cache,{baseKey:key,establishments:ests.items||[],drivers:drivers.items||[],contracts:[],shifts:shifts.items||[]});
    return state.cache;
  };

  lgBase=async function(force=false){
    const key=`v10:${state.user?.cooperative_id||'tenant'}`;
    if(!force&&state.cache.lgBaseKey===key)return state.cache;
    const role=state.user.role;
    let e={items:[]},d={items:[]},s={items:[]};
    if(['cooperative_admin','dispatcher'].includes(role)){
      [e,d,s]=await Promise.all([api('/api/app/establishments'),api('/api/app/drivers'),api('/api/app/shift-templates')]);
    }
    const [b,sv]=await Promise.all([api('/api/app/tenant/bases').catch(()=>({items:[]})),api('/api/app/tenant/services').catch(()=>({items:[]}))]);
    Object.assign(state.cache,{lgBaseKey:key,establishments:e.items||[],drivers:d.items||[],contracts:[],shifts:s.items||[],bases:b.items||[],services:sv.items||[]});
    return state.cache;
  };

  const previousDashboard=pages.dashboard;
  pages.dashboard=async function(){
    await previousDashboard();
    if(state.user?.role==='establishment'){
      $$('[data-go="integrations"]').forEach(el=>el.remove());
      const quick=$('.quick-actions');
      if(quick&&!quick.children.length)quick.remove();
    }
  };

  const oldEstablishmentForm=establishmentForm;
  establishmentForm=function(item={}){
    oldEstablishmentForm(item);
    const notice=$('#est-form-v7 .notice');
    if(notice)notice.innerHTML='<strong>Acesso do estabelecimento</strong><br>O estabelecimento lança entregas e acompanha somente a própria operação. As chaves de integração são configuradas pela cooperativa.';
  };

  pages.establishments=async function(){
    const d=await api('/api/app/establishments');
    $('#page-content').innerHTML=panel('Estabelecimentos da cooperativa',table([
      {label:'Nome',key:'name'},{label:'Telefone',key:'phone'},
      {label:'Endereço confirmado',render:r=>`<span>${esc(r.address||'—')}</span>${r.address_confirmed?'<br><small class="ok-pill">Confirmado</small>':''}`,wrap:true},
      {label:'Valor por km',render:r=>money(r.rate_per_km_cents||0)},
      {label:'Taxa mínima',render:r=>money(r.minimum_fee_cents||0)},
      {label:'Acesso',render:r=>r.access_email?`<strong>${esc(r.access_email)}</strong><br>${badge(r.access_status||'active')}`:'<span class="muted">Sem acesso</span>'},
      {label:'Status',render:r=>badge(r.active?'active':'inactive')}
    ],d.items,r=>canEdit()?`<button class="table-action" data-qr-est="${r.id}">QR</button><button class="table-action" data-access-est="${r.id}">Acesso</button><button class="table-action" data-edit-est="${r.id}">Editar</button><button class="table-action danger" data-del-est="${r.id}">Excluir</button>`:''),canEdit()?'<button class="btn primary" id="new-est">Novo estabelecimento</button>':'');
    $('#new-est')?.addEventListener('click',()=>establishmentForm());
    $$('[data-edit-est]').forEach(b=>b.onclick=()=>establishmentForm(d.items.find(x=>x.id===b.dataset.editEst)));
    $$('[data-access-est]').forEach(b=>b.onclick=()=>linkedAccessForm('establishment',d.items.find(x=>x.id===b.dataset.accessEst)));
    $$('[data-qr-est]').forEach(b=>b.onclick=()=>showEstablishmentQr(d.items.find(x=>x.id===b.dataset.qrEst)));
    $$('[data-del-est]').forEach(b=>b.onclick=()=>removeEntity(`/api/app/establishments/${b.dataset.delEst}`,'Excluir este estabelecimento?',pages.establishments));
  };

  pages.contracts=async()=>{toast('Contrato e estabelecimento agora são a mesma coisa.','info');return navigate('establishments',false)};
  pages.prices=async()=>{toast('O valor é calculado por quilômetro e taxa mínima no cadastro do estabelecimento.','info');return navigate('establishments',false)};

  pages.shifts=async function(){
    const [d,ests]=await Promise.all([api('/api/app/shift-templates'),api('/api/app/establishments')]);
    const items=d.items||[],establishments=ests.items||[];
    $('#page-content').innerHTML=panel('Horários cadastrados por estabelecimento',
      `<div class="notice">A cooperativa cadastra os horários usados em cada estabelecimento. Esses horários aparecem como opções na planilha da escala.</div>`+
      table([
        {label:'Estabelecimento',render:r=>esc(r.establishment_name||'Geral / qualquer estabelecimento')},
        {label:'Nome',key:'name'},{label:'Horário',render:r=>`<strong>${esc(r.start_time)} às ${esc(r.end_time)}</strong>`},
        {label:'Turno',key:'shift_label'},{label:'Status',render:r=>badge(r.active?'active':'inactive')}
      ],items,r=>`${v8Permission('shifts','edit')?`<button class="table-action" data-v10-shift-edit="${r.id}">Editar</button>`:''}${v8Permission('shifts','delete')?`<button class="table-action danger" data-v10-shift-del="${r.id}">Excluir</button>`:''}`),
      v8Permission('shifts','create')?'<button class="btn primary" id="v10-new-shift">Novo horário</button>':'');
    const open=(item={})=>{
      openModal(item.id?'Editar horário':'Novo horário',`<form id="v10-shift-form" class="form-grid">
        ${selectField('Estabelecimento','establishment_id',establishments,item.establishment_id,'Geral / qualquer estabelecimento')}
        ${field('Nome do horário','name',item.name,'text','required placeholder="Ex.: 11h às 15h"')}
        ${field('Turno','shift_label',item.shift_label||'DIA','text','required')}
        ${field('Hora inicial','start_time',item.start_time,'time','required')}${field('Hora final','end_time',item.end_time,'time','required')}${buttons()}
      </form>`);
      $('#v10-shift-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/shift-templates${item.id?`/${item.id}`:''}`,{method:item.id?'PUT':'POST',body:formObject(e.currentTarget)});closeModal();clearTenantCache();toast('Horário salvo.');pages.shifts()}catch(err){toast(err.message,'error')}finally{loading(false)}};
    };
    $('#v10-new-shift')?.addEventListener('click',()=>open());
    $$('[data-v10-shift-edit]').forEach(b=>b.onclick=()=>open(items.find(x=>x.id===b.dataset.v10ShiftEdit)));
    $$('[data-v10-shift-del]').forEach(b=>b.onclick=()=>removeEntity(`/api/app/shift-templates/${b.dataset.v10ShiftDel}`,'Excluir este horário?',pages.shifts));
  };

  v8LocalOptions=function(base,selected){
    const options=[];
    (base.establishments||[]).forEach(x=>options.push({value:`establishment:${x.id}`,name:x.name}));
    (base.bases||[]).forEach(x=>options.push({value:`base:${x.id}`,name:`BASE — ${x.name}`}));
    return `<option value="">Selecione</option>${options.map(x=>`<option value="${x.value}" ${x.value===selected?'selected':''}>${esc(x.name)}</option>`).join('')}`;
  };
  v8SelectedLocal=function(item){return item.base_id?`base:${item.base_id}`:item.establishment_id?`establishment:${item.establishment_id}`:''};
  v8ShiftOptions=function(base,establishmentId,selected){return `<option value="">Horário manual</option>${(base.shifts||[]).filter(x=>!x.establishment_id||x.establishment_id===establishmentId).map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''} data-start="${x.start_time}" data-end="${x.end_time}" data-label="${esc(x.shift_label)}">${esc(x.name)} • ${x.start_time}–${x.end_time}</option>`).join('')}`};
  v8RowBody=function(row){const [kind,targetId]=row.querySelector('.grid-local').value.split(':');return{date:row.querySelector('.grid-date').value,sort_order:row.querySelector('.grid-order').value,shift_label:row.querySelector('.grid-shift').value,shift_template_id:row.querySelector('.grid-template').value,start_time:row.querySelector('.grid-start').value,end_time:row.querySelector('.grid-end').value,driver_id:row.querySelector('.grid-driver').value,base_id:kind==='base'?targetId:'',establishment_id:kind==='establishment'?targetId:'',contract_id:''}};
  v8RowHtml=function(item,base,isNew=false){
    const date=String(item.start_at||item.date||isoDate()).slice(0,10),start=String(item.start_at||'').slice(11,16)||'08:00',end=String(item.end_at||'').slice(11,16)||'17:00';
    const selectedLocal=v8SelectedLocal(item),establishmentId=item.establishment_id||'';
    return `<tr class="schedule-grid-row ${item.has_conflict?'schedule-conflict':''}" data-id="${item.id||''}" data-new="${isNew?'1':'0'}">
      <td><input class="grid-date" type="date" value="${date}"></td><td><input class="grid-order" type="number" min="1" value="${item.sort_order||''}" placeholder="Auto"></td>
      <td><input class="grid-shift" value="${esc(item.shift_label||'DIA')}" maxlength="40"></td>
      <td><select class="grid-template">${v8ShiftOptions(base,establishmentId,item.shift_template_id)}</select><div class="grid-time-pair"><input class="grid-start" type="time" value="${start}"><span>às</span><input class="grid-end" type="time" value="${end}"></div></td>
      <td><select class="grid-local">${v8LocalOptions(base,selectedLocal)}</select></td>
      <td><select class="grid-driver"><option value="">Selecione</option>${(base.drivers||[]).map(x=>`<option value="${x.id}" ${x.id===item.driver_id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></td>
      <td class="grid-alert">${item.has_conflict?'<span class="conflict-pill">Conflito</span>':'<span class="ok-pill">Livre</span>'}</td>
      <td><div class="actions"><button class="table-action primary" data-grid-save>Salvar</button>${!isNew?`<button class="table-action" data-grid-clone>Clonar</button><button class="table-action danger" data-grid-delete>Excluir</button>`:'<button class="table-action" data-grid-cancel>Cancelar</button>'}</div></td>
    </tr>`;
  };
  v8BindGridRow=function(row,base){
    const local=row.querySelector('.grid-local'),template=row.querySelector('.grid-template');
    local.onchange=()=>{const [kind,id]=local.value.split(':');template.innerHTML=v8ShiftOptions(base,kind==='establishment'?id:'',template.value)};
    template.onchange=()=>{const opt=template.selectedOptions[0];if(opt?.dataset.start){row.querySelector('.grid-start').value=opt.dataset.start;row.querySelector('.grid-end').value=opt.dataset.end;row.querySelector('.grid-shift').value=opt.dataset.label||'TURNO'}};
    row.querySelector('[data-grid-cancel]')?.addEventListener('click',()=>row.remove());
    row.querySelector('[data-grid-save]')?.addEventListener('click',async()=>{const body=v8RowBody(row),scheduleId=row.dataset.id;try{loading(true);const result=await api(`/api/app/schedule-grid${scheduleId?`/${scheduleId}`:''}`,{method:scheduleId?'PUT':'POST',body});toast('Linha da escala salva.');if(result.warnings?.length)alert(result.warnings.join('\n\n'));clearTenantCache();await pages.schedules()}catch(err){if(err.status===409&&confirm(`${err.message}\nDeseja manter as duas escalas mesmo assim?`)){body.allow_conflict=true;const result=await api(`/api/app/schedule-grid${scheduleId?`/${scheduleId}`:''}`,{method:scheduleId?'PUT':'POST',body});toast('Escala salva com alerta de conflito.');if(result.warnings?.length)alert(result.warnings.join('\n\n'));await pages.schedules()}else toast(err.message,'error')}finally{loading(false)}});
    row.querySelector('[data-grid-delete]')?.addEventListener('click',async()=>{if(!confirm('Retirar esta linha da escala?'))return;try{await api(`/api/app/schedule-grid/${row.dataset.id}`,{method:'DELETE'});toast('Linha retirada.');pages.schedules()}catch(e){toast(e.message,'error')}});
    row.querySelector('[data-grid-clone]')?.addEventListener('click',async()=>{const date=prompt('Data da cópia (AAAA-MM-DD):',row.querySelector('.grid-date').value);if(!date)return;try{await api(`/api/app/schedule-grid/${row.dataset.id}/clone`,{method:'POST',body:{date}});toast('Escala clonada.');pages.schedules()}catch(e){toast(e.message,'error')}});
  };
  v8SchedulePrint=function(items,order){
    const rows=[...(items||[])];
    rows.sort(order==='alphabetical'?(a,b)=>String(a.driver_name).localeCompare(String(b.driver_name),'pt-BR')||String(a.start_at).localeCompare(String(b.start_at)):(a,b)=>String(a.start_at).localeCompare(String(b.start_at))||String(a.base_name||a.establishment_name).localeCompare(String(b.base_name||b.establishment_name),'pt-BR')||Number(a.sort_order||999)-Number(b.sort_order||999));
    let sheet=$('#schedule-print-sheet');if(!sheet){sheet=document.createElement('section');sheet.id='schedule-print-sheet';document.body.append(sheet)}
    sheet.innerHTML=`<header><img src="/icons/logo-official.png" alt="ChegaJá"><div><h1>ESCALA DE TRABALHO</h1><p>${esc(state.user.cooperative_name||state.user.establishment_name||'ChegaJá')} • ${dateOnly(state.cache.scheduleFrom)} a ${dateOnly(state.cache.scheduleTo)}</p></div></header><table><thead><tr><th>DATA</th><th>Q</th><th>TURNO</th><th>HORÁRIOS</th><th>ESTABELECIMENTO / BASE</th><th>NOME DO COOPERADO</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.has_conflict?'print-conflict':''}"><td>${v8DateLabel(String(r.start_at).slice(0,10))}</td><td>${r.sort_order||''}</td><td>${esc(r.shift_label||'')}</td><td>${timeOnly(r.start_at)} às ${timeOnly(r.end_at)}</td><td>${esc(r.base_name?`BASE — ${r.base_name}`:r.establishment_name||'')}</td><td>${esc(r.driver_name)}</td></tr>`).join('')}</tbody></table><footer>Gerado pelo ChegaJá em ${new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</footer>`;
    document.body.classList.add('schedule-printing');window.print();setTimeout(()=>document.body.classList.remove('schedule-printing'),500);
  };

  pages.schedules=async function(){
    const from=state.cache.scheduleFrom||mondayOf(isoDate()),to=state.cache.scheduleTo||addDays(from,6),order=state.cache.scheduleOrder||'day';
    state.cache.scheduleFrom=from;state.cache.scheduleTo=to;
    const isManager=['cooperative_admin','dispatcher'].includes(state.user.role);
    const base=isManager?await lgBase(true):{drivers:[],establishments:[],bases:[],shifts:[]};
    const params={from,to,order,driver_id:isManager?(state.cache.scheduleDriver||''):'',establishment_id:isManager?(state.cache.scheduleEstablishment||''):''};
    const d=await api(`/api/app/schedule-grid${query(params)}`);state.cache.scheduleItems=d.items||[];
    const manage=isManager&&v8Permission('schedules','edit'),create=isManager&&v8Permission('schedules','create');
    let tools=`<div class="schedule-tools"><input id="schedule-from" type="date" value="${from}"><span>até</span><input id="schedule-to" type="date" value="${to}">`;
    if(isManager)tools+=`<select id="schedule-driver-filter"><option value="">Todos os cooperados</option>${(base.drivers||[]).map(x=>`<option value="${x.id}" ${state.cache.scheduleDriver===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><select id="schedule-est-filter"><option value="">Todos os estabelecimentos</option>${(base.establishments||[]).map(x=>`<option value="${x.id}" ${state.cache.scheduleEstablishment===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`;
    tools+=`<select id="schedule-order"><option value="day" ${order==='day'?'selected':''}>Por dia e estabelecimento</option><option value="alphabetical" ${order==='alphabetical'?'selected':''}>Ordem alfabética</option></select><button class="btn" id="schedule-apply">Filtrar</button><button class="btn" id="schedule-print">Imprimir</button>${create?'<button class="btn primary" id="schedule-add-row">Acrescentar linha</button>':''}${isManager||state.user.role==='driver'?'<button class="btn soft" id="schedule-swaps">Trocas</button>':''}</div>`;
    const readTable=table([{label:'Data',render:r=>v8DateLabel(String(r.start_at).slice(0,10))},{label:'Q',key:'sort_order'},{label:'Turno',key:'shift_label'},{label:'Horários',render:r=>`${timeOnly(r.start_at)} às ${timeOnly(r.end_at)}`},{label:'Estabelecimento / Base',render:r=>esc(r.base_name?`BASE — ${r.base_name}`:r.establishment_name||'')},{label:'Cooperado',key:'driver_name'},{label:'Online',render:r=>badge(r.driver_online?'active':'inactive')}],d.items||[]);
    const grid=manage?`<div class="schedule-grid-help">Somente a cooperativa edita a escala. O estabelecimento apenas consulta os cooperados escalados para ele.</div><div class="table-wrap schedule-grid-wrap"><table class="schedule-grid"><thead><tr><th>DATA</th><th>Q</th><th>TURNO</th><th>HORÁRIOS</th><th>ESTABELECIMENTO / BASE</th><th>COOPERADO</th><th>ALERTA</th><th>AÇÕES</th></tr></thead><tbody id="schedule-grid-body">${(d.items||[]).map(x=>v8RowHtml(x,base)).join('')}</tbody></table></div>`:readTable;
    const title=state.user.role==='establishment'?'Escala do meu estabelecimento':state.user.role==='driver'?'Minhas escalas':'Escala editável da cooperativa';
    $('#page-content').innerHTML=panel(title,grid,tools)+`<div id="schedule-swaps-area"></div>`;
    $$('.schedule-grid-row').forEach(row=>v8BindGridRow(row,base));
    $('#schedule-add-row')?.addEventListener('click',()=>{const tbody=$('#schedule-grid-body'),wrapper=document.createElement('tbody');wrapper.innerHTML=v8RowHtml({date:from,shift_label:'DIA'},base,true);const row=wrapper.firstElementChild;tbody.prepend(row);v8BindGridRow(row,base);row.querySelector('input,select')?.focus()});
    $('#schedule-apply').onclick=()=>{state.cache.scheduleFrom=$('#schedule-from').value;state.cache.scheduleTo=$('#schedule-to').value;if(isManager){state.cache.scheduleDriver=$('#schedule-driver-filter').value;state.cache.scheduleEstablishment=$('#schedule-est-filter').value}state.cache.scheduleOrder=$('#schedule-order').value;pages.schedules()};
    $('#schedule-print').onclick=()=>v8SchedulePrint(d.items||[],$('#schedule-order').value);
    $('#schedule-swaps')?.addEventListener('click',()=>v8RenderSwaps(base,state.user.role==='driver'));
    if(state.user.role==='driver')v8RenderSwaps(base,true);
  };

  pages.team=async function(){
    if(state.user.role!=='establishment')return navigate('schedules',false);
    const mode=state.cache.teamMode||'today',from=mode==='week'?mondayOf(isoDate()):isoDate(),to=mode==='week'?addDays(from,6):from;
    const d=await api(`/api/app/schedule-grid${query({from,to,order:'day'})}`),items=d.items||[];
    const tools=`<div class="toolbar"><button class="btn ${mode==='today'?'primary':''}" data-team-mode="today">Hoje</button><button class="btn ${mode==='week'?'primary':''}" data-team-mode="week">Semana</button></div>`;
    $('#page-content').innerHTML=panel(mode==='today'?'Cooperados escalados hoje':'Cooperados escalados nesta semana',table([
      {label:'Data',render:r=>v8DateLabel(String(r.start_at).slice(0,10))},{label:'Cooperado',key:'driver_name'},{label:'Turno',key:'shift_label'},
      {label:'Horário',render:r=>`${timeOnly(r.start_at)} às ${timeOnly(r.end_at)}`},{label:'Situação',render:r=>badge(r.driver_online?'active':'inactive')}
    ],items),tools);
    $$('[data-team-mode]').forEach(b=>b.onclick=()=>{state.cache.teamMode=b.dataset.teamMode;pages.team()});
  };

  const previousIntegrations=pages.integrations;
  pages.integrations=async function(){
    if(!['cooperative_admin','dispatcher'].includes(state.user.role))return navigate('dashboard',false);
    await previousIntegrations();
    const first=$('#page-content .notice');
    if(first)first.innerHTML='<strong>Responsabilidade da cooperativa:</strong> selecione o estabelecimento e configure a chave de API, o webhook ou o conector do sistema dele. O estabelecimento não acessa nem altera estas credenciais.';
  };

  const previousNavigate=navigate;
  navigate=async function(page,push=true){
    if(['contracts','prices'].includes(page))page='establishments';
    if(state.user?.role==='establishment'&&page==='integrations')page='dashboard';
    return previousNavigate(page,push);
  };

  // Garante que o menu já aberto seja atualizado depois do carregamento deste módulo.
  if(state.user)renderNav();
})();


/* ===== ligerim-v11.js ===== */
/* Ligerim 10.1 — filas por chegada, relatórios completos e painel financeiro */
(function(){
  Object.assign(pageMeta,{
    queue:['Lista de espera','≋'],reports:['Relatórios','▤'],analytics:['Faturamento e despesas','▥'],expenses:['Despesas','−'],baseCustomers:['Clientes da Base','◎']
  });
  if(typeof v8PageModule!=='undefined')Object.assign(v8PageModule,{queue:'deliveries',reports:'deliveries',analytics:'financial',expenses:'financial',baseCustomers:'credits'});
  if(typeof v8Modules!=='undefined'){
    [['queue','Lista de espera'],['reports','Relatórios'],['analytics','Faturamento e despesas'],['expenses','Despesas'],['baseCustomers','Clientes da Base']].forEach(x=>{if(!v8Modules.some(y=>y[0]===x[0]))v8Modules.push(x)});
  }

  navByRole.cooperative_admin=[
    ['Minha cooperativa',['dashboard','users','establishments','drivers','bases','baseCustomers','services','shifts']],
    ['Operação',['schedules','queue','attendance','deliveries','tracking']],
    ['Financeiro',['analytics','reports','expenses','financial','deductions','closings','advances','credits']],
    ['Integrações',['integrations']],['Configuração',['operationalSettings','settings','account']]
  ];
  navByRole.dispatcher=[
    ['Operação',['dashboard','establishments','drivers','bases','baseCustomers','services','shifts','schedules','queue','attendance','deliveries','tracking']],
    ['Relatórios',['analytics','reports']],['Integrações',['integrations']],['Conta',['account']]
  ];
  navByRole.establishment=[['Meu estabelecimento',['dashboard','deliveries','team','queue','tracking','schedules','reports','account']]];
  const csvDownload=(name,rows)=>{const text=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(';')).join('\r\n');const blob=new Blob(['\ufeff'+text],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)};
  const reportRange=()=>({from:state.cache.reportFrom||mondayOf(isoDate()),to:state.cache.reportTo||isoDate(),group:state.cache.reportGroup||'day'});
  const reportTools=(extra='')=>{const r=reportRange();return `<div class="toolbar report-toolbar"><input id="report-from" type="date" value="${r.from}"><input id="report-to" type="date" value="${r.to}"><select id="report-group"><option value="day" ${r.group==='day'?'selected':''}>Diário</option><option value="week" ${r.group==='week'?'selected':''}>Semanal</option><option value="month" ${r.group==='month'?'selected':''}>Mensal</option><option value="year" ${r.group==='year'?'selected':''}>Anual</option></select>${extra}<button class="btn primary" id="report-apply">Aplicar</button><button class="btn" id="report-week">Semana atual</button><button class="btn" id="report-month">Mês atual</button><button class="btn" id="report-year">Ano atual</button></div>`};
  const bindReportTools=(reload)=>{$('#report-apply').onclick=()=>{state.cache.reportFrom=$('#report-from').value;state.cache.reportTo=$('#report-to').value;state.cache.reportGroup=$('#report-group').value;state.cache.reportEstablishment=$('#report-establishment')?.value||'';state.cache.reportBase=$('#report-base')?.value||'';reload()};$('#report-week').onclick=()=>{state.cache.reportFrom=mondayOf(isoDate());state.cache.reportTo=addDays(state.cache.reportFrom,6);reload()};$('#report-month').onclick=()=>{const d=isoDate();state.cache.reportFrom=d.slice(0,8)+'01';state.cache.reportTo=d;reload()};$('#report-year').onclick=()=>{const d=isoDate();state.cache.reportFrom=d.slice(0,4)+'-01-01';state.cache.reportTo=d;reload()}};

  pages.queue=async function(){
    if(state.user.role==='driver'){
      const d=await api('/api/app/v10/queue/locations'),active=d.active;
      $('#page-content').innerHTML=panel('Lista de espera',`<div class="queue-driver-card"><div class="queue-driver-status ${active?'waiting':''}"><span>${active?'✓':'○'}</span><div><strong>${active?'Você está na fila':'Chegue ao local para entrar na fila'}</strong><small>${active?esc(active.location_name):'Fique online e toque em Cheguei.'}</small></div></div><div class="queue-location-list">${(d.items||[]).map(x=>`<button class="queue-location" data-arrive-type="${x.location_type}" data-arrive-id="${x.location_id}"><strong>${esc(x.location_name)}</strong><small>${timeOnly(x.start_at)} às ${timeOnly(x.end_at)}</small><span>Cheguei</span></button>`).join('')||'<div class="empty">Nenhuma escala para hoje.</div>'}</div>${active?'<button class="btn danger full" id="queue-leave">Sair da lista de espera</button>':''}</div>`);
      $$('[data-arrive-id]').forEach(b=>b.onclick=async()=>{try{await api('/api/app/v10/queue/arrive',{method:'POST',body:{location_type:b.dataset.arriveType,location_id:b.dataset.arriveId}});await sound.play('status');toast('Entrada registrada na lista de espera.');pages.queue()}catch(e){toast(e.message,'error')}});$('#queue-leave')?.addEventListener('click',async()=>{await api('/api/app/v10/queue/leave',{method:'POST'});await sound.play('offline');pages.queue()});return;
    }
    const [d,base]=await Promise.all([api('/api/app/v10/queue'),['cooperative_admin','dispatcher'].includes(state.user.role)?lgBase():Promise.resolve({})]);
    const groups={};(d.items||[]).forEach(x=>(groups[`${x.location_type}:${x.base_id||x.establishment_id}`]??={name:x.location_name,type:x.location_type,items:[]}).items.push(x));
    const filter=state.user.role==='establishment'?'':`<div class="notice">A ordem é definida pelo horário em que o cooperado tocou em <strong>Cheguei</strong>. O primeiro online e escalado aparece como cooperado da vez.</div>`;
    $('#page-content').innerHTML=filter+Object.values(groups).map(g=>panel(`${g.type==='base'?'Base':'Estabelecimento'} — ${esc(g.name)}`,`<div class="waiting-list">${g.items.map((x,i)=>`<article class="waiting-row ${i===0?'next':''}"><span class="waiting-number">${x.queue_position}</span><div><strong>${esc(x.driver_name)}</strong><small>${esc([x.vehicle_model,x.vehicle_plate].filter(Boolean).join(' • ')||'Cooperado')} • chegada ${dateTime(x.arrived_at)}</small></div>${i===0?'<b>DA VEZ</b>':''}</article>`).join('')}</div>`)).join('')||panel('Lista de espera',empty('Nenhum cooperado aguardando','Quando um cooperado escalado tocar em Cheguei, ele aparecerá aqui.'));
  };

  assignV6=async function(delivery){try{loading(true);const d=await api(`/api/app/v10/deliveries/${delivery.id}/eligible-drivers`),items=(d.items||[]).map(x=>({...x,name:`${x.recommended?'★ DA VEZ — ':''}${x.name}${x.queue_position?` • fila ${x.queue_position}`:''}`}));openModal(`Atribuir • ${delivery.display_code}`,`<div class="notice"><strong>Somente online + escalado hoje.</strong><br>O primeiro da lista de espera aparece como recomendado.</div><form id="assign-v11" class="form-grid">${selectField('Cooperado','driver_id',items,delivery.assigned_driver_id,'Selecione')}<div class="form-actions assignment-actions"><button type="button" class="btn" id="unassign-v11">Não atribuída</button><button type="button" class="btn soft" id="offer-v11">Oferecer aos elegíveis</button><button class="btn primary">Atribuir</button></div></form>`);const form=$('#assign-v11');form.onsubmit=async e=>{e.preventDefault();const driver_id=form.elements.driver_id.value;if(!driver_id)return toast('Selecione o cooperado.','error');await api(`/api/app/v10/deliveries/${delivery.id}/assignment`,{method:'POST',body:{driver_id}});closeModal();await sound.play('assigned');toast('Entrega atribuída.');pages.deliveries()};$('#unassign-v11').onclick=async()=>{await api(`/api/app/v10/deliveries/${delivery.id}/assignment`,{method:'POST',body:{action:'unassign'}});closeModal();await sound.play('problem');pages.deliveries()};$('#offer-v11').onclick=async()=>{await api(`/api/app/v10/deliveries/${delivery.id}/assignment`,{method:'POST',body:{action:'offer_all'}});closeModal();await sound.play('new_order');pages.deliveries()}}catch(e){toast(e.message,'error')}finally{loading(false)}};

  pages.reports=async function(){
    const r=reportRange(),base=['cooperative_admin','dispatcher'].includes(state.user.role)?await lgBase():{};
    const extra=state.user.role==='establishment'?'':`<select id="report-establishment"><option value="">Todos os estabelecimentos</option>${(base.establishments||[]).map(x=>`<option value="${x.id}" ${state.cache.reportEstablishment===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><select id="report-base"><option value="">Todas as Bases</option>${(base.bases||[]).map(x=>`<option value="${x.id}" ${state.cache.reportBase===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`;
    const params={from:r.from,to:r.to,group:r.group,establishment_id:state.cache.reportEstablishment||'',base_id:state.cache.reportBase||''},d=await api(`/api/app/v10/reports/deliveries${query(params)}`),s=d.summary||{};
    const activeTab=state.cache.reportTab==='guarantees'?'guarantees':'deliveries';
    const tabs=`<div class="toolbar" style="margin-bottom:18px"><button class="btn ${activeTab==='deliveries'?'primary':''}" data-report-tab="deliveries">Entregas</button><button class="btn ${activeTab==='guarantees'?'primary':''}" data-report-tab="guarantees">Complementos de garantido</button></div>`;
    if(activeTab==='guarantees'){
      const g=d.guarantee_summary||{},weekdayNames=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
      const weekdayRows=(d.guarantee_by_weekday||[]).map(x=>({...x,weekday_name:weekdayNames[Number(x.weekday)]||'Dia'}));
      const guaranteeItems=(d.guarantee_items||[]).map(x=>({...x,weekday_name:weekdayNames[new Date(`${x.day}T12:00:00`).getDay()]||'Dia'}));
      const isFullWeek=addDays(r.from,6)===r.to;
      const summaryCards=cards([
        {icon:'＋',value:money(g.complement_cents),label:isFullWeek?'Total complementado na semana':'Total complementado no período'},
        {icon:'▤',value:g.complement_count||0,label:'Vezes que houve complemento'},
        {icon:'✓',value:g.complement_days||0,label:'Dias com complemento'},
        {icon:'＄',value:money(g.guaranteed_cents),label:'Garantido total dos turnos'},
        {icon:'→',value:money(g.eligible_delivery_cents),label:'Corridas produzidas nos turnos'}
      ]);
      const weekdayPanel=panel('Complementos por dia da semana',table([
        {label:'Dia da semana',key:'weekday_name'},
        {label:'Vezes complementadas',key:'complement_count'},
        {label:'Dias no período',key:'complement_days'},
        {label:'Garantido dos turnos',render:x=>money(x.guaranteed_cents)},
        {label:'Corridas dos turnos',render:x=>money(x.eligible_delivery_cents)},
        {label:'Total complementado',render:x=>`<strong>${money(x.complement_cents)}</strong>`}
      ],weekdayRows),reportTools(extra));
      const detailPanel=panel('Turnos que receberam complemento',table([
        {label:'Data',render:x=>dateOnly(x.day)},
        {label:'Dia',key:'weekday_name'},
        {label:'Horário',render:x=>`${timeOnly(x.start_at)} às ${timeOnly(x.end_at)}`},
        {label:'Cooperado',key:'driver_name'},
        {label:'Estabelecimento',key:'establishment_name'},
        {label:'Garantido',render:x=>money(x.guaranteed_cents)},
        {label:'Corridas',render:x=>money(x.eligible_delivery_cents)},
        {label:'Complemento',render:x=>`<strong>${money(x.complement_cents)}</strong>`}
      ],guaranteeItems),'<button class="btn" id="guarantee-csv">Exportar complementos CSV</button>');
      $('#page-content').innerHTML=tabs+summaryCards+weekdayPanel+detailPanel;
      bindReportTools(pages.reports);
      $('#guarantee-csv')?.addEventListener('click',()=>csvDownload(`chegaja-complementos-${r.from}-${r.to}.csv`,[
        ['Data','Dia da semana','Horário','Cooperado','Estabelecimento','Garantido','Corridas do turno','Complemento'],
        ...guaranteeItems.map(x=>[x.day,x.weekday_name,`${timeOnly(x.start_at)} às ${timeOnly(x.end_at)}`,x.driver_name,x.establishment_name,(Number(x.guaranteed_cents||0)/100).toFixed(2),(Number(x.eligible_delivery_cents||0)/100).toFixed(2),(Number(x.complement_cents||0)/100).toFixed(2)])
      ]));
    }else{
      $('#page-content').innerHTML=tabs+cards([{icon:'▤',value:s.total_orders||0,label:'Pedidos no período'},{icon:'✓',value:s.delivered_count||0,label:'Entregues'},{icon:'➜',value:s.active_count||0,label:'Em andamento'},{icon:'＄',value:money(s.amount_due_cents),label:state.user.role==='establishment'?'Total a pagar':'Faturamento'},{icon:'✓',value:money(s.paid_cents),label:'Pago'},{icon:'!',value:money(s.pending_cents),label:'Pendente'}])+panel('Resumo por período',table([{label:'Período',key:'period'},{label:'Pedidos',key:'total_orders'},{label:'Entregues',key:'delivered_count'},{label:'Valor',render:x=>money(x.amount_cents)}],d.grouped||[]),reportTools(extra))+panel('Entregas detalhadas',table([{label:'Pedido',key:'display_code'},{label:'Data',render:x=>dateTime(x.delivered_at||x.created_at)},{label:'Origem',render:x=>esc(x.base_name||x.establishment_name||'')},{label:'Cliente',key:'customer_name'},{label:'Cooperado',key:'driver_name'},{label:'Destino',key:'delivery_address',wrap:true},{label:'Status',render:x=>badge(x.status)},{label:'Valor',render:x=>money(x.charge_cents)}],d.items||[]),'<button class="btn" id="report-csv">Exportar CSV</button>');
      bindReportTools(pages.reports);$('#report-csv').onclick=()=>csvDownload(`ligerim-entregas-${r.from}-${r.to}.csv`,[['Pedido','Data','Origem','Cliente','Cooperado','Destino','Status','Valor'],...(d.items||[]).map(x=>[x.display_code,x.delivered_at||x.created_at,x.base_name||x.establishment_name,x.customer_name,x.driver_name,x.delivery_address,statusText[x.status]||x.status,(Number(x.charge_cents||0)/100).toFixed(2)])]);
    }
    $$('[data-report-tab]').forEach(button=>button.onclick=()=>{state.cache.reportTab=button.dataset.reportTab;pages.reports()});
  };

  pages.analytics=async function(){
    const r=reportRange(),d=await api(`/api/app/v10/reports/financial${query({from:r.from,to:r.to})}`),s=d.summary||{};
    $('#page-content').innerHTML=cards([{icon:'＄',value:money(s.billed_cents),label:'Faturamento total'},{icon:'♟',value:money(s.driver_gross_cents),label:'Produção dos cooperados'},{icon:'◈',value:money(s.cooperative_revenue_cents),label:'Receita da cooperativa'},{icon:'−',value:money(s.expenses_cents),label:'Despesas'},{icon:'=',value:money(s.net_result_cents),label:'Resultado líquido'},{icon:'▤',value:s.total_orders||0,label:'Entregas'}])+panel('Faturamento por estabelecimento e Base',table([{label:'Local',key:'location_name'},{label:'Tipo',render:x=>x.location_type==='base'?'Base':'Estabelecimento'},{label:'Entregas',key:'total_orders'},{label:'Faturamento',render:x=>money(x.billed_cents)},{label:'Produção',render:x=>money(x.driver_gross_cents)},{label:'Receita',render:x=>money(x.cooperative_revenue_cents)}],d.breakdown||[]),reportTools())+panel('Evolução diária',table([{label:'Data',render:x=>dateOnly(x.day)},{label:'Entregas',key:'total_orders'},{label:'Faturamento',render:x=>money(x.billed_cents)},{label:'Receita',render:x=>money(x.cooperative_revenue_cents)}],d.daily||[]));bindReportTools(pages.analytics);
  };

  pages.expenses=async function(){
    const r=reportRange(),d=await api(`/api/app/v10/expenses${query({from:r.from,to:r.to})}`),total=(d.items||[]).reduce((a,x)=>a+Number(x.amount_cents||0),0);
    $('#page-content').innerHTML=cards([{icon:'−',value:money(total),label:'Despesas no período'}])+panel('Despesas da cooperativa',table([{label:'Data',render:x=>dateOnly(x.reference_date)},{label:'Categoria',key:'category'},{label:'Descrição',key:'description',wrap:true},{label:'Local',render:x=>esc(x.base_name||x.establishment_name||'Geral')},{label:'Valor',render:x=>money(x.amount_cents)},{label:'Lançado por',key:'created_by_name'}],d.items||[],x=>state.user.role==='cooperative_admin'?`<button class="table-action" data-del-expense="${x.id}">Excluir</button>`:''),reportTools()+(state.user.role==='cooperative_admin'?'<button class="btn primary" id="new-expense">Nova despesa</button>':''));bindReportTools(pages.expenses);$('#new-expense')?.addEventListener('click',()=>{openModal('Nova despesa',`<form id="expense-form" class="form-grid">${field('Data','reference_date',isoDate(),'date','required')}${field('Categoria','category','','text','required')}${field('Valor','amount','','number','required step="0.01" min="0.01"')}${textarea('Descrição','description','','required')}${buttons()}</form>`);$('#expense-form').onsubmit=async e=>{e.preventDefault();await api('/api/app/v10/expenses',{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Despesa lançada.');pages.expenses()}});$$('[data-del-expense]').forEach(b=>b.onclick=async()=>{if(confirm('Excluir esta despesa?')){await api(`/api/app/v10/expenses/${b.dataset.delExpense}`,{method:'DELETE'});pages.expenses()}});
  };

  pages.baseCustomers=async function(){const d=await api('/api/app/v10/base/customers');$('#page-content').innerHTML=panel('Base de clientes',`<div class="notice">Clientes cadastrados pelo aplicativo da Base, com saldo de crédito antecipado e histórico de pedidos.</div>`+table([{label:'Cliente',render:x=>`<strong>${esc(x.name)}</strong><br><small>${esc(x.email||x.phone||'')}</small>`},{label:'Telefone',key:'phone'},{label:'Saldo',render:x=>`<strong>${money(x.balance_cents)}</strong>`},{label:'Pedidos',key:'total_orders'},{label:'Último pedido',render:x=>dateTime(x.last_order_at)},{label:'Cadastro',render:x=>dateOnly(x.created_at)}],d.items||[]));};

  const oldDashboard=pages.dashboard;
  pages.dashboard=async function(){
    if(state.user.role==='platform_admin'){
      const today=isoDate(),from=state.cache.masterFrom||today.slice(0,8)+'01',to=state.cache.masterTo||today,coop=state.selectedCoop||'',d=await api(`/api/app/platform/overview${query({from,to,cooperative_id:coop})}`),t=d.totals||{};
      $('#page-content').innerHTML=cards([{icon:'◉',value:t.cooperatives||0,label:'Cooperativas'},{icon:'♟',value:t.drivers||0,label:'Cooperados'},{icon:'●',value:t.active||0,label:'Ativos'},{icon:'＄',value:money(t.volume_cents),label:'Faturamento das entregas'},{icon:'◈',value:money(t.revenue_cents),label:'Receita das cooperativas'},{icon:'−',value:money(t.expenses_cents),label:'Despesas'},{icon:'=',value:money(t.profit_cents),label:'Resultado líquido'}])+panel('Visão por cooperativa',table([{label:'Cooperativa',key:'name'},{label:'Cooperados',key:'drivers_total'},{label:'Ativos',key:'drivers_active'},{label:'Estabelecimentos',key:'establishments_active'},{label:'Entregas',key:'deliveries_period'},{label:'Faturamento',render:x=>money(x.volume_cents)},{label:'Receita',render:x=>money(x.revenue_cents)},{label:'Despesas',render:x=>money(x.expenses_cents)},{label:'Resultado',render:x=>`<strong>${money(x.profit_cents)}</strong>`}],d.items||[]),`<div class="toolbar"><input id="master-from" type="date" value="${from}"><input id="master-to" type="date" value="${to}"><button class="btn primary" id="master-apply">Aplicar</button></div>`);$('#master-apply').onclick=()=>{state.cache.masterFrom=$('#master-from').value;state.cache.masterTo=$('#master-to').value;pages.dashboard()};return;
    }
    await oldDashboard();
    if(state.user.role==='driver'){
      try{const q=await api('/api/app/v10/queue/locations'),active=q.active;$('#page-content').insertAdjacentHTML('afterbegin',`<section class="driver-arrival-banner ${active?'active':''}"><div><strong>${active?'Na lista de espera':'Chegou ao local?'}</strong><small>${active?esc(active.location_name):'Toque em Cheguei para entrar na sequência.'}</small></div><button class="btn primary" id="driver-go-queue">${active?'Ver minha posição':'Cheguei'}</button></section>`);$('#driver-go-queue').onclick=()=>navigate('queue')}catch{}
    }
    if(state.user.role==='establishment'){
      const q=await api('/api/app/v10/queue').catch(()=>({items:[]}));$('#page-content').insertAdjacentHTML('beforeend',panel('Lista de espera do estabelecimento',`<div class="waiting-list">${(q.items||[]).slice(0,8).map((x,i)=>`<article class="waiting-row ${i===0?'next':''}"><span>${x.queue_position}</span><div><strong>${esc(x.driver_name)}</strong><small>${dateTime(x.arrived_at)}</small></div>${i===0?'<b>DA VEZ</b>':''}</article>`).join('')||'<div class="empty">Nenhum cooperado aguardando.</div>'}</div>`,'<button class="btn" data-open-queue>Ver lista completa</button>'));$('[data-open-queue]')?.addEventListener('click',()=>navigate('queue'));
    }
  };

  const oldNavigate=navigate;navigate=async function(page,push=true){if(['contracts','prices'].includes(page))page='establishments';return oldNavigate(page,push)};
  if(state.user)renderNav();
})();


/* ===== ligerim-v12.js ===== */
/* Ligerim 10.2 — correção de acesso do cooperado, logo oficial, sons e escala somente leitura no estabelecimento */
(function(){
  // Identidade oficial enviada pelo usuário.
  document.querySelectorAll('img[src^="/icons/logo-official.png"],img[src^="/icons/logo.png"]').forEach(img=>img.src='/icons/logo-official.png?v=10.3');
  document.querySelectorAll('img[src^="/icons/icon-official.png"],img[src^="/icons/icon.png"]').forEach(img=>img.src='/icons/icon-official.png?v=10.3');
  if(typeof pageMeta!=='undefined'&&pageMeta.team)pageMeta.team=['Escala','▦'];

  // O estabelecimento só consulta a escala. Não há botão de criar, editar,
  // excluir, clonar ou realizar troca direta.
  if(typeof navByRole!=='undefined'){
    navByRole.establishment=[['Meu estabelecimento',['dashboard','deliveries','team','queue','tracking','reports','account']]];
  }
  const navigateBeforeV12=navigate;
  navigate=async function(page,push=true){
    if(state.user?.role==='establishment'&&page==='schedules')page='team';
    return navigateBeforeV12(page,push);
  };

  const oldTeamPage=pages.team;
  pages.team=async function(){
    await oldTeamPage();
    if(state.user?.role==='establishment'){
      const content=$('#page-content');
      content?.insertAdjacentHTML('afterbegin','<div class="notice schedule-readonly"><strong>Escala somente para consulta.</strong><br>A cooperativa é a única responsável por cadastrar, editar ou retirar escalas. Os cooperados podem solicitar trocas entre si.</div>');
    }
  };

  // Na matriz de permissões, perfil Estabelecimento sempre fica com Escala em modo leitura.
  if(typeof v8ReadPermissions==='function'){
    const readPermissionsBeforeV12=v8ReadPermissions;
    v8ReadPermissions=function(){
      const items=readPermissionsBeforeV12();
      const role=document.querySelector('#v8-user-form [name="role"]')?.value;
      if(role==='establishment'){
        const schedule=items.find(x=>x.module_key==='schedules');
        if(schedule){schedule.can_view=true;schedule.can_create=false;schedule.can_edit=false;schedule.can_delete=false;}
        else items.push({module_key:'schedules',can_view:true,can_create:false,can_edit:false,can_delete:false});
      }
      return items;
    };
  }

  // Tela de acesso vinculada com usuário visível e mensagem clara do login salvo.
  linkedAccessForm=function(kind,item){
    const isDriver=kind==='driver',label=isDriver?'cooperado':'estabelecimento';
    openModal(`Acesso do ${label}`,`<form id="linked-access-form" class="form-grid">
      ${field('Nome do acesso','name',item.name,'text','required')}
      ${field('E-mail para entrar','email',item.access_email||item.email,'email','required autocomplete="username"')}
      ${field('Usuário opcional','username',item.access_username||'','text','autocomplete="username"')}
      ${field(item.access_user_id?'Nova senha (deixe vazia para manter)':'Senha inicial','password','','password',item.access_user_id?'minlength="8" autocomplete="new-password"':'required minlength="8" autocomplete="new-password"')}
      <div class="full notice"><strong>Login do aplicativo</strong><br>O ${label} poderá entrar pelo e-mail ou pelo usuário informado acima. Para cooperado, o acesso fica obrigatoriamente vinculado ao cadastro dele.</div>
      ${buttons('Salvar acesso')}
    </form>`);
    $('#linked-access-form').onsubmit=async e=>{
      e.preventDefault();
      try{
        loading(true);
        const result=await api(`/api/app/${isDriver?'drivers':'establishments'}/${item.id}/access`,{method:'POST',body:formObject(e.currentTarget)});
        closeModal();
        const login=result.login?.username||result.login?.email||'';
        toast(`Acesso salvo${login?` — login: ${login}`:''}.`);
        isDriver?pages.drivers():pages.establishments();
      }catch(err){toast(err.message,'error')}finally{loading(false)}
    };
  };

  driverForm=function(item={}){
    const hasAccess=Boolean(item.access_user_id);
    openModal(item.id?'Editar cooperado':'Novo cooperado',`<form id="driver-form" class="form-grid">
      ${field('Nome','name',item.name,'text','required')}
      ${field('CPF','cpf',item.cpf)}
      ${field('Telefone','phone',item.phone)}
      ${field('E-mail do cooperado','email',item.email,'email')}
      ${field('Placa','vehicle_plate',item.vehicle_plate)}
      ${field('Modelo da moto','vehicle_model',item.vehicle_model)}
      <div class="full notice"><strong>Acesso ao aplicativo do cooperado</strong><br>O e-mail e a senha abaixo criam ou reparam o vínculo do cooperado com o aplicativo.</div>
      ${field('E-mail para entrar','access_email',item.access_email||item.email,'email','required autocomplete="username"')}
      ${field('Usuário opcional','access_username',item.access_username||'','text','autocomplete="username"')}
      ${field(hasAccess?'Nova senha (opcional)':'Senha inicial','access_password','','password',hasAccess?'minlength="8" autocomplete="new-password"':'required minlength="8" autocomplete="new-password"')}
      ${buttons()}
    </form>`);
    $('#driver-form').onsubmit=async e=>{
      e.preventDefault();const b=scopeBody(formObject(e.currentTarget));
      try{
        loading(true);let driverId=item.id;
        if(item.id)await api(`/api/app/drivers/${item.id}`,{method:'PUT',body:b});
        else{const d=await api('/api/app/drivers',{method:'POST',body:b});driverId=d.item.id;}
        await api(`/api/app/drivers/${driverId}/access`,{method:'POST',body:{name:b.name,email:b.access_email,username:b.access_username,password:b.access_password}});
        closeModal();toast('Cooperado e acesso ao aplicativo salvos.');state.cache.baseKey='';pages.drivers();
      }catch(err){toast(err.message,'error')}finally{loading(false)}
    };
  };

  pages.drivers=async function(){
    const d=await api(`/api/app/drivers${query(scopeParams())}`);
    $('#page-content').innerHTML=panel('Cooperados da cooperativa',table([
      {label:'Nome',key:'name'},{label:'CPF',key:'cpf'},{label:'Telefone',key:'phone'},
      {label:'Moto/placa',render:r=>esc([r.vehicle_model,r.vehicle_plate].filter(Boolean).join(' • ')||'—')},
      {label:'Acesso ao app',render:r=>r.access_email?`<strong>${esc(r.access_username||r.access_email)}</strong><br><small>${esc(r.access_email)}</small><br>${badge(r.access_status||'active')}`:'<span class="muted">Sem acesso</span>'},
      {label:'Online',render:r=>badge(r.online?'active':'inactive')},{label:'Status',render:r=>badge(r.status)}
    ],d.items,r=>canEdit()?`<button class="table-action primary" data-access-driver="${r.id}">Acesso</button><button class="table-action" data-edit-driver="${r.id}">Editar</button><button class="table-action" data-del-driver="${r.id}">Excluir</button>`:''),canEdit()?'<button class="btn primary" id="new-driver">Novo cooperado</button>':'');
    if(canEdit()){
      $('#new-driver').onclick=()=>driverForm();
      $$('[data-edit-driver]').forEach(b=>b.onclick=()=>driverForm(d.items.find(x=>x.id===b.dataset.editDriver)));
      $$('[data-access-driver]').forEach(b=>b.onclick=()=>linkedAccessForm('driver',d.items.find(x=>x.id===b.dataset.accessDriver)));
      $$('[data-del-driver]').forEach(b=>b.onclick=()=>removeEntity(`/api/app/drivers/${b.dataset.delDriver}`,'Excluir este cooperado?',pages.drivers));
    }
  };

  // Sons próprios do Ligerim: alerta forte para integração/mensagem e toque curto
  // para o cooperado quando recebe uma entrega.
  sound.play=async function(name){
    await this.unlock();
    const patterns={
      online:[[680,0,.09,.12,'sine'],[920,.10,.13,.13,'sine']],
      offline:[[610,0,.10,.11,'sine'],[360,.12,.18,.12,'sine']],
      integration_alert:[[1046,0,.11,.20,'triangle'],[1318,.13,.11,.21,'triangle'],[1568,.26,.20,.22,'triangle'],[1046,.56,.11,.20,'triangle'],[1318,.69,.11,.21,'triangle'],[1760,.82,.26,.23,'triangle']],
      driver_ping:[[1320,0,.055,.16,'sine'],[1760,.06,.065,.18,'sine'],[2320,.13,.10,.19,'triangle']],
      new_order:[[880,0,.10,.15,'triangle'],[1175,.12,.10,.16,'triangle'],[1480,.24,.18,.17,'triangle']],
      assigned:[[780,0,.08,.13,'sine'],[1080,.10,.13,.15,'sine']],
      accepted:[[920,0,.13,.13,'sine']],
      status:[[720,0,.08,.10,'sine'],[900,.10,.10,.11,'sine']],
      completed:[[660,0,.10,.12,'sine'],[900,.12,.10,.13,'sine'],[1200,.24,.22,.14,'sine']],
      problem:[[260,0,.24,.17,'square'],[210,.28,.30,.17,'square']],
      message:[[1175,0,.07,.18,'triangle'],[1568,.09,.10,.20,'triangle']],
      created:[[760,0,.08,.12,'sine'],[980,.10,.12,.13,'sine']]
    };
    (patterns[name]||patterns.status).forEach(([f,s,d,g,t])=>this.tone(f,s,d,g,t));
  };

  eventSound=function(type){
    if(type==='integration_order_created')return'integration_alert';
    if(type==='delivery_message'||type==='approach_alert')return'message';
    if(type==='delivery_assigned')return state.user?.role==='driver'?'driver_ping':'assigned';
    if(type==='counter_order_created'||type==='base_order_created')return'new_order';
    if(type==='delivery_accepted')return'accepted';
    if(type==='delivery_completed')return'completed';
    if(type==='delivery_problem'||type==='delivery_cancelled'||type==='delivery_unassigned')return'problem';
    if(type==='driver_online')return'online';
    if(type==='driver_offline')return'offline';
    return'status';
  };

  pollNotifications=async function(){
    if(!state.user)return;
    try{
      const data=await api(`/api/app/v6/notifications?after=${v6.notificationCursor}`);
      v6.notificationCursor=Math.max(v6.notificationCursor,Number(data.cursor||0));
      for(const item of data.items||[]){
        const soundName=eventSound(item.event_type);
        await sound.play(soundName);
        toast(`${item.title}${item.message?` — ${item.message}`:''}`,['delivery_problem','delivery_cancelled'].includes(item.event_type)?'error':'success');
        if(item.event_type==='integration_order_created'&&['cooperative_admin','dispatcher','establishment'].includes(state.user.role)){
          setTimeout(()=>sound.play('integration_alert'),1200);
        }
        if(state.user.role==='driver'&&['delivery_assigned','delivery_completed','delivery_status_changed','delivery_message'].includes(item.event_type)&&['dashboard','deliveries','routes'].includes(state.page))setTimeout(()=>navigate(state.page,false),250);
        if(['cooperative_admin','dispatcher','establishment'].includes(state.user.role)&&['integration_order_created','counter_order_created','base_order_created','delivery_completed'].includes(item.event_type)&&state.page==='deliveries')setTimeout(()=>pages.deliveries(),250);
      }
    }catch{}
  };

  initializeNotifications=async function(){
    stopNotifications();if(!state.user||state.user.role==='platform_admin')return;
    try{const initial=await api('/api/app/v6/notifications?initial=1');v6.notificationCursor=Number(initial.cursor||0)}catch{return}
    const run=async()=>{if(!state.user)return;const delay=4500+Math.floor(Math.random()*1800);try{if(!document.hidden)await pollNotifications()}finally{if(state.user)v6.notificationTimer=setTimeout(run,delay)}};
    v6.notificationTimer=setTimeout(run,800+Math.floor(Math.random()*1200));
  };

  // Normaliza o identificador antes do login, evitando espaços copiados.
  const loginForm=$('#login-form');
  if(loginForm){
    const previous=loginForm.onsubmit;
    loginForm.onsubmit=async function(e){
      const input=loginForm.elements.login;if(input)input.value=String(input.value||'').trim();
      return previous.call(this,e);
    };
  }

  if(state.user){renderNav();if(typeof applyRoleLayout==='function')applyRoleLayout();}
})();


/* ===== ligerim-v13.js ===== */
/* Ligerim 10.3 — Base geolocalizada, fila automática e despesas por cooperado */
(function(){
  const reportRange=()=>({from:state.cache.reportFrom||mondayOf(isoDate()),to:state.cache.reportTo||isoDate(),group:state.cache.reportGroup||'day'});
  const reportTools=(extra='')=>{const r=reportRange();return `<div class="toolbar report-toolbar"><input id="report-from" type="date" value="${r.from}"><input id="report-to" type="date" value="${r.to}">${extra}<button class="btn primary" id="report-apply">Aplicar</button><button class="btn" id="report-week">Semana atual</button><button class="btn" id="report-month">Mês atual</button></div>`};
  const bindReportTools=(reload)=>{$('#report-apply')?.addEventListener('click',()=>{state.cache.reportFrom=$('#report-from').value;state.cache.reportTo=$('#report-to').value;reload()});$('#report-week')?.addEventListener('click',()=>{state.cache.reportFrom=mondayOf(isoDate());state.cache.reportTo=addDays(state.cache.reportFrom,6);reload()});$('#report-month')?.addEventListener('click',()=>{const d=isoDate();state.cache.reportFrom=d.slice(0,8)+'01';state.cache.reportTo=d;reload()})};
  const originalBaseForm=baseForm;
  const originalDeliveriesPage=pages.deliveries;
  const originalFinancialPage=pages.financial;
  baseForm=function(item={}){
    originalBaseForm(item);
    const form=$('#base-form-v7');
    if(!form)return;
    const actions=form.querySelector('.form-actions');
    const label=document.createElement('label');
    label.innerHTML=`Raio permitido para check-in e fila (metros)<input name="checkin_radius_meters" type="number" min="30" max="2000" step="10" value="${Number(item.checkin_radius_meters||250)}" required><small>O cooperado precisa estar dentro desta distância da Base.</small>`;
    form.insertBefore(label,actions);
  };

  const locateForArrival=()=>new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error('Localização não disponível neste aparelho.'));
    navigator.geolocation.getCurrentPosition(resolve,()=>reject(new Error('Ative a localização do aparelho para confirmar sua chegada ao local.')),{enableHighAccuracy:true,timeout:15000,maximumAge:5000});
  });

  const originalQueuePage=pages.queue;
  pages.queue=async function(){
    if(state.user.role!=='driver')return originalQueuePage();
    const d=await api('/api/app/v10/queue/locations'),active=d.active;
    $('#page-content').innerHTML=panel('Lista de espera',`<div class="queue-driver-card"><div class="queue-driver-status ${active?'waiting':''}"><span>${active?'✓':'○'}</span><div><strong>${active?'Você está na fila':'Chegou à Base ou ao estabelecimento?'}</strong><small>${active?esc(active.location_name):'Na Base, leia o QR Code. No estabelecimento, fique online. Depois toque em Cheguei.'}</small></div></div><div class="queue-location-list">${(d.items||[]).map(x=>`<button class="queue-location" data-arrive-type="${x.location_type}" data-arrive-id="${x.location_id}"><strong>${esc(x.location_name)}</strong><small>${timeOnly(x.start_at)} às ${timeOnly(x.end_at)}</small><span>Cheguei</span></button>`).join('')||'<div class="empty">Nenhuma escala para hoje.</div>'}</div>${active?'<button class="btn danger full" id="queue-leave">Sair da lista de espera</button>':''}</div>`);
    $$('[data-arrive-id]').forEach(button=>button.onclick=async()=>{
      try{
        loading(true);
        const position=await locateForArrival();
        const result=await api('/api/app/v10/queue/arrive',{method:'POST',body:{location_type:button.dataset.arriveType,location_id:button.dataset.arriveId,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy}});
        await sound.play('status');
        toast(result.already_waiting?'Você já está nesta fila.':'Chegada confirmada. Você entrou na fila de pedidos.');
        pages.queue();
      }catch(error){toast(error.message,'error')}finally{loading(false)}
    });
    $('#queue-leave')?.addEventListener('click',async()=>{await api('/api/app/v10/queue/leave',{method:'POST'});await sound.play('offline');pages.queue()});
  };

  submitAttendanceToken=async function(token){
    if(qrScanBusy||!String(token||'').trim())return;
    qrScanBusy=true;
    try{
      const p=await locateForArrival();
      const d=await api('/api/app/driver/presence/scan',{method:'POST',body:{token:String(token).trim(),latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}});
      stopQrScanner();closeModal();
      if(d.action==='checkin'&&d.online){state.online=true;if($('#online-label'))$('#online-label').textContent='Online';if($('#online-toggle'))$('#online-toggle').textContent='Ficar offline';await sound.play('online');}
      toast(d.action==='checkout'?`Check-out realizado em ${d.location_name}.`:`Check-in realizado em ${d.location_name}. Você já está online.`);
      pages.attendance();
    }catch(e){qrScanBusy=false;toast(e.message,'error')}
  };

  pages.expenses=async function(){
    const r=reportRange(),base=await lgBase(),[coop,financial]=await Promise.all([
      api(`/api/app/v10/expenses${query({from:r.from,to:r.to})}`),
      api(`/api/app/financial${query({from:r.from,to:r.to})}`)
    ]);
    const cooperativeItems=coop.items||[];
    const driverItems=(financial.items||[]).filter(x=>x.entry_type==='debit'&&!['INSS','SEST/SENAT','advance','configured_deduction'].includes(String(x.category)));
    const coopTotal=cooperativeItems.reduce((a,x)=>a+Number(x.amount_cents||0),0),driverTotal=driverItems.reduce((a,x)=>a+Number(x.amount_cents||0),0);
    $('#page-content').innerHTML=cards([{icon:'−',value:money(coopTotal),label:'Despesas da cooperativa'},{icon:'♟',value:money(driverTotal),label:'Despesas dos cooperados'}])+
      panel('Despesas lançadas para cooperados',table([{label:'Data',render:x=>dateOnly(x.reference_date)},{label:'Cooperado',key:'driver_name'},{label:'Categoria',key:'category'},{label:'Descrição',key:'description',wrap:true},{label:'Valor',render:x=>money(x.amount_cents)},{label:'Status',render:x=>badge(x.status)}],driverItems,x=>state.user.role==='cooperative_admin'?`<button class="table-action" data-del-driver-expense="${x.id}">Cancelar</button>`:''),state.user.role==='cooperative_admin'?'<button class="btn primary" id="new-driver-expense">Nova despesa do cooperado</button>':'')+
      panel('Despesas administrativas da cooperativa',table([{label:'Data',render:x=>dateOnly(x.reference_date)},{label:'Categoria',key:'category'},{label:'Descrição',key:'description',wrap:true},{label:'Local',render:x=>esc(x.base_name||x.establishment_name||'Geral')},{label:'Valor',render:x=>money(x.amount_cents)},{label:'Lançado por',key:'created_by_name'}],cooperativeItems,x=>state.user.role==='cooperative_admin'?`<button class="table-action" data-del-expense="${x.id}">Excluir</button>`:''),reportTools()+(state.user.role==='cooperative_admin'?'<button class="btn" id="new-expense">Nova despesa administrativa</button>':''));
    bindReportTools(pages.expenses);
    $('#new-driver-expense')?.addEventListener('click',()=>{openModal('Nova despesa do cooperado',`<form id="driver-expense-form" class="form-grid">${selectField('Cooperado','driver_id',base.drivers||[],'','Selecione','required')}${field('Data','reference_date',isoDate(),'date','required')}${field('Categoria','category','outra_despesa','text','required')}${field('Valor','amount','','number','required step="0.01" min="0.01"')}${textarea('Descrição','description','','required')}<div class="full notice">No fechamento semanal, a ordem será: INSS, SEST/SENAT, adiantamentos e depois estas despesas pela ordem em que foram lançadas.</div>${buttons()}</form>`);$('#driver-expense-form').onsubmit=async e=>{e.preventDefault();const body=formObject(e.currentTarget);body.entry_type='debit';await api('/api/app/financial',{method:'POST',body});closeModal();toast('Despesa lançada para o cooperado.');pages.expenses()}});
    $('#new-expense')?.addEventListener('click',()=>{openModal('Nova despesa administrativa',`<form id="expense-form" class="form-grid">${field('Data','reference_date',isoDate(),'date','required')}${field('Categoria','category','','text','required')}${field('Valor','amount','','number','required step="0.01" min="0.01"')}${textarea('Descrição','description','','required')}${buttons()}</form>`);$('#expense-form').onsubmit=async e=>{e.preventDefault();await api('/api/app/v10/expenses',{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Despesa administrativa lançada.');pages.expenses()}});
    $$('[data-del-driver-expense]').forEach(b=>b.onclick=async()=>{if(confirm('Cancelar esta despesa do cooperado?')){await api(`/api/app/financial/${b.dataset.delDriverExpense}`,{method:'DELETE'});pages.expenses()}});
    $$('[data-del-expense]').forEach(b=>b.onclick=async()=>{if(confirm('Excluir esta despesa administrativa?')){await api(`/api/app/v10/expenses/${b.dataset.delExpense}`,{method:'DELETE'});pages.expenses()}});
  };


  // A cooperativa administra uma Base própria. Esta aba nunca mistura
  // entregas criadas pelos estabelecimentos clientes.
  if(typeof pageMeta!=='undefined'){
    pageMeta.bases=['Base','⌂'];
    pageMeta.financial=['Ganhos e descontos','◌'];
    pageMeta.baseCustomers=['Clientes e créditos','◎'];
  }
  if(typeof navByRole!=='undefined'){
    for(const role of ['cooperative_admin','dispatcher']){
      navByRole[role]=(navByRole[role]||[]).map(([title,items])=>[title,items.filter(item=>!['deliveries','reports'].includes(item))]).filter(([,items])=>items.length);
    }
  }

  pages.bases=async function(){
    const [baseList,baseData]=await Promise.all([api('/api/app/tenant/bases'),lgBase(true)]),bases=baseList.items||[];
    baseData.bases=bases;
    if(!bases.some(x=>x.id===state.cache.baseViewId))state.cache.baseViewId=bases[0]?.id||'';
    const selected=bases.find(x=>x.id===state.cache.baseViewId)||null;
    const deliveries=selected?await api(`/api/app/tenant/deliveries${query({base_id:selected.id})}`):{items:[]};
    const items=deliveries.items||[],active=items.filter(x=>!['delivered','cancelled'].includes(x.status)).length;
    const basePanel=panel('Cadastro da Base',`<div class="notice">A Base pertence à cooperativa. Nela, o endereço de coleta e o endereço de entrega são informados em cada pedido.</div>`+table([
      {label:'Base',key:'name'},{label:'Endereço',key:'address',wrap:true},{label:'Taxa mínima',render:x=>money(x.minimum_fee_cents)},{label:'Valor/km',render:x=>money(x.rate_per_km_cents)},{label:'Status',render:x=>badge(x.active?'active':'inactive')}
    ],bases,x=>state.user.role==='cooperative_admin'?`<button class="table-action" data-base-open="${x.id}">Abrir</button><button class="table-action" data-qr-base="${x.id}">QR</button><button class="table-action" data-edit-base="${x.id}">Editar</button>`:`<button class="table-action" data-base-open="${x.id}">Abrir</button>`),state.user.role==='cooperative_admin'?'<button class="btn primary" id="new-base">Cadastrar Base</button>':'');
    const selectedTools=selected?`<div class="toolbar"><select id="base-view-select">${bases.map(x=>`<option value="${x.id}" ${x.id===selected.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><select id="base-delivery-status"><option value="">Todos os status</option>${['new','offered','assigned','accepted','to_pickup','at_pickup','picked_up','in_route','delivered','cancelled','problem'].map(status=>`<option value="${status}">${statusText[status]}</option>`).join('')}</select>${['cooperative_admin','dispatcher'].includes(state.user.role)?'<button class="btn primary" id="new-base-delivery">Nova entrega da Base</button>':''}</div>`:'';
    const deliveryPanel=panel(selected?`Entregas da Base — ${esc(selected.name)}`:'Entregas da Base',selected?cards([{icon:'➜',value:items.length,label:'Total'},{icon:'◷',value:active,label:'Em andamento'},{icon:'✓',value:items.filter(x=>x.status==='delivered').length,label:'Concluídas'}])+table([
      {label:'Pedido',render:x=>`<strong>${esc(x.display_code||'—')}</strong><br><small>${dateTime(x.created_at)}</small>`},{label:'Cliente',render:x=>`<strong>${esc(x.customer_name||x.recipient_name||'Cliente')}</strong><br><small>${esc(x.customer_phone||x.recipient_phone||'')}</small>`},{label:'Coleta',key:'pickup_address',wrap:true},{label:'Entrega',key:'delivery_address',wrap:true},{label:'Cooperado',key:'driver_name'},{label:'Valor',render:x=>money(x.charge_cents)},{label:'Status',render:x=>badge(x.status)}
    ],items,x=>`<button class="table-action" data-base-detail="${x.id}">Ver</button>${!['delivered','cancelled'].includes(x.status)?`<button class="table-action" data-base-assign="${x.id}">Atribuir</button>`:''}${x.tracking_token&&Number(x.tracking_enabled??1)===1?`<button class="table-action" data-base-track="${x.tracking_token}">Rastreio</button>`:''}<button class="table-action" data-base-clone="${x.id}">Clonar</button>${x.status!=='delivered'?`<button class="table-action danger" data-base-remove="${x.id}">Remover</button>`:''}`):empty('Nenhuma Base cadastrada','Cadastre a Base da cooperativa para criar as entregas.'),selectedTools);
    $('#page-content').innerHTML=basePanel+deliveryPanel;
    $('#new-base')?.addEventListener('click',()=>baseForm());
    $$('[data-edit-base]').forEach(b=>b.onclick=()=>baseForm(bases.find(x=>x.id===b.dataset.editBase)));
    $$('[data-qr-base]').forEach(b=>b.onclick=()=>showLocationQr(bases.find(x=>x.id===b.dataset.qrBase),'base'));
    $$('[data-base-open]').forEach(b=>b.onclick=()=>{state.cache.baseViewId=b.dataset.baseOpen;pages.bases()});
    $('#base-view-select')?.addEventListener('change',e=>{state.cache.baseViewId=e.target.value;pages.bases()});
    $('#base-delivery-status')?.addEventListener('change',e=>{const status=e.target.value;$$('[data-base-detail]').forEach(button=>{const item=items.find(x=>x.id===button.dataset.baseDetail),row=button.closest('tr');if(row)row.classList.toggle('hidden',Boolean(status&&item?.status!==status))})});
    $('#new-base-delivery')?.addEventListener('click',()=>{baseOrderForm(baseData);const form=$('#base-order-form');if(form&&selected){form.base_id.value=selected.id;form.base_id.dispatchEvent(new Event('change'))}});
    $$('[data-base-detail]').forEach(b=>b.onclick=()=>deliveryDetail(items.find(x=>x.id===b.dataset.baseDetail)));
    $$('[data-base-assign]').forEach(b=>b.onclick=()=>assignV6(items.find(x=>x.id===b.dataset.baseAssign)));
    $$('[data-base-track]').forEach(b=>b.onclick=()=>copyText(`${location.origin}/r/${b.dataset.baseTrack}`));
    $$('[data-base-clone]').forEach(b=>b.onclick=async()=>{if(!confirm('Clonar esta entrega da Base?'))return;try{loading(true);const r=await api(`/api/app/v7/base/deliveries/${b.dataset.baseClone}/clone`,{method:'POST',body:{}});toast(`Nova entrega ${r.item.display_code} criada.`);await pages.bases();loading(false);if(r.item?.id&&window.ChegaJaV32?.assignFromBase)await window.ChegaJaV32.assignFromBase(r.item.id)}catch(e){toast(e.message,'error')}finally{loading(false)}});
    $$('[data-base-remove]').forEach(b=>b.onclick=async()=>{if(!confirm('Remover e cancelar esta entrega da Base?'))return;await api(`/api/app/v7/deliveries/${b.dataset.baseRemove}`,{method:'DELETE'});toast('Entrega removida.');pages.bases()});
  };

  pages.deliveries=async function(){
    if(['cooperative_admin','dispatcher'].includes(state.user.role))return pages.bases();
    return originalDeliveriesPage();
  };

  // Todas as produções dos cooperados, inclusive as realizadas nos
  // estabelecimentos, ficam concentradas em Ganhos e descontos.
  pages.financial=async function(){
    if(!['cooperative_admin','dispatcher'].includes(state.user.role))return originalFinancialPage();
    const base=await lgBase(),r=reportRange(),driverId=state.cache.financeDriver||'';
    const [entries,summary]=await Promise.all([api(`/api/app/financial${query({from:r.from,to:r.to,driver_id:driverId})}`),api(`/api/app/financial/summary${query({from:r.from,to:r.to,driver_id:driverId})}`)]),s=summary.data||{};
    const driverFilter=`<select id="finance-driver"><option value="">Todos os cooperados</option>${(base.drivers||[]).map(x=>`<option value="${x.id}" ${driverId===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`;
    $('#page-content').innerHTML=cards([{icon:'＋',value:money(s.credits_cents),label:'Produção e créditos'},{icon:'−',value:money(s.debits_cents),label:'Descontos'},{icon:'=',value:money(s.balance_cents),label:'Saldo dos cooperados'}])+panel('Ganhos e descontos dos cooperados',table([
      {label:'Data',render:x=>dateOnly(x.reference_date)},{label:'Cooperado',key:'driver_name'},{label:'Estabelecimento / Base',render:x=>esc(x.establishment_name||'Geral')},{label:'Tipo',render:x=>x.entry_type==='credit'?'<span class="positive">Ganho</span>':'<span class="negative">Desconto</span>'},{label:'Categoria',key:'category'},{label:'Descrição',key:'description',wrap:true},{label:'Valor',render:x=>money(x.amount_cents)},{label:'Status',render:x=>badge(x.status)}
    ],entries.items||[],x=>state.user.role==='cooperative_admin'&&x.category!=='delivery'?`<button class="table-action" data-cancel-finance="${x.id}">Cancelar</button>`:''),reportTools(driverFilter)+(state.user.role==='cooperative_admin'?'<button class="btn primary" id="new-financial">Novo ganho ou desconto</button>':''));
    bindReportTools(pages.financial);
    $('#finance-driver')?.addEventListener('change',e=>{state.cache.financeDriver=e.target.value;pages.financial()});
    $('#new-financial')?.addEventListener('click',()=>financialForm(base));
    $$('[data-cancel-finance]').forEach(b=>b.onclick=async()=>{if(!confirm('Cancelar este lançamento?'))return;await api(`/api/app/financial/${b.dataset.cancelFinance}`,{method:'DELETE'});pages.financial()});
  };

  pages.baseCustomers=async function(){
    const data=await api('/api/app/v10/base/customers'),items=data.items||[],canManage=state.user.role==='cooperative_admin';
    $('#page-content').innerHTML=cards([{icon:'◎',value:items.length,label:'Clientes cadastrados'},{icon:'◈',value:money(items.reduce((sum,x)=>sum+Number(x.balance_cents||0),0)),label:'Créditos disponíveis'}])+panel('Clientes e créditos da cooperativa',`<div class="notice">A cooperativa pode cadastrar clientes manualmente e acrescentar crédito. Cada estabelecimento continua vendo somente os próprios dados e pedidos.</div>`+table([
      {label:'Cliente',render:x=>`<strong>${esc(x.name)}</strong><br><small>${esc(x.email||'')}</small>`},{label:'Telefone',key:'phone'},{label:'Saldo nesta cooperativa',render:x=>`<strong>${money(x.balance_cents)}</strong>`},{label:'Pedidos da Base',key:'total_orders'},{label:'Último pedido',render:x=>dateTime(x.last_order_at)},{label:'Cadastro',render:x=>dateOnly(x.created_at)}
    ],items,x=>canManage?`<button class="table-action" data-add-credit="${x.id}">Acrescentar crédito</button>`:''),canManage?'<button class="btn primary" id="new-customer">Cadastrar cliente</button>':'');
    $('#new-customer')?.addEventListener('click',()=>{openModal('Cadastrar cliente',`<form id="manual-customer-form" class="form-grid">${field('Nome do cliente','name','','text','required')}${field('Telefone','phone','','tel')}${field('E-mail','email','','email')}<div class="full notice">Informe telefone ou e-mail. O cliente ficará vinculado somente a esta cooperativa.</div>${buttons('Cadastrar cliente')}</form>`);$('#manual-customer-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api('/api/app/v10/base/customers',{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Cliente cadastrado.');pages.baseCustomers()}catch(error){toast(error.message,'error')}finally{loading(false)}}});
    $$('[data-add-credit]').forEach(button=>button.onclick=()=>{const customer=items.find(x=>x.id===button.dataset.addCredit);openModal('Acrescentar crédito',`<form id="manual-credit-form" class="form-grid"><div class="full notice"><strong>${esc(customer.name)}</strong><br>Saldo atual: ${money(customer.balance_cents)}</div>${field('Valor do crédito','amount','','number','required step="0.01" min="0.01"')}${textarea('Descrição','description','Crédito acrescentado manualmente pela cooperativa','required')}${buttons('Confirmar crédito')}</form>`);$('#manual-credit-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/v10/base/customers/${customer.id}/credit`,{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Crédito acrescentado ao cliente.');pages.baseCustomers()}catch(error){toast(error.message,'error')}finally{loading(false)}}});
  };

  if(state.user)renderNav();
})();


/* ===== ligerim-v14.js ===== */
/* Ligerim 10.4 — entrega completa, chat direcionado, alerta visual e fila corrigida */
(function(){
  const v14={messageTimer:null,lastUnread:0,lastLatest:'',chatTimer:null,audio:null};
  const paymentLabel=v=>({pix:'PIX',dinheiro:'Dinheiro',cartao_credito:'Cartão de crédito',cartao_debito:'Cartão de débito',vale_alimentacao:'Vale-alimentação',vale_refeicao:'Vale-refeição',cortesia:'Cortesia',pix_cooperativa:'PIX Cooperativa',credit:'Crédito antecipado',credito:'Crédito antecipado'}[v]||v||'Não informado');
  const phoneHref=v=>String(v||'').replace(/\D/g,'');
  const extraAddress=(apt,comp)=>[apt?`Apto/Unidade: ${apt}`:'',comp?`Complemento: ${comp}`:''].filter(Boolean).join(' • ');

  function loudAlert(kind='message'){
    try{
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC)return;
      v14.audio=v14.audio||new AC();
      if(v14.audio.state==='suspended')v14.audio.resume();
      const patterns=kind==='message'?[[0,880],[.16,1040],[.34,880]]:kind==='new_order'?[[0,620],[.18,820],[.36,1020],[.58,820]]:[[0,760],[.18,980]];
      patterns.forEach(([delay,freq])=>{
        const o=v14.audio.createOscillator(),g=v14.audio.createGain(),start=v14.audio.currentTime+delay;
        o.type='sine';o.frequency.setValueAtTime(freq,start);g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(.32,start+.025);g.gain.exponentialRampToValueAtTime(.0001,start+.18);o.connect(g);g.connect(v14.audio.destination);o.start(start);o.stop(start+.2);
      });
      if(navigator.vibrate)navigator.vibrate(kind==='message'?[180,90,180]:[220,100,220,100,300]);
    }catch{}
  }
  document.addEventListener('pointerdown',()=>{try{const AC=window.AudioContext||window.webkitAudioContext;v14.audio=v14.audio||new AC();v14.audio.resume()}catch{}},{once:true});
  if(typeof sound!=='undefined'&&sound){const old=sound.play.bind(sound);sound.play=async type=>{try{await old(type)}catch{};if(['message','new_order','assigned','problem','completed'].includes(type))loudAlert(type==='new_order'?'new_order':type==='message'?'message':'status')}}

  updateOnlineControl=function(){
    const box=$('#online-control');if(!box)return;
    box.classList.toggle('is-online',state.online);
    $('#online-label').textContent=state.online?'VOCÊ ESTÁ ONLINE':'VOCÊ ESTÁ OFFLINE';
    $('#online-toggle').textContent=state.online?'FICAR OFFLINE':'FICAR ONLINE';
    $('#online-toggle').setAttribute('aria-label',state.online?'Ficar offline':'Ficar online e receber entregas');
  };

  counterOrderForm=async function(base){
    let establishment=(base.establishments||[]).find(x=>x.id===state.user.establishment_id)||{};
    try{const d=await api('/api/app/v7/establishment/profile');establishment=d.item||establishment}catch{}
    openModal('Nova entrega do estabelecimento',`<form id="counter-order-v14" class="form-grid counter-v14">
      <div class="full required-note"><strong>Valor e pagamento são obrigatórios.</strong><br>Esses dados aparecerão para o cooperado antes de aceitar.</div>
      ${field('Nome do cliente','customer_name','','text','required autocomplete="name"')}${field('Telefone do cliente','customer_phone','','tel','autocomplete="tel"')}
      ${field('Quem receberá','recipient_name','','text','required')}${field('Telefone de quem recebe','recipient_phone','','tel')}
      <label class="full">Endereço da entrega<input id="counter-address-v14" name="delivery_address" autocomplete="off" required placeholder="Digite rua, bairro, cidade ou estabelecimento no RN"></label>
      <input type="hidden" name="delivery_confirmation_token"><div id="counter-results-v14" class="full address-live-results"><span class="muted">Digite o endereço e selecione o resultado confirmado.</span></div>
      <div class="full address-inline-details">${field('Apartamento/Unidade','delivery_apartment','','text','placeholder="Ex.: Apto 202"')}${field('Complemento','delivery_complement','','text','placeholder="Bloco, torre, casa, referência"')}</div>
      ${field('Descrição do item (opcional)','item_description','','text','placeholder="Opcional"')}${field('Valor da entrega (R$)','charge_value','','number','required min="0.01" step="0.01"')}
      ${field('Valor do produto/refeição a receber (R$)','amount_to_collect','','number','min="0" step="0.01" placeholder="0,00"')}
      ${selectField('Como cobrar o produto/refeição','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'cartao_credito',name:'Cartão de crédito'},{id:'cartao_debito',name:'Cartão de débito'},{id:'vale_alimentacao',name:'Vale-alimentação'},{id:'vale_refeicao',name:'Vale-refeição'},{id:'cortesia',name:'Cortesia'}],'','Selecione','required')}
      ${selectField('Situação do pagamento','payment_status',[{id:'pending',name:'Pendente'},{id:'paid',name:'Pago'}],'pending','Selecione','required')}
      <label class="full hidden" data-cash-location>Dinheiro será pago em<select name="cash_payment_location"><option value="pickup">Na coleta</option><option value="delivery">Na entrega</option></select></label>
      ${textarea('Observações da entrega','notes','','placeholder="Portaria, referência, cuidado com o item ou outra instrução"')}${buttons('Criar entrega')}
    </form>`);
    const form=$('#counter-order-v14'),input=$('#counter-address-v14'),results=$('#counter-results-v14');let timer,addressItems=[],addressActive=-1;
    bindCashLocation(form);
    const clear=()=>{form.elements.delivery_confirmation_token.value='';results.dataset.confirmed='0'};
    const chooseAddress=index=>{const x=addressItems[index];if(!x?.confirmable)return;input.value=x.place_name&&x.formatted_address&&!x.formatted_address.toLocaleLowerCase('pt-BR').startsWith(String(x.place_name).toLocaleLowerCase('pt-BR'))?`${x.place_name} — ${x.formatted_address}`:x.formatted_address;form.elements.delivery_confirmation_token.value=x.confirmation_token;results.dataset.confirmed='1';results.innerHTML=selectedAddressSummary(x);addressActive=-1};
    const paintAddress=()=>$$('[data-address-v14]',results).forEach((button,index)=>{button.classList.toggle('active',index===addressActive);button.setAttribute('aria-selected',index===addressActive?'true':'false')});
    const renderAddress=items=>{addressItems=items||[];addressActive=-1;results.innerHTML=addressItems.map((x,i)=>`<button type="button" role="option" aria-selected="false" class="address-live-option" data-address-v14="${i}" ${x.confirmable?'':'disabled'}><strong>${esc(x.place_name||x.street||x.city||'Local')}</strong><span>${esc(x.formatted_address)}</span><small>${x.confirmable?'Selecionar endereço':'Resultado fora do RN ou sem coordenadas'}</small></button>`).join('')||'<span class="address-warning">Endereço não encontrado. Digite rua, bairro, cidade ou nome do estabelecimento.</span>';$$('[data-address-v14]',results).forEach(b=>b.onclick=()=>chooseAddress(Number(b.dataset.addressV14)))};
    input.oninput=()=>{clear();clearTimeout(timer);const q=input.value.trim();if(q.length<3){results.innerHTML='<span class="muted">Digite pelo menos 3 caracteres: rua, bairro, cidade ou estabelecimento.</span>';return}timer=setTimeout(async()=>{try{results.innerHTML='<span class="muted">Buscando em todo o Rio Grande do Norte…</span>';const d=await api('/api/public/address/autocomplete',{method:'POST',body:{query:q,establishment_id:establishment.id}});renderAddress(d.items||[])}catch(e){results.innerHTML=`<span class="address-warning">${esc(e.message)}</span>`}},300)};
    input.onkeydown=event=>{const enabled=addressItems.map((x,index)=>x.confirmable?index:-1).filter(index=>index>=0);if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(!enabled.length)return;const pos=enabled.indexOf(addressActive);addressActive=event.key==='ArrowDown'?enabled[(pos+1+enabled.length)%enabled.length]:enabled[(pos-1+enabled.length)%enabled.length];paintAddress()}else if(event.key==='Enter'&&enabled.length){event.preventDefault();chooseAddress(addressActive>=0?addressActive:enabled[0])}else if(event.key==='Escape'){results.innerHTML='';addressActive=-1}};
    form.onsubmit=async e=>{e.preventDefault();if(!form.elements.delivery_confirmation_token.value)return toast('Selecione um endereço confirmado.','error');try{loading(true);const r=await api('/api/app/v7/establishment/orders',{method:'POST',body:formObject(form)});closeModal();await sound.play('new_order');toast(`Entrega ${r.item.display_code} criada com valor e pagamento.`);state.page==='dashboard'?pages.dashboard():pages.deliveries()}catch(err){toast(err.message,'error')}finally{loading(false)}};
  };

  driverStatusButton=function(delivery){
    if(['offered','assigned','new'].includes(delivery.status))return `<button class="driver-main-action" data-driver-action="accept_v14" data-delivery="${delivery.id}">ACEITAR ENTREGA</button>`;
    if(['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(delivery.status))return `<button class="driver-main-action" data-driver-action="complete_v14" data-delivery="${delivery.id}">ENTREGAR</button>`;
    return '';
  };

  driverCard=function(delivery,selectable=false){
    const place=delivery.delivery_type==='base'?(delivery.base_name||'Base'):delivery.establishment_name;
    const pay=[paymentLabel(delivery.payment_method),delivery.payment_status==='paid'?'Pago':'Pendente',delivery.cash_payment_location==='pickup'?'na coleta':delivery.cash_payment_location==='delivery'?'na entrega':''].filter(Boolean).join(' • ');
    return `<article class="driver-order-card status-${esc(delivery.status)}">
      <header>${selectable?`<label class="route-check"><input type="checkbox" data-route-select="${delivery.id}" ${v6.selectedRoute.has(delivery.id)?'checked':''}><span></span></label>`:''}<div><small>${esc(delivery.display_code||'Entrega')}</small><strong>${esc(place||'Ligerim')}</strong></div>${badge(delivery.status)}</header>
      <div class="driver-order-money"><span>Você recebe</span><strong>${money(delivery.driver_net_cents||delivery.driver_earnings_cents)}</strong></div>
      <div class="v14-card-charge"><span><small>Valor da entrega</small><strong>${money(delivery.charge_cents)}</strong></span><span><small>Pagamento</small><strong>${esc(pay)}</strong></span></div>
      <div class="driver-address-flow"><div><i>1</i><span><small>Coleta</small><strong>${esc(delivery.pickup_address)}</strong></span></div><div><i>2</i><span><small>Entrega</small><strong>${esc(delivery.delivery_address)}</strong></span></div></div>
      <div class="driver-order-meta"><span>${km(delivery.distance_meters)}</span><span>${mins(delivery.duration_seconds)}</span><span>${esc(delivery.item_description||'Item não informado')}</span></div>
      <div class="driver-order-buttons">${driverStatusButton(delivery)}<button class="driver-secondary-action" data-driver-map="${delivery.id}">Navegar</button><button class="driver-secondary-action" data-driver-detail="${delivery.id}">Detalhes</button><button class="driver-secondary-action" data-driver-chat="${delivery.id}">Chat/Ligar</button></div>
    </article>`;
  };

  driverAction=async function(delivery,action){
    if(action==='accept_v14'){
      try{loading(true);if(delivery.status==='offered')await api(`/api/app/v9/driver/offers/${delivery.id}/accept`,{method:'POST'});await api(`/api/app/v14/driver/deliveries/${delivery.id}/accept`,{method:'POST',body:{}});await sound.play('accepted');toast('Entrega aceita. As etapas de coleta foram atualizadas automaticamente.');await navigate(state.page,false)}catch(e){toast(e.message,'error')}finally{loading(false)}return;
    }
    if(action==='complete_v14'){
      const customerDone=Boolean(delivery.customer_confirmed_received_at||delivery.completion_source==='customer');
      const required=Number(delivery.confirmation_required??1)===1&&!Number(delivery.finish_without_code_authorized||0)&&!customerDone;
      openModal(`Entregar • ${delivery.display_code}`,`<form id="complete-v14" class="form-grid"><div class="full notice">${customerDone?'O cliente já confirmou o recebimento. Basta concluir.':required?'O cliente pode tocar em “Recebi o pedido”. Caso não faça isso, informe o código de 4 dígitos.':'Confirme a conclusão da entrega.'}</div>${required?field('Código de confirmação','confirmation_code','','text','inputmode="numeric" maxlength="4" pattern="[0-9]{4}"'):''}${buttons('CONFIRMAR ENTREGA')}</form>`);
      $('#complete-v14').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/v14/driver/deliveries/${delivery.id}/complete`,{method:'POST',body:formObject(e.currentTarget)});closeModal();await sound.play('completed');toast('Entrega concluída e lançada nos ganhos.');await navigate(state.page,false)}catch(err){toast(err.message,'error')}finally{loading(false)}};return;
    }
  };

  driverDetailV6=function(delivery){
    const pExtra=extraAddress(delivery.pickup_apartment,delivery.pickup_complement),dExtra=extraAddress(delivery.delivery_apartment,delivery.delivery_complement);
    openModal(delivery.display_code||'Detalhes',`<div class="driver-detail-mobile">
      <div class="driver-detail-amount"><small>Você recebe</small><strong>${money(delivery.driver_net_cents||delivery.driver_earnings_cents)}</strong></div>
      <div class="v14-critical-data"><div><small>Valor cobrado</small><strong>${money(delivery.charge_cents)}</strong></div><div><small>Forma de pagamento</small><strong>${esc(paymentLabel(delivery.payment_method))}</strong><span>${esc(delivery.payment_status==='paid'?'Pago':'Pendente')}</span></div></div>
      <section><small>Cliente</small><strong>${esc(delivery.customer_name||delivery.recipient_name||'Cliente')}</strong><p>${esc(delivery.customer_phone||delivery.recipient_phone||'')}</p></section>
      <section><small>Coleta</small><strong>${esc(delivery.pickup_address)}</strong><p>${esc(pExtra)}</p></section>
      <section><small>Entrega</small><strong>${esc(delivery.delivery_address)}</strong><p>${esc(dExtra)}</p></section>
      <section><small>Item e observações</small><p>${esc(delivery.item_description||'Não informado')}<br>${esc(delivery.notes||'Sem observações')}</p></section>
      <div class="driver-order-buttons"><button class="driver-main-action" id="detail-map-v14">Navegar</button><button class="driver-secondary-action" id="detail-chat-v14">Abrir chat</button></div>
    </div>`);
    $('#detail-map-v14').onclick=()=>openDriverMap(delivery);$('#detail-chat-v14').onclick=()=>openDeliveryChat(delivery);
  };

  openDeliveryChat=async function(delivery){
    clearInterval(v14.chatTimer);
    let latest='';
    const render=async(notify=false)=>{
      const data=await api(`/api/app/v14/deliveries/${delivery.id}/chat`),items=data.items||[],last=items.at(-1);
      if(notify&&latest&&last&&last.id!==latest&&last.sender_type!==data.sender_type)loudAlert('message');if(last)latest=last.id;
      const contacts=data.contacts||[];
      if($('#v14-chat-messages')){
        const box=$('#v14-chat-messages');box.innerHTML=items.map(m=>`<div class="chat-message ${m.sender_type===data.sender_type?'mine':''}"><small>${esc(m.sender_name)} • ${dateTime(m.created_at)}</small><span class="chat-recipient-pill">Para: ${esc(m.recipient_type==='all'?'todos':m.recipient_type)}</span><p>${esc(m.message)}</p></div>`).join('')||'<p class="muted">Nenhuma mensagem.</p>';box.scrollTop=box.scrollHeight;return data;
      }
      openModal(`Comunicação • ${data.delivery.display_code}`,`<div class="delivery-chat realtime-chat"><div class="v14-chat-head"><label>Falar com<select id="v14-recipient">${contacts.map(x=>`<option value="${x.value}">${esc(x.label)}</option>`).join('')}</select></label><div class="v14-call-grid"><p class="muted">As chamadas de voz são feitas dentro do chat do Ligerim.</p></div></div><div id="v14-chat-messages" class="chat-messages"></div>${data.active?'<form id="v14-chat-form" class="chat-form"><input name="message" maxlength="500" placeholder="Digite a mensagem" required><button class="btn primary">Enviar</button></form>':'<p class="muted">Conversa encerrada.</p>'}</div>`);
      const box=$('#v14-chat-messages');box.innerHTML=items.map(m=>`<div class="chat-message ${m.sender_type===data.sender_type?'mine':''}"><small>${esc(m.sender_name)} • ${dateTime(m.created_at)}</small><span class="chat-recipient-pill">Para: ${esc(m.recipient_type==='all'?'todos':m.recipient_type)}</span><p>${esc(m.message)}</p></div>`).join('')||'<p class="muted">Nenhuma mensagem.</p>';box.scrollTop=box.scrollHeight;
      $('#v14-chat-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,msg=f.elements.message.value.trim();if(!msg)return;try{await api(`/api/app/v14/deliveries/${delivery.id}/chat`,{method:'POST',body:{message:msg,recipient_type:$('#v14-recipient').value}});f.elements.message.value='';await render(false)}catch(err){toast(err.message,'error')}});
      return data;
    };
    try{await render(false);v14.chatTimer=setInterval(()=>{if(!$('#modal').classList.contains('hidden')&&$('#v14-chat-messages'))render(true).catch(()=>{});else clearInterval(v14.chatTimer)},2000)}catch(e){toast(e.message,'error')}
  };

  const oldOps=operationsDeliveriesV6;
  operationsDeliveriesV6=async function(){await oldOps();try{const d=await api('/api/app/tenant/deliveries'),map=new Map((d.items||[]).map(x=>[x.id,x]));$$('[data-op-detail]').forEach(b=>{const cell=b.closest('tr')?.querySelector('.actions'),item=map.get(b.dataset.opDetail);if(cell&&item&&!cell.querySelector('[data-op-chat-v14]'))cell.insertAdjacentHTML('beforeend',`<button class="table-action" data-op-chat-v14="${item.id}">Chat/Ligar</button>`)});$$('[data-op-chat-v14]').forEach(b=>b.onclick=()=>openDeliveryChat(map.get(b.dataset.opChatV14)))}catch{}};
  if(pages.bases){const oldBases=pages.bases;pages.bases=async function(){await oldBases();try{const d=await api(`/api/app/tenant/deliveries${query({base_id:state.cache.baseViewId||''})}`),map=new Map((d.items||[]).map(x=>[x.id,x]));$$('[data-base-detail]').forEach(b=>{const cell=b.closest('tr')?.querySelector('.actions'),item=map.get(b.dataset.baseDetail);if(cell&&item&&!cell.querySelector('[data-base-chat-v14]'))cell.insertAdjacentHTML('beforeend',`<button class="table-action" data-base-chat-v14="${item.id}">Chat/Ligar</button>`)});$$('[data-base-chat-v14]').forEach(b=>b.onclick=()=>openDeliveryChat(map.get(b.dataset.baseChatV14)))}catch{}}}

  function ensureBubble(){let b=$('#v14-message-bubble');if(b)return b;b=document.createElement('button');b.id='v14-message-bubble';b.className='v14-message-bubble';b.innerHTML='<span class="icon">💬</span><span><strong>Nova mensagem</strong><small id="v14-message-preview"></small></span><span class="count" id="v14-message-count">0</span>';document.body.appendChild(b);return b}
  window.lgNotifyMessageOnce=function(messageId,scope='app'){
    if(!messageId)return false;
    const userKey=state.user?.id||'public',key=`lg_notified_message_${scope}_${userKey}`;
    if(localStorage.getItem(key)===String(messageId))return false;
    localStorage.setItem(key,String(messageId));
    loudAlert('message');
    return true;
  };
  async function pollUnread(){
    if(!state.user||state.user.role==='platform_admin')return;
    try{
      const d=await api('/api/app/v15/messages/unread'),bubble=ensureBubble(),first=d.items?.[0],total=Number(d.total||0);
      bubble.classList.toggle('show',total>0);
      const count=$('#v14-message-count'),preview=$('#v14-message-preview');if(count)count.textContent=String(total);if(preview)preview.textContent=first?.latest_message||'';
      if(first?.latest_id)window.lgNotifyMessageOnce(first.latest_id,'app');
      v14.lastUnread=total;v14.lastLatest=first?.latest_id||'';
      bubble.onclick=async()=>{
        if(!first)return;
        bubble.classList.remove('show');if(count)count.textContent='0';
        try{await openDeliveryChat({id:first.delivery_id,display_code:first.display_code},first.conversation_key)}finally{setTimeout(pollUnread,350)}
      };
    }catch{}
  }
  function startUnread(){if(v14.messageTimer||!state.user)return;ensureBubble();pollUnread();v14.messageTimer=setInterval(()=>{if(!document.hidden)pollUnread()},15000)}
  const oldShowApp=showApp;showApp=function(){oldShowApp();startUnread();updateOnlineControl()};
  setInterval(()=>{if(state.user)startUnread();else if(v14.messageTimer){clearInterval(v14.messageTimer);v14.messageTimer=null;$('#v14-message-bubble')?.classList.remove('show')}},1000);

  renderCustomerRequest=function(balance){
    const cat=lg.catalog||{},coops=cat.cooperatives||[],bases=cat.bases||[];
    $('#client-tab-body').innerHTML=`<section class="customer-card"><form id="client-order-v14" class="form-grid">
      ${selectField('Cooperativa','cooperative_id',coops,'','Selecione','required')}<label>Base<select name="base_id" id="client-base-v14" required><option value="">Selecione a cooperativa</option></select></label>
      ${addressFields('pickup','Endereço de coleta')}
      <div class="full address-inline-details">${field('Apartamento/Unidade na coleta','pickup_apartment')}${field('Complemento da coleta','pickup_complement')}</div>
      ${field('Pessoa na coleta','pickup_contact_name')}${field('Telefone da coleta','pickup_phone','','tel')}
      ${addressFields('delivery','Endereço de entrega')}
      <div class="full address-inline-details">${field('Apartamento/Unidade na entrega','delivery_apartment')}${field('Complemento da entrega','delivery_complement')}</div>
      ${field('Quem recebe','recipient_name','','text','required')}${field('Telefone de quem recebe','recipient_phone','','tel')}
      ${field('Descrição do item (opcional)','item_description','','text','placeholder="Opcional"')}
      ${selectField('Forma de pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'pix_cooperativa',name:'PIX Cooperativa'},{id:'credit',name:`Crédito antecipado (${money(balance)})`}],'pix','Selecione','required')}
      <label class="full hidden" data-cash-location>Dinheiro será pago em<select name="cash_payment_location"><option value="pickup">Na coleta</option><option value="delivery">Na entrega</option></select></label>
      <div class="full" id="client-services-v14"></div>${textarea('Observações','notes','','placeholder="Informe portaria, torre, referência ou cuidado especial"')}
      <div class="full quote-result" id="quote-v14">Confirme os dois endereços para consultar o valor.</div><div class="form-actions"><button type="button" class="btn soft" id="quote-btn-v14">Consultar valor</button><button class="btn primary">Confirmar pedido</button></div>
    </form></section>`;
    const form=$('#client-order-v14');bindAddressSearch(form,'pickup',()=>({cooperative_id:form.cooperative_id.value,base_id:form.base_id.value}));bindAddressSearch(form,'delivery',()=>({cooperative_id:form.cooperative_id.value,base_id:form.base_id.value}));bindCashLocation(form);
    const update=()=>{const list=bases.filter(x=>x.cooperative_id===form.cooperative_id.value);form.base_id.innerHTML='<option value="">Selecione</option>'+list.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');$('#client-services-v14').innerHTML=''};
    form.cooperative_id.onchange=update;form.base_id.onchange=()=>{const services=(cat.services||[]).filter(x=>x.cooperative_id===form.cooperative_id.value&&(!x.base_id||x.base_id===form.base_id.value));$('#client-services-v14').innerHTML=services.length?`<strong>Serviços adicionais</strong>${serviceChecks(services)}`:''};
    const quote=async()=>{requireConfirmed(form,'pickup');requireConfirmed(form,'delivery');const d=await clientApi('/quote',{method:'POST',body:formObject(form)});$('#quote-v14').innerHTML=`Valor da entrega: <strong>${money(d.quote.charge_cents)}</strong><br><small>${km(d.quote.distance_meters)} • ${mins(d.quote.duration_seconds)}</small>`;return d.quote};
    $('#quote-btn-v14').onclick=async()=>{try{loading(true);await quote()}catch(e){toast(e.message,'error')}finally{loading(false)}};
    form.onsubmit=async e=>{e.preventDefault();try{loading(true);const q=await quote();if(!confirm(`Confirmar o pedido por ${money(q.charge_cents)}?`))return;const r=await clientApi('/orders',{method:'POST',body:formObject(form)});toast(`Pedido ${r.order.display_code} criado.`);renderCustomerHome('orders')}catch(err){toast(err.message,'error')}finally{loading(false)}};
  };

  publicTracking=async function(token){
    $('#auth-screen').classList.add('hidden');$('#app-shell').classList.add('hidden');$('#customer-screen').classList.add('hidden');const screen=$('#tracking-screen');screen.classList.remove('hidden');clearInterval(state.timer);clearInterval(v14.publicTimer);clearInterval(v14.publicChatTimer);let current=null,lastMessage='';
    screen.innerHTML=`<div class="tracking-card v9-tracking"><header id="public-head-v14" class="tracking-head"></header><div class="tracking-body"><div id="public-address-v14" class="tracking-address"></div><div id="public-details-v14"></div><div id="public-timeline-v14" class="tracking-timeline"></div><div id="public-map" class="map small"></div><div id="public-info-v14" class="tracking-info"></div><div id="public-actions-v14" class="v14-public-actions"></div><section class="public-chat"><header><h2>Conversa da entrega</h2><button class="btn small" id="public-sound-v14">🔊 Ativar som forte</button></header><div class="v14-chat-head"><label>Falar com<select id="public-recipient-v14"><option value="driver">Cooperado</option><option value="establishment">Estabelecimento</option><option value="cooperative">Base/Cooperativa</option><option value="all">Todos</option></select></label></div><div id="public-chat-v14"></div><form id="public-chat-form-v14" class="chat-form"><input name="message" maxlength="500" placeholder="Digite sua mensagem"><button class="btn primary">Enviar</button></form></section><div id="public-extra-v14"></div></div></div>`;
    $('#public-sound-v14').onclick=()=>{loudAlert('message');$('#public-sound-v14').textContent='🔊 Som ativado'};
    const loadStatus=async()=>{try{const d=await api(`/api/public/tracking/${encodeURIComponent(token)}`),x=d.item;current=x;const steps=['assigned','accepted','to_pickup','at_pickup','picked_up','in_route','delivered'],idx=steps.indexOf(x.status);$('#public-head-v14').innerHTML=`<div class="tracking-brand"><img src="/icons/icon-official.png" alt=""><div><p class="eyebrow">${esc(x.cooperative_name||'ChegaJá')}</p><h1>${esc(x.display_code||'Sua entrega')}</h1><p>${esc(x.base_name||x.establishment_name||'')}</p></div></div>${badge(x.status)}`;$('#public-address-v14').innerHTML=`<div class="address-box"><small>Coleta</small><strong>${esc(x.pickup_address)}</strong><span>${esc(extraAddress(x.pickup_apartment,x.pickup_complement))}</span></div><div class="address-box"><small>Entrega</small><strong>${esc(x.delivery_address)}</strong><span>${esc(extraAddress(x.delivery_apartment,x.delivery_complement))}</span></div>`;$('#public-details-v14').innerHTML=`<div class="v14-public-details"><p><strong>Item:</strong> ${esc(x.item_description||'Não informado')}</p><p><strong>Observações:</strong> ${esc(x.notes||'Sem observações')}</p><p><strong>Pagamento:</strong> ${esc(paymentLabel(x.payment_method))} • ${x.payment_status==='paid'?'Pago':'Pendente'} • ${money(x.charge_cents)}</p></div>`;$('#public-timeline-v14').innerHTML=steps.map((s,i)=>`<div class="tracking-step ${i<=idx?'done':''}"><span class="step-dot"></span><div><strong>${statusText[s]}</strong>${i===idx?'<small>Status atual</small>':''}</div></div>`).join('');$('#public-info-v14').innerHTML=`<span><small>Cooperado</small><strong>${esc(x.driver_name||'Aguardando')}</strong></span><span><small>Distância</small><strong>${km(x.distance_meters)}</strong></span><span><small>Previsão</small><strong>${mins(x.duration_seconds)}</strong></span><span><small>Atualizado</small><strong>${dateTime(x.location_updated_at||x.updated_at)}</strong></span>`;const actions=[];if(['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(x.status))actions.push('<button class="btn v14-received" id="public-received-v14">✓ RECEBI O PEDIDO</button>');$('#public-actions-v14').innerHTML=actions.join('');$('#public-recipient-v14 option[value="establishment"]').hidden=x.delivery_type==='base';$('#public-recipient-v14 option[value="cooperative"]').hidden=x.delivery_type!=='base';$('#public-received-v14')?.addEventListener('click',async()=>{if(!confirm('Confirmar que você recebeu o pedido?'))return;try{loading(true);await api(`/api/public/tracking/${encodeURIComponent(token)}/received`,{method:'POST',body:{name:x.customer_name}});await sound.play('completed');toast('Recebimento confirmado. A entrega foi concluída.');await loadStatus()}catch(e){toast(e.message,'error')}finally{loading(false)}});const old=$('#public-map');if(old){const fresh=old.cloneNode(false);old.replaceWith(fresh)}renderLineMap('public-map',parseGeometry(x.route_geometry),[{lat:x.pickup_lat,lng:x.pickup_lng,label:'Coleta'},{lat:x.delivery_lat,lng:x.delivery_lng,label:'Entrega'},{lat:x.driver_lat,lng:x.driver_lng,label:x.driver_name||'Cooperado'}]);$('#public-chat-form-v14').classList.toggle('hidden',!x.customer_chat_enabled||['new','offered','delivered','cancelled'].includes(x.status));$('#public-extra-v14').innerHTML=`${x.rating_available?`<section class="public-rating"><h2>Avalie a entrega</h2><form id="rating-v14" class="form-grid"><label>Estabelecimento<select name="establishment_score">${[5,4,3,2,1].map(n=>`<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select></label><label>Cooperado<select name="driver_score">${[5,4,3,2,1].map(n=>`<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select></label>${textarea('Comentário','comment')}<button class="btn primary full">Enviar avaliação</button></form></section>`:''}${x.receipt_available?'<button class="btn full" id="receipt-v14">Gerar recibo</button>':''}`;$('#rating-v14')?.addEventListener('submit',async e=>{e.preventDefault();await api(`/api/public/tracking/${encodeURIComponent(token)}/rating`,{method:'POST',body:formObject(e.currentTarget)});toast('Avaliação enviada.');loadStatus()});$('#receipt-v14')?.addEventListener('click',()=>openReceipt(`/api/public/tracking/${encodeURIComponent(token)}/receipt`))}catch(e){console.error('Falha temporária no rastreamento',e);let notice=$('#public-error-v14');if(!notice){const body=screen.querySelector('.tracking-body');if(body){body.insertAdjacentHTML('afterbegin','<div id="public-error-v14" class="address-warning"></div>');notice=$('#public-error-v14')}}if(notice){notice.textContent=`Não foi possível atualizar agora: ${e.message}. Tentaremos novamente.`;setTimeout(()=>notice?.remove(),4500)}}};
    const loadMessages=async(notify=true)=>{try{const d=await api(`/api/public/tracking/${encodeURIComponent(token)}/messages`),items=d.items||[],last=items.at(-1);if(notify&&lastMessage&&last&&last.id!==lastMessage&&last.sender_type!=='customer')loudAlert('message');if(last)lastMessage=last.id;const box=$('#public-chat-v14');box.innerHTML=items.map(m=>`<div class="chat-message ${m.sender_type==='customer'?'mine':''}"><small>${esc(m.sender_name)} • ${dateTime(m.created_at)}</small><p>${esc(m.message)}</p></div>`).join('')||'<p class="muted">Nenhuma mensagem.</p>';box.scrollTop=box.scrollHeight}catch{}};
    $('#public-chat-form-v14').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,msg=f.elements.message.value.trim();if(!msg)return;try{await api(`/api/public/tracking/${encodeURIComponent(token)}/messages`,{method:'POST',body:{message:msg,recipient_type:$('#public-recipient-v14').value}});f.elements.message.value='';await loadMessages(false)}catch(err){toast(err.message,'error')}};await loadStatus();await loadMessages(false);v14.publicTimer=setInterval(()=>{if(!document.hidden)loadStatus()},5000);v14.publicChatTimer=setInterval(()=>{if(!document.hidden)loadMessages(true)},2000);
  };

  if(state.user){startUnread();updateOnlineControl()}
})();


/* ===== ligerim-v15.js ===== */
/* Ligerim 10.7 — edição rápida das entregas da Base */
(function(){
  const v15={formData:null};

  function addressDefaults(item,prefix){
    let data={};
    try{data=JSON.parse(item[`${prefix}_address_json`]||'{}')||{}}catch{}
    return {
      street:data.street||'',
      number:data.number||'',
      neighborhood:data.neighborhood||item[`${prefix}_neighborhood`]||'',
      city:data.city||'Natal',
      state:data.state_code||data.state||'RN',
      postal_code:data.postal_code||''
    };
  }

  function addressSignature(form,prefix){
    return ['street','number','neighborhood','city','state','postal_code']
      .map(name=>String(form.elements[`${prefix}_${name}`]?.value||'').trim())
      .join('|');
  }

  function selectedCustomerBalance(form,customers){
    const customer=customers.find(x=>x.id===form.elements.customer_id?.value);
    const box=$('#v15-credit-balance');
    if(box)box.innerHTML=customer?`Saldo disponível: <strong>${money(customer.balance_cents)}</strong>`:'Selecione o cliente para consultar o saldo.';
  }

  async function quickEditBaseDelivery(item,baseData){
    if(!item)return;
    if(['delivered','cancelled'].includes(item.status))return toast('Entrega finalizada não pode ser alterada.','error');
    try{
      loading(true);
      v15.formData=v15.formData||await api('/api/app/v15/base/delivery-form-data');
      const customers=v15.formData.customers||[];
      const drivers=(baseData.drivers||[]).filter(x=>x.status!=='inactive');
      const pickup=addressDefaults(item,'pickup'),destination=addressDefaults(item,'delivery');
      const currentDriver=item.assigned_driver_id&&!drivers.some(x=>x.id===item.assigned_driver_id)
        ?[{id:item.assigned_driver_id,name:item.driver_name||'Cooperado atual'}]
        :[];
      openModal(`Editar rápido • ${item.display_code||'Entrega da Base'}`,`<form id="base-quick-edit-v15" class="form-grid">
        <div class="full quick-edit-summary-v15"><div><small>Pedido</small><strong>${esc(item.display_code||'—')}</strong></div><div><small>Status</small><strong>${esc(statusText[item.status]||item.status)}</strong></div><div><small>Distância atual</small><strong>${km(item.distance_meters)}</strong></div></div>
        ${selectField('Cooperado','driver_id',[...currentDriver,...drivers],item.assigned_driver_id||'','Sem cooperado')}
        ${field('Valor da entrega','charge_value',inputMoney(item.charge_cents),'number','required step="0.01" min="0.01"')}
        ${selectField('Forma de pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'pix_cooperativa',name:'PIX Cooperativa'},{id:'credit',name:'Crédito antecipado'}],item.payment_method||'pix','Selecione','required')}
        ${selectField('Situação do pagamento','payment_status',[{id:'pending',name:'Pendente'},{id:'paid',name:'Pago'}],item.payment_status||'pending','Selecione','required')}
        <label class="full hidden" data-cash-location>Dinheiro será recebido em<select name="cash_payment_location"><option value="pickup" ${item.cash_payment_location==='pickup'?'selected':''}>Na coleta</option><option value="delivery" ${item.cash_payment_location==='delivery'?'selected':''}>Na entrega</option></select></label>
        <label class="full" id="v15-customer-label">Cliente vinculado<select name="customer_id"><option value="">Selecione</option>${customers.map(x=>`<option value="${x.id}" ${x.id===item.customer_id?'selected':''}>${esc(x.name)} — ${money(x.balance_cents)}</option>`).join('')}</select><small id="v15-credit-balance"></small></label>
        <div class="full current-address-v15"><small>Coleta atual</small><strong>${esc(item.pickup_address||'')}</strong></div>
        ${addressFields('pickup','Alterar endereço de coleta',pickup)}
        <div class="full current-address-v15"><small>Entrega atual</small><strong>${esc(item.delivery_address||'')}</strong></div>
        ${addressFields('delivery','Alterar endereço de entrega',destination)}
        <label class="checkbox-row full"><input type="checkbox" name="recalculate_charge"> Recalcular o valor automaticamente pela nova rota</label>
        <label class="checkbox-row full"><input type="checkbox" name="finish_without_code_authorized" ${Number(item.finish_without_code_authorized||0)===1?'checked':''}> Permitir finalizar sem código</label>
        <div class="full notice"><strong>Edição direta da Base</strong><br>Você pode alterar cooperado, valor, pagamento, coleta e entrega sem sair desta tela. Ao mudar um endereço, localize e confirme antes de salvar. A rota e a distância serão atualizadas automaticamente.</div>
        ${buttons('Salvar alterações')}
      </form>`);
      const form=$('#base-quick-edit-v15');
      bindAddressSearch(form,'pickup',()=>({cooperative_id:state.user.cooperative_id,base_id:item.base_id}));
      bindAddressSearch(form,'delivery',()=>({cooperative_id:state.user.cooperative_id,base_id:item.base_id}));
      bindCashLocation(form);
      for(const prefix of ['pickup','delivery'])for(const name of ['street','number','neighborhood','city','state','postal_code']){const input=form.elements[`${prefix}_${name}`];if(input)input.required=false;}
      const initialPickup=addressSignature(form,'pickup'),initialDelivery=addressSignature(form,'delivery');
      const paymentUpdate=()=>{
        const credit=form.elements.payment_method.value==='credit';
        $('#v15-customer-label')?.classList.toggle('credit-required-v15',credit);
        if(credit)form.elements.payment_status.value='paid';
        form.elements.payment_status.disabled=credit;
        selectedCustomerBalance(form,customers);
      };
      form.elements.payment_method.addEventListener('change',paymentUpdate);
      form.elements.customer_id.addEventListener('change',()=>selectedCustomerBalance(form,customers));
      paymentUpdate();
      form.onsubmit=async event=>{
        event.preventDefault();
        try{
          loading(true);
          const pickupChanged=addressSignature(form,'pickup')!==initialPickup;
          const deliveryChanged=addressSignature(form,'delivery')!==initialDelivery;
          if(pickupChanged)requireConfirmed(form,'pickup');
          if(deliveryChanged)requireConfirmed(form,'delivery');
          if(form.elements.payment_method.value==='credit'&&!form.elements.customer_id.value)throw new Error('Selecione o cliente para usar o crédito pré-pago.');
          const body=formObject(form);
          body.pickup_confirmation_token=pickupChanged?form.elements.pickup_confirmation_token.value:'';
          body.delivery_confirmation_token=deliveryChanged?form.elements.delivery_confirmation_token.value:'';
          if(form.elements.payment_method.value==='credit')body.payment_status='paid';
          const result=await api(`/api/app/v15/base/deliveries/${item.id}`,{method:'PUT',body});
          closeModal();
          const details=[];
          if(pickupChanged||deliveryChanged)details.push(`nova rota: ${km(result.item.distance_meters)}`);
          if(result.credit?.delta_cents)details.push(result.credit.delta_cents>0?`crédito consumido: ${money(result.credit.delta_cents)}`:`crédito devolvido: ${money(Math.abs(result.credit.delta_cents))}`);
          toast(`Entrega atualizada${details.length?` • ${details.join(' • ')}`:''}.`);
          v15.formData=null;
          pages.bases();
        }catch(error){toast(error.message,'error')}finally{loading(false)}
      };
    }catch(error){toast(error.message,'error')}finally{loading(false)}
  }

  if(pages.bases){
    const previousBases=pages.bases;
    pages.bases=async function(){
      await previousBases();
      if(!['cooperative_admin','dispatcher'].includes(state.user?.role))return;
      try{
        const [deliveries,baseData]=await Promise.all([
          api(`/api/app/tenant/deliveries${query({base_id:state.cache.baseViewId||''})}`),
          lgBase(true)
        ]);
        const map=new Map((deliveries.items||[]).map(item=>[item.id,item]));
        $$('[data-base-detail]').forEach(button=>{
          const item=map.get(button.dataset.baseDetail),row=button.closest('tr'),actions=row?.querySelector('.actions');
          if(!item||!row)return;
          if(actions&&!actions.querySelector('[data-base-quick-edit]')&&!['delivered','cancelled'].includes(item.status)){
            actions.insertAdjacentHTML('afterbegin',`<button class="table-action primary-action-v15" data-base-quick-edit="${item.id}">Editar</button>`);
          }
          const cells=row.querySelectorAll('td');
          [2,3].forEach(index=>{
            const cell=cells[index];
            if(!cell||['delivered','cancelled'].includes(item.status))return;
            cell.classList.add('base-address-edit-v15');
            cell.title='Clique para editar esta entrega';
            cell.onclick=event=>{if(event.target.closest('button,a,input,select'))return;quickEditBaseDelivery(item,baseData)};
          });
        });
        $$('[data-base-quick-edit]').forEach(button=>button.onclick=()=>quickEditBaseDelivery(map.get(button.dataset.baseQuickEdit),baseData));
      }catch(error){console.error('Falha ao preparar edição rápida da Base',error)}
    };
  }
})();


/* ===== ligerim-v16.js ===== */
/* Ligerim 10.8 — Base completa, atendentes, precificação e cronômetro de espera */
(function(){
  const v16={formCache:new Map(),waitPoll:null,publicWaitPoll:null,tick:null};
  const payNames={pix:'PIX',dinheiro:'Dinheiro',pix_cooperativa:'PIX Cooperativa',credit:'Crédito antecipado',credito:'Crédito antecipado',cartao_credito:'Cartão de crédito',cartao_debito:'Cartão de débito',vale_alimentacao:'Vale-alimentação',vale_refeicao:'Vale-refeição'};
  const paymentName=value=>payNames[value]||value||'Não informado';
  const bool=value=>value===true||value===1||value==='1'||value==='true'||value==='on';
  const secondsLabel=value=>{const n=Math.max(0,Math.floor(Number(value)||0)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`};
  const parseDate=value=>{if(!value)return 0;const raw=String(value);const d=new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw)?raw:raw.replace(' ','T')+'Z');return Number.isNaN(d.getTime())?0:d.getTime()};
  const parseAddress=raw=>{let x={};try{x=typeof raw==='string'?JSON.parse(raw||'{}'):(raw||{})}catch{}return {street:x.street||'',number:x.number||'',neighborhood:x.neighborhood||'',city:x.city||'Natal',state:x.state_code||x.state||'RN',postal_code:x.postal_code||''}};
  const splitBlockComplement=raw=>{const text=String(raw||'').trim(),match=text.match(/^Bloco:\s*([^•\n]+)(?:\s*•\s*(.*))?$/i);return match?{block:match[1].trim(),complement:(match[2]||'').trim()}:{block:'',complement:text}};
  const addressSignature=(form,prefix)=>['street','number','neighborhood','city','state','postal_code'].map(k=>String(form.elements[`${prefix}_${k}`]?.value||'').trim()).join('|');
  const activeBase=()=>state.cache.baseViewId||$('#base-view-select')?.value||'';
  const apiFormData=async baseId=>{if(!baseId)throw new Error('Selecione uma Base.');if(!v16.formCache.has(baseId))v16.formCache.set(baseId,await api(`/api/app/v16/base/delivery-form-data?base_id=${encodeURIComponent(baseId)}`));return v16.formCache.get(baseId)};
  const invalidate=baseId=>{if(baseId)v16.formCache.delete(baseId);else v16.formCache.clear()};

  function setAddressValues(form,prefix,raw,apt='',complement=''){
    const x=parseAddress(raw),extra=splitBlockComplement(complement);
    for(const key of ['street','number','neighborhood','city','state','postal_code'])if(form.elements[`${prefix}_${key}`])form.elements[`${prefix}_${key}`].value=x[key]||'';
    if(form.elements[`${prefix}_block`])form.elements[`${prefix}_block`].value=extra.block||'';
    if(form.elements[`${prefix}_apartment`])form.elements[`${prefix}_apartment`].value=apt||'';
    if(form.elements[`${prefix}_complement`])form.elements[`${prefix}_complement`].value=extra.complement||'';
    if(form.elements[`${prefix}_confirmation_token`])form.elements[`${prefix}_confirmation_token`].value='';
    const target=$(`#${prefix}-address-results`,form);if(target)target.innerHTML='<span class="address-warning">Endereço preenchido do histórico. Clique em “Localizar e confirmar endereço”.</span>';
  }

  function customerChooser(customers,item={}){
    const registered=item.customer_mode!=='guest'&&Boolean(item.customer_id);
    return `<section class="full v16-customer-box">
      <div class="v16-segmented" role="group"><button type="button" data-customer-mode="registered" class="${registered?'active':''}">Cliente cadastrado</button><button type="button" data-customer-mode="guest" class="${registered?'':'active'}">Cliente avulso</button></div>
      <input type="hidden" name="customer_mode" value="${registered?'registered':'guest'}"><input type="hidden" name="customer_id" value="${esc(item.customer_id||'')}">
      <div data-customer-registered class="${registered?'':'hidden'}">
        <label>Buscar cliente<input id="v16-customer-search" autocomplete="off" placeholder="Digite nome ou telefone" value="${esc(registered?(item.customer_name||''):'')}"></label>
        <div id="v16-customer-results" class="v16-customer-results"></div><div id="v16-customer-selected" class="v16-customer-selected"></div>
      </div>
      <div data-customer-guest class="${registered?'hidden':''}"><div class="form-grid compact-grid">${field('Nome do cliente','customer_name',registered?'':item.customer_name||'','text','required')}${field('Telefone','customer_phone',registered?'':item.customer_phone||'','tel')}</div><p class="muted">O cliente avulso fica somente nesta entrega. Ele pode ser cadastrado depois pela área de clientes.</p></div>
    </section>`;
  }

  function bindCustomerChooser(form,customers,item={}){
    const hiddenMode=form.elements.customer_mode,hiddenId=form.elements.customer_id,search=$('#v16-customer-search',form),results=$('#v16-customer-results',form),selected=$('#v16-customer-selected',form);
    let current=customers.find(x=>x.id===hiddenId.value)||null;
    const renderSelected=customer=>{
      current=customer||null;hiddenId.value=customer?.id||'';hiddenId.dispatchEvent(new Event('change',{bubbles:true}));
      if(selected)selected.innerHTML=customer?`<div><strong>${esc(customer.name)}</strong><span>${esc(customer.phone||'Sem telefone')}</span><span>Crédito: <b>${money(customer.balance_cents)}</b></span>${customer.last_address?`<span>Último endereço: ${esc(customer.last_address)}</span>`:''}</div><div class="v16-customer-buttons"><button type="button" class="btn small" data-use-last-pickup ${customer.last_pickup_address_json?'':'disabled'}>Usar última coleta</button><button type="button" class="btn small" data-use-last-delivery ${customer.last_delivery_address_json?'':'disabled'}>Usar última entrega</button></div>`:'<span class="muted">Nenhum cliente selecionado.</span>';
      $('[data-use-last-pickup]',selected)?.addEventListener('click',()=>setAddressValues(form,'pickup',customer.last_pickup_address_json,customer.last_pickup_apartment,customer.last_pickup_complement));
      $('[data-use-last-delivery]',selected)?.addEventListener('click',()=>setAddressValues(form,'delivery',customer.last_delivery_address_json,customer.last_delivery_apartment,customer.last_delivery_complement));
    };
    const showResults=()=>{if(!results||!search)return;const term=search.value.trim().toLocaleLowerCase('pt-BR');const list=(term?customers.filter(x=>`${x.name} ${x.phone||''}`.toLocaleLowerCase('pt-BR').includes(term)):customers).slice(0,12);results.innerHTML=list.map(x=>`<button type="button" data-customer-id="${x.id}"><strong>${esc(x.name)}</strong><span>${esc(x.phone||'')}</span><small>${money(x.balance_cents)}</small></button>`).join('')||(term?'<span class="muted">Nenhum cliente encontrado. Use “Cliente avulso”.</span>':'');$$('[data-customer-id]',results).forEach(b=>b.onclick=()=>{const customer=customers.find(x=>x.id===b.dataset.customerId);search.value=customer?.name||'';results.innerHTML='';renderSelected(customer)})};
    if(search){search.oninput=showResults;search.onfocus=showResults;}
    $$('[data-customer-mode]',form).forEach(button=>button.onclick=()=>{const mode=button.dataset.customerMode;hiddenMode.value=mode;$$('[data-customer-mode]',form).forEach(b=>b.classList.toggle('active',b===button));$('[data-customer-registered]',form).classList.toggle('hidden',mode!=='registered');$('[data-customer-guest]',form).classList.toggle('hidden',mode!=='guest');if(mode==='guest'){hiddenId.value='';current=null}else renderSelected(current);$$('[data-customer-guest] [name]',form).forEach(el=>el.required=mode==='guest'&&el.name==='customer_name')});
    renderSelected(current);
    document.addEventListener('click',event=>{if(results&&!event.target.closest('.v16-customer-box'))results.innerHTML=''},{once:true});
    return ()=>current;
  }

  function addressExtras(prefix,title,item={}){
    const extra=splitBlockComplement(item[`${prefix}_complement`]||'');
    return `${addressFields(prefix,title,parseAddress(item[`${prefix}_address_json`]))}<div class="full v16-address-extra">${field('Bloco',`${prefix}_block`,extra.block||'')}${field('Apartamento / unidade',`${prefix}_apartment`,item[`${prefix}_apartment`]||'')}${field('Complemento / referência',`${prefix}_complement`,extra.complement||'')}</div>`;
  }

  function paymentFields(item={}){
    return `${selectField('Forma de pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'cartao_credito',name:'Cartão de crédito'},{id:'cartao_debito',name:'Cartão de débito'},{id:'vale_alimentacao',name:'Vale-alimentação'},{id:'vale_refeicao',name:'Vale-refeição'},{id:'pix_cooperativa',name:'PIX Cooperativa'},{id:'credit',name:'Crédito antecipado'}],item.payment_method||'pix','Selecione','required')}
      ${selectField('Situação do pagamento','payment_status',[{id:'pending',name:'Pendente'},{id:'paid',name:'Pago'}],item.payment_status||'pending','Selecione','required')}
      <label class="full hidden" data-cash-location>Dinheiro será recebido em<select name="cash_payment_location"><option value="pickup" ${item.cash_payment_location==='pickup'?'selected':''}>Na coleta</option><option value="delivery" ${item.cash_payment_location==='delivery'?'selected':''}>Na entrega</option></select></label>`;
  }

  function quoteBreakdown(q){
    if(!q)return '<span class="muted">Confirme os endereços para calcular.</span>';
    return `<div class="v16-quote-grid"><span>Rota coleta → entrega <strong>${money(q.route_charge_cents)}</strong><small>${km(q.distance_meters)} • ${mins(q.duration_seconds)}</small></span><span>Deslocamento até a coleta <strong>${money(q.displacement_cents)}</strong><small>${km(q.displacement_distance_meters)}</small></span><span>Retorno ${q.return_required?'(50% configurável)':''}<strong>${money(q.return_cents)}</strong></span><span>Serviços <strong>${money(q.service_charge_cents)}</strong></span><span class="total">TOTAL PREVISTO <strong>${money(q.base_charge_cents)}</strong></span><span class="internal">Custo estimado de combustível <strong>${money(q.fuel_cost_cents)}</strong><small>${Number(q.fuel_liters||0).toFixed(2).replace('.',',')} litro(s) — controle interno</small></span></div>`;
  }

  function configurePayment(form,customers){
    bindCashLocation(form);
    const update=()=>{const credit=form.elements.payment_method.value==='credit';if(credit){form.elements.payment_status.value='paid';form.elements.payment_status.disabled=true}else form.elements.payment_status.disabled=false;const selected=customers.find(x=>x.id===form.elements.customer_id?.value);const box=$('[data-credit-note]',form);if(box)box.innerHTML=credit?(selected?`Será usado o crédito de <strong>${esc(selected.name)}</strong>. Saldo atual: <strong>${money(selected.balance_cents)}</strong>`:'Selecione um cliente cadastrado para usar crédito antecipado.'):'O pagamento pode ser alterado depois na edição rápida.'};
    form.elements.payment_method.addEventListener('change',update);form.elements.customer_id?.addEventListener('change',update);update();return update;
  }

  baseOrderForm=async function(baseData={}){
    try{
      loading(true);
      const baseId=baseData.bases?.find(x=>x.id===activeBase())?.id||baseData.bases?.[0]?.id||activeBase();
      const data=await apiFormData(baseId),base=(baseData.bases||[]).find(x=>x.id===baseId)||{id:baseId,name:'Base'};
      const customers=data.customers||[],drivers=data.drivers||[],services=data.services||[];
      const defaultDate=isoDate(),future=new Date(Date.now()+60*60*1000),defaultTime=`${String(future.getHours()).padStart(2,'0')}:${String(future.getMinutes()).padStart(2,'0')}`;
      openModal(`Nova entrega da Base • ${base.name||''}`,`<form id="base-order-form" class="form-grid v16-order-form">
        <input type="hidden" name="base_id" value="${esc(baseId)}">
        <div class="full v16-attendant-banner"><span>Atendente responsável</span><strong>${esc(data.current_attendant?.name||state.user.name)}</strong><small>O cliente e o cooperado verão quem lançou a entrega.</small></div>
        ${customerChooser(customers,{customer_mode:'guest'})}
        ${field('Contato na coleta','pickup_contact_name')}${field('Telefone da coleta','pickup_phone','','tel')}
        ${addressExtras('pickup','Endereço de coleta')}
        ${field('Quem receberá','recipient_name')}${field('Telefone de quem recebe','recipient_phone','','tel')}
        ${addressExtras('delivery','Endereço de entrega')}
        ${field('Item / encomenda','item_description')}
        <section class="full v149-schedule-box"><strong>Quando a entrega será realizada?</strong>
          <label>Momento da entrega<select name="service_time_mode"><option value="now">Agora</option><option value="scheduled">Agendar data e horário</option></select></label>
          <div class="v149-schedule-fields hidden" data-v149-schedule-fields>${field('Data agendada','scheduled_date',defaultDate,'date')}${field('Horário agendado','scheduled_time',defaultTime,'time')}</div>
        </section>
        <section class="full v149-dispatch-box"><strong>Escolha do cooperado</strong>
          <label>Forma de atribuição<select name="dispatch_mode"><option value="none">Não atribuir agora</option><option value="manual">Manual — escolher cooperado</option><option value="automatic">Automática — sistema escolhe</option></select></label>
          <div class="v149-manual-driver hidden" data-v149-manual-driver>${selectField('Cooperado (opcional)','driver_id',drivers,'','Escolher depois')}</div>
          <small>Nenhuma opção é obrigatória. A entrega pode ficar sem cooperado e ser atribuída depois.</small>
        </section>
        ${field('Deslocamento manual até a coleta (km)','displacement_km','','number','min="0" step="0.01" placeholder="Calculado pela localização do cooperado"')}
        <label class="checkbox-row"><input type="checkbox" name="return_required"> Possui retorno</label><label class="checkbox-row"><input type="checkbox" name="finish_without_code_authorized"> Liberar conclusão sem código</label>
        <section class="full v16-services"><header><strong>Serviços adicionais</strong><small>O valor, tempo livre e espera vêm da configuração da Base.</small></header>${serviceChecks(services)}</section>
        ${field('Valor manual total (opcional)','charge_value','','number','min="0.01" step="0.01" placeholder="Deixe vazio para usar o cálculo"')}
        ${paymentFields({payment_method:'pix',payment_status:'pending'})}<div class="full notice" data-credit-note></div>
        ${textarea('Observações','notes','','placeholder="Instruções, cartório, correio, compras, item frágil..."')}
        <div class="full v16-quote" id="v16-quote">${quoteBreakdown(null)}</div>
        <div class="form-actions"><button type="button" class="btn" data-close-modal>Cancelar</button><button type="button" class="btn soft" id="v16-quote-button">Calcular valor</button><button type="submit" class="btn primary">Criar entrega</button></div>
      </form>`);
      const form=$('#base-order-form');
      bindCustomerChooser(form,customers,{});bindAddressSearch(form,'pickup',()=>({cooperative_id:state.user.cooperative_id,base_id:baseId}));bindAddressSearch(form,'delivery',()=>({cooperative_id:state.user.cooperative_id,base_id:baseId}));configurePayment(form,customers);
      const syncScheduling=()=>{const scheduled=form.elements.service_time_mode.value==='scheduled',manual=form.elements.dispatch_mode.value==='manual';form.querySelector('[data-v149-schedule-fields]')?.classList.toggle('hidden',!scheduled);form.querySelector('[data-v149-manual-driver]')?.classList.toggle('hidden',!manual);form.elements.scheduled_date.required=scheduled;form.elements.scheduled_time.required=scheduled;if(!manual)form.elements.driver_id.value='';};
      form.elements.service_time_mode.onchange=syncScheduling;form.elements.dispatch_mode.onchange=syncScheduling;syncScheduling();
      const quote=async()=>{requireConfirmed(form,'pickup');requireConfirmed(form,'delivery');const body=formObject(form);if(form.elements.payment_status.disabled)body.payment_status='paid';const result=await api('/api/app/v16/base/quote',{method:'POST',body});$('#v16-quote').innerHTML=quoteBreakdown(result.quote);return result.quote};
      $('#v16-quote-button').onclick=async()=>{try{loading(true);await quote()}catch(e){toast(e.message,'error')}finally{loading(false)}};
      form.onsubmit=async event=>{event.preventDefault();try{loading(true);requireConfirmed(form,'pickup');requireConfirmed(form,'delivery');const body=formObject(form);if(body.customer_mode==='registered'&&!body.customer_id)throw new Error('Selecione o cliente cadastrado ou marque cliente avulso.');if(body.payment_method==='credit'&&body.customer_mode!=='registered')throw new Error('Crédito antecipado exige cliente cadastrado.');if(form.elements.payment_status.disabled)body.payment_status='paid';const result=await api('/api/app/v16/base/orders',{method:'POST',body});closeModal();invalidate(baseId);await sound.play('created');toast(`Entrega ${result.item.display_code} criada por ${result.item.launched_by_name}.${result.item.confirmation_code?` Código do cliente: ${result.item.confirmation_code}.`:''}`);if(window.ChegaJaV31?.loadBaseDashboard)await window.ChegaJaV31.loadBaseDashboard(true);else await pages.bases()}catch(e){toast(e.message,'error')}finally{loading(false)}};
    }catch(e){toast(e.message,'error')}finally{loading(false)}
  };

  async function quickEdit(item,baseData){
    if(!item)return;
    try{
      loading(true);
      const baseId=item.base_id||activeBase(),[data,edit]=await Promise.all([apiFormData(baseId),api(`/api/app/v16/base/deliveries/${item.id}/edit-data`)]),x=edit.item||item;
      const customers=data.customers||[],drivers=data.drivers||[],services=data.services||[],selectedServices=edit.service_ids||[];
      openModal(`Edição rápida • ${x.display_code}`,`<form id="v16-quick-edit" class="form-grid v16-order-form">
        <div class="full v16-edit-head"><div><small>Atendente que lançou</small><strong>${esc(x.launched_by_name||x.created_by_name||'Não identificado')}</strong></div><div><small>Total atual</small><strong>${money(x.charge_cents)}</strong></div><div><small>Saldo restante</small><strong>${money(x.outstanding_cents)}</strong></div></div>
        ${customerChooser(customers,x)}
        ${selectField('Cooperado','driver_id',drivers,x.assigned_driver_id||'','Sem cooperado')}
        ${selectField('Status','status',[{id:'new',name:'Nova'},{id:'assigned',name:'Atribuída'},{id:'accepted',name:'Aceita'},{id:'at_pickup',name:'Na coleta'},{id:'in_route',name:'Em rota'},{id:'problem',name:'Problema'},{id:'delivered',name:'Entregue'},{id:'cancelled',name:'Cancelada'}],x.status,'Selecione','required')}
        ${field('Valor base da entrega','charge_value',inputMoney(x.base_charge_cents||x.charge_cents),'number','min="0.01" step="0.01" required')}${field('Valor já pago','paid_value',inputMoney(x.paid_cents),'number','min="0" step="0.01"')}
        ${paymentFields(x)}<div class="full notice" data-credit-note></div>
        ${field('Contato na coleta','pickup_contact_name',x.pickup_contact_name||'')}${field('Telefone da coleta','pickup_phone',x.pickup_phone||'','tel')}
        ${addressExtras('pickup','Coleta — clique, altere e confirme',x)}
        ${field('Quem receberá','recipient_name',x.recipient_name||'')}${field('Telefone de quem recebe','recipient_phone',x.recipient_phone||'','tel')}
        ${addressExtras('delivery','Entrega — clique, altere e confirme',x)}
        ${field('Item / encomenda','item_description',x.item_description||'')}
        <label class="checkbox-row"><input type="checkbox" name="return_required" ${Number(x.return_required||0)===1?'checked':''}> Possui retorno</label><label class="checkbox-row"><input type="checkbox" name="recalculate_charge"> Recalcular valor pela rota e componentes</label>
        <label class="checkbox-row"><input type="checkbox" name="finish_without_code_authorized" ${Number(x.finish_without_code_authorized||0)===1?'checked':''}> Liberar conclusão sem código</label><label class="checkbox-row v16-cancel-charge"><input type="checkbox" name="cancel_after_arrival"> Cancelamento após chegada: cobrar deslocamento configurado</label>
        <section class="full v16-services"><header><strong>Serviços</strong></header>${serviceChecks(services,selectedServices)}</section>
        ${textarea('Observações','notes',x.notes||'')}
        <div class="full v16-finance-summary"><span>Base <strong>${money(x.base_charge_cents||x.charge_cents)}</strong></span><span>Espera <strong>${money(x.wait_charge_cents)}</strong></span><span>Cancelamento <strong>${money(x.cancellation_charge_cents)}</strong></span><span>Pago <strong>${money(x.paid_cents)}</strong></span><span>Restante <strong>${money(x.outstanding_cents)}</strong></span></div>
        ${buttons('Salvar tudo')}
      </form>`);
      const form=$('#v16-quick-edit'),initialPickup=addressSignature(form,'pickup'),initialDelivery=addressSignature(form,'delivery');
      bindCustomerChooser(form,customers,x);bindAddressSearch(form,'pickup',()=>({cooperative_id:state.user.cooperative_id,base_id:baseId}));bindAddressSearch(form,'delivery',()=>({cooperative_id:state.user.cooperative_id,base_id:baseId}));configurePayment(form,customers);
      const statusChange=()=>$('.v16-cancel-charge',form)?.classList.toggle('show',form.elements.status.value==='cancelled');form.elements.status.onchange=statusChange;statusChange();
      form.onsubmit=async event=>{event.preventDefault();try{loading(true);const body=formObject(form),pickupChanged=addressSignature(form,'pickup')!==initialPickup,deliveryChanged=addressSignature(form,'delivery')!==initialDelivery;if(pickupChanged)requireConfirmed(form,'pickup');if(deliveryChanged)requireConfirmed(form,'delivery');body.pickup_confirmation_token=pickupChanged?form.elements.pickup_confirmation_token.value:'';body.delivery_confirmation_token=deliveryChanged?form.elements.delivery_confirmation_token.value:'';if(body.customer_mode==='registered'&&!body.customer_id)throw new Error('Selecione o cliente cadastrado.');if(body.payment_method==='credit'&&body.customer_mode!=='registered')throw new Error('Crédito antecipado exige cliente cadastrado.');if(form.elements.payment_status.disabled)body.payment_status='paid';const result=await api(`/api/app/v16/base/deliveries/${x.id}`,{method:'PUT',body});closeModal();invalidate(baseId);toast(`Entrega atualizada. Total: ${money(result.item.charge_cents)} • Restante: ${money(result.item.outstanding_cents)}.`);if(window.ChegaJaV31?.loadBaseDashboard)await window.ChegaJaV31.loadBaseDashboard(true);else await pages.bases()}catch(e){toast(e.message,'error')}finally{loading(false)}};
    }catch(e){toast(e.message,'error')}finally{loading(false)}
  }

  async function pricingModal(base){
    try{loading(true);const data=await api(`/api/app/v16/base/${base.id}/pricing`),x=data.base||base,services=data.services||[],canEdit=state.user.role==='cooperative_admin';openModal(`Precificação da Base • ${base.name}`,`<div class="v16-pricing"><form id="v16-pricing-form" class="form-grid">
      <div class="full notice"><strong>Regra geral da Base</strong><br>Esses valores entram automaticamente no orçamento ao confirmar os endereços.</div>
      ${field('Taxa mínima','minimum_fee',inputMoney(x.minimum_fee_cents),'number','min="0" step="0.01" required')}${field('Valor por km da rota','rate_per_km',inputMoney(x.rate_per_km_cents),'number','min="0" step="0.01" required')}
      ${field('Moto faz quantos km por litro','fuel_km_per_liter',x.fuel_km_per_liter||35,'number','min="0.1" step="0.1" required')}${field('Preço do litro','fuel_price',inputMoney(x.fuel_price_cents),'number','min="0" step="0.01"')}
      ${field('Deslocamento até a coleta por km','displacement_rate_per_km',inputMoney(x.displacement_rate_cents_per_km),'number','min="0" step="0.01"')}${field('Retorno (% da rota)','return_percent',x.return_percent??50,'number','min="0" step="0.01"')}
      ${field('Cancelamento: multiplicador do deslocamento','cancellation_displacement_multiplier',x.cancellation_displacement_multiplier??2,'number','min="0" step="0.1"')}${field('Valor da espera a cada 15 min','wait_value_15m',inputMoney(x.wait_cents_per_15m||500),'number','min="0" step="0.01"')}
      ${field('Tempo livre na coleta (minutos)','pickup_free_minutes',Number(x.pickup_free_seconds||0)/60,'number','min="0" step="1"')}${field('Tempo livre na entrega (minutos)','delivery_free_minutes',Number(x.delivery_free_seconds||0)/60,'number','min="0" step="1"')}
      ${canEdit?buttons('Salvar precificação'):'<p class="full muted">Somente o administrador da cooperativa altera os valores.</p>'}
    </form>
    <section class="v16-service-pricing"><header><div><h3>Serviços e tempo livre</h3><p>Cartório, Correios, compras e outros podem ter valor e tolerância próprios.</p></div>${canEdit?'<button class="btn primary small" id="v16-new-service">Novo serviço</button>':''}</header><div id="v16-service-list">${services.map(s=>servicePriceCard(base,s,canEdit)).join('')||'<p class="muted">Nenhum serviço cadastrado.</p>'}</div></section></div>`);
      const form=$('#v16-pricing-form');if(canEdit)form.onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/v16/base/${base.id}/pricing`,{method:'PUT',body:formObject(form)});invalidate(base.id);toast('Precificação salva.');closeModal();if(window.ChegaJaV31?.loadBaseDashboard)await window.ChegaJaV31.loadBaseDashboard(true);else await pages.bases()}catch(e){toast(e.message,'error')}finally{loading(false)}};
      if(canEdit){$$('[data-service-price-form]').forEach(serviceForm=>serviceForm.onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/v16/base/${base.id}/services/${serviceForm.dataset.servicePriceForm}`,{method:'PUT',body:formObject(serviceForm)});invalidate(base.id);toast('Serviço atualizado.')}catch(e){toast(e.message,'error')}finally{loading(false)}});$('#v16-new-service').onclick=()=>newServiceModal(base)};
    }catch(e){toast(e.message,'error')}finally{loading(false)}
  }

  function servicePriceCard(base,s,canEdit){return `<form class="v16-service-card" data-service-price-form="${s.id}">${field('Serviço','name',s.name,'text','required')}${field('Valor adicional','add_value',inputMoney(s.add_cents),'number','min="0" step="0.01"')}${field('Tempo livre (minutos)','free_minutes',Number(s.free_wait_seconds||0)/60,'number','min="0" step="1"')}${field('Espera a cada 15 min','wait_value_15m',inputMoney(s.wait_cents_per_15m||500),'number','min="0" step="0.01"')}<label class="checkbox-row"><input type="checkbox" name="wait_tracking_enabled" ${Number(s.wait_tracking_enabled??1)===1?'checked':''}> Ativar cronômetro</label>${canEdit?'<button class="btn small primary" type="submit">Salvar serviço</button>':''}</form>`}

  function newServiceModal(base){openModal(`Novo serviço • ${base.name}`,`<form id="v16-new-service-form" class="form-grid">${field('Nome','name','','text','required')}${field('Valor adicional','add_value','','number','min="0" step="0.01"')}${field('Tempo livre (minutos)','free_minutes','15','number','min="0" step="1"')}${field('Espera a cada 15 min','wait_value_15m','5.00','number','min="0" step="0.01"')}<label class="checkbox-row full"><input type="checkbox" name="wait_tracking_enabled" checked> Ativar cronômetro de espera</label>${textarea('Descrição','description')}${buttons('Cadastrar serviço')}</form>`);$('#v16-new-service-form').onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/v16/base/${base.id}/services`,{method:'POST',body:formObject(event.currentTarget)});invalidate(base.id);toast('Serviço cadastrado.');closeModal();pricingModal(base)}catch(e){toast(e.message,'error')}finally{loading(false)}}}

  async function attendantsModal(base){
    try{
      loading(true);
      const data=await api(`/api/app/v16/base/${base.id}/attendants`),items=data.items||[],available=data.available_users||[],canEdit=state.user.role==='cooperative_admin';
      openModal(`Atendentes da Base • ${base.name}`,`<div class="v16-attendants">
        ${canEdit?`<div class="notice"><strong>Atendente da Base</strong><br>Internamente este acesso usa o perfil Operador, mas só funciona depois de ser vinculado a uma Base nesta tela.</div>
        ${available.length?`<form id="v16-link-attendant-form" class="form-grid"><label class="full">Vincular operador já cadastrado<select name="user_id" required><option value="">Selecione</option>${available.map(user=>`<option value="${esc(user.id)}">${esc(user.name)} • ${esc(user.email)}</option>`).join('')}</select></label>${buttons('Vincular à Base')}</form>`:''}
        <form id="v16-attendant-form" class="form-grid"><div class="full notice">Ou cadastre um novo atendente já vinculado a esta Base.</div>${field('Nome do atendente','name','','text','required')}${field('E-mail de acesso','email','','email','required')}${field('Usuário (opcional)','username')}${field('Senha inicial','password','','password','required minlength="8"')}${buttons('Cadastrar atendente')}</form>`:''}
        <div class="v16-attendant-list">${items.map(a=>`<article><div><strong>${esc(a.name)}</strong><span>${esc(a.email)}</span><small>${a.active?'Ativo':'Inativo'}${a.last_login_at?` • último acesso ${dateTime(a.last_login_at)}`:''}</small></div>${canEdit?`<button class="btn small ${a.active?'danger':''}" data-attendant-toggle="${a.id}" data-active="${a.active?'1':'0'}">${a.active?'Desativar':'Ativar'}</button>`:''}</article>`).join('')||'<p class="muted">Nenhum atendente cadastrado nesta Base.</p>'}</div>
      </div>`);
      if(canEdit){
        $('#v16-link-attendant-form')?.addEventListener('submit',async event=>{event.preventDefault();try{loading(true);await api(`/api/app/v16/base/${base.id}/attendants`,{method:'POST',body:formObject(event.currentTarget)});toast('Operador vinculado à Base.');closeModal();attendantsModal(base)}catch(e){toast(e.message,'error')}finally{loading(false)}});
        $('#v16-attendant-form').onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/v16/base/${base.id}/attendants`,{method:'POST',body:formObject(event.currentTarget)});toast('Atendente cadastrado e vinculado à Base.');closeModal();attendantsModal(base)}catch(e){toast(e.message,'error')}finally{loading(false)}};
        $$('[data-attendant-toggle]').forEach(button=>button.onclick=async()=>{try{loading(true);await api(`/api/app/v16/base/${base.id}/attendants/${button.dataset.attendantToggle}`,{method:'PUT',body:{active:button.dataset.active!=='1'}});closeModal();attendantsModal(base)}catch(e){toast(e.message,'error')}finally{loading(false)}});
      }
    }catch(e){toast(e.message,'error')}finally{loading(false)}
  }

  if(pages.bases){
    const previousBases=pages.bases;
    pages.bases=async function(){
      await previousBases();
      if(!['cooperative_admin','dispatcher'].includes(state.user?.role))return;
      try{
        const baseData=await lgBase(true),base=(baseData.bases||[]).find(x=>x.id===activeBase());if(!base)return;
        const deliveries=await api(`/api/app/tenant/deliveries?base_id=${encodeURIComponent(base.id)}`),items=deliveries.items||[],map=new Map(items.map(x=>[x.id,x]));
        const toolbar=$('#new-base-delivery')?.parentElement;if(toolbar&&!toolbar.querySelector('#v16-pricing-button'))toolbar.insertAdjacentHTML('beforeend',`<button class="btn" id="v16-pricing-button">Precificação</button><button class="btn" id="v16-attendants-button">Atendentes</button>`);
        $('#v16-pricing-button')?.addEventListener('click',()=>pricingModal(base));$('#v16-attendants-button')?.addEventListener('click',()=>attendantsModal(base));
        $$('[data-base-detail]').forEach(detail=>{const item=map.get(detail.dataset.baseDetail),row=detail.closest('tr');if(!item||!row)return;const cells=row.querySelectorAll('td');if(cells[0]&&!cells[0].querySelector('.v16-launched-by'))cells[0].insertAdjacentHTML('beforeend',`<small class="v16-launched-by">Atendente: ${esc(item.launched_by_name||'Não informado')}</small>`);[1,2,3,4,5,6].forEach(index=>{const cell=cells[index];if(!cell)return;cell.classList.add('v16-quick-cell');cell.title='Clique para editar rapidamente';cell.onclick=event=>{if(event.target.closest('button,a,input,select'))return;quickEdit(item,baseData)}});const actions=row.querySelector('.actions');let editButton=actions?.querySelector('[data-base-quick-edit]');if(!editButton&&actions){actions.insertAdjacentHTML('afterbegin',`<button class="table-action primary-action-v15" data-base-quick-edit="${item.id}">Editar rápido</button>`);editButton=actions.querySelector('[data-base-quick-edit]')}if(editButton)editButton.onclick=()=>quickEdit(item,baseData)});
      }catch(e){console.error('Ligerim 10.8: edição rápida',e)}
    };
  }

  function waitPanelHtml(item,delivery){
    if(!item)return `<div class="v16-wait-idle"><strong>Cronômetro de espera</strong><span>Ainda não iniciado.</span></div>`;
    const active=item.status==='active',charging=active?bool(item.charging):Number(item.billed_seconds||0)>0,elapsed=Number(item.elapsed_seconds||0),free=Number(item.free_seconds||0),remaining=Math.max(0,free-elapsed),charge=Number(item.charge_cents||0),stage=item.stage==='pickup'?'Coleta':'Entrega';
    return `<div class="v16-wait-panel ${charging?'charging':'free'}" data-wait-start="${esc(item.started_at||'')}" data-wait-free="${free}" data-wait-rate="${Number(item.rate_cents_per_15m||0)}" data-wait-active="${active?'1':'0'}"><header><span>${charging?'TEMPO SENDO COBRADO':'TEMPO LIVRE'} • ${stage}</span><strong data-wait-clock>${secondsLabel(charging?Math.max(0,elapsed-free):remaining)}</strong></header><div><span>Tempo total: <b data-wait-elapsed>${secondsLabel(elapsed)}</b></span><span>Cobrança: <b data-wait-charge>${money(charge)}</b></span></div></div>`;
  }

  function tickWaitPanels(){
    $$('[data-wait-active="1"]').forEach(panel=>{const start=parseDate(panel.dataset.waitStart);if(!start)return;const elapsed=Math.max(0,Math.floor((Date.now()-start)/1000)),free=Number(panel.dataset.waitFree||0),rate=Number(panel.dataset.waitRate||0),charging=elapsed>free,billed=Math.max(0,elapsed-free),charge=Math.round(billed*rate/900);panel.classList.toggle('charging',charging);panel.classList.toggle('free',!charging);const title=panel.querySelector('header span');if(title)title.textContent=`${charging?'TEMPO SENDO COBRADO':'TEMPO LIVRE'} • ${title.textContent.includes('Entrega')?'Entrega':'Coleta'}`;const clock=panel.querySelector('[data-wait-clock]');if(clock)clock.textContent=secondsLabel(charging?billed:Math.max(0,free-elapsed));const total=panel.querySelector('[data-wait-elapsed]');if(total)total.textContent=secondsLabel(elapsed);const amount=panel.querySelector('[data-wait-charge]');if(amount)amount.textContent=money(charge)})
  }
  if(!v16.tick)v16.tick=setInterval(tickWaitPanels,1000);

  function driverWaitControls(delivery,snapshot){
    const active=snapshot.active,items=snapshot.items||[],pickup=items.some(x=>x.stage==='pickup'),drop=items.some(x=>x.stage==='delivery');
    if(active){const label=active.stage==='pickup'?'COLETADO — ENCERRAR COLETA':'ENCERRAR TEMPO NA ENTREGA';return `${waitPanelHtml(active,snapshot.delivery)}<button class="driver-main-action v16-stop-wait" data-v16-stop-wait="${delivery.id}" data-stage="${active.stage}">${label}</button>`}
    if(!pickup)return `${waitPanelHtml(null,snapshot.delivery)}<button class="driver-main-action v16-arrive" data-v16-arrive="${delivery.id}" data-stage="pickup">CHEGUEI NA COLETA</button>`;
    if(!drop)return `<div class="v16-wait-done">Espera na coleta: <strong>${money(items.filter(x=>x.stage==='pickup').reduce((s,x)=>s+Number(x.charge_cents||0),0))}</strong></div><button class="driver-main-action v16-arrive" data-v16-arrive="${delivery.id}" data-stage="delivery">CHEGUEI NA ENTREGA</button>`;
    return `<div class="v16-wait-done">Espera total: <strong>${money(snapshot.delivery?.wait_charge_cents)}</strong></div>`;
  }

  async function loadDriverWait(delivery){const box=$(`[data-v16-wait="${delivery.id}"]`);if(!box)return;try{const snapshot=await api(`/api/app/v16/deliveries/${delivery.id}/wait`);box.innerHTML=driverWaitControls(delivery,snapshot);$('[data-v16-arrive]',box)?.addEventListener('click',async event=>{const button=event.currentTarget,stage=button?.dataset?.stage;if(!stage)return toast('Não foi possível identificar a etapa da chegada. Atualize a tela e tente novamente.','error');try{button.disabled=true;loading(true);const position=await currentPosition();await api(`/api/app/v16/driver/deliveries/${delivery.id}/arrive`,{method:'POST',body:{stage,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy}});await sound.play('status');toast(stage==='pickup'?'Chegada na coleta registrada. O cronômetro começou automaticamente.':'Chegada na entrega registrada. O cronômetro começou automaticamente.');await loadDriverWait(delivery)}catch(e){toast(e.message,'error');if(button?.isConnected)button.disabled=false}finally{loading(false)}});$('[data-v16-stop-wait]',box)?.addEventListener('click',async event=>{const button=event.currentTarget,stage=button?.dataset?.stage;if(!stage)return toast('Não foi possível identificar a etapa. Atualize a tela e tente novamente.','error');try{button.disabled=true;loading(true);let position=null;try{position=await currentPosition()}catch{}const body={reason:stage==='pickup'?'Coleta concluída pelo cooperado':'Tempo na entrega encerrado pelo cooperado'};if(position){body.latitude=position.coords.latitude;body.longitude=position.coords.longitude}const r=await api(`/api/app/v16/driver/deliveries/${delivery.id}/wait/stop`,{method:'POST',body});toast(stage==='pickup'?`Coleta concluída. Espera: ${money(r.result?.charge_cents)}.`:`Tempo na entrega encerrado. Espera: ${money(r.result?.charge_cents)}.`);await navigate(state.page,false)}catch(e){toast(e.message,'error')}finally{loading(false)}})}catch(e){box.innerHTML=`<div class="address-warning">${esc(e.message)}</div>`}}

  if(typeof driverCard==='function'){
    driverCard=function(delivery,selectable=false){const place=delivery.delivery_type==='base'?(delivery.base_name||'Base'):delivery.establishment_name,pay=[paymentName(delivery.payment_method),delivery.payment_status==='paid'?'Pago':'Pendente',delivery.cash_payment_location==='pickup'?'na coleta':delivery.cash_payment_location==='delivery'?'na entrega':''].filter(Boolean).join(' • ');return `<article class="driver-order-card status-${esc(delivery.status)}"><header>${selectable?`<label class="route-check"><input type="checkbox" data-route-select="${delivery.id}" ${v6.selectedRoute.has(delivery.id)?'checked':''}><span></span></label>`:''}<div><small>${esc(delivery.display_code||'Entrega')}</small><strong>${esc(place||'ChegaJá')}</strong>${delivery.launched_by_name?`<em>Atendente: ${esc(delivery.launched_by_name)}</em>`:''}</div>${badge(delivery.status)}</header><div class="driver-order-money"><span>Você recebe</span><strong>${money(delivery.driver_net_cents||delivery.driver_earnings_cents)}</strong></div><div class="v14-card-charge"><span><small>Valor da entrega</small><strong>${money(delivery.charge_cents)}</strong></span><span><small>Pagamento</small><strong>${esc(pay)}</strong></span></div><div class="driver-address-flow"><div><i>1</i><span><small>Coleta</small><strong>${esc(delivery.pickup_address)}</strong><small>${esc([delivery.pickup_apartment,delivery.pickup_complement].filter(Boolean).join(' • '))}</small></span></div><div><i>2</i><span><small>Entrega</small><strong>${esc(delivery.delivery_address)}</strong><small>${esc([delivery.delivery_apartment,delivery.delivery_complement].filter(Boolean).join(' • '))}</small></span></div></div><div class="driver-order-meta"><span>${km(delivery.distance_meters)}</span><span>${mins(delivery.duration_seconds)}</span><span>${esc(delivery.item_description||'Item não informado')}</span></div>${delivery.delivery_type==='base'&&['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(delivery.status)?`<div class="v16-driver-wait" data-v16-wait="${delivery.id}"><span class="muted">Carregando cronômetro…</span></div>`:''}<div class="driver-order-buttons">${driverStatusButton(delivery)}<button class="driver-secondary-action" data-driver-map="${delivery.id}">Navegar</button><button class="driver-secondary-action" data-driver-detail="${delivery.id}">Detalhes</button><button class="driver-secondary-action" data-driver-chat="${delivery.id}">Chat/Ligar</button></div></article>`};
  }

  if(typeof bindDriverCards==='function'){
    const previousBind=bindDriverCards;bindDriverCards=function(deliveries){previousBind(deliveries);(deliveries||[]).filter(x=>x.delivery_type==='base'&&!['new','offered','assigned','delivered','cancelled'].includes(x.status)).forEach(loadDriverWait)};
  }

  if(typeof driverAction==='function'){
    const previousAction=driverAction;driverAction=async function(delivery,action){if(action!=='complete_v14'||delivery.delivery_type!=='base')return previousAction(delivery,action);const customerDone=Boolean(delivery.customer_confirmed_received_at||delivery.completion_source==='customer'),required=Number(delivery.confirmation_required??1)===1&&!Number(delivery.finish_without_code_authorized||0)&&!customerDone;openModal(`Entregar • ${delivery.display_code}`,`<form id="complete-v16" class="form-grid"><div class="full notice">${customerDone?'O cliente já confirmou o recebimento.':'Informe opcionalmente quem recebeu. O código só será exigido quando a Base não tiver liberado a conclusão sem código.'}</div>${field('Nome de quem recebeu (opcional)','received_by_name')}${required?field('Código de confirmação','confirmation_code','','text','inputmode="numeric" maxlength="4"'):''}${buttons('CONFIRMAR ENTREGA')}</form>`);$('#complete-v16').onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/v16/driver/deliveries/${delivery.id}/complete`,{method:'POST',body:formObject(event.currentTarget)});closeModal();await sound.play('completed');toast('Entrega concluída e lançada nos ganhos.');await navigate(state.page,false)}catch(e){toast(e.message,'error')}finally{loading(false)}}};
  }

  function renderPublicWait(token,snapshot){
    let host=$('#public-wait-v16');if(!host){const details=$('#public-details-v14');if(!details)return;details.insertAdjacentHTML('afterend','<section id="public-wait-v16" class="v16-public-wait"></section>');host=$('#public-wait-v16')}
    const d=snapshot.delivery||{},active=snapshot.active,items=snapshot.items||[],finished=items.filter(x=>x.status==='ended'),waitTotal=Number(d.wait_charge_cents||finished.reduce((s,x)=>s+Number(x.charge_cents||0),0));host.innerHTML=`<div class="v16-public-attendant"><small>Atendimento lançado por</small><strong>${esc(d.launched_by_name||'Equipe da Base')}</strong></div>${active?waitPanelHtml(active,d):`<div class="v16-wait-idle"><strong>Tempo de espera</strong><span>${finished.length?`Cronômetro encerrado • ${money(waitTotal)}`:'O cronômetro começa quando o cooperado marcar a chegada.'}</span></div>`}<div class="v16-public-finance"><span>Valor inicial <strong>${money(d.base_charge_cents)}</strong></span><span>Espera <strong>${money(waitTotal)}</strong></span><span>Já pago <strong>${money(d.paid_cents)}</strong></span><span>Restante <strong>${money(d.outstanding_cents)}</strong></span></div>`;
  }

  async function loadPublicWait(token){try{const snapshot=await api(`/api/public/tracking/${encodeURIComponent(token)}/wait`);renderPublicWait(token,snapshot)}catch(e){console.warn('Cronômetro público indisponível',e)}}
  if(typeof publicTracking==='function'){
    const previousPublic=publicTracking;publicTracking=async function(token){await previousPublic(token);clearInterval(v16.publicWaitPoll);await loadPublicWait(token);v16.publicWaitPoll=setInterval(()=>{if(!document.hidden)loadPublicWait(token)},3000)};
  }

  window.ChegaJaV16={baseOrderForm,quickEdit,pricingModal,attendantsModal,invalidate,apiFormData};

})();


/* ===== ligerim-v17.js ===== */
/* Ligerim 10.9 — correções reais: edição imediata, rastreamento estável, chamadas internas e menu recolhível */
(function(){
  const V={trackingToken:null,statusTimer:null,messageTimer:null,waitTimer:null,incomingTimer:null,appIncomingTimer:null,chatTimer:null,currentConversation:null,currentDelivery:null,lastMessageId:null,voice:null,incomingShown:null};
  const $id=id=>document.getElementById(id);
  const bool=v=>v===true||v===1||v==='1'||v==='true'||v==='on';
  const safeMoney=v=>typeof money==='function'?money(Number(v||0)):`R$ ${(Number(v||0)/100).toFixed(2).replace('.',',')}`;
  const safeDate=v=>typeof dateTime==='function'?dateTime(v):(v||'—');
  const payLabel=v=>({pix:'PIX',dinheiro:'Dinheiro',cash:'Dinheiro',pix_cooperativa:'PIX Cooperativa',credit:'Crédito antecipado',credito:'Crédito antecipado'}[v]||v||'Não informado');
  const statusOptions=[['new','Nova'],['offered','Ofertada'],['assigned','Atribuída'],['accepted','Aceita'],['to_pickup','Indo para coleta'],['at_pickup','Na coleta'],['picked_up','Coletada'],['in_route','Em rota'],['problem','Problema'],['delivered','Entregue'],['cancelled','Cancelada']];
  const activeStatuses=['assigned','accepted','to_pickup','at_pickup','picked_up','in_route','problem'];
  const splitExtra=raw=>{const text=String(raw||'').trim(),m=text.match(/^Bloco:\s*([^•\n]+)(?:\s*•\s*(.*))?$/i);return m?{block:m[1].trim(),complement:(m[2]||'').trim()}:{block:'',complement:text}};
  const secondsLabel=value=>{const n=Math.max(0,Math.floor(Number(value)||0)),h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60;return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`};
  const parseUtc=value=>{if(!value)return 0;const raw=String(value);const d=new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw)?raw:raw.replace(' ','T')+'Z');return Number.isNaN(d.getTime())?0:d.getTime()};

  // Menu lateral: seta abre e fecha as abas de cada seção.
  const previousRenderNav=typeof renderNav==='function'?renderNav:null;
  renderNav=function(){
    if(!state?.user)return;
    if(state.user.role==='driver'&&previousRenderNav){previousRenderNav();return;}
    const groups=navByRole[state.user.role]||[],allowedPage=state.page;
    const storageKey=`ligerim_nav_groups_${state.user.role}`;
    let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{}}catch{}
    const visible=groups.map(([title,pagesList],index)=>({title,index,pages:(pagesList||[]).filter(p=>typeof v8PageAllowed!=='function'||v8PageAllowed(p))})).filter(g=>g.pages.length);
    const current=visible.find(g=>g.pages.includes(allowedPage));
    if(current)saved[current.index]=true;
    const nav=$id('sidebar-nav');if(!nav)return;
    nav.innerHTML=visible.map(g=>{
      const open=saved[g.index]===true||(!Object.keys(saved).length&&g.index===0)||g.pages.includes(allowedPage);
      return `<section class="nav-group-v17 ${open?'open':''}" data-nav-group="${g.index}"><button class="nav-group-toggle-v17" type="button" aria-expanded="${open?'true':'false'}"><span>${esc(g.title)}</span><span class="nav-group-arrow-v17">⌄</span></button><div class="nav-group-items-v17">${g.pages.map(p=>`<button class="nav-item ${state.page===p?'active':''}" data-page="${p}"><span>${pageMeta[p]?.[1]||'•'}</span>${pageMeta[p]?.[0]||p}</button>`).join('')}</div></section>`;
    }).join('');
    nav.querySelectorAll('.nav-group-toggle-v17').forEach(button=>button.onclick=()=>{
      const group=button.closest('.nav-group-v17'),index=group.dataset.navGroup,open=!group.classList.contains('open');
      group.classList.toggle('open',open);button.setAttribute('aria-expanded',String(open));saved[index]=open;localStorage.setItem(storageKey,JSON.stringify(saved));
    });
    nav.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>navigate(button.dataset.page));
  };

  // Acrescenta o nome de quem recebeu no formulário completo de edição rápida.
  const formObserver=new MutationObserver(()=>{
    const form=$id('v16-quick-edit');
    if(!form||form.dataset.v17Prepared)return;
    form.dataset.v17Prepared='1';
    const status=form.elements.status;
    const receiver=document.createElement('label');receiver.className='v17-receiver-field full';receiver.innerHTML='Nome de quem recebeu (opcional)<input name="received_by_name" maxlength="150" placeholder="Ex.: Maria da portaria">';
    const notes=form.elements.notes?.closest('label');(notes||form.querySelector('.form-actions'))?.before(receiver);
    const update=()=>receiver.classList.toggle('show',status?.value==='delivered');
    status?.addEventListener('change',update);update();
    const submit=form.onsubmit;
    if(typeof submit==='function')form.onsubmit=submit;
  });
  formObserver.observe(document.body,{childList:true,subtree:true});


  // Detalhes completos: atendente, pagamento e nome informado por quem concluiu.
  if(typeof deliveryDetail==='function'){
    const previousDeliveryDetail=deliveryDetail;
    deliveryDetail=function(item){
      previousDeliveryDetail(item);
      const root=$id('modal-body');if(!root||!item)return;
      const extra=document.createElement('section');extra.className='v17-detail-extra';
      extra.innerHTML=`<div><small>Atendente que lançou</small><strong>${esc(item.launched_by_name||item.created_by_name||'Não informado')}</strong></div><div><small>Forma de pagamento</small><strong>${esc(payLabel(item.payment_method))}</strong><p>${item.payment_status==='paid'?'Pago':'Pendente'} • já pago ${safeMoney(item.paid_cents)} • restante ${safeMoney(item.outstanding_cents)}</p></div>${item.received_by_name?`<div class="full v17-received-box"><small>Quem recebeu</small><strong>${esc(item.received_by_name)}</strong></div>`:''}`;
      root.appendChild(extra);
    };
  }

  function fullEditPayload(x,serviceIds=[],changes={}){
    const px=splitExtra(x.pickup_complement),dx=splitExtra(x.delivery_complement);
    return {
      customer_mode:x.customer_mode|| (x.customer_id?'registered':'guest'),customer_id:x.customer_id||'',customer_name:x.customer_name||x.recipient_name||'Cliente',customer_phone:x.customer_phone||x.recipient_phone||'',
      driver_id:Object.prototype.hasOwnProperty.call(changes,'driver_id')?changes.driver_id:(x.assigned_driver_id||''),status:changes.status||x.status,
      charge_value:Object.prototype.hasOwnProperty.call(changes,'charge_value')?changes.charge_value:((Number(x.base_charge_cents||x.charge_cents||0)/100).toFixed(2)),
      paid_value:Object.prototype.hasOwnProperty.call(changes,'paid_value')?changes.paid_value:((Number(x.paid_cents||0)/100).toFixed(2)),
      payment_method:changes.payment_method||x.payment_method||'pix',payment_status:changes.payment_status||x.payment_status||'pending',cash_payment_location:x.cash_payment_location||'',
      pickup_contact_name:x.pickup_contact_name||'',pickup_phone:x.pickup_phone||'',pickup_apartment:x.pickup_apartment||'',pickup_block:px.block,pickup_complement:px.complement,
      recipient_name:x.recipient_name||'',recipient_phone:x.recipient_phone||'',delivery_apartment:x.delivery_apartment||'',delivery_block:dx.block,delivery_complement:dx.complement,
      item_description:x.item_description||'',notes:x.notes||'',return_required:bool(x.return_required),finish_without_code_authorized:bool(x.finish_without_code_authorized),service_ids:serviceIds,
      received_by_name:changes.received_by_name||''
    };
  }

  async function saveInlineDelivery(item,changes,row){
    if(!item?.id)return;
    try{
      row?.classList.add('v17-row-saving');
      const edit=await api(`/api/app/v16/base/deliveries/${item.id}/edit-data`),x=edit.item||item;
      const body=fullEditPayload(x,edit.service_ids||[],changes);
      if(body.status==='delivered'&&!body.driver_id)throw new Error('Selecione o cooperado antes de marcar como entregue.');
      const result=await api(`/api/app/v16/base/deliveries/${item.id}`,{method:'PUT',body});
      toast(`Entrega ${x.display_code} atualizada: ${statusText[result.item.status]||result.item.status}.`);
      await pages.bases();
    }catch(error){toast(error.message,'error');row?.classList.remove('v17-row-saving')}
  }

  async function askDelivered(item,row){
    openModal(`Marcar como entregue • ${item.display_code}`,`<form id="v17-deliver-form" class="form-grid"><div class="full notice">A Base pode concluir sem código. Informe opcionalmente quem recebeu.</div>${field('Nome de quem recebeu (opcional)','received_by_name')}${buttons('Marcar como entregue')}</form>`);
    $id('v17-deliver-form').onsubmit=async event=>{event.preventDefault();const name=event.currentTarget.elements.received_by_name.value.trim();closeModal();await saveInlineDelivery(item,{status:'delivered',received_by_name:name},row)};
  }

  if(pages?.bases){
    const previousBases=pages.bases;
    pages.bases=async function(){
      await previousBases();
      if(!['cooperative_admin','dispatcher'].includes(state.user?.role))return;
      const baseId=state.cache.baseViewId||$id('base-view-select')?.value;if(!baseId)return;
      try{
        const [deliveries,formData]=await Promise.all([api(`/api/app/tenant/deliveries${query({base_id:baseId})}`),api(`/api/app/v16/base/delivery-form-data?base_id=${encodeURIComponent(baseId)}`)]),items=deliveries.items||[],map=new Map(items.map(x=>[x.id,x])),drivers=formData.drivers||[];
        document.querySelectorAll('[data-base-detail]').forEach(button=>{
          const item=map.get(button.dataset.baseDetail),row=button.closest('tr');if(!item||!row)return;
          const cells=row.querySelectorAll('td');
          if(cells[4]){
            cells[4].innerHTML=`<select class="v17-inline-select" data-v17-driver="${item.id}" title="Trocar cooperado"><option value="">Sem cooperado</option>${drivers.map(d=>`<option value="${d.id}" ${String(d.id)===String(item.assigned_driver_id)?'selected':''}>${esc(d.name)}</option>`).join('')}</select>`;
            cells[4].querySelector('select').onchange=event=>saveInlineDelivery(item,{driver_id:event.target.value},row);
          }
          if(cells[5]){
            cells[5].innerHTML=`<div class="v17-inline-money-wrap"><input class="v17-inline-money" data-v17-value="${item.id}" type="number" min="0.01" step="0.01" value="${(Number(item.base_charge_cents||item.charge_cents||0)/100).toFixed(2)}"><button class="v17-inline-save" type="button" title="Salvar valor">✓</button></div><div class="v17-inline-payment"><select class="v17-inline-select" data-v17-payment="${item.id}"><option value="pix" ${item.payment_method==='pix'?'selected':''}>PIX</option><option value="dinheiro" ${item.payment_method==='dinheiro'?'selected':''}>Dinheiro</option><option value="pix_cooperativa" ${item.payment_method==='pix_cooperativa'?'selected':''}>PIX Cooperativa</option><option value="credit" ${['credit','credito'].includes(item.payment_method)?'selected':''}>Crédito antecipado</option></select><select class="v17-inline-select" data-v17-paid="${item.id}"><option value="pending" ${item.payment_status!=='paid'?'selected':''}>Pendente</option><option value="paid" ${item.payment_status==='paid'?'selected':''}>Pago</option></select></div>`;
            const input=cells[5].querySelector('input'),save=cells[5].querySelector('button'),payment=cells[5].querySelector('[data-v17-payment]'),paid=cells[5].querySelector('[data-v17-paid]');
            save.onclick=()=>saveInlineDelivery(item,{charge_value:input.value,payment_method:payment.value,payment_status:paid.value,paid_value:paid.value==='paid'?input.value:'0'},row);input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save.click()}};payment.onchange=()=>save.click();paid.onchange=()=>save.click();
          }
          if(cells[6]){
            const closed=['delivered','cancelled'].includes(item.status);cells[6].innerHTML=closed?`${badge(item.status)}${item.received_by_name?`<small class="v17-received-inline">Recebido por: ${esc(item.received_by_name)}</small>`:''}`:`<select class="v17-inline-select" data-v17-status="${item.id}" title="Alterar status">${statusOptions.map(([id,label])=>`<option value="${id}" ${id===item.status?'selected':''}>${label}</option>`).join('')}</select>${item.received_by_name?`<small class="v17-received-inline">Recebido por: ${esc(item.received_by_name)}</small>`:''}`;
            const select=cells[6].querySelector('select');if(select)select.onchange=async event=>{const value=event.target.value;if(value==='delivered')await askDelivered(item,row);else if(value==='cancelled'){if(confirm('Marcar esta entrega como cancelada?'))await saveInlineDelivery(item,{status:value},row);else event.target.value=item.status}else await saveInlineDelivery(item,{status:value},row)};
          }
          const edit=row.querySelector('[data-base-quick-edit]');if(edit){edit.textContent='Editar tudo';edit.title='Editar todos os dados da entrega';edit.classList.add('v17-edit-all')}
          [cells[1],cells[2],cells[3]].forEach(cell=>{if(cell)cell.title='Clique para abrir a edição completa'});
        });
      }catch(error){console.error('Edição imediata da Base indisponível',error);toast(`Não foi possível preparar a edição rápida: ${error.message}`,'error')}
    };
  }

  // Chamada de voz interna pelo navegador (WebRTC), sem abrir aplicativo de telefone.
  const rtcConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};
  function callOverlay(title,status,incoming=false){
    document.querySelector('.v17-call-overlay')?.remove();
    const el=document.createElement('div');el.className='v17-call-overlay';el.innerHTML=`<section class="v17-call-card"><div class="v17-call-icon">☎</div><h2>${esc(title)}</h2><p id="v17-call-subtitle">${esc(status)}</p><audio id="v17-remote-audio" autoplay playsinline></audio><div class="v17-call-status" id="v17-call-status">${esc(status)}</div><div class="v17-call-actions">${incoming?'<button class="btn primary" id="v17-answer-call">Atender</button><button class="btn danger" id="v17-decline-call">Recusar</button>':'<button class="btn" id="v17-mute-call">Silenciar</button><button class="btn danger" id="v17-end-call">Encerrar</button>'}</div></section>`;document.body.appendChild(el);return el;
  }
  function setCallStatus(text){const el=$id('v17-call-status');if(el)el.textContent=text}
  async function mediaStream(){if(!navigator.mediaDevices?.getUserMedia)throw new Error('Este navegador não permite chamada de voz.');return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false})}
  function callApi(ctx,path,options){return ctx.public?api(`/api/public/tracking/${encodeURIComponent(ctx.token)}${path}`,options):api(`/api/app/v15${path}`,options)}
  async function closeVoice(remote=true){
    const voice=V.voice;if(!voice){document.querySelector('.v17-call-overlay')?.remove();return;}
    V.voice=null;clearInterval(voice.pollTimer);clearInterval(voice.candidateTimer);
    if(remote&&voice.callId)try{await callApi(voice.ctx,`/calls/${voice.callId}/end`,{method:'POST',body:{}})}catch{}
    try{voice.pc?.close()}catch{};voice.stream?.getTracks().forEach(t=>t.stop());document.querySelector('.v17-call-overlay')?.remove();
  }
  function attachPeerHandlers(voice){
    voice.pc.ontrack=event=>{const audio=$id('v17-remote-audio');if(audio){audio.srcObject=event.streams[0];audio.play().catch(()=>{})}};
    voice.pc.onconnectionstatechange=()=>{const s=voice.pc.connectionState;if(s==='connected')setCallStatus('Chamada conectada');if(['failed','disconnected','closed'].includes(s)){setCallStatus('Chamada encerrada');setTimeout(()=>closeVoice(false),900)}};
    voice.pc.onicecandidate=event=>{if(!event.candidate)return;const send=async()=>callApi(voice.ctx,`/calls/${voice.callId}/candidates`,{method:'POST',body:{candidate:event.candidate.toJSON()}}).catch(()=>{});if(voice.callId)send();else voice.pendingCandidates.push(event.candidate.toJSON())};
  }
  function startCandidatePoll(voice){voice.candidateTimer=setInterval(async()=>{if(!voice.callId)return;try{const d=await callApi(voice.ctx,`/calls/${voice.callId}/candidates?after=${voice.lastCandidate||0}`);for(const row of d.items||[]){voice.lastCandidate=Math.max(voice.lastCandidate||0,Number(row.id||0));try{await voice.pc.addIceCandidate(JSON.parse(row.candidate_json))}catch{}}}catch{}},700)}
  function bindActiveCallButtons(voice){
    $id('v17-end-call')?.addEventListener('click',()=>closeVoice(true));$id('v17-mute-call')?.addEventListener('click',event=>{voice.muted=!voice.muted;voice.stream?.getAudioTracks().forEach(t=>t.enabled=!voice.muted);event.currentTarget.textContent=voice.muted?'Ativar microfone':'Silenciar'});
  }
  async function startVoiceCall(ctx,deliveryId,conversation,label){
    if(V.voice)return toast('Já existe uma chamada em andamento.','error');
    try{
      callOverlay(`Ligando para ${label}`,'Solicitando acesso ao microfone…');
      const stream=await mediaStream(),pc=new RTCPeerConnection(rtcConfig),voice={ctx,deliveryId,conversation,label,stream,pc,callId:null,pendingCandidates:[],lastCandidate:0,pollTimer:null,candidateTimer:null,muted:false};V.voice=voice;stream.getTracks().forEach(t=>pc.addTrack(t,stream));attachPeerHandlers(voice);bindActiveCallButtons(voice);
      const offer=await pc.createOffer({offerToReceiveAudio:true});await pc.setLocalDescription(offer);setCallStatus('Chamando…');
      const path=ctx.public?'/calls':`/deliveries/${deliveryId}/calls`,created=await callApi(ctx,path,{method:'POST',body:{conversation,offer_sdp:pc.localDescription.sdp}});voice.callId=created.call_id;
      for(const candidate of voice.pendingCandidates.splice(0))await callApi(ctx,`/calls/${voice.callId}/candidates`,{method:'POST',body:{candidate}}).catch(()=>{});startCandidatePoll(voice);
      voice.pollTimer=setInterval(async()=>{try{const d=await callApi(ctx,`/calls/${voice.callId}`),item=d.item;if(item.status==='accepted'&&item.answer_sdp&&!pc.remoteDescription){await pc.setRemoteDescription({type:'answer',sdp:item.answer_sdp});setCallStatus('Chamada conectando…')}else if(['declined','ended','missed'].includes(item.status)){setCallStatus(item.status==='declined'?'Chamada recusada':'Chamada encerrada');setTimeout(()=>closeVoice(false),800)}}catch{}},800);
    }catch(error){await closeVoice(false);toast(error.message,'error')}
  }
  async function acceptIncoming(ctx,call){
    if(V.voice)return;
    try{
      const detail=await callApi(ctx,`/calls/${call.id}`),item=detail.item,overlay=callOverlay(`Chamada de ${item.caller_name||call.caller_name}`,'Conectando chamada…');
      const stream=await mediaStream(),pc=new RTCPeerConnection(rtcConfig),voice={ctx,deliveryId:item.delivery_id,conversation:item.conversation_key,label:item.caller_name,stream,pc,callId:item.id,pendingCandidates:[],lastCandidate:0,pollTimer:null,candidateTimer:null,muted:false};V.voice=voice;stream.getTracks().forEach(t=>pc.addTrack(t,stream));attachPeerHandlers(voice);bindActiveCallButtons(voice);await pc.setRemoteDescription({type:'offer',sdp:item.offer_sdp});const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await callApi(ctx,`/calls/${item.id}/answer`,{method:'POST',body:{answer_sdp:pc.localDescription.sdp}});setCallStatus('Chamada conectando…');startCandidatePoll(voice);
      voice.pollTimer=setInterval(async()=>{try{const d=await callApi(ctx,`/calls/${item.id}`);if(['declined','ended','missed'].includes(d.item.status)){setCallStatus('Chamada encerrada');setTimeout(()=>closeVoice(false),700)}}catch{}},1000);
    }catch(error){await closeVoice(false);toast(error.message,'error')}
  }
  function showIncoming(ctx,call){
    if(V.voice||V.incomingShown===call.id)return;V.incomingShown=call.id;callOverlay(`Chamada de ${call.caller_name||'participante'}`,`Entrega ${call.display_code||''}`,true);if(typeof loudAlert==='function')loudAlert('message');
    $id('v17-answer-call').onclick=async()=>{V.incomingShown=null;await acceptIncoming(ctx,call)};
    $id('v17-decline-call').onclick=async()=>{try{await callApi(ctx,`/calls/${call.id}/decline`,{method:'POST',body:{}})}catch{}V.incomingShown=null;document.querySelector('.v17-call-overlay')?.remove()};
  }
  async function pollAppIncoming(){if(!state?.user||state.user.role==='platform_admin'||V.voice||V.incomingShown)return;try{const d=await api('/api/app/v15/calls/incoming'),call=d.items?.[0];if(call)showIncoming({public:false},call)}catch{}}
  function startAppIncoming(){}
  const oldShowApp=typeof showApp==='function'?showApp:null;if(oldShowApp)showApp=function(){oldShowApp();startAppIncoming();renderNav()};if(state?.user)startAppIncoming();

  // Chat autenticado em conversas separadas e com chamada interna.
  openDeliveryChat=async function(delivery,preferredConversation){
    clearInterval(V.chatTimer);const role=state.user.role,initial=preferredConversation||(role==='driver'?'customer_driver':'customer_place');V.currentDelivery=delivery;V.currentConversation=initial;let latest='';
    const load=async(first=false)=>{
      const d=await api(`/api/app/v15/deliveries/${delivery.id}/chat?conversation=${encodeURIComponent(V.currentConversation)}`),items=d.items||[],last=items.at(-1);if(!first&&latest&&last&&last.id!==latest&&last.sender_type!==d.sender_type){if(typeof window.lgNotifyMessageOnce==='function')window.lgNotifyMessageOnce(last.id,'app');else if(typeof loudAlert==='function')loudAlert('message');}if(last)latest=last.id;
      if(first){
        openModal(`Comunicação • ${delivery.display_code||d.delivery?.display_code||'Entrega'}`,`<div class="v17-chat-modal"><div class="v17-chat-head"><div class="v17-chat-tabs" id="v17-auth-tabs"></div><button class="btn v17-call-button" id="v17-auth-call" type="button">Ligar pelo chat</button></div><div class="v17-chat-messages" id="v17-auth-messages"></div><form class="v17-chat-form" id="v17-auth-form"><input name="message" maxlength="500" placeholder="Digite sua mensagem" required><button class="btn primary">Enviar</button></form><p class="muted" id="v17-auth-closed"></p></div>`);
      }
      const contacts=d.contacts||[],tabs=$id('v17-auth-tabs');if(tabs){tabs.innerHTML=contacts.map(c=>`<button type="button" class="v17-chat-tab ${c.conversation===V.currentConversation?'active':''}" data-conversation="${c.conversation}">${esc(c.label)}</button>`).join('');tabs.querySelectorAll('button').forEach(b=>b.onclick=()=>{V.currentConversation=b.dataset.conversation;load(false).catch(e=>toast(e.message,'error'))})}
      const box=$id('v17-auth-messages');if(box){box.innerHTML=items.map(m=>`<div class="chat-message ${m.sender_type===d.sender_type?'mine':''}"><small>${esc(m.sender_name)} • ${safeDate(m.created_at)}</small><p>${esc(m.message)}</p></div>`).join('')||'<p class="muted">Nenhuma mensagem nesta conversa.</p>';box.scrollTop=box.scrollHeight}
      const form=$id('v17-auth-form'),closed=$id('v17-auth-closed');if(form)form.classList.toggle('hidden',!d.active);if(closed)closed.textContent=d.active?'':'Conversa encerrada: disponível apenas para consulta.';
      const callButton=$id('v17-auth-call'),contact=contacts.find(c=>c.conversation===V.currentConversation);if(callButton){callButton.disabled=!d.active||!contact;callButton.textContent=contact?`Ligar para ${contact.label}`:'Ligação indisponível';callButton.onclick=()=>contact&&startVoiceCall({public:false},delivery.id,V.currentConversation,contact.label)}
      if(form&&!form.dataset.bound){form.dataset.bound='1';form.onsubmit=async event=>{event.preventDefault();const input=event.currentTarget.elements.message,msg=input.value.trim();if(!msg)return;try{await api(`/api/app/v15/deliveries/${delivery.id}/chat`,{method:'POST',body:{conversation:V.currentConversation,message:msg}});input.value='';await load(false)}catch(error){toast(error.message,'error')}}}
      return d;
    };
    try{await load(true);V.chatTimer=setInterval(()=>{if($id('v17-auth-messages')&&!document.hidden)load(false).catch(()=>{});else clearInterval(V.chatTimer)},3500)}catch(error){toast(error.message,'error')}
  };

  function publicWaitHtml(snapshot){
    const d=snapshot?.delivery||{},active=snapshot?.active,items=snapshot?.items||[];
    if(!active){const total=Number(d.wait_charge_cents||items.reduce((s,x)=>s+Number(x.charge_cents||0),0));return `<div class="v17-wait-live ${total?'charging':'free'}"><header><span>${total?'ESPERA ENCERRADA':'TEMPO DE ESPERA'}</span><strong>${safeMoney(total)}</strong></header><p>${items.length?'O tempo foi finalizado.':'O cronômetro começa quando o cooperado registrar a chegada.'}</p></div>`}
    const elapsed=Math.max(0,Math.floor((Date.now()-parseUtc(active.started_at))/1000)),free=Number(active.free_seconds||0),charging=elapsed>free,billed=Math.max(0,elapsed-free),rate=Number(active.rate_cents_per_15m||0),charge=Math.round(billed*rate/900),stage=active.stage==='pickup'?'coleta':'entrega';
    return `<div class="v17-wait-live ${charging?'charging':'free'}" data-v17-public-wait data-start="${esc(active.started_at||'')}" data-free="${free}" data-rate="${rate}" data-stage="${stage}"><header><span>${charging?'TEMPO SENDO COBRADO':'TEMPO LIVRE'} • ${stage}</span><strong data-clock>${secondsLabel(charging?billed:Math.max(0,free-elapsed))}</strong></header><p>Tempo total: <b data-elapsed>${secondsLabel(elapsed)}</b> • Cobrança: <b data-charge>${safeMoney(charge)}</b></p></div>`;
  }
  function tickPublicWait(){const panel=document.querySelector('[data-v17-public-wait]');if(!panel)return;const elapsed=Math.max(0,Math.floor((Date.now()-parseUtc(panel.dataset.start))/1000)),free=Number(panel.dataset.free||0),rate=Number(panel.dataset.rate||0),charging=elapsed>free,billed=Math.max(0,elapsed-free),charge=Math.round(billed*rate/900);panel.classList.toggle('charging',charging);panel.classList.toggle('free',!charging);panel.querySelector('header span').textContent=`${charging?'TEMPO SENDO COBRADO':'TEMPO LIVRE'} • ${panel.dataset.stage}`;panel.querySelector('[data-clock]').textContent=secondsLabel(charging?billed:Math.max(0,free-elapsed));panel.querySelector('[data-elapsed]').textContent=secondsLabel(elapsed);panel.querySelector('[data-charge]').textContent=safeMoney(charge)}
  setInterval(tickPublicWait,1000);

  function buildTracking(){
    const screen=$id('tracking-screen');
    $id('auth-screen')?.classList.add('hidden');$id('app-shell')?.classList.add('hidden');$id('customer-screen')?.classList.add('hidden');screen.classList.remove('hidden');
    screen.innerHTML=`<div class="v17-tracking-card"><header class="v17-tracking-head" id="v17-track-head"><div class="tracking-brand"><img src="/icons/icon-official.png" alt=""><div><p class="eyebrow">ChegaJá</p><h1>Carregando entrega…</h1></div></div></header><main class="v17-tracking-body"><div class="address-warning v17-error" id="v17-track-error"></div><section class="v17-address-grid" id="v17-track-addresses"></section><section id="v17-track-details"></section><section class="tracking-timeline" id="v17-track-timeline"></section><section><div id="v17-track-map" class="map small"></div><p class="v17-map-status" id="v17-map-status"></p></section><section class="v17-info-grid" id="v17-track-info"></section><section id="v17-track-wait"></section><section class="v17-finance-grid" id="v17-track-finance"></section><section class="v17-public-actions" id="v17-track-actions"></section><section class="v17-chat"><header class="v17-chat-head"><div class="v17-chat-tabs" id="v17-public-tabs"></div><div><button class="btn small" id="v17-public-sound" type="button">Ativar som</button> <button class="btn v17-call-button" id="v17-public-call" type="button">Ligar pelo chat</button></div></header><div class="v17-chat-messages" id="v17-public-messages"></div><form class="v17-chat-form" id="v17-public-form"><input name="message" maxlength="500" placeholder="Digite sua mensagem" required><button class="btn primary">Enviar</button></form><p class="muted" id="v17-public-closed"></p></section></main></div>`;
    $id('v17-public-sound').onclick=async()=>{try{await sound.unlock();await sound.play('message');$id('v17-public-sound').textContent='Som ativado'}catch{if(typeof loudAlert==='function')loudAlert('message')}};
  }
  function trackingError(message){const box=$id('v17-track-error');if(!box)return;box.textContent=`Não foi possível atualizar agora: ${message}. A tela continuará aberta e tentará novamente.`;box.classList.add('show');setTimeout(()=>box?.classList.remove('show'),5000)}
  async function loadTrackingStatus(token){
    try{
      const d=await api(`/api/public/tracking/${encodeURIComponent(token)}`),x=d.item;V.currentDelivery=x;document.documentElement.style.setProperty('--primary',x.primary_color||'#721536');
      const head=$id('v17-track-head');if(head)head.innerHTML=`<div class="tracking-brand"><img src="${esc(x.logo_url||'/icons/icon-official.png')}" alt=""><div><p class="eyebrow">${esc(x.cooperative_name||'ChegaJá')}</p><h1>${esc(x.display_code||'Sua entrega')}</h1><p>${esc(x.base_name||x.establishment_name||'')}</p></div></div>${badge(x.status)}`;
      const addresses=$id('v17-track-addresses');if(addresses)addresses.innerHTML=`<article class="v17-address-card"><small>Coleta</small><strong>${esc(x.pickup_address||'')}</strong><span>${esc([x.pickup_apartment,x.pickup_complement].filter(Boolean).join(' • '))}</span></article><article class="v17-address-card"><small>Entrega</small><strong>${esc(x.delivery_address||'')}</strong><span>${esc([x.delivery_apartment,x.delivery_complement].filter(Boolean).join(' • '))}</span></article>`;
      const details=$id('v17-track-details');if(details)details.innerHTML=`<div class="v14-public-details">${x.confirmation_code?`<div class="v23-confirmation-code"><small>CÓDIGO DE CONFIRMAÇÃO</small><strong>${esc(x.confirmation_code)}</strong><span>Informe ao cooperado somente depois que receber o pedido.</span></div>`:`<div class="v23-confirmation-code optional"><small>CONFIRMAÇÃO</small><strong>SEM CÓDIGO</strong><span>A Base liberou esta entrega sem código.</span></div>`}<p><strong>Item:</strong> ${esc(x.item_description||'Não informado')}</p><p><strong>Observações:</strong> ${esc(x.notes||'Sem observações')}</p><p><strong>Atendente:</strong> ${esc(x.launched_by_name||'Equipe responsável')}</p>${x.received_by_name?`<div class="v17-received-box">Entrega recebida por: ${esc(x.received_by_name)}</div>`:''}</div>`;
      const steps=['assigned','accepted','to_pickup','at_pickup','picked_up','in_route','delivered'],index=steps.indexOf(x.status),timeline=$id('v17-track-timeline');if(timeline)timeline.innerHTML=steps.map((s,i)=>`<div class="tracking-step ${i<=index?'done':''}"><span class="step-dot"></span><div><strong>${statusText[s]||s}</strong>${i===index?'<small>Status atual</small>':''}</div></div>`).join('');
      const info=$id('v17-track-info');if(info)info.innerHTML=`<article class="v17-info-card"><small>Cooperado</small><strong>${esc(x.driver_name||'Aguardando')}</strong></article><article class="v17-info-card"><small>Distância e previsão</small><strong>${typeof km==='function'?km(x.distance_meters):''} • ${typeof mins==='function'?mins(x.duration_seconds):''}</strong></article><article class="v17-info-card"><small>Atendimento lançado por</small><strong>${esc(x.launched_by_name||'Equipe responsável')}</strong></article><article class="v17-info-card"><small>Atualizado</small><strong>${safeDate(x.location_updated_at||x.updated_at)}</strong></article>`;
      const finance=$id('v17-track-finance');if(finance)finance.innerHTML=`<article class="v17-finance-card"><small>Valor inicial</small><strong>${safeMoney(x.base_charge_cents||x.charge_cents)}</strong></article><article class="v17-finance-card"><small>Espera/adicionais</small><strong>${safeMoney(x.wait_charge_cents)}</strong></article><article class="v17-finance-card"><small>Já pago</small><strong>${safeMoney(x.paid_cents)}</strong></article><article class="v17-finance-card"><small>Saldo restante</small><strong>${safeMoney(x.outstanding_cents)}</strong></article>`;
      const actions=$id('v17-track-actions');if(actions){actions.innerHTML=activeStatuses.includes(x.status)?'<button class="btn primary" id="v17-received">Recebi o pedido</button>':'';$id('v17-received')?.addEventListener('click',async()=>{if(!confirm('Confirmar que você recebeu o pedido?'))return;try{await api(`/api/public/tracking/${encodeURIComponent(token)}/received`,{method:'POST',body:{name:x.customer_name||''}});toast('Recebimento confirmado.');await loadTrackingStatus(token)}catch(error){toast(error.message,'error')}})}
      const mapHost=$id('v17-track-map'),mapStatus=$id('v17-map-status');if(mapHost){try{const fresh=mapHost.cloneNode(false);mapHost.replaceWith(fresh);renderLineMap('v17-track-map',parseGeometry(x.route_geometry),[{lat:x.pickup_lat,lng:x.pickup_lng,label:'Coleta'},{lat:x.delivery_lat,lng:x.delivery_lng,label:'Entrega'},{lat:x.driver_lat,lng:x.driver_lng,label:x.driver_name||'Cooperado'}]);if(mapStatus)mapStatus.textContent=x.driver_lat!=null?'Localização do cooperado atualizada automaticamente.':'O mapa da rota continua disponível; a localização do cooperado aparecerá durante a entrega.'}catch(error){if(mapStatus)mapStatus.textContent=`Mapa temporariamente indisponível: ${error.message}`}}
      const form=$id('v17-public-form'),closed=$id('v17-public-closed'),active=!['delivered','cancelled'].includes(x.status)&&x.customer_chat_enabled;if(form)form.classList.toggle('hidden',!active);if(closed)closed.textContent=active?'':'Conversa encerrada: o histórico continua disponível.';
      return x;
    }catch(error){trackingError(error.message);throw error}
  }
  async function loadPublicMessages(token,notify=false){
    try{
      const conversation=V.currentConversation||'customer_place',d=await api(`/api/public/tracking/${encodeURIComponent(token)}/messages?conversation=${encodeURIComponent(conversation)}`),items=d.items||[],last=items.at(-1);if(notify&&V.lastMessageId&&last&&last.id!==V.lastMessageId&&last.sender_type!=='customer'){if(typeof window.lgNotifyMessageOnce==='function')window.lgNotifyMessageOnce(last.id,`public_${token}`);else if(typeof loudAlert==='function')loudAlert('message');}if(last)V.lastMessageId=last.id;
      const tabs=$id('v17-public-tabs');if(tabs){tabs.innerHTML=(d.contacts||[]).map(c=>`<button type="button" class="v17-chat-tab ${c.conversation===conversation?'active':''}" data-conversation="${c.conversation}">${esc(c.label)}</button>`).join('');tabs.querySelectorAll('button').forEach(b=>b.onclick=()=>{V.currentConversation=b.dataset.conversation;loadPublicMessages(token,false)})}
      const box=$id('v17-public-messages');if(box){box.innerHTML=items.map(m=>`<div class="chat-message ${m.sender_type==='customer'?'mine':''}"><small>${esc(m.sender_name)} • ${safeDate(m.created_at)}</small><p>${esc(m.message)}</p></div>`).join('')||'<p class="muted">Nenhuma mensagem nesta conversa.</p>';box.scrollTop=box.scrollHeight}
      const contact=(d.contacts||[]).find(c=>c.conversation===conversation),callButton=$id('v17-public-call');if(callButton){callButton.disabled=!d.active||!contact;callButton.textContent=contact?`Ligar para ${contact.label}`:'Ligação indisponível';callButton.onclick=()=>contact&&startVoiceCall({public:true,token},V.currentDelivery?.id,conversation,contact.label)}
      const form=$id('v17-public-form');if(form&&!form.dataset.bound){form.dataset.bound='1';form.onsubmit=async event=>{event.preventDefault();const input=event.currentTarget.elements.message,msg=input.value.trim();if(!msg)return;try{await api(`/api/public/tracking/${encodeURIComponent(token)}/messages`,{method:'POST',body:{conversation:V.currentConversation||'customer_place',message:msg}});input.value='';await loadPublicMessages(token,false)}catch(error){toast(error.message,'error')}}}
    }catch(error){trackingError(error.message)}
  }
  async function loadPublicWait(token){try{const d=await api(`/api/public/tracking/${encodeURIComponent(token)}/wait`),box=$id('v17-track-wait');if(box)box.innerHTML=publicWaitHtml(d)}catch(error){console.warn('Cronômetro indisponível',error)}}
  async function pollPublicIncoming(token){if(V.voice||V.incomingShown)return;try{const d=await api(`/api/public/tracking/${encodeURIComponent(token)}/calls/incoming`),call=d.items?.[0];if(call)showIncoming({public:true,token},call)}catch{}}

  publicTracking=async function(token){
    if(V.trackingToken===token&&$id('v17-track-head'))return;V.trackingToken=token;V.currentConversation='customer_place';V.lastMessageId=null;clearInterval(V.statusTimer);clearInterval(V.messageTimer);clearInterval(V.waitTimer);clearInterval(V.incomingTimer);buildTracking();
    await Promise.allSettled([loadTrackingStatus(token),loadPublicMessages(token,false),loadPublicWait(token)]);
    V.statusTimer=setInterval(()=>{if(!document.hidden)loadTrackingStatus(token).catch(()=>{})},12000);V.messageTimer=setInterval(()=>{if(!document.hidden)loadPublicMessages(token,true)},5000);V.waitTimer=setInterval(()=>{if(!document.hidden)loadPublicWait(token)},5000);V.incomingTimer=null;
  };

})();


/* ===== ligerim-v18.js ===== */
/* Ligerim 11.0 — inicialização única após todos os módulos */
(function(){
  let started=false;
  function blockExternalPhoneLinks(root=document){
    root.querySelectorAll?.('a[href^="tel:"]').forEach(link=>{
      const button=document.createElement('button');button.type='button';button.className=link.className||'btn';button.textContent='Ligar pelo chat';button.addEventListener('click',()=>toast('Abra a conversa correta e use “Ligar pelo chat”.','error'));link.replaceWith(button);
    });
  }
  const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)blockExternalPhoneLinks(node)})));
  observer.observe(document.documentElement,{childList:true,subtree:true});blockExternalPhoneLinks();
  function start(){if(started)return;started=true;Promise.resolve(init()).catch(error=>{console.error('Falha ao iniciar o ChegaJá',error);const login=document.getElementById('login-message');if(login)login.textContent=error?.message||'Não foi possível iniciar o sistema.'})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else queueMicrotask(start);
})();


/* ===== ligerim-v19.js ===== */
(function(){
  function ensureTopNav(){
    const appBody=document.querySelector('.app-body');
    const topbar=document.querySelector('.topbar');
    if(!appBody||!topbar)return null;
    let nav=document.getElementById('top-nav');
    if(!nav){
      nav=document.createElement('nav');
      nav.id='top-nav';
      nav.className='top-nav hidden';
      topbar.insertAdjacentElement('afterend',nav);
    }
    return nav;
  }

  function closeTopMenus(except=null){
    document.querySelectorAll('.top-nav-group.open').forEach(group=>{
      if(group!==except)group.classList.remove('open');
    });
  }

  function bindTopNav(nav){
    nav.querySelectorAll('.top-nav-trigger').forEach(trigger=>{
      trigger.setAttribute('aria-haspopup','true');
      trigger.setAttribute('aria-expanded','false');
      trigger.onclick=event=>{
        event.preventDefault();
        event.stopPropagation();
        const group=trigger.closest('.top-nav-group');
        const willOpen=!group.classList.contains('open');
        closeTopMenus(group);
        group.classList.toggle('open',willOpen);
        trigger.setAttribute('aria-expanded',willOpen?'true':'false');
      };
      trigger.onkeydown=event=>{
        if(event.key==='Escape'){
          trigger.closest('.top-nav-group')?.classList.remove('open');
          trigger.setAttribute('aria-expanded','false');
          trigger.focus();
        }
      };
    });
    nav.querySelectorAll('[data-top-page]').forEach(button=>{
      button.onclick=event=>{
        event.preventDefault();
        closeTopMenus();
        navigate(button.dataset.topPage);
      };
    });
  }

  document.addEventListener('click',event=>{
    if(!event.target.closest('#top-nav'))closeTopMenus();
  });
  window.addEventListener('resize',()=>closeTopMenus());

  const originalRenderNav=typeof renderNav==='function'?renderNav:null;
  if(originalRenderNav){
    renderNav=function(){
      originalRenderNav();
      const topNav=ensureTopNav();
      if(!topNav||!state?.user)return;
      const useTop=state.user.role==='cooperative_admin';
      document.body.classList.toggle('role-topnav',useTop);
      topNav.classList.toggle('hidden',!useTop);
      if(!useTop){topNav.innerHTML='';return;}
      const groups=navByRole[state.user.role]||[];
      topNav.innerHTML=groups.map(([group,pages])=>`<div class="top-nav-group"><button class="top-nav-trigger" type="button">${esc(group)}</button><div class="top-nav-dropdown">${pages.map(page=>`<button class="top-nav-item ${state.page===page?'active':''}" type="button" data-top-page="${page}">${esc(pageMeta[page]?.[0]||page)}</button>`).join('')}</div></div>`).join('');
      bindTopNav(topNav);
    };
  }

  if(pages?.bases){
    const previousBases=pages.bases;
    pages.bases=async function(){
      await previousBases();
      const deliveryPanel=[...document.querySelectorAll('#page-content .panel')].find(panel=>panel.querySelector('[data-base-detail]'));
      if(deliveryPanel)deliveryPanel.classList.add('v19-base-panel');
    };
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureTopNav,{once:true});
  else ensureTopNav();
})();


/* ===== ligerim-v20.js ===== */
(function(){
  const V20={lastMessageToastAt:0,lastMessageToastText:'',topButtonsTimer:null};

  // impedir o quadrinho verde repetido a todo momento
  if(typeof toast==='function'){
    const originalToast=toast;
    toast=function(message,type='success',...rest){
      const text=String(message||'').trim();
      const now=Date.now();
      if(text==='Você recebeu uma nova mensagem.'){
        if(V20.lastMessageToastText===text && now-V20.lastMessageToastAt<30000) return;
        V20.lastMessageToastText=text;V20.lastMessageToastAt=now;
      }
      return originalToast.call(this,message,type,...rest);
    };
  }

  function removeCallUi(root=document){
    root.querySelectorAll('.v17-call-button,#v17-auth-call,#v17-public-call').forEach(el=>el.remove());
    root.querySelectorAll('button, a').forEach(el=>{
      const text=(el.textContent||'').trim();
      if(text==='Chat/Ligar') el.textContent='Chat';
      if(/ligar pelo chat/i.test(text)) el.remove();
    });
    root.querySelectorAll('.privacy-mini').forEach(el=>{ if(/Ligação interna/i.test(el.textContent||'')) el.remove(); });
  }

  function closeAllTopMenus(){
    document.querySelectorAll('.top-nav-group.open').forEach(group=>group.classList.remove('open'));
    document.querySelectorAll('.top-nav-trigger[aria-expanded="true"]').forEach(btn=>btn.setAttribute('aria-expanded','false'));
  }

  function improveTopMenu(){
    const nav=document.getElementById('top-nav');
    if(!nav) return;
    nav.querySelectorAll('.top-nav-group').forEach(group=>{
      const trigger=group.querySelector('.top-nav-trigger');
      if(!trigger || trigger.dataset.v20Bound==='1') return;
      trigger.dataset.v20Bound='1';
      trigger.onclick=event=>{
        event.preventDefault();event.stopPropagation();
        const willOpen=!group.classList.contains('open');
        closeAllTopMenus();
        group.classList.toggle('open',willOpen);
        trigger.setAttribute('aria-expanded',willOpen?'true':'false');
      };
      group.addEventListener('mouseenter',()=>{
        closeAllTopMenus();group.classList.add('open');trigger.setAttribute('aria-expanded','true');
      });
      group.addEventListener('mouseleave',()=>{
        group.classList.remove('open');trigger.setAttribute('aria-expanded','false');
      });
    });
  }

  document.addEventListener('click',event=>{ if(!event.target.closest('#top-nav')) closeAllTopMenus(); });

  async function openAttendantsManager(){
    try{
      await navigate('bases');
      const baseId=state.cache.baseViewId;
      if(!baseId) return toast('Nenhuma Base cadastrada.','error');
      const [baseResp,data]=await Promise.all([api('/api/app/tenant/bases'),api(`/api/app/v16/base/${baseId}/attendants`)]);
      const base=(baseResp.items||[]).find(x=>x.id===baseId);
      const items=data.items||[];
      openModal(`Atendentes da Base • ${base?.name||'Base'}`,`<div class="v20-attendants"><div class="notice full">Gerencie aqui os atendentes da Base. Para trocar de atendente, use <strong>Sair</strong> e entre com o outro acesso.</div><div class="v16-attendant-list">${items.map(a=>`<article><div><strong>${esc(a.name)}</strong><span>${esc(a.email)}</span><small>${a.active?'Ativo':'Inativo'}${a.last_login_at?` • último acesso ${dateTime(a.last_login_at)}`:''}</small></div><button class="btn small ${a.active?'danger':''}" data-v20-toggle-att="${a.id}" data-active="${a.active?'1':'0'}">${a.active?'Desativar':'Ativar'}</button></article>`).join('')||'<p class="muted">Nenhum atendente cadastrado.</p>'}</div></div>`);
      document.querySelectorAll('[data-v20-toggle-att]').forEach(button=>button.onclick=async()=>{
        try{loading(true);await api(`/api/app/v16/base/${baseId}/attendants/${button.dataset.v20ToggleAtt}`,{method:'PUT',body:{active:button.dataset.active!=='1'}});closeModal();openAttendantsManager();}
        catch(error){toast(error.message,'error')}finally{loading(false)}
      });
    }catch(error){toast(error.message,'error')}
  }

  function ensureTopbarButtons(){}

  function bindAll(){
    removeCallUi(document);
    improveTopMenu();
    ensureTopbarButtons();
  }

  const observer=new MutationObserver(()=>bindAll());
  if(document.body) observer.observe(document.body,{childList:true,subtree:true});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bindAll,{once:true});
  else bindAll();
})();


/* ===== ligerim-v21.js ===== */
(function(){
  const V21={sosTimer:null,lastSosId:localStorage.getItem('lg_last_sos_id')||''};
  const activeDeliveryStatuses=['assigned','accepted','to_pickup','at_pickup','picked_up','in_route','problem'];

  function setTopActions(){
    const user=state?.user,logoutButton=document.getElementById('v21-logout'),switchButton=document.getElementById('v21-switch-attendant'),attendantsButton=document.getElementById('v21-attendants');
    if(!user){logoutButton?.classList.add('hidden');switchButton?.classList.add('hidden');attendantsButton?.classList.add('hidden');return;}
    logoutButton?.classList.remove('hidden');
    const baseRole=['cooperative_admin','dispatcher'].includes(user.role);
    switchButton?.classList.toggle('hidden',!baseRole);attendantsButton?.classList.toggle('hidden',!baseRole);
  }

  document.getElementById('v21-logout')?.addEventListener('click',()=>logout());
  document.getElementById('v21-switch-attendant')?.addEventListener('click',()=>{
    if(!confirm('Sair deste atendente e voltar à tela de acesso?'))return;
    logout(false);showAuth('login');
    const login=document.querySelector('#login-form input[name="login"]');if(login){login.value='';login.focus()}
  });
  document.getElementById('v21-attendants')?.addEventListener('click',async()=>{
    await navigate('bases');
    setTimeout(()=>{
      const button=document.getElementById('v16-attendants-button');
      if(button)button.click();else toast('Cadastre ou selecione uma Base para gerenciar os atendentes.','error');
    },250);
  });

  function currentPosition(){return new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error('Este aparelho não disponibilizou a localização.'));
    navigator.geolocation.getCurrentPosition(resolve,()=>reject(new Error('Ative a localização para enviar o pedido de socorro.')),{enableHighAccuracy:true,timeout:20000,maximumAge:0});
  })}

  function openSosForm(deliveryId){
    openModal('PEDIDO DE SOCORRO',`<form id="v21-sos-form" class="form-grid"><div class="full notice" style="border-color:#fecaca;background:#fff1f2;color:#991b1b"><strong>Este alerta será enviado para a Base e para os cooperados online.</strong><br>Sua localização atual será anexada automaticamente.</div>${textarea('Explique o ocorrido','occurrence','','required maxlength="800" placeholder="Ex.: pneu furou, acidente sem feridos, moto apresentou problema..."')}${buttons('ENVIAR SOCORRO')}</form>`);
    const form=document.getElementById('v21-sos-form');if(!form)return;
    form.onsubmit=async event=>{
      event.preventDefault();
      try{
        loading(true);const position=await currentPosition();
        await api(`/api/app/v15/driver/deliveries/${deliveryId}/sos`,{method:'POST',body:{occurrence:form.elements.occurrence.value,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy}});
        closeModal();toast('Pedido de socorro enviado. A Base recebeu sua localização.');
      }catch(error){toast(error.message,'error')}finally{loading(false)}
    };
  }

  function addSosButtons(){
    if(state?.user?.role!=='driver')return;
    document.querySelectorAll('.driver-order-card').forEach(card=>{
      if(card.querySelector('.driver-sos-button'))return;
      const detail=card.querySelector('[data-driver-detail]'),statusClass=[...card.classList].find(x=>x.startsWith('status-'))||'',status=statusClass.replace('status-','');
      if(!detail||!activeDeliveryStatuses.includes(status))return;
      const deliveryId=detail.dataset.driverDetail,buttons=card.querySelector('.driver-order-buttons');if(!deliveryId||!buttons)return;
      const sos=document.createElement('button');sos.type='button';sos.className='driver-secondary-action driver-sos-button';sos.textContent='SOCORRO';sos.onclick=()=>openSosForm(deliveryId);buttons.appendChild(sos);
    });
  }

  function ensureSosStack(){let stack=document.getElementById('v21-sos-stack');if(stack)return stack;stack=document.createElement('section');stack.id='v21-sos-stack';stack.className='v21-sos-stack';document.body.appendChild(stack);return stack}
  async function pollSos(){
    const user=state?.user;if(!user||!['cooperative_admin','dispatcher','driver'].includes(user.role))return;
    try{
      const d=await api('/api/app/v15/sos/active'),items=d.items||[],stack=ensureSosStack();
      stack.innerHTML=items.map(item=>`<article class="v21-sos-card"><header><h3>🚨 PEDIDO DE SOCORRO</h3><strong>${esc(item.driver_name)}</strong></header><p>${esc(item.occurrence)}</p><small>Entrega ${esc(item.display_code||'')} • ${dateTime(item.created_at)}</small><div class="v21-sos-actions"><button class="btn danger" data-v21-sos-help="${item.id}">IR AJUDAR</button></div></article>`).join('');
      if(items[0]?.id&&items[0].id!==V21.lastSosId){V21.lastSosId=items[0].id;localStorage.setItem('lg_last_sos_id',items[0].id);if(typeof sound!=='undefined')sound.play('problem').catch(()=>{});}
      stack.querySelectorAll('[data-v21-sos-help]').forEach(button=>button.onclick=async()=>{
        const helperWindow=window.open('about:blank','_blank');
        try{
          button.disabled=true;button.textContent='RESERVANDO AJUDA…';
          const result=await api(`/api/app/v15/sos/${button.dataset.v21SosHelp}/help`,{method:'POST',body:{}});
          toast('Você vai ajudar. O socorro foi retirado para os demais.');
          stack.innerHTML='';
          if(helperWindow)helperWindow.location.href=result.navigation_url;else window.location.href=result.navigation_url;
          pollSos();
        }catch(error){
          try{helperWindow?.close()}catch{}
          toast(error.message,'error');pollSos();
        }
      });
    }catch{}
  }

  function startSosPolling(){return}
  function bind(){setTopActions();addSosButtons();if(state?.user)startSosPolling()}
  const observer=new MutationObserver(bind);observer.observe(document.body,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();


/* ===== ligerim-v22.js ===== */
(function(){
  const button=document.getElementById('show-login-password');
  const input=document.querySelector('#login-form input[name="password"]');
  if(button&&input){
    button.addEventListener('click',()=>{
      const visible=input.type==='text';
      input.type=visible?'password':'text';
      button.textContent=visible?'Mostrar':'Ocultar';
      input.focus();
    });
  }

  const form=document.getElementById('login-form');
  const message=document.getElementById('login-message');
  if(form&&message){
    form.addEventListener('submit',()=>{
      message.textContent='';
    },true);
  }
})();


/* ===== ligerim-v23.js ===== */
(function(){
  const METHODS=[
    ['pix','PIX'],
    ['dinheiro','Dinheiro'],
    ['pix_cooperativa','PIX Cooperativa'],
    ['credit','Crédito antecipado']
  ];
  function normalizePaymentSelect(select){
    if(!select||select.dataset.v23Payment==='1')return;
    const previous=['credito','credito_antecipado'].includes(select.value)?'credit':select.value==='faturado'?'pix':select.value;
    select.innerHTML=METHODS.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
    select.value=METHODS.some(([value])=>value===previous)?previous:'pix';
    select.dataset.v23Payment='1';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function enhance(root=document){
    root.querySelectorAll('select[name="payment_method"]').forEach(normalizePaymentSelect);
    root.querySelectorAll('[data-credit-note]').forEach(box=>{
      if(!box.querySelector('.v23-payment-note')){
        box.insertAdjacentHTML('beforeend','<div class="v23-payment-note"><strong>INSS e SEST/SENAT:</strong> somente nas entregas da Base pagas por PIX Cooperativa ou Crédito antecipado.</div>');
      }
    });
  }
  const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)enhance(node)})));
  if(document.body)observer.observe(document.body,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>enhance(),{once:true});else enhance();
})();


/* ===== ligerim-v24.js ===== */
/* Rapidim 12.2 — sons reforçados e sirene exclusiva de socorro */
(function(){
  let context=null;
  function audio(){
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
    context=context||new AC();if(context.state==='suspended')context.resume().catch(()=>{});return context;
  }
  function tone(ctx,start,freq,duration=.28,gain=.72,type='square'){
    const osc=ctx.createOscillator(),amp=ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,start);amp.gain.setValueAtTime(.0001,start);amp.gain.exponentialRampToValueAtTime(gain,start+.025);amp.gain.exponentialRampToValueAtTime(.0001,start+duration);osc.connect(amp);amp.connect(ctx.destination);osc.start(start);osc.stop(start+duration+.03);
  }
  function siren(ctx){
    const start=ctx.currentTime+.03;
    for(let cycle=0;cycle<4;cycle++){
      const t=start+cycle*1.05,osc=ctx.createOscillator(),amp=ctx.createGain();osc.type='sawtooth';osc.frequency.setValueAtTime(520,t);osc.frequency.linearRampToValueAtTime(1180,t+.5);osc.frequency.linearRampToValueAtTime(520,t+1);amp.gain.setValueAtTime(.0001,t);amp.gain.exponentialRampToValueAtTime(.86,t+.03);amp.gain.setValueAtTime(.86,t+.94);amp.gain.exponentialRampToValueAtTime(.0001,t+1);osc.connect(amp);amp.connect(ctx.destination);osc.start(t);osc.stop(t+1.02);
    }
    navigator.vibrate?.([700,120,700,120,900,120,900]);
  }
  async function strongSound(type){
    const ctx=audio();if(!ctx)return;
    const start=ctx.currentTime+.03;
    if(type==='problem'||type==='sos'){siren(ctx);return;}
    const patterns={
      message:[[880,0],[1180,.17],[880,.36]],
      new_order:[[620,0],[820,.17],[1040,.34],[1260,.54]],
      assigned:[[740,0],[980,.2],[1220,.4]],
      accepted:[[660,0],[880,.2],[1100,.4]],
      completed:[[820,0],[1040,.2],[1320,.42]],
      status:[[720,0],[980,.22]],
      online:[[720,0],[960,.22],[1200,.44]],
      offline:[[900,0],[650,.24]]
    };
    (patterns[type]||patterns.status).forEach(([freq,delay],i)=>tone(ctx,start+delay,freq,.24,i===0?.78:.7));
    navigator.vibrate?.(type==='message'?[220,90,220]:[260,100,320]);
  }
  document.addEventListener('pointerdown',audio,{once:true});
  if(typeof sound!=='undefined'&&sound)sound.play=strongSound;
  window.rapidimStrongSound=strongSound;
})();


/* ===== ligerim-v25.js ===== */
/* Rapidim 12.3 — fila persistente, numerada e ordenável */
(function(){
  const V25={dragged:null};
  function gps(){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('Localização indisponível.'));navigator.geolocation.getCurrentPosition(resolve,()=>reject(new Error('Ative a localização para confirmar sua chegada.')),{enableHighAccuracy:true,timeout:20000,maximumAge:3000})})}
  function groupRows(items){const groups={};for(const item of items||[]){const key=`${item.location_type}:${item.base_id||item.establishment_id}`;(groups[key]??={key,type:item.location_type,id:item.base_id||item.establishment_id,name:item.location_name,items:[]}).items.push(item)}return Object.values(groups)}
  function renumber(container){container.querySelectorAll('.v25-queue-row').forEach((row,index)=>{row.querySelector('.v25-queue-number').textContent=String(index+1);row.classList.toggle('is-first',index===0);const label=row.querySelector('.v25-queue-first');if(label)label.classList.toggle('hidden',index!==0)})}
  async function saveOrder(container,group){const queue_ids=[...container.querySelectorAll('.v25-queue-row')].map(row=>row.dataset.queueId);try{await api('/api/app/v10/queue/reorder',{method:'PUT',body:{location_type:group.type,location_id:group.id,queue_ids}});toast('Sequência da fila atualizada.')}catch(error){toast(error.message,'error');pages.queue()}}
  function queueHtml(group,editable=true){return `<div class="v25-queue-note"><strong>${group.items.length?`${group.items.length} cooperado(s) aguardando`:'Nenhum cooperado aguardando'}</strong>${editable?'<br>Arraste os nomes ou use as setas para mudar a sequência.':''}</div><div class="v25-queue-list" data-v25-group="${esc(group.key)}">${group.items.map((item,index)=>`<article class="v25-queue-row ${index===0?'is-first':''}" data-queue-id="${esc(item.id)}" ${editable?'draggable="true"':''}><span class="v25-queue-number">${index+1}</span><div class="v25-queue-info"><strong>${esc(item.driver_name)} <span class="v25-queue-first ${index===0?'':'hidden'}">DA VEZ</span></strong><small>Chegou ${dateTime(item.arrived_at)}${item.vehicle_plate?` • ${esc(item.vehicle_plate)}`:''}</small></div>${editable?`<div class="v25-queue-actions"><button type="button" data-v25-up title="Subir">↑</button><button type="button" data-v25-down title="Descer">↓</button><button type="button" class="v25-drag-handle" title="Arrastar">↕</button></div>`:''}</article>`).join('')}</div>`}
  function bindQueue(container,group){if(!container)return;container.querySelectorAll('.v25-queue-row').forEach(row=>{row.addEventListener('dragstart',()=>{V25.dragged=row;row.classList.add('dragging')});row.addEventListener('dragend',()=>{row.classList.remove('dragging');container.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));V25.dragged=null});row.addEventListener('dragover',event=>{event.preventDefault();if(row!==V25.dragged)row.classList.add('drag-over')});row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));row.addEventListener('drop',async event=>{event.preventDefault();row.classList.remove('drag-over');if(!V25.dragged||row===V25.dragged)return;const rect=row.getBoundingClientRect(),before=event.clientY<rect.top+rect.height/2;container.insertBefore(V25.dragged,before?row:row.nextSibling);renumber(container);await saveOrder(container,group)});row.querySelector('[data-v25-up]')?.addEventListener('click',async()=>{const prev=row.previousElementSibling;if(prev){container.insertBefore(row,prev);renumber(container);await saveOrder(container,group)}});row.querySelector('[data-v25-down]')?.addEventListener('click',async()=>{const next=row.nextElementSibling;if(next){container.insertBefore(next,row);renumber(container);await saveOrder(container,group)}})})}
  function renderGroups(groups,editable=true){return groups.map(group=>panel(`${group.type==='base'?'Base':'Estabelecimento'} — ${group.name||'Local'}`,queueHtml(group,editable))).join('')||panel('Lista de espera',empty('Nenhum cooperado aguardando','Quando o cooperado tocar em Cheguei, ele aparecerá aqui em ordem numerada.'))}
  function bindGroups(groups){for(const group of groups){const container=document.querySelector(`[data-v25-group="${CSS.escape(group.key)}"]`);bindQueue(container,group)}}

  pages.queue=async function(){
    if(state.user.role==='driver'){
      const [locations,queue]=await Promise.all([api('/api/app/v10/queue/locations'),api('/api/app/v10/queue')]),active=locations.active,position=(queue.items||[])[0]?.queue_position;
      $('#page-content').innerHTML=panel('Lista de espera',`<div class="queue-driver-card"><div class="queue-driver-status ${active?'waiting':''}"><span>${active?'✓':'○'}</span><div><strong>${active?`Você está em ${position||1}º lugar`:'Chegou à Base ou ao estabelecimento?'}</strong><small>${active?esc(active.location_name):'Fique online, esteja no local e toque em Cheguei.'}</small></div></div><div class="queue-location-list">${(locations.items||[]).map(x=>`<button class="queue-location" data-v25-arrive-type="${x.location_type}" data-v25-arrive-id="${x.location_id}"><strong>${esc(x.location_name)}</strong><small>${timeOnly(x.start_at)} às ${timeOnly(x.end_at)}</small><span>${active&&((x.location_type==='base'&&active.base_id===x.location_id)||(x.location_type==='establishment'&&active.establishment_id===x.location_id))?'Já estou na fila':'Cheguei'}</span></button>`).join('')||'<div class="empty">Nenhuma escala para hoje.</div>'}</div>${active?'<button class="btn danger full" id="v25-queue-leave">Sair da lista de espera</button>':''}</div>`);
      document.querySelectorAll('[data-v25-arrive-id]').forEach(button=>button.onclick=async()=>{try{loading(true);const p=await gps(),result=await api('/api/app/v10/queue/arrive',{method:'POST',body:{location_type:button.dataset.v25ArriveType,location_id:button.dataset.v25ArriveId,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}});await sound.play('status');toast(result.already_waiting?'Você já está nesta fila.':'Chegada confirmada. Você entrou no fim da fila.');pages.queue()}catch(error){toast(error.message,'error')}finally{loading(false)}});
      document.getElementById('v25-queue-leave')?.addEventListener('click',async()=>{await api('/api/app/v10/queue/leave',{method:'POST'});await sound.play('offline');pages.queue()});return;
    }
    const data=await api('/api/app/v10/queue'),groups=groupRows(data.items||[]);$('#page-content').innerHTML=renderGroups(groups,true);bindGroups(groups);
  };

  if(pages.bases){const previous=pages.bases;pages.bases=async function(){await previous();if(!['cooperative_admin','dispatcher'].includes(state.user.role))return;const baseId=state.cache.baseViewId;if(!baseId)return;try{const data=await api(`/api/app/v10/queue?base_id=${encodeURIComponent(baseId)}`),groups=groupRows(data.items||[]);const area=document.createElement('div');area.id='v25-base-queue';area.innerHTML=renderGroups(groups,true);document.getElementById('page-content')?.appendChild(area);bindGroups(groups)}catch(error){console.error(error)}}}

  if(pages.financial){const previous=pages.financial;pages.financial=async function(){await previous();if(state.user.role!=='driver')return;try{const from=state.cache.finFrom||mondayOf(isoDate()),to=state.cache.finTo||addDays(from,6),data=await api(`/api/app/driver/finance${query({from,to})}`),cardsBox=document.querySelector('#page-content .cards');if(cardsBox){const third=cardsBox.querySelectorAll('.stat-card')[2]?.querySelector('small');if(third)third.textContent='Valor a receber';if(!cardsBox.querySelector('.v25-direct-card'))cardsBox.insertAdjacentHTML('beforeend',`<div class="stat-card v25-direct-card"><div class="icon">✓</div><strong>${money(data.summary?.direct_received_cents||0)}</strong><small>Recebido diretamente</small></div>`)}}catch{}}}
})();


/* ===== chegaja-v27.js ===== */
/* ChegaJá 12.5 — acesso, cliente, toque contínuo e correções finais */
(function(){
  const CJ={ringTimer:null,ringDeliveryId:null,audio:null,brandFrame:0,observersBound:false};
  const $id=id=>document.getElementById(id);

  function replaceBrandText(root){
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
      const parent=node.parentElement;if(!parent||['SCRIPT','STYLE','TEXTAREA','INPUT','OPTION'].includes(parent.tagName))return NodeFilter.FILTER_REJECT;
      return /Ligerim|Rapidim/i.test(node.nodeValue||'')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
    }});
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(node=>{node.nodeValue=String(node.nodeValue||'').replace(/Ligerim/gi,'ChegaJá').replace(/Rapidim/gi,'ChegaJá')});
    root.querySelectorAll?.('[alt],[title],[placeholder]').forEach(el=>{
      for(const name of ['alt','title','placeholder']){const value=el.getAttribute(name);if(value&&/Ligerim|Rapidim/i.test(value))el.setAttribute(name,value.replace(/Ligerim/gi,'ChegaJá').replace(/Rapidim/gi,'ChegaJá'));}
    });
  }
  function scheduleBrand(){if(CJ.brandFrame)return;CJ.brandFrame=requestAnimationFrame(()=>{CJ.brandFrame=0;['page-content','modal-body','customer-content','tracking-screen'].forEach(id=>replaceBrandText($id(id)));});}
  function bindBrandObservers(){if(CJ.observersBound)return;CJ.observersBound=true;const observer=new MutationObserver(scheduleBrand);['page-content','modal-body','customer-content','tracking-screen'].forEach(id=>{const el=$id(id);if(el)observer.observe(el,{childList:true,subtree:true})});replaceBrandText(document.body)}

  function audio(){
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
    CJ.audio=CJ.audio||new AC();if(CJ.audio.state==='suspended')CJ.audio.resume().catch(()=>{});return CJ.audio;
  }
  function oldPhoneBurst(){
    const ac=audio();if(!ac)return;
    const now=ac.currentTime;
    // Duas campainhas metálicas fortes, lembrando telefone antigo.
    [[0,780],[0,920],[.18,780],[.18,920],[.42,780],[.42,920],[.60,780],[.60,920]].forEach(([delay,freq])=>{
      const osc=ac.createOscillator(),gain=ac.createGain(),filter=ac.createBiquadFilter();
      osc.type='square';osc.frequency.setValueAtTime(freq,now+delay);filter.type='bandpass';filter.frequency.value=freq;filter.Q.value=3.5;
      gain.gain.setValueAtTime(.0001,now+delay);gain.gain.exponentialRampToValueAtTime(.42,now+delay+.012);gain.gain.exponentialRampToValueAtTime(.0001,now+delay+.15);
      osc.connect(filter);filter.connect(gain);gain.connect(ac.destination);osc.start(now+delay);osc.stop(now+delay+.17);
    });
    navigator.vibrate?.([420,130,420,600]);
  }
  function ringBanner(){let el=$id('chegaja-ringing');if(!el){el=document.createElement('div');el.id='chegaja-ringing';el.className='chegaja-ringing';el.textContent='☎ Nova entrega — toque em Aceitar';document.body.append(el)}return el}
  function startRing(deliveryId){
    if(state?.user?.role!=='driver')return;
    if(CJ.ringDeliveryId===deliveryId&&CJ.ringTimer)return;
    stopRing();CJ.ringDeliveryId=deliveryId||'assigned';ringBanner();oldPhoneBurst();CJ.ringTimer=setInterval(oldPhoneBurst,2400);
  }
  function stopRing(){if(CJ.ringTimer)clearInterval(CJ.ringTimer);CJ.ringTimer=null;CJ.ringDeliveryId=null;$id('chegaja-ringing')?.remove();navigator.vibrate?.(0)}
  document.addEventListener('pointerdown',()=>audio(),{once:true});
  document.addEventListener('click',event=>{const button=event.target.closest('button');if(button&&/aceitar/i.test(button.textContent||''))stopRing()},true);
  window.addEventListener('beforeunload',stopRing);

  // Usa o polling existente, sem criar outra consulta paralela. Assim o toque não pesa o servidor.
  if(typeof pollNotifications==='function'){
    pollNotifications=async function(){
      if(!state.user||document.hidden)return;
      try{
        const data=await api(`/api/app/v6/notifications?after=${v6.notificationCursor}`);
        v6.notificationCursor=Math.max(v6.notificationCursor,Number(data.cursor||0));
        for(const item of data.items||[]){
          if(state.user.role==='driver'&&item.event_type==='delivery_assigned')startRing(item.delivery_id);
          if(state.user.role==='driver'&&['delivery_accepted','delivery_unassigned','delivery_cancelled','delivery_completed'].includes(item.event_type))stopRing();
          const soundName=eventSound(item.event_type);
          if(!(state.user.role==='driver'&&item.event_type==='delivery_assigned'))await sound.play(soundName);
          toast(`${item.title}${item.message?` — ${item.message}`:''}`,['delivery_problem','delivery_cancelled'].includes(item.event_type)?'error':'success');
          if(state.user.role==='driver'&&['delivery_assigned','delivery_completed','delivery_status_changed','delivery_message'].includes(item.event_type)&&['dashboard','deliveries','routes'].includes(state.page))setTimeout(()=>navigate(state.page,false),180);
          if(['cooperative_admin','dispatcher','establishment'].includes(state.user.role)&&['integration_order_created','counter_order_created','base_order_created','delivery_completed'].includes(item.event_type)&&state.page==='deliveries')setTimeout(()=>pages.deliveries(),180);
        }
      }catch{}
    };
  }
  if(typeof initializeNotifications==='function'){
    initializeNotifications=async function(){stopNotifications();if(!state.user||state.user.role==='platform_admin')return;try{const initial=await api('/api/app/v6/notifications?initial=1');v6.notificationCursor=Number(initial.cursor||0)}catch{return}v6.notificationTimer=setInterval(pollNotifications,4000)};
  }

  function cooperativeOptions(items,selected=''){return `<option value="">Selecione a cooperativa</option>${(items||[]).map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(selected)?'selected':''}>${esc(x.name)}</option>`).join('')}`}
  async function customerAccess(mode='register'){
    if(typeof window.chegajaOpenCustomer==='function')return window.chegajaOpenCustomer(mode);
    showCustomer();
    $('#customer-content').innerHTML=`<section class="client-access-hero customer-hero"><p class="eyebrow">CHEGAJÁ PARA CLIENTES</p><h1>Link da cooperativa necessário</h1><p>O cadastro, o pedido e os créditos só podem ser acessados pelo link oficial enviado pela cooperativa. Não existe escolha manual.</p></section>`;
  }
  if(typeof renderCustomerAccess==='function')renderCustomerAccess=()=>customerAccess('register');


  async function checkAssignedOnEntry(){
    if(state?.user?.role!=='driver')return;
    try{const data=await api('/api/app/tenant/deliveries?status=assigned'),item=(data.items||[]).find(x=>String(x.assigned_driver_id)===String(state.user.driver_id));if(item)startRing(item.id)}catch{}
  }

  function bindEntryButtons(){
    const register=$id('customer-app-link'),guest=$id('customer-guest-link');
    if(register)register.onclick=()=>typeof window.chegajaOpenCustomer==='function'?window.chegajaOpenCustomer('register'):customerAccess('register');
    if(guest)guest.onclick=()=>typeof window.chegajaOpenCustomer==='function'?window.chegajaOpenCustomer('guest'):customerAccess('guest');
  }

  // Configuração da identidade da cooperativa.
  if(pages?.settings){
    pages.settings=async()=>{const d=await api('/api/app/tenant/settings'),x=d.item||{};$('#page-content').innerHTML=panel('Configurações da cooperativa',`<form id="tenant-settings" class="form-grid"><div class="branding-preview"><img id="branding-preview-logo" src="${esc(x.logo_url||'/icons/logo-official.png')}" alt="Logo"><div><strong id="branding-preview-title">${esc(x.login_title||'Bem-vindo ao ChegaJá')}</strong><span id="branding-preview-subtitle">${esc(x.login_subtitle||'Entregas simples, rápidas e acompanhadas em tempo real.')}</span></div></div>${field('Nome','name',x.name,'text','required')}${field('E-mail','email',x.email,'email')}${field('Telefone','phone',x.phone)}${field('URL da logo','logo_url',x.logo_url||'','url','placeholder="https://..."')}${field('Cor principal','primary_color',x.primary_color||'#0D257A','color')}${field('Título da tela de acesso','login_title',x.login_title||'Bem-vindo ao ChegaJá')}${textarea('Frase da tela de acesso','login_subtitle',x.login_subtitle||'Entregas simples, rápidas e acompanhadas em tempo real.')}${field('Texto do rodapé','login_footer_text',x.login_footer_text||'Tecnologia para cooperativas, clientes e cooperados.')}${textarea('Endereço','address',x.address)}${field('INSS (%)','inss_percent',x.inss_percent,'number','step="0.01" min="0"')}${field('SEST/SENAT (%)','sest_senat_percent',x.sest_senat_percent,'number','step="0.01" min="0"')}${field('Taxa mínima padrão','default_minimum',inputMoney(x.default_minimum_cents),'number','step="0.01" min="0"')}${field('Valor padrão por km','default_km',inputMoney(x.default_km_cents),'number','step="0.01" min="0"')}${field('Taxa da cooperativa (%)','cooperative_fee_percent',x.cooperative_fee_percent,'number','step="0.01" min="0"')}${buttons('Salvar configurações')}</form>`);const form=$('#tenant-settings');const updatePreview=()=>{const logo=form.elements.logo_url.value.trim();$id('branding-preview-logo').src=logo||'/icons/logo-official.png';$id('branding-preview-title').textContent=form.elements.login_title.value||'Bem-vindo ao ChegaJá';$id('branding-preview-subtitle').textContent=form.elements.login_subtitle.value||''};['logo_url','login_title','login_subtitle'].forEach(name=>form.elements[name]?.addEventListener('input',updatePreview));form.onsubmit=async e=>{e.preventDefault();try{loading(true);await api('/api/app/tenant/settings',{method:'PUT',body:formObject(e.currentTarget)});toast('Configurações e identidade salvas.')}catch(err){toast(err.message,'error')}finally{loading(false)}}};
  }

  async function loadPublicBranding(){
    const cooperativeId=new URLSearchParams(location.search).get('coop');if(!cooperativeId)return;
    try{const d=await api(`/api/public/branding/${encodeURIComponent(cooperativeId)}`),x=d.item||{};const logo=x.logo_url||'/icons/logo-official.png';document.querySelector('.auth-brand .brand-logo-large')?.setAttribute('src',logo);document.querySelector('.auth-card .auth-login-logo img')?.setAttribute('src',logo);if(x.login_title)$id('auth-welcome-title').textContent=x.login_title;if(x.login_subtitle)$id('auth-welcome-subtitle').textContent=x.login_subtitle;if(/^#[0-9a-f]{6}$/i.test(x.primary_color||''))document.documentElement.style.setProperty('--wine',x.primary_color,'important')}catch{}
  }

  // Garante nome e botão de edição na Base mesmo com dados antigos.
  if(pages?.bases){const oldBases=pages.bases;pages.bases=async function(){await oldBases();document.querySelectorAll('[data-base-quick-edit]').forEach(btn=>{if(!btn.textContent.trim())btn.textContent='Editar tudo'});document.querySelectorAll('[data-v17-driver]').forEach(select=>{if(!select.value){const row=select.closest('tr'),name=row?.dataset?.driverName;if(name)select.insertAdjacentHTML('afterbegin',`<option selected>${esc(name)}</option>`)}});scheduleBrand()}}

  // Marca classes por perfil para o visual responsivo.
  function applyRoleClass(){document.body.classList.remove('role-driver','role-customer','role-establishment','role-cooperative');if(state?.user?.role==='driver')document.body.classList.add('role-driver');if(state?.user?.role==='establishment')document.body.classList.add('role-establishment');if(['cooperative_admin','dispatcher'].includes(state?.user?.role))document.body.classList.add('role-cooperative')}
  if(typeof showApp==='function'){const oldShow=showApp;showApp=function(){oldShow();applyRoleClass();bindEntryButtons();scheduleBrand();setTimeout(checkAssignedOnEntry,450)}}
  if(typeof logout==='function'){const oldLogout=logout;logout=function(...args){stopRing();document.body.classList.remove('role-driver','role-customer','role-establishment','role-cooperative');return oldLogout(...args)}}

  function init(){bindBrandObservers();bindEntryButtons();loadPublicBranding();applyRoleClass();scheduleBrand()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();


/* ===== chegaja-v28.js ===== */
/* ChegaJá 13.0 — vínculo obrigatório do cliente pela cooperativa do link */
(function(){
  const customerParams=new URLSearchParams(location.search);
  const urlCooperative=String(customerParams.get('coop')||'').trim();
  const clientBuild='13.0.0';
  if(localStorage.getItem('chegaja_customer_build')!==clientBuild){
    localStorage.setItem('chegaja_customer_build',clientBuild);
    if('caches'in window)caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('chegaja-')&&key!=='chegaja-v13-0-cliente-vinculo').map(key=>caches.delete(key)))).catch(()=>{});
  }

  function storedCooperativeId(){return String(localStorage.getItem('chegaja_customer_cooperative')||'').trim()}
  function cooperativeId(){return String(urlCooperative||lg.customer?.cooperative_id||storedCooperativeId()||'').trim()}
  function cooperative(){const id=cooperativeId();return (lg.catalog?.cooperatives||[]).find(x=>String(x.id)===String(id))||null}
  function customerTokenCooperative(token){
    try{const part=String(token||'').split('.')[1];if(!part)return '';const normalized=part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'=');return String(JSON.parse(atob(normalized)).cooperativeId||'')}
    catch{return ''}
  }
  function clearCustomerSession(){
    localStorage.removeItem('ligerim_customer_token');
    lg.customerToken='';
    lg.customer=null;
  }
  function customerLink(id=state.user?.cooperative_id||''){return `${location.origin}/?cliente=1&coop=${encodeURIComponent(id)}`}
  function saveSession(data){
    const expected=cooperativeId(),received=String(data.customer?.cooperative_id||'');
    if(!expected||!received||String(expected)!==received)throw new Error('O cadastro não pertence ao link desta cooperativa. Abra novamente o link oficial.');
    lg.customerToken=data.token;lg.customer=data.customer;localStorage.setItem('ligerim_customer_token',data.token);
    localStorage.setItem('chegaja_customer_cooperative',received);
  }

  async function loadCustomerCatalog(){
    const id=cooperativeId();
    if(!id){lg.catalog={cooperatives:[],bases:[],services:[]};return lg.catalog}
    lg.catalog=await clientApi(`/catalog?cooperative_id=${encodeURIComponent(id)}`);
    const fixed=(lg.catalog?.cooperatives||[]).find(item=>String(item.id)===String(id));
    if(!fixed){
      if(storedCooperativeId()===String(id))localStorage.removeItem('chegaja_customer_cooperative');
      lg.catalog={cooperatives:[],bases:[],services:[]};
      throw new Error('O link da cooperativa é inválido, expirou ou a cooperativa está inativa.');
    }
    localStorage.setItem('chegaja_customer_cooperative',String(fixed.id));
    return lg.catalog;
  }

  function noCooperativeLink(){
    $('#customer-content').innerHTML=`<section class="client-access-hero customer-hero"><p class="eyebrow">CHEGAJÁ PARA CLIENTES</p><h1>Acesse pelo link da sua cooperativa</h1><p>Por segurança, o cadastro e os créditos ficam vinculados à cooperativa que enviou o link.</p></section><section class="customer-card client-link-required"><h2>Link da cooperativa necessário</h2><p>Solicite à cooperativa o link oficial de cadastro. Ao abrir esse link, o nome da cooperativa já aparecerá selecionado e continuará salvo no aplicativo instalado.</p><button class="btn" type="button" id="client-link-back">Voltar</button></section>`;
    $('#client-link-back').onclick=()=>showAuth('login');
  }

  renderCustomerAccess=function(mode='register'){
    const coop=cooperative();if(!coop)return noCooperativeLink();
    const logo=coop.logo_url||'/icons/logo-official.png';
    $('#customer-content').innerHTML=`<section class="client-access-hero customer-hero cooperative-access"><img src="${esc(logo)}" alt="${esc(coop.name)}"><div><p class="eyebrow">CADASTRO OFICIAL</p><h1>${esc(coop.name)}</h1><p>Seu cadastro, pedidos e créditos ficarão vinculados automaticamente a esta cooperativa.</p></div></section><div class="customer-auth-grid v28"><section class="customer-card"><h2>Já tenho cadastro</h2><p class="muted">Entre para consultar créditos, consumo e pedidos desta cooperativa.</p><form id="customer-login" class="form-grid"><input type="hidden" name="cooperative_id" value="${esc(coop.id)}">${field('Celular ou e-mail','login','','text','required autocomplete="username"')}${field('Senha','password','','password','required autocomplete="current-password"')}${buttons('Entrar')}</form></section><section class="customer-card featured" id="customer-register-card"><h2>Cadastre-se</h2><p class="cooperative-fixed"><strong>Cooperativa:</strong> ${esc(coop.name)}</p><form id="customer-register" class="form-grid"><input type="hidden" name="cooperative_id" value="${esc(coop.id)}">${field('Nome','name','','text','required')}${field('Celular','phone','','tel')}${field('E-mail','email','','email')}${field('Senha','password','','password','required minlength="8"')}${buttons('Criar minha conta')}</form></section><section class="customer-card guest-card" id="customer-guest-card"><h2>Pedido avulso</h2><p class="muted">Continue sem senha. O acesso temporário fica vinculado a ${esc(coop.name)}.</p><form id="customer-guest" class="form-grid"><input type="hidden" name="cooperative_id" value="${esc(coop.id)}">${field('Nome','name','','text','required')}${field('Celular','phone','','tel')}${field('E-mail (opcional)','email','','email')}${buttons('Continuar sem cadastro')}</form></section></div>`;
    const enter=data=>{saveSession(data);renderCustomerHome()};
    $('#customer-login').onsubmit=async e=>{e.preventDefault();try{loading(true);enter(await clientApi('/login',{method:'POST',body:formObject(e.currentTarget)}))}catch(error){toast(error.message,'error')}finally{loading(false)}};
    $('#customer-register').onsubmit=async e=>{e.preventDefault();try{loading(true);enter(await clientApi('/register',{method:'POST',body:formObject(e.currentTarget)}))}catch(error){toast(error.message,'error')}finally{loading(false)}};
    $('#customer-guest').onsubmit=async e=>{e.preventDefault();try{loading(true);enter(await clientApi('/guest',{method:'POST',body:formObject(e.currentTarget)}))}catch(error){toast(error.message,'error')}finally{loading(false)}};
    requestAnimationFrame(()=>{const target=mode==='guest'?$('#customer-guest-card'):$('#customer-register-card');target?.scrollIntoView({behavior:'smooth',block:'center'});target?.querySelector('input:not([type=hidden])')?.focus()});
  };

  customerApp=async function(mode='register'){
    showCustomer();
    try{await loadCustomerCatalog()}catch(error){$('#customer-content').innerHTML=empty('Não foi possível abrir o link',error.message);return}
    if(!cooperative())return noCooperativeLink();
    if(lg.customerToken){
      const tokenCoop=customerTokenCooperative(lg.customerToken);
      if(urlCooperative&&tokenCoop&&String(tokenCoop)!==String(urlCooperative))clearCustomerSession();
    }
    if(lg.customerToken){
      try{
        const result=await clientApi('/me'),sessionCoop=String(result.customer?.cooperative_id||'');
        if(!sessionCoop||sessionCoop!==String(cooperativeId())){clearCustomerSession();return renderCustomerAccess(mode)}
        lg.customer=result.customer;localStorage.setItem('chegaja_customer_cooperative',sessionCoop);return renderCustomerHome();
      }catch{clearCustomerSession()}
    }
    renderCustomerAccess(mode);
  };

  renderCustomerHome=async function(tab='request'){
    const [me,wallet,orders]=await Promise.all([clientApi('/me'),clientApi('/wallet'),clientApi('/orders')]);
    lg.customer=me.customer;const balance=Number(wallet.wallet?.balance_cents||0),coopName=wallet.wallet?.cooperative_name||lg.customer?.cooperative_name||cooperative()?.name||'Cooperativa';
    $('#customer-content').innerHTML=`<section class="client-app-head"><div><p class="eyebrow">${esc(coopName)}</p><h1>Olá, ${esc(lg.customer?.name||'cliente')}</h1></div><div class="wallet-pill"><small>Crédito nesta cooperativa</small><strong>${money(balance)}</strong></div></section><nav class="client-tabs"><button data-c-tab="request" class="${tab==='request'?'active':''}">Pedir entrega</button><button data-c-tab="orders" class="${tab==='orders'?'active':''}">Meus pedidos</button><button data-c-tab="wallet" class="${tab==='wallet'?'active':''}">Créditos e consumo</button><button id="customer-logout">Sair</button></nav><div id="client-tab-body"></div>`;
    $$('[data-c-tab]').forEach(button=>button.onclick=()=>renderCustomerHome(button.dataset.cTab));
    $('#customer-logout').onclick=()=>{clearCustomerSession();renderCustomerAccess()};
    if(tab==='orders')renderCustomerOrders(orders.items||[]);else if(tab==='wallet')renderCustomerWallet(wallet);else renderCustomerRequest(balance);
  };

  renderCustomerRequest=function(balance){
    const cat=lg.catalog||{},coop=cooperative(),bases=(cat.bases||[]).filter(x=>String(x.cooperative_id)===String(coop?.id)),registered=!lg.customer?.guest;
    $('#client-tab-body').innerHTML=`<section class="customer-card"><div class="fixed-cooperative-banner"><small>Pedido para</small><strong>${esc(coop?.name||'Cooperativa')}</strong></div><form id="client-order-v28" class="form-grid"><input type="hidden" name="cooperative_id" value="${esc(coop?.id||'')}"><label>Base<select name="base_id" id="client-base-v28" required><option value="">Selecione</option>${bases.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>${addressFields('pickup','Endereço de coleta')}<div class="full address-inline-details">${field('Apartamento/Unidade na coleta','pickup_apartment')}${field('Complemento da coleta','pickup_complement')}</div>${field('Pessoa na coleta','pickup_contact_name')}${field('Telefone da coleta','pickup_phone','','tel')}${addressFields('delivery','Endereço de entrega')}<div class="full address-inline-details">${field('Apartamento/Unidade na entrega','delivery_apartment')}${field('Complemento da entrega','delivery_complement')}</div>${field('Quem recebe','recipient_name','','text','required')}${field('Telefone de quem recebe','recipient_phone','','tel')}${field('Descrição do item (opcional)','item_description','','text','placeholder="Opcional"')}${registered?`<input type="hidden" name="payment_method" value="credit"><div class="full credit-required-notice"><strong>Pagamento com crédito pré-pago</strong><span>Saldo disponível: ${money(balance)}. O pedido será bloqueado quando o saldo não cobrir o valor da corrida.</span></div>`:`${selectField('Forma de pagamento','payment_method',[{id:'pix',name:'PIX'},{id:'dinheiro',name:'Dinheiro'},{id:'pix_cooperativa',name:'PIX Cooperativa'},{id:'credit',name:`Crédito antecipado (${money(balance)})`}],'pix','Selecione','required')}<label class="full hidden" data-cash-location>Dinheiro será pago em<select name="cash_payment_location"><option value="pickup">Na coleta</option><option value="delivery">Na entrega</option></select></label>`}<div class="full" id="client-services-v28"></div>${textarea('Observações','notes','','placeholder="Informe portaria, torre, referência ou cuidado especial"')}<div class="full quote-result" id="quote-v28">Confirme os dois endereços para consultar o valor.</div><div class="form-actions"><button type="button" class="btn soft" id="quote-btn-v28">Consultar valor</button><button class="btn primary">Confirmar pedido</button></div></form></section>`;
    const form=$('#client-order-v28');bindAddressSearch(form,'pickup',()=>({cooperative_id:coop.id,base_id:form.base_id.value}));bindAddressSearch(form,'delivery',()=>({cooperative_id:coop.id,base_id:form.base_id.value}));if(!registered)bindCashLocation(form);
    const updateServices=()=>{const services=(cat.services||[]).filter(x=>String(x.cooperative_id)===String(coop.id)&&(!x.base_id||String(x.base_id)===String(form.base_id.value)));$('#client-services-v28').innerHTML=services.length?`<strong>Serviços adicionais</strong>${serviceChecks(services)}`:''};
    form.base_id.onchange=updateServices;if(bases.length===1){form.base_id.value=bases[0].id;updateServices()}
    const quote=async()=>{requireConfirmed(form,'pickup');requireConfirmed(form,'delivery');const data=await clientApi('/quote',{method:'POST',body:formObject(form)});lg.quote=data.quote;const insufficient=registered&&Number(data.quote.charge_cents)>balance;$('#quote-v28').innerHTML=`Valor da entrega: <strong>${money(data.quote.charge_cents)}</strong><br><small>${km(data.quote.distance_meters)} • ${mins(data.quote.duration_seconds)}</small>${insufficient?`<div class="credit-insufficient">Crédito insuficiente. Faltam ${money(data.quote.charge_cents-balance)}.</div>`:''}`;return data.quote};
    $('#quote-btn-v28').onclick=async()=>{try{loading(true);await quote()}catch(error){toast(error.message,'error')}finally{loading(false)}};
    form.onsubmit=async event=>{event.preventDefault();try{loading(true);const q=await quote();if(registered&&balance<Number(q.charge_cents))throw new Error(`Crédito insuficiente. Você tem ${money(balance)} e a corrida custa ${money(q.charge_cents)}.`);if(!confirm(`Confirmar o pedido por ${money(q.charge_cents)}?`))return;const result=await clientApi('/orders',{method:'POST',body:formObject(form)});toast(`Pedido ${result.order.display_code} criado e crédito consumido.`);renderCustomerHome('orders')}catch(error){toast(error.message,'error')}finally{loading(false)}};
  };

  renderCustomerWallet=function(data){
    const coopName=data.wallet?.cooperative_name||lg.customer?.cooperative_name||cooperative()?.name||'Cooperativa',transactions=data.transactions||[],requests=data.purchase_requests||[];
    $('#client-tab-body').innerHTML=`${cards([{icon:'◈',value:money(data.wallet?.balance_cents),label:`Saldo em ${coopName}`}])}<section class="customer-card"><h2>Comprar créditos</h2><p class="muted">O crédito solicitado será válido somente em ${esc(coopName)}.</p><form id="client-topup-v28" class="form-grid"><input type="hidden" name="cooperative_id" value="${esc(cooperativeId())}">${field('Valor','amount','','number','step="0.01" min="1" required')}${selectField('Pagamento','payment_method',[{id:'pix',name:'PIX'}],'pix')}${field('Link do comprovante (opcional)','proof_url','','url')}${buttons('Solicitar crédito')}</form></section><section class="customer-card"><h2>Solicitações de compra</h2>${table([{label:'Data',render:r=>dateTime(r.created_at)},{label:'Valor',render:r=>money(r.amount_cents)},{label:'Pagamento',key:'payment_method'},{label:'Status',render:r=>badge(r.status)}],requests)}</section><section class="customer-card"><h2>Histórico de créditos e consumo</h2>${table([{label:'Data',render:r=>dateTime(r.created_at)},{label:'Pedido',render:r=>r.display_code?`<strong>${esc(r.display_code)}</strong>`:'—'},{label:'Descrição',render:r=>`${esc(r.description||'')}<br><small>${esc(r.reason||r.category||'')}</small>`},{label:'Movimento',render:r=>r.entry_type==='debit'?badge('debit'):badge('credit')},{label:'Valor',render:r=>`<strong class="${r.entry_type==='debit'?'amount-debit':'amount-credit'}">${r.entry_type==='debit'?'-':'+'}${money(r.amount_cents)}</strong>`}],transactions)}</section>`;
    $('#client-topup-v28').onsubmit=async event=>{event.preventDefault();try{loading(true);const result=await clientApi('/wallet/topups',{method:'POST',body:formObject(event.currentTarget)});toast(result.message);renderCustomerHome('wallet')}catch(error){toast(error.message,'error')}finally{loading(false)}};
  };

  pages.baseCustomers=async function(){
    const data=await api('/api/app/v10/base/customers'),items=data.items||[],canManage=state.user.role==='cooperative_admin',link=customerLink();
    $('#page-content').innerHTML=cards([{icon:'◎',value:items.length,label:'Clientes cadastrados'},{icon:'◈',value:money(items.reduce((sum,x)=>sum+Number(x.balance_cents||0),0)),label:'Créditos disponíveis'}])+panel('Link oficial de cadastro',`<div class="customer-link-box"><div><strong>Envie este link aos clientes</strong><span>A cooperativa já ficará selecionada no cadastro e no aplicativo instalado.</span></div><input id="cooperative-customer-link" readonly value="${esc(link)}"><button class="btn primary" id="copy-customer-link">Copiar link</button></div>`)+panel('Clientes, créditos e consumo',table([{label:'Cliente',render:x=>`<strong>${esc(x.name)}</strong><br><small>${esc(x.email||'')}</small>`},{label:'Telefone',key:'phone'},{label:'Saldo nesta cooperativa',render:x=>`<strong>${money(x.balance_cents)}</strong>`},{label:'Pedidos',key:'total_orders'},{label:'Último pedido',render:x=>dateTime(x.last_order_at)},{label:'Cadastro',render:x=>dateOnly(x.created_at)}],items,x=>`<button class="table-action" data-customer-history="${x.id}">Histórico</button>${canManage?`<button class="table-action" data-customer-credit="${x.id}">Editar crédito</button><button class="table-action" data-customer-edit="${x.id}">Editar cliente</button><button class="table-action danger" data-customer-delete="${x.id}">Excluir</button>`:''}`),canManage?'<button class="btn primary" id="new-customer">Cadastrar cliente</button>':'');
    $('#copy-customer-link').onclick=()=>copyText(link);
    $('#new-customer')?.addEventListener('click',()=>{openModal('Cadastrar cliente',`<form id="manual-customer-form" class="form-grid">${field('Nome do cliente','name','','text','required')}${field('Telefone','phone','','tel')}${field('E-mail','email','','email')}<div class="full notice">O cliente ficará vinculado somente a esta cooperativa.</div>${buttons('Cadastrar cliente')}</form>`);$('#manual-customer-form').onsubmit=async event=>{event.preventDefault();try{loading(true);await api('/api/app/v10/base/customers',{method:'POST',body:formObject(event.currentTarget)});closeModal();toast('Cliente cadastrado.');pages.baseCustomers()}catch(error){toast(error.message,'error')}finally{loading(false)}}});
    $$('[data-customer-credit]').forEach(button=>button.onclick=()=>{const customer=items.find(x=>String(x.id)===String(button.dataset.customerCredit));openModal('Editar crédito',`<form id="customer-credit-adjust" class="form-grid"><div class="full notice"><strong>${esc(customer.name)}</strong><br>Saldo atual nesta cooperativa: ${money(customer.balance_cents)}</div>${selectField('Tipo de ajuste','mode',[{id:'add',name:'Acrescentar valor'},{id:'remove',name:'Retirar valor'},{id:'set',name:'Definir saldo exato'}],'set')}${field('Valor','amount',Number(customer.balance_cents||0)/100,'number','required step="0.01"')}${textarea('Descrição','description','Ajuste de crédito realizado pela cooperativa','required')}${buttons('Salvar crédito')}</form>`);$('#customer-credit-adjust').onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/v10/base/customers/${customer.id}/credit`,{method:'POST',body:formObject(event.currentTarget)});closeModal();toast('Crédito atualizado.');pages.baseCustomers()}catch(error){toast(error.message,'error')}finally{loading(false)}}});
    $$('[data-customer-edit]').forEach(button=>button.onclick=()=>{const customer=items.find(x=>String(x.id)===String(button.dataset.customerEdit));openModal('Editar cliente',`<form id="customer-edit-form" class="form-grid">${field('Nome','name',customer.name,'text','required')}${field('Telefone','phone',customer.phone,'tel')}${field('E-mail','email',customer.email,'email')}${buttons('Salvar cliente')}</form>`);$('#customer-edit-form').onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/v10/base/customers/${customer.id}`,{method:'PUT',body:formObject(event.currentTarget)});closeModal();toast('Cliente atualizado.');pages.baseCustomers()}catch(error){toast(error.message,'error')}finally{loading(false)}}});
    $$('[data-customer-delete]').forEach(button=>button.onclick=async()=>{const customer=items.find(x=>String(x.id)===String(button.dataset.customerDelete));if(!confirm(`Excluir ${customer.name} desta cooperativa? O histórico financeiro será preservado.`))return;try{loading(true);await api(`/api/app/v10/base/customers/${customer.id}`,{method:'DELETE'});toast('Cliente removido da cooperativa.');pages.baseCustomers()}catch(error){toast(error.message,'error')}finally{loading(false)}});
    $$('[data-customer-history]').forEach(button=>button.onclick=async()=>{try{loading(true);const history=await api(`/api/app/v10/base/customers/${button.dataset.customerHistory}/history`),c=history.customer;openModal(`Histórico de ${c.name}`,`${cards([{icon:'◈',value:money(history.balance_cents),label:'Saldo atual'}])}<h3>Consumo e movimentações</h3>${table([{label:'Data',render:r=>dateTime(r.created_at)},{label:'Pedido',render:r=>r.display_code||'—'},{label:'Descrição',render:r=>`${esc(r.description)}<br><small>${esc(r.reason||r.category||'')}</small>`},{label:'Tipo',render:r=>badge(r.entry_type)},{label:'Valor',render:r=>`${r.entry_type==='debit'?'-':'+'}${money(r.amount_cents)}`}],history.transactions||[])}<h3>Pedidos</h3>${table([{label:'Data',render:r=>dateTime(r.created_at)},{label:'Pedido',render:r=>r.display_code||'—'},{label:'Coleta',key:'pickup_address',wrap:true},{label:'Entrega',key:'delivery_address',wrap:true},{label:'Valor',render:r=>money(r.quoted_cents)},{label:'Crédito usado',render:r=>money(r.credit_used_cents)}],history.orders||[])}`)}catch(error){toast(error.message,'error')}finally{loading(false)}});
  };


  function bindOfficialCustomerEntry(){
    const register=$('#customer-app-link'),guest=$('#customer-guest-link');
    if(register)register.onclick=()=>customerApp('register');
    if(guest)guest.onclick=()=>customerApp('guest');
  }
  window.chegajaOpenCustomer=customerApp;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindOfficialCustomerEntry,{once:true});else bindOfficialCustomerEntry();
  window.addEventListener('pageshow',bindOfficialCustomerEntry);
})();


/* ===== chegaja-v29.js ===== */
/* ChegaJá 12.7 — fila rápida da Base com atualização automática */
(function(){
  const V29={timer:null,hideTimer:null};

  function stopQueueRefresh(){
    clearInterval(V29.timer);
    clearTimeout(V29.hideTimer);
    V29.timer=null;
    V29.hideTimer=null;
  }

  function baseContext(){
    const select=document.getElementById('base-view-select');
    const id=String(state?.cache?.baseViewId||select?.value||'');
    const option=select?.selectedOptions?.[0];
    const name=String(option?.textContent||option?.label||'Base').trim()||'Base';
    return {id,name};
  }

  function queueRows(items){
    if(!items.length)return `<div class="v29-queue-empty"><strong>Nenhum cooperado aguardando</strong><span>Quando o cooperado tocar em Cheguei, ele aparecerá aqui.</span></div>`;
    return `<div class="v29-queue-list">${items.map((item,index)=>`<article class="v29-queue-row ${index===0?'is-first':''}"><span class="v29-queue-number">${index+1}</span><div><strong>${esc(item.driver_name||'Cooperado')}</strong><small>${index===0?'Cooperado da vez • ':''}Chegou ${dateTime(item.arrived_at)}</small></div>${index===0?'<b>DA VEZ</b>':''}</article>`).join('')}</div>`;
  }

  function setOpen(root,open){
    if(!root)return;
    root.classList.toggle('open',open);
    root.querySelector('.v29-queue-button')?.setAttribute('aria-expanded',open?'true':'false');
  }

  function bindQuickQueue(root){
    const button=root.querySelector('.v29-queue-button');
    const show=()=>{clearTimeout(V29.hideTimer);setOpen(root,true)};
    const hide=()=>{clearTimeout(V29.hideTimer);V29.hideTimer=setTimeout(()=>setOpen(root,false),130)};
    root.addEventListener('mouseenter',show);
    root.addEventListener('mouseleave',hide);
    root.addEventListener('focusin',show);
    root.addEventListener('focusout',event=>{if(!root.contains(event.relatedTarget))hide()});
    button?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();setOpen(root,!root.classList.contains('open'))});
    root.querySelector('[data-v29-open-full]')?.addEventListener('click',()=>navigate('queue'));
  }

  async function refreshQuickQueue(baseId){
    const root=document.getElementById('v29-base-queue-quick');
    if(!root||!baseId)return;
    try{
      const data=await api(`/api/app/v10/queue?base_id=${encodeURIComponent(baseId)}`);
      const items=(data.items||[]).sort((a,b)=>Number(a.queue_position||0)-Number(b.queue_position||0));
      const count=root.querySelector('[data-v29-queue-count]');
      const body=root.querySelector('[data-v29-queue-body]');
      if(count)count.textContent=String(items.length);
      if(body)body.innerHTML=queueRows(items);
      root.classList.toggle('has-waiting',items.length>0);
      root.querySelector('.v29-queue-button')?.setAttribute('aria-label',`Fila de espera: ${items.length} cooperado${items.length===1?'':'s'}`);
    }catch(error){
      const body=root.querySelector('[data-v29-queue-body]');
      if(body)body.innerHTML=`<div class="v29-queue-empty error"><strong>Não foi possível consultar a fila</strong><span>${esc(error.message||'Atualize a página.')}</span></div>`;
    }
  }

  async function installQuickQueue(){
    stopQueueRefresh();
    document.getElementById('v25-base-queue')?.remove();
    document.getElementById('v29-base-queue-quick')?.remove();
    if(!['cooperative_admin','dispatcher'].includes(state?.user?.role)||state?.page!=='bases')return;
    const context=baseContext();
    if(!context.id)return;
    const content=document.getElementById('page-content');
    if(!content)return;
    const bar=document.createElement('section');
    bar.className='v29-base-quickbar';
    bar.id='v29-base-queue-quick';
    bar.innerHTML=`<div class="v29-base-title"><small>BASE SELECIONADA</small><strong>${esc(context.name)}</strong></div><div class="v29-queue-quick"><button type="button" class="v29-queue-button" aria-expanded="false"><span class="v29-queue-icon">≋</span><span>Fila</span><b data-v29-queue-count>0</b></button><div class="v29-queue-popover" role="dialog" aria-label="Lista rápida de espera"><header><div><small>LISTA DE ESPERA</small><strong>${esc(context.name)}</strong></div><button type="button" data-v29-open-full>Organizar fila</button></header><div data-v29-queue-body><div class="v29-queue-loading">Consultando fila…</div></div></div></div>`;
    const firstPanel=content.querySelector('.panel');
    if(firstPanel)content.insertBefore(bar,firstPanel);else content.prepend(bar);
    bindQuickQueue(bar);
    await refreshQuickQueue(context.id);
    V29.timer=setInterval(()=>{
      if(state?.page!=='bases'||!document.getElementById('v29-base-queue-quick'))return stopQueueRefresh();
      refreshQuickQueue(context.id);
    },4000);
  }

  document.addEventListener('click',event=>{
    const root=document.getElementById('v29-base-queue-quick');
    if(root&&!root.contains(event.target))setOpen(root,false);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')setOpen(document.getElementById('v29-base-queue-quick'),false)});

  if(pages?.bases){
    const previousBases=pages.bases;
    pages.bases=async function(){
      await previousBases();
      await installQuickQueue();
    };
  }

  if(typeof navigate==='function'){
    const previousNavigate=navigate;
    navigate=async function(...args){
      if(args[0]!=='bases')stopQueueRefresh();
      return previousNavigate.apply(this,args);
    };
  }
})();


/* ===== chegaja-v30.js ===== */
/* ChegaJá 12.8 — mapa operacional dentro da tela da Base */
(function(){
  const V30={map:null,layer:null,timer:null,baseId:'',lastData:null};

  const $id=id=>document.getElementById(id);
  const num=value=>Number(value||0);
  const freshOnline=item=>Number(item?.online||0)===1;

  function cleanup(){
    clearInterval(V30.timer);
    V30.timer=null;
    V30.baseId='';
    V30.lastData=null;
    if(V30.map){
      try{V30.map.remove()}catch{}
      V30.map=null;
      V30.layer=null;
    }
    document.getElementById('v30-base-operations')?.remove();
  }

  function selectedBaseId(){
    return String(state?.cache?.baseViewId||document.getElementById('base-view-select')?.value||'');
  }

  function distanceKm(lat1,lng1,lat2,lng2){
    const values=[lat1,lng1,lat2,lng2].map(Number);
    if(values.some(value=>!Number.isFinite(value)))return null;
    const [a,b,c,d]=values,R=6371,toRad=value=>value*Math.PI/180;
    const dLat=toRad(c-a),dLng=toRad(d-b);
    const h=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }

  function relativeTime(value){
    if(!value)return 'Sem atualização';
    const raw=String(value),parsed=new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw)?raw:raw.replace(' ','T')+'Z');
    if(Number.isNaN(parsed.getTime()))return dateTime(value);
    const seconds=Math.max(0,Math.floor((Date.now()-parsed.getTime())/1000));
    if(seconds<60)return 'Agora';
    if(seconds<3600)return `Há ${Math.floor(seconds/60)} min`;
    return `Há ${Math.floor(seconds/3600)} h`;
  }

  function markerIcon(driver){
    const initials=String(driver.name||'C').trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase();
    const queue=Number(driver.queue_position||0)>0?`<b>${driver.queue_position}º</b>`:'';
    return L.divIcon({
      className:'v30-driver-marker-wrap',
      html:`<div class="v30-driver-marker ${Number(driver.queue_position||0)>0?'is-queue':''}">${queue}<span>${esc(initials||'C')}</span></div>`,
      iconSize:[46,52],iconAnchor:[23,48],popupAnchor:[0,-47]
    });
  }

  function baseIcon(){
    return L.divIcon({className:'v30-base-marker-wrap',html:'<div class="v30-base-marker"><span>⌂</span></div>',iconSize:[50,54],iconAnchor:[25,50],popupAnchor:[0,-48]});
  }

  function driverStatus(driver){
    if(Number(driver.queue_position||0)>0)return `${driver.queue_position}º na fila`;
    if(Number(driver.active_delivery_count||0)>0)return `${driver.active_delivery_count} entrega(s) ativa(s)`;
    if(Number(driver.scheduled_here||0)===1)return 'Escalado nesta Base';
    return freshOnline(driver)?'Online na cooperativa':'Sem conexão recente';
  }

  function driverRows(data){
    const base=data.base||{},items=(data.items||[]).map(item=>({...item,distance_km:distanceKm(base.latitude,base.longitude,item.current_lat,item.current_lng)}));
    items.sort((a,b)=>{
      const aq=Number(a.queue_position||0),bq=Number(b.queue_position||0);
      if(aq||bq)return (aq||9999)-(bq||9999);
      if(freshOnline(a)!==freshOnline(b))return freshOnline(a)?-1:1;
      return (a.distance_km??99999)-(b.distance_km??99999);
    });
    if(!items.length)return '<div class="v30-empty"><strong>Nenhum cooperado disponível</strong><span>Os cooperados online, escalados ou na fila aparecerão aqui.</span></div>';
    return items.slice(0,10).map(driver=>`<button type="button" class="v30-driver-row" data-v30-driver="${esc(driver.id)}"><span class="v30-driver-dot ${freshOnline(driver)?'online':'offline'}"></span><div><strong>${esc(driver.name||'Cooperado')}</strong><small>${esc(driverStatus(driver))}${driver.distance_km!=null?` • ${driver.distance_km.toFixed(1).replace('.',',')} km da Base`:''}</small></div><em>${esc(relativeTime(driver.location_updated_at||driver.last_seen_at))}</em></button>`).join('');
  }

  function updateSummary(data){
    const items=data.items||[],online=items.filter(freshOnline).length,queue=items.filter(item=>Number(item.queue_position||0)>0).length,active=items.reduce((sum,item)=>sum+Number(item.active_delivery_count||0),0);
    const onlineEl=$id('v30-online-count'),queueEl=$id('v30-queue-count'),activeEl=$id('v30-active-count'),list=$id('v30-driver-list'),stamp=$id('v30-map-updated');
    if(onlineEl)onlineEl.textContent=String(online);
    if(queueEl)queueEl.textContent=String(queue);
    if(activeEl)activeEl.textContent=String(active);
    if(list)list.innerHTML=driverRows(data);
    if(stamp)stamp.textContent=`Atualizado ${new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
    document.querySelectorAll('[data-v30-driver]').forEach(button=>button.onclick=()=>focusDriver(button.dataset.v30Driver));
  }

  function focusDriver(id){
    const item=(V30.lastData?.items||[]).find(driver=>String(driver.id)===String(id));
    if(!item||item.current_lat==null||item.current_lng==null||!V30.map)return toast('Este cooperado ainda não enviou uma localização válida.','error');
    V30.map.setView([Number(item.current_lat),Number(item.current_lng)],16,{animate:true});
    V30.layer?.eachLayer(layer=>{if(String(layer.options?.driverId||'')===String(id))layer.openPopup()});
  }

  function drawMap(data,fit=true){
    const host=$id('v30-base-map');
    if(!host||typeof L==='undefined')return;
    const base=data.base||{};
    if(!V30.map){
      V30.map=L.map(host,{zoomControl:true,attributionControl:true}).setView([-5.7945,-35.211],12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(V30.map);
      V30.layer=L.layerGroup().addTo(V30.map);
    }
    V30.layer.clearLayers();
    const points=[];
    if(base.latitude!=null&&base.longitude!=null){
      const point=[Number(base.latitude),Number(base.longitude)];
      L.marker(point,{icon:baseIcon(),zIndexOffset:1000}).addTo(V30.layer).bindPopup(`<strong>${esc(base.name||'Base')}</strong><br>${esc(base.address||'')}`);
      points.push(point);
      L.circle(point,{radius:Number(base.checkin_radius_meters||250),className:'v30-base-radius',interactive:false}).addTo(V30.layer);
    }
    (data.items||[]).filter(item=>freshOnline(item)&&item.current_lat!=null&&item.current_lng!=null).forEach(driver=>{
      const point=[Number(driver.current_lat),Number(driver.current_lng)],distance=distanceKm(base.latitude,base.longitude,driver.current_lat,driver.current_lng);
      const marker=L.marker(point,{icon:markerIcon(driver),driverId:driver.id}).addTo(V30.layer).bindPopup(`<div class="v30-map-popup"><strong>${esc(driver.name||'Cooperado')}</strong><span>${esc(driverStatus(driver))}</span><span>${distance!=null?`${distance.toFixed(1).replace('.',',')} km da Base`:'Distância indisponível'}</span><small>${esc(relativeTime(driver.location_updated_at||driver.last_seen_at))}</small></div>`);
      points.push(point);
    });
    if(fit){
      if(points.length>1)V30.map.fitBounds(points,{padding:[42,42],maxZoom:15});
      else if(points.length===1)V30.map.setView(points[0],15);
      else V30.map.setView([-5.7945,-35.211],12);
    }
    setTimeout(()=>V30.map?.invalidateSize(),50);
  }

  async function loadMap(baseId,{fit=false,silent=false}={}){
    if(!baseId||state?.page!=='bases')return;
    try{
      const data=await api(`/api/app/v16/base/live-map?base_id=${encodeURIComponent(baseId)}`);
      if(baseId!==selectedBaseId()||!$id('v30-base-operations'))return;
      V30.lastData=data;
      updateSummary(data);
      drawMap(data,fit||!V30.map);
    }catch(error){
      if(!silent){
        const list=$id('v30-driver-list');
        if(list)list.innerHTML=`<div class="v30-empty error"><strong>Mapa temporariamente indisponível</strong><span>${esc(error.message||'Atualize a tela.')}</span></div>`;
      }
    }
  }

  function installShell(baseId,baseName){
    const content=$id('page-content');
    if(!content)return null;
    const section=document.createElement('section');
    section.id='v30-base-operations';
    section.className='v30-base-operations';
    section.innerHTML=`<div class="v30-map-card"><header><div><small>OPERAÇÃO EM TEMPO REAL</small><h2>Mapa da Base — ${esc(baseName||'Base')}</h2></div><div class="v30-map-actions"><span id="v30-map-updated">Carregando…</span><button type="button" class="btn small" id="v30-map-fit">Centralizar</button></div></header><div id="v30-base-map" class="v30-base-map" aria-label="Mapa dos cooperados online"></div><footer><span><i class="base"></i>Base</span><span><i class="online"></i>Cooperado online</span><span><i class="queue"></i>Na fila</span></footer></div><aside class="v30-command-card"><div class="v30-command-head"><small>CENTRAL DA BASE</small><h2>Lance entregas vendo a equipe</h2><p>O mapa permanece nesta tela e atualiza automaticamente.</p></div><div class="v30-live-stats"><span><b id="v30-online-count">0</b><small>online</small></span><span><b id="v30-queue-count">0</b><small>na fila</small></span><span><b id="v30-active-count">0</b><small>em entregas</small></span></div><button type="button" class="v30-new-delivery" id="v30-new-delivery"><span>＋</span><div><strong>Lançar nova entrega</strong><small>Coleta, destino, valor e cooperado</small></div></button><div class="v30-driver-list-head"><strong>Cooperados desta operação</strong><button type="button" id="v30-refresh-map">Atualizar</button></div><div class="v30-driver-list" id="v30-driver-list"><div class="v30-empty"><span>Consultando localizações…</span></div></div></aside>`;
    const quick=$id('v29-base-queue-quick');
    if(quick)quick.insertAdjacentElement('afterend',section);
    else content.prepend(section);
    $id('v30-new-delivery')?.addEventListener('click',()=>{
      const existing=$id('new-base-delivery');
      if(existing)return existing.click();
      toast('Aguarde o carregamento da Base e tente novamente.','error');
    });
    $id('v30-refresh-map')?.addEventListener('click',()=>loadMap(baseId,{fit:false}));
    $id('v30-map-fit')?.addEventListener('click',()=>V30.lastData&&drawMap(V30.lastData,true));
    return section;
  }

  async function install(){
    cleanup();
    if(!['cooperative_admin','dispatcher'].includes(state?.user?.role)||state?.page!=='bases')return;
    const select=$id('base-view-select'),baseId=selectedBaseId();
    if(!baseId)return;
    V30.baseId=baseId;
    installShell(baseId,select?.selectedOptions?.[0]?.textContent?.trim()||'Base');
    await loadMap(baseId,{fit:true});
    V30.timer=setInterval(()=>{
      if(state?.page!=='bases'||selectedBaseId()!==baseId||!$id('v30-base-operations'))return cleanup();
      if(!document.hidden)loadMap(baseId,{silent:true});
    },8000);
  }

  if(pages?.bases){
    const previous=pages.bases;
    pages.bases=async function(){
      await previous();
      await install();
    };
  }

  if(typeof navigate==='function'){
    const previousNavigate=navigate;
    navigate=async function(...args){
      if(args[0]!=='bases')cleanup();
      return previousNavigate.apply(this,args);
    };
  }

  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&state?.page==='bases'&&V30.baseId)loadMap(V30.baseId,{silent:true});
  });
})();


/* ===== chegaja-v31.js ===== */
/* ChegaJá 12.9 — Base operacional e aplicativo do cooperado */
(function(){
  const V31={baseMap:null,driverMap:null,baseLayer:null,driverLayer:null,baseTimer:null,driverTimer:null,offerTimer:null,baseId:'',legacy:null,baseData:null,driverData:null,baseRequest:0,baseLoading:false,driverLoading:false,driverRenderKey:'',driverMapDeliveryId:'',driverMapHost:null,driverMapFitted:false,baseRenderKey:''};
  const $id=id=>document.getElementById(id);
  const n=v=>Number(v||0);
  const safeDate=value=>{if(!value)return null;const raw=String(value);const d=new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw)?raw:raw.replace(' ','T')+'Z');return Number.isNaN(d.getTime())?null:d};
  const statusLabels={new:'Não atribuída',offered:'Disponível',assigned:'Aguardando aceite',accepted:'Aceita',to_pickup:'A caminho da coleta',at_pickup:'Na coleta',picked_up:'Coletada',in_route:'Em rota',delivered:'Entregue',cancelled:'Cancelada',problem:'Com problema'};
  const moneySafe=value=>typeof money==='function'?money(value):`R$ ${(n(value)/100).toFixed(2).replace('.',',')}`;
  const kmSafe=value=>`${(n(value)/1000).toFixed(1).replace('.',',')} km`;
  const minsSafe=value=>`${Math.max(1,Math.round(n(value)/60))} min`;
  const activeStatus=status=>!['delivered','cancelled'].includes(status);
  const currentPosition=()=>new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(resolve,()=>reject(new Error('Ative a localização do celular.')),{enableHighAccuracy:true,timeout:15000,maximumAge:5000}):reject(new Error('Localização indisponível.')));

  function stopBase(){clearInterval(V31.baseTimer);V31.baseTimer=null;V31.baseId='';if(V31.baseMap){try{V31.baseMap.remove()}catch{}V31.baseMap=null;V31.baseMapHost=null;V31.baseLayer=null}}
  function stopDriver(){clearInterval(V31.driverTimer);clearInterval(V31.offerTimer);V31.driverTimer=null;V31.offerTimer=null;if(V31.driverMap){try{V31.driverMap.remove()}catch{}V31.driverMap=null;V31.driverLayer=null}}
  function cleanup(page){if(page!=='bases')stopBase();if(page!=='dashboard')stopDriver()}

  function parseGeometry(raw){
    try{const g=typeof raw==='string'?JSON.parse(raw):raw;if(!g)return null;if(g.type==='Feature')return g;if(g.type==='LineString'||g.type==='MultiLineString')return {type:'Feature',properties:{},geometry:g};if(Array.isArray(g.coordinates))return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:g.coordinates}}}catch{}return null;
  }
  function driverDistance(driver,delivery){
    const vals=[driver?.current_lat,driver?.current_lng,delivery?.pickup_lat,delivery?.pickup_lng].map(Number);if(vals.some(v=>!Number.isFinite(v)))return 0;
    const [a,b,c,d]=vals;if(Math.abs(a)>90||Math.abs(c)>90||Math.abs(b)>180||Math.abs(d)>180||Math.abs(a)+Math.abs(b)<0.01||Math.abs(c)+Math.abs(d)<0.01)return 0;
    const rad=x=>x*Math.PI/180,R=6371000,dl=rad(c-a),dn=rad(d-b),h=Math.sin(dl/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dn/2)**2,meters=Math.round(2*R*Math.asin(Math.sqrt(h)));
    return meters>200000?0:meters;
  }
  function paymentText(item){
    const outstanding=n(item.outstanding_cents),base=n(item.base_charge_cents||item.charge_cents),paid=n(item.paid_cents),wait=n(item.wait_charge_cents);
    if(outstanding<=0)return 'Pago';
    if(base>0&&paid>=base&&wait>0)return `Corrida paga • espera pendente ${moneySafe(outstanding)}`;
    if(paid>0)return `Pago ${moneySafe(paid)} • restante ${moneySafe(outstanding)}`;
    const labels={pix:'PIX',dinheiro:'Dinheiro',cartao_credito:'Cartão de crédito',cartao_debito:'Cartão de débito',vale_alimentacao:'Vale-alimentação',vale_refeicao:'Vale-refeição',cortesia:'Cortesia',credit:'Crédito pré-pago',pix_cooperativa:'PIX Cooperativa'};return `${labels[item.payment_method]||String(item.payment_method||'Pagamento')} • pendente ${moneySafe(outstanding||item.charge_cents)}`;
  }
  function driverReceive(item){return n(item.driver_net_cents||item.driver_earnings_cents||item.driver_gross_cents)||Math.max(0,n(item.charge_cents)-n(item.cooperative_fee_cents))}

  async function getBaseBundle(baseId){
    const safe=async(fn,fallback)=>{try{return await fn()}catch(err){console.warn('Falha parcial na Base:',err);return fallback}};
    const creditPromise=state.user?.role==='cooperative_admin'
      ? safe(()=>api('/api/app/tenant/credit-requests'),{items:[]})
      : Promise.resolve({items:[]});
    const deliveries=await safe(()=>api(`/api/app/tenant/deliveries${query({base_id:baseId})}`),{items:[]});
    const [mapData,queue,formData,auto,credits]=await Promise.all([
      safe(()=>api(`/api/app/v16/base/live-map?base_id=${encodeURIComponent(baseId)}`),{items:[],base:null}),
      safe(()=>api(`/api/app/v10/queue?base_id=${encodeURIComponent(baseId)}`),{items:[]}),
      safe(()=>api(`/api/app/v16/base/delivery-form-data?base_id=${encodeURIComponent(baseId)}`),{attendants:[],drivers:[],bases:[]}),
      safe(()=>api(`/api/app/v17/base/${encodeURIComponent(baseId)}/auto-dispatch`),{base:{auto_dispatch_enabled:0}}),
      creditPromise
    ]);
    const items=Array.isArray(deliveries.items)?deliveries.items:[];
    const offerItems=items.filter(x=>['new','assigned'].includes(x.status)&&['auto_dispatch','driver_rejected','auto_dispatch_timeout','auto_dispatch_waiting'].includes(String(x.assignment_source||''))).slice(0,30);
    const offerPairs=await Promise.all(offerItems.map(x=>safe(()=>api(`/api/app/v17/base/deliveries/${x.id}/offers`).then(d=>[x.id,d.items||[]]),[x.id,[]])));
    const attempts=new Map(offerPairs);
    return {
      items,
      mapData:mapData||{items:[],base:null},
      queue:Array.isArray(queue.items)?queue.items:[],
      formData:formData||{attendants:[],drivers:[],bases:[]},
      auto:(auto&&auto.base)||{auto_dispatch_enabled:0},
      credits:Array.isArray(credits.items)?credits.items:[],
      attempts
    };
  }

  function sortDeliveries(items){
    const rank=x=>!activeStatus(x.status)?9:!x.assigned_driver_id?0:x.status==='assigned'?1:['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(x.status)?2:3;
    return [...items].sort((a,b)=>rank(a)-rank(b)||String(a.created_at||'').localeCompare(String(b.created_at||'')));
  }
  function queuePopover(queue){
    return queue.length?queue.map((x,i)=>`<div><b>${i+1}</b><span><strong>${esc(x.driver_name||'Cooperado')}</strong><small>${esc([x.vehicle_model,x.vehicle_plate].filter(Boolean).join(' • ')||'Sem veículo informado')}</small></span><em>${x.arrived_at?dateTime(x.arrived_at):''}</em></div>`).join(''):'<p>Nenhum cooperado aguardando.</p>';
  }
  function lastRefusal(attempts){return (attempts||[]).find(x=>x.status==='rejected')||null}
  function baseDeliveryRows(items,attemptMap){
    const rows=sortDeliveries(items);
    if(!rows.length)return '<div class="v31-empty">Nenhuma entrega encontrada nesta Base.</div>';
    return rows.map(x=>{const refusal=lastRefusal(attemptMap.get(x.id)),unassigned=!x.assigned_driver_id&&activeStatus(x.status),closed=!activeStatus(x.status),dispatchLabel=x.dispatch_mode==='automatic'?'automática':x.dispatch_mode==='manual'?'manual':'sem atribuição';return `<article data-delivery-id="${x.id}" class="v31-delivery-row ${unassigned?'is-unassigned':''} ${closed?'is-closed':''}" data-status="${esc(x.status)}" data-active="${closed?'0':'1'}" data-created="${esc(String(x.created_at||''))}">
      <div class="v31-order-code"><strong>${esc(x.display_code||'Entrega')}</strong><small>${dateTime(x.created_at)}</small>${x.scheduled_for?`<em class="v149-scheduled-pill">Agendada ${dateTime(x.scheduled_for)} • ${dispatchLabel}</em>`:''}${unassigned?'<span>PRIORIDADE</span>':''}</div>
      <div data-cj-field="customer_name"><small>Cliente</small><strong>${esc(x.customer_name||x.recipient_name||'Cliente')}</strong><span>${esc(x.customer_phone||'')}</span></div>
      <div class="v31-address" data-cj-field="pickup_address"><small>Coleta</small><strong>${esc(x.pickup_address||'')}</strong></div>
      <div class="v31-address" data-cj-field="delivery_address"><small>Entrega</small><strong>${esc(x.delivery_address||'')}</strong></div>
      <div data-cj-field="driver_id"><small>Cooperado</small><strong>${esc(x.driver_name||'Não atribuído')}</strong>${refusal?`<span class="v31-refusal">${esc(refusal.driver_name)} recusou: ${esc(refusal.rejection_reason||'sem motivo')}</span>`:''}</div>
      <div data-cj-field="charge_value"><small>Valor da entrega</small><strong>${moneySafe(x.charge_cents)}</strong>${x.delivery_type!=='base'&&n(x.amount_to_collect_cents)>0?`<span>Receber produto/refeição: ${moneySafe(x.amount_to_collect_cents)}</span>`:''}</div>
      <div data-cj-field="payment_method"><small>Pagamento</small><strong>${esc(({pix:'PIX',dinheiro:'Dinheiro',cartao_credito:'Cartão de crédito',cartao_debito:'Cartão de débito',vale_alimentacao:'Vale-alimentação',vale_refeicao:'Vale-refeição',cortesia:'Cortesia',credit:'Crédito pré-pago',pix_cooperativa:'PIX Cooperativa'}[x.payment_method]||x.payment_method||'Não informado'))}</strong><span>${esc(x.payment_status==='paid'?'Pago':x.payment_status==='partial'?'Parcial':'Pendente')}</span></div>
      <div data-cj-field="status"><small>Status</small><span class="v31-status s-${esc(x.status)}">${esc(statusLabels[x.status]||x.status)}</span></div>
      <div class="v31-row-actions"><button data-v31-edit="${x.id}" title="Editar toda a entrega">✎</button><button data-v31-detail="${x.id}" title="Detalhes">◉</button>${activeStatus(x.status)?`<button data-v31-assign="${x.id}" title="Atribuir cooperado">♟+</button><button data-cj-cancel="${x.id}" class="danger" title="Cancelar entrega">×</button>`:''}${x.tracking_token?`<button data-v31-track="${x.id}" title="Copiar rastreio avulso">⌖</button>`:''}<button data-v31-chat="${x.id}" title="Chat e contato">◌</button><button data-v31-clone="${x.id}" title="Clonar entrega">⧉</button>${n(x.outstanding_cents)>0?`<button data-v31-settle="${x.id}" class="attention" title="Quitar somente o restante">$</button>`:''}${(attemptMap.get(x.id)||[]).length?`<button data-v31-attempts="${x.id}" title="Tentativas e recusas">↻</button>`:''}</div>
    </article>`}).join('');
  }
  function baseSummary(bundle){
    const active=bundle.items.filter(x=>activeStatus(x.status)),unassigned=active.filter(x=>!x.assigned_driver_id),inProgress=active.filter(x=>x.assigned_driver_id),delivered=bundle.items.filter(x=>x.status==='delivered'),available=(bundle.mapData.items||[]).filter(x=>n(x.online)===1&&n(x.active_delivery_count)===0);
    return `<div class="v31-summary"><article><i>▣</i><strong>${active.length}</strong><span>Entregas ativas</span></article><article class="orange"><i>!</i><strong>${unassigned.length}</strong><span>Não atribuídas</span></article><article class="green"><i>✓</i><strong>${delivered.length}</strong><span>Concluídas</span></article><article class="purple"><i>●</i><strong>${inProgress.length}</strong><span>Em andamento</span></article><article class="blue"><i>♟</i><strong>${available.length}</strong><span>Disponíveis</span></article></div>`;
  }
  function baseSide(bundle){
    const attendants=bundle.formData.attendants||[],credits=(bundle.credits||[]).filter(x=>x.status==='pending'),queue=bundle.queue||[];
    return `<aside class="v31-base-side">
      <section><header><h3>Atendentes ativos</h3><span>${attendants.length}</span></header>${attendants.slice(0,5).map(x=>`<div class="v31-person"><i></i><strong>${esc(x.name)}</strong><small>Online</small></div>`).join('')||'<p class="muted">Nenhum atendente vinculado.</p>'}<button id="v31-open-attendants">Ver atendentes</button></section>
      <section><header><h3>Fila da Base</h3><span>${queue.length}</span></header>${queue.slice(0,6).map((x,i)=>`<div class="v31-queue-row"><b>${i+1}</b><span><strong>${esc(x.driver_name)}</strong><small>${esc(x.vehicle_plate||'')}</small></span><em>${x.arrived_at?dateTime(x.arrived_at):''}</em></div>`).join('')||'<p class="muted">Nenhum cooperado aguardando.</p>'}</section>
      ${state.user?.role==='cooperative_admin'?`<section class="v31-credit-card"><header><h3>Créditos solicitados</h3><span>${credits.length}</span></header>${credits.slice(0,4).map(x=>`<div class="v31-credit-request"><span><strong>${esc(x.customer_name)}</strong><small>${moneySafe(x.amount_cents)}</small></span><div><button data-v31-credit-approve="${x.id}">Aprovar</button><button data-v31-credit-reject="${x.id}">Recusar</button></div></div>`).join('')||'<p class="muted">Nenhuma solicitação pendente.</p>'}<button data-page="credits">Abrir créditos</button></section>`:''}
    </aside>`;
  }

  async function drawBaseMap(bundle){
    const host=$id('v31-base-map');if(!host||!window.ChegaJaMaps?.createMap)return;
    if(V31.baseMapHost!==host){if(V31.baseMap)try{V31.baseMap.remove()}catch{}V31.baseMap=null;V31.baseMapHost=host;V31.baseMapFitted=false}
    if(!V31.baseMap){
      try{V31.baseMap=await window.ChegaJaMaps.createMap(host,{center:[-5.7945,-35.211],zoom:12,zoomControl:true})}
      catch(error){if(host.isConnected)host.innerHTML=`<div class="cj149-map-error"><div><strong>Mapa não carregado</strong>${esc(error.message)}</div></div>`;return}
    }
    const map=V31.baseMap;map.clearGroup('base-live');map.clearGroup('base-routes');const points=[],base=bundle.mapData.base||{};
    if(base.latitude!=null&&base.longitude!=null){const p=[n(base.latitude),n(base.longitude)];map.addMarker(p,{group:'base-live',color:'#0d257a',label:'B',title:base.name||'Base',popup:`<strong>${esc(base.name)}</strong>`});points.push(p)}
    (bundle.mapData.items||[]).filter(x=>n(x.online)===1&&x.current_lat!=null&&x.current_lng!=null).forEach(x=>{const p=[n(x.current_lat),n(x.current_lng)];map.addMarker(p,{group:'base-live',color:n(x.queue_position)>0?'#ef8b18':'#0d45d8',label:n(x.queue_position)>0?String(n(x.queue_position)):'M',title:x.name||'Cooperado',popup:`<strong>${esc(x.name)}</strong><br>${n(x.queue_position)>0?`${x.queue_position}º na fila`:'Online'}`});points.push(p)});
    bundle.items.filter(x=>activeStatus(x.status)&&x.pickup_lat!=null&&x.pickup_lng!=null).slice(0,12).forEach(x=>{const p=[n(x.pickup_lat),n(x.pickup_lng)];map.addCircleMarker(p,{group:'base-live',color:'#16a05e',label:'C',popup:`<strong>${esc(x.display_code)}</strong><br>Coleta`,radius:7,weight:2});points.push(p);if(x.route_geometry)try{map.addGeoJSON(x.route_geometry,{group:'base-routes',color:'#0d45d8',weight:4,opacity:.7})}catch{}});
    if(!V31.baseMapFitted){if(points.length>1)map.fitBounds(points,{padding:35,maxZoom:15});else if(points.length===1)map.setView(points[0],15);V31.baseMapFitted=true}setTimeout(()=>map.invalidateSize?.(),60);
  }

  async function loadBaseCatalogV146(){
    const result=await api('/api/app/tenant/bases');
    const bases=Array.isArray(result.items)?result.items:[];
    state.cache.bases=bases;
    return bases;
  }
  async function currentBaseData(){
    const data=await lgBase(true);let bases=Array.isArray(data.bases)?data.bases:[];
    if(!bases.length)bases=await loadBaseCatalogV146();
    data.bases=bases;const base=bases.find(x=>x.id===V31.baseId)||bases[0];return {data,base};
  }
  function copyValue(value){if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(value).then(()=>toast('Link copiado.'));const input=document.createElement('textarea');input.value=value;document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();toast('Link copiado.')}
  function applyBaseFilters(){
    const scope=$id('v31-scope-filter')?.value||'active',status=$id('v31-status-filter')?.value||'';
    const today=isoDate();
    document.querySelectorAll('.v31-delivery-row').forEach(row=>{
      const isActive=row.dataset.active==='1',isToday=String(row.dataset.created||'').slice(0,10)===today;
      const scopeOk=scope==='all'||(scope==='active'&&isActive)||(scope==='closed'&&!isActive)||(scope==='closed_today'&&!isActive&&isToday);
      const statusOk=!status||row.dataset.status===status;
      row.classList.toggle('hidden',!(scopeOk&&statusOk));
    });
    const title=$id('v31-delivery-title');if(title)title.textContent=scope==='active'?'Entregas ativas':scope==='closed_today'?'Encerradas hoje':scope==='closed'?'Entregas encerradas':'Todas as entregas';
  }
  async function bindBase(bundle,bases){
    const select=$id('v31-base-select');if(select)select.onchange=e=>{state.cache.baseViewId=e.target.value;pages.bases()};
    const filter=$id('v31-status-filter');if(filter)filter.onchange=applyBaseFilters;const scope=$id('v31-scope-filter');if(scope)scope.onchange=()=>{state.cache.baseListScope=scope.value;applyBaseFilters()};applyBaseFilters();
    $id('v31-new-delivery').onclick=async()=>{const {data}=await currentBaseData();if(window.ChegaJaV16?.baseOrderForm)return window.ChegaJaV16.baseOrderForm(data);toast('Formulário de entrega indisponível.','error')};
    $id('v31-pricing').onclick=async()=>{const {base}=await currentBaseData();if(base&&window.ChegaJaV16?.pricingModal)return window.ChegaJaV16.pricingModal(base);toast('Precificação indisponível.','error')};
    $id('v31-attendants').onclick=async()=>{const {base}=await currentBaseData();if(base&&window.ChegaJaV16?.attendantsModal)return window.ChegaJaV16.attendantsModal(base);toast('Atendentes indisponíveis.','error')};
    $id('v31-open-attendants')?.addEventListener('click',async()=>{const {base}=await currentBaseData();if(base&&window.ChegaJaV16?.attendantsModal)window.ChegaJaV16.attendantsModal(base)});
    document.querySelectorAll('[data-v31-detail]').forEach(b=>b.onclick=()=>deliveryDetail(bundle.items.find(x=>x.id===b.dataset.v31Detail)));
    document.querySelectorAll('[data-v31-edit]').forEach(b=>b.onclick=async()=>{const item=bundle.items.find(x=>x.id===b.dataset.v31Edit),{data}=await currentBaseData();if(item&&window.ChegaJaV16?.quickEdit)return window.ChegaJaV16.quickEdit(item,data);toast('Edição indisponível.','error')});
    document.querySelectorAll('[data-v31-assign]').forEach(b=>b.onclick=()=>window.ChegaJaV32?.assignFromBase?window.ChegaJaV32.assignFromBase(b.dataset.v31Assign):toast('Atribuição indisponível.','error'));
    document.querySelectorAll('[data-v31-track]').forEach(b=>b.onclick=()=>{const item=bundle.items.find(x=>x.id===b.dataset.v31Track);if(item?.tracking_token)copyValue(`${location.origin}/r/${item.tracking_token}`)});
    document.querySelectorAll('[data-v31-chat]').forEach(b=>b.onclick=()=>openDeliveryChat(bundle.items.find(x=>x.id===b.dataset.v31Chat)));
    document.querySelectorAll('[data-v31-clone]').forEach(b=>b.onclick=async()=>{if(!confirm('Clonar esta entrega?'))return;try{loading(true);const r=await api(`/api/app/v7/base/deliveries/${b.dataset.v31Clone}/clone`,{method:'POST',body:{}});toast(`Nova entrega ${r.item?.display_code||''} criada.`);await pages.bases();loading(false);if(r.item?.id&&window.ChegaJaV32?.assignFromBase)await window.ChegaJaV32.assignFromBase(r.item.id)}catch(e){toast(e.message,'error')}finally{loading(false)}});
    document.querySelectorAll('[data-v31-attempts]').forEach(b=>b.onclick=()=>showAttempts(bundle.items.find(x=>x.id===b.dataset.v31Attempts),bundle.attempts.get(b.dataset.v31Attempts)||[]));
    document.querySelectorAll('[data-v31-settle]').forEach(b=>b.onclick=()=>settleModal(bundle.items.find(x=>x.id===b.dataset.v31Settle)));
    const queueButton=$id('v31-queue-button'),queueQuick=queueButton?.closest('.v31-queue-quick');if(queueButton&&queueQuick){queueButton.onclick=e=>{e.stopPropagation();queueQuick.classList.toggle('open')};document.addEventListener('click',e=>{if(!queueQuick.contains(e.target))queueQuick.classList.remove('open')},{once:true})};
    const auto=$id('v31-auto-toggle');if(auto){auto.checked=n(bundle.auto.auto_dispatch_enabled)===1;auto.onchange=async()=>{try{loading(true);await api(`/api/app/v17/base/${V31.baseId}/auto-dispatch`,{method:'PUT',body:{enabled:auto.checked,response_seconds:25,max_active:3}});toast(auto.checked?'Distribuição automática ligada.':'Distribuição automática desligada.');await loadBaseDashboard(false)}catch(e){auto.checked=!auto.checked;toast(e.message,'error')}finally{loading(false)}}};
    document.querySelectorAll('[data-v31-credit-approve]').forEach(b=>b.onclick=()=>reviewCreditV31(b.dataset.v31CreditApprove,'approved'));
    document.querySelectorAll('[data-v31-credit-reject]').forEach(b=>b.onclick=()=>reviewCreditV31(b.dataset.v31CreditReject,'rejected'));
    document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
  }
  function showAttempts(item,attempts){openModal(`Tentativas • ${item?.display_code||'Entrega'}`,attempts.length?`<div class="v31-attempt-list">${attempts.map(x=>`<article><header><strong>${esc(x.driver_name)}</strong><span class="v31-status s-${esc(x.status)}">${esc(x.status)}</span></header><p>${x.rejection_reason?`Motivo: ${esc(x.rejection_reason)}`:'Sem motivo registrado.'}</p><small>${kmSafe(x.distance_to_pickup_meters)} até a coleta • ${dateTime(x.offered_at)}</small></article>`).join('')}</div>`:'<p>Nenhuma tentativa registrada.</p>')}
  function settleModal(item){if(!item)return;openModal(`Quitar restante • ${item.display_code}`,`<form id="v31-settle-form" class="form-grid"><div class="full notice"><strong>Valor original: ${moneySafe(item.base_charge_cents)}</strong><br>Espera/adicionais: ${moneySafe(item.wait_charge_cents)}<br>Já pago: ${moneySafe(item.paid_cents)}<br><b>Restante: ${moneySafe(item.outstanding_cents)}</b></div><label>Forma de quitação<select name="source"><option value="external">Pagamento recebido fora do crédito</option><option value="credit">Debitar do crédito do cliente</option></select></label><label>Meio de pagamento<select name="payment_method"><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option><option value="credit">Crédito pré-pago</option></select></label><label class="full">Observação<textarea name="notes" placeholder="Ex.: cliente pagou o excedente da espera"></textarea></label><label class="full">Comprovante (opcional)<input name="proof_url" type="url"></label><div class="form-actions"><button class="btn primary">Confirmar quitação</button></div></form>`);$id('v31-settle-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/v17/base/deliveries/${item.id}/settle-outstanding`,{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Restante quitado e registrado.');loadBaseDashboard(false)}catch(err){toast(err.message,'error')}finally{loading(false)}}}
  async function reviewCreditV31(id,decision){if(!confirm(decision==='approved'?'Aprovar e liberar este crédito?':'Recusar esta solicitação?'))return;try{loading(true);await api(`/api/app/tenant/credit-requests/${id}/review`,{method:'POST',body:{decision}});toast('Solicitação atualizada.');loadBaseDashboard(false)}catch(e){toast(e.message,'error')}finally{loading(false)}}

  async function loadBaseDashboard(rebuildMap=true){
    if(state.page!=='bases'||!V31.baseId||V31.baseLoading)return;
    const request=++V31.baseRequest;V31.baseLoading=true;
    try{
      const bundle=await getBaseBundle(V31.baseId);
      if(request!==V31.baseRequest||state.page!=='bases')return;
      V31.baseData=bundle;if(window.ChegaJaV31)window.ChegaJaV31.baseData=bundle;
      const renderKey=JSON.stringify({
        items:(bundle.items||[]).map(x=>[x.id,x.status,x.assigned_driver_id,x.planned_driver_id,x.scheduled_for,x.dispatch_mode,x.charge_cents,x.amount_to_collect_cents,x.payment_method,x.payment_status,x.customer_name,x.pickup_address,x.delivery_address,x.updated_at]),
        queue:(bundle.queue||[]).map(x=>[x.id,x.driver_id,x.queue_order,x.status,x.updated_at]),
        credits:(bundle.credits||[]).map(x=>[x.id,x.status,x.amount_cents,x.updated_at]),
        auto:n(bundle.auto.auto_dispatch_enabled)
      });
      if(V31.baseRenderKey!==renderKey){
        V31.baseRenderKey=renderKey;
        const list=$id('v31-deliveries');if(list)list.innerHTML=baseDeliveryRows(bundle.items,bundle.attempts);applyBaseFilters();
        const summary=$id('v31-summary-host');if(summary)summary.innerHTML=baseSummary(bundle);
        const side=$id('v31-side-host');if(side)side.innerHTML=baseSide(bundle);
        const q=$id('v31-queue-popover');if(q)q.innerHTML=queuePopover(bundle.queue);
        const count=$id('v31-queue-count');if(count)count.textContent=String(bundle.queue.length);
        const auto=$id('v31-auto-toggle');if(auto)auto.checked=n(bundle.auto.auto_dispatch_enabled)===1;
        await bindBase(bundle,[]);
      }
      drawBaseMap(bundle);
    }catch(e){
      console.error('Falha ao atualizar Base:',e);
      const list=$id('v31-deliveries');if(list)list.innerHTML=`<div class="v31-empty v31-error">${esc(e.message||'Não foi possível carregar as entregas.')} <button id="v31-retry-list">Tentar novamente</button></div>`;
      $id('v31-retry-list')?.addEventListener('click',()=>loadBaseDashboard(true));
      toast(e.message||'Falha ao carregar a Base.','error');
    }finally{V31.baseLoading=false}
  }

  async function installBase(){
    stopBase();
    const content=$id('page-content');if(!content)return;
    content.innerHTML='<section class="panel"><div class="empty"><strong>Carregando a Base…</strong><span>Consultando cadastro, mapa, fila e entregas.</span></div></section>';
    let data,bases;
    try{
      const catalog=await loadBaseCatalogV146();
      data=await lgBase(true);bases=catalog;data.bases=bases;state.cache.bases=bases;
    }catch(error){
      content.innerHTML=`<section class="v31-no-base v146-base-error"><div><h2>A Base não carregou</h2><p>${esc(error.message||'Não foi possível consultar as Bases desta cooperativa.')}</p><button id="v146-retry-base" class="btn primary">Tentar carregar novamente</button></div></section>`;
      $id('v146-retry-base')?.addEventListener('click',()=>installBase());
      toast(error.message||'Falha ao carregar a Base.','error');return;
    }
    if(!bases.length){
      content.innerHTML=`<section class="v31-no-base"><div><h2>Nenhuma Base cadastrada</h2><p>Cadastre a primeira Base para abrir o mapa, a fila e as entregas.</p><button id="v31-create-first-base" class="btn primary">＋ Cadastrar Base</button></div></section>`;
      $id('v31-create-first-base').onclick=()=>typeof baseForm==='function'?baseForm():toast('Cadastro de Base indisponível.','error');
      return;
    }
    const baseId=bases.some(x=>x.id===state.cache.baseViewId)?state.cache.baseViewId:bases[0].id;state.cache.baseViewId=baseId;V31.baseId=baseId;V31.baseMapFitted=false;V31.baseRenderKey='';
    const selected=bases.find(x=>x.id===baseId)||bases[0];
    content.innerHTML=`<section class="v31-base-shell"><header class="v31-base-title"><div><p>${esc(state.user?.cooperative_name||'COOPERATIVA')}</p><div class="v31-title-row"><h1>${esc(selected.name||'Base')}</h1><div class="v31-queue-quick"><button type="button" id="v31-queue-button">Fila <b id="v31-queue-count">0</b></button><div id="v31-queue-popover" class="v31-queue-popover"></div></div></div></div><div class="v31-base-top-actions"><label class="v31-auto"><span>Distribuição automática</span><input id="v31-auto-toggle" type="checkbox"><i></i></label></div></header>
      <div class="v31-toolbar"><select id="v31-base-select">${bases.map(x=>`<option value="${x.id}" ${x.id===baseId?'selected':''}>${esc(x.name)}</option>`).join('')}</select><select id="v31-scope-filter"><option value="active">Ativas</option><option value="closed_today">Encerradas hoje</option><option value="closed">Todas encerradas</option><option value="all">Todas</option></select><select id="v31-status-filter"><option value="">Todos os status</option>${Object.entries(statusLabels).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select><button id="v31-new-delivery" class="primary">＋ Nova entrega</button><button id="v31-pricing">Precificação</button><button id="v31-attendants">Atendentes</button><button id="v31-complete-today" title="Marcar todas as entregas ativas de hoje como entregues">✓ Entregar todas de hoje</button></div>
      <div class="v31-base-layout"><main><section class="v31-map-card"><div id="v31-base-map"></div><button id="v31-map-full">Tela cheia</button></section><div id="v31-summary-host"></div><section class="v31-deliveries-card"><header><div><h2 id="v31-delivery-title">Entregas ativas</h2><p>As não atribuídas ficam primeiro. Use o filtro para ver as encerradas.</p></div><button id="v31-refresh">Atualizar</button></header><div id="v31-deliveries"><div class="v31-empty">Carregando entregas…</div></div></section></main><div id="v31-side-host"></div></div></section>`;
    const scopeSelect=$id('v31-scope-filter');if(scopeSelect)scopeSelect.value=state.cache.baseListScope||'active';
    $id('v31-refresh').onclick=()=>loadBaseDashboard(false);
    $id('v31-map-full').onclick=()=>{const host=$id('v31-base-map');if(host?.requestFullscreen)host.requestFullscreen()};
    $id('v31-complete-today').onclick=async()=>{if(!confirm('Marcar todas as entregas ativas de hoje desta Base como entregues?'))return;try{loading(true);const r=await api('/api/app/v15/base/deliveries/complete-today',{method:'POST',body:{base_id:baseId}});toast(`${r.count||0} entrega(s) marcada(s) como entregue(s).`);await loadBaseDashboard(false)}catch(e){toast(e.message,'error')}finally{loading(false)}};
    await loadBaseDashboard(true);
    V31.baseTimer=setInterval(async()=>{if(state.page!=='bases'||V31.baseId!==state.cache.baseViewId)return stopBase();if(!document.hidden){try{if(V31.baseData?.auto?.auto_dispatch_enabled)await api(`/api/app/v17/base/${V31.baseId}/auto-dispatch/tick`,{method:'POST',body:{}})}catch{}await loadBaseDashboard(false)}},15000);
  }

  function driverHeader(data){return `<header class="v31-driver-header"><button id="v31-driver-menu">☰</button><div class="v31-driver-brand"><img src="/icons/logo-official.png" alt="ChegaJá"><small>COOPEX ENTREGAS</small></div><button id="v31-driver-online" class="${data.online?'online':''}"><i></i>${data.online?'Online':'Offline'}⌄</button><button id="v31-driver-alert">♧</button></header>`}
  function metricsCards(metrics,driver,delivery){
    const stored=n(metrics?.distance_to_pickup_meters),calculated=driverDistance(driver,delivery),toPickup=stored>0&&stored<200000?stored:calculated;
    const route=n(delivery.distance_meters),total=(toPickup||0)+route,kmPerLiter=n(metrics?.fuel_km_per_liter),fuelPrice=n(metrics?.fuel_price_cents),liters=kmPerLiter>0&&total>0?(total/1000)/kmPerLiter:0,fuel=Math.round(liters*fuelPrice);
    const pickupLabel=toPickup>0?kmSafe(toPickup):'Aguardando GPS';
    const totalLabel=total>0?kmSafe(total):'Aguardando rota';
    return `<div class="v31-driver-metrics"><article><i>●</i><small>Até a coleta</small><strong>${pickupLabel}</strong></article><article><i>〽</i><small>Distância total</small><strong>${totalLabel}</strong></article><article><i>⛽</i><small>Gasto estimado</small><strong>${total>0&&kmPerLiter>0?moneySafe(fuel):'—'}</strong><span>Combustível</span></article><article><i>◷</i><small>Tempo estimado</small><strong>${minsSafe(delivery.duration_seconds)}</strong></article></div>`;
  }
  function driverFinancial(item){const out=n(item.outstanding_cents),base=n(item.base_charge_cents||item.charge_cents),wait=n(item.wait_charge_cents),paid=n(item.paid_cents);return `<div class="v31-driver-finance"><div><small>Você recebe</small><strong>${moneySafe(driverReceive(item))}</strong></div><div><small>Valor da corrida</small><strong>${moneySafe(base)}</strong></div><div><small>Espera/adicionais</small><strong>${moneySafe(wait)}</strong></div><div class="${out>0?'pending':'paid'}"><small>${out>0?'Restante pendente':'Pagamento'}</small><strong>${out>0?moneySafe(out):'Quitado'}</strong><span>${esc(paymentText(item))}</span></div></div>`}
  function nextAction(item){return {assigned:['ACEITAR ENTREGA','accept'],accepted:['IR PARA COLETA','to_pickup'],to_pickup:['CHEGUEI NA COLETA','at_pickup'],at_pickup:['COLETA REALIZADA','picked_up'],picked_up:['INICIAR ENTREGA','in_route'],in_route:['FINALIZAR ENTREGA','complete_v14'],problem:['FINALIZAR ENTREGA','complete_v14']}[item.status]||null}
  function offerCountdown(metrics){if(!metrics?.offer_expires_at)return '';const end=safeDate(metrics.offer_expires_at);if(!end)return '';return `<span class="v31-offer-countdown" data-v31-offer-end="${end.getTime()}">Tempo para responder: <b>--</b></span>`}
  function driverDeliveryCard(item,metrics,driver){const action=nextAction(item),assigned=item.status==='assigned',navigation=!assigned;return `<section class="v31-current-card ${navigation?'navigation-compact':''}"><header><h2>${assigned?'Nova entrega':'Entrega atual'}</h2><span>${esc(statusLabels[item.status]||item.status)}</span></header>${driverFinancial(item)}${item.delivery_type!=='base'&&n(item.amount_to_collect_cents)>0?`<div class="v31-collect-amount"><small>VALOR DO PRODUTO/REFEIÇÃO A RECEBER</small><strong>${moneySafe(item.amount_to_collect_cents)}</strong><span>${esc(paymentText(item))}</span></div>`:''}<div class="v31-route-flow"><div><i class="pickup"></i><span><small>COLETA</small><strong>${esc(item.pickup_address)}</strong><em>${esc(item.pickup_neighborhood||'')}</em></span></div><div><i class="drop"></i><span><small>ENTREGA</small><strong>${esc(item.delivery_address)}</strong><em>${esc(item.delivery_neighborhood||'')}</em></span></div></div>${metricsCards(metrics,driver,item)}${offerCountdown(metrics)}<div id="v31-wait-host"></div><div class="v31-driver-actions">${action?`<button id="v31-main-action" class="main" data-action="${action[1]}">${action[0]}</button>`:''}${assigned?'<button id="v31-reject-delivery" class="reject" aria-label="Recusar">×</button>':''}<button id="v31-driver-details">Detalhes</button><button id="v31-driver-chat">Chat</button></div></section>`}
  function driverBottom(){return `<nav class="v31-driver-bottom"><button data-v31-nav="dashboard" class="active"><i>⌂</i>Início</button><button data-v31-nav="deliveries"><i>▢</i>Entregas</button><button id="v31-bottom-sos" class="sos"><i>!</i>SOS</button><button data-v31-nav="financial"><i>$</i>Ganhos</button><button data-v31-nav="profile"><i>○</i>Perfil</button></nav>`}
  async function driverMap(item,driver,forceFit=false){
    const host=$id('v31-driver-map');if(!host||!window.ChegaJaMaps?.createMap)return;
    const newHost=V31.driverMapHost!==host;
    if(newHost||!V31.driverMap){
      if(V31.driverMap)try{V31.driverMap.remove()}catch{}
      V31.driverMapHost=host;V31.driverMap=null;
      try{V31.driverMap=await window.ChegaJaMaps.createMap(host,{center:[n(driver.current_lat)||-5.7945,n(driver.current_lng)||-35.211],zoom:13,zoomControl:false})}catch(error){if(host.isConnected)host.innerHTML=`<div class="cj149-map-error"><div><strong>Mapa não carregado</strong>${esc(error.message)}</div></div>`;return}
      if(V31.driverMapHost!==host){try{V31.driverMap.remove()}catch{}return}
      V31.driverMapFitted=false;
    }
    const map=V31.driverMap;map.clearGroup('driver');map.clearGroup('route');const pts=[];
    if(driver.current_lat!=null&&driver.current_lng!=null){const p=[n(driver.current_lat),n(driver.current_lng)];map.addCircleMarker(p,{group:'driver',color:'#0d45d8',label:'EU',popup:'Sua localização',radius:10,weight:4});pts.push(p)}
    if(item.pickup_lat!=null&&item.pickup_lng!=null){const p=[n(item.pickup_lat),n(item.pickup_lng)];map.addMarker(p,{group:'driver',color:'#16a05e',label:'C',title:'Coleta',popup:'Coleta'});pts.push(p)}
    if(item.delivery_lat!=null&&item.delivery_lng!=null){const p=[n(item.delivery_lat),n(item.delivery_lng)];map.addMarker(p,{group:'driver',color:'#f05a24',label:'E',title:'Entrega',popup:'Entrega'});pts.push(p)}
    if(item.route_geometry)try{map.addGeoJSON(item.route_geometry,{group:'route',color:'#0d45d8',weight:6,opacity:.85})}catch{}
    const deliveryChanged=V31.driverMapDeliveryId!==item.id;V31.driverMapDeliveryId=item.id;
    if(forceFit||deliveryChanged||!V31.driverMapFitted){if(pts.length>1)map.fitBounds(pts,{padding:45,maxZoom:15});else if(pts.length===1)map.setView(pts[0],15);V31.driverMapFitted=true}
    setTimeout(()=>map.invalidateSize?.(),80);
  }
  async function renderWait(item){const host=$id('v31-wait-host'),primary=$id('v31-main-action');if(!host||item.delivery_type!=='base'||['assigned','new','accepted','delivered','cancelled'].includes(item.status))return;try{const s=await api(`/api/app/v16/deliveries/${item.id}/wait`),active=s.active,ended=s.items||[];let ownsPrimary=false;if(active){ownsPrimary=true;const free=n(active.free_seconds),start=safeDate(active.started_at)?.getTime()||Date.now();host.innerHTML=`<section class="v31-wait-card" data-start="${start}" data-free="${free}" data-rate="${n(active.rate_cents_per_15m)}"><header><span>${n(active.charging)?'TEMPO SENDO COBRADO':'TEMPO LIVRE'}</span><strong data-clock>00:00</strong></header><div><span>Tempo total <b data-total>00:00</b></span><span>Cobrança <b data-charge>${moneySafe(active.charge_cents)}</b></span></div><button id="v31-stop-wait">${active.stage==='pickup'?'COLETA REALIZADA':'ENCERRAR TEMPO NA ENTREGA'}</button></section>`;$id('v31-stop-wait').onclick=()=>stopWait(item,active.stage);tickWait()}else{const pickup=ended.some(x=>x.stage==='pickup'),drop=ended.some(x=>x.stage==='delivery'),needPickup=['to_pickup','at_pickup'].includes(item.status)&&!pickup,needDrop=['picked_up','in_route','problem'].includes(item.status)&&!drop;ownsPrimary=needPickup||needDrop;host.innerHTML=needPickup?'<button class="v31-arrive" data-stage="pickup">CHEGUEI NA COLETA</button>':needDrop?'<button class="v31-arrive" data-stage="delivery">CHEGUEI NA ENTREGA</button>':pickup&&drop?`<div class="v31-wait-ended">Espera total: <strong>${moneySafe(s.delivery?.wait_charge_cents)}</strong></div>`:'';host.querySelector('[data-stage]')?.addEventListener('click',e=>arriveWait(item,e.currentTarget.dataset.stage))}primary?.classList.toggle('hidden',ownsPrimary)}catch(e){host.innerHTML=`<p class="v31-error">${esc(e.message)}</p>`}}
  function fmtSeconds(v){const t=Math.max(0,Math.floor(v)),m=Math.floor(t/60),s=t%60;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
  function tickWait(){const box=document.querySelector('.v31-wait-card');if(!box)return;const elapsed=Math.max(0,Math.floor((Date.now()-n(box.dataset.start))/1000)),free=n(box.dataset.free),billed=Math.max(0,elapsed-free),charge=Math.round(billed*n(box.dataset.rate)/900);box.querySelector('[data-clock]').textContent=fmtSeconds(billed||Math.max(0,free-elapsed));box.querySelector('[data-total]').textContent=fmtSeconds(elapsed);box.querySelector('[data-charge]').textContent=moneySafe(charge);box.classList.toggle('charging',billed>0);setTimeout(()=>{if(box.isConnected)tickWait()},1000)}
  async function arriveWait(item,stage){try{loading(true);const p=await currentPosition();await api(`/api/app/v16/driver/deliveries/${item.id}/arrive`,{method:'POST',body:{stage,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}});toast('Chegada registrada.');await loadDriverDashboard(true)}catch(e){toast(e.message,'error')}finally{loading(false)}}
  async function stopWait(item,stage){try{loading(true);let body={reason:stage==='pickup'?'Coleta concluída':'Tempo encerrado'};try{const p=await currentPosition();body={...body,latitude:p.coords.latitude,longitude:p.coords.longitude}}catch{}await api(`/api/app/v16/driver/deliveries/${item.id}/wait/stop`,{method:'POST',body});toast('Cronômetro encerrado.');await loadDriverDashboard(true)}catch(e){toast(e.message,'error')}finally{loading(false)}}

  async function fastToggleDriverOnline(){
    const button=$id('v31-driver-online');
    if(button?.disabled)return;
    const turningOn=!state.online;
    if(button){button.disabled=true;button.textContent=turningOn?'Entrando…':'Saindo…'}
    try{
      await api('/api/app/v6/driver/online',{method:'POST',body:{online:turningOn}});
      state.online=turningOn;
      if(turningOn){
        startLocation();
        toast('Você está online e já pode receber entregas.');
        if(navigator.geolocation)navigator.geolocation.getCurrentPosition(async p=>{
          try{await api('/api/app/v6/driver/location',{method:'POST',body:{latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,speed:p.coords.speed,heading:p.coords.heading}})}catch{}
        },()=>{}, {enableHighAccuracy:false,timeout:5000,maximumAge:60000});
      }else{stopLocation();toast('Você está offline.');}
      await loadDriverDashboard();
    }catch(e){toast(e.message||'Não foi possível alterar o status.','error')}
    finally{if(button)button.disabled=false}
  }

  async function advanceDriver(item,action){
    if(!item||!action)return;
    const actionButton=$id('v31-main-action');if(actionButton?.disabled)return;if(actionButton){actionButton.disabled=true;actionButton.dataset.originalText=actionButton.textContent||'';actionButton.textContent='AGUARDE…'}
    if(action==='complete_v14'){
      if(actionButton){actionButton.disabled=false;actionButton.textContent=actionButton.dataset.originalText||'FINALIZAR ENTREGA'}
      const required=Number(item.confirmation_required??1)===1&&!Number(item.finish_without_code_authorized||0)&&!item.customer_confirmed_received_at;
      openModal(`Entregar • ${item.display_code}`,`<form id="v31-complete-form" class="form-grid"><div class="full notice">${required?'Informe o código de 4 dígitos fornecido pelo cliente.':'Confirme a conclusão da entrega.'}</div>${required?field('Código de confirmação','confirmation_code','','text','required inputmode="numeric" maxlength="4" pattern="[0-9]{4}"'):''}<label class="full">Nome de quem recebeu (opcional)<input name="received_by_name"></label><div class="form-actions"><button class="btn primary">CONFIRMAR ENTREGA</button></div></form>`);
      $id('v31-complete-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/v16/driver/deliveries/${item.id}/complete`,{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Entrega concluída.');V31.driverRenderKey='';await loadDriverDashboard(true)}catch(err){toast(err.message,'error')}finally{loading(false)}};return;
    }
    try{loading(true);if(action==='accept')await api(`/api/app/v6/driver/deliveries/${item.id}/accept`,{method:'POST',body:{}});else await api(`/api/app/v6/driver/deliveries/${item.id}/status`,{method:'POST',body:{status:action}});toast(action==='accept'?'Entrega aceita.':'Etapa da entrega atualizada.');V31.driverRenderKey='';await loadDriverDashboard(true);if(['to_pickup','in_route'].includes(action))setTimeout(()=>window.ChegaJa144?.openInternalNavigation?.(),120);else if(action==='accept')setTimeout(()=>{$id('v31-driver-map')?.scrollIntoView({behavior:'smooth',block:'center'})},80)}catch(err){toast(err.message,'error')}finally{loading(false);if(actionButton?.isConnected){actionButton.disabled=false;actionButton.textContent=actionButton.dataset.originalText||'CONTINUAR'}}
  }
  function bindDriver(data,item,metrics){
    $id('v31-driver-menu').onclick=()=>document.getElementById('sidebar')?.classList.add('open');$id('v31-driver-online').onclick=fastToggleDriverOnline;$id('v31-sos-top').onclick=openEmergency;$id('v31-bottom-sos').onclick=openEmergency;$id('v31-driver-alert')?.addEventListener('click',()=>navigate('notifications'));
    $id('v31-main-action')?.addEventListener('click',e=>advanceDriver(item,e.currentTarget.dataset.action));
    $id('v31-reject-delivery')?.addEventListener('click',()=>rejectDelivery(item));$id('v31-driver-details')?.addEventListener('click',()=>driverDetailV6(item));$id('v31-driver-chat')?.addEventListener('click',()=>openDeliveryChat(item));
    document.querySelectorAll('[data-v31-nav]').forEach(b=>b.onclick=()=>navigate(b.dataset.v31Nav));document.querySelectorAll('[data-v31-emergency]').forEach(a=>a.onclick=()=>{});
    if(item)renderWait(item);startOfferCountdown();
  }
  function rejectDelivery(item){openModal(`Recusar • ${item.display_code}`,`<form id="v31-reject-form" class="form-grid"><div class="full notice">A Base verá o motivo e a entrega será oferecida ao próximo cooperado elegível.</div><label class="full">Motivo da recusa<select name="preset"><option value="">Selecione</option><option>Muito distante da coleta</option><option>Problema com a motocicleta</option><option>Já estou com muitas entregas</option><option>Não consigo realizar neste momento</option><option>Outro motivo</option></select></label><label class="full">Explique o motivo<textarea name="reason" required minlength="3" maxlength="500"></textarea></label><div class="form-actions"><button class="btn danger">Confirmar recusa</button></div></form>`);const form=$id('v31-reject-form');form.elements.preset.onchange=()=>{if(form.elements.preset.value!=='Outro motivo')form.elements.reason.value=form.elements.preset.value};form.onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/v17/driver/deliveries/${item.id}/reject`,{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Recusa registrada. A Base foi informada.');loadDriverDashboard()}catch(err){toast(err.message,'error')}finally{loading(false)}}}
  function openEmergency(){openModal('SOS e emergência',`<div class="v31-emergency"><p>Toque no serviço necessário. No celular, o discador será aberto e o aparelho pedirá sua confirmação.</p><a href="tel:190" class="police"><b>190</b><span>Polícia Militar</span></a><a href="tel:192" class="samu"><b>192</b><span>SAMU / Ambulância</span></a><a href="tel:193" class="fire"><b>193</b><span>Corpo de Bombeiros</span></a><button id="v31-internal-sos">Alertar Base e cooperados</button></div>`);$id('v31-internal-sos').onclick=()=>internalSos()}
  async function internalSos(){const item=V31.driverData?.item;try{const p=await currentPosition(),body={occurrence:'Solicitação de ajuda enviada pelo botão SOS do aplicativo.',latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy};await api(item?`/api/app/v15/driver/deliveries/${item.id}/sos`:'/api/app/v15/driver/sos',{method:'POST',body});closeModal();toast('Alerta enviado para a Base e cooperados online.')}catch(e){toast(e.message,'error')}}
  function startOfferCountdown(){clearInterval(V31.offerTimer);const el=document.querySelector('[data-v31-offer-end]');if(!el)return;const update=()=>{const left=Math.max(0,Math.ceil((n(el.dataset.v31OfferEnd)-Date.now())/1000));el.querySelector('b').textContent=`${left}s`;if(left<=0){clearInterval(V31.offerTimer);loadDriverDashboard()}};update();V31.offerTimer=setInterval(update,1000)}

  async function loadDriverDashboard(force=false){
    if(state.page!=='dashboard'||state.user?.role!=='driver'||V31.driverLoading)return;
    V31.driverLoading=true;
    try{
      const home=await api('/api/app/v6/driver/home'),item=(home.active_deliveries||[])[0]||null;
      const previous=V31.driverData,changed=!previous||previous.item?.id!==item?.id||previous.item?.status!==item?.status;
      const metrics=item?(changed||!previous?.metrics?await api(`/api/app/v17/driver/deliveries/${item.id}/metrics`).then(x=>x.item).catch(()=>null):previous.metrics):null;
      state.online=Boolean(home.online??home.driver?.online);V31.driverData={home,item,metrics};
      const content=$id('page-content'),key=[item?.id||'',item?.status||'',state.online?'1':'0',n(item?.outstanding_cents),n(item?.wait_charge_cents),n(item?.amount_to_collect_cents),metrics?.offer_expires_at||''].join('|');
      const render=force||!content.querySelector('.v31-driver-app')||V31.driverRenderKey!==key;
      document.body.classList.toggle('v36-driver-navigation',Boolean(item&&item.status!=='assigned'));
      if(render){
        V31.driverRenderKey=key;V31.driverMapFitted=false;V31.driverMapHost=null;
        content.innerHTML=`<div class="v31-driver-app">${driverHeader(home)}<section class="v31-driver-strip"><div><small>${Number(home.finance?.net_cents||0)<0?'Saldo pendente':'Valor a receber'}</small><strong>${moneySafe(home.finance?.net_cents||0)}</strong></div><div><small>Entregas hoje</small><strong>${n(home.completed_today)}</strong></div><button id="v31-sos-top">⚠ SOS</button></section>${item?driverDeliveryCard(item,metrics,home.driver):`<section class="v31-driver-empty"><h2>Nenhuma entrega agora</h2><p>${state.online?'Aguarde uma atribuição da Base.':'Fique online para receber entregas.'}</p></section>`}<section class="v31-driver-map-card"><div id="v31-driver-map"></div><button id="v31-map-center">◎</button><button id="v31-open-navigation">Navegar</button></section><section class="v31-day-summary"><header><h2>Resumo do dia</h2><button data-v31-nav="financial">Ver detalhes ›</button></header><div><article><strong>${moneySafe(home.finance?.net_cents||0)}</strong><span>${Number(home.finance?.net_cents||0)<0?'Saldo pendente':'A receber'}</span></article><article><strong>${n(home.completed_today)}</strong><span>Entregas</span></article><article><strong>${n(home.schedules?.length)}</strong><span>Escalas</span></article><article><strong>${state.online?'Online':'Offline'}</strong><span>Status</span></article></div></section>${driverBottom()}</div>`;
        if(item)driverMap(item,home.driver,true);else{const mapHost=$id('v31-driver-map');if(mapHost&&window.ChegaJaMaps?.createMap){if(V31.driverMap)try{V31.driverMap.remove()}catch{}V31.driverMapHost=mapHost;V31.driverMap=null;window.ChegaJaMaps.createMap(mapHost,{center:[n(home.driver?.current_lat)||-5.7945,n(home.driver?.current_lng)||-35.211],zoom:14,zoomControl:false}).then(map=>{if(V31.driverMapHost!==mapHost){map.remove();return}V31.driverMap=map;if(home.driver?.current_lat!=null)map.addCircleMarker([n(home.driver.current_lat),n(home.driver.current_lng)],{group:'driver',color:'#0d45d8',label:'EU',popup:'Sua localização'})}).catch(error=>{if(mapHost.isConnected)mapHost.innerHTML=`<div class="cj149-map-error"><div><strong>Mapa não carregado</strong>${esc(error.message)}</div></div>`})}}
        $id('v31-map-center').onclick=()=>{if(home.driver?.current_lat!=null)V31.driverMap?.setView([n(home.driver.current_lat),n(home.driver.current_lng)],16)};
        $id('v31-open-navigation').onclick=event=>{event.preventDefault();window.ChegaJa144?.openInternalNavigation?.()};
        bindDriver(home,item,metrics);
      }else if(item){driverMap(item,home.driver,false)}
      window.ChegaJaV31.driverData=V31.driverData;
    }catch(e){toast(e.message,'error')}finally{V31.driverLoading=false}
  }
  async function installDriver(){
    stopDriver();document.body.classList.add('v31-driver-mode','v32-driver-single-menu','cj14-driver');V31.driverRenderKey='';await loadDriverDashboard(true);
    const tick=async()=>{if(state.page!=='dashboard'||state.user?.role!=='driver')return stopDriver();if(!document.hidden)await loadDriverDashboard(false);const active=Boolean(V31.driverData?.item);V31.driverTimer=setTimeout(tick,active?30000:15000)};
    V31.driverTimer=setTimeout(tick,V31.driverData?.item?30000:15000);
  }

  if(pages?.bases){pages.bases=async function(){if(['cooperative_admin','dispatcher'].includes(state.user?.role))return installBase();const content=$id('page-content');if(content)content.innerHTML='<div class="empty"><strong>Acesso restrito</strong></div>'}}
  if(pages?.dashboard){const previous=pages.dashboard;pages.dashboard=async function(){if(state.user?.role==='driver')return installDriver();document.body.classList.remove('v31-driver-mode');return previous()}}
  if(typeof navigate==='function'){const old=navigate;navigate=async function(...args){cleanup(args[0]);if(args[0]!=='dashboard')document.body.classList.remove('v31-driver-mode');return old.apply(this,args)}}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.page==='bases'&&V31.baseId)loadBaseDashboard(false);if(state.page==='dashboard'&&state.user?.role==='driver')loadDriverDashboard()}});
  window.ChegaJaV31={installBase,loadBaseDashboard,stopBase,installDriver,loadDriverDashboard,stopDriver,driverData:V31.driverData,baseData:V31.baseData};
})();


/* ===== chegaja-v32.js ===== */
/* ChegaJá 13.1 — cliente em página única, correções da Base e aplicativo do cooperado */
(function(){
  const V32={customerMap:null,customerLayer:null,customerTimer:null,chatTimer:null,driverObserver:null,baseObserver:null,quoteTimer:null,lastQuote:null,queueLoading:false,queueLastFetch:0,queueData:null,queueTimer:null,enhanceScheduled:false};
  const $id=id=>document.getElementById(id);
  const num=v=>Number(v||0);
  const activeStatuses=new Set(['new','offered','assigned','accepted','to_pickup','at_pickup','picked_up','in_route','problem']);
  const statusLabel={new:'Aguardando cooperado',offered:'Buscando cooperado',assigned:'Aguardando aceite',accepted:'Aceita',to_pickup:'Indo para coleta',at_pickup:'Na coleta',picked_up:'Pedido coletado',in_route:'A caminho da entrega',problem:'Atenção necessária',delivered:'Entregue',cancelled:'Cancelada'};
  const clientParams=()=>new URLSearchParams(location.search);
  const clientCoopId=()=>String(clientParams().get('coop')||localStorage.getItem('chegaja_customer_cooperative')||lg.customer?.cooperative_id||'').trim();
  const clientCoop=()=>((lg.catalog?.cooperatives||[]).find(x=>String(x.id)===clientCoopId())||null);
  const clearCustomer=()=>{localStorage.removeItem('ligerim_customer_token');lg.customerToken='';lg.customer=null;stopCustomerLoops()};
  const stopCustomerLoops=()=>{clearInterval(V32.customerTimer);clearInterval(V32.chatTimer);V32.customerTimer=null;V32.chatTimer=null;if(V32.customerMap){try{V32.customerMap.remove()}catch{}V32.customerMap=null;V32.customerLayer=null}};
  function saveCustomerSession(data){
    const expected=clientCoopId(),received=String(data?.customer?.cooperative_id||'');
    if(!data?.token||!received||!expected||received!==expected)throw new Error('O acesso não pertence à cooperativa deste link. Abra novamente o link oficial.');
    lg.customerToken=data.token;lg.customer=data.customer;localStorage.setItem('ligerim_customer_token',data.token);localStorage.setItem('chegaja_customer_cooperative',received);
  }
  async function loadClientCatalog(){
    const coopId=clientCoopId();
    if(!coopId)throw new Error('Abra o cadastro pelo link enviado pela cooperativa.');
    lg.catalog=await clientApi(`/catalog?cooperative_id=${encodeURIComponent(coopId)}`);
    if(!clientCoop())throw new Error('A cooperativa deste link está inativa ou o endereço não é válido.');
    localStorage.setItem('chegaja_customer_cooperative',coopId);
  }
  function clientAccessError(message){
    showCustomer();
    $('#customer-content').innerHTML=`<main class="v32-client-access"><section class="v32-access-card"><img src="/icons/logo-official.png" alt="ChegaJá"><h1>Link da cooperativa necessário</h1><p>${esc(message)}</p><button id="v32-client-back" class="btn primary">Voltar ao acesso</button></section></main>`;
    $id('v32-client-back').onclick=()=>showAuth('login');
  }
  function customerAccess(mode='register'){
    const coop=clientCoop();if(!coop)return clientAccessError('Solicite à cooperativa o link oficial de cadastro.');
    const logo=coop.logo_url||'/icons/logo-official.png';
    $('#customer-content').innerHTML=`<main class="v32-client-access"><section class="v32-access-brand" style="--coop:${esc(coop.primary_color||'#0d47a1')}"><img src="${esc(logo)}" alt="${esc(coop.name)}"><small>ACESSO OFICIAL</small><h1>${esc(coop.name)}</h1><p>Seu cadastro, crédito e pedidos ficam vinculados automaticamente a esta cooperativa.</p></section><section class="v32-access-panels"><article class="v32-access-card ${mode==='register'?'featured':''}" id="v32-register-card"><h2>Criar conta</h2><p>Ao concluir, você entrará automaticamente no aplicativo.</p><form id="v32-customer-register" class="form-grid"><input type="hidden" name="cooperative_id" value="${esc(coop.id)}">${field('Nome','name','','text','required autocomplete="name"')}${field('Celular','phone','','tel','autocomplete="tel"')}${field('E-mail','email','','email','autocomplete="email"')}${field('Senha','password','','password','required minlength="8" autocomplete="new-password"')}<div class="form-actions full"><button class="btn primary full">Cadastrar e entrar</button></div></form></article><article class="v32-access-card ${mode==='login'?'featured':''}" id="v32-login-card"><h2>Já sou cliente</h2><form id="v32-customer-login" class="form-grid"><input type="hidden" name="cooperative_id" value="${esc(coop.id)}">${field('Celular ou e-mail','login','','text','required autocomplete="username"')}${field('Senha','password','','password','required autocomplete="current-password"')}<div class="form-actions full"><button class="btn primary full">Entrar</button></div></form></article><article class="v32-access-card"><h2>Pedido avulso</h2><p>Use sem criar senha. O pedido continuará ligado a ${esc(coop.name)}.</p><form id="v32-customer-guest" class="form-grid"><input type="hidden" name="cooperative_id" value="${esc(coop.id)}">${field('Nome','name','','text','required')}${field('Celular','phone','','tel','required')}${field('E-mail (opcional)','email','','email')}<div class="form-actions full"><button class="btn full">Continuar sem cadastro</button></div></form></article></section></main>`;
    const enter=async(data,fallback)=>{saveCustomerSession(data);try{const verified=await clientApi('/me');lg.customer=verified.customer;await renderCustomerOnePage()}catch(error){if(fallback){const logged=await clientApi('/login',{method:'POST',body:fallback});saveCustomerSession(logged);lg.customer=logged.customer;await renderCustomerOnePage();return}clearCustomer();throw error}};
    $id('v32-customer-register').onsubmit=async e=>{e.preventDefault();const body=formObject(e.currentTarget);try{loading(true);const data=await clientApi('/register',{method:'POST',body});await enter(data,{cooperative_id:body.cooperative_id,login:body.email||body.phone,password:body.password});toast('Cadastro concluído. Você já está conectado.')}catch(error){toast(error.message,'error')}finally{loading(false)}};
    $id('v32-customer-login').onsubmit=async e=>{e.preventDefault();try{loading(true);await enter(await clientApi('/login',{method:'POST',body:formObject(e.currentTarget)}));toast('Acesso realizado.')}catch(error){toast(error.message,'error')}finally{loading(false)}};
    $id('v32-customer-guest').onsubmit=async e=>{e.preventDefault();try{loading(true);await enter(await clientApi('/guest',{method:'POST',body:formObject(e.currentTarget)}));toast('Pedido avulso liberado.')}catch(error){toast(error.message,'error')}finally{loading(false)}};
    requestAnimationFrame(()=>$id(mode==='login'?'v32-login-card':'v32-register-card')?.scrollIntoView({behavior:'smooth',block:'center'}));
  }
  async function customerAppV32(mode='register'){
    showCustomer();stopCustomerLoops();
    try{await loadClientCatalog()}catch(error){return clientAccessError(error.message)}
    if(lg.customerToken){
      try{const me=await clientApi('/me');if(String(me.customer?.cooperative_id)!==clientCoopId())throw new Error('Vínculo diferente.');lg.customer=me.customer;return renderCustomerOnePage()}catch{clearCustomer()}
    }
    customerAccess(mode);
  }

  function activeOrder(items){return items.find(x=>activeStatuses.has(String(x.delivery_status||x.status)))||null}
  function compactAddress(v){return esc(String(v||'').replace(/, Brasil$/i,''))}
  function customerMapBase(){
    const host=$id('v32-client-map');if(!host||typeof L==='undefined')return null;
    if(!V32.customerMap){V32.customerMap=L.map(host,{zoomControl:false,attributionControl:false}).setView([-5.7945,-35.211],13);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(V32.customerMap);L.control.zoom({position:'bottomright'}).addTo(V32.customerMap);V32.customerLayer=L.layerGroup().addTo(V32.customerMap)}
    setTimeout(()=>V32.customerMap?.invalidateSize(),80);return V32.customerMap;
  }
  function geometryFeature(raw){try{const g=typeof raw==='string'?JSON.parse(raw):raw;if(!g)return null;if(g.type==='Feature')return g;if(g.type==='LineString'||g.type==='MultiLineString')return {type:'Feature',properties:{},geometry:g};if(Array.isArray(g)&&g.length)return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:g.map(p=>Array.isArray(p)&&p.length===2?p:[0,0])}}}catch{}return null}
  function drawCustomerMap(item,quote){
    const map=customerMapBase();if(!map||!V32.customerLayer)return;V32.customerLayer.clearLayers();const points=[];
    const add=(lat,lng,label,kind)=>{lat=num(lat);lng=num(lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)||(!lat&&!lng))return;const p=[lat,lng];points.push(p);L.marker(p,{icon:L.divIcon({className:'v32-map-marker-wrap',html:`<span class="v32-map-marker ${kind}"></span>`,iconSize:[34,42],iconAnchor:[17,38]})}).addTo(V32.customerLayer).bindPopup(esc(label))};
    const data=item||quote||{};add(data.pickup_lat||data.pickup?.lat,data.pickup_lng||data.pickup?.lng,'Coleta','pickup');add(data.delivery_lat||data.destination?.lat,data.delivery_lng||data.destination?.lng,'Entrega','delivery');if(item?.driver_lat!=null)add(item.driver_lat,item.driver_lng,item.driver_name||'Cooperado','driver');
    const feature=geometryFeature(data.route_geometry||data.geometry);if(feature)try{const layer=L.geoJSON(feature,{style:{color:'#1455d9',weight:6,opacity:.8}}).addTo(V32.customerLayer);const bounds=layer.getBounds();if(bounds.isValid())map.fitBounds(bounds,{padding:[38,38],maxZoom:16})}catch{}
    if(!feature&&points.length>1)map.fitBounds(points,{padding:[45,45],maxZoom:16});else if(!feature&&points.length===1)map.setView(points[0],16);
  }
  function customerTimeline(item){const current=String(item?.status||'new'),steps=[['offered','Solicitado'],['assigned','Cooperado definido'],['to_pickup','Indo para coleta'],['picked_up','Coletado'],['in_route','Em rota'],['delivered','Entregue']],rank={new:0,offered:0,assigned:1,accepted:1,to_pickup:2,at_pickup:2,picked_up:3,in_route:4,delivered:5,cancelled:-1,problem:3};return `<div class="v32-timeline">${steps.map((x,i)=>`<div class="${i<=num(rank[current])?'done':''}"><i>${i<num(rank[current])?'✓':i+1}</i><span>${x[1]}</span></div>`).join('')}</div>`}
  function orderCard(order){if(!order)return `<section class="v32-active-card empty"><div><small>NENHUMA ENTREGA ATIVA</small><h2>Peça sua próxima entrega</h2><p>Informe coleta e entrega. O valor aparece antes da confirmação.</p></div></section>`;return `<section class="v32-active-card"><header><div><small>ENTREGA ATUAL</small><h2>${esc(order.display_code||'Pedido')}</h2></div><span class="v32-order-status">${esc(statusLabel[order.delivery_status]||order.delivery_status)}</span></header><div class="v32-route-mini"><div><i class="pickup"></i><span><small>Coleta</small><strong>${compactAddress(order.pickup_address)}</strong></span></div><div><i class="delivery"></i><span><small>Entrega</small><strong>${compactAddress(order.delivery_address)}</strong></span></div></div>${customerTimeline({status:order.delivery_status})}<div class="v32-active-actions">${order.tracking_url?`<a href="${esc(order.tracking_url)}" target="_blank" rel="noopener">Abrir rastreio</a>`:''}<button id="v32-scroll-chat">Chat</button><strong>${money(order.quoted_cents)}</strong></div></section>`}
  function walletPanel(wallet){const requests=wallet.purchase_requests||[],transactions=wallet.transactions||[];return `<section id="v32-credit-section" class="v32-client-section"><header><div><small>MINHA CARTEIRA</small><h2>Créditos</h2></div><strong class="v32-balance-large">${money(wallet.wallet?.balance_cents)}</strong></header><div class="v32-credit-grid"><form id="v32-credit-request" class="v32-credit-form"><label>Valor para adicionar<input name="amount" type="number" min="1" step="0.01" required placeholder="R$ 0,00"></label><input type="hidden" name="payment_method" value="pix"><label>Comprovante (opcional)<input name="proof_url" type="url" placeholder="Link do comprovante"></label><button class="btn primary">Solicitar crédito</button></form><div class="v32-credit-requests"><h3>Solicitações</h3>${requests.slice(0,5).map(x=>`<div><span><strong>${money(x.amount_cents)}</strong><small>${dateTime(x.created_at)}</small></span>${badge(x.status)}</div>`).join('')||'<p>Nenhuma solicitação.</p>'}</div></div><div class="v32-wallet-history"><h3>Últimos movimentos</h3>${transactions.slice(0,8).map(x=>`<div><span><strong>${esc(x.description||x.category||'Movimentação')}</strong><small>${dateTime(x.created_at)}${x.display_code?` • ${esc(x.display_code)}`:''}</small></span><b class="${x.entry_type==='debit'?'debit':'credit'}">${x.entry_type==='debit'?'-':'+'}${money(x.amount_cents)}</b></div>`).join('')||'<p>Nenhuma movimentação.</p>'}</div></section>`}
  function historyPanel(items){return `<section id="v32-history-section" class="v32-client-section"><header><div><small>HISTÓRICO</small><h2>Meus pedidos</h2></div><span>${items.length}</span></header><div class="v32-order-history">${items.slice(0,20).map(x=>`<article><div><strong>${esc(x.display_code||'Pedido')}</strong><small>${dateTime(x.created_at)}</small></div><span>${esc(statusLabel[x.delivery_status]||x.delivery_status||x.status)}</span><p>${compactAddress(x.delivery_address)}</p><b>${money(x.quoted_cents)}</b>${x.tracking_url?`<a href="${esc(x.tracking_url)}" target="_blank" rel="noopener" title="Rastrear">⌖</a>`:''}</article>`).join('')||'<p>Nenhum pedido realizado.</p>'}</div></section>`}
  function chatPanel(order){if(!order?.tracking_token)return `<section id="v32-chat-section" class="v32-client-section v32-chat"><header><div><small>ATENDIMENTO</small><h2>Chat</h2></div></header><p class="v32-chat-empty">O chat aparecerá quando você tiver uma entrega ativa.</p></section>`;return `<section id="v32-chat-section" class="v32-client-section v32-chat"><header><div><small>ATENDIMENTO DA ENTREGA</small><h2>Chat em tempo real</h2></div><select id="v32-chat-contact"><option value="customer_place">Base / Cooperativa</option></select></header><div id="v32-chat-messages" class="v32-chat-messages"><p>Carregando conversa…</p></div><form id="v32-chat-form"><input name="message" maxlength="500" required placeholder="Digite sua mensagem"><button aria-label="Enviar">➤</button></form></section>`}
  function orderForm(balance){const coop=clientCoop(),bases=(lg.catalog?.bases||[]).filter(x=>String(x.cooperative_id)===String(coop?.id)),registered=!lg.customer?.guest;const payments=[{id:'pix',name:'PIX comum (cooperado recebe)'},{id:'dinheiro',name:'Dinheiro (cooperado recebe)'},{id:'pix_cooperativa',name:'PIX Cooperativa'}];if(registered)payments.push({id:'credit',name:`Crédito pré-pago (${money(balance)})`});return `<section id="v32-request-section" class="v32-client-section v32-request"><header><div><small>NOVA ENTREGA</small><h2>Para onde vamos?</h2></div><span>${esc(coop?.name||'Cooperativa')}</span></header><form id="v32-order-form" class="form-grid"><input type="hidden" name="cooperative_id" value="${esc(coop?.id||'')}"><label class="full v32-base-select">Base<select name="base_id" required>${bases.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>${addressFields('pickup','Onde vamos coletar?')}<div class="full address-inline-details">${field('Apartamento / unidade na coleta','pickup_apartment')}${field('Complemento / nome da loja','pickup_complement')}</div>${addressFields('delivery','Onde vamos entregar?')}<div class="full address-inline-details">${field('Apartamento / unidade na entrega','delivery_apartment')}${field('Complemento / nome do local','delivery_complement')}</div><div id="v32-services" class="full"></div>${field('Nome de quem recebe','recipient_name')}${field('Telefone de quem recebe','recipient_phone','','tel')}${selectField('Forma de pagamento','payment_method',payments,'pix','Selecione','required')}${textarea('Observações','notes','','placeholder="Ex.: documento, produto frágil, referência do local"')}<div id="v32-quote-box" class="v32-quote-box full"><span>Confirme os dois endereços para ver o valor.</span></div><div class="form-actions full"><button type="button" id="v32-calc-quote" class="btn">Calcular</button><button id="v32-confirm-order" class="btn primary" disabled>Confirmar pedido</button></div><div class="full v32-credit-rule">Crédito disponível: <strong>${money(balance)}</strong> • só será usado quando a forma escolhida for Crédito pré-pago.</div></form></section>`}
  async function renderCustomerOnePage(){
    showCustomer();stopCustomerLoops();
    const [me,wallet,orders]=await Promise.all([clientApi('/me'),clientApi('/wallet'),clientApi('/orders')]);lg.customer=me.customer;
    const items=orders.items||[],active=activeOrder(items),balance=num(wallet.wallet?.balance_cents),coop=clientCoop(),logo=me.customer.cooperative_logo_url||coop?.logo_url||'/icons/logo-official.png';
    $('#customer-content').innerHTML=`<div class="v32-client-app"><header class="v32-client-header"><div><img src="${esc(logo)}" alt=""><span><small>${esc(me.customer.cooperative_name||coop?.name||'ChegaJá')}</small><strong>Olá, ${esc(String(me.customer.name||'cliente').split(' ')[0])}</strong></span></div><button id="v32-client-logout" title="Sair">↪</button></header><main><section class="v32-map-stage"><div id="v32-client-map"></div><div class="v32-map-wallet"><small>Crédito disponível</small><strong>${money(balance)}</strong><a href="#v32-credit-section">Adicionar</a></div><button id="v32-map-center" title="Minha localização">◎</button></section>${orderCard(active)}${orderForm(balance)}${chatPanel(active)}${walletPanel(wallet)}${historyPanel(items)}</main><nav class="v32-client-bottom"><a href="#v32-request-section"><i>⌂</i><span>Início</span></a><a href="#v32-history-section"><i>▤</i><span>Pedidos</span></a><a href="#v32-chat-section"><i>◌</i><span>Chat</span></a><a href="#v32-credit-section"><i>◈</i><span>Crédito</span></a></nav></div>`;
    $id('v32-client-logout').onclick=()=>{clearCustomer();customerAccess('login')};$id('v32-scroll-chat')?.addEventListener('click',()=>{$id('v32-chat-section')?.scrollIntoView({behavior:'smooth'})});
    customerMapBase();if(active?.tracking_token)await refreshActiveTracking(active);else drawCustomerMap(null,null);
    $id('v32-map-center').onclick=()=>navigator.geolocation?.getCurrentPosition(p=>V32.customerMap?.setView([p.coords.latitude,p.coords.longitude],16),()=>toast('Não foi possível obter sua localização.','error'),{enableHighAccuracy:true,timeout:10000});
    bindCustomerOrder(balance);bindCustomerCredit();if(active?.tracking_token){bindCustomerChat(active);V32.customerTimer=setInterval(()=>refreshActiveTracking(active),8000)}
  }
  function bindCustomerOrder(balance){
    const form=$id('v32-order-form');if(!form)return;const coop=clientCoop(),registered=!lg.customer?.guest;
    bindAddressSearch(form,'pickup',()=>({cooperative_id:coop.id,base_id:form.base_id.value}));bindAddressSearch(form,'delivery',()=>({cooperative_id:coop.id,base_id:form.base_id.value}));bindCashLocation(form);
    const updateServices=()=>{const services=(lg.catalog?.services||[]).filter(x=>String(x.cooperative_id)===String(coop.id)&&(!x.base_id||String(x.base_id)===String(form.base_id.value)));$id('v32-services').innerHTML=services.length?`<strong>Serviços adicionais</strong>${serviceChecks(services)}`:''};updateServices();form.base_id.onchange=()=>{updateServices();V32.lastQuote=null;$id('v32-confirm-order').disabled=true};
    const quote=async(silent=false)=>{requireConfirmed(form,'pickup');requireConfirmed(form,'delivery');const data=await clientApi('/quote',{method:'POST',body:formObject(form)}),q=data.quote;V32.lastQuote=q;const insufficient=form.elements.payment_method.value==='credit'&&num(q.charge_cents)>balance;$id('v32-quote-box').innerHTML=`<div><small>Valor estimado</small><strong>${money(q.charge_cents)}</strong></div><div><small>Distância</small><strong>${km(q.distance_meters)}</strong></div><div><small>Tempo</small><strong>${mins(q.duration_seconds)}</strong></div>${insufficient?`<p>Saldo insuficiente. Faltam <b>${money(q.charge_cents-balance)}</b>.</p>`:''}`;$id('v32-confirm-order').disabled=insufficient;drawCustomerMap(null,q);if(!silent)toast('Valor calculado.');return q};
    $id('v32-calc-quote').onclick=async()=>{try{loading(true);await quote()}catch(e){toast(e.message,'error')}finally{loading(false)}};
    form.addEventListener('click',e=>{if(e.target.closest('[data-confirm-address]')){clearTimeout(V32.quoteTimer);V32.quoteTimer=setTimeout(()=>{if(form.elements.pickup_confirmation_token.value&&form.elements.delivery_confirmation_token.value)quote(true).catch(()=>{})},250)}});
    form.addEventListener('change',e=>{if(e.target.matches('[name="service_ids[]"], [name="payment_method"]'))quote(true).catch(()=>{})});
    form.onsubmit=async e=>{e.preventDefault();try{loading(true);const q=V32.lastQuote||await quote(true);if(form.elements.payment_method.value==='credit'&&balance<num(q.charge_cents))throw new Error(`Crédito insuficiente. Disponível: ${money(balance)}.`);if(!confirm(`Confirmar a entrega por ${money(q.charge_cents)}?`))return;const result=await clientApi('/orders',{method:'POST',body:formObject(form)});toast(`Pedido ${result.order.display_code} criado.`);await renderCustomerOnePage()}catch(error){toast(error.message,'error')}finally{loading(false)}};
  }
  function bindCustomerCredit(){const form=$id('v32-credit-request');if(!form)return;form.onsubmit=async e=>{e.preventDefault();try{loading(true);const r=await clientApi('/wallet/topups',{method:'POST',body:formObject(form)});toast(r.message);await renderCustomerOnePage();setTimeout(()=>$id('v32-credit-section')?.scrollIntoView(),50)}catch(error){toast(error.message,'error')}finally{loading(false)}}}
  async function refreshActiveTracking(order){try{const d=await api(`/api/public/tracking/${encodeURIComponent(order.tracking_token)}`);drawCustomerMap(d.item,null);const status=document.querySelector('.v32-order-status');if(status)status.textContent=statusLabel[d.item.status]||d.item.status;return d.item}catch{return null}}
  async function bindCustomerChat(order){
    const select=$id('v32-chat-contact'),form=$id('v32-chat-form');if(!select||!form)return;
    const load=async()=>{try{const data=await api(`/api/public/tracking/${encodeURIComponent(order.tracking_token)}/messages?conversation=${encodeURIComponent(select.value)}`);const options=data.contacts||[];if(options.length&&select.options.length!==options.length)select.innerHTML=options.map(x=>`<option value="${esc(x.conversation)}">${esc(x.label)}</option>`).join('');const box=$id('v32-chat-messages');if(box){box.innerHTML=(data.items||[]).map(x=>`<div class="${x.sender_type==='customer'?'mine':'theirs'}"><small>${esc(x.sender_name||x.sender_type)}</small><p>${esc(x.message)}</p><time>${timeOnly(x.created_at)}</time></div>`).join('')||'<p class="v32-chat-empty">Envie uma mensagem para iniciar a conversa.</p>';box.scrollTop=box.scrollHeight}}catch{}};
    select.onchange=load;form.onsubmit=async e=>{e.preventDefault();const message=form.elements.message.value.trim();if(!message)return;try{await api(`/api/public/tracking/${encodeURIComponent(order.tracking_token)}/messages`,{method:'POST',body:{conversation:select.value,message}});form.reset();await load()}catch(error){toast(error.message,'error')}};await load();V32.chatTimer=setInterval(load,5000);
  }

  // Aplicativo do cooperado: um único menu, fila por geolocalização e SOS sempre disponível.
  function ensureDriverDrawer(){let drawer=$id('v32-driver-drawer');if(drawer)return drawer;drawer=document.createElement('div');drawer.id='v32-driver-drawer';drawer.className='v32-driver-drawer';drawer.innerHTML=`<div class="v32-driver-drawer-backdrop"></div><aside><header><img src="/icons/logo-official.png"><button data-v32-close>×</button></header><button data-v32-nav="dashboard">⌂ <span>Início</span></button><button data-v32-nav="deliveries">▤ <span>Entregas</span></button><button data-v32-nav="routes">⌖ <span>Rotas</span></button><button data-v32-nav="schedules">▦ <span>Escalas</span></button><button data-v32-nav="financial">＄ <span>Ganhos</span></button><button data-v32-nav="account">● <span>Perfil</span></button><button id="v32-driver-logout" class="danger">↪ <span>Sair</span></button></aside>`;document.body.appendChild(drawer);drawer.querySelector('.v32-driver-drawer-backdrop').onclick=()=>drawer.classList.remove('open');drawer.querySelector('[data-v32-close]').onclick=()=>drawer.classList.remove('open');drawer.querySelectorAll('[data-v32-nav]').forEach(b=>b.onclick=()=>{drawer.classList.remove('open');navigate(b.dataset.v32Nav)});$id('v32-driver-logout').onclick=()=>logout();return drawer}
  function openEmergencyV32(){openModal('SOS e chamadas de emergência',`<div class="v32-emergency"><p>O SOS está disponível mesmo sem entrega ativa. Toque no serviço para abrir o discador do celular.</p><a href="tel:190"><i>🚓</i><span><strong>190</strong>Polícia Militar</span></a><a href="tel:192"><i>🚑</i><span><strong>192</strong>SAMU / Ambulância</span></a><a href="tel:193"><i>🚒</i><span><strong>193</strong>Corpo de Bombeiros</span></a><button id="v32-send-internal-sos" class="btn danger full">Alertar a Base e cooperados online</button></div>`);$id('v32-send-internal-sos').onclick=sendStandaloneSos}
  async function sendStandaloneSos(){try{loading(true);const p=await new Promise((ok,no)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,timeout:15000}):no(new Error('GPS indisponível.')));await api('/api/app/v15/driver/sos',{method:'POST',body:{occurrence:'Solicitação de ajuda enviada pelo botão SOS.',latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}});closeModal();toast('Alerta enviado para a Base e cooperados online.')}catch(e){toast(e.message||'Ative o GPS para enviar o alerta.','error')}finally{loading(false)}}
  function renderQueueWidget(data){
    const target=document.querySelector('.v31-driver-strip')||document.querySelector('.v31-driver-empty');if(!target)return;
    const locations=(data?.items||[]).filter(x=>['base','establishment'].includes(x.location_type)),active=data?.active;
    let box=$id('v32-driver-queue');if(!box){box=document.createElement('section');box.id='v32-driver-queue';target.insertAdjacentElement('afterend',box)}
    const signature=JSON.stringify({active:active?{id:active.id,name:active.location_name,type:active.location_type,position:active.queue_position,total:active.queue_total}:null,locations:locations.map(x=>[x.location_type,x.location_id,x.location_name])});
    if(box.dataset.signature===signature)return;
    box.dataset.signature=signature;box.className=`v32-driver-queue ${active?'active':''}`;
    const activeType=active?.location_type==='establishment'?'CONTRATO':'BASE',queueTitle=activeType==='BASE'?'FILA DA BASE':'FILA DO CONTRATO';
    const queuePosition=Math.max(1,Number(active?.queue_position||1)),queueTotal=Math.max(queuePosition,Number(active?.queue_total||queuePosition));
    if(active)box.innerHTML=`<div><small>${queueTitle}</small><strong>Você é o ${queuePosition}º da fila</strong><span>${esc(active.location_name||activeType)} • ${queueTotal===1?'Você é o único aguardando':`${queueTotal} cooperados aguardando`}. Ao receber uma atribuição, seu nome sai automaticamente da fila.</span></div><button id="v32-leave-queue">Sair da fila</button>`;
    else if(locations.length)box.innerHTML=`<div><small>FILA DE ESPERA</small><strong>Escolha a Base ou contrato em que está escalado.</strong><span>Na Base, a entrada exige distância de até 30 metros. Ao retornar, você entra no fim da fila.</span></div><select id="v32-queue-location">${locations.map(x=>`<option value="${esc(x.location_type)}:${esc(x.location_id)}">${x.location_type==='base'?'Base':'Contrato'} • ${esc(x.location_name)}</option>`).join('')}</select><button id="v32-enter-queue">Entrar na fila</button>`;
    else box.innerHTML='<div><small>FILA DE ESPERA</small><strong>Nenhuma Base ou contrato disponível para sua escala hoje.</strong></div>';
    $id('v32-enter-queue')?.addEventListener('click',async()=>{try{loading(true);const selected=$id('v32-queue-location')?.value||'',split=selected.indexOf(':'),type=selected.slice(0,split),locationId=selected.slice(split+1);if(!type||!locationId)throw new Error('Selecione a Base ou contrato.');const p=await new Promise((ok,no)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:type==='base',timeout:15000,maximumAge:15000}):no(new Error('GPS indisponível.')));await api('/api/app/v10/queue/arrive',{method:'POST',body:{location_type:type,location_id:locationId,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}});toast(`Você entrou no fim da fila ${type==='base'?'da Base':'do contrato'}.`);V32.queueData=null;await queueWidget(true)}catch(e){toast(e.message,'error')}finally{loading(false)}});
    $id('v32-leave-queue')?.addEventListener('click',async()=>{try{await api('/api/app/v10/queue/leave',{method:'POST',body:{}});V32.queueData=null;toast('Você saiu da fila.');await queueWidget(true)}catch(e){toast(e.message,'error')}});
  }
  async function queueWidget(force=false){
    if(state.user?.role!=='driver'||state.page!=='dashboard')return;
    if(window.ChegaJaV31?.driverData?.item){$id('v32-driver-queue')?.remove();return;}
    const now=Date.now();
    if(!force&&V32.queueData&&now-V32.queueLastFetch<30000){renderQueueWidget(V32.queueData);return}
    if(V32.queueLoading)return;
    V32.queueLoading=true;
    try{const data=await api('/api/app/v10/queue/locations');V32.queueData=data;V32.queueLastFetch=Date.now();renderQueueWidget(data)}catch(e){console.warn('Fila indisponível:',e)}finally{V32.queueLoading=false}
  }
  async function driverAcceptV32(event){const button=event.target.closest('#v31-main-action[data-action="accept"]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();try{loading(true);const home=await api('/api/app/v6/driver/home'),item=(home.active_deliveries||[]).find(x=>x.status==='assigned');if(!item)throw new Error('A oferta não está mais disponível.');await api(`/api/app/v6/driver/deliveries/${item.id}/accept`,{method:'POST',body:{}});toast('Entrega aceita. Abrindo a navegação.');await window.ChegaJaV31?.loadDriverDashboard();setTimeout(()=>document.querySelector('.v31-driver-map-card')?.scrollIntoView({behavior:'smooth',block:'start'}),50)}catch(e){toast(e.message,'error')}finally{loading(false)}}
  function enhanceDriver(){if(state.user?.role!=='driver'||!document.querySelector('.v31-driver-app'))return;document.body.classList.add('v32-driver-single-menu');const drawer=ensureDriverDrawer(),menu=$id('v31-driver-menu');if(menu&&!menu.dataset.v32Bound){menu.dataset.v32Bound='1';menu.onclick=e=>{e.preventDefault();e.stopPropagation();drawer.classList.add('open')}};[$id('v31-sos-top'),$id('v31-bottom-sos')].filter(Boolean).forEach(b=>{if(b.dataset.v32Bound)return;b.dataset.v32Bound='1';b.onclick=e=>{e.preventDefault();e.stopPropagation();openEmergencyV32()}});queueWidget(false);if(!V32.queueTimer)V32.queueTimer=setInterval(()=>{if(!document.hidden&&state.user?.role==='driver'&&state.page==='dashboard')queueWidget(true)},30000);}

  // Base: editar clicando nos campos, atribuição confiável e conclusão em massa.
  const selectorEscape=value=>window.CSS?.escape?CSS.escape(String(value)):String(value).replace(/[\"']/g,'\\$&');
  function legacyRow(deliveryId){return document.querySelector(`.v31-legacy [data-base-detail="${selectorEscape(deliveryId)}"]`)?.closest('tr')||null}
  function legacyEditButton(deliveryId){return legacyRow(deliveryId)?.querySelector('[data-base-quick-edit]')}
  async function assignFromBase(deliveryId){
    try{
      loading(true);
      const data=await api(`/api/app/v10/deliveries/${deliveryId}/eligible-drivers?include_all=1`),items=data.items||[];
      openModal('Atribuir cooperado',`<form id="v32-assign-form" class="form-grid"><div class="full notice"><strong>Selecione qualquer cooperado ativo.</strong> Os que estão online, escalados ou na fila aparecem primeiro. Em entrega agendada, o nome fica reservado até o horário.</div><label class="full">Cooperado<select name="driver_id" required><option value="">Selecione</option>${items.map((x,i)=>{const stateLabel=x.queue_position?`${x.queue_position}º na fila`:x.eligible_now?'online e elegível':Number(x.online)===1?'online':'ativo';return `<option value="${esc(x.id)}">${i+1}. ${esc(x.name)} • ${esc(stateLabel)}${x.recommended?' • recomendado':''}</option>`}).join('')}</select></label>${items.length?'':'<p class="full v32-no-driver">Nenhum cooperado ativo disponível. Confira se os cadastros estão ativos e sem afastamento.</p>'}<div class="form-actions full"><button type="button" id="v32-unassign" class="btn">Deixar sem cooperado</button><button class="btn primary" ${items.length?'':'disabled'}>Atribuir</button></div></form>`);
      const form=$id('v32-assign-form');
      form.onsubmit=async e=>{e.preventDefault();try{loading(true);const result=await api(`/api/app/v10/deliveries/${deliveryId}/assignment`,{method:'POST',body:formObject(form)});closeModal();toast(result.planned?'Cooperado reservado para o horário agendado.':'Cooperado atribuído.');await pages.bases()}catch(err){toast(err.message,'error')}finally{loading(false)}};
      $id('v32-unassign').onclick=async()=>{try{loading(true);await api(`/api/app/v10/deliveries/${deliveryId}/assignment`,{method:'POST',body:{action:'unassign'}});closeModal();toast('Entrega mantida sem cooperado.');await pages.bases()}catch(err){toast(err.message,'error')}finally{loading(false)}};
    }catch(e){toast(e.message,'error')}finally{loading(false)}
  }
  function enhanceBase(){if(!['cooperative_admin','dispatcher'].includes(state.user?.role)||!document.querySelector('.v31-base-shell'))return;document.querySelector('#v32-complete-today')?.remove();
    document.querySelectorAll('.v31-delivery-row').forEach(row=>{const id=row.querySelector('[data-v31-detail]')?.dataset.v31Detail;if(!id)return;[...row.children].slice(1,7).forEach(cell=>{cell.classList.add('v32-editable-cell');cell.title='Clique para editar todos os dados desta entrega';cell.setAttribute('role','button');cell.tabIndex=0;const open=()=>{const edit=row.querySelector('[data-v31-edit]');if(edit)edit.click();else toast('Não foi possível abrir a edição desta entrega.','error')};cell.onclick=e=>{if(e.target.closest('button,a,input,select'))return;open()};cell.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}}});const detail=row.querySelector('[data-v31-detail]');if(detail){detail.textContent='◉';detail.title='Ver detalhes';detail.setAttribute('aria-label','Ver detalhes')}const assign=row.querySelector('[data-v31-assign]');if(assign){assign.textContent='♟+';assign.title='Atribuir cooperado';assign.setAttribute('aria-label','Atribuir cooperado');assign.onclick=e=>{e.preventDefault();e.stopPropagation();assignFromBase(id)}}const settle=row.querySelector('[data-v31-settle]');if(settle){settle.textContent='$';settle.title='Quitar somente o valor restante';settle.setAttribute('aria-label','Quitar valor restante')}const attempts=row.querySelector('[data-v31-attempts]');if(attempts){attempts.textContent='↻';attempts.title='Ver tentativas e recusas';attempts.setAttribute('aria-label','Ver tentativas e recusas')}const actions=row.querySelector('.v31-row-actions');if(actions&&!actions.querySelector('[data-v32-track]')){const token=legacyRow(id)?.querySelector('[data-base-track]')?.dataset.baseTrack;if(token){const b=document.createElement('button');b.dataset.v32Track=id;b.title='Copiar link de rastreio avulso';b.setAttribute('aria-label','Copiar link de rastreio avulso');b.textContent='⌖';b.onclick=()=>copyText(`${location.origin}/r/${token}`);actions.appendChild(b)}}})}

  const observer=new MutationObserver(()=>{if(V32.enhanceScheduled)return;V32.enhanceScheduled=true;requestAnimationFrame(()=>{V32.enhanceScheduled=false;if(document.querySelector('.v31-driver-app'))enhanceDriver();if(document.querySelector('.v31-base-shell'))enhanceBase()})});observer.observe(document.documentElement,{childList:true,subtree:true});
  const oldNavigate=typeof navigate==='function'?navigate:null;if(oldNavigate)navigate=async function(...args){if(args[0]!=='dashboard')document.body.classList.remove('v32-driver-single-menu');return oldNavigate.apply(this,args)};
  customerApp=customerAppV32;renderCustomerAccess=customerAccess;renderCustomerHome=renderCustomerOnePage;window.chegajaOpenCustomer=customerAppV32;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{if(new URLSearchParams(location.search).has('cliente'))customerAppV32()},{once:true});
  window.ChegaJaV32={assignFromBase,openEmergencyV32,queueWidget};

})();


/* ===== chegaja-v36.js ===== */
/* ChegaJá 14.0 — consolidação operacional final */
(function(){
  'use strict';
  const $id=id=>document.getElementById(id);
  const n=v=>Number(v||0);
  const moneySafe=v=>typeof money==='function'?money(v):`R$ ${(n(v)/100).toFixed(2).replace('.',',')}`;
  const paymentLabel=v=>({pix:'PIX',dinheiro:'Dinheiro',cartao_credito:'Cartão de crédito',cartao_debito:'Cartão de débito',vale_alimentacao:'Vale-alimentação',vale_refeicao:'Vale-refeição',cortesia:'Cortesia',pix_cooperativa:'PIX Cooperativa',credit:'Crédito pré-pago'}[v]||v||'Não informado');
  const closed=s=>['delivered','cancelled'].includes(String(s));
  const statusLabel=s=>({new:'Não atribuída',offered:'Disponível',assigned:'Aguardando aceite',accepted:'Aceita',to_pickup:'A caminho da coleta',at_pickup:'Na coleta',picked_up:'Coletada',in_route:'Em rota',problem:'Com problema',delivered:'Entregue',cancelled:'Cancelada'}[s]||s);
  const v36={locationTimer:null,locationBusy:false,lastLocation:null,lastSentAt:0,estMap:null,estLayer:null,estGoogleMap:null,estGoogleHost:null,estGoogleMarkers:[],estGoogleInfo:null,googleMapsPromise:null,googleMapsConfig:null,estTimer:null,estLoading:false,estItems:[],estDrivers:[],estQueue:[],estFilter:'active'};

  function haversine(a,b){
    if(!a||!b)return Infinity;const r=6371000,rad=x=>x*Math.PI/180,dlat=rad(b.lat-a.lat),dlng=rad(b.lng-a.lng),h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlng/2)**2;return 2*r*Math.asin(Math.sqrt(h));
  }
  function activeDriverDelivery(){return Boolean(window.ChegaJaV31?.driverData?.item)}
  function locationDelay(){return activeDriverDelivery()?30000:120000}
  function stopSmartLocation(){clearTimeout(v36.locationTimer);v36.locationTimer=null;v36.locationBusy=false;state.watchId=null}
  async function smartLocationTick(){
    clearTimeout(v36.locationTimer);
    if(!state.online||state.user?.role!=='driver'||!navigator.geolocation){stopSmartLocation();return}
    if(v36.locationBusy){v36.locationTimer=setTimeout(smartLocationTick,locationDelay());return}
    v36.locationBusy=true;
    navigator.geolocation.getCurrentPosition(async pos=>{
      try{
        const current={lat:pos.coords.latitude,lng:pos.coords.longitude};
        const moved=haversine(v36.lastLocation,current),elapsed=Date.now()-v36.lastSentAt;
        const shouldSend=!v36.lastLocation||moved>=30||elapsed>=90000;
        if(shouldSend){
          const payload={latitude:current.lat,longitude:current.lng,accuracy:pos.coords.accuracy,speed:pos.coords.speed,heading:pos.coords.heading};
          await api('/api/app/v6/driver/location',{method:'POST',body:payload});
          v36.lastLocation=current;v36.lastSentAt=Date.now();window.ChegaJaLastDriverLocation=current;
          if(activeDriverDelivery())api('/api/app/v16/driver/wait/geofence',{method:'POST',body:payload}).then(r=>{if(r?.stopped)toast('Cronômetro encerrado automaticamente ao sair do local.')}).catch(()=>{});
        }
      }catch(e){console.warn('Localização:',e)}finally{v36.locationBusy=false;v36.locationTimer=setTimeout(smartLocationTick,locationDelay());state.watchId=v36.locationTimer}
    },()=>{v36.locationBusy=false;v36.locationTimer=setTimeout(smartLocationTick,locationDelay());state.watchId=v36.locationTimer},{enableHighAccuracy:activeDriverDelivery(),maximumAge:activeDriverDelivery()?25000:90000,timeout:12000});
  }
  startLocation=function(){if(state.user?.role!=='driver'||!state.online)return;stopSmartLocation();smartLocationTick()};
  stopLocation=function(){stopSmartLocation()};

  function setModeClasses(){
    const role=state.user?.role,page=state.page;
    document.body.classList.toggle('cj14-base',page==='bases'&&['cooperative_admin','dispatcher'].includes(role));
    document.body.classList.toggle('cj14-driver',page==='dashboard'&&role==='driver');
    document.body.classList.toggle('cj14-establishment',page==='dashboard'&&role==='establishment');
    document.body.classList.toggle('cj14-client',Boolean(document.querySelector('.v32-client-app')));
  }

  function estRows(){
    const today=isoDate();
    return v36.estItems.filter(x=>{
      if(v36.estFilter==='active')return !closed(x.status);
      if(v36.estFilter==='closed_today')return closed(x.status)&&String(x.updated_at||x.created_at||'').slice(0,10)===today;
      if(v36.estFilter==='closed')return closed(x.status);
      return true;
    }).sort((a,b)=>{
      const rank=x=>!closed(x.status)&&!x.assigned_driver_id?0:!closed(x.status)?1:2;
      return rank(a)-rank(b)||String(b.created_at||'').localeCompare(String(a.created_at||''));
    });
  }
  function estTable(){
    const rows=estRows();
    if(!rows.length)return '<div class="cj14-empty">Nenhuma entrega neste filtro.</div>';
    return rows.map(x=>`<article class="cj14-est-row ${closed(x.status)?'closed':''} ${!x.assigned_driver_id&&!closed(x.status)?'priority':''}">
      <div><small>Pedido</small><strong>${esc(x.display_code||'Entrega')}</strong><span>${dateTime(x.created_at)}</span></div>
      <div><small>Cliente</small><strong>${esc(x.customer_name||x.recipient_name||'Cliente')}</strong><span>${esc(x.customer_phone||'')}</span></div>
      <div><small>Entrega</small><strong>${esc(x.delivery_address||'')}</strong></div>
      <div><small>Cooperado</small><strong>${esc(x.driver_name||'Não atribuído')}</strong></div>
      <div><small>Valores</small><strong>${moneySafe(x.charge_cents)}</strong>${x.delivery_type!=='base'&&n(x.amount_to_collect_cents)>0?`<span>Receber: ${moneySafe(x.amount_to_collect_cents)}</span>`:''}<span>${esc(paymentLabel(x.payment_method))}</span></div>
      <div><small>Status</small><span class="cj14-status s-${esc(x.status)}">${esc(statusLabel(x.status))}</span></div>
      <div class="cj14-actions"><button data-est-detail="${x.id}" title="Detalhes">◉</button>${!closed(x.status)?`<button data-est-assign="${x.id}" title="Atribuir cooperado">♟+</button>`:''}${x.tracking_token?`<button data-est-track="${x.id}" title="Copiar rastreio">⌖</button>`:''}</div>
    </article>`).join('');
  }
  function estSide(){
    const online=v36.estDrivers.filter(x=>n(x.online)===1);
    return `<aside class="cj14-est-side"><section><header><h3>Cooperados online</h3><b>${online.length}</b></header>${online.slice(0,8).map(x=>`<div><strong>${esc(x.name)}</strong><span>${esc([x.vehicle_model,x.vehicle_plate].filter(Boolean).join(' • '))}</span></div>`).join('')||'<p>Nenhum cooperado online.</p>'}</section><section><header><h3>Fila do contrato</h3><b>${v36.estQueue.length}</b></header>${v36.estQueue.slice(0,10).map((x,i)=>`<div><i>${i+1}</i><strong>${esc(x.driver_name)}</strong><span>${esc(x.vehicle_plate||'')}</span></div>`).join('')||'<p>Ninguém aguardando.</p>'}</section></aside>`;
  }
  function drawEstLeaflet(force=false){
    const host=$id('cj14-est-map');if(!host||typeof L==='undefined')return;
    if(v36.estGoogleMarkers.length){v36.estGoogleMarkers.forEach(marker=>{try{marker.map=null}catch{}});v36.estGoogleMarkers=[]}
    v36.estGoogleMap=null;v36.estGoogleHost=null;v36.estGoogleInfo=null;
    if(force||!v36.estMap||v36.estMap.getContainer()!==host){if(v36.estMap)try{v36.estMap.remove()}catch{}host.replaceChildren();v36.estMap=L.map(host,{zoomControl:true}).setView([-5.7945,-35.211],12);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(v36.estMap);v36.estLayer=L.layerGroup().addTo(v36.estMap)}
    v36.estLayer.clearLayers();const pts=[];
    v36.estDrivers.filter(x=>n(x.online)===1&&x.current_lat!=null&&x.current_lng!=null).forEach(x=>{const p=[n(x.current_lat),n(x.current_lng)];L.circleMarker(p,{radius:9,weight:4,fillOpacity:1,color:'#0d45d8'}).addTo(v36.estLayer).bindPopup(`<strong>${esc(x.name)}</strong><br>${esc(x.vehicle_plate||'')}`);pts.push(p)});
    v36.estItems.filter(x=>!closed(x.status)).slice(0,50).forEach(x=>{if(x.pickup_lat!=null&&x.pickup_lng!=null){const p=[n(x.pickup_lat),n(x.pickup_lng)];L.circleMarker(p,{radius:7,fillOpacity:1,color:'#16a05e'}).addTo(v36.estLayer).bindPopup(`<strong>${esc(x.display_code)}</strong><br>Coleta`);pts.push(p)}if(x.delivery_lat!=null&&x.delivery_lng!=null){const p=[n(x.delivery_lat),n(x.delivery_lng)];L.circleMarker(p,{radius:7,fillOpacity:1,color:'#f05a24'}).addTo(v36.estLayer).bindPopup(`<strong>${esc(x.display_code)}</strong><br>Entrega`);pts.push(p)}});
    if(force&&pts.length)v36.estMap.fitBounds(pts,{padding:[35,35],maxZoom:15});setTimeout(()=>v36.estMap?.invalidateSize(),60);
  }
  async function loadGoogleMaps(){
    if(!window.ChegaJaMaps?.config||!window.ChegaJaMaps?.ensureGoogle)throw new Error('O módulo de mapas ainda não carregou.');
    const config=await window.ChegaJaMaps.config();v36.googleMapsConfig=config;
    if(config.provider!=='google')throw new Error('OPENSTREETMAP_SELECTED');
    await window.ChegaJaMaps.ensureGoogle();
    return config;
  }
  function googleMarkerContent(color,label){const node=document.createElement('div');node.style.cssText=`width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:${color};border:3px solid #fff;box-shadow:0 3px 9px #0005;color:#fff;font:900 11px Arial`;node.textContent=label;return node}
  async function drawEstMap(force=false){
    const host=$id('cj14-est-map');if(!host)return;
    try{
      const config=await loadGoogleMaps();if(!host.isConnected||$id('cj14-est-map')!==host)return;
      const {Map}=await google.maps.importLibrary('maps'),{AdvancedMarkerElement}=await google.maps.importLibrary('marker');
      if(v36.estMap){try{v36.estMap.remove()}catch{}v36.estMap=null;v36.estLayer=null}
      if(force||!v36.estGoogleMap||v36.estGoogleHost!==host){host.replaceChildren();v36.estGoogleMap=new Map(host,{center:{lat:-5.7945,lng:-35.211},zoom:12,mapId:config.map_id||'DEMO_MAP_ID',mapTypeControl:false,streetViewControl:false,fullscreenControl:false});v36.estGoogleHost=host;v36.estGoogleInfo=new google.maps.InfoWindow()}
      v36.estGoogleMarkers.forEach(marker=>{try{marker.map=null}catch{}});v36.estGoogleMarkers=[];
      const bounds=new google.maps.LatLngBounds(),points=[];
      const addMarker=(position,title,color,label,html)=>{const marker=new AdvancedMarkerElement({map:v36.estGoogleMap,position,title,content:googleMarkerContent(color,label)});marker.addListener('click',()=>{v36.estGoogleInfo.setContent(html);v36.estGoogleInfo.open({map:v36.estGoogleMap,anchor:marker})});v36.estGoogleMarkers.push(marker);bounds.extend(position);points.push(position)};
      v36.estDrivers.filter(x=>n(x.online)===1&&x.current_lat!=null&&x.current_lng!=null).forEach(x=>{const p={lat:n(x.current_lat),lng:n(x.current_lng)};addMarker(p,x.name||'Cooperado','#0d45d8','M',`<strong>${esc(x.name)}</strong><br>${esc(x.vehicle_plate||'')}`)});
      v36.estItems.filter(x=>!closed(x.status)).slice(0,50).forEach(x=>{if(x.pickup_lat!=null&&x.pickup_lng!=null){const p={lat:n(x.pickup_lat),lng:n(x.pickup_lng)};addMarker(p,`${x.display_code||'Entrega'} — coleta`,'#16a05e','C',`<strong>${esc(x.display_code)}</strong><br>Coleta`)}if(x.delivery_lat!=null&&x.delivery_lng!=null){const p={lat:n(x.delivery_lat),lng:n(x.delivery_lng)};addMarker(p,`${x.display_code||'Entrega'} — entrega`,'#f05a24','E',`<strong>${esc(x.display_code)}</strong><br>Entrega`)}});
      if(force&&points.length>1)v36.estGoogleMap.fitBounds(bounds,55);else if(force&&points.length===1){v36.estGoogleMap.setCenter(points[0]);v36.estGoogleMap.setZoom(15)}
    }catch(error){
      if(v36.googleMapsConfig?.provider==='google'){console.error('Google Maps não carregou.',error);host.innerHTML=`<div class="cj149-map-error"><div><strong>Google Maps não carregou</strong>Confira no Administrador Master as duas chaves, o Map ID, as APIs e as restrições de domínio.<br><small>${esc(error.message||'Erro desconhecido')}</small></div></div>`;return}
      drawEstLeaflet(force)
    }
  }
  function bindEstablishment(){
    $id('cj14-est-new').onclick=async()=>{try{const base=await lgBase(true);counterOrderForm(base)}catch(e){toast(e.message,'error')}};
    $id('cj14-est-refresh').onclick=()=>loadEstablishment(false);
    $id('cj14-est-filter').onchange=e=>{v36.estFilter=e.target.value;$id('cj14-est-list').innerHTML=estTable();bindEstRows()};
    $id('cj14-est-full').onclick=()=>{const h=$id('cj14-est-map');if(h?.requestFullscreen)h.requestFullscreen()};
    bindEstRows();
  }
  function bindEstRows(){
    document.querySelectorAll('[data-est-detail]').forEach(b=>b.onclick=()=>driverDetailV6(v36.estItems.find(x=>x.id===b.dataset.estDetail)));
    document.querySelectorAll('[data-est-assign]').forEach(b=>b.onclick=()=>assignV6(v36.estItems.find(x=>x.id===b.dataset.estAssign)));
    document.querySelectorAll('[data-est-track]').forEach(b=>b.onclick=()=>{const x=v36.estItems.find(i=>i.id===b.dataset.estTrack);if(x?.tracking_token)copyText(`${location.origin}/r/${x.tracking_token}`)});
  }
  async function loadEstablishment(first=false){
    if(state.page!=='dashboard'||state.user?.role!=='establishment'||v36.estLoading)return;v36.estLoading=true;
    try{
      const [d,on,q]=await Promise.all([api('/api/app/tenant/deliveries'),api('/api/app/tenant/online-drivers').catch(()=>({items:[]})),api('/api/app/v10/queue').catch(()=>({items:[]}))]);
      v36.estItems=d.items||[];v36.estDrivers=on.items||[];v36.estQueue=q.items||[];
      const host=$id('page-content');if(first||!$id('cj14-est-map')){host.innerHTML=`<section class="cj14-est-dashboard"><header><div><p>COOPEX ENTREGAS</p><h1>Painel do estabelecimento</h1></div><div><button id="cj14-est-new">＋ Nova entrega</button><button id="cj14-est-refresh">↻ Atualizar</button></div></header><div class="cj14-est-grid"><main><section class="cj14-est-map-card"><div id="cj14-est-map"></div><button id="cj14-est-full">Tela cheia</button></section><section class="cj14-est-list-card"><header><div><h2>Entregas</h2><p>Não atribuídas aparecem primeiro. Encerradas continuam disponíveis.</p></div><select id="cj14-est-filter"><option value="active">Ativas</option><option value="closed_today">Encerradas hoje</option><option value="closed">Todas encerradas</option><option value="all">Todas</option></select></header><div id="cj14-est-list">${estTable()}</div></section></main><div id="cj14-est-side">${estSide()}</div></div></section>`;bindEstablishment();drawEstMap(true)}else{$id('cj14-est-list').innerHTML=estTable();$id('cj14-est-side').innerHTML=estSide();bindEstRows();drawEstMap(false)}
    }catch(e){toast(e.message,'error')}finally{v36.estLoading=false}
  }
  async function installEstablishment(){clearTimeout(v36.estTimer);document.body.classList.add('cj14-establishment');await loadEstablishment(true);const tick=async()=>{if(state.page!=='dashboard'||state.user?.role!=='establishment')return;!document.hidden&&await loadEstablishment(false);v36.estTimer=setTimeout(tick,20000)};v36.estTimer=setTimeout(tick,20000)}

  const priorDashboard=pages.dashboard;
  pages.dashboard=async function(){setModeClasses();if(state.user?.role==='driver')return window.ChegaJaV31?.installDriver();if(state.user?.role==='establishment')return installEstablishment();return priorDashboard()};
  const priorNavigate=navigate;
  navigate=async function(...args){if(args[0]!=='dashboard'){clearTimeout(v36.estTimer);document.body.classList.remove('cj14-establishment')}const result=await priorNavigate.apply(this,args);setModeClasses();return result};
  new MutationObserver(setModeClasses).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('load',()=>{setModeClasses();if(state.user?.role==='driver'&&state.online)startLocation()});
  window.ChegaJaV36={loadEstablishment,startLocation,stopLocation,get estItems(){return v36.estItems||[]},get estDrivers(){return v36.estDrivers||[]},get estQueue(){return v36.estQueue||[]}};
})();


/* ===== ChegaJá 14.3 — operação consolidada sem rotinas duplicadas ===== */
(function(){
  'use strict';
  const $id=id=>document.getElementById(id);
  const esc143=value=>typeof esc==='function'?esc(value):String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const clone=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
  const paymentLabels={pix:'PIX',dinheiro:'Dinheiro',cartao_credito:'Cartão de crédito',cartao_debito:'Cartão de débito',vale_alimentacao:'Vale-alimentação',vale_refeicao:'Vale-refeição',cortesia:'Cortesia',credit:'Crédito pré-pago',pix_cooperativa:'PIX Cooperativa'};
  const statusLabels143={new:'Não atribuída',offered:'Disponível',assigned:'Aguardando aceite',accepted:'Aceita',to_pickup:'A caminho da coleta',at_pickup:'Na coleta',picked_up:'Coletada',in_route:'Em rota',problem:'Com problema',delivered:'Entregue',cancelled:'Cancelada'};
  const activeStatus143=new Set(['new','offered','assigned','accepted','to_pickup','at_pickup','picked_up','in_route','problem']);
  const runtime={applyQueued:false,nav:null,drawer:null,sosTimer:null,sosBusy:false,sosSeen:new Set(),baseBound:new WeakSet(),cache:new Map(),inflight:new Map()};

  /* Reduz chamadas repetidas de módulos antigos sem atrasar ações do usuário. */
  const rawApi=api;
  const ttlFor=path=>{
    if(path.startsWith('/api/app/v15/sos/active'))return 15000;
    if(path.startsWith('/api/app/v6/driver/home'))return 8000;
    if(path.includes('/metrics')||path.includes('/wait'))return 12000;
    if(path.startsWith('/api/app/v10/queue/locations'))return 20000;
    if(path.startsWith('/api/app/v6/notifications')||path.startsWith('/api/app/v15/messages/unread'))return 15000;
    if(path.startsWith('/api/app/tenant/deliveries')||path.startsWith('/api/app/v16/base/live-map'))return 8000;
    return 0;
  };
  api=async function(path,options={}){
    const method=String(options.method||'GET').toUpperCase();
    if(method!=='GET'){runtime.cache.clear();return rawApi(path,options)}
    const ttl=ttlFor(path);if(!ttl)return rawApi(path,options);
    const hit=runtime.cache.get(path);if(hit&&Date.now()-hit.at<ttl)return clone(hit.data);
    if(runtime.inflight.has(path))return clone(await runtime.inflight.get(path));
    const request=rawApi(path,options).then(data=>{runtime.cache.set(path,{at:Date.now(),data});return data}).finally(()=>runtime.inflight.delete(path));
    runtime.inflight.set(path,request);return clone(await request);
  };

  /* Páginas do cooperado. */
  pageMeta.profile=['Perfil e configurações','○'];pageMeta.support=['Suporte','?'];pageMeta.ratings=['Avaliações','★'];pageMeta.schedules=['Minha escala','▦'];
  const driverGroup=navByRole.driver?.find(group=>group[0]==='Meu aplicativo');
  if(driverGroup){['schedules','ratings','support','profile'].forEach(page=>{if(!driverGroup[1].includes(page))driverGroup[1].push(page)})}
  for(const role of ['cooperative_admin','dispatcher']){const group=navByRole[role]?.find(item=>item[0]==='Operação');if(group&&!group[1].includes('ratings'))group[1].push('ratings')}

  const originalSchedules=pages.schedules;
  pages.schedules=async function(){
    if(state.user?.role!=='driver')return originalSchedules();
    const today=new Date(),from=new Date(today.getFullYear(),today.getMonth(),1).toISOString().slice(0,10),to=new Date(today.getFullYear(),today.getMonth()+1,0).toISOString().slice(0,10);
    const data=await api(`/api/app/tenant/schedules${query({from,to})}`),items=data.items||[];
    $id('page-content').innerHTML=`<section class="cj143-blue-card"><small>MINHA ESCALA</small><strong>${items.length}</strong><span>escala(s) neste mês</span></section>${panel('Escalas do período',table([{label:'Data',render:item=>dateOnly(String(item.start_at).slice(0,10))},{label:'Horário',render:item=>`${timeOnly(item.start_at)}–${timeOnly(item.end_at)}`},{label:'Local',render:item=>esc143(item.contract_name||item.base_name||item.establishment_name||'—')},{label:'Turno',render:item=>esc143(item.shift_label||'—')},{label:'Situação',render:item=>badge(item.status||'scheduled')}],items))}`;
  };
  pages.account=async function(){
    $id('page-content').innerHTML=panel('Alterar senha',`<form id="cj143-password-form" class="form-grid"><label>Senha atual<input name="current_password" type="password" required></label><label>Nova senha<input name="new_password" type="password" minlength="8" required></label><label>Confirmar nova senha<input name="confirm_password" type="password" minlength="8" required></label><div class="form-actions full"><button class="btn primary">Salvar nova senha</button></div></form>`);
    $id('cj143-password-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;if(form.new_password.value!==form.confirm_password.value)return toast('As novas senhas não são iguais.','error');try{loading(true);await api('/api/auth/change-password',{method:'POST',body:{current_password:form.current_password.value,new_password:form.new_password.value}});form.reset();toast('Senha alterada com sucesso.')}catch(error){toast(error.message,'error')}finally{loading(false)}};
  };
  pages.profile=async function(){
    if(state.user?.role!=='driver')return pages.account();
    const home=await api('/api/app/v6/driver/home'),driver=home.driver||{};
    $id('page-content').innerHTML=`<section class="cj143-blue-card"><small>MEU PERFIL</small><strong>${esc143(driver.name||state.user.name)}</strong><span>${esc143([driver.vehicle_model,driver.vehicle_plate].filter(Boolean).join(' • ')||'Veículo não informado')}</span></section>${panel('Dados e configurações',`<div class="cj143-profile-grid"><div><small>Telefone</small><strong>${esc143(driver.phone||'—')}</strong></div><div><small>E-mail</small><strong>${esc143(driver.email||state.user.email||'—')}</strong></div><div><small>Status</small><strong>${state.online?'Online':'Offline'}</strong></div><div><small>Escalas de hoje</small><strong>${Number(home.schedules?.length||0)}</strong></div></div><div class="cj143-profile-actions"><button class="btn primary" id="cj143-open-schedule">Minha escala</button><button class="btn" id="cj143-open-password">Alterar senha</button></div>`)}`;
    $id('cj143-open-schedule').onclick=()=>navigate('schedules');$id('cj143-open-password').onclick=()=>navigate('account');
  };
  pages.support=async function(){
    $id('page-content').innerHTML=panel('Suporte ChegaJá',`<section class="cj143-support"><div class="cj143-support-icon">?</div><h2>Precisa de ajuda?</h2><p>Envie uma mensagem para o suporte da COOPEX.</p><a class="btn primary" href="mailto:chegajja@gmail.com?subject=Suporte%20ChegaJ%C3%A1">Enviar e-mail para chegajja@gmail.com</a></section>`);
  };
  const originalRatings=pages.ratings;
  pages.ratings=async function(){
    if(state.user?.role!=='driver')return originalRatings();
    const data=await api('/api/app/v7/ratings'),score=(data.driver_scores||[])[0]||{score:5,count:0};
    $id('page-content').innerHTML=`<section class="cj143-blue-card"><small>MINHA AVALIAÇÃO</small><strong>★ ${Number(score.score||5).toFixed(2)}</strong><span>${Number(score.count||0)} avaliação(ões)</span></section>${panel('Avaliações recebidas',table([{label:'Data',render:item=>dateTime(item.created_at)},{label:'Pedido',key:'display_code'},{label:'Nota',render:item=>`<strong>★ ${Number(item.driver_score||0).toFixed(1)}</strong>`},{label:'Comentário',render:item=>esc143(item.comment||'—'),wrap:true}],data.items||[]))}`;
  };

  /* Um único menu em todas as telas do cooperado. */
  function closeDrawer(){runtime.drawer?.classList.remove('open')}
  function ensureDriverNavigation(){
    if(state.user?.role!=='driver'){
      runtime.nav?.remove();runtime.drawer?.remove();$id('cj143-driver-menu')?.remove();runtime.nav=null;runtime.drawer=null;document.body.classList.remove('cj143-driver');return;
    }
    document.body.classList.add('cj143-driver');document.querySelectorAll('.v31-driver-bottom,#cj42-driver-nav,#cj42-driver-menu,#cj42-driver-drawer').forEach(element=>element.remove());
    if(!runtime.nav||!runtime.nav.isConnected){runtime.nav=document.createElement('nav');runtime.nav.id='cj143-driver-nav';runtime.nav.innerHTML=`<button data-go="dashboard"><i>⌂</i><span>Início</span></button><button data-go="deliveries"><i>▢</i><span>Entregas</span></button><button id="cj143-sos" class="sos"><i>!</i><span>SOS</span></button><button data-go="financial"><i>$</i><span>Ganhos</span></button><button data-go="profile"><i>○</i><span>Perfil</span></button>`;document.body.appendChild(runtime.nav)}
    runtime.nav.querySelectorAll('[data-go]').forEach(button=>button.onclick=()=>navigate(button.dataset.go));$id('cj143-sos').onclick=openHelp;
    runtime.nav.querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.go===state.page));
    if(!runtime.drawer||!runtime.drawer.isConnected){runtime.drawer=document.createElement('div');runtime.drawer.id='cj143-driver-drawer';runtime.drawer.innerHTML=`<div class="backdrop"></div><aside><header><strong>ChegaJá</strong><button type="button">×</button></header><button data-go="dashboard">⌂ Início</button><button data-go="deliveries">▢ Entregas</button><button data-go="schedules">▦ Minha escala</button><button data-go="financial">$ Ganhos e descontos</button><button data-history>▤ Histórico por período</button><button data-go="ratings">★ Avaliações</button><button data-go="support">? Suporte</button><button data-go="profile">○ Perfil e configurações</button><button data-go="account">⌘ Alterar senha</button><button data-logout class="danger">↪ Sair</button></aside>`;document.body.appendChild(runtime.drawer);runtime.drawer.querySelector('.backdrop').onclick=closeDrawer;runtime.drawer.querySelector('header button').onclick=closeDrawer;runtime.drawer.querySelectorAll('[data-go]').forEach(button=>button.onclick=()=>{closeDrawer();navigate(button.dataset.go)});runtime.drawer.querySelector('[data-history]').onclick=()=>{closeDrawer();openDriverHistory()};runtime.drawer.querySelector('[data-logout]').onclick=()=>logout()}
    let menu=$id('cj143-driver-menu');if(!menu){menu=document.createElement('button');menu.id='cj143-driver-menu';menu.type='button';menu.textContent='☰';menu.title='Abrir menu';document.body.appendChild(menu)}menu.onclick=()=>runtime.drawer.classList.add('open');
    const embedded=$id('v31-driver-menu');if(embedded)embedded.onclick=()=>runtime.drawer.classList.add('open');
    [$id('v31-sos-top'),$id('v31-bottom-sos')].filter(Boolean).forEach(button=>button.onclick=event=>{event.preventDefault();openHelp()});
  }
  async function openDriverHistory(){
    const today=new Date(),first=new Date(today.getFullYear(),today.getMonth(),1),iso=date=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
    openModal('Histórico de entregas',`<form id="cj143-history-form" class="form-grid"><label>Data inicial<input name="from" type="date" value="${iso(first)}" required></label><label>Data final<input name="to" type="date" value="${iso(today)}" required></label><div class="form-actions full"><button class="btn primary">Pesquisar</button></div></form><div id="cj143-history-results"><p class="muted">Escolha o período e pesquise.</p></div>`);
    $id('cj143-history-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,box=$id('cj143-history-results');box.innerHTML='<p>Carregando…</p>';try{const data=await api(`/api/app/tenant/deliveries-v2${query({from:form.from.value,to:form.to.value})}`),items=data.items||[];box.innerHTML=items.length?`<div class="cj143-history-list">${items.map(item=>`<article><div><strong>${esc143(item.display_code||'Entrega')}</strong><small>${dateTime(item.created_at)}</small></div><span>${esc143(statusLabels143[item.status]||item.status)}</span><p>${esc143(item.pickup_address||'')} → ${esc143(item.delivery_address||'')}</p><b>${money(item.driver_net_cents||item.driver_earnings_cents||item.charge_cents)}</b></article>`).join('')}</div>`:'<p>Nenhuma entrega nesse período.</p>'}catch(error){box.innerHTML=`<p class="error">${esc143(error.message)}</p>`}};
  }

  /* SOS interno e Ajuda Pública sempre visíveis. */
  async function fastPosition(){
    if(window.ChegaJaLastDriverLocation)return {coords:{latitude:window.ChegaJaLastDriverLocation.lat,longitude:window.ChegaJaLastDriverLocation.lng,accuracy:null}};
    return new Promise((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:8000,maximumAge:60000}):reject(new Error('GPS indisponível.')));
  }
  function openHelp(){
    openModal('Ajuda e emergência',`<div class="cj143-help"><button id="cj143-send-sos" class="internal"><b>!</b><span><strong>SOS da cooperativa</strong>Alertar a Base e os cooperados online</span></button><div class="public"><b>✚</b><span><strong>Ajuda Pública</strong>Escolha o serviço</span></div></div><div class="cj143-public-list open"><a href="tel:190"><b>190</b>Polícia</a><a href="tel:192"><b>192</b>SAMU</a><a href="tel:193"><b>193</b>Bombeiros</a></div>`);
    $id('cj143-send-sos').onclick=sendInternalSos;
  }
  async function sendInternalSos(){
    const button=$id('cj143-send-sos');try{button.disabled=true;const position=await fastPosition(),item=window.ChegaJaV31?.driverData?.item;await api(item?`/api/app/v15/driver/deliveries/${item.id}/sos`:'/api/app/v15/driver/sos',{method:'POST',body:{occurrence:'Solicitação de ajuda enviada pelo aplicativo.',latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy}});closeModal();toast('Pedido de ajuda enviado para a Base.')}catch(error){toast(error.message||'Não foi possível enviar o pedido de ajuda.','error')}finally{if(button?.isConnected)button.disabled=false}
  }
  const parseSqlDate=value=>{if(!value)return 0;const text=String(value);return Date.parse(text.includes('T')?text:`${text.replace(' ','T')}Z`)};
  function ensureSosStack(){let stack=$id('cj143-sos-stack');if(!stack){stack=document.createElement('section');stack.id='cj143-sos-stack';document.body.appendChild(stack)}return stack}
  async function pollSos(force=false){
    if(runtime.sosBusy||!state.user||!['cooperative_admin','dispatcher','establishment'].includes(state.user.role))return;runtime.sosBusy=true;
    try{if(force)runtime.cache.delete('/api/app/v15/sos/active');const data=await api('/api/app/v15/sos/active'),now=Date.now(),items=(data.items||[]).filter(item=>!item.silenced_until||parseSqlDate(item.silenced_until)<=now),stack=ensureSosStack();stack.innerHTML=items.map(item=>`<article class="${item.helper_name?'acknowledged':''}"><header><strong>🚨 ${esc143(item.driver_name||'Cooperado')}</strong><button data-close="${item.id}" title="Encerrar">×</button></header><p>${esc143(item.occurrence||'Pedido de ajuda')}</p><small>${dateTime(item.created_at)}${item.helper_name?` • Ajuda: ${esc143(item.helper_name)}`:''}</small><div><button data-map="${item.id}">⌖ Local</button><button data-silence="${item.id}">🔇 10 min</button><button data-helper="${item.id}">Designar ajuda</button></div></article>`).join('');
      for(const item of items){if(!runtime.sosSeen.has(item.id)){runtime.sosSeen.add(item.id);try{sound?.play?.('problem')}catch{}}}
      stack.querySelectorAll('[data-map]').forEach(button=>button.onclick=()=>{const item=items.find(x=>x.id===button.dataset.map);if(item?.latitude!=null)window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.latitude},${item.longitude}`)}`,'_blank','noopener')});
      stack.querySelectorAll('[data-silence]').forEach(button=>button.onclick=async()=>{await api(`/api/app/v15/sos/${button.dataset.silence}/silence`,{method:'POST',body:{minutes:10}});toast('Alerta ocultado e silenciado por 10 minutos.');pollSos(true)});
      stack.querySelectorAll('[data-helper]').forEach(button=>button.onclick=()=>assignHelper(button.dataset.helper));
      stack.querySelectorAll('[data-close]').forEach(button=>button.onclick=async()=>{if(!confirm('Encerrar este pedido de ajuda?'))return;await api(`/api/app/v15/sos/${button.dataset.close}/resolve`,{method:'POST',body:{}});toast('Pedido de ajuda encerrado.');pollSos(true)});
    }catch(error){console.warn('SOS',error)}finally{runtime.sosBusy=false}
  }
  async function assignHelper(id){
    try{const data=await api('/api/app/tenant/online-drivers'),drivers=(data.items||[]).filter(item=>Number(item.online)===1);openModal('Designar cooperado para ajudar',`<form id="cj143-helper-form" class="form-grid"><label class="full">Cooperado<select name="driver_id" required><option value="">Selecione</option>${drivers.map(item=>`<option value="${esc143(item.id)}">${esc143(item.name)}${item.vehicle_plate?` • ${esc143(item.vehicle_plate)}`:''}</option>`).join('')}</select></label><div class="form-actions full"><button class="btn primary">Designar cooperado</button></div></form>`);$id('cj143-helper-form').onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/v15/sos/${id}/assign-helper`,{method:'POST',body:{driver_id:event.currentTarget.driver_id.value}});closeModal();toast('Ajuda designada. O cooperado foi avisado e verá a rota do SOS.');pollSos(true)}catch(error){toast(error.message,'error')}finally{loading(false)}}}catch(error){toast(error.message,'error')}
  }
  function startSos(){clearInterval(runtime.sosTimer);if(state.user&&['cooperative_admin','dispatcher','establishment'].includes(state.user.role)){pollSos();runtime.sosTimer=setInterval(()=>{if(!document.hidden)pollSos()},15000)}else{$id('cj143-sos-stack')?.remove()}}

  /* Edição rápida da Base: captura antes dos editores antigos. */
  const currentDelivery=id=>(window.ChegaJaV31?.baseData?.items||[]).find(item=>String(item.id)===String(id));
  async function refreshBase(){runtime.cache.clear();await window.ChegaJaV31?.loadBaseDashboard(false)}
  async function saveField(id,field,value){try{loading(true);await api(`/api/app/v15/base/deliveries/${encodeURIComponent(id)}/field`,{method:'PATCH',body:{field,value}});toast('Alteração salva.');await refreshBase()}catch(error){toast(error.message||'Não foi possível salvar.','error')}finally{loading(false)}}
  function editCell(cell,item){
    if(cell.dataset.cjEditing==='1')return;cell.dataset.cjEditing='1';const field=cell.dataset.cjField,restore=()=>refreshBase();
    if(field==='driver_id'){
      cell.innerHTML='<small>Cooperado</small><select class="cj143-inline"><option>Carregando…</option></select>';const select=cell.querySelector('select');
      api(`/api/app/v10/deliveries/${item.id}/eligible-drivers`).then(data=>{select.innerHTML=`<option value="">Não atribuído</option>${(data.items||[]).map(driver=>`<option value="${esc143(driver.id)}" ${String(driver.id)===String(item.assigned_driver_id)?'selected':''}>${esc143(driver.name)}${driver.queue_position?` • ${driver.queue_position}º na fila`:''}</option>`).join('')}`;select.onchange=()=>saveField(item.id,'driver_id',select.value);select.focus()}).catch(error=>{toast(error.message,'error');restore()});return;
    }
    if(field==='payment_method'||field==='status'){
      const options=field==='payment_method'?paymentLabels:statusLabels143;cell.innerHTML=`<small>${field==='status'?'Status':'Pagamento'}</small><select class="cj143-inline">${Object.entries(options).map(([value,label])=>`<option value="${value}" ${String(item[field])===value?'selected':''}>${label}</option>`).join('')}</select>`;const select=cell.querySelector('select');select.onchange=()=>{if(select.value==='cancelled'&&!confirm('Cancelar esta entrega? Ela continuará no histórico.'))return restore();saveField(item.id,field,select.value)};select.focus();return;
    }
    const moneyField=field==='charge_value',value=moneyField?(Number(item.charge_cents||0)/100).toFixed(2):String(item[field]||''),label={customer_name:'Cliente',pickup_address:'Coleta',delivery_address:'Entrega',charge_value:'Valor da entrega'}[field]||'Editar';
    cell.innerHTML=`<small>${label}</small><div class="cj143-inline-wrap"><input class="cj143-inline" type="${moneyField?'number':'text'}" ${moneyField?'step="0.01" min="0.01"':''} value="${esc143(value)}"><button type="button">✓</button><button type="button">×</button></div>`;const input=cell.querySelector('input'),buttons=cell.querySelectorAll('button');buttons[0].onclick=event=>{event.stopPropagation();saveField(item.id,field,input.value)};buttons[1].onclick=event=>{event.stopPropagation();restore()};input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();saveField(item.id,field,input.value)}if(event.key==='Escape')restore()};input.focus();input.select();
  }
  document.addEventListener('click',event=>{
    const cell=event.target.closest('.v31-delivery-row [data-cj-field]');if(!cell||event.target.closest('input,select,button,a'))return;const row=cell.closest('.v31-delivery-row'),item=currentDelivery(row?.dataset.deliveryId);if(!item)return;event.preventDefault();event.stopImmediatePropagation();editCell(cell,item);
  },true);
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-cj-cancel]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();if(confirm('Cancelar esta entrega? Ela continuará no histórico.'))saveField(button.dataset.cjCancel,'status','cancelled');
  },true);

  function baseFilters(){
    const scope=$id('v31-scope-filter')?.value||'active',status=$id('v31-status-filter')?.value||'',from=$id('cj143-base-from')?.value||'',to=$id('cj143-base-to')?.value||'';
    document.querySelectorAll('.v31-delivery-row').forEach(row=>{const active=row.dataset.active==='1',day=String(row.dataset.created||'').slice(0,10),scopeOk=scope==='all'||(scope==='active'&&active)||(scope==='closed'&&!active)||(scope==='closed_today'&&!active&&day===isoDate()),statusOk=!status||row.dataset.status===status,dateOk=(!from||day>=from)&&(!to||day<=to);row.classList.toggle('hidden',!(scopeOk&&statusOk&&dateOk))});
  }
  function mapPayload(){const bundle=window.ChegaJaV31?.baseData||{};return {base:bundle.mapData?.base||{},drivers:(bundle.mapData?.items||[]).filter(item=>Number(item.online)===1&&item.current_lat!=null&&item.current_lng!=null),orders:(bundle.items||[]).filter(item=>activeStatus143.has(String(item.status)))} }
  function openMapTab(payload,title='Mapa em tempo real'){
    const popup=window.open('','_blank');if(!popup)return toast('Permita pop-ups para abrir o mapa.','error');const safe=JSON.stringify(payload).replace(/</g,'\\u003c'),safeTitle=JSON.stringify(title);popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc143(title)}</title><link rel="stylesheet" href="${location.origin}/vendor/leaflet/leaflet.css"><style>html,body,#map{height:100%;margin:0}.title{position:fixed;z-index:9999;left:12px;top:12px;background:#fff;padding:10px 14px;font:700 14px Arial;box-shadow:0 4px 18px #0002}</style></head><body><div class="title"></div><div id="map"></div><script src="${location.origin}/vendor/leaflet/leaflet.js"><\/script><script>const d=${safe},title=${safeTitle};document.querySelector('.title').textContent=title;const m=L.map('map').setView([-5.7945,-35.211],12);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(m);const pts=[];if(d.base&&d.base.latitude!=null){const p=[+d.base.latitude,+d.base.longitude];L.marker(p).addTo(m).bindPopup(d.base.name||'Base');pts.push(p)}(d.drivers||[]).forEach(x=>{const p=[+x.current_lat,+x.current_lng];L.marker(p).addTo(m).bindPopup(x.name||'Cooperado');pts.push(p)});(d.orders||[]).forEach(x=>{if(x.pickup_lat!=null){const p=[+x.pickup_lat,+x.pickup_lng];L.circleMarker(p,{radius:7}).addTo(m).bindPopup((x.display_code||'Entrega')+' — coleta');pts.push(p)}if(x.delivery_lat!=null){const p=[+x.delivery_lat,+x.delivery_lng];L.circleMarker(p,{radius:6}).addTo(m).bindPopup((x.display_code||'Entrega')+' — entrega');pts.push(p)}});if(pts.length>1)m.fitBounds(pts,{padding:[30,30],maxZoom:15});else if(pts.length===1)m.setView(pts[0],15);<\/script></body></html>`);popup.document.close();
  }
  function enhanceBase(){
    if(!document.querySelector('.v31-base-shell'))return;document.body.classList.add('cj143-base');
    document.querySelectorAll('[data-v31-edit],[data-v31-assign]').forEach(button=>button.remove());
    document.querySelectorAll('.v31-delivery-row').forEach(row=>row.querySelector('[data-cj-amount]')?.remove());
    const card=document.querySelector('.v31-deliveries-card'),toolbar=document.querySelector('.v31-toolbar'),header=card?.querySelector('header');if(header&&toolbar&&toolbar.parentElement!==header)header.appendChild(toolbar);
    if(toolbar&&!$id('cj143-base-from')){toolbar.insertAdjacentHTML('afterbegin','<input id="cj143-base-from" type="date" title="Data inicial"><input id="cj143-base-to" type="date" title="Data final">');[$id('cj143-base-from'),$id('cj143-base-to'),$id('v31-scope-filter'),$id('v31-status-filter')].filter(Boolean).forEach(input=>input.onchange=baseFilters)}
    const mapCard=document.querySelector('.v31-map-card');if(mapCard&&!$id('cj143-map-tab')){const button=document.createElement('button');button.id='cj143-map-tab';button.type='button';button.textContent='Nova aba';button.onclick=()=>openMapTab(mapPayload(),'Mapa da Base');mapCard.appendChild(button)}
    $id('v31-map-full')?.setAttribute('title','Tela cheia');baseFilters();
  }
  function enhanceEstablishment(){
    const mapCard=document.querySelector('.cj14-est-map-card');if(!mapCard)return;document.body.classList.add('cj143-establishment');if(!$id('cj143-est-map-tab')){const button=document.createElement('button');button.id='cj143-est-map-tab';button.type='button';button.textContent='Nova aba';button.onclick=()=>{const items=window.ChegaJaV36?.estItems||[];openMapTab({base:{name:'Estabelecimento'},drivers:window.ChegaJaV36?.estDrivers||[],orders:items.filter(item=>activeStatus143.has(String(item.status)))},'Mapa do estabelecimento')};mapCard.appendChild(button)}}

  /* Upload de fotos e logotipos pelo computador. */
  const imageDataBytes=data=>{const base64=String(data||'').split(',')[1]||'';return Math.floor(base64.length*3/4)-(base64.endsWith('==')?2:base64.endsWith('=')?1:0)};
  async function imageData(file,options={}){
    if(!file)return '';if(!String(file.type||'').startsWith('image/'))throw new Error('Escolha um arquivo de imagem.');if(Number(file.size||0)>20*1024*1024)throw new Error('A imagem original é maior que 20 MB. Escolha uma imagem menor.');
    let source=null,objectUrl='';
    try{
      if(typeof createImageBitmap==='function'){try{source=await createImageBitmap(file,{imageOrientation:'from-image'})}catch{source=null}}
      if(!source){objectUrl=URL.createObjectURL(file);source=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('A imagem não pôde ser aberta. Converta para JPG, PNG ou WEBP e tente novamente.'));img.src=objectUrl})}
      const sourceWidth=Number(source.width||source.naturalWidth),sourceHeight=Number(source.height||source.naturalHeight);if(!sourceWidth||!sourceHeight)throw new Error('A imagem não possui dimensões válidas.');
      const targetBytes=Math.max(120000,Number(options.targetBytes||440000)),maxSide=Math.max(320,Number(options.maxSide||900));let scale=Math.min(1,maxSide/Math.max(sourceWidth,sourceHeight)),data='';
      for(let sizeAttempt=0;sizeAttempt<5;sizeAttempt++){
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(sourceWidth*scale));canvas.height=Math.max(1,Math.round(sourceHeight*scale));const context=canvas.getContext('2d',{alpha:true});if(!context)throw new Error('O navegador não conseguiu preparar a imagem.');context.drawImage(source,0,0,canvas.width,canvas.height);
        for(let quality=.9;quality>=.42;quality-=.08){data=canvas.toDataURL('image/webp',quality);if(!data.startsWith('data:image/webp'))data=canvas.toDataURL('image/jpeg',quality);if(imageDataBytes(data)<=targetBytes)break}
        if(imageDataBytes(data)<=targetBytes)return data;scale*=.82;
      }
      throw new Error('A imagem continuou muito grande depois da redução. Escolha outra imagem.');
    }finally{if(objectUrl)URL.revokeObjectURL(objectUrl);if(source&&typeof source.close==='function')source.close()}
  }
  window.ChegaJaImageTools={prepare:imageData,bytes:imageDataBytes};
  function uploadPreview145(host,data){let preview=host.querySelector('.cj147-upload-preview');if(!preview){preview=document.createElement('img');preview.className='cj147-upload-preview';preview.alt='Prévia da imagem';host.appendChild(preview)}preview.src=data;preview.hidden=false}
  function enhanceUploads(){
    const settings=$id('tenant-settings');if(settings&&!settings.dataset.cj143){settings.dataset.cj143='1';const urlInput=settings.elements.logo_url;if(urlInput){const label=urlInput.closest('label');urlInput.type='hidden';if(label)label.style.display='none';settings.insertAdjacentHTML('afterbegin','<label class="full cj143-file cj147-upload-box">Logo da cooperativa<input id="cj143-coop-logo" type="file" accept="image/*"><small>Escolha uma imagem do computador ou celular. Ela será reduzida automaticamente.</small></label>');const input=$id('cj143-coop-logo');input.onchange=async event=>{const file=event.target.files?.[0];if(!file)return;try{loading(true);input.disabled=true;const data_url=await imageData(file,{maxSide:900,targetBytes:440000}),result=await api('/api/app/v15/tenant/logo',{method:'POST',body:{data_url}});urlInput.value=result.logo_url;const preview=$id('branding-preview-logo');if(preview)preview.src=result.logo_url;uploadPreview145(input.closest('.cj147-upload-box'),result.logo_url);toast('Logo enviada e salva.')}catch(error){event.target.value='';toast(error.message,'error')}finally{input.disabled=false;loading(false)}}}}
    const form=$id('est-form-v7');if(form&&!form.dataset.cj143){form.dataset.cj143='1';const urlInput=form.elements.logo_url;if(urlInput){const label=urlInput.closest('label');urlInput.type='hidden';if(label)label.style.display='none'}if(!$id('cj143-est-logo'))form.insertAdjacentHTML('afterbegin','<label class="full cj143-file cj147-upload-box">Foto ou logo do estabelecimento<input id="cj143-est-logo" type="file" accept="image/*"><input type="hidden" name="logo_data_url"><small>Escolha uma imagem. Aguarde aparecer a prévia antes de salvar.</small></label>');const input=$id('cj143-est-logo'),submit=form.querySelector('button[type="submit"]');input.onchange=async event=>{const file=event.target.files?.[0];if(!file)return;try{input.disabled=true;if(submit)submit.disabled=true;const host=input.closest('.cj147-upload-box'),small=host.querySelector('small');small.textContent='Preparando imagem…';const prepared=await imageData(file,{maxSide:900,targetBytes:440000});form.elements.logo_data_url.value=prepared;uploadPreview145(host,prepared);small.textContent='Imagem pronta. Clique em Salvar para concluir.';toast('Imagem pronta para salvar.')}catch(error){event.target.value='';form.elements.logo_data_url.value='';toast(error.message,'error')}finally{input.disabled=false;if(submit)submit.disabled=false}}}
  }

  /* XLSX de ganhos e descontos sem biblioteca externa. */
  const crcTable=(()=>{const table=[];for(let n=0;n<256;n++){let value=n;for(let k=0;k<8;k++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;table[n]=value>>>0}return table})();
  const crc32=bytes=>{let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0};
  const u16=value=>new Uint8Array([value&255,(value>>>8)&255]),u32=value=>new Uint8Array([value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255]);
  const concat=parts=>{const output=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length}return output};
  function zipStore(files){const encoder=new TextEncoder(),parts=[],central=[];let offset=0;for(const [name,text] of Object.entries(files)){const nameBytes=encoder.encode(name),data=encoder.encode(text),crc=crc32(data),local=concat([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(nameBytes.length),u16(0),nameBytes,data]);parts.push(local);central.push(concat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(nameBytes.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nameBytes]));offset+=local.length}const directory=concat(central),end=concat([u32(0x06054b50),u16(0),u16(0),u16(central.length),u16(central.length),u32(directory.length),u32(offset),u16(0)]);return new Blob([...parts,directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})}
  function downloadXlsx(name,rows){const xml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char])),sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row,index)=>`<row r="${index+1}">${row.map((value,column)=>{const ref=String.fromCharCode(65+column)+(index+1),number=typeof value==='number';return `<c r="${ref}" t="${number?'n':'inlineStr'}">${number?`<v>${value}</v>`:`<is><t>${xml(value)}</t></is>`}</c>`}).join('')}</row>`).join('')}</sheetData></worksheet>`,files={'[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>','_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>','xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ganhos e descontos" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':sheet},anchor=document.createElement('a');anchor.href=URL.createObjectURL(zipStore(files));anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000)}
  const originalFinancial=pages.financial;
  pages.financial=async function(){await originalFinancial();if(state.user?.role==='driver'){const host=document.querySelector('.driver-finance-list header div')||document.querySelector('.driver-finance-list header');if(host&&!$id('cj143-export-finance')){const button=document.createElement('button');button.id='cj143-export-finance';button.className='btn small';button.textContent='Exportar XLSX';button.onclick=async()=>{const from=$id('v6-fin-from')?.value||mondayOf(isoDate()),to=$id('v6-fin-to')?.value||addDays(from,6),data=await api(`/api/app/driver/finance${query({from,to})}`),rows=[['Data','Descrição','Categoria','Tipo','Valor (R$)'],...(data.items||[]).map(item=>[item.reference_date,item.description,item.category,item.entry_type,Number(item.amount_cents||0)/100])];downloadXlsx(`ganhos-descontos-${from}-${to}.xlsx`,rows)};host.appendChild(button)}}};

  function enhanceCustomerAccess(){const button=$id('customer-app-link');if(button){const saved=localStorage.getItem('chegaja_customer_cooperative');button.textContent=saved?'Área do cliente':'Cadastro de cliente';if(!button.nextElementSibling?.classList.contains('cj143-client-hint'))button.insertAdjacentHTML('afterend',`<small class="cj143-client-hint">${saved?'Este aparelho já está vinculado. Entre normalmente com celular/e-mail e senha.':'O primeiro acesso neste aparelho deve usar o link oficial da cooperativa.'}</small>`)}}
  function enhanceQueue(){
    const enter=$id('v32-enter-queue');if(enter&&!enter.dataset.cj143){enter.dataset.cj143='1';enter.onclick=async()=>{if(enter.disabled)return;enter.disabled=true;const old=enter.textContent;enter.textContent='Entrando…';try{const selected=$id('v32-queue-location')?.value||'',separator=selected.indexOf(':'),type=selected.slice(0,separator),location_id=selected.slice(separator+1);if(!type||!location_id)throw new Error('Selecione a Base ou contrato.');const position=await fastPosition();await api('/api/app/v10/queue/arrive',{method:'POST',body:{location_type:type,location_id,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy}});toast('Você entrou no fim da fila.');await window.ChegaJaV32?.queueWidget(true)}catch(error){toast(error.message||'Não foi possível entrar na fila.','error')}finally{enter.disabled=false;enter.textContent=old||'Entrar na fila'}}}
    const leave=$id('v32-leave-queue');if(leave&&!leave.dataset.cj143){leave.dataset.cj143='1';leave.onclick=async()=>{if(leave.disabled)return;leave.disabled=true;const old=leave.textContent;leave.textContent='Saindo…';try{await api('/api/app/v10/queue/leave',{method:'POST',body:{}});toast('Você saiu da fila.');await window.ChegaJaV32?.queueWidget(true)}catch(error){toast(error.message,'error')}finally{leave.disabled=false;leave.textContent=old||'Sair da fila'}}}
  }
  function apply(){
    ensureDriverNavigation();enhanceBase();enhanceEstablishment();enhanceUploads();enhanceCustomerAccess();enhanceQueue();
    if(state.user?.role!=='driver')document.body.classList.remove('cj143-driver');
  }
  function queueApply(){if(runtime.applyQueued)return;runtime.applyQueued=true;requestAnimationFrame(()=>{runtime.applyQueued=false;apply()})}
  new MutationObserver(queueApply).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('load',()=>{apply();startSos()});document.addEventListener('visibilitychange',()=>{if(!document.hidden){apply();pollSos()}});
  const rawNavigate=navigate;navigate=async function(...args){const result=await rawNavigate.apply(this,args);setTimeout(()=>{apply();startSos()},30);return result};
  window.ChegaJaV37={apply,pollSos,openSosMenu:openHelp,openDriverHistory};
  window.ChegaJa143={apply,openMapTab,downloadXlsx};
})();


/* ===== ChegaJá 14.10.0 — filtros financeiros, totais, rateios e edição concluída ===== */
(function(){
  const oldFinancial=pages.financial,oldExpenses=pages.expenses,oldDeductions=pages.deductions;
  const range=()=>({from:state.cache.cj1410From||state.cache.reportFrom||mondayOf(isoDate()),to:state.cache.cj1410To||state.cache.reportTo||isoDate()});
  const safeName=value=>String(value||'todos').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase()||'todos';
  const xlsx=(name,rows)=>window.ChegaJa143?.downloadXlsx?.(name,rows);
  const locationOptions=base=>[
    {id:'general',name:'Geral / sem local'},
    ...(base.bases||[]).map(x=>({id:`base:${x.id}`,name:`BASE — ${x.name}`})),
    ...(base.establishments||[]).filter(x=>!String(x.name||'').toLowerCase().startsWith('base —')).map(x=>({id:`est:${x.id}`,name:`ESTABELECIMENTO — ${x.name}`}))
  ];
  const optionHtml=(items,value,first='Todos os estabelecimentos e Bases')=>`<option value="">${first}</option>${items.map(x=>`<option value="${esc(x.id)}" ${String(value||'')===String(x.id)?'selected':''}>${esc(x.name)}</option>`).join('')}`;
  const totalFooter=(label,value,extra='')=>`<div class="cj1410-total-footer"><span>${esc(label)}</span><strong>${money(value)}</strong>${extra}</div>`;
  const filterBar=(base,{driverId='',locationKey='',showDriver=true}={})=>{const r=range(),locations=locationOptions(base);return `<div class="toolbar cj1410-filterbar"><label>De<input id="cj1410-from" type="date" value="${r.from}"></label><label>Até<input id="cj1410-to" type="date" value="${r.to}"></label>${showDriver?`<label>Cooperado<select id="cj1410-driver"><option value="">Todos os cooperados</option>${(base.drivers||[]).map(x=>`<option value="${x.id}" ${driverId===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>`:''}<label>Cliente / local<select id="cj1410-location">${optionHtml(locations,locationKey)}</select></label><button class="btn primary" id="cj1410-apply">Aplicar filtros</button><button class="btn" id="cj1410-export">Exportar Excel por cliente</button></div>`};
  const bindFilters=reload=>{$('#cj1410-apply')?.addEventListener('click',()=>{state.cache.cj1410From=$('#cj1410-from').value;state.cache.cj1410To=$('#cj1410-to').value;state.cache.financeDriver=$('#cj1410-driver')?.value||'';state.cache.cj1410Location=$('#cj1410-location')?.value||'';reload()})};
  const selectedLocationName=(base,key)=>locationOptions(base).find(x=>x.id===key)?.name||'Todos os clientes';

  pages.financial=async function(){
    if(!['cooperative_admin','dispatcher'].includes(state.user?.role||''))return oldFinancial();
    const base=await lgBase(),r=range(),driverId=state.cache.financeDriver||'',locationKey=state.cache.cj1410Location||'',params={from:r.from,to:r.to,driver_id:driverId,location_key:locationKey};
    await api('/api/app/financial/reconcile',{method:'POST',body:{driver_id:driverId}}).catch(()=>{});
    const [entries,summary]=await Promise.all([api(`/api/app/financial${query(params)}`),api(`/api/app/financial/summary${query(params)}`)]),items=entries.items||[],s=summary.data||entries.totals||{};
    const cleanDesc=value=>String(value||'').replace(/\s*[•·]\s*lote\s+[a-z0-9-]+/gi,'').trim();
    const kind=x=>x.financial_class==='production_received'?'<span class="positive">Produção já recebida</span>':x.financial_class==='production_receivable'?'<span class="positive">Produção</span>':x.entry_type==='credit'?'<span class="positive">Crédito</span>':'<span class="negative">Desconto</span>';
    const status=x=>x.financial_class==='production_received'?'<span class="badge paid">RECEBIDO</span>':badge(x.status);
    const amount=x=>x.entry_type==='debit'&&x.status==='open'&&Number(x.settled_cents||0)>0?`${money(x.remaining_cents)}<br><small>restante de ${money(x.amount_cents)}</small>`:money(x.amount_cents);
    const rows=table([{label:'Data',render:x=>dateOnly(x.reference_date)},{label:'Cooperado',key:'driver_name'},{label:'Cliente / local',render:x=>esc(x.location_name||x.base_name||x.establishment_name||'Geral')},{label:'Tipo',render:kind},{label:'Categoria',key:'category'},{label:'Descrição',render:x=>esc(cleanDesc(x.description)),wrap:true},{label:'Valor',render:amount},{label:'Status',render:status}],items,x=>state.user.role==='cooperative_admin'&&x.category!=='delivery'?`<button class="table-action" data-cj1410-cancel="${x.id}">Cancelar</button>`:'');
    const balance=Number(s.balance_cents||0),balanceLabel=balance<0?'Saldo pendente do cooperado':'Saldo a receber';
    $('#page-content').innerHTML=cards([{icon:'＋',value:money(s.production_receivable_cents||0),label:'Produção para fechamento'},{icon:'✓',value:money(s.direct_received_cents||0),label:'Produção já recebida'},{icon:'−',value:money(s.debits_cents||0),label:'Descontos lançados'},{icon:'=',value:money(balance),label:balanceLabel}])+panel('Ganhos e descontos dos cooperados',filterBar(base,{driverId,locationKey})+`<div class="notice"><strong>Regra do saldo:</strong> entregas de estabelecimentos e entregas da Base pagas por PIX Cooperativa ou crédito antecipado formam saldo para descontos. Somente PIX comum e dinheiro da Base são produção já recebida. Cartões e vales informam apenas a cobrança de produto/refeição nos estabelecimentos e nunca são ganho do cooperado.</div>`+rows+totalFooter(balance<0?'SALDO PENDENTE DO FILTRO':'TOTAL A RECEBER NO FILTRO',balance,`<small>${items.length} lançamento(s)</small>`)+(state.user.role==='cooperative_admin'?'<div class="cj1410-actions"><button class="btn primary" id="new-financial">Novo ganho ou desconto</button></div>':''));
    bindFilters(pages.financial);
    $('#cj1410-export')?.addEventListener('click',()=>{const local=selectedLocationName(base,locationKey),data=[['Data','Cooperado','Cliente / local','Tipo','Categoria','Descrição','Valor (R$)','Valor restante (R$)','Status'],...items.map(x=>[x.reference_date,x.driver_name,x.location_name||'Geral',x.financial_class==='production_received'?'Produção já recebida':x.financial_class==='production_receivable'?'Produção para fechamento':x.entry_type==='credit'?'Crédito':'Desconto',x.category,cleanDesc(x.description),Number(x.amount_cents||0)/100,Number(x.remaining_cents||0)/100,x.financial_class==='production_received'?'recebido':x.status]),[],['PRODUÇÃO PARA FECHAMENTO',Number(s.production_receivable_cents||0)/100],['PRODUÇÃO JÁ RECEBIDA',Number(s.direct_received_cents||0)/100],['DESCONTOS',Number(s.debits_cents||0)/100],['SALDO',balance/100]];xlsx(`financeiro-${safeName(local)}-${r.from}-a-${r.to}.xlsx`,data)});
    $('#new-financial')?.addEventListener('click',()=>financialForm(base));
    $$('[data-cj1410-cancel]').forEach(b=>b.onclick=async()=>{if(confirm('Cancelar este lançamento?')){await api(`/api/app/financial/${b.dataset.cj1410Cancel}`,{method:'DELETE'});pages.financial()}});
  };

  pages.expenses=async function(){
    if(!['cooperative_admin','dispatcher'].includes(state.user?.role||''))return oldExpenses();
    const base=await lgBase(),r=range(),driverId=state.cache.financeDriver||'',locationKey=state.cache.cj1410Location||'',params={from:r.from,to:r.to,location_key:locationKey};
    const [coop,financial]=await Promise.all([api(`/api/app/v10/expenses${query(params)}`),api(`/api/app/financial${query({...params,driver_id:driverId})}`)]),cooperativeItems=coop.items||[],driverItems=(financial.items||[]).filter(x=>x.entry_type==='debit'&&!['INSS','SEST/SENAT','advance','configured_deduction'].includes(String(x.category))&&x.status!=='cancelled');
    const coopTotal=cooperativeItems.reduce((a,x)=>a+(x.status==='active'?Number(x.amount_cents||0):0),0),driverTotal=driverItems.reduce((a,x)=>a+Number(x.amount_cents||0),0),grand=coopTotal+driverTotal;
    const driverTable=table([{label:'Data',render:x=>dateOnly(x.reference_date)},{label:'Cooperado',key:'driver_name'},{label:'Cliente / local',render:x=>esc(x.location_name||'Geral')},{label:'Categoria',key:'category'},{label:'Descrição',key:'description',wrap:true},{label:'Valor',render:x=>money(x.amount_cents)},{label:'Status',render:x=>badge(x.status)}],driverItems,x=>state.user.role==='cooperative_admin'?`<button class="table-action" data-cj1410-del-driver="${x.id}">Cancelar</button>`:'');
    const coopTable=table([{label:'Data',render:x=>dateOnly(x.reference_date)},{label:'Categoria',key:'category'},{label:'Descrição',key:'description',wrap:true},{label:'Cliente / local',render:x=>esc(x.location_name||'Geral')},{label:'Valor',render:x=>money(x.amount_cents)},{label:'Lançado por',key:'created_by_name'}],cooperativeItems,x=>state.user.role==='cooperative_admin'?`<button class="table-action" data-cj1410-del-expense="${x.id}">Excluir</button>`:'');
    $('#page-content').innerHTML=cards([{icon:'−',value:money(coopTotal),label:'Despesas da cooperativa'},{icon:'♟',value:money(driverTotal),label:'Despesas dos cooperados'},{icon:'=',value:money(grand),label:'Total geral'}])+panel('Filtros e exportação',filterBar(base,{driverId,locationKey}))+panel('Despesas lançadas para cooperados',driverTable+totalFooter('TOTAL DOS COOPERADOS',driverTotal)+(state.user.role==='cooperative_admin'?'<div class="cj1410-actions"><button class="btn primary" id="new-driver-expense">Nova despesa do cooperado</button></div>':''))+panel('Despesas administrativas da cooperativa',coopTable+totalFooter('TOTAL ADMINISTRATIVO',coopTotal)+(state.user.role==='cooperative_admin'?'<div class="cj1410-actions"><button class="btn" id="new-expense">Nova despesa administrativa</button></div>':''))+totalFooter('TOTAL GERAL DAS DESPESAS',grand,`<small>${driverItems.length+cooperativeItems.length} lançamento(s)</small>`);
    bindFilters(pages.expenses);
    $('#cj1410-export')?.addEventListener('click',()=>{const local=selectedLocationName(base,locationKey),rows=[['Tipo','Data','Cooperado','Cliente / local','Categoria','Descrição','Valor (R$)'],...driverItems.map(x=>['Despesa do cooperado',x.reference_date,x.driver_name,x.location_name||'Geral',x.category,x.description,Number(x.amount_cents||0)/100]),...cooperativeItems.map(x=>['Despesa administrativa',x.reference_date,'',x.location_name||'Geral',x.category,x.description,Number(x.amount_cents||0)/100]),[],['TOTAL COOPERADOS','','','','','',driverTotal/100],['TOTAL ADMINISTRATIVO','','','','','',coopTotal/100],['TOTAL GERAL','','','','','',grand/100]];xlsx(`despesas-${safeName(local)}-${r.from}-a-${r.to}.xlsx`,rows)});
    const locations=locationOptions(base);
    $('#new-driver-expense')?.addEventListener('click',()=>{openModal('Nova despesa do cooperado',`<form id="cj1410-driver-expense" class="form-grid">${selectField('Cooperado','driver_id',base.drivers||[],driverId,'Selecione','required')}<label>Cliente / local<select name="location_key">${optionHtml(locations,locationKey,'Geral / sem local')}</select></label>${field('Data','reference_date',isoDate(),'date','required')}${field('Categoria','category','outra_despesa','text','required')}${field('Valor por cooperado','amount','','number','required step="0.01" min="0.01"')}${textarea('Descrição','description','','required')}${buttons()}</form>`);$('#cj1410-driver-expense').onsubmit=async e=>{e.preventDefault();const body=formObject(e.currentTarget);body.entry_type='debit';await api('/api/app/financial',{method:'POST',body});closeModal();toast('Despesa lançada para o cooperado.');pages.expenses()}});
    $('#new-expense')?.addEventListener('click',()=>{openModal('Nova despesa administrativa',`<form id="cj1410-expense" class="form-grid"><label>Cliente / local<select name="location_key">${optionHtml(locations,locationKey,'Geral / sem local')}</select></label>${field('Data','reference_date',isoDate(),'date','required')}${field('Categoria','category','','text','required')}${field('Valor','amount','','number','required step="0.01" min="0.01"')}${textarea('Descrição','description','','required')}${buttons()}</form>`);$('#cj1410-expense').onsubmit=async e=>{e.preventDefault();await api('/api/app/v10/expenses',{method:'POST',body:formObject(e.currentTarget)});closeModal();toast('Despesa administrativa lançada.');pages.expenses()}});
    $$('[data-cj1410-del-driver]').forEach(b=>b.onclick=async()=>{if(confirm('Cancelar esta despesa do cooperado?')){await api(`/api/app/financial/${b.dataset.cj1410DelDriver}`,{method:'DELETE'});pages.expenses()}});
    $$('[data-cj1410-del-expense]').forEach(b=>b.onclick=async()=>{if(confirm('Excluir esta despesa administrativa?')){await api(`/api/app/v10/expenses/${b.dataset.cj1410DelExpense}`,{method:'DELETE'});pages.expenses()}});
  };

  function allocationModal(base){
    const drivers=(base.drivers||[]).filter(x=>x.status!=='inactive');
    openModal('Aplicar imposto ou rateio aos cooperados',`<form id="cj1410-allocation" class="form-grid">${field('Nome do imposto ou rateio','name','','text','required placeholder="Ex.: Rateio administrativo"')}${field('Categoria','category','rateio','text','required')}${field('Data de referência','reference_date',isoDate(),'date','required')}<label>Como aplicar<select name="allocation_mode" id="cj1410-allocation-mode"><option value="per_driver">O valor informado será descontado de cada cooperado</option><option value="divide_total">O valor informado é o total e será dividido entre os selecionados</option></select></label>${field('Valor (R$)','amount','','number','required step="0.01" min="0.01"')}${textarea('Descrição','description','','required')}<div class="full cj1410-driver-picker"><label class="cj1410-select-all"><input id="cj1410-all-drivers" type="checkbox"> Selecionar todos os cooperados ativos</label><div class="cj1410-driver-grid">${drivers.map(x=>`<label><input type="checkbox" name="driver_pick" value="${x.id}"><span>${esc(x.name)}</span></label>`).join('')}</div></div><div id="cj1410-allocation-preview" class="full notice">Selecione os cooperados para visualizar a distribuição.</div>${buttons('Aplicar desconto')}</form>`);
    const form=$('#cj1410-allocation'),checks=()=>[...form.querySelectorAll('[name=driver_pick]:checked')],update=()=>{const count=checks().length,amount=Number(form.elements.amount.value||0),mode=form.elements.allocation_mode.value,total=mode==='per_driver'?amount*count:amount,each=mode==='divide_total'&&count?amount/count:amount;$('#cj1410-allocation-preview').innerHTML=count?`<strong>${count} cooperado(s)</strong><br>${mode==='per_driver'?`${money(Math.round(amount*100))} para cada um • total ${money(Math.round(total*100))}`:`Total ${money(Math.round(total*100))} • aproximadamente ${money(Math.round(each*100))} para cada um`}`:'Selecione os cooperados para visualizar a distribuição.'};
    $('#cj1410-all-drivers').onchange=e=>{form.querySelectorAll('[name=driver_pick]').forEach(x=>x.checked=e.target.checked);update()};form.elements.amount.oninput=update;form.elements.allocation_mode.onchange=update;form.querySelectorAll('[name=driver_pick]').forEach(x=>x.onchange=()=>{const all=[...form.querySelectorAll('[name=driver_pick]')];$('#cj1410-all-drivers').checked=all.length>0&&all.every(y=>y.checked);update()});
    form.onsubmit=async e=>{e.preventDefault();const body=formObject(form),ids=checks().map(x=>x.value);if(!ids.length){toast('Selecione pelo menos um cooperado.','error');return}body.driver_ids=ids;body.all_drivers=$('#cj1410-all-drivers').checked;try{loading(true);const result=await api('/api/app/tenant/deductions/apply',{method:'POST',body});closeModal();toast(`${result.selected_count} cooperado(s) receberam o desconto. Total: ${money(result.total_cents)}.`);pages.deductions()}catch(error){toast(error.message,'error')}finally{loading(false)}};
  }

  pages.deductions=async function(){
    if(state.user?.role!=='cooperative_admin')return oldDeductions();
    const month=state.cache.dedMonth||isoDate().slice(0,7),[d,base]=await Promise.all([api(`/api/app/tenant/deductions?month=${month}`),lgBase()]);
    const configured=table([{label:'Nome',key:'name'},{label:'Tipo',render:r=>({percentage:'Percentual',fixed_weekly:'Valor semanal',fixed_monthly:'Valor mensal'}[r.calculation_type])},{label:'Padrão',render:r=>r.calculation_type==='percentage'?`${r.default_value}%`:money(Number(r.default_value||0)*100)},{label:`Valor em ${month}`,render:r=>r.month_value==null?'Usa o padrão':(r.calculation_type==='percentage'?`${r.month_value}%`:money(Number(r.month_value)*100))},{label:'Status',render:r=>badge(r.active?'active':'inactive')}],d.items,r=>`<button class="table-action" data-edit-ded="${r.id}">Editar</button><button class="table-action" data-month-ded="${r.id}">Valor do mês</button>`);
    $('#page-content').innerHTML=panel('Aplicar imposto ou rateio',`<div class="cj1410-deduction-choice"><div><strong>Duas formas de distribuir</strong><span>1. Valor por cooperado: R$ 100,00 para cada selecionado.<br>2. Valor total dividido: R$ 100,00 dividido igualmente entre os selecionados.</span></div><button class="btn primary" id="cj1410-apply-deduction">Selecionar cooperados e aplicar</button></div>`)+panel('Configurações automáticas do fechamento',`<div class="notice">As configurações abaixo continuam disponíveis para cálculos automáticos semanais, mensais ou percentuais.</div>${configured}<div class="toolbar"><input id="ded-month" type="month" value="${month}"><button class="btn" id="new-ded">Nova configuração automática</button></div>`);
    $('#cj1410-apply-deduction').onclick=()=>allocationModal(base);$('#ded-month').onchange=e=>{state.cache.dedMonth=e.target.value;pages.deductions()};$('#new-ded').onclick=()=>deductionForm();$$('[data-edit-ded]').forEach(b=>b.onclick=()=>deductionForm(d.items.find(x=>x.id===b.dataset.editDed)));$$('[data-month-ded]').forEach(b=>b.onclick=()=>deductionMonthForm(d.items.find(x=>x.id===b.dataset.monthDed),month));
  };
})();

/* ===== ChegaJá 14.11.0 — adiantamentos, histórico de trocas e horário de Brasília ===== */
(function(){
  'use strict';
  const TZ='America/Sao_Paulo';
  const sqlUtc=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
  const wallClock=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;
  const formatParts=(date,withTime=false)=>new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',...(withTime?{hour:'2-digit',minute:'2-digit',hour12:false}:{})}).format(date);
  const parseAppDate=value=>{const text=String(value||'').trim();if(!text)return null;if(sqlUtc.test(text))return new Date(text.replace(' ','T')+'Z');const match=text.match(wallClock);if(match)return {wall:true,text:`${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`};const date=new Date(text);return Number.isNaN(date.getTime())?null:date};
  dateTime=function(value){if(!value)return '—';const parsed=parseAppDate(value);if(!parsed)return esc(value);if(parsed.wall)return parsed.text;return formatParts(parsed,true)};
  timeOnly=function(value){if(!value)return '—';const text=String(value).trim();if(sqlUtc.test(text)){const parsed=new Date(text.replace(' ','T')+'Z');return new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false}).format(parsed)}return text.slice(11,16)||text};
  dateOnly=function(value){if(!value)return '—';const text=String(value).trim();if(/^\d{4}-\d{2}-\d{2}$/.test(text)){const [y,m,d]=text.split('-');return `${d}/${m}/${y}`}const parsed=parseAppDate(value);if(!parsed)return esc(value);if(parsed.wall)return parsed.text.slice(0,10);return formatParts(parsed,false)};
  isoDate=function(date=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),map=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${map.year}-${map.month}-${map.day}`};

  Object.assign(statusText,{pending:'Pendente',approved:'Aprovado',rejected:'Recusado'});
  pageMeta.scheduleSwaps=['Trocas de escala','⇄'];
  if(typeof v8PageModule!=='undefined')v8PageModule.scheduleSwaps='schedules';
  for(const role of ['cooperative_admin','dispatcher']){
    const group=navByRole[role]?.find(item=>item[0]==='Operação');
    if(group&&!group[1].includes('scheduleSwaps')){const index=group[1].indexOf('schedules');group[1].splice(index>=0?index+1:group[1].length,0,'scheduleSwaps')}
  }
  const ensureAdvanceLinks=()=>{
    const group=navByRole.driver?.find(item=>item[0]==='Meu aplicativo');if(group&&!group[1].includes('advances'))group[1].push('advances');
    const aside=document.querySelector('#cj143-driver-drawer aside');if(aside&&!aside.querySelector('[data-go="advances"]')){const button=document.createElement('button');button.dataset.go='advances';button.innerHTML='↗ Solicitar adiantamento';const financial=aside.querySelector('[data-go="financial"]');financial?.after(button);button.onclick=()=>{document.getElementById('cj143-driver-drawer')?.classList.remove('open');navigate('advances')}}
  };
  new MutationObserver(ensureAdvanceLinks).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('load',ensureAdvanceLinks);

  pages.advances=async function(){
    const data=await api('/api/app/advances');
    if(state.user.role==='driver'){
      const max=Math.max(0,Number(data.available_cents||0));
      const breakdown=`<div class="cj1411-advance-breakdown"><div><small>Produção disponível para fechamento</small><strong>${money(data.gross_cents)}</strong></div><div><small>INSS</small><strong>− ${money(data.inss_cents)}</strong></div><div><small>SEST/SENAT</small><strong>− ${money(data.sest_senat_cents)}</strong></div><div><small>Adiantamentos aprovados</small><strong>− ${money(data.advances_cents)}</strong></div><div><small>Impostos e rateios</small><strong>− ${money(Number(data.rateios_cents||0)+Number(data.other_deductions_cents||0))}</strong></div><div><small>Pedidos aguardando análise</small><strong>− ${money(data.pending_requests_cents)}</strong></div></div>`;
      $('#page-content').innerHTML=cards([{icon:'↗',value:money(max),label:'Máximo disponível para adiantar'},{icon:'▦',value:`${dateOnly(data.week_start)} a ${dateOnly(data.week_end)}`,label:'Semana considerada'}])+panel('Solicitar adiantamento',`<div class="notice"><strong>Regra:</strong> você só pode solicitar o saldo que realmente tem a receber depois de INSS, SEST/SENAT, adiantamentos anteriores, impostos e rateios.</div>${breakdown}<form id="cj1411-advance-request" class="form-grid">${field('Valor solicitado','amount','','number',`step="0.01" min="0.01" max="${(max/100).toFixed(2)}" required`)}${textarea('Observação','notes')}${buttons('Solicitar adiantamento')}</form>`)+panel('Meus pedidos',table([{label:'Data',render:r=>dateTime(r.created_at)},{label:'Solicitado',render:r=>money(r.requested_cents)},{label:'Aprovado',render:r=>money(r.approved_cents)},{label:'Disponível quando pediu',render:r=>money(r.available_at_request_cents)},{label:'Status',render:r=>badge(r.status)},{label:'Resposta da cooperativa',render:r=>esc(r.admin_notes||'—'),wrap:true}],data.items||[]));
      const form=$('#cj1411-advance-request');if(max<=0){form.querySelector('button').disabled=true;form.insertAdjacentHTML('afterbegin','<div class="full notice warning">No momento não há saldo líquido disponível para adiantamento.</div>')}
      form.onsubmit=async event=>{event.preventDefault();try{loading(true);await api('/api/app/advances',{method:'POST',body:formObject(form)});toast('Pedido de adiantamento enviado para a cooperativa.');pages.advances()}catch(error){toast(error.message,'error')}finally{loading(false)}};return;
    }
    $('#page-content').innerHTML=panel('Solicitações de adiantamento',table([{label:'Cooperado',key:'driver_name'},{label:'Solicitado em',render:r=>dateTime(r.created_at)},{label:'Valor solicitado',render:r=>money(r.requested_cents)},{label:'Saldo líquido no pedido',render:r=>money(r.available_at_request_cents)},{label:'Valor aprovado',render:r=>money(r.approved_cents)},{label:'Status',render:r=>badge(r.status)},{label:'Observação',render:r=>esc(r.driver_notes||'—'),wrap:true}],data.items||[],r=>r.status==='pending'?`<button class="table-action primary" data-cj1411-review="${r.id}">Analisar</button>`:''));
    $$('[data-cj1411-review]').forEach(button=>button.onclick=()=>{const item=(data.items||[]).find(x=>x.id===button.dataset.cj1411Review);openModal('Analisar adiantamento',`<form id="cj1411-review-form" class="form-grid"><div class="full notice">O cooperado tinha <strong>${money(item.available_at_request_cents)}</strong> líquido disponível quando fez o pedido.</div>${selectField('Decisão','decision',[{id:'approved',name:'Aprovar'},{id:'rejected',name:'Recusar'}],'approved','Selecione','required')}${field('Valor aprovado','approved_value',(Number(item.requested_cents||0)/100).toFixed(2),'number',`step="0.01" min="0" max="${(Number(item.available_at_request_cents||0)/100).toFixed(2)}"`)}${textarea('Resposta ao cooperado','notes')}${buttons('Concluir análise')}</form>`);$('#cj1411-review-form').onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/advances/${item.id}/review`,{method:'POST',body:formObject(event.currentTarget)});closeModal();toast('Solicitação analisada.');pages.advances()}catch(error){toast(error.message,'error')}finally{loading(false)}}})
  };

  pages.scheduleSwaps=async function(){
    const today=isoDate(),from=state.cache.cj1411SwapFrom||addDays(today,-30),to=state.cache.cj1411SwapTo||today,status=state.cache.cj1411SwapStatus||'';
    const data=await api(`/api/app/schedule-swaps${query({from,to,status})}`),items=data.items||[];
    const rows=table([{label:'Solicitada em',render:r=>dateTime(r.created_at)},{label:'Cooperado 1',key:'requester_name'},{label:'Estava escalado em',render:r=>`<strong>${esc(r.source_local)}</strong><br><small>${dateTime(r.source_start)} às ${timeOnly(r.source_end)}</small>`},{label:'Trocou com',key:'target_name'},{label:'O outro estava em',render:r=>`<strong>${esc(r.target_local)}</strong><br><small>${dateTime(r.target_start)} às ${timeOnly(r.target_end)}</small>`},{label:'Resultado após aceitar',render:r=>r.status==='accepted'?`<div class="cj1411-swap-result"><span><b>${esc(r.requester_name)}</b> → ${esc(r.target_local)}</span><span><b>${esc(r.target_name)}</b> → ${esc(r.source_local)}</span></div>`:'—',wrap:true},{label:'Status',render:r=>`<span class="badge ${esc(r.status)}">${esc(({pending:'Pendente',accepted:'Realizada',rejected:'Recusada',cancelled:'Cancelada'})[r.status]||r.status||'—')}</span>`},{label:'Observação',render:r=>esc(r.message||'—'),wrap:true}],items);
    $('#page-content').innerHTML=cards([{icon:'⇄',value:items.length,label:'Trocas no filtro'},{icon:'✓',value:items.filter(x=>x.status==='accepted').length,label:'Realizadas'},{icon:'◷',value:items.filter(x=>x.status==='pending').length,label:'Pendentes'}])+panel('Histórico de trocas de escala',`<div class="toolbar cj1411-swap-filters"><label>De<input id="cj1411-swap-from" type="date" value="${from}"></label><label>Até<input id="cj1411-swap-to" type="date" value="${to}"></label><label>Status<select id="cj1411-swap-status"><option value="">Todos</option><option value="pending" ${status==='pending'?'selected':''}>Pendente</option><option value="accepted" ${status==='accepted'?'selected':''}>Realizada</option><option value="rejected" ${status==='rejected'?'selected':''}>Recusada</option><option value="cancelled" ${status==='cancelled'?'selected':''}>Cancelada</option></select></label><button class="btn primary" id="cj1411-swap-apply">Filtrar</button><button class="btn" id="cj1411-swap-export">Exportar Excel</button></div>${rows}`);
    $('#cj1411-swap-apply').onclick=()=>{state.cache.cj1411SwapFrom=$('#cj1411-swap-from').value;state.cache.cj1411SwapTo=$('#cj1411-swap-to').value;state.cache.cj1411SwapStatus=$('#cj1411-swap-status').value;pages.scheduleSwaps()};
    $('#cj1411-swap-export').onclick=()=>xlsx(`trocas-de-escala-${from}-a-${to}.xlsx`,[['Solicitada em','Cooperado 1','Local anterior 1','Horário 1','Cooperado 2','Local anterior 2','Horário 2','Novo local cooperado 1','Novo local cooperado 2','Status','Observação'],...items.map(r=>[dateTime(r.created_at),r.requester_name,r.source_local,`${dateTime(r.source_start)} às ${timeOnly(r.source_end)}`,r.target_name,r.target_local,`${dateTime(r.target_start)} às ${timeOnly(r.target_end)}`,r.status==='accepted'?r.target_local:'',r.status==='accepted'?r.source_local:'',r.status,r.message||''])]);
  };
})();

/* ===== ChegaJá 14.13.0 — financeiro do cooperado: a receber x já recebido ===== */
(function(){
  const previousFinancial1412=pages.financial;
  pages.financial=async function(){
    if(state.user?.role!=='driver')return previousFinancial1412();
    const from=state.cache.finFrom||mondayOf(isoDate()),to=state.cache.finTo||addDays(from,6);
    const data=await api(`/api/app/driver/finance${query({from,to})}`),summary=data.summary||{},items=data.items||[];
    const balance=Number(summary.net_cents||0),balanceTitle=balance<0?'SALDO PENDENTE':'VALOR A RECEBER';
    const description=value=>String(value||'').replace(/\s*[•·]\s*lote\s+[a-z0-9-]+/gi,'').trim();
    const typeLabel=item=>item.financial_class==='production_received'?'Produção já recebida':item.financial_class==='production_receivable'?'Produção para fechamento':item.entry_type==='credit'?'Crédito':'Desconto';
    const statusLabel=item=>item.financial_class==='production_received'?'Recebido':item.status==='paid'?'Pago':item.status==='open'?'Em aberto':item.status||'—';
    $('#page-content').innerHTML=`<section class="driver-wallet-card ${balance<0?'negative':''}"><small>${balanceTitle}</small><strong>${money(balance)}</strong><span>${dateOnly(from)} até ${dateOnly(to)}</span></section>
      <div class="driver-finance-strip"><div><small>Produção para fechamento</small><strong>${money(summary.production_receivable_cents||0)}</strong></div><div><small>Produção já recebida</small><strong>${money(summary.direct_received_cents||0)}</strong></div><div><small>Descontos lançados</small><strong>${money(summary.debits_cents||0)}</strong></div><div><small>${balance<0?'Saldo pendente':'A receber'}</small><strong>${money(balance)}</strong></div></div>
      <section class="driver-finance-list"><header><div><h2>Movimentações</h2><small>Somente PIX comum e dinheiro da Base já foram recebidos diretamente pelo cooperado e não formam saldo para descontos. Cartões e vales são apenas formas de cobrança do produto/refeição no estabelecimento.</small></div><div><input id="v6-fin-from" type="date" value="${from}"><input id="v6-fin-to" type="date" value="${to}"><button id="v6-fin-filter" class="btn small">Filtrar</button></div></header>
      ${items.map(item=>`<article><div><strong>${esc(description(item.description))}</strong><small>${dateOnly(item.reference_date)} • ${esc(typeLabel(item))} • ${esc(item.category||'')}</small><em>${esc(statusLabel(item))}${item.entry_type==='debit'&&item.status==='open'&&Number(item.settled_cents||0)>0?` • restante ${money(item.remaining_cents)}`:''}</em></div><b class="${item.entry_type==='credit'?'positive':'negative'}">${item.entry_type==='credit'?'+':'-'} ${money(item.amount_cents)}</b></article>`).join('')||empty('Nenhuma movimentação no período')}</section>`;
    $('#v6-fin-filter').onclick=()=>{state.cache.finFrom=$('#v6-fin-from').value;state.cache.finTo=$('#v6-fin-to').value;pages.financial()};
  };
})();

/* ===== ChegaJá 14.13.0 — fechamento único, garantido por turno e endereços em todo o RN ===== */
(function(){
  const dayGuarantees=[
    ['guarantee_sun','Domingo'],['guarantee_mon','Segunda-feira'],['guarantee_tue','Terça-feira'],
    ['guarantee_wed','Quarta-feira'],['guarantee_thu','Quinta-feira'],['guarantee_fri','Sexta-feira'],['guarantee_sat','Sábado']
  ];

  // O endereço livre não fica preso a Natal. A cidade digitada ou escolhida no resultado passa a valer.
  document.addEventListener('focusin',event=>{
    const input=event.target.closest?.('[data-address-autocomplete]');
    if(input&&input.placeholder?.includes('Natal'))input.placeholder='Digite rua, bairro, cidade ou estabelecimento no RN';
  });

  // Acrescenta o garantido diário ao cadastro já existente sem duplicar a janela.
  const establishmentFormBefore1413=establishmentForm;
  establishmentForm=function(item={}){
    establishmentFormBefore1413(item);
    const form=$('#est-form-v7')||$('#est-form');
    if(!form||form.querySelector('[data-guarantees-1413]'))return;
    const actions=form.querySelector('.form-actions');
    const block=document.createElement('section');
    block.className='full cj1413-guarantees';block.dataset.guarantees1413='1';
    block.innerHTML=`<header><div><strong>Garantido mínimo por dia</strong><small>Se as corridas do turno não atingirem o valor, o sistema lança somente a diferença como “Complemento de garantido”.</small></div></header><div>${dayGuarantees.map(([name,label])=>`<label><span>${label}</span><input type="number" name="${name}" step="0.01" min="0" value="${(Number(item[`${name}_cents`]||0)/100).toFixed(2)}"></label>`).join('')}</div>`;
    form.insertBefore(block,actions||null);
  };

  pageMeta.closings=['Fechamento semanal','✓'];
  pageMeta.turnClosings=['Fechamento de turnos','◷'];
  if(typeof v8PageModule!=='undefined')v8PageModule.turnClosings='schedules';

  const ensurePage=(role,groupName,page)=>{
    const groups=navByRole[role]||[];let group=groups.find(x=>x[0]===groupName);
    if(!group){group=[groupName,[]];groups.push(group)}
    if(!group[1].includes(page))group[1].push(page);
  };
  if(navByRole.cooperative_admin){
    navByRole.cooperative_admin.forEach(group=>group[1]=group[1].filter(page=>!['financial','deductions'].includes(page)));
    ensurePage('cooperative_admin','Financeiro','closings');ensurePage('cooperative_admin','Operação','turnClosings');
  }
  if(navByRole.establishment)ensurePage('establishment','Meu estabelecimento','turnClosings');

  const navigateBefore1413=navigate;
  navigate=async function(page,push=true){
    if(['cooperative_admin','dispatcher'].includes(state.user?.role)&&['financial','deductions'].includes(page))page='closings';
    return navigateBefore1413(page,push);
  };

  const cleanDescription=value=>String(value||'').replace(/\s*[•·]\s*lote\s+[a-z0-9-]+/gi,'').trim();
  const xlsx=(name,rows)=>window.ChegaJa143?.downloadXlsx?.(name,rows);
  const statusText1413=item=>item.pending_cents>0?(item.applied_cents>0?'Será pago parcialmente ao fechar':'Continuará em aberto'):'Será pago ao fechar';

  function manualFinancialEntry(base,week){
    const drivers=base.drivers||[],locations=[...(base.establishments||[]).map(x=>({id:`est:${x.id}`,name:`Estabelecimento — ${x.name}`})),...(base.bases||[]).map(x=>({id:`base:${x.id}`,name:`Base — ${x.name}`}))];
    openModal('Novo ganho ou desconto',`<form id="cj1413-manual-entry" class="form-grid">
      ${selectField('Tipo','entry_type',[{id:'credit',name:'Novo ganho'},{id:'debit',name:'Desconto, imposto ou rateio'}],'credit','Selecione','required')}
      ${field('Valor (R$)','amount','','number','step="0.01" min="0.01" required')}
      ${selectField('Distribuição','allocation_mode',[{id:'per_driver',name:'Este valor para cada cooperado selecionado'},{id:'divide_total',name:'Dividir este valor total entre os selecionados'}],'per_driver','Selecione','required')}
      ${selectField('Cliente / local','location_key',locations,'','Geral / sem local')}
      ${field('Data de referência','reference_date',week,'date','required')}
      ${field('Descrição (opcional)','description','','text','placeholder="Ex.: rateio administrativo"')}
      <label class="full">Categoria<select name="category"><option value="manual_gain">Ganho manual</option><option value="rateio">Rateio</option><option value="imposto">Imposto</option><option value="other_expense">Outro desconto</option></select></label>
      <div class="full cj1413-tax-options"><label class="checkbox-row"><input type="checkbox" name="apply_inss"> Aplicar INSS ao novo ganho</label><label class="checkbox-row"><input type="checkbox" name="apply_sest_senat"> Aplicar SEST/SENAT ao novo ganho</label></div>
      <div class="full cj1413-driver-selection"><header><strong>Cooperados</strong><button type="button" class="btn small" id="cj1413-all-drivers">Marcar todos</button></header><div>${drivers.map(x=>`<label><input type="checkbox" name="driver_ids[]" value="${esc(x.id)}"> ${esc(x.name)}</label>`).join('')}</div></div>
      ${buttons('Lançar no fechamento')}
    </form>`);
    const form=$('#cj1413-manual-entry'),update=()=>form.querySelector('.cj1413-tax-options').classList.toggle('hidden',form.elements.entry_type.value!=='credit');update();form.elements.entry_type.onchange=update;
    $('#cj1413-all-drivers').onclick=()=>{const boxes=$$('input[name="driver_ids[]"]',form),all=boxes.every(x=>x.checked);boxes.forEach(x=>x.checked=!all)};
    form.onsubmit=async event=>{event.preventDefault();const body=formObject(form);if(!body.driver_ids?.length)return toast('Selecione pelo menos um cooperado.','error');try{loading(true);await api('/api/app/tenant/weekly-close/manual-entry',{method:'POST',body});closeModal();toast('Lançamento incluído no fechamento semanal.');pages.closings()}catch(error){toast(error.message,'error')}finally{loading(false)}};
  }

  pages.closings=async function(){
    const week=state.cache.closeWeek||mondayOf(isoDate()),driverId=state.cache.closeDriver||'',locationKey=state.cache.closeLocation||'';
    const base=await lgBase();
    const closingLocations=[...(base.establishments||[]).map(x=>({id:`est:${x.id}`,name:`Estabelecimento — ${x.name}`})),...(base.bases||[]).map(x=>({id:`base:${x.id}`,name:`Base — ${x.name}`}))];
    await api('/api/app/financial/reconcile',{method:'POST',body:{driver_id:driverId}}).catch(()=>{});
    const [summary,preview,history,deductions]=await Promise.all([
      api(`/api/app/v7/weekly-summary${query({week_start:week,driver_id:driverId,location_key:locationKey})}`),
      api('/api/app/tenant/weekly-close/preview',{method:'POST',body:{week_start:week}}),
      api('/api/app/tenant/weekly-closes'),
      api(`/api/app/tenant/deductions?month=${week.slice(0,7)}`)
    ]);
    const previewMap=new Map((preview.items||[]).map(x=>[String(x.id),x]));
    const filteredDrivers=(summary.drivers||[]).map(driver=>({...driver,closing:previewMap.get(String(driver.id))||{deduction_details:[],payable_cents:0,pending_deductions_cents:0}}));
    const totals={
      production:filteredDrivers.reduce((n,x)=>n+Number(x.production_cents||0),0),
      received:filteredDrivers.reduce((n,x)=>n+Number(x.direct_received_cents||0),0),
      discounts:filteredDrivers.reduce((n,x)=>n+(locationKey?Number(x.discounts_cents||0):(Number(x.closing?.deductions_cents||0)+Number(x.closing?.advances_cents||0))),0),
      balance:filteredDrivers.reduce((n,x)=>n+(locationKey?Number(x.net_cents||0):Number(x.closing?.net_cents||0)),0)
    };
    const filters=`<div class="toolbar"><input id="close-week" type="date" value="${week}">${selectField('','close-driver',base.drivers||[],driverId,'Todos os cooperados')}${selectField('','close-location',closingLocations,locationKey,'Todos os estabelecimentos e Bases')}<button class="btn" id="close-filter">Filtrar</button><button class="btn" id="cj1413-new-entry">Novo ganho/desconto</button><button class="btn" id="cj1413-export-close">Exportar Excel</button><button class="btn primary" id="confirm-close">Fechar semana</button></div>`;
    const driverRows=filteredDrivers.map(driver=>{
      const close=driver.closing||{},allDetails=close.deduction_details||[];
      const visibleEntryIds=new Set((driver.days||[]).flatMap(day=>(day.discounts||[]).map(item=>String(item.id))));
      const details=locationKey?allDetails.filter(item=>item.entry_id&&visibleEntryIds.has(String(item.entry_id))):allDetails;
      const detailByEntry=new Map(allDetails.filter(x=>x.entry_id).map(x=>[String(x.entry_id),x]));
      const displayDiscounts=locationKey?Number(driver.discounts_cents||0):Number(close.deductions_cents||0)+Number(close.advances_cents||0);
      const displayBalance=locationKey?Number(driver.net_cents||0):Number(close.net_cents||0);
      const gainRows=day=>(day.gains||[]).map(item=>`<div class="cj1413-gain-line"><span>${esc(cleanDescription(item.description)||item.category||'Ganho')}</span><small>${esc(item.category||'')} • ${item.status==='paid'?'Pago':'Para fechamento'}</small><strong>+ ${money(item.amount_cents)}</strong></div>`).join('');
      const discountRows=day=>(day.discounts||[]).map(item=>{const detail=detailByEntry.get(String(item.id));const stateText=detail?(detail.pending_cents>0?(detail.applied_cents>0?'Será pago parcialmente ao fechar':'Continuará em aberto'):'Será pago ao fechar'):(item.status==='paid'?'Pago':'Em aberto');return `<div class="cj1413-discount-line"><span>${esc(cleanDescription(item.description)||item.category||'Desconto')}</span><small>${esc(item.category||'')} • ${stateText}</small><strong>− ${money(item.amount_cents)}</strong></div>`}).join('');
      return `<article class="closing-driver-card"><header><div><strong>${esc(driver.name)}</strong><small>${driver.deliveries_count} corridas</small></div><div><span>Para fechamento <b>${money(driver.production_cents)}</b></span><span>Já recebida <b>${money(driver.direct_received_cents)}</b></span><span>Descontos <b>${money(displayDiscounts)}</b></span><span>${displayBalance<0?'Saldo pendente':'A receber'} <b>${money(displayBalance)}</b></span></div></header>
      <div class="closing-days">${driver.days.map(day=>`<section><button type="button" class="closing-day-toggle" data-close-day="${driver.id}:${day.date}"><span>＋</span><strong>${dateOnly(day.date)}</strong><em>${day.deliveries.length} corridas • ${(day.gains||[]).length} outros ganhos • ${(day.discounts||[]).length} descontos</em><b>${money(day.production_cents)} − ${money(day.discounts_cents)} = ${money(day.net_cents)}</b><small>Produção já recebida: ${money(day.direct_received_cents)}</small></button><div class="closing-day-detail hidden" id="close-${driver.id}-${day.date}">
        ${day.deliveries.map(delivery=>`<div><span>${esc(delivery.display_code)} • ${esc(delivery.establishment_name||delivery.base_name||'')}</span><small>${esc(delivery.delivery_address)} • ${delivery.financial_class==='production_received'?'produção já recebida':'produção para fechamento'}</small><strong>+ ${money(delivery.driver_gross_cents)}</strong></div>`).join('')}
        ${gainRows(day)}
        ${discountRows(day)}
        ${!day.deliveries.length&&!(day.gains||[]).length&&!(day.discounts||[]).length?'<p class="muted">Sem movimentações.</p>':''}</div></section>`).join('')}</div>
      <div class="cj1413-deduction-order"><strong>Ordem e situação dos descontos</strong>${details.map(item=>`<div><span>${esc(cleanDescription(item.description))}</span><small>${statusText1413(item)}</small><b>${money(item.amount_cents)}${item.pending_cents?` • resta ${money(item.pending_cents)}`:''}</b></div>`).join('')||'<small>Nenhum desconto nesta semana.</small>'}</div></article>`;
    }).join('')||empty('Nenhuma movimentação nesta semana');
    const configured=table([{label:'Imposto/rateio',key:'name'},{label:'Tipo',render:x=>({percentage:'Percentual',fixed_weekly:'Semanal',fixed_monthly:'Mensal'}[x.calculation_type]||x.calculation_type)},{label:'Valor padrão',render:x=>x.calculation_type==='percentage'?`${x.default_value}%`:money(Number(x.default_value||0)*100)},{label:'Status',render:x=>badge(x.active?'active':'inactive')}],deductions.items||[],x=>`<button class="table-action" data-cj1413-edit-ded="${x.id}">Editar</button><button class="table-action" data-cj1413-month-ded="${x.id}">Valor do mês</button>`);
    $('#page-content').innerHTML=cards([{icon:'＋',value:money(totals.production),label:'Produção para fechamento'},{icon:'✓',value:money(totals.received),label:'Produção já recebida'},{icon:'％',value:money(totals.discounts),label:'Descontos'},{icon:'=',value:money(totals.balance),label:totals.balance<0?'Saldo pendente':'A receber'}])+
      panel(`Fechamento semanal: ${dateOnly(summary.week_start)} a ${dateOnly(summary.week_end)}`,`<div class="notice"><strong>Regras:</strong> estabelecimentos, PIX Cooperativa e crédito da Base formam saldo. Somente PIX comum e dinheiro da Base são produção já recebida. A ordem é INSS, SEST/SENAT, adiantamento, rateios/impostos e demais despesas.</div>${driverRows}`,filters)+
      panel('Impostos e rateios automáticos',configured,'<button class="btn primary" id="cj1413-new-ded">Novo imposto/rateio</button>')+
      panel('Fechamentos anteriores',table([{label:'Semana',render:x=>`${dateOnly(x.week_start)} a ${dateOnly(x.week_end)}`},{label:'Produção',render:x=>money(x.total_gross_cents)},{label:'Descontos',render:x=>money(Number(x.total_deductions_cents||0)+Number(x.total_advances_cents||0))},{label:'Saldo',render:x=>money(x.total_net_cents)},{label:'Status',render:x=>badge(x.status)}],history.items||[]));
    $$('[data-close-day]').forEach(button=>button.onclick=()=>{const box=$(`#close-${button.dataset.closeDay.replace(':','-')}`);box?.classList.toggle('hidden');button.querySelector('span').textContent=box?.classList.contains('hidden')?'＋':'−'});
    $('#close-filter').onclick=()=>{state.cache.closeWeek=mondayOf($('#close-week').value);state.cache.closeDriver=$('#close-driver').value;state.cache.closeLocation=$('#close-location').value;pages.closings()};
    $('#cj1413-new-entry').onclick=()=>manualFinancialEntry(base,summary.week_start);
    $('#cj1413-new-ded').onclick=()=>deductionForm();
    $$('[data-cj1413-edit-ded]').forEach(button=>button.onclick=()=>deductionForm((deductions.items||[]).find(x=>x.id===button.dataset.cj1413EditDed)));
    $$('[data-cj1413-month-ded]').forEach(button=>button.onclick=()=>deductionMonthForm((deductions.items||[]).find(x=>x.id===button.dataset.cj1413MonthDed),week.slice(0,7)));
    $('#cj1413-export-close').onclick=()=>xlsx(`fechamento-semanal-${summary.week_start}-a-${summary.week_end}.xlsx`,[['Cooperado','Data','Tipo','Local/descrição','Valor (R$)','Status'],...filteredDrivers.flatMap(driver=>driver.days.flatMap(day=>[...day.deliveries.map(x=>[driver.name,day.date,x.financial_class==='production_received'?'Produção já recebida':'Produção para fechamento',x.establishment_name||x.base_name||x.display_code,Number(x.driver_gross_cents||0)/100,'']),...(day.gains||[]).map(x=>[driver.name,day.date,'Outro ganho',cleanDescription(x.description)||x.category,Number(x.amount_cents||0)/100,x.status]),...(day.discounts||[]).map(x=>[driver.name,day.date,'Desconto',cleanDescription(x.description)||x.category,-Number(x.amount_cents||0)/100,x.status])])),[],['TOTAL PARA FECHAMENTO','','','',totals.production/100],['TOTAL JÁ RECEBIDA','','','',totals.received/100],['TOTAL DESCONTOS','','','',-totals.discounts/100],['SALDO','','','',totals.balance/100]]);
    $('#confirm-close').onclick=async()=>{if(!confirm(`Fechar oficialmente a semana de ${dateOnly(summary.week_start)} a ${dateOnly(summary.week_end)}?`))return;try{loading(true);await api('/api/app/tenant/weekly-close',{method:'POST',body:{week_start:summary.week_start}});toast('Semana fechada. Créditos e descontos pagos foram baixados; somente o restante passou para a próxima semana.');pages.closings()}catch(error){toast(error.message,'error')}finally{loading(false)}};
  };
  pages.deductions=pages.closings;

  pages.turnClosings=async function(){
    const today=isoDate(),from=state.cache.turnFrom||today,to=state.cache.turnTo||today;
    const base=state.user.role==='establishment'?{establishments:[]}:await lgBase(),establishmentId=state.user.role==='establishment'?'':state.cache.turnEst||'';
    const data=await api(`/api/app/establishment/turn-closings${query({from,to,establishment_id:establishmentId})}`),items=data.items||[];
    const actions=item=>`${['cooperative_admin','dispatcher','establishment'].includes(state.user.role)?`<button class="table-action" data-turn-adjust="${item.schedule_id}">Ajustar total</button>`:''}${state.user.role==='establishment'?`<button class="table-action primary" data-turn-rate="${item.schedule_id}">${item.rating_score?'Alterar avaliação':'Avaliar'}</button>`:''}`;
    $('#page-content').innerHTML=cards([{icon:'◷',value:items.length,label:'Turnos no período'},{icon:'＄',value:money(items.reduce((n,x)=>n+Number(x.eligible_delivery_cents||0),0)),label:'Soma das corridas'},{icon:'＋',value:money(items.reduce((n,x)=>n+Number(x.complement_cents||0),0)),label:'Complementos de garantido'}])+panel('Fechamento de turnos',table([{label:'Data/horário',render:x=>`${dateTime(x.start_at)} às ${timeOnly(x.end_at)}`},{label:'Estabelecimento',key:'establishment_name'},{label:'Cooperado',key:'driver_name'},{label:'Garantido',render:x=>money(x.guaranteed_cents)},{label:'Corridas/total declarado',render:x=>money(x.eligible_delivery_cents)},{label:'Complemento',render:x=>`<strong>${money(x.complement_cents)}</strong>`},{label:'Avaliação',render:x=>x.rating_score?`★ ${x.rating_score}`:'Opcional'}],items,actions),`<div class="toolbar"><input id="turn-from" type="date" value="${from}"><input id="turn-to" type="date" value="${to}">${state.user.role==='establishment'?'':selectField('','turn-est',base.establishments||[],establishmentId,'Todos os estabelecimentos')}<button class="btn primary" id="turn-filter">Filtrar</button></div>`);
    $('#turn-filter').onclick=()=>{state.cache.turnFrom=$('#turn-from').value;state.cache.turnTo=$('#turn-to').value;state.cache.turnEst=$('#turn-est')?.value||'';pages.turnClosings()};
    $$('[data-turn-adjust]').forEach(button=>button.onclick=()=>{const item=items.find(x=>x.schedule_id===button.dataset.turnAdjust);openModal('Ajustar total do turno',`<form id="turn-adjust-form" class="form-grid"><div class="full notice">Use apenas em exceções. As corridas entregues são vinculadas automaticamente pelo horário em que foram lançadas no estabelecimento. Ao recalcular, a diferença do garantido é lançada como ganho do cooperado no fechamento semanal.</div>${field('Total de corridas do turno (R$)','total_value',(Number(item.eligible_delivery_cents||0)/100).toFixed(2),'number','step="0.01" min="0" required')}${textarea('Observação','notes',item.adjustment_notes||'')}${buttons('Recalcular turno')}</form>`);$('#turn-adjust-form').onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/establishment/turn-closings/${item.schedule_id}/adjust`,{method:'POST',body:formObject(event.currentTarget)});closeModal();toast('Total do turno ajustado e garantido recalculado.');pages.turnClosings()}catch(error){toast(error.message,'error')}finally{loading(false)}}});
    $$('[data-turn-rate]').forEach(button=>button.onclick=()=>{const item=items.find(x=>x.schedule_id===button.dataset.turnRate);openModal('Avaliar cooperado no fim do turno',`<form id="turn-rate-form" class="form-grid">${selectField('Nota','score',[1,2,3,4,5].map(id=>({id,name:`${id} estrela${id>1?'s':''}`})),item.rating_score||5,'Selecione','required')}${textarea('Comentário (opcional)','comment',item.rating_comment||'')}${buttons('Salvar avaliação')}</form>`);$('#turn-rate-form').onsubmit=async event=>{event.preventDefault();try{loading(true);await api(`/api/app/establishment/turn-closings/${item.schedule_id}/rating`,{method:'POST',body:formObject(event.currentTarget)});closeModal();toast('Avaliação registrada.');pages.turnClosings()}catch(error){toast(error.message,'error')}finally{loading(false)}}});
  };

  // Texto correto na carteira do cooperado.
  const financialBefore1413=pages.financial;
  pages.financial=async function(){await financialBefore1413();if(state.user?.role==='driver'){const note=document.querySelector('.driver-finance-list header small');if(note)note.textContent='Somente PIX comum e dinheiro da Base são recebidos diretamente. Cartões e vales são formas de cobrança do pedido e não são ganho do cooperado.'}};
})();


/* ===== ChegaJá 14.15.0 — garantido vinculado ao horário ===== */
(function(){
  const establishmentFormBefore1414=establishmentForm;

  function shiftRow1414(item={}){
    const guaranteed=(Number(item.guaranteed_cents||0)/100).toFixed(2);
    return `<div class="cj1414-shift-row" data-shift-id="${esc(item.id||'')}">
      <label><span>Nome do horário</span><input data-shift-name type="text" maxlength="100" value="${esc(item.name||'')}" placeholder="Ex.: Almoço 11h às 15h"></label>
      <label><span>Turno</span><input data-shift-label type="text" maxlength="100" value="${esc(item.shift_label||'DIA')}" placeholder="DIA ou NOITE"></label>
      <label><span>Início</span><input data-shift-start type="time" value="${esc(item.start_time||'')}"></label>
      <label><span>Fim</span><input data-shift-end type="time" value="${esc(item.end_time||'')}"></label>
      <label><span>Garantido deste horário</span><input data-shift-guarantee type="number" step="0.01" min="0" value="${guaranteed}"></label>
      <button type="button" class="btn small danger" data-remove-shift>Remover</button>
    </div>`;
  }

  function bindEstablishmentShiftEditor(form,items=[]){
    const oldDaily=form.querySelector('[data-guarantees-1413]');
    oldDaily?.remove();
    const actions=form.querySelector('.form-actions');
    const section=document.createElement('section');
    section.className='full cj1414-shifts';
    section.innerHTML=`<header><div><strong>Horários e garantidos do estabelecimento</strong><small>O garantido pertence ao horário. O mesmo cooperado pode cumprir vários horários no mesmo estabelecimento e cada linha da escala terá seu próprio garantido.</small></div><button type="button" class="btn small primary" id="cj1414-add-shift">Adicionar horário</button></header>
      <div class="notice"><strong>Como funciona:</strong> ao selecionar este estabelecimento na escala, aparecerão somente os horários cadastrados aqui. Se as corridas de um turno não atingirem o garantido daquele horário, será lançado apenas o complemento.</div>
      <div id="cj1414-shift-list">${items.map(shiftRow1414).join('')}</div>
      <input type="hidden" name="shift_templates_json" id="cj1414-shifts-json">`;
    form.insertBefore(section,actions||null);
    const list=section.querySelector('#cj1414-shift-list');
    const sync=()=>{
      const rows=[...list.querySelectorAll('.cj1414-shift-row')].map(row=>({
        id:row.dataset.shiftId||'',
        name:row.querySelector('[data-shift-name]').value.trim(),
        shift_label:row.querySelector('[data-shift-label]').value.trim()||'DIA',
        start_time:row.querySelector('[data-shift-start]').value,
        end_time:row.querySelector('[data-shift-end]').value,
        guaranteed_value:row.querySelector('[data-shift-guarantee]').value||'0'
      })).filter(row=>row.name||row.start_time||row.end_time||Number(row.guaranteed_value)>0);
      section.querySelector('#cj1414-shifts-json').value=JSON.stringify(rows);
    };
    const bindRow=row=>{
      row.querySelector('[data-remove-shift]').onclick=()=>{row.remove();sync()};
      row.querySelectorAll('input').forEach(input=>input.addEventListener('input',sync));
    };
    list.querySelectorAll('.cj1414-shift-row').forEach(bindRow);
    section.querySelector('#cj1414-add-shift').onclick=()=>{
      list.insertAdjacentHTML('beforeend',shiftRow1414());
      bindRow(list.lastElementChild);
      list.lastElementChild.querySelector('[data-shift-name]').focus();
      sync();
    };
    sync();
  }

  establishmentForm=async function(item={}){
    let shifts=[];
    if(item.id){
      try{
        const data=await api('/api/app/shift-templates');
        shifts=(data.items||[]).filter(row=>row.establishment_id===item.id||row.contract_establishment_id===item.id);
      }catch(error){
        toast('Não foi possível carregar os horários e garantidos. Tente abrir o cadastro novamente.','error');
        return;
      }
    }
    establishmentFormBefore1414(item);
    const form=$('#est-form-v7')||$('#est-form');
    if(form)bindEstablishmentShiftEditor(form,shifts);
  };

  pages.establishments=async function(){
    const d=await api('/api/app/establishments');
    $('#page-content').innerHTML=panel('Estabelecimentos da cooperativa',table([
      {label:'Nome',key:'name'},{label:'Telefone',key:'phone'},
      {label:'Endereço confirmado',render:r=>`<span>${esc(r.address||'—')}</span>${r.address_confirmed?'<br><small class="ok-pill">Confirmado</small>':''}`,wrap:true},
      {label:'Horários/garantidos',render:r=>`<strong>${Number(r.shift_count||0)}</strong><br><small>horário${Number(r.shift_count||0)===1?'':'s'} cadastrado${Number(r.shift_count||0)===1?'':'s'}</small>`},
      {label:'Valor por km',render:r=>money(r.rate_per_km_cents||0)},
      {label:'Taxa mínima',render:r=>money(r.minimum_fee_cents||0)},
      {label:'Acesso',render:r=>r.access_email?`<strong>${esc(r.access_email)}</strong><br>${badge(r.access_status||'active')}`:'<span class="muted">Sem acesso</span>'},
      {label:'Status',render:r=>badge(r.active?'active':'inactive')}
    ],d.items,r=>canEdit()?`<button class="table-action" data-qr-est="${r.id}">QR</button><button class="table-action" data-access-est="${r.id}">Acesso</button><button class="table-action" data-edit-est="${r.id}">Editar</button><button class="table-action danger" data-del-est="${r.id}">Excluir</button>`:''),canEdit()?'<button class="btn primary" id="new-est">Novo estabelecimento</button>':'');
    $('#new-est')?.addEventListener('click',()=>establishmentForm());
    $$('[data-edit-est]').forEach(b=>b.onclick=()=>establishmentForm(d.items.find(x=>x.id===b.dataset.editEst)));
    $$('[data-access-est]').forEach(b=>b.onclick=()=>linkedAccessForm('establishment',d.items.find(x=>x.id===b.dataset.accessEst)));
    $$('[data-qr-est]').forEach(b=>b.onclick=()=>showEstablishmentQr(d.items.find(x=>x.id===b.dataset.qrEst)));
    $$('[data-del-est]').forEach(b=>b.onclick=()=>removeEntity(`/api/app/establishments/${b.dataset.delEst}`,'Excluir este estabelecimento?',pages.establishments));
  };

  pages.shifts=async function(){
    const [d,ests]=await Promise.all([api('/api/app/shift-templates'),api('/api/app/establishments')]);
    const items=d.items||[],establishments=ests.items||[];
    $('#page-content').innerHTML=panel('Horários e garantidos por estabelecimento',
      `<div class="notice"><strong>Um garantido para cada horário:</strong> ao criar um novo horário para o restaurante, informe o garantido daquele turno. O mesmo cooperado pode ter vários horários no mesmo estabelecimento e cada escala será calculada separadamente.</div>`+
      table([
        {label:'Estabelecimento',render:r=>esc(r.establishment_name||r.contract_name||'Geral')},
        {label:'Nome',key:'name'},{label:'Horário',render:r=>`<strong>${esc(r.start_time)} às ${esc(r.end_time)}</strong>`},
        {label:'Turno',key:'shift_label'},{label:'Garantido',render:r=>`<strong>${money(r.guaranteed_cents||0)}</strong>`},
        {label:'Status',render:r=>badge(r.active?'active':'inactive')}
      ],items,r=>`${v8Permission('shifts','edit')?`<button class="table-action" data-v14-shift-edit="${r.id}">Editar</button>`:''}${v8Permission('shifts','delete')?`<button class="table-action danger" data-v14-shift-del="${r.id}">Excluir</button>`:''}`),
      v8Permission('shifts','create')?'<button class="btn primary" id="v14-new-shift">Novo horário e garantido</button>':'');
    const open=(item={})=>{
      openModal(item.id?'Editar horário e garantido':'Novo horário e garantido',`<form id="v14-shift-form" class="form-grid">
        ${selectField('Estabelecimento','establishment_id',establishments,item.establishment_id||item.contract_establishment_id,'Selecione o estabelecimento','required')}
        ${field('Nome do horário','name',item.name,'text','required placeholder="Ex.: Almoço 11h às 15h"')}
        ${field('Turno','shift_label',item.shift_label||'DIA','text','required')}
        ${field('Hora inicial','start_time',item.start_time,'time','required')}
        ${field('Hora final','end_time',item.end_time,'time','required')}
        ${field('Garantido deste horário','guaranteed_value',(Number(item.guaranteed_cents||0)/100).toFixed(2),'number','step="0.01" min="0" required')}
        <div class="full notice">Este valor será copiado automaticamente para cada linha da escala que usar este horário. A Base não usa garantido.</div>
        ${buttons()}
      </form>`);
      $('#v14-shift-form').onsubmit=async e=>{e.preventDefault();try{loading(true);await api(`/api/app/shift-templates${item.id?`/${item.id}`:''}`,{method:item.id?'PUT':'POST',body:formObject(e.currentTarget)});closeModal();clearTenantCache();toast('Horário e garantido salvos.');pages.shifts()}catch(err){toast(err.message,'error')}finally{loading(false)}};
    };
    $('#v14-new-shift')?.addEventListener('click',()=>open());
    $$('[data-v14-shift-edit]').forEach(b=>b.onclick=()=>open(items.find(x=>x.id===b.dataset.v14ShiftEdit)));
    $$('[data-v14-shift-del]').forEach(b=>b.onclick=()=>removeEntity(`/api/app/shift-templates/${b.dataset.v14ShiftDel}`,'Excluir este horário e seu garantido?',pages.shifts));
  };

  v8ShiftOptions=function(base,establishmentId,selected){
    return `<option value="">Selecione um horário cadastrado</option>${(base.shifts||[]).filter(x=>!x.establishment_id&&!x.contract_establishment_id||x.establishment_id===establishmentId||x.contract_establishment_id===establishmentId).map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''} data-start="${x.start_time}" data-end="${x.end_time}" data-label="${esc(x.shift_label)}" data-guaranteed="${Number(x.guaranteed_cents||0)}">${esc(x.name)} • ${x.start_time}–${x.end_time} • garantido ${money(x.guaranteed_cents||0)}</option>`).join('')}`;
  };

  const turnClosingsBefore1414=pages.turnClosings;
  pages.turnClosings=async function(){
    await turnClosingsBefore1414();
    const heading=document.querySelector('.panel h2');
    if(heading&&heading.textContent?.includes('Fechamento de turnos')){
      const note=document.createElement('p');
      note.className='muted cj1414-turn-note';
      note.textContent='Cada linha corresponde a um horário da escala e possui seu próprio garantido, mesmo quando o cooperado cumpre mais de um turno no mesmo estabelecimento.';
      heading.parentElement?.appendChild(note);
    }
  };
})();
