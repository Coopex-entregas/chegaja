/* ChegaJá 14.15.9 — mapas no Master, atendente da Base e matrícula permanente */
(()=>{
  'use strict';
  const $id=id=>document.getElementById(id);
  const h=value=>typeof esc==='function'?esc(value):String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const today=()=>isoDate();

  let cj149MapConfigCache=null;
  let cj149GooglePromise=null;
  async function cj149MapConfig(force=false){
    if(!force&&cj149MapConfigCache)return cj149MapConfigCache;
    const response=await api('/api/auth/maps-config');
    cj149MapConfigCache=response.item||{provider:'openstreetmap',enabled:false};
    return cj149MapConfigCache;
  }
  async function cj149LoadGoogle(force=false){
    const config=await cj149MapConfig(force);
    if(config.provider!=='google')throw new Error('O Administrador Master selecionou OpenStreetMap.');
    if(!config.enabled||!config.api_key)throw new Error('A chave do navegador do Google Maps não está configurada.');
    if(window.google?.maps?.importLibrary){await Promise.all([google.maps.importLibrary('maps'),google.maps.importLibrary('marker')]);return config;}
    if(cj149GooglePromise)return cj149GooglePromise;
    cj149GooglePromise=new Promise((resolve,reject)=>{
      const callback=`__cj149GoogleReady${Date.now()}`;
      window[callback]=async()=>{try{delete window[callback];await Promise.all([google.maps.importLibrary('maps'),google.maps.importLibrary('marker')]);resolve(config)}catch(error){reject(error)}};
      const script=document.createElement('script');
      script.dataset.chegajaGoogleMaps='1';script.async=true;script.defer=true;
      script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.api_key)}&v=weekly&loading=async&libraries=marker&language=pt-BR&region=BR&callback=${callback}`;
      script.onerror=()=>{delete window[callback];cj149GooglePromise=null;reject(new Error('O Google Maps não carregou. Confira a chave do navegador, o faturamento e as restrições de site.'))};
      document.head.appendChild(script);
    });
    return cj149GooglePromise;
  }
  const cj149Point=value=>Array.isArray(value)?{lat:Number(value[0]),lng:Number(value[1])}:{lat:Number(value?.lat),lng:Number(value?.lng)};
  function cj149MarkerNode(color,label){const node=document.createElement('div');node.className='cj149-google-marker';node.style.setProperty('--marker-color',color||'#0d45d8');node.textContent=label||'•';return node}
  function cj149GeoPoints(value){
    let data=value;try{if(typeof data==='string')data=JSON.parse(data)}catch{return[]}
    if(Array.isArray(data))return data.map(cj149Point).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
    const geometry=data?.type==='Feature'?data.geometry:data;
    if(geometry?.type==='LineString'&&Array.isArray(geometry.coordinates))return geometry.coordinates.map(point=>({lat:Number(point[1]),lng:Number(point[0])})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
    return [];
  }
  async function cj149CreateMap(hostValue,options={}){
    const host=typeof hostValue==='string'?document.getElementById(hostValue):hostValue;
    if(!host)throw new Error('Área do mapa não encontrada.');
    const center=cj149Point(options.center||[-5.7945,-35.211]),zoom=Number(options.zoom||13);
    const config=await cj149MapConfig();
    host.replaceChildren();
    if(config.provider==='google'){
      await cj149LoadGoogle();
      const {Map:GoogleMap}=await google.maps.importLibrary('maps');
      const {AdvancedMarkerElement}=await google.maps.importLibrary('marker');
      const map=new GoogleMap(host,{center,zoom,mapId:config.map_id||'DEMO_MAP_ID',zoomControl:options.zoomControl!==false,mapTypeControl:false,streetViewControl:false,fullscreenControl:Boolean(options.fullscreenControl),gestureHandling:'greedy'});
      const info=new google.maps.InfoWindow(),groups=new Map();
      const put=(group,item,remove)=>{const key=group||'default';if(!groups.has(key))groups.set(key,[]);groups.get(key).push({item,remove});return item};
      const clearGroup=group=>{for(const entry of groups.get(group)||[])try{entry.remove()}catch{}groups.set(group,[])};
      const marker=(point,opts={})=>{
        let position=cj149Point(point);
        const item=new AdvancedMarkerElement({map,position,title:opts.title||'',content:cj149MarkerNode(opts.color,opts.label)});
        let popup=opts.popup||'';
        if(popup)item.addListener('click',()=>{info.setContent(popup);info.open({map,anchor:item})});
        put(opts.group||'default',item,()=>{item.map=null});
        return {setLatLng(next){position=cj149Point(next);item.position=position;return this},getLatLng(){return position},bindPopup(html){popup=html;item.addListener('click',()=>{info.setContent(popup);info.open({map,anchor:item})});return this},raw:item};
      };
      const polyline=(points,opts={})=>{const path=(points||[]).map(cj149Point).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));const item=new google.maps.Polyline({map,path,strokeColor:opts.color||'#0d45d8',strokeWeight:Number(opts.weight||6),strokeOpacity:Number(opts.opacity??.86)});put(opts.group||'default',item,()=>item.setMap(null));return item};
      const adapter={provider:'google',raw:map,config,clearGroup,clearLayers(){for(const key of groups.keys())clearGroup(key)},addMarker:marker,addCircleMarker:(point,opts={})=>marker(point,{...opts,label:opts.label||'●'}),addPolyline:polyline,addGeoJSON:(value,opts={})=>polyline(cj149GeoPoints(value),{...opts,group:opts.group||'route'}),setView(point,nextZoom){map.setCenter(cj149Point(point));if(nextZoom!=null)map.setZoom(Number(nextZoom));return adapter},panTo(point){map.panTo(cj149Point(point));return adapter},fitBounds(points,opts={}){const valid=(points||[]).map(cj149Point).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));if(!valid.length)return adapter;const bounds=new google.maps.LatLngBounds();valid.forEach(p=>bounds.extend(p));map.fitBounds(bounds,Number(opts.padding||40));const max=Number(opts.maxZoom||0);if(max)google.maps.event.addListenerOnce(map,'idle',()=>{if(Number(map.getZoom())>max)map.setZoom(max)});return adapter},on(event,handler){map.addListener(event,handler);return adapter},invalidateSize(){google.maps.event.trigger(map,'resize')},remove(){for(const key of groups.keys())clearGroup(key);host.replaceChildren()},getContainer(){return host}};
      return adapter;
    }
    if(typeof L==='undefined')throw new Error('O mapa alternativo não carregou.');
    const map=L.map(host,{zoomControl:options.zoomControl!==false,attributionControl:options.attributionControl!==false}).setView([center.lat,center.lng],zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
    const groups=new Map();
    const layerFor=group=>{const key=group||'default';if(!groups.has(key))groups.set(key,L.layerGroup().addTo(map));return groups.get(key)};
    const marker=(point,opts={})=>{const p=cj149Point(point),item=opts.circle?L.circleMarker([p.lat,p.lng],{radius:Number(opts.radius||9),weight:Number(opts.weight||4),fillOpacity:1,color:opts.color||'#0d45d8'}):L.marker([p.lat,p.lng]);item.addTo(layerFor(opts.group));if(opts.popup)item.bindPopup(opts.popup);return item};
    const adapter={provider:'openstreetmap',raw:map,config,clearGroup(group){layerFor(group).clearLayers()},clearLayers(){for(const layer of groups.values())layer.clearLayers()},addMarker:marker,addCircleMarker:(point,opts={})=>marker(point,{...opts,circle:true}),addPolyline(points,opts={}){return L.polyline((points||[]).map(p=>{const x=cj149Point(p);return[x.lat,x.lng]}),{color:opts.color||'#0d45d8',weight:Number(opts.weight||6),opacity:Number(opts.opacity??.86)}).addTo(layerFor(opts.group))},addGeoJSON(value,opts={}){const points=cj149GeoPoints(value);return points.length?this.addPolyline(points,{...opts,group:opts.group||'route'}):null},setView(point,nextZoom){const p=cj149Point(point);map.setView([p.lat,p.lng],nextZoom==null?map.getZoom():Number(nextZoom));return adapter},panTo(point,opts){const p=cj149Point(point);map.panTo([p.lat,p.lng],opts);return adapter},fitBounds(points,opts={}){const valid=(points||[]).map(cj149Point).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));if(valid.length){const fitOpts={...opts};if(typeof fitOpts.padding==='number')fitOpts.padding=[fitOpts.padding,fitOpts.padding];map.fitBounds(valid.map(p=>[p.lat,p.lng]),fitOpts)}return adapter},on(event,handler){map.on(event,handler);return adapter},invalidateSize(){map.invalidateSize()},remove(){map.remove()},getContainer(){return host}};
    return adapter;
  }
  window.ChegaJaMaps={
    config:cj149MapConfig,
    ensureGoogle:cj149LoadGoogle,
    createMap:cj149CreateMap,
    geoPoints:cj149GeoPoints,
    reset(){cj149MapConfigCache=null;cj149GooglePromise=null},
    async testBrowser(){const config=await cj149LoadGoogle(true);const host=document.createElement('div');host.style.cssText='position:fixed;left:-9999px;top:-9999px;width:80px;height:80px';document.body.appendChild(host);try{const map=await cj149CreateMap(host,{center:[-5.7945,-35.211],zoom:12});map.remove();return config}finally{host.remove()}}
  };

  pageMeta.settings=['Configurações','⚙'];
  if(typeof roles!=='undefined')roles.dispatcher='Atendente da Base';
  const masterPlatform=navByRole.platform_admin?.find(group=>group[0]==='Plataforma');
  if(masterPlatform&&!masterPlatform[1].includes('settings'))masterPlatform[1].push('settings');

  const previousSettings=pages.settings;
  pages.settings=async function(){
    if(state.user?.role!=='platform_admin')return previousSettings();
    const response=await api('/api/app/platform/maps-settings'),x=response.item||{};
    const provider=x.provider||'openstreetmap';
    $('#page-content').innerHTML=panel('Mapas e endereços da plataforma',`
      <form id="cj149-map-settings" class="form-grid">
        <div class="full notice"><strong>Escolha livre do provedor</strong><br>Quando OpenStreetMap estiver selecionado, o ChegaJá não usa as APIs do Google. Quando Google estiver selecionado, mapa, busca de endereços e navegação usam somente o Google, sem troca silenciosa para outro provedor.</div>
        <label>Provedor do mapa<select name="provider" required><option value="openstreetmap" ${provider==='openstreetmap'?'selected':''}>OpenStreetMap — alternativa sem chave</option><option value="google" ${provider==='google'?'selected':''}>Google Maps — mapa, endereços e rotas Google</option></select></label>
        ${field('Map ID do Google','map_id',x.map_id||'DEMO_MAP_ID','text','placeholder="DEMO_MAP_ID"')}
        <label>Chave Google do servidor<input name="server_key" type="password" autocomplete="off" placeholder="${h(x.has_server_key?`Configurada: ${x.server_key_masked}`:'Cole a chave com Places, Geocoding e Routes')}"></label>
        <label>Chave Google do navegador<input name="browser_key" type="password" autocomplete="off" placeholder="${h(x.has_browser_key?`Configurada: ${x.browser_key_masked}`:'Cole a chave com Maps JavaScript API')}"></label>
        <label class="cj149-check"><input type="checkbox" name="clear_server_key"><span>Apagar a chave do servidor salva</span></label>
        <label class="cj149-check"><input type="checkbox" name="clear_browser_key"><span>Apagar a chave do navegador salva</span></label>
        <div class="full cj149-map-status">
          <div><small>Provedor atual</small><strong>${provider==='google'?'Google Maps':'OpenStreetMap'}</strong></div>
          <div><small>Chave do servidor</small><strong>${x.has_server_key?'Configurada':'Não configurada'}</strong></div>
          <div><small>Chave do navegador</small><strong>${x.has_browser_key?'Configurada':'Não configurada'}</strong></div>
        </div>
        <div class="form-actions full"><button class="btn" type="button" id="cj149-test-maps">Testar configuração</button><button class="btn primary" type="submit">Salvar mapas</button></div>
      </form>`);
    const form=$id('cj149-map-settings');
    form.onsubmit=async event=>{
      event.preventDefault();
      try{
        loading(true);const body=formObject(form);
        await api('/api/app/platform/maps-settings',{method:'PUT',body});
        toast(body.provider==='google'?'Google Maps ativado. Recarregando o sistema...':'OpenStreetMap ativado. Recarregando o sistema...');
        window.ChegaJaMaps?.reset();setTimeout(()=>location.reload(),650);
      }catch(error){toast(error.message,'error')}finally{loading(false)}
    };
    $id('cj149-test-maps').onclick=async()=>{
      try{loading(true);const result=await api('/api/app/platform/maps-settings/test',{method:'POST',body:{}});if(result.provider==='google')await window.ChegaJaMaps.testBrowser();toast(result.message+(result.sample?` ${result.sample}`:'')+(result.provider==='google'?' Mapa do navegador carregado com sucesso.':''));}
      catch(error){toast(error.message,'error')}finally{loading(false)}
    };
  };

  async function attendantBases(){
    if(state.user?.role!=='cooperative_admin')return [];
    const response=await api(`/api/app/users/attendant-bases${query(scopeParams())}`);
    return (response.items||[]).filter(item=>Number(item.active??1)===1);
  }

  function baseSelectorHtml(bases,item={},required=false){
    const selected=item.base_id||bases[0]?.id||'';
    if(bases.length===1)return `<div class="full notice"><strong>Base vinculada automaticamente:</strong> ${h(bases[0].name)}<br><small>Não é necessário selecionar nem cadastrar outra Base.</small></div>`;
    if(!bases.length)return '<div class="full notice error"><strong>Nenhuma Base ativa encontrada.</strong><br>Cadastre ou ative uma Base antes de criar o atendente.</div>';
    return selectField('Base do atendente','base_id',bases,selected,'Selecione a Base',required?'required':'');
  }

  function cj149UserForm(item={},bases=[],attendantMode=false){
    const profiles=attendantMode?['dispatcher']:['cooperative_admin','establishment','driver'];
    const profileOptions=profiles.map(role=>`<option value="${role}" ${item.role===role?'selected':''}>${h(roles[role]||role)}</option>`).join('');
    openModal(item.id?'Editar acesso':attendantMode?'Cadastrar atendente da Base':'Novo acesso administrativo',`<form id="cj149-user-form" class="form-grid">
      ${field('Nome','name',item.name,'text','required')}${field('E-mail','email',item.email,'email','required')}${field('Usuário opcional','username',item.username)}
      <label>Perfil<select name="role" required><option value="">Selecione</option>${profileOptions}</select></label>
      ${attendantMode||item.role==='dispatcher'?baseSelectorHtml(bases,item,true):''}
      ${!attendantMode?selectField('Estabelecimento','establishment_id',state.cache.establishments||[],item.establishment_id,'Nenhum'):''}
      ${!attendantMode?selectField('Cooperado','driver_id',state.cache.drivers||[],item.driver_id,'Nenhum'):''}
      ${field(item.id?'Nova senha (opcional)':'Senha inicial','password','','password',item.id?'minlength="8"':'required minlength="8"')}
      <label>Status<select name="status"><option value="active">Ativo</option><option value="blocked" ${item.status==='blocked'?'selected':''}>Bloqueado</option><option value="inactive" ${item.status==='inactive'?'selected':''}>Inativo</option></select></label>
      ${buttons(attendantMode?'Salvar atendente':'Salvar acesso')}
    </form>`);
    const form=$id('cj149-user-form');
    form.onsubmit=async event=>{
      event.preventDefault();
      if((attendantMode||item.role==='dispatcher')&&!form.elements.base_id?.value&&bases.length!==1)return toast('Cadastre ou selecione uma Base.','error');
      try{
        loading(true);const body=scopeBody(formObject(form));
        await api(`/api/app/users${item.id?`/${item.id}`:''}`,{method:item.id?'PUT':'POST',body});
        closeModal();toast(attendantMode?'Atendente da Base salvo.':'Acesso salvo.');state.cache.baseKey='';state.cache.lgBaseKey='';pages.users();
      }catch(error){toast(error.message,'error')}finally{loading(false)}
    };
  }

  const previousUsers=pages.users;
  pages.users=async function(){
    if(!['cooperative_admin','platform_admin'].includes(state.user?.role||''))return previousUsers();
    const [base,data,bases]=await Promise.all([
      typeof baseData==='function'?baseData():Promise.resolve(state.cache),
      api(`/api/app/users${query(scopeParams())}`),
      attendantBases()
    ]);
    const canCreateAttendant=state.user.role==='cooperative_admin';
    const tools=`${canCreateAttendant?'<button class="btn primary" id="cj149-new-attendant">Cadastrar atendente da Base</button>':''}<button class="btn" id="cj149-new-user">Novo acesso administrativo</button>`;
    $('#page-content').innerHTML=panel('Usuários e acessos',table([
      {label:'Nome',key:'name'},{label:'E-mail',key:'email'},{label:'Perfil',render:r=>h(roles[r.role]||r.role)},
      {label:'Vínculo',render:r=>h(r.base_name||r.establishment_name||r.driver_name||'Administração')},
      {label:'Status',render:r=>badge(r.status)}
    ],data.items||[],r=>r.role==='platform_admin'?'<span class="muted">Acesso Master protegido</span>':`<button class="table-action" data-cj149-edit-user="${r.id}">Editar</button><button class="table-action" data-cj149-del-user="${r.id}">Excluir</button>`),tools);
    $id('cj149-new-user').onclick=()=>cj149UserForm({},base,false);
    $id('cj149-new-attendant')?.addEventListener('click',()=>cj149UserForm({role:'dispatcher'},bases,true));
    $$('[data-cj149-edit-user]').forEach(button=>button.onclick=()=>{const item=(data.items||[]).find(row=>row.id===button.dataset.cj149EditUser);cj149UserForm(item,item?.role==='dispatcher'?bases:base,item?.role==='dispatcher')});
    $$('[data-cj149-del-user]').forEach(button=>button.onclick=()=>removeEntity(`/api/app/users/${button.dataset.cj149DelUser}`,'Excluir este acesso?',pages.users));
  };

  async function nextMembership(joinedAt=today()){
    const response=await api(`/api/app/drivers/next-membership${query(scopeParams({joined_at:joinedAt}))}`);
    return response.item||{};
  }

  async function cj149DriverForm(item={}){
    const isNew=!item.id;
    const suggestion=isNew?await nextMembership(today()).catch(()=>({membership_number:'',joined_at:today()})):{};
    const joinedAt=item.joined_at||suggestion.joined_at||String(item.created_at||today()).slice(0,10);
    const hasAccess=Boolean(item.access_user_id);
    const formStatus=item.status==='inactive'?'active':(item.status||'active');
    openModal(item.id?'Editar cooperado':'Novo cooperado',`<form id="cj149-driver-form" class="form-grid">
      ${field('Nome','name',item.name,'text','required')}${field('CPF','cpf',item.cpf,'text','required inputmode="numeric"')}
      ${field('Matrícula','membership_number',item.membership_number||suggestion.membership_number,'text','required placeholder="0001-26" pattern="[0-9]{1,4}[-/][0-9]{2,4}"')}
      ${field('Data de ingresso','joined_at',joinedAt,'date','required')}
      ${field('Telefone','phone',item.phone)}${field('E-mail do cooperado','email',item.email,'email')}${field('Placa','vehicle_plate',item.vehicle_plate)}${field('Modelo da moto','vehicle_model',item.vehicle_model)}
      ${item.id?`<label>Status<select name="status"><option value="active" ${formStatus==='active'?'selected':''}>Ativo</option><option value="inactive" ${formStatus==='inactive'?'selected':''}>Inativo</option><option value="blocked" ${formStatus==='blocked'?'selected':''}>Bloqueado</option></select></label>`:''}
      <div class="full notice"><strong>Matrícula permanente</strong><br>Os quatro primeiros números são a sequência e os dois últimos são o ano de ingresso. Ao inativar e cadastrar novamente o mesmo CPF e nome, o sistema reaproveita este cadastro e esta matrícula.</div>
      <div class="full notice"><strong>Acesso ao aplicativo</strong><br>${hasAccess?'Deixe a nova senha vazia para manter a atual.':'O acesso é opcional neste momento.'}</div>
      ${field('E-mail para entrar','access_email',item.access_email||item.email,'email')}${field('Usuário opcional','access_username',item.access_username||'')}${field(hasAccess?'Nova senha (opcional)':'Senha inicial (opcional)','access_password','','password','minlength="8"')}
      ${buttons(item.status==='inactive'?'Reativar e salvar':'Salvar cooperado')}
    </form>`);
    const form=$id('cj149-driver-form');
    form.elements.joined_at?.addEventListener('change',async()=>{
      if(!isNew)return;
      try{const data=await nextMembership(form.elements.joined_at.value);form.elements.membership_number.value=data.membership_number||form.elements.membership_number.value}catch{}
    });
    form.onsubmit=async event=>{
      event.preventDefault();const body=scopeBody(formObject(form));
      try{
        loading(true);let driverId=item.id;
        if(item.id){await api(`/api/app/drivers/${item.id}`,{method:'PUT',body});}
        else{const result=await api('/api/app/drivers',{method:'POST',body});driverId=result.item.id;if(result.item.restored)toast(`Cooperado reativado com a matrícula ${result.item.membership_number}.`);}
        if(body.access_email&&body.access_password){await api(`/api/app/drivers/${driverId}/access`,{method:'POST',body:{name:body.name,email:body.access_email,username:body.access_username,password:body.access_password}});}
        closeModal();toast('Cooperado salvo.');state.cache.baseKey='';state.cache.lgBaseKey='';pages.drivers();
      }catch(error){toast(error.message,'error')}finally{loading(false)}
    };
  }

  pages.drivers=async function(){
    const status=state.cache.cj149DriverStatus||'all';
    const data=await api(`/api/app/drivers${query(scopeParams({include_inactive:1}))}`);
    const rows=(data.items||[]).filter(item=>status==='all'||item.status===status);
    const tools=`<div class="cj149-driver-tools"><select id="cj149-driver-status"><option value="all">Todos</option><option value="active" ${status==='active'?'selected':''}>Ativos</option><option value="inactive" ${status==='inactive'?'selected':''}>Inativos</option><option value="blocked" ${status==='blocked'?'selected':''}>Bloqueados</option></select><button class="btn primary" id="cj149-new-driver">Novo cooperado</button></div>`;
    $('#page-content').innerHTML=panel('Cooperados da cooperativa',table([
      {label:'Matrícula',render:r=>`<strong>${h(r.membership_number||'—')}</strong>`},{label:'Nome',key:'name'},{label:'CPF',key:'cpf'},{label:'Telefone',key:'phone'},
      {label:'Moto/placa',render:r=>h([r.vehicle_model,r.vehicle_plate].filter(Boolean).join(' • ')||'—')},
      {label:'Acesso',render:r=>r.access_email?`${h(r.access_username||r.access_email)}<br>${badge(r.access_status||'inactive')}`:'<span class="muted">Sem acesso</span>'},
      {label:'Status',render:r=>badge(r.status)}
    ],rows,r=>canEdit()?`${r.status==='active'?`<button class="table-action primary" data-cj149-access-driver="${r.id}">Acesso</button>`:''}<button class="table-action" data-cj149-edit-driver="${r.id}">${r.status==='inactive'?'Reativar / editar':'Editar'}</button>${r.status==='active'?`<button class="table-action" data-cj149-disable-driver="${r.id}">Excluir</button>`:''}`:''),canEdit()?tools:'');
    $id('cj149-driver-status')?.addEventListener('change',event=>{state.cache.cj149DriverStatus=event.target.value;pages.drivers()});
    $id('cj149-new-driver')?.addEventListener('click',()=>cj149DriverForm());
    $$('[data-cj149-edit-driver]').forEach(button=>button.onclick=()=>cj149DriverForm((data.items||[]).find(row=>row.id===button.dataset.cj149EditDriver)));
    $$('[data-cj149-access-driver]').forEach(button=>button.onclick=()=>linkedAccessForm('driver',(data.items||[]).find(row=>row.id===button.dataset.cj149AccessDriver)));
    $$('[data-cj149-disable-driver]').forEach(button=>button.onclick=async()=>{
      if(!confirm('Inativar este cooperado? Ele não poderá entrar ou receber entregas, mas matrícula e todo o histórico serão preservados.'))return;
      try{loading(true);const result=await api(`/api/app/drivers/${button.dataset.cj149DisableDriver}`,{method:'DELETE'});toast(result.message||'Cooperado inativado.');pages.drivers()}catch(error){toast(error.message,'error')}finally{loading(false)}
    });
  };
})();
