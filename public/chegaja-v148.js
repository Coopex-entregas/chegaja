(()=>{
  'use strict';

  const runtime={
    matrix:null,
    selectedDriverId:'',
    rowSaves:new Map(),
  };

  if(typeof pageMeta!=='undefined'){pageMeta.contracts[0]='Contratos e locais';pageMeta.shifts[0]='Horários dos contratos';}

  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[char]));
  const today=()=>isoDate();
  const addDays=(value,days)=>{const date=new Date(`${value}T12:00:00`);date.setDate(date.getDate()+days);return date.toISOString().slice(0,10)};
  const monday=value=>{const date=new Date(`${value}T12:00:00`),day=date.getDay();date.setDate(date.getDate()-(day===0?6:day-1));return date.toISOString().slice(0,10)};
  const nextMonday=()=>addDays(monday(today()),7);
  const dateBr=value=>{const date=new Date(`${value}T12:00:00`);return Number.isNaN(date.getTime())?String(value||''):date.toLocaleDateString('pt-BR')};
  const weekDays=['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado','Domingo'];
  const weekShort=['SEG','TER','QUA','QUI','SEX','SÁB','DOM'];
  const isManager=()=>Boolean(state?.user&&['cooperative_admin','dispatcher'].includes(state.user.role));
  const byName=(a,b)=>String(a||'').localeCompare(String(b||''),'pt-BR',{sensitivity:'base'});

  function driverState(driver){
    if(driver.status!=='active')return '<span class="cj148-driver-state inactive">Inativo</span>';
    if(Number(driver.on_leave||0)===1)return `<span class="cj148-driver-state leave">Afastado até ${escapeHtml(driver.leave_return_date?dateBr(driver.leave_return_date):'sem data')}</span>`;
    return '<span class="cj148-driver-state active">Ativo</span>';
  }

  function visibleEstablishments(data){
    const virtualIds=new Set((data.bases||[]).map(item=>String(item.virtual_establishment_id||'')).filter(Boolean));
    return (data.establishments||[]).filter(item=>!virtualIds.has(String(item.id)));
  }

  function workplaces(data){
    const provided=Array.isArray(data.workplaces)?data.workplaces:[];
    if(provided.length)return provided;
    const virtualBaseEstablishmentIds=new Set((data.bases||[]).map(item=>String(item.virtual_establishment_id||'')).filter(Boolean));
    const visibleContracts=(data.contracts||[]).filter(item=>!(String(item.name||'').trim().toLocaleLowerCase('pt-BR')==='base'&&virtualBaseEstablishmentIds.has(String(item.establishment_id||''))));
    const contractEstablishmentIds=new Set(visibleContracts.map(item=>String(item.establishment_id||'')).filter(Boolean));
    return [
      ...(data.bases||[]).map(item=>({value:`base:${item.id}`,kind:'base',id:item.id,label:`BASE — ${item.name}`})),
      ...visibleContracts.map(item=>({value:`contract:${item.id}`,kind:'contract',id:item.id,label:item.establishment_name?`${item.name} — ${item.establishment_name}`:item.name,establishment_id:item.establishment_id||null})),
      ...visibleEstablishments(data).filter(item=>!contractEstablishmentIds.has(String(item.id))).map(item=>({value:`establishment:${item.id}`,kind:'establishment',id:item.id,label:item.name,establishment_id:item.id})),
    ].sort((a,b)=>byName(a.label,b.label));
  }

  function assignmentValue(row){
    if(row.assignment_value)return String(row.assignment_value);
    if(row.entry_type==='leave'||row.assignment_type==='leave')return 'leave';
    if(row.entry_type!=='work'||row.assignment_type==='day_off')return 'day_off';
    if(row.assignment_type==='base')return `base:${row.base_id}`;
    if(row.assignment_type==='establishment')return `establishment:${row.establishment_id}`;
    return `contract:${row.contract_id}`;
  }

  function assignmentOptions(data,row){
    const current=assignmentValue(row);
    return `<option value="day_off" ${current==='day_off'?'selected':''}>FOLGA</option>${current==='leave'?'<option value="leave" selected disabled>AFASTADO</option>':''}<optgroup label="Contratos, estabelecimentos e Base">${workplaces(data).map(item=>`<option value="${escapeHtml(item.value)}" ${current===String(item.value)?'selected':''}>${escapeHtml(item.label)}</option>`).join('')}</optgroup>`;
  }

  function driverOptions(data,selected){
    return (data.drivers||[]).map(driver=>`<option value="${escapeHtml(driver.id)}" ${String(driver.id)===String(selected)?'selected':''}>${escapeHtml(driver.name)}${Number(driver.on_leave||0)===1?' • afastado':''}</option>`).join('');
  }

  function shiftsForAssignment(data,value){
    if(!value||['day_off','leave'].includes(value))return [];
    const [kind,targetId]=String(value).split(':');
    return (data.shifts||[])
      .filter(shift=>{
        if(kind==='base')return String(shift.base_id||'')===String(targetId);
        if(kind==='establishment')return String(shift.establishment_id||'')===String(targetId);
        if(kind==='contract')return String(shift.contract_id||'')===String(targetId);
        return false;
      })
      .sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time))||byName(a.name,b.name));
  }

  function shiftOptions(data,row,value){
    const items=shiftsForAssignment(data,value);
    const selected=String(row.shift_template_id||'');
    const valid=items.some(item=>String(item.id)===selected);
    const placeholder=items.length?'Selecione um horário cadastrado':'Nenhum horário cadastrado para este local';
    return `<option value="" ${valid?'':'selected'}>${placeholder}</option>${items.map(item=>{
      return `<option value="${escapeHtml(item.id)}" ${String(item.id)===selected?'selected':''}>${escapeHtml(item.name)} • ${escapeHtml(item.start_time)} às ${escapeHtml(item.end_time)}</option>`;
    }).join('')}`;
  }

  function rowHtml(data,row){
    const assignment=assignmentValue(row);
    const work=row.entry_type==='work';
    const rowClass=work?'is-work':row.entry_type==='leave'?'is-afastado':'is-folga';
    return `<tr class="cj148-schedule-row ${rowClass}" data-row-id="${escapeHtml(row.id)}" data-group-driver="${escapeHtml(row.group_driver_id)}" data-date="${escapeHtml(row.date)}" data-day="${Number(row.day_index)}" data-default="${Number(row.is_default||0)}">
      <td><strong>${dateBr(row.date)}-${weekShort[Number(row.day_index)]}</strong></td>
      <td class="cj148-number"><b>${Number(row.row_order||0)}</b></td>
      <td><select data-cj148-field="turn_label"><option ${row.turn_label==='DIA'?'selected':''}>DIA</option><option ${row.turn_label==='NOITE'?'selected':''}>NOITE</option><option ${row.turn_label==='MADRUGADA'?'selected':''}>MADRUGADA</option></select></td>
      <td><div class="cj148-hours"><select data-cj148-field="shift_template_id">${shiftOptions(data,row,assignment)}</select><div><input data-cj148-field="start_time" type="time" readonly value="${escapeHtml(row.start_time||'')}"><span>às</span><input data-cj148-field="end_time" type="time" readonly value="${escapeHtml(row.end_time||'')}"></div></div></td>
      <td><select data-cj148-field="assignment_value">${assignmentOptions(data,row)}</select></td>
      <td><select data-cj148-field="driver_id">${driverOptions(data,row.driver_id)}</select></td>
      <td><div class="cj148-row-status"><span class="cj148-save-state">${row.entry_type==='leave'?'Afastado':work?'Salvo no rascunho':'Folga'}</span><small class="cj148-row-warning"></small></div></td>
      <td>${Number(row.is_default||0)===1?'<span class="cj148-default">Padrão</span>':'<button class="cj148-remove" type="button">Remover</button>'}</td>
    </tr>`;
  }

  function returnAlerts(data){
    return (data.return_alerts||[]).map(driver=>`<div class="cj148-return-alert"><strong>ATENÇÃO:</strong> ${escapeHtml(driver.name)} retorna em ${dateBr(driver.leave_return_date)}. Inclua o cooperado na próxima escala.</div>`).join('');
  }

  function selectedDriver(data){
    let driver=(data.drivers||[]).find(item=>String(item.id)===String(runtime.selectedDriverId));
    if(!driver)driver=(data.drivers||[])[0];
    runtime.selectedDriverId=driver?String(driver.id):'';
    return driver;
  }

  function blockedCount(data,driverId){
    return (data.blocks||[]).filter(item=>String(item.driver_id)===String(driverId)).length;
  }

  function driverAdminHtml(data){
    const selected=selectedDriver(data);
    return `<section class="cj148-driver-admin">
      <header><div><p class="eyebrow">COOPERADOS E IMPEDIMENTOS</p><h3>Um cooperado abaixo do outro</h3><p>Clique no nome para selecionar. Depois marque afastamento, bloqueios ou acrescente uma escala.</p></div><label>Localizar cooperado<input id="cj148-driver-search" type="search" placeholder="Digite o nome"></label></header>
      <div class="cj148-driver-admin-body">
        <div id="cj148-driver-list" class="cj148-driver-list">${(data.drivers||[]).map(driver=>`<button type="button" data-cj148-select-driver="${escapeHtml(driver.id)}" data-name="${escapeHtml(String(driver.name).toLocaleLowerCase('pt-BR'))}" class="${String(driver.id)===String(selected?.id)?'selected':''}"><span><strong>${escapeHtml(driver.name)}</strong>${driverState(driver)}</span><small>${blockedCount(data,driver.id)} bloqueio(s)</small></button>`).join('')||'<span class="muted">Nenhum cooperado ativo.</span>'}</div>
        <div id="cj148-driver-actions" class="cj148-driver-actions">${selectedDriverActionsHtml(data,selected)}</div>
      </div>
    </section>`;
  }

  function selectedDriverActionsHtml(data,driver){
    if(!driver)return '<div class="empty">Selecione um cooperado.</div>';
    return `<div class="cj148-selected-driver"><div><small>COOPERADO SELECIONADO</small><h3>${escapeHtml(driver.name)}</h3>${driverState(driver)}<p>${blockedCount(data,driver.id)} estabelecimento(s) bloqueado(s).</p></div><div class="cj148-selected-buttons"><button class="btn primary" type="button" id="cj148-driver-leave">Afastamento</button><button class="btn" type="button" id="cj148-driver-blocks">Bloqueios</button><button class="btn" type="button" id="cj148-driver-add-row">+ Acrescentar escala</button><button class="btn soft" type="button" id="cj148-driver-show">Ver somente este cooperado</button></div></div>`;
  }

  function updateSelectedDriverPanel(data){
    const driver=selectedDriver(data);
    document.querySelectorAll('[data-cj148-select-driver]').forEach(button=>button.classList.toggle('selected',String(button.dataset.cj148SelectDriver)===String(driver?.id)));
    const actions=document.getElementById('cj148-driver-actions');
    if(actions)actions.innerHTML=selectedDriverActionsHtml(data,driver);
    bindSelectedDriverActions(data,driver);
  }

  function bindSelectedDriverActions(data,driver){
    if(!driver)return;
    document.getElementById('cj148-driver-leave')?.addEventListener('click',()=>openLeave(data,driver));
    document.getElementById('cj148-driver-blocks')?.addEventListener('click',()=>openBlocks(data,driver));
    document.getElementById('cj148-driver-add-row')?.addEventListener('click',()=>openAddRow(data,driver));
    document.getElementById('cj148-driver-show')?.addEventListener('click',()=>{
      const filter=document.getElementById('cj148-filter-driver');
      if(filter){filter.value=String(driver.id);applyView(data)}
    });
  }

  async function openLeave(data,driver){
    openModal(`Afastamento • ${driver.name}`,`<form id="cj148-leave-form" class="form-grid"><div class="full notice">Enquanto estiver afastado, o cooperado não recebe escala. Uma semana antes do retorno, a escala mostrará um aviso.</div><label>Data de início<input name="leave_start_date" type="date" required value="${escapeHtml(driver.leave_start_date||today())}"></label><label>Data de retorno<input name="leave_return_date" type="date" required value="${escapeHtml(driver.leave_return_date||'')}"></label><label class="full">Motivo<textarea name="leave_reason" rows="3">${escapeHtml(driver.leave_reason||'')}</textarea></label><div class="form-actions full">${Number(driver.on_leave||0)===1?'<button type="button" class="btn danger" id="cj148-end-leave">Retirar afastamento</button>':''}<button type="button" class="btn" data-close-modal>Cancelar</button><button class="btn primary">Salvar afastamento</button></div></form>`);
    const form=document.getElementById('cj148-leave-form');
    form.onsubmit=async event=>{event.preventDefault();try{loading(true);const body=formObject(form);if(body.leave_return_date<=body.leave_start_date)throw new Error('A data de retorno precisa ser posterior ao início.');await api(`/api/app/v19/drivers/${driver.id}/leave`,{method:'PUT',body:{on_leave:true,...body}});closeModal();toast('Afastamento salvo.');await renderSchedule(true)}catch(error){toast(error.message,'error')}finally{loading(false)}};
    document.getElementById('cj148-end-leave')?.addEventListener('click',async()=>{if(!confirm(`Retirar o afastamento de ${driver.name}?`))return;try{loading(true);await api(`/api/app/v19/drivers/${driver.id}/leave`,{method:'PUT',body:{on_leave:false}});closeModal();toast('Afastamento retirado.');await renderSchedule(true)}catch(error){toast(error.message,'error')}finally{loading(false)}});
  }

  async function openBlocks(data,driver){
    const blocked=new Map((data.blocks||[]).filter(item=>String(item.driver_id)===String(driver.id)).map(item=>[String(item.establishment_id),item]));
    const establishments=visibleEstablishments(data);
    openModal(`Bloqueios • ${driver.name}`,`<form id="cj148-block-form" class="form-grid"><div class="full notice">O cooperado não poderá ser escalado nem aceitar troca nos estabelecimentos marcados.</div><div class="full cj148-block-list">${establishments.map(item=>`<label><input name="establishment_ids[]" type="checkbox" value="${escapeHtml(item.id)}" ${blocked.has(String(item.id))?'checked':''}><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.address||'')}</small></span></label>`).join('')||'<span class="muted">Nenhum estabelecimento cadastrado.</span>'}</div><label class="full">Motivo do bloqueio<textarea name="reason" rows="3" placeholder="Ex.: solicitação do estabelecimento">${escapeHtml([...blocked.values()][0]?.reason||'')}</textarea></label><div class="form-actions full"><button type="button" class="btn" data-close-modal>Cancelar</button><button class="btn primary">Salvar bloqueios</button></div></form>`);
    const form=document.getElementById('cj148-block-form');
    form.onsubmit=async event=>{event.preventDefault();try{loading(true);const values=formObject(form);let ids=values.establishment_ids||[];if(!Array.isArray(ids))ids=ids?[ids]:[];await api(`/api/app/v19/drivers/${driver.id}/establishment-blocks`,{method:'PUT',body:{establishment_ids:ids,reason:values.reason}});closeModal();toast('Bloqueios atualizados.');await renderSchedule(true)}catch(error){toast(error.message,'error')}finally{loading(false)}};
  }

  function openAddRow(data,driver){
    openModal(`Acrescentar escala • ${driver.name}`,`<form id="cj148-add-row-form" class="form-grid"><label>Dia<select name="day_index">${weekDays.map((name,index)=>`<option value="${index}">${name} — ${dateBr(addDays(data.week_start,index))}</option>`).join('')}</select></label><label>Turno<select name="turn_label"><option>DIA</option><option>NOITE</option><option>MADRUGADA</option></select></label><div class="full notice">A nova linha será criada como FOLGA. Depois escolha o contrato/local e um dos horários já cadastrados para ele.</div><div class="form-actions full"><button type="button" class="btn" data-close-modal>Cancelar</button><button class="btn primary">Acrescentar escala</button></div></form>`);
    const form=document.getElementById('cj148-add-row-form');
    form.onsubmit=async event=>{event.preventDefault();try{loading(true);const values=formObject(form);await api('/api/app/v21/schedule/rows',{method:'POST',body:{week_start:data.week_start,group_driver_id:driver.id,day_index:Number(values.day_index),turn_label:values.turn_label}});closeModal();toast('Escala acrescentada.');await renderSchedule(true)}catch(error){toast(error.message,'error')}finally{loading(false)}};
  }

  function workMode(row){
    const value=row.querySelector('[data-cj148-field="assignment_value"]').value;
    return !['day_off','leave'].includes(value);
  }

  function updateRowMode(data,row,{preserveShift=true}={}){
    const assignment=row.querySelector('[data-cj148-field="assignment_value"]');
    const shift=row.querySelector('[data-cj148-field="shift_template_id"]');
    const start=row.querySelector('[data-cj148-field="start_time"]');
    const end=row.querySelector('[data-cj148-field="end_time"]');
    const work=workMode(row);
    row.classList.toggle('is-work',work);
    row.classList.toggle('is-folga',assignment.value==='day_off');
    row.classList.toggle('is-afastado',assignment.value==='leave');
    shift.disabled=!work;
    if(!work){shift.innerHTML='<option value="">Não se aplica</option>';start.value='';end.value='';row.querySelector('.cj148-save-state').textContent=assignment.value==='leave'?'Afastado':'Folga';return}
    const previous=preserveShift?shift.value:'';
    const current={shift_template_id:previous};
    shift.innerHTML=shiftOptions(data,current,assignment.value);
    const options=shiftsForAssignment(data,assignment.value);
    if(previous&&options.some(item=>String(item.id)===String(previous)))shift.value=previous;
    else if(options.length===1)shift.value=String(options[0].id);
    else shift.value='';
    const selected=(data.shifts||[]).find(item=>String(item.id)===String(shift.value));
    if(selected){start.value=selected.start_time;end.value=selected.end_time;const label=String(selected.shift_label||'').toUpperCase();const turn=row.querySelector('[data-cj148-field="turn_label"]');if(['DIA','NOITE','MADRUGADA'].includes(label))turn.value=label;else if(Number(String(selected.start_time).slice(0,2))>=17)turn.value='NOITE'}
    else{start.value='';end.value=''}
    row.querySelector('.cj148-save-state').textContent=shift.value?'Alterado — salvamento automático':options.length?'Selecione o horário':'Cadastre um horário para este local';
  }

  function payload(row){
    return {
      driver_id:row.querySelector('[data-cj148-field="driver_id"]').value,
      assignment_value:row.querySelector('[data-cj148-field="assignment_value"]').value,
      turn_label:row.querySelector('[data-cj148-field="turn_label"]').value,
      shift_template_id:row.querySelector('[data-cj148-field="shift_template_id"]').value||null,
      start_time:row.querySelector('[data-cj148-field="start_time"]').value,
      end_time:row.querySelector('[data-cj148-field="end_time"]').value,
      guaranteed_value:0,
      notes:'',
    };
  }

  function selectedShiftForRow(data,row){
    if(!workMode(row))return null;
    const assignment=row.querySelector('[data-cj148-field="assignment_value"]').value;
    const shiftId=row.querySelector('[data-cj148-field="shift_template_id"]').value;
    if(!shiftId)return null;
    return shiftsForAssignment(data,assignment).find(item=>String(item.id)===String(shiftId))||null;
  }

  function rowReady(data,row){
    if(!workMode(row))return true;
    return Boolean(selectedShiftForRow(data,row));
  }

  async function drainSave(data,row){
    const id=String(row.dataset.rowId);
    const save=runtime.rowSaves.get(id);
    if(!save||save.running)return save?.running||true;
    save.running=(async()=>{
      while(save.pending){
        save.pending=false;
        const requestBody={...save.body};
        const requestRevision=Number(save.revision||0);
        const status=row.querySelector('.cj148-save-state');
        status.textContent='Salvando…';row.classList.add('is-saving');row.classList.remove('is-save-error');
        try{
          const result=await api(`/api/app/v21/schedule/rows/${id}`,{method:'PUT',body:requestBody});
          if(requestRevision!==Number(save.revision||0)){save.pending=true;continue}
          save.error='';status.textContent='Salvo automaticamente';row.classList.add('is-saved');
          const index=data.rows.findIndex(item=>String(item.id)===id);if(index>=0&&result.item)data.rows[index]=result.item;
          if(result.item){
            const shift=row.querySelector('[data-cj148-field="shift_template_id"]');
            const actual=String(result.item.shift_template_id||'');
            if(actual&&[...shift.options].some(option=>String(option.value)===actual))shift.value=actual;
            row.querySelector('[data-cj148-field="start_time"]').value=result.item.start_time||'';
            row.querySelector('[data-cj148-field="end_time"]').value=result.item.end_time||'';
          }
          const publication=document.getElementById('cj148-publication-status');
          if(publication){publication.className='cj148-publication-status draft';publication.innerHTML='<strong>RASCUNHO</strong><span>Alterações salvas automaticamente. A escala ativa só muda ao clicar em Enviar escala.</span>'}
          applyView(data,{sort:false});
        }catch(error){
          if(requestRevision!==Number(save.revision||0)){save.pending=true;continue}
          save.error=error.message||'Erro ao salvar';status.textContent='Erro ao salvar';row.classList.add('is-save-error');
          if(/horário selecionado|não pertence/i.test(save.error)){
            updateRowMode(data,row,{preserveShift:false});
            status.textContent='Escolha novamente o horário deste local';
          }
          toast(save.error,'error');
        }finally{row.classList.remove('is-saving')}
      }
    })().finally(()=>{save.running=null;if(save.pending)drainSave(data,row)});
    return save.running;
  }

  function queueSave(data,row){
    if(!rowReady(data,row)){row.querySelector('.cj148-save-state').textContent='Selecione um horário cadastrado deste local';row.classList.add('is-save-error');return}
    const id=String(row.dataset.rowId);
    const save=runtime.rowSaves.get(id)||{timer:null,running:null,pending:false,body:null,error:'',revision:0};
    save.revision=Number(save.revision||0)+1;
    save.body=payload(row);save.pending=true;save.error='';clearTimeout(save.timer);
    save.timer=setTimeout(()=>{save.timer=null;drainSave(data,row)},220);
    runtime.rowSaves.set(id,save);
    row.querySelector('.cj148-save-state').textContent='Alterado — salvamento automático';row.classList.remove('is-save-error');
  }

  async function flushSaves(data){
    const jobs=[];
    for(const row of document.querySelectorAll('.cj148-schedule-row')){
      if(workMode(row)&&!rowReady(data,row))throw new Error(`Selecione o horário de ${row.querySelector('[data-cj148-field="driver_id"]').selectedOptions[0]?.textContent||'um cooperado'} em ${dateBr(row.dataset.date)}.`);
      const save=runtime.rowSaves.get(String(row.dataset.rowId));
      if(!save)continue;clearTimeout(save.timer);save.timer=null;if(save.pending||save.running)jobs.push(drainSave(data,row));
    }
    await Promise.all(jobs);
    const failed=[...runtime.rowSaves.values()].find(item=>item.error);if(failed)throw new Error(`Existe uma alteração não salva: ${failed.error}`);
  }

  function bindRows(data){
    runtime.rowSaves.clear();
    document.querySelectorAll('.cj148-schedule-row').forEach(row=>{
      const assignment=row.querySelector('[data-cj148-field="assignment_value"]');
      const shift=row.querySelector('[data-cj148-field="shift_template_id"]');
      assignment.addEventListener('change',()=>{updateRowMode(data,row,{preserveShift:false});if(!workMode(row)||rowReady(data,row))queueSave(data,row);applyView(data,{sort:false})});
      shift.addEventListener('change',()=>{const item=(data.shifts||[]).find(entry=>String(entry.id)===String(shift.value));if(item){row.querySelector('[data-cj148-field="start_time"]').value=item.start_time;row.querySelector('[data-cj148-field="end_time"]').value=item.end_time;const label=String(item.shift_label||'').toUpperCase();if(['DIA','NOITE','MADRUGADA'].includes(label))row.querySelector('[data-cj148-field="turn_label"]').value=label}queueSave(data,row);applyView(data,{sort:false})});
      row.querySelector('[data-cj148-field="driver_id"]').addEventListener('change',()=>{queueSave(data,row);applyView(data,{sort:false})});
      row.querySelector('[data-cj148-field="turn_label"]').addEventListener('change',()=>{queueSave(data,row);applyView(data,{sort:false})});
      row.addEventListener('focusin',()=>row.classList.add('is-editing'));
      row.addEventListener('focusout',()=>setTimeout(()=>{if(!row.contains(document.activeElement)){row.classList.remove('is-editing');applyView(data)}},120));
      row.querySelector('.cj148-remove')?.addEventListener('click',async()=>{if(!confirm('Remover esta escala extra?'))return;try{loading(true);await flushSaves(data);await api(`/api/app/v21/schedule/rows/${row.dataset.rowId}`,{method:'DELETE'});toast('Escala extra removida.');await renderSchedule(true)}catch(error){toast(error.message,'error')}finally{loading(false)}});
      updateRowMode(data,row,{preserveShift:true});
    });
  }

  function rowData(data,row){
    const assignment=row.querySelector('[data-cj148-field="assignment_value"]');
    const driver=row.querySelector('[data-cj148-field="driver_id"]');
    const turn=row.querySelector('[data-cj148-field="turn_label"]');
    const value=assignment.value,[kind,targetId]=value.split(':');
    let location='';
    if(kind==='base')location=`base:${targetId}`;
    else if(kind==='establishment')location=`establishment:${targetId}`;
    else if(kind==='contract'){
      const contract=(data.contracts||[]).find(item=>String(item.id)===String(targetId));
      location=contract?.establishment_id?`establishment:${contract.establishment_id}`:`contract:${targetId}`;
    }
    return {
      element:row,id:String(row.dataset.rowId),date:String(row.dataset.date),day:Number(row.dataset.day),rowOrder:Number(row.querySelector('.cj148-number b')?.textContent||0),
      driverId:driver.value,driverName:driver.selectedOptions[0]?.textContent?.replace(' • afastado','')||'',assignmentValue:value,assignmentLabel:assignment.selectedOptions[0]?.textContent||'',
      turn:turn.value,start:row.querySelector('[data-cj148-field="start_time"]').value,end:row.querySelector('[data-cj148-field="end_time"]').value,
      work:workMode(row),location,
    };
  }

  function msFor(date,time,nextDay=false){
    if(!/^\d{2}:\d{2}$/.test(time))return NaN;
    const parsed=new Date(`${date}T${time}:00`).getTime();return nextDay?parsed+86400000:parsed;
  }

  function calculateWarnings(data,rows){
    const map=new Map(rows.map(item=>[item.id,[]]));
    const summary=[];
    const groups=new Map();
    for(const row of rows.filter(item=>item.work&&item.driverId&&item.start&&item.end)){
      const key=`${row.driverId}:${row.date}`,list=groups.get(key)||[];list.push(row);groups.set(key,list);
    }
    const add=(row,text)=>{const list=map.get(row.id)||[];if(!list.includes(text))list.push(text);map.set(row.id,list)};
    for(const list of groups.values()){
      const first=list[0];
      const turns=new Map();const exact=new Map();
      for(const row of list){const t=turns.get(row.turn)||[];t.push(row);turns.set(row.turn,t);const key=`${row.start}-${row.end}`,e=exact.get(key)||[];e.push(row);exact.set(key,e)}
      for(const same of turns.values())if(same.length>1){const text=`${same.length} escalas no turno ${same[0].turn}`;same.forEach(row=>add(row,text));summary.push(`ATENÇÃO: ${first.driverName} está escalado ${same.length} vezes no turno ${same[0].turn} em ${dateBr(first.date)}.`)}
      for(const same of exact.values())if(same.length>1){const text=`${same.length} vezes no mesmo horário`;same.forEach(row=>add(row,text));summary.push(`ATENÇÃO: ${first.driverName} aparece ${same.length} vezes no horário ${same[0].start} às ${same[0].end} em ${dateBr(first.date)}.`)}
      list.sort((a,b)=>a.start.localeCompare(b.start));
      for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
        const a=list[i],b=list[j];
        const aStart=msFor(a.date,a.start),aEnd=msFor(a.date,a.end,a.end<=a.start),bStart=msFor(b.date,b.start),bEnd=msFor(b.date,b.end,b.end<=b.start);
        if([aStart,aEnd,bStart,bEnd].some(Number.isNaN))continue;
        const exactSame=a.start===b.start&&a.end===b.end;
        if(aStart<bEnd&&bStart<aEnd&&!exactSame){const minutes=Math.max(1,Math.round((Math.min(aEnd,bEnd)-Math.max(aStart,bStart))/60000));add(a,`Sobreposição de ${minutes} min`);add(b,`Sobreposição de ${minutes} min`);summary.push(`ATENÇÃO: ${b.driverName} tem escalas sobrepostas por ${minutes} min em ${dateBr(b.date)}.`)}
        if(bStart>=aEnd&&bStart-aEnd<=45*60000&&a.location&&b.location&&a.location!==b.location){const gap=Math.round((bStart-aEnd)/60000);const rowText=gap===0?'Sem tempo de deslocamento':`Só ${gap} min para deslocamento`;add(a,rowText);add(b,rowText);summary.push(gap===0?`ATENÇÃO: ${b.driverName} termina ${a.end} em ${a.assignmentLabel} e começa ${b.start} em ${b.assignmentLabel}, sem tempo de deslocamento.`:`ATENÇÃO: ${b.driverName} tem somente ${gap} min para sair de ${a.assignmentLabel} e chegar a ${b.assignmentLabel} em ${dateBr(b.date)}.`)}
      }
    }
    return {map,summary:[...new Set(summary)]};
  }

  function comparator(order){
    const turnRank={DIA:0,NOITE:1,MADRUGADA:2};
    if(order==='contract')return (a,b)=>byName(a.assignmentLabel,b.assignmentLabel)||a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||byName(a.driverName,b.driverName);
    if(order==='turn')return (a,b)=>(turnRank[a.turn]??9)-(turnRank[b.turn]??9)||a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||byName(a.assignmentLabel,b.assignmentLabel)||byName(a.driverName,b.driverName);
    if(order==='date')return (a,b)=>a.date.localeCompare(b.date)||(turnRank[a.turn]??9)-(turnRank[b.turn]??9)||a.start.localeCompare(b.start)||byName(a.assignmentLabel,b.assignmentLabel)||byName(a.driverName,b.driverName);
    return (a,b)=>byName(a.driverName,b.driverName)||a.date.localeCompare(b.date)||(turnRank[a.turn]??9)-(turnRank[b.turn]??9)||a.start.localeCompare(b.start)||byName(a.assignmentLabel,b.assignmentLabel);
  }

  function filterValues(){
    return {
      driver:document.getElementById('cj148-filter-driver')?.value||'',
      assignment:document.getElementById('cj148-filter-assignment')?.value||'',
      day:document.getElementById('cj148-filter-day')?.value||'',
      turn:document.getElementById('cj148-filter-turn')?.value||'',
      order:document.getElementById('cj148-order')?.value||'driver',
    };
  }

  function renderCounts(rows){
    const tbody=document.getElementById('cj148-counts-body');if(!tbody)return;
    const map=new Map(),drivers=new Set();let count=0;
    for(const row of rows.filter(item=>!item.element.hidden&&item.work)){
      const key=`${row.date}|${row.assignmentValue}|${row.start}|${row.end}`,entry=map.get(key)||{date:row.date,label:row.assignmentLabel,start:row.start,end:row.end,count:0,drivers:new Set()};entry.count+=1;entry.drivers.add(row.driverId);map.set(key,entry);drivers.add(row.driverId);count+=1;
    }
    document.getElementById('cj148-count-drivers').textContent=String(drivers.size);document.getElementById('cj148-count-rows').textContent=String(count);
    tbody.innerHTML=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||byName(a.label,b.label)||a.start.localeCompare(b.start)).map(item=>`<tr><td>${dateBr(item.date)}-${weekShort[Math.round((Date.parse(`${item.date}T12:00:00`)-Date.parse(`${runtime.matrix.week_start}T12:00:00`))/86400000)]}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.start)} às ${escapeHtml(item.end)}</td><td><strong>${item.count}</strong></td><td><strong>${item.drivers.size}</strong></td></tr>`).join('')||'<tr><td colspan="5" class="muted">Nenhuma escala nos filtros atuais.</td></tr>';
  }

  function applyView(data,{sort=true}={}){
    const values=filterValues();
    state.cache.cj148Order=values.order;
    const rows=[...document.querySelectorAll('.cj148-schedule-row')].map(row=>rowData(data,row));
    const warningData=calculateWarnings(data,rows);
    rows.forEach(item=>{
      const show=(!values.driver||item.driverId===values.driver)&&(!values.assignment||item.assignmentValue===values.assignment)&&(!values.day||String(item.day)===values.day)&&(!values.turn||item.turn===values.turn);
      item.element.hidden=!show;
      const warnings=warningData.map.get(item.id)||[];
      const warning=item.element.querySelector('.cj148-row-warning');
      warning.textContent=warnings.slice(0,2).join(' • ');warning.title=warnings.join('\n');warning.classList.toggle('has-warning',warnings.length>0);
    });
    const visible=rows.filter(item=>!item.element.hidden);
    if(sort){
      visible.sort(comparator(values.order));
      const hidden=rows.filter(item=>item.element.hidden);
      const tbody=document.getElementById('cj148-sheet-body');
      let previous='';
      for(const item of visible){const group=values.order==='contract'?item.assignmentLabel:values.order==='turn'?item.turn:values.order==='date'?item.date:item.driverName;item.element.classList.toggle('cj148-group-start',group!==previous);previous=group;tbody.appendChild(item.element)}
      hidden.forEach(item=>tbody.appendChild(item.element));
    }
    const warnings=document.getElementById('cj148-warnings');
    warnings.innerHTML=warningData.summary.length?warningData.summary.map(text=>`<div class="cj148-warning">${escapeHtml(text)}</div>`).join(''):'<div class="cj148-no-warning">Nenhum conflito ou falta de deslocamento detectado nesta semana.</div>';
    renderCounts(rows);
  }

  function allAssignmentFilter(data){
    return `<option value="">Todos os contratos e locais</option><option value="day_off">FOLGA</option>${workplaces(data).map(item=>`<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('')}`;
  }

  function statusHtml(data){
    return data.publication?.status==='published'
      ? `<div id="cj148-publication-status" class="cj148-publication-status published"><strong>ESCALA ENVIADA</strong><span>Publicada em ${data.publication.published_at?dateTime(data.publication.published_at):'data não informada'}.</span></div>`
      : '<div id="cj148-publication-status" class="cj148-publication-status draft"><strong>RASCUNHO</strong><span>Cada mudança válida é salva automaticamente. A escala ativa só muda ao clicar em Enviar escala.</span></div>';
  }

  async function exportCsv(data){
    try{await flushSaves(data);const rows=[...document.querySelectorAll('.cj148-schedule-row:not([hidden])')].map(row=>rowData(data,row));if(!rows.length)throw new Error('Não há escalas nos filtros atuais.');const header=['DATA','Nº','TURNO','HORÁRIOS','CONTRATO / LOCAL','COOPERADO','AVISO'];const lines=[header,...rows.map(item=>[`${dateBr(item.date)}-${weekShort[item.day]}`,item.rowOrder,item.turn,item.work?`${item.start} às ${item.end}`:item.assignmentLabel,item.assignmentLabel,item.driverName,item.element.querySelector('.cj148-row-warning').textContent||''])].map(columns=>columns.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(';'));const blob=new Blob([`\ufeff${lines.join('\r\n')}`],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`escala-${data.week_start}-a-${data.week_end}.csv`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);toast('Escala exportada para abrir no Excel.')}catch(error){toast(error.message,'error')}
  }

  async function printSchedule(data){
    try{await flushSaves(data);const rows=[...document.querySelectorAll('.cj148-schedule-row:not([hidden])')].map(row=>rowData(data,row));if(!rows.length)throw new Error('Não há escalas nos filtros atuais.');const win=window.open('','_blank','width=1200,height=800');if(!win)throw new Error('Permita a abertura da janela de impressão.');win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Escala ${escapeHtml(data.week_start)}</title><style>body{font-family:Arial,sans-serif;color:#12264d;padding:24px}header{display:flex;justify-content:space-between;align-items:end;margin-bottom:18px}h1{margin:0;color:#123f93}p{margin:4px 0;color:#53647e}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#123f93;color:#fff;text-align:left;padding:8px}td{border:1px solid #d7e0ec;padding:7px}tr:nth-child(even){background:#f7f9fc}.warning{color:#a23427;font-weight:bold}@page{size:landscape;margin:10mm}</style></head><body><header><div><h1>ESCALA DE TRABALHO</h1><p>${escapeHtml(state.user.cooperative_name||'ChegaJá')}</p><p>${dateBr(data.week_start)} a ${dateBr(data.week_end)}</p></div><strong>Ordem: ${escapeHtml(document.getElementById('cj148-order').selectedOptions[0].textContent)}</strong></header><table><thead><tr><th>DATA</th><th>Nº</th><th>TURNO</th><th>HORÁRIOS</th><th>CONTRATO / LOCAL</th><th>COOPERADO</th><th>AVISO</th></tr></thead><tbody>${rows.map(item=>`<tr><td>${dateBr(item.date)}-${weekShort[item.day]}</td><td>${item.rowOrder}</td><td>${escapeHtml(item.turn)}</td><td>${item.work?`${escapeHtml(item.start)} às ${escapeHtml(item.end)}`:escapeHtml(item.assignmentLabel)}</td><td>${escapeHtml(item.assignmentLabel)}</td><td>${escapeHtml(item.driverName)}</td><td class="warning">${escapeHtml(item.element.querySelector('.cj148-row-warning').textContent||'')}</td></tr>`).join('')}</tbody></table></body></html>`);win.document.close();win.focus();setTimeout(()=>win.print(),250)}catch(error){toast(error.message,'error')}
  }

  async function openSwaps(data){
    try{
      await flushSaves(data);
      const params=new URLSearchParams({from:data.week_start,to:data.week_end,order:'day'});
      const published=await api(`/api/app/schedule-grid?${params.toString()}`);
      state.cache.scheduleItems=(published.items||[]).filter(item=>(item.entry_type||'work')==='work'&&['scheduled','confirmed'].includes(item.status||'scheduled'));
      const base={drivers:data.drivers||[],establishments:visibleEstablishments(data),bases:data.bases||[],shifts:data.shifts||[]};
      if(!state.cache.scheduleItems.length)toast('Envie a escala antes de realizar trocas.','info');
      await globalThis.v8RenderSwaps(base,false);
    }catch(error){toast(error.message,'error')}
  }

  function bindDriverAdmin(data){
    document.querySelectorAll('[data-cj148-select-driver]').forEach(button=>button.addEventListener('click',()=>{runtime.selectedDriverId=String(button.dataset.cj148SelectDriver);updateSelectedDriverPanel(data)}));
    document.getElementById('cj148-driver-search')?.addEventListener('input',event=>{const query=String(event.target.value||'').trim().toLocaleLowerCase('pt-BR');document.querySelectorAll('[data-cj148-select-driver]').forEach(button=>button.hidden=Boolean(query&&!String(button.dataset.name||'').includes(query)))});
    bindSelectedDriverActions(data,selectedDriver(data));
  }

  async function renderSchedule(force=false){
    if(!isManager())return;
    const content=document.getElementById('page-content');if(!content)return;
    const requested=state.cache.cj148Week||state.cache.cj146Week||nextMonday();
    if(!force&&runtime.matrix&&runtime.matrix.week_start===monday(requested)&&document.getElementById('cj148-schedule-manager'))return;
    content.innerHTML='<section class="panel"><div class="empty"><strong>Carregando a escala semanal…</strong></div></section>';
    const data=await api(`/api/app/v21/schedule/matrix?week_start=${encodeURIComponent(requested)}`);
    runtime.matrix=data;state.cache.cj148Week=data.week_start;state.cache.cj146Week=data.week_start;
    selectedDriver(data);
    const rows=(data.rows||[]).map(row=>rowHtml(data,row)).join('');
    const exportButtons=isManager()?'<button class="btn" id="cj148-export">Exportar Excel</button><button class="btn" id="cj148-print">Imprimir / PDF</button>':'';
    content.innerHTML=`<section id="cj148-schedule-manager" class="cj148-schedule-manager"><header class="cj148-manager-header"><div><p class="eyebrow">ESCALA SEMANAL DA COOPERATIVA</p><h2>Planilha editável com 14 escalas por cooperado</h2><p>Escolha a ordem por cooperado, contrato/local, turno ou data. Ao escolher um contrato, estabelecimento ou Base, a linha permanece no lugar enquanto você seleciona um dos horários cadastrados especificamente para esse local.</p></div><div class="cj148-week-controls"><button class="btn" id="cj148-prev-week">← Semana anterior</button><label>Semana<input id="cj148-week" type="date" value="${escapeHtml(data.week_start)}"></label><button class="btn" id="cj148-next-week">Próxima semana →</button><button class="btn" id="cj148-refresh">Atualizar</button>${exportButtons}<button class="btn soft" id="cj148-swaps">Trocas</button><button class="btn primary" id="cj148-publish">Enviar escala</button></div></header>${statusHtml(data)}<div class="cj148-week-range"><strong>${dateBr(data.week_start)} a ${dateBr(data.week_end)}</strong><span>Ao abrir a semana atual ou a próxima semana ainda sem alterações, ela recebe uma cópia fiel da semana anterior — mesmos cooperados, dias, locais e horários, mudando somente as datas. Se ela já havia sido aberta apenas com FOLGAs automáticas, o sistema corrige e copia também. Cooperados novos entram com 14 linhas em FOLGA. A escala ativa só muda ao clicar em Enviar escala.</span></div>${returnAlerts(data)}${driverAdminHtml(data)}<section class="cj148-filters"><label>Cooperado<select id="cj148-filter-driver"><option value="">Todos os cooperados</option>${driverOptions(data,'')}</select></label><label>Contrato / local<select id="cj148-filter-assignment">${allAssignmentFilter(data)}</select></label><label>Dia / data<select id="cj148-filter-day"><option value="">Todos os dias</option>${weekDays.map((name,index)=>`<option value="${index}">${name} — ${dateBr(addDays(data.week_start,index))}</option>`).join('')}</select></label><label>Turno<select id="cj148-filter-turn"><option value="">Todos os turnos</option><option>DIA</option><option>NOITE</option><option>MADRUGADA</option></select></label><label>Ordenar a escala por<select id="cj148-order"><option value="driver">Ordem alfabética do cooperado</option><option value="contract">Ordem de contrato / local</option><option value="turn">Ordem de turno</option><option value="date">Ordem de dia / data</option></select></label><button class="btn" id="cj148-clear">Limpar filtros</button></section><section class="cj148-count-panel"><header><div><p class="eyebrow">QUANTIDADE POR CONTRATO E HORÁRIO</p><h3><span id="cj148-count-drivers">0</span> cooperados únicos • <span id="cj148-count-rows">0</span> escalas nos filtros</h3></div></header><div><table><thead><tr><th>Dia</th><th>Contrato / local</th><th>Horário</th><th>Escalas</th><th>Cooperados</th></tr></thead><tbody id="cj148-counts-body"></tbody></table></div></section><div id="cj148-warnings"></div><div class="cj148-sheet-wrap"><table class="cj148-sheet"><thead><tr><th>DATA</th><th>Nº</th><th>TURNO</th><th>HORÁRIOS</th><th>CONTRATO / LOCAL</th><th>COOPERADO</th><th>STATUS / AVISO</th><th>AÇÃO</th></tr></thead><tbody id="cj148-sheet-body">${rows||'<tr><td colspan="8" class="empty">Nenhum cooperado ativo.</td></tr>'}</tbody></table></div></section>`;
    document.getElementById('cj148-order').value=state.cache.cj148Order||'driver';
    bindRows(data);bindDriverAdmin(data);
    document.getElementById('cj148-week').addEventListener('change',event=>{state.cache.cj148Week=monday(event.target.value);renderSchedule(true)});
    document.getElementById('cj148-prev-week').addEventListener('click',()=>{state.cache.cj148Week=addDays(data.week_start,-7);renderSchedule(true)});
    document.getElementById('cj148-next-week').addEventListener('click',()=>{state.cache.cj148Week=addDays(data.week_start,7);renderSchedule(true)});
    document.getElementById('cj148-refresh').addEventListener('click',()=>renderSchedule(true));
    ['cj148-filter-driver','cj148-filter-assignment','cj148-filter-day','cj148-filter-turn','cj148-order'].forEach(id=>document.getElementById(id).addEventListener('change',()=>applyView(data)));
    document.getElementById('cj148-clear').addEventListener('click',()=>{['cj148-filter-driver','cj148-filter-assignment','cj148-filter-day','cj148-filter-turn'].forEach(id=>document.getElementById(id).value='');applyView(data)});
    document.getElementById('cj148-export')?.addEventListener('click',()=>exportCsv(data));
    document.getElementById('cj148-print')?.addEventListener('click',()=>printSchedule(data));
    document.getElementById('cj148-swaps').addEventListener('click',()=>openSwaps(data));
    document.getElementById('cj148-publish').addEventListener('click',async()=>{try{await flushSaves(data);if(!confirm(`Enviar a escala de ${dateBr(data.week_start)} a ${dateBr(data.week_end)}?\n\nSomente agora o rascunho substituirá a escala ativa.`))return;loading(true);const result=await api('/api/app/v21/schedule/publish',{method:'POST',body:{week_start:data.week_start}});toast(`${result.count} linhas enviadas com sucesso.`);if(result.warnings?.length)alert(result.warnings.join('\n\n'));await renderSchedule(true)}catch(error){alert(error.message);toast('Não foi possível enviar a escala.','error')}finally{loading(false)}});
    applyView(data);
  }

  async function renderContracts148(){
    if(!isManager())return;
    const content=document.getElementById('page-content');if(!content)return;
    content.innerHTML='<section class="panel"><div class="empty"><strong>Carregando contratos…</strong></div></section>';
    try{
      const [contractData,estData]=await Promise.all([api('/api/app/contracts'),api('/api/app/establishments')]);
      const items=contractData.items||[],establishments=estData.items||[];
      const canManage=state.user.role==='cooperative_admin';
      const actions=item=>`<button class="table-action primary" data-cj148-contract-hours="${item.id}">Horários</button>${canManage?`<button class="table-action" data-cj148-contract-edit="${item.id}">Editar</button><button class="table-action danger" data-cj148-contract-delete="${item.id}">Excluir</button>`:''}`;
      const list=table([{label:'Contrato',key:'name'},{label:'Estabelecimento',render:item=>escapeHtml(item.establishment_name||'Sem vínculo')},{label:'Código',render:item=>escapeHtml(item.code||'—')},{label:'Endereço de coleta',key:'pickup_address',wrap:true},{label:'Escalas vinculadas',key:'schedule_count'},{label:'Status',render:item=>badge(item.active?'active':'inactive')}],items,actions);
      content.innerHTML=`<section class="cj148-shifts-page"><header><div><p class="eyebrow">CONTRATOS DA COOPERATIVA</p><h2>Contratos e locais da escala</h2><p>Cadastre o contrato, vincule ao estabelecimento e depois configure quantos horários forem necessários para esse contrato.</p></div>${canManage?'<button class="btn primary" id="cj148-new-contract">+ Novo contrato</button>':''}</header><div class="notice"><strong>Os valores antigos por bairro continuam removidos.</strong><br>Esta tela serve para cadastro do contrato, vínculo com o estabelecimento e configuração dos horários usados na escala.</div>${panel('Contratos cadastrados',list)}</section>`;
      document.getElementById('cj148-new-contract')?.addEventListener('click',()=>contractForm({}, {...state.cache,establishments}));
      document.querySelectorAll('[data-cj148-contract-edit]').forEach(button=>button.addEventListener('click',()=>contractForm(items.find(item=>String(item.id)===String(button.dataset.cj148ContractEdit))||{}, {...state.cache,establishments})));
      document.querySelectorAll('[data-cj148-contract-delete]').forEach(button=>button.addEventListener('click',()=>removeEntity(`/api/app/contracts/${button.dataset.cj148ContractDelete}`,'Excluir este contrato?',renderContracts148)));
      document.querySelectorAll('[data-cj148-contract-hours]').forEach(button=>button.addEventListener('click',()=>{state.cache.cj148ShiftTarget=`contract:${button.dataset.cj148ContractHours}`;navigate('shifts')}));
    }catch(error){
      content.innerHTML=`<section class="panel"><div class="empty"><strong>Não foi possível carregar os contratos</strong><span>${escapeHtml(error.message||'Falha ao consultar os contratos.')}</span><button class="btn primary" id="cj148-retry-contracts">Tentar novamente</button></div></section>`;
      document.getElementById('cj148-retry-contracts')?.addEventListener('click',()=>renderContracts148());
      toast(error.message||'Não foi possível carregar os contratos.','error');
    }
  }

  async function renderShifts148(){
    if(!isManager())return;
    const content=document.getElementById('page-content');if(!content)return;
    content.innerHTML='<section class="panel"><div class="empty"><strong>Carregando contratos e horários…</strong><span>Consultando contratos, estabelecimentos e Base.</span></div></section>';
    try{
      const [shiftData,contractData,estData,baseData]=await Promise.all([api('/api/app/shift-templates'),api('/api/app/contracts'),api('/api/app/establishments'),api('/api/app/tenant/bases')]);
      const rawItems=shiftData.items||[],allContracts=(contractData.items||[]).filter(item=>Number(item.active??1)===1),establishments=(estData.items||[]).filter(item=>Number(item.active??1)===1),bases=(baseData.items||[]).filter(item=>Number(item.active??1)===1);
      const baseByVirtualEstablishment=new Map(bases.filter(item=>item.virtual_establishment_id).map(item=>[String(item.virtual_establishment_id),item]));
      const technicalContractToBase=new Map();
      allContracts.forEach(contract=>{const base=baseByVirtualEstablishment.get(String(contract.establishment_id||''));if(base&&String(contract.name||'').trim().toLocaleLowerCase('pt-BR')==='base')technicalContractToBase.set(String(contract.id),base)});
      const contracts=allContracts.filter(contract=>!technicalContractToBase.has(String(contract.id)));
      const items=rawItems.map(item=>{const base=baseByVirtualEstablishment.get(String(item.establishment_id||''))||technicalContractToBase.get(String(item.contract_id||''));return !item.base_id&&base?{...item,base_id:base.id,base_name:base.name,contract_id:null,contract_name:null,establishment_id:null,establishment_name:null}:item});
      const contractEstablishmentIds=new Set(contracts.map(item=>String(item.establishment_id||'')).filter(Boolean));
      const virtualBaseEstablishmentIds=new Set(bases.map(item=>String(item.virtual_establishment_id||'')).filter(Boolean));
      const standaloneEstablishments=establishments.filter(item=>!contractEstablishmentIds.has(String(item.id))&&!virtualBaseEstablishmentIds.has(String(item.id)));
      const targetLabel=item=>item.base_name?`BASE — ${item.base_name}`:item.contract_name?`CONTRATO — ${item.contract_name}${item.establishment_name?` — ${item.establishment_name}`:''}`:item.establishment_name?`ESTABELECIMENTO — ${item.establishment_name}`:'SEM LOCAL — horário antigo';
      const targetKey=item=>item.base_id?`base:${item.base_id}`:item.contract_id?`contract:${item.contract_id}`:item.establishment_id?`establishment:${item.establishment_id}`:'legacy';
      const countByTarget=new Map();items.forEach(item=>countByTarget.set(targetKey(item),(countByTarget.get(targetKey(item))||0)+1));
      const targets=[...bases.map(base=>({value:`base:${base.id}`,name:`BASE — ${base.name}`})),...contracts.map(contract=>({value:`contract:${contract.id}`,name:`CONTRATO — ${contract.name}${contract.establishment_name?` — ${contract.establishment_name}`:''}`})),...standaloneEstablishments.map(est=>({value:`establishment:${est.id}`,name:`ESTABELECIMENTO — ${est.name}`}))].sort((a,b)=>byName(a.name,b.name));
      const summary=`<section class="cj148-shift-summary"><article><strong>${targets.length}</strong><span>locais disponíveis</span></article><article><strong>${items.length}</strong><span>horários cadastrados</span></article><article><strong>${contracts.length}</strong><span>contratos ativos</span></article><article><strong>${bases.length}</strong><span>Base(s)</span></article></section>`;
      const targetCards=`<section class="cj148-shift-targets">${targets.map(target=>`<button type="button" data-cj148-new-for="${escapeHtml(target.value)}" class="${String(state.cache.cj148ShiftTarget||'')===String(target.value)?'selected':''}"><span>${escapeHtml(target.name)}</span><b>${countByTarget.get(target.value)||0} horário(s)</b><small>+ cadastrar horário</small></button>`).join('')||'<div class="empty">Cadastre uma Base, contrato ou estabelecimento antes de criar os horários.</div>'}</section>`;
      const list=table([{label:'Contrato / estabelecimento / Base',render:item=>escapeHtml(targetLabel(item))},{label:'Nome',key:'name'},{label:'Horário',render:item=>`<strong>${escapeHtml(item.start_time)} às ${escapeHtml(item.end_time)}</strong>`},{label:'Turno',key:'shift_label'},{label:'Status',render:item=>badge(item.active?'active':'inactive')}],items,item=>`<button class="table-action" data-cj148-edit-shift="${item.id}">Editar</button><button class="table-action danger" data-cj148-delete-shift="${item.id}">Excluir</button>`);
      content.innerHTML=`<section class="cj148-shifts-page"><header><div><p class="eyebrow">CONFIGURAÇÃO DA ESCALA</p><h2>Horários por contrato, estabelecimento ou Base</h2><p>Cadastre quantos horários forem necessários para cada local. Na escala, depois de escolher o contrato, estabelecimento ou Base, aparecerá somente o leque de horários pertencente a ele.</p></div><button class="btn primary" id="cj148-new-shift">+ Novo horário</button></header>${summary}<div class="notice"><strong>Vários horários por local:</strong> você pode cadastrar 11:00 às 15:00, 11:00 às 17:00, 17:00 às 22:00 e outros para o mesmo estabelecimento. Na escala, escolha o local e depois um desses horários.</div>${targetCards}${panel('Horários cadastrados',list)}</section>`;
      const open=(item={},preset='')=>{
        const current=preset||(item?.base_id?`base:${item.base_id}`:item?.contract_id?`contract:${item.contract_id}`:item?.establishment_id?`establishment:${item.establishment_id}`:'');
        if(!targets.length)return toast('Cadastre primeiro uma Base, contrato ou estabelecimento.','error');
        openModal(item?.id?'Editar horário':'Novo horário',`<form id="cj148-shift-form" class="form-grid"><label class="full">Contrato / estabelecimento / Base<select name="target_value" required><option value="">Selecione o local</option>${targets.map(target=>`<option value="${escapeHtml(target.value)}" ${target.value===current?'selected':''}>${escapeHtml(target.name)}</option>`).join('')}</select></label><label>Nome do horário<input name="name" required value="${escapeHtml(item?.name||'')}" placeholder="Ex.: Almoço 11 às 15"></label><label>Turno<select name="shift_label"><option ${item?.shift_label==='DIA'?'selected':''}>DIA</option><option ${item?.shift_label==='NOITE'?'selected':''}>NOITE</option><option ${item?.shift_label==='MADRUGADA'?'selected':''}>MADRUGADA</option></select></label><label>Hora inicial<input name="start_time" type="time" required value="${escapeHtml(item?.start_time||'')}"></label><label>Hora final<input name="end_time" type="time" required value="${escapeHtml(item?.end_time||'')}"></label><div class="form-actions full"><button type="button" class="btn" data-close-modal>Cancelar</button><button class="btn primary">Salvar horário</button></div></form>`);
        const form=document.getElementById('cj148-shift-form');
        form.onsubmit=async event=>{event.preventDefault();try{loading(true);const body=formObject(form),[targetType,targetId]=String(body.target_value).split(':');if(!['contract','establishment','base'].includes(targetType)||!targetId)throw new Error('Selecione um contrato, estabelecimento ou Base.');delete body.target_value;body.target_type=targetType;body.target_id=targetId;await api(`/api/app/shift-templates${item?.id?`/${item.id}`:''}`,{method:item?.id?'PUT':'POST',body});closeModal();state.cache.lgBaseKey='';toast('Horário salvo. Você pode cadastrar outros horários para o mesmo local.');await renderShifts148()}catch(error){toast(error.message,'error')}finally{loading(false)}};
      };
      document.getElementById('cj148-new-shift')?.addEventListener('click',()=>open({},state.cache.cj148ShiftTarget||''));
      document.querySelectorAll('[data-cj148-new-for]').forEach(button=>button.addEventListener('click',()=>open({},button.dataset.cj148NewFor)));
      document.querySelector('.cj148-shift-targets>button.selected')?.scrollIntoView({behavior:'smooth',block:'center'});
      document.querySelectorAll('[data-cj148-edit-shift]').forEach(button=>button.addEventListener('click',()=>open(items.find(item=>String(item.id)===String(button.dataset.cj148EditShift))||{})));
      document.querySelectorAll('[data-cj148-delete-shift]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Excluir este horário?'))return;try{loading(true);await api(`/api/app/shift-templates/${button.dataset.cj148DeleteShift}`,{method:'DELETE'});toast('Horário excluído.');await renderShifts148()}catch(error){toast(error.message,'error')}finally{loading(false)}}));
    }catch(error){
      content.innerHTML=`<section class="panel"><div class="empty"><strong>Não foi possível carregar os horários</strong><span>${escapeHtml(error.message||'Falha ao consultar contratos e locais.')}</span><button class="btn primary" id="cj148-retry-shifts">Tentar novamente</button></div></section>`;
      document.getElementById('cj148-retry-shifts')?.addEventListener('click',()=>renderShifts148());
      toast(error.message||'Não foi possível carregar os horários.','error');
    }
  }

  function installSwapUi(){
    globalThis.v8RespondSwap=async function(id,decision){try{const result=await api(`/api/app/schedule-swaps/${id}/respond`,{method:'POST',body:{decision}});toast(decision==='accepted'?'Troca realizada.':'Troca recusada.');if(result.warnings?.length)alert(result.warnings.join('\n\n'));pages.schedules()}catch(error){toast(error.message,'error')}};
    globalThis.v8RenderSwaps=async function(base,inline=false){
      try{
        const [list,options]=await Promise.all([api('/api/app/schedule-swaps'),state.user.role==='driver'?api('/api/app/schedule-swaps/options'):Promise.resolve({items:state.cache.scheduleItems||[]})]);
        const own=(options.items||[]).filter(item=>item.driver_id===state.user.driver_id),other=(options.items||[]).filter(item=>item.driver_id!==state.user.driver_id);
        const actions=state.user.role==='driver'?'<button class="btn primary" id="new-swap-request">Solicitar troca</button>':['cooperative_admin','dispatcher'].includes(state.user.role)?'<button class="btn primary" id="direct-swap">Trocar duas escalas</button>':'';
        const html=panel('Trocas de escala',table([{label:'Solicitante',key:'requester_name'},{label:'Escala do solicitante',render:item=>`${dateTime(item.source_start)} • ${escapeHtml(item.source_local)}`},{label:'Outro cooperado',key:'target_name'},{label:'Escala desejada',render:item=>`${dateTime(item.target_start)} • ${escapeHtml(item.target_local)}`},{label:'Status',render:item=>badge(item.status)}],list.items,item=>state.user.role==='driver'&&item.status==='pending'&&item.requested_to_driver_id===state.user.driver_id?`<button class="table-action primary" data-swap-accept="${item.id}">Aceitar</button><button class="table-action" data-swap-reject="${item.id}">Recusar</button>`:state.user.role==='driver'&&item.status==='pending'&&item.requested_by_driver_id===state.user.driver_id?`<button class="table-action" data-swap-cancel="${item.id}">Cancelar</button>`:''),actions);
        if(inline)document.getElementById('schedule-swaps-area').innerHTML=html;else openModal('Trocas de escala',html);
        document.getElementById('new-swap-request')?.addEventListener('click',()=>{openModal('Solicitar troca de turno',`<form id="swap-request-form" class="form-grid">${selectField('Minha escala','source_schedule_id',own.map(item=>({id:item.id,name:`${dateTime(item.start_at)} • ${item.local_name}`})),'','Selecione','required')}${selectField('Escala de outro cooperado','target_schedule_id',other.map(item=>({id:item.id,name:`${item.driver_name} • ${dateTime(item.start_at)} • ${item.local_name}`})),'','Selecione','required')}${textarea('Mensagem','message','Gostaria de trocar esta escala com você.')}${buttons('Enviar solicitação')}</form>`);document.getElementById('swap-request-form').onsubmit=async event=>{event.preventDefault();try{const result=await api('/api/app/schedule-swaps',{method:'POST',body:formObject(event.currentTarget)});if(result.action_required==='accept'&&result.request_id){if(!confirm('O outro cooperado já solicitou exatamente esta troca. Deseja aceitar agora?'))return toast('A solicitação original continua aguardando sua resposta.');const accepted=await api(`/api/app/schedule-swaps/${result.request_id}/respond`,{method:'POST',body:{decision:'accepted'}});if(accepted.warnings?.length)alert(accepted.warnings.join('\n\n'));closeModal();toast('Troca aceita. As duas escalas foram atualizadas.')}else{if(result.warnings?.length)alert(result.warnings.join('\n\n'));closeModal();toast(result.existing?'Esta troca já está aguardando resposta.':'Solicitação enviada ao outro cooperado.')}pages.schedules()}catch(error){toast(error.message,'error')}}});
        document.getElementById('direct-swap')?.addEventListener('click',()=>{const all=options.items||state.cache.scheduleItems||[];openModal('Trocar duas escalas',`<form id="direct-swap-form" class="form-grid">${selectField('Primeira escala','source_schedule_id',all.map(item=>({id:item.id,name:`${item.driver_name} • ${dateTime(item.start_at)} • ${item.local_name||item.base_name||item.establishment_name}`})),'','Selecione','required')}${selectField('Segunda escala','target_schedule_id',all.map(item=>({id:item.id,name:`${item.driver_name} • ${dateTime(item.start_at)} • ${item.local_name||item.base_name||item.establishment_name}`})),'','Selecione','required')}${buttons('Confirmar troca')}</form>`);document.getElementById('direct-swap-form').onsubmit=async event=>{event.preventDefault();try{const result=await api('/api/app/schedule-swaps/direct',{method:'POST',body:formObject(event.currentTarget)});closeModal();toast('Cooperados trocados nas duas escalas.');if(result.warnings?.length)alert(result.warnings.join('\n\n'));pages.schedules()}catch(error){toast(error.message,'error')}}});
        document.querySelectorAll('[data-swap-accept]').forEach(button=>button.addEventListener('click',()=>globalThis.v8RespondSwap(button.dataset.swapAccept,'accepted')));
        document.querySelectorAll('[data-swap-reject]').forEach(button=>button.addEventListener('click',()=>globalThis.v8RespondSwap(button.dataset.swapReject,'rejected')));
        document.querySelectorAll('[data-swap-cancel]').forEach(button=>button.addEventListener('click',async()=>{await api(`/api/app/schedule-swaps/${button.dataset.swapCancel}/cancel`,{method:'POST'});toast('Solicitação cancelada.');pages.schedules()}));
      }catch(error){toast(error.message,'error')}
    };
  }

  const previousSchedules=pages.schedules;
  pages.schedules=async function(...args){if(isManager())return renderSchedule(true);return previousSchedules.apply(this,args)};
  pages.contracts=renderContracts148;
  pages.shifts=renderShifts148;
  installSwapUi();
  window.ChegaJaV148={renderSchedule,renderShifts148};
})();
