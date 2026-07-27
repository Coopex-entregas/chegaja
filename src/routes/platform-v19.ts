import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { addressPoint, readAddressConfirmationToken } from '../lib/address';
import { routeBetween, routePrice, type AddressCandidate } from '../lib/maps';
import { assertRole, bodyJson, cleanText, id, nullableText, saoPauloDate, toCents } from '../lib/util';

export const platformV19Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

function tenant(c: Context<AppBindings>, roles: AuthUser['role'][]): AuthUser {
  const auth = c.get('auth');
  assertRole(auth, roles);
  if (!auth.cooperativeId) throw new Error('Cooperativa não vinculada.');
  return auth;
}
function validDate(value:string){ return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function validTime(value:string){ return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function addDays(date:string, days:number){ const d=new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function mondayOf(date:string){ const d=new Date(`${date}T12:00:00Z`); const day=d.getUTCDay(); d.setUTCDate(d.getUTCDate()-(day===0?6:day-1)); return d.toISOString().slice(0,10); }
function localIso(date:string,time:string,nextDay=false){ return `${nextDay?addDays(date,1):date}T${time}:00`; }
function onLeaveAt(driver:Row,date:string){
  if(Number(driver.on_leave||0)!==1)return false;
  const start=String(driver.leave_start_date||'');
  const end=String(driver.leave_return_date||'');
  return (!start||date>=start)&&(!end||date<end);
}
async function normalizeReturns(c:Context<AppBindings>, cooperativeId:string){
  await c.env.DB.prepare(`UPDATE drivers SET on_leave=0,leave_start_date=NULL,leave_reason=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE cooperative_id=? AND on_leave=1 AND leave_return_date IS NOT NULL AND date(leave_return_date)<=date('now','-3 hours')`).bind(cooperativeId).run();
}
async function blocked(c:Context<AppBindings>,cooperativeId:string,driverId:string,establishmentId:string|null){
  if(!establishmentId)return null;
  return c.env.DB.prepare(`SELECT reason FROM driver_establishment_blocks WHERE cooperative_id=? AND driver_id=? AND establishment_id=? AND active=1 LIMIT 1`)
    .bind(cooperativeId,driverId,establishmentId).first<Row>();
}
async function travelWarnings(c:Context<AppBindings>,cooperativeId:string,driverId:string,startAt:string,endAt:string,baseId:string|null,establishmentId:string|null,excludeId?:string){
  const params:any[]=[cooperativeId,driverId];
  let extra=''; if(excludeId){extra=' AND s.id<>?';params.push(excludeId);}
  const rows=await c.env.DB.prepare(`SELECT s.id,s.start_at,s.end_at,s.base_id,s.establishment_id,COALESCE(b.name,e.name,'Sem local') local_name
    FROM schedules s LEFT JOIN bases b ON b.id=s.base_id LEFT JOIN establishments e ON e.id=s.establishment_id
    WHERE s.cooperative_id=? AND s.driver_id=? AND s.deleted_at IS NULL AND s.status!='cancelled' AND COALESCE(s.entry_type,'work')='work' ${extra}
      AND (datetime(s.end_at) BETWEEN datetime(?,'-45 minutes') AND datetime(?) OR datetime(s.start_at) BETWEEN datetime(?) AND datetime(?,'+45 minutes'))
    ORDER BY s.start_at`).bind(...params,startAt,startAt,endAt,endAt).all<Row>();
  const warnings:string[]=[];
  for(const row of rows.results||[]){
    const same=(baseId&&row.base_id===baseId)||(establishmentId&&row.establishment_id===establishmentId);
    if(same)continue;
    const priorGap=(new Date(startAt).getTime()-new Date(row.end_at).getTime())/60000;
    const nextGap=(new Date(row.start_at).getTime()-new Date(endAt).getTime())/60000;
    if((priorGap>=0&&priorGap<45)||(nextGap>=0&&nextGap<45))warnings.push(`ATENÇÃO: há apenas ${Math.max(0,Math.round(priorGap>=0?priorGap:nextGap))} min entre esta escala e ${row.local_name}. Confira o tempo de deslocamento.`);
  }
  return [...new Set(warnings)];
}

// Cotação obrigatoriamente calculada do endereço confirmado do estabelecimento até o destino.
platformV19Routes.post('/v19/establishment/quote',async c=>{
  const auth=tenant(c,['establishment']); const body=await bodyJson<Row>(c);
  const establishment=await c.env.DB.prepare(`SELECT * FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(auth.establishmentId,auth.cooperativeId).first<Row>();
  if(!establishment)return c.json({ok:false,error:'Estabelecimento não encontrado.'},404);
  if(!establishment.address_confirmed||!establishment.address_json)return c.json({ok:false,error:'Confirme primeiro o endereço do estabelecimento.'},409);
  const raw=JSON.parse(establishment.address_json) as Row;
  const pickup:AddressCandidate={provider:raw.provider||'google',provider_id:raw.provider_id||establishment.address_place_id||'',formatted_address:raw.formatted_address||establishment.address,display_name:raw.formatted_address||establishment.address,street:raw.street||'',number:raw.number||'',neighborhood:raw.neighborhood||'',city:raw.city||establishment.city||'',state:raw.state||establishment.state||'',state_code:raw.state_code||establishment.state||'',postal_code:raw.postal_code||establishment.postal_code||'',country:raw.country||'Brasil',lat:Number(raw.latitude??establishment.latitude),lng:Number(raw.longitude??establishment.longitude),precision:raw.precision||'rooftop',exact_number:true,exact_city:true,exact_state:true};
  const destination=await readAddressConfirmationToken(c.env,body.delivery_confirmation_token);
  const route=await routeBetween(c.env,[addressPoint(pickup),addressPoint(destination)]);
  if(!route)return c.json({ok:false,error:'Não foi possível calcular a rota pelas ruas.'},400);
  const charge=routePrice(route.distance_meters,Number(establishment.rate_per_km_cents||0),Number(establishment.minimum_fee_cents||0),0);
  return c.json({ok:true,item:{charge_cents:charge,distance_meters:route.distance_meters,duration_seconds:route.duration_seconds,rate_per_km_cents:Number(establishment.rate_per_km_cents||0),minimum_fee_cents:Number(establishment.minimum_fee_cents||0)}});
});

platformV19Routes.get('/v19/schedule/rules',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']); await normalizeReturns(c,auth.cooperativeId!);
  const drivers=await c.env.DB.prepare(`SELECT id,name,status,online,on_leave,leave_start_date,leave_return_date,leave_reason,vehicle_plate,vehicle_model FROM drivers WHERE cooperative_id=? AND deleted_at IS NULL ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,name COLLATE NOCASE`).bind(auth.cooperativeId).all<Row>();
  const establishments=await c.env.DB.prepare(`SELECT id,name,address,active FROM establishments WHERE cooperative_id=? AND deleted_at IS NULL AND active=1 ORDER BY name COLLATE NOCASE`).bind(auth.cooperativeId).all<Row>();
  const bases=await c.env.DB.prepare(`SELECT id,name,address,active FROM bases WHERE cooperative_id=? AND deleted_at IS NULL AND active=1 ORDER BY name COLLATE NOCASE`).bind(auth.cooperativeId).all<Row>();
  const blocks=await c.env.DB.prepare(`SELECT b.driver_id,b.establishment_id,b.reason,e.name establishment_name FROM driver_establishment_blocks b JOIN establishments e ON e.id=b.establishment_id WHERE b.cooperative_id=? AND b.active=1 ORDER BY e.name`).bind(auth.cooperativeId).all<Row>();
  const returnAlerts=(drivers.results||[]).filter((d:Row)=>Number(d.on_leave||0)===1&&d.leave_return_date&&String(d.leave_return_date)>=saoPauloDate()&&String(d.leave_return_date)<=addDays(saoPauloDate(),7));
  return c.json({ok:true,drivers:drivers.results,establishments:establishments.results,bases:bases.results,blocks:blocks.results,return_alerts:returnAlerts});
});

platformV19Routes.put('/v19/drivers/:id/leave',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']); const body=await bodyJson<Row>(c);
  const driver=await c.env.DB.prepare(`SELECT * FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!driver)return c.json({ok:false,error:'Cooperado não encontrado.'},404);
  const active=body.on_leave===true||body.on_leave===1||body.on_leave==='1'||body.on_leave==='true';
  if(!active){await c.env.DB.prepare(`UPDATE drivers SET on_leave=0,leave_start_date=NULL,leave_return_date=NULL,leave_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(driver.id).run();return c.json({ok:true,on_leave:false});}
  const start=cleanText(body.leave_start_date||saoPauloDate(),10),ret=cleanText(body.leave_return_date,10),reason=nullableText(body.leave_reason,500);
  if(!validDate(start)||!validDate(ret)||ret<=start)return c.json({ok:false,error:'Informe início e retorno do afastamento. A data de retorno deve ser posterior ao início.'},400);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE drivers SET on_leave=1,leave_start_date=?,leave_return_date=?,leave_reason=?,online=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(start,ret,reason,driver.id),
    c.env.DB.prepare(`UPDATE schedules SET status='cancelled',notes=trim(COALESCE(notes,'') || ' • Cancelada automaticamente por afastamento.'),updated_at=CURRENT_TIMESTAMP WHERE cooperative_id=? AND driver_id=? AND deleted_at IS NULL AND status IN ('scheduled','confirmed') AND COALESCE(entry_type,'work')='work' AND date(start_at)>=date(?) AND date(start_at)<date(?)`).bind(auth.cooperativeId,driver.id,start,ret)
  ]);
  return c.json({ok:true,on_leave:true,leave_start_date:start,leave_return_date:ret});
});

platformV19Routes.put('/v19/drivers/:id/establishment-blocks',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']); const body=await bodyJson<Row>(c);
  const driver=await c.env.DB.prepare(`SELECT id FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!driver)return c.json({ok:false,error:'Cooperado não encontrado.'},404);
  const ids=Array.isArray(body.establishment_ids)?[...new Set(body.establishment_ids.map(String).filter(Boolean))].slice(0,500):[];
  const reason=nullableText(body.reason,500); const statements:D1PreparedStatement[]=[c.env.DB.prepare(`UPDATE driver_establishment_blocks SET active=0,updated_at=CURRENT_TIMESTAMP WHERE cooperative_id=? AND driver_id=?`).bind(auth.cooperativeId,driver.id)];
  for(const establishmentId of ids){
    const est=await c.env.DB.prepare(`SELECT id FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(establishmentId,auth.cooperativeId).first();
    if(!est)continue;
    statements.push(c.env.DB.prepare(`INSERT INTO driver_establishment_blocks(id,cooperative_id,driver_id,establishment_id,reason,active,created_by) VALUES (?,?,?,?,?,1,?) ON CONFLICT(driver_id,establishment_id) DO UPDATE SET reason=excluded.reason,active=1,updated_at=CURRENT_TIMESTAMP`).bind(id(),auth.cooperativeId,driver.id,establishmentId,reason,auth.id));
  }
  await c.env.DB.batch(statements); return c.json({ok:true,count:ids.length});
});

platformV19Routes.get('/v19/schedule/weekly',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']); await normalizeReturns(c,auth.cooperativeId!);
  const driverId=cleanText(c.req.query('driver_id'),100),week=mondayOf(cleanText(c.req.query('week_start')||saoPauloDate(),10));
  const driver=await c.env.DB.prepare(`SELECT id,name,status,on_leave,leave_start_date,leave_return_date,leave_reason FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(driverId,auth.cooperativeId).first<Row>();
  if(!driver)return c.json({ok:false,error:'Selecione um cooperado.'},404);
  const rows=await c.env.DB.prepare(`SELECT s.*,COALESCE(b.name,e.name) location_name FROM schedules s LEFT JOIN establishments e ON e.id=s.establishment_id LEFT JOIN bases b ON b.id=s.base_id WHERE s.cooperative_id=? AND s.driver_id=? AND s.deleted_at IS NULL AND date(s.start_at) BETWEEN date(?) AND date(?) ORDER BY s.start_at,s.created_at`).bind(auth.cooperativeId,driverId,week,addDays(week,6)).all<Row>();
  const grouped=new Map<string,Row[]>(); for(const row of rows.results||[]){const date=String(row.start_at).slice(0,10);const list=grouped.get(date)||[];list.push(row);grouped.set(date,list);}
  const slots:Row[]=[];
  for(let day=0;day<7;day++){
    const date=addDays(week,day),list=grouped.get(date)||[];
    for(let slot=1;slot<=2;slot++){
      const explicit=list.find(r=>Number(r.slot_index||0)===slot); const fallback=list.filter(r=>!r.slot_index)[slot-1]; const row=explicit||fallback;
      const leave=onLeaveAt(driver,date);
      slots.push(row?{date,day_index:day,slot_index:slot,entry_type:row.entry_type||'work',schedule:row}:{date,day_index:day,slot_index:slot,entry_type:leave?'leave':'day_off',schedule:null});
    }
  }
  return c.json({ok:true,week_start:week,week_end:addDays(week,6),driver,slots});
});

platformV19Routes.put('/v19/schedule/weekly-slot',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']); await normalizeReturns(c,auth.cooperativeId!); const body=await bodyJson<Row>(c);
  const driverId=cleanText(body.driver_id,100),date=cleanText(body.date,10),slotIndex=Number(body.slot_index),entryType=cleanText(body.entry_type||'work',30);
  if(!validDate(date)||![1,2].includes(slotIndex)||!['work','day_off','leave'].includes(entryType))return c.json({ok:false,error:'Espaço semanal inválido.'},400);
  const driver=await c.env.DB.prepare(`SELECT * FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(driverId,auth.cooperativeId).first<Row>();
  if(!driver||driver.status!=='active')return c.json({ok:false,error:'Cooperado inválido ou inativo.'},400);
  const week=mondayOf(date); let startTime=cleanText(body.start_time,5),endTime=cleanText(body.end_time,5),baseId:null|string=null,establishmentId:null|string=null,locationName='';
  if(entryType==='work'){
    if(onLeaveAt(driver,date))return c.json({ok:false,error:`${driver.name} está afastado nesta data e não pode receber escala.`},409);
    if(!validTime(startTime)||!validTime(endTime))return c.json({ok:false,error:'Informe hora inicial e final.'},400);
    baseId=nullableText(body.base_id,100); establishmentId=nullableText(body.establishment_id,100);
    if(baseId){const base=await c.env.DB.prepare(`SELECT id,name FROM bases WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(baseId,auth.cooperativeId).first<Row>();if(!base)return c.json({ok:false,error:'Base inválida.'},400);locationName=base.name;establishmentId=null;}
    else if(establishmentId){const est=await c.env.DB.prepare(`SELECT id,name FROM establishments WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(establishmentId,auth.cooperativeId).first<Row>();if(!est)return c.json({ok:false,error:'Estabelecimento inválido.'},400);locationName=est.name;const rule=await blocked(c,auth.cooperativeId!,driverId,establishmentId);if(rule)return c.json({ok:false,error:`${driver.name} está bloqueado em ${est.name}${rule.reason?`: ${rule.reason}`:''}.`},409);}
    else return c.json({ok:false,error:'Selecione o estabelecimento ou a Base.'},400);
  }else{startTime=slotIndex===1?'00:00':'12:00';endTime=slotIndex===1?'11:59':'23:59';}
  const startAt=localIso(date,startTime),endAt=localIso(date,endTime,endTime<=startTime),existing=await c.env.DB.prepare(`SELECT * FROM schedules WHERE cooperative_id=? AND driver_id=? AND week_start=? AND slot_index=? AND date(start_at)=date(?) AND deleted_at IS NULL LIMIT 1`).bind(auth.cooperativeId,driverId,week,slotIndex,date).first<Row>();
  if(entryType==='work'){
    const conflicts=await c.env.DB.prepare(`SELECT id FROM schedules WHERE cooperative_id=? AND driver_id=? AND deleted_at IS NULL AND status!='cancelled' AND COALESCE(entry_type,'work')='work' AND datetime(start_at)<datetime(?) AND datetime(end_at)>datetime(?) ${existing?'AND id<>?':''} LIMIT 1`).bind(...(existing?[auth.cooperativeId,driverId,endAt,startAt,existing.id]:[auth.cooperativeId,driverId,endAt,startAt])).first();
    if(conflicts)return c.json({ok:false,error:'Este cooperado já possui outra escala nesse horário.'},409);
  }
  const warnings=entryType==='work'?await travelWarnings(c,auth.cooperativeId!,driverId,startAt,endAt,baseId,establishmentId,existing?.id):[];
  const guaranteed=body.guaranteed_value!==undefined?Math.max(0,toCents(body.guaranteed_value)):Number(existing?.guaranteed_cents||0),notes=nullableText(body.notes,1000),scheduleId=existing?.id||id();
  if(existing)await c.env.DB.prepare(`UPDATE schedules SET establishment_id=?,base_id=?,start_at=?,end_at=?,status='scheduled',guaranteed_cents=?,notes=?,shift_label=?,entry_type=?,slot_index=?,week_start=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(establishmentId,baseId,startAt,endAt,guaranteed,notes,entryType==='work'?(cleanText(body.shift_label,100)||`TURNO ${slotIndex}`):(entryType==='day_off'?'FOLGA':'AFASTAMENTO'),entryType,slotIndex,week,scheduleId).run();
  else await c.env.DB.prepare(`INSERT INTO schedules(id,cooperative_id,establishment_id,driver_id,start_at,end_at,status,guaranteed_cents,notes,created_by,base_id,shift_label,entry_type,slot_index,week_start) VALUES (?,?,?,?,?,?,'scheduled',?,?,?,?,?,?,?,?)`).bind(scheduleId,auth.cooperativeId,establishmentId,driverId,startAt,endAt,guaranteed,notes,auth.id,baseId,entryType==='work'?(cleanText(body.shift_label,100)||`TURNO ${slotIndex}`):(entryType==='day_off'?'FOLGA':'AFASTAMENTO'),entryType,slotIndex,week).run();
  return c.json({ok:true,id:scheduleId,entry_type:entryType,location_name:locationName,warnings});
});

// -----------------------------------------------------------------------------
// Escala semanal 14.6: 14 linhas por cooperado, rascunho e publicação manual.
// As alterações ficam somente no rascunho até o administrador clicar em Enviar.
// -----------------------------------------------------------------------------
function dayDiffV20(week:string,date:string){
  return Math.round((Date.parse(`${date}T12:00:00Z`)-Date.parse(`${week}T12:00:00Z`))/86400000);
}
function rowKeyV20(templateDriverId:string,dayIndex:number,slotIndex:number){
  return `${templateDriverId}:${dayIndex}:${slotIndex}`;
}
function rowDateTimeV20(row:Row,field:'start_time'|'end_time'){
  const time=String(row[field]||'');
  if(!validTime(time))return null;
  const next=field==='end_time'&&String(row.end_time)<=String(row.start_time);
  return localIso(String(row.date),time,next);
}
async function matrixWarningsV20(rows:Row[]){
  const warnings:string[]=[];
  const byDriver=new Map<string,Row[]>();
  for(const row of rows){
    if(row.entry_type!=='work'||!row.driver_id)continue;
    const list=byDriver.get(String(row.driver_id))||[];list.push(row);byDriver.set(String(row.driver_id),list);
  }
  for(const list of byDriver.values()){
    list.sort((a,b)=>String(rowDateTimeV20(a,'start_time')||'').localeCompare(String(rowDateTimeV20(b,'start_time')||'')));
    for(let i=1;i<list.length;i++){
      const before=list[i-1],after=list[i],beforeEnd=rowDateTimeV20(before,'end_time'),afterStart=rowDateTimeV20(after,'start_time');
      if(!beforeEnd||!afterStart)continue;
      const gap=(new Date(afterStart).getTime()-new Date(beforeEnd).getTime())/60000;
      const samePlace=before.establishment_id&&after.establishment_id&&before.establishment_id===after.establishment_id;
      if(!samePlace&&gap<45){
        const driver=after.driver_name||before.driver_name||'Cooperado';
        const first=before.contract_name||before.location_name||'local anterior';
        const second=after.contract_name||after.location_name||'próximo local';
        if(gap<0)warnings.push(`ATENÇÃO: ${driver} possui horários sobrepostos em ${after.date}: ${first} e ${second} conflitam por ${Math.abs(Math.round(gap))} min. A escala foi mantida, mas precisa ser conferida.`);
        else warnings.push(`ATENÇÃO: ${driver} tem somente ${Math.round(gap)} min entre ${first} e ${second} em ${after.date}. A escala foi mantida; confira o deslocamento.`);
      }
    }
  }
  return [...new Set(warnings)];
}
async function loadScheduleMatrixV20(c:Context<AppBindings>,cooperativeId:string,weekInput:string){
  await normalizeReturns(c,cooperativeId);
  const week=mondayOf(validDate(weekInput)?weekInput:saoPauloDate());
  const [driversResult,contractsResult,shiftsResult,establishmentsResult,basesResult,draftsResult,publishedResult,blocksResult,publication]=await Promise.all([
    c.env.DB.prepare(`SELECT id,name,status,on_leave,leave_start_date,leave_return_date,leave_reason,vehicle_plate,vehicle_model FROM drivers WHERE cooperative_id=? AND deleted_at IS NULL AND status='active' ORDER BY name COLLATE NOCASE`).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`SELECT ct.id,ct.name,ct.establishment_id,e.name establishment_name FROM contracts ct LEFT JOIN establishments e ON e.id=ct.establishment_id WHERE ct.cooperative_id=? AND ct.active=1 AND ct.deleted_at IS NULL ORDER BY ct.name COLLATE NOCASE`).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`SELECT id,name,start_time,end_time,shift_label FROM shift_templates WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL ORDER BY start_time,name COLLATE NOCASE`).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`SELECT id,name,address FROM establishments WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`SELECT id,name,address FROM bases WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`SELECT d.*,ct.name contract_name,e.name establishment_name,st.name shift_name FROM schedule_week_drafts d LEFT JOIN contracts ct ON ct.id=d.contract_id LEFT JOIN establishments e ON e.id=d.establishment_id LEFT JOIN shift_templates st ON st.id=d.shift_template_id WHERE d.cooperative_id=? AND d.week_start=?`).bind(cooperativeId,week).all<Row>(),
    c.env.DB.prepare(`SELECT s.*,ct.name contract_name,e.name establishment_name,st.name shift_name FROM schedules s LEFT JOIN contracts ct ON ct.id=s.contract_id LEFT JOIN establishments e ON e.id=s.establishment_id LEFT JOIN shift_templates st ON st.id=s.shift_template_id WHERE s.cooperative_id=? AND s.deleted_at IS NULL AND s.status!='cancelled' AND date(s.start_at) BETWEEN date(?) AND date(?) AND (s.publication_week_start=? OR s.week_start=?) ORDER BY s.start_at,s.created_at`).bind(cooperativeId,week,addDays(week,6),week,week).all<Row>(),
    c.env.DB.prepare(`SELECT driver_id,establishment_id,reason FROM driver_establishment_blocks WHERE cooperative_id=? AND active=1`).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`SELECT * FROM schedule_week_publications WHERE cooperative_id=? AND week_start=? LIMIT 1`).bind(cooperativeId,week).first<Row>()
  ]);
  const drivers=driversResult.results||[],driverMap=new Map(drivers.map(d=>[String(d.id),d]));
  const draftMap=new Map<string,Row>();
  for(const draft of draftsResult.results||[])draftMap.set(rowKeyV20(String(draft.template_driver_id),Number(draft.day_index),Number(draft.slot_index)),draft);
  const publishedMap=new Map<string,Row>();
  for(const item of publishedResult.results||[]){
    const date=String(item.start_at||'').slice(0,10),day=dayDiffV20(week,date),slot=Number(item.slot_index||0),template=String(item.template_driver_id||item.driver_id||'');
    if(day>=0&&day<=6&&[1,2].includes(slot)&&template)publishedMap.set(rowKeyV20(template,day,slot),item);
  }
  const rows:Row[]=[];
  for(const templateDriver of drivers){
    for(let day=0;day<7;day++)for(let slot=1;slot<=2;slot++){
      const key=rowKeyV20(String(templateDriver.id),day,slot),date=addDays(week,day),draft=draftMap.get(key),published=publishedMap.get(key);
      let row:Row;
      if(draft){
        row={...draft,date,source:'draft'};
      }else if(published){
        row={...published,date,day_index:day,slot_index:slot,template_driver_id:templateDriver.id,driver_id:published.driver_id||templateDriver.id,entry_type:published.entry_type||'work',start_time:String(published.start_at||'').slice(11,16),end_time:String(published.end_at||'').slice(11,16),source:'published'};
      }else{
        const leave=onLeaveAt(templateDriver,date);
        row={id:null,cooperative_id:cooperativeId,week_start:week,template_driver_id:templateDriver.id,driver_id:templateDriver.id,date,day_index:day,slot_index:slot,entry_type:leave?'leave':'day_off',contract_id:null,establishment_id:null,shift_template_id:null,start_time:slot===1?'08:00':'13:00',end_time:slot===1?'12:00':'17:00',shift_label:leave?'AFASTADO':'FOLGA',guaranteed_cents:0,notes:null,source:'default'};
      }
      const assigned=driverMap.get(String(row.driver_id))||templateDriver;
      row.template_driver_name=templateDriver.name;row.driver_name=assigned?.name||templateDriver.name;
      if(onLeaveAt(assigned,date)){
        row={...row,entry_type:'leave',contract_id:null,establishment_id:null,shift_template_id:null,start_time:slot===1?'00:00':'12:00',end_time:slot===1?'11:59':'23:59',shift_label:'AFASTADO',leave_conflict:true};
        row.template_driver_name=templateDriver.name;row.driver_name=assigned?.name||templateDriver.name;
      }
      rows.push(row);
    }
  }
  const today=saoPauloDate();
  const returnAlerts=drivers.filter(d=>Number(d.on_leave||0)===1&&d.leave_return_date&&String(d.leave_return_date)>=today&&String(d.leave_return_date)<=addDays(today,7));
  return {week_start:week,week_end:addDays(week,6),drivers,contracts:contractsResult.results||[],shifts:shiftsResult.results||[],establishments:establishmentsResult.results||[],bases:basesResult.results||[],blocks:blocksResult.results||[],publication:publication||{status:'draft',published_at:null},return_alerts:returnAlerts,rows,warnings:await matrixWarningsV20(rows)};
}

platformV19Routes.get('/v20/schedule/matrix',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);
  const data=await loadScheduleMatrixV20(c,auth.cooperativeId!,cleanText(c.req.query('week_start')||'',10));
  return c.json({ok:true,...data});
});

platformV19Routes.put('/v20/schedule/draft-slot',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']); const body=await bodyJson<Row>(c);
  const week=mondayOf(cleanText(body.week_start||body.date||saoPauloDate(),10)),date=cleanText(body.date,10),dayIndex=Number(body.day_index),slotIndex=Number(body.slot_index);
  const templateDriverId=cleanText(body.template_driver_id,100),driverId=cleanText(body.driver_id||templateDriverId,100),entryType=cleanText(body.entry_type||'day_off',20);
  if(!validDate(date)||date!==addDays(week,dayIndex)||dayIndex<0||dayIndex>6||![1,2].includes(slotIndex)||!['work','day_off','leave'].includes(entryType))return c.json({ok:false,error:'Linha semanal inválida.'},400);
  const [templateDriver,assignedDriver]=await Promise.all([
    c.env.DB.prepare(`SELECT * FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL AND status='active'`).bind(templateDriverId,auth.cooperativeId).first<Row>(),
    c.env.DB.prepare(`SELECT * FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL AND status='active'`).bind(driverId,auth.cooperativeId).first<Row>()
  ]);
  if(!templateDriver||!assignedDriver)return c.json({ok:false,error:'Cooperado inválido ou inativo.'},400);
  let contractId:null|string=null,establishmentId:null|string=null,shiftTemplateId:null|string=null,startTime=cleanText(body.start_time,5),endTime=cleanText(body.end_time,5),shiftLabel=nullableText(body.shift_label,100);
  if(entryType==='work'){
    if(onLeaveAt(assignedDriver,date))return c.json({ok:false,error:`${assignedDriver.name} está afastado em ${date} e não pode receber contrato.`},409);
    contractId=nullableText(body.contract_id,100);if(!contractId)return c.json({ok:false,error:'Selecione um contrato ou marque Folga.'},400);
    const contract=await c.env.DB.prepare(`SELECT id,name,establishment_id FROM contracts WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(contractId,auth.cooperativeId).first<Row>();
    if(!contract)return c.json({ok:false,error:'Contrato inválido.'},400); establishmentId=contract.establishment_id||null;
    const block=await blocked(c,auth.cooperativeId!,driverId,establishmentId);if(block)return c.json({ok:false,error:`${assignedDriver.name} está bloqueado neste estabelecimento${block.reason?`: ${block.reason}`:''}.`},409);
    shiftTemplateId=nullableText(body.shift_template_id,100);
    if(shiftTemplateId){const shift=await c.env.DB.prepare(`SELECT * FROM shift_templates WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL`).bind(shiftTemplateId,auth.cooperativeId).first<Row>();if(!shift)return c.json({ok:false,error:'Horário inválido.'},400);if(!validTime(startTime))startTime=String(shift.start_time);if(!validTime(endTime))endTime=String(shift.end_time);if(!shiftLabel)shiftLabel=shift.shift_label||shift.name;}
    if(!validTime(startTime)||!validTime(endTime))return c.json({ok:false,error:'Informe o horário inicial e final.'},400);
    if(!shiftLabel)shiftLabel=contract.name;
  }else{
    contractId=null;establishmentId=null;shiftTemplateId=null;startTime=slotIndex===1?'00:00':'12:00';endTime=slotIndex===1?'11:59':'23:59';shiftLabel=entryType==='leave'?'AFASTADO':'FOLGA';
  }
  const draftId=id(),guaranteed=Math.max(0,toCents(body.guaranteed_value||0)),notes=nullableText(body.notes,1000);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO schedule_week_drafts(id,cooperative_id,week_start,template_driver_id,driver_id,day_index,slot_index,entry_type,contract_id,establishment_id,shift_template_id,start_time,end_time,shift_label,guaranteed_cents,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cooperative_id,week_start,template_driver_id,day_index,slot_index) DO UPDATE SET driver_id=excluded.driver_id,entry_type=excluded.entry_type,contract_id=excluded.contract_id,establishment_id=excluded.establishment_id,shift_template_id=excluded.shift_template_id,start_time=excluded.start_time,end_time=excluded.end_time,shift_label=excluded.shift_label,guaranteed_cents=excluded.guaranteed_cents,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP`).bind(draftId,auth.cooperativeId,week,templateDriverId,driverId,dayIndex,slotIndex,entryType,contractId,establishmentId,shiftTemplateId,startTime,endTime,shiftLabel,guaranteed,notes,auth.id),
    c.env.DB.prepare(`INSERT INTO schedule_week_publications(id,cooperative_id,week_start,status) VALUES (?,?,?,'draft') ON CONFLICT(cooperative_id,week_start) DO UPDATE SET status='draft',updated_at=CURRENT_TIMESTAMP`).bind(id(),auth.cooperativeId,week)
  ]);
  const matrix=await loadScheduleMatrixV20(c,auth.cooperativeId!,week);
  return c.json({ok:true,status:'draft',warnings:matrix.warnings});
});

platformV19Routes.post('/v20/schedule/publish',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']); const body=await bodyJson<Row>(c),week=mondayOf(cleanText(body.week_start||saoPauloDate(),10));
  const matrix=await loadScheduleMatrixV20(c,auth.cooperativeId!,week),drivers=new Map((matrix.drivers||[]).map((d:Row)=>[String(d.id),d])),contracts=new Map((matrix.contracts||[]).map((x:Row)=>[String(x.id),x]));
  if(!(matrix.drivers||[]).length)return c.json({ok:false,error:'Não existem cooperados ativos para montar a escala.'},400);
  const statements:D1PreparedStatement[]=[c.env.DB.prepare(`UPDATE schedules SET status='cancelled',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE cooperative_id=? AND deleted_at IS NULL AND status!='cancelled' AND slot_index IN (1,2) AND (publication_week_start=? OR week_start=?)`).bind(auth.cooperativeId,week,week)];
  const errors:string[]=[];
  for(const row of matrix.rows as Row[]){
    const template=drivers.get(String(row.template_driver_id)),assigned=drivers.get(String(row.driver_id));if(!template||!assigned){errors.push('Há uma linha com cooperado inativo.');continue;}
    let entryType=String(row.entry_type||'day_off'),contractId:null|string=null,establishmentId:null|string=null,shiftTemplateId:null|string=null,startTime=String(row.start_time||''),endTime=String(row.end_time||''),label='';
    if(entryType==='work'){
      if(onLeaveAt(assigned,String(row.date))){errors.push(`${assigned.name} está afastado em ${row.date}.`);continue;}
      const contract=contracts.get(String(row.contract_id||''));if(!contract){errors.push(`Selecione o contrato de ${assigned.name} em ${row.date}, espaço ${row.slot_index}.`);continue;}
      contractId=String(contract.id);establishmentId=contract.establishment_id||null;shiftTemplateId=row.shift_template_id||null;
      const block=await blocked(c,auth.cooperativeId!,String(assigned.id),establishmentId);if(block){errors.push(`${assigned.name} está bloqueado em ${contract.establishment_name||contract.name}${block.reason?`: ${block.reason}`:''}.`);continue;}
      if(!validTime(startTime)||!validTime(endTime)){errors.push(`Horário inválido para ${assigned.name} em ${row.date}.`);continue;}
      label=String(row.shift_label||contract.name||`TURNO ${row.slot_index}`);
    }else{
      entryType=entryType==='leave'?'leave':'day_off';startTime=Number(row.slot_index)===1?'00:00':'12:00';endTime=Number(row.slot_index)===1?'11:59':'23:59';label=entryType==='leave'?'AFASTADO':'FOLGA';
    }
    const startAt=localIso(String(row.date),startTime),endAt=localIso(String(row.date),endTime,endTime<=startTime);
    statements.push(c.env.DB.prepare(`INSERT INTO schedules(id,cooperative_id,establishment_id,driver_id,start_at,end_at,status,guaranteed_cents,notes,created_by,base_id,contract_id,shift_template_id,shift_label,entry_type,slot_index,week_start,template_driver_id,publication_week_start) VALUES (?,?,?,?,?,?,'scheduled',?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id(),auth.cooperativeId,establishmentId,assigned.id,startAt,endAt,Math.max(0,Number(row.guaranteed_cents||0)),nullableText(row.notes,1000),auth.id,null,contractId,shiftTemplateId,label,entryType,Number(row.slot_index),week,template.id,week));
  }
  if(errors.length)return c.json({ok:false,error:errors.slice(0,12).join('\n')},409);
  statements.push(c.env.DB.prepare(`INSERT INTO schedule_week_publications(id,cooperative_id,week_start,status,published_at,published_by) VALUES (?,?,?,'published',CURRENT_TIMESTAMP,?) ON CONFLICT(cooperative_id,week_start) DO UPDATE SET status='published',published_at=CURRENT_TIMESTAMP,published_by=excluded.published_by,updated_at=CURRENT_TIMESTAMP`).bind(id(),auth.cooperativeId,week,auth.id));
  await c.env.DB.batch(statements);
  return c.json({ok:true,status:'published',count:matrix.rows.length,warnings:matrix.warnings,published_at:new Date().toISOString()});
});
