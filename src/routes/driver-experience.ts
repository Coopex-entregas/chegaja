import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { audit } from '../lib/audit';
import { parseImageDataUrl, saveBrandingAsset } from '../lib/branding';
import { refreshCooperativeCompliance, refreshDriverCompliance } from '../lib/compliance';
import { verifyPassword } from '../lib/crypto';
import { navigationRoute } from '../lib/maps';
import { assertRole, bodyJson, cleanText, id, nullableText, saoPauloDate } from '../lib/util';

export const driverExperienceRoutes = new Hono<AppBindings>();
type Row = Record<string, any>;

function tenant(c: Context<AppBindings>, roles: AuthUser['role'][]) {
  const auth=c.get('auth');assertRole(auth,roles);if(!auth.cooperativeId)throw new Error('Cooperativa não vinculada.');return auth;
}
function validDate(value: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value||'')); }
function clampPeriod(value: string | undefined, fallback: string) { return validDate(value) ? String(value) : fallback; }
function dataUrl(row: Row | null | undefined) { return row?.data_base64 ? `data:${row.mime_type||'image/webp'};base64,${row.data_base64}` : null; }
function parseTags(value: unknown): string[] { try { const out=JSON.parse(String(value||'[]')); return Array.isArray(out)?out.map(String):[]; } catch { return []; } }
function scoreByHundredth(items: Row[], field: string) {
  let score=5;
  for(const item of [...items].reverse()){
    const value=Number(item[field]);if(!Number.isFinite(value))continue;
    score=Math.max(1,Math.min(5,score+(value===5?0.01:-0.01)));
    score=Math.round(score*100)/100;
  }
  return score;
}
function escapeHtml(value: unknown) { return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!)); }

driverExperienceRoutes.get('/v18/driver/profile',async c=>{
  const auth=tenant(c,['driver']);await refreshDriverCompliance(c.env,auth.driverId!);
  const item=await c.env.DB.prepare(`SELECT d.id,d.name,d.cpf,d.email,d.phone,d.vehicle_plate,d.vehicle_model,d.status,d.photo_url,
    d.cnh_number,d.cnh_expires_at,d.vehicle_document_number,d.vehicle_document_expires_at,d.compliance_status,d.compliance_suspended,
    d.compliance_override_until,d.compliance_override_reason,u.username,u.email access_email,c.name cooperative_name,
    COALESCE(c.support_email,c.email) support_email,c.driver_compliance_required
    FROM drivers d JOIN users u ON u.driver_id=d.id AND u.id=? JOIN cooperatives c ON c.id=d.cooperative_id
    WHERE d.id=? AND d.cooperative_id=? AND d.deleted_at IS NULL LIMIT 1`).bind(auth.id,auth.driverId,auth.cooperativeId).first<Row>();
  if(!item)return c.json({ok:false,error:'Perfil do cooperado não encontrado.'},404);
  const pendingPhoto=await c.env.DB.prepare(`SELECT r.*,a.mime_type,a.data_base64 FROM driver_photo_requests r LEFT JOIN branding_assets a ON a.entity_type='driver_pending' AND a.entity_id=r.id WHERE r.driver_id=? AND r.status='pending' ORDER BY r.created_at DESC LIMIT 1`).bind(auth.driverId).first<Row>();
  const pendingDocuments=await c.env.DB.prepare(`SELECT * FROM driver_document_submissions WHERE driver_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1`).bind(auth.driverId).first<Row>();
  return c.json({ok:true,item,pending_photo:pendingPhoto?{...pendingPhoto,preview_data_url:dataUrl(pendingPhoto),data_base64:undefined}:null,pending_documents:pendingDocuments});
});

driverExperienceRoutes.post('/v18/driver/profile/photo',async c=>{
  const auth=tenant(c,['driver']),body=await bodyJson<Row>(c);parseImageDataUrl(body.data_url);
  const requestId=id(),current=await c.env.DB.prepare(`SELECT photo_url FROM drivers WHERE id=? AND cooperative_id=?`).bind(auth.driverId,auth.cooperativeId).first<Row>();
  await c.env.DB.prepare(`UPDATE driver_photo_requests SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='pending'`).bind(auth.driverId).run();
  await c.env.DB.prepare(`INSERT INTO driver_photo_requests(id,cooperative_id,driver_id,current_photo_url) VALUES (?,?,?,?)`).bind(requestId,auth.cooperativeId,auth.driverId,current?.photo_url||null).run();
  await saveBrandingAsset(c.env,'driver_pending',requestId,body.data_url);
  await audit(c,'driver.photo.requested','driver_photo_request',requestId,null,{driver_id:auth.driverId},auth.cooperativeId);
  return c.json({ok:true,id:requestId,message:'Nova foto enviada. A foto atual continuará visível até a cooperativa aprovar a troca.'},201);
});

driverExperienceRoutes.post('/v18/driver/profile/documents',async c=>{
  const auth=tenant(c,['driver']),body=await bodyJson<Row>(c),cnh=cleanText(body.cnh_number,40),cnhDate=cleanText(body.cnh_expires_at,10),vehicle=cleanText(body.vehicle_document_number,60),vehicleDate=cleanText(body.vehicle_document_expires_at,10);
  if(cnh.length<4||vehicle.length<4||!validDate(cnhDate)||!validDate(vehicleDate))return c.json({ok:false,error:'Informe os números e as datas de validade da CNH e do documento da moto.'},400);
  const requestId=id();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE driver_document_submissions SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND status='pending'`).bind(auth.driverId),
    c.env.DB.prepare(`INSERT INTO driver_document_submissions(id,cooperative_id,driver_id,cnh_number,cnh_expires_at,vehicle_document_number,vehicle_document_expires_at) VALUES (?,?,?,?,?,?,?)`).bind(requestId,auth.cooperativeId,auth.driverId,cnh,cnhDate,vehicle,vehicleDate)
  ]);
  await audit(c,'driver.documents.requested','driver_document_submission',requestId,null,{driver_id:auth.driverId,cnh_expires_at:cnhDate,vehicle_document_expires_at:vehicleDate},auth.cooperativeId);
  return c.json({ok:true,id:requestId,message:'Dados enviados para aprovação da cooperativa.'},201);
});

driverExperienceRoutes.put('/v18/driver/access',async c=>{
  const auth=tenant(c,['driver']),body=await bodyJson<Row>(c),username=cleanText(body.username,50).toLowerCase(),password=String(body.current_password||'');
  if(!/^[a-z0-9._-]{3,50}$/.test(username))return c.json({ok:false,error:'O usuário deve ter de 3 a 50 caracteres e usar apenas letras, números, ponto, traço ou sublinhado.'},400);
  const user=await c.env.DB.prepare(`SELECT password_hash,password_salt FROM users WHERE id=?`).bind(auth.id).first<Row>();
  if(!user||!(await verifyPassword(password,user.password_salt,user.password_hash)))return c.json({ok:false,error:'Senha atual incorreta.'},400);
  const duplicate=await c.env.DB.prepare(`SELECT id FROM users WHERE lower(username)=? AND id<>? AND deleted_at IS NULL LIMIT 1`).bind(username,auth.id).first();
  if(duplicate)return c.json({ok:false,error:'Este nome de usuário já está sendo usado.'},409);
  await c.env.DB.prepare(`UPDATE users SET username=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(username,auth.id).run();
  await audit(c,'username.changed','user',auth.id,null,{username},auth.cooperativeId);
  return c.json({ok:true,message:'Nome de usuário atualizado.'});
});

driverExperienceRoutes.get('/v18/driver/schedule',async c=>{
  const auth=tenant(c,['driver']),today=saoPauloDate(),defaultFrom=`${today.slice(0,7)}-01`,defaultTo=(()=>{const d=new Date(`${today}T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+2,0);return d.toISOString().slice(0,10)})(),from=clampPeriod(c.req.query('from'),defaultFrom),to=clampPeriod(c.req.query('to'),defaultTo);
  const rows=await c.env.DB.prepare(`SELECT s.id,s.start_at,s.end_at,s.shift_label,s.status,s.guaranteed_cents,s.notes,
    e.name establishment_name,e.address establishment_address,b.name base_name,b.address base_address,ct.name contract_name
    FROM schedules s LEFT JOIN establishments e ON e.id=s.establishment_id LEFT JOIN bases b ON b.id=s.base_id LEFT JOIN contracts ct ON ct.id=s.contract_id
    WHERE s.cooperative_id=? AND s.driver_id=? AND s.deleted_at IS NULL AND date(s.start_at) BETWEEN date(?) AND date(?) ORDER BY s.start_at`).bind(auth.cooperativeId,auth.driverId,from,to).all<Row>();
  return c.json({ok:true,from,to,items:rows.results});
});

driverExperienceRoutes.get('/v18/driver/history',async c=>{
  const auth=tenant(c,['driver']),today=saoPauloDate(),defaultFrom=`${today.slice(0,7)}-01`,from=clampPeriod(c.req.query('from'),defaultFrom),to=clampPeriod(c.req.query('to'),today),status=cleanText(c.req.query('status'),30);
  let sql=`SELECT d.id,d.display_code,d.created_at,d.delivered_at,d.status,d.pickup_address,d.delivery_address,d.distance_meters,d.duration_seconds,d.driver_earnings_cents,d.driver_gross_cents,d.driver_net_cents,d.charge_cents,e.name establishment_name,b.name base_name
    FROM deliveries d JOIN establishments e ON e.id=d.establishment_id LEFT JOIN bases b ON b.id=d.base_id WHERE d.cooperative_id=? AND d.assigned_driver_id=? AND d.deleted_at IS NULL AND date(d.created_at,'-3 hours') BETWEEN date(?) AND date(?)`;
  const params:unknown[]=[auth.cooperativeId,auth.driverId,from,to];if(status){sql+=` AND d.status=?`;params.push(status);}sql+=` ORDER BY d.created_at DESC LIMIT 1000`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all<Row>();
  const totals=(rows.results||[]).reduce((out,item)=>{out.deliveries++;if(item.status==='delivered'){out.completed++;out.earnings_cents+=Number(item.driver_net_cents||item.driver_earnings_cents||0);out.distance_meters+=Number(item.distance_meters||0);}if(item.status==='cancelled')out.cancelled++;return out;},{deliveries:0,completed:0,cancelled:0,earnings_cents:0,distance_meters:0});
  for(const item of rows.results||[])item.display_earnings_cents=item.status==='delivered'?Number(item.driver_net_cents||item.driver_earnings_cents||0):0;
  return c.json({ok:true,from,to,items:rows.results,totals});
});

driverExperienceRoutes.get('/v18/driver/ratings',async c=>{
  const auth=tenant(c,['driver']);
  const [deliveryRows,shiftRows]=await Promise.all([
    c.env.DB.prepare(`SELECT r.id,r.driver_score,r.driver_tags_json,r.comment,r.created_at FROM delivery_ratings r WHERE r.cooperative_id=? AND r.driver_id=? AND r.driver_score IS NOT NULL ORDER BY r.created_at DESC LIMIT 1000`).bind(auth.cooperativeId,auth.driverId).all<Row>(),
    c.env.DB.prepare(`SELECT sr.id,sr.score driver_score,sr.tags_json driver_tags_json,sr.comment,sr.created_at FROM shift_ratings sr WHERE sr.cooperative_id=? AND sr.driver_id=? ORDER BY sr.created_at DESC LIMIT 1000`).bind(auth.cooperativeId,auth.driverId).all<Row>()
  ]);
  const rawItems=[...(deliveryRows.results||[]),...(shiftRows.results||[])].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,1000);
  const criteria:Record<string,number>={};
  const items=rawItems.map(item=>{
    const tags=parseTags(item.driver_tags_json);
    for(const tag of tags)criteria[tag]=(criteria[tag]||0)+1;
    return {id:item.id,driver_score:Number(item.driver_score),comment:item.comment||null,created_at:item.created_at,tags};
  });
  return c.json({
    ok:true,
    score:scoreByHundredth(items,'driver_score'),
    count:items.length,
    criteria:Object.entries(criteria).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR')).map(([name,count])=>({name,count})),
    items,
    lifetime:true,
    anonymous:true,
    method:'A nota é vitalícia e começa em 5,00. Ela não reinicia por semana. Cada avaliação altera a nota em 0,01: nota 5 recupera 0,01 e nota abaixo de 5 reduz 0,01, respeitando os limites de 1,00 a 5,00.'
  });
});

driverExperienceRoutes.get('/v18/driver/support',async c=>{
  const auth=tenant(c,['driver']),coop=await c.env.DB.prepare(`SELECT COALESCE(support_email,email) support_email FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>(),rows=await c.env.DB.prepare(`SELECT id,subject,message,status,response,responded_at,created_at FROM support_requests WHERE driver_id=? ORDER BY created_at DESC LIMIT 100`).bind(auth.driverId).all<Row>();
  return c.json({ok:true,support_email:coop?.support_email||'',items:rows.results});
});

driverExperienceRoutes.post('/v18/driver/support',async c=>{
  const auth=tenant(c,['driver']),body=await bodyJson<Row>(c),subject=cleanText(body.subject,150),message=cleanText(body.message,2000);
  if(subject.length<3||message.length<10)return c.json({ok:false,error:'Informe o assunto e descreva a dúvida com pelo menos 10 caracteres.'},400);
  const coop=await c.env.DB.prepare(`SELECT name,COALESCE(support_email,email) support_email FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>(),requestId=id();
  await c.env.DB.prepare(`INSERT INTO support_requests(id,cooperative_id,user_id,driver_id,subject,message) VALUES (?,?,?,?,?,?)`).bind(requestId,auth.cooperativeId,auth.id,auth.driverId,subject,message).run();
  let emailSent=false;if(c.env.RESEND_API_KEY&&coop?.support_email){try{const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${c.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:c.env.MAIL_FROM,to:[coop.support_email],subject:`Suporte ChegaJá — ${subject}`,html:`<div style="font-family:Arial,sans-serif"><h2>Novo pedido de suporte</h2><p><strong>Cooperado:</strong> ${escapeHtml(auth.name)}</p><p><strong>Cooperativa:</strong> ${escapeHtml(coop.name)}</p><p>${escapeHtml(message).replace(/\n/g,'<br>')}</p><p>Protocolo: ${requestId}</p></div>`})});emailSent=response.ok;}catch(error){console.warn('Falha ao enviar suporte por e-mail',error)}}
  await audit(c,'support.created','support_request',requestId,null,{subject,email_sent:emailSent},auth.cooperativeId);
  return c.json({ok:true,id:requestId,email_sent:emailSent,message:'Pedido enviado para o suporte da cooperativa.'},201);
});

driverExperienceRoutes.get('/v18/admin/driver-experience',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);await refreshCooperativeCompliance(c.env,auth.cooperativeId);
  const cooperative=await c.env.DB.prepare(`SELECT id,name,COALESCE(support_email,email) support_email,driver_compliance_required FROM cooperatives WHERE id=?`).bind(auth.cooperativeId).first<Row>();
  const drivers=await c.env.DB.prepare(`SELECT id,name,phone,vehicle_plate,vehicle_model,status,photo_url,cnh_number,cnh_expires_at,vehicle_document_number,vehicle_document_expires_at,compliance_status,compliance_suspended,compliance_override_until,compliance_override_reason FROM drivers WHERE cooperative_id=? AND deleted_at IS NULL ORDER BY name`).bind(auth.cooperativeId).all<Row>();
  const photos=await c.env.DB.prepare(`SELECT r.id,r.driver_id,r.current_photo_url,r.status,r.created_at,d.name driver_name,a.mime_type,a.data_base64 FROM driver_photo_requests r JOIN drivers d ON d.id=r.driver_id LEFT JOIN branding_assets a ON a.entity_type='driver_pending' AND a.entity_id=r.id WHERE r.cooperative_id=? AND r.status='pending' ORDER BY r.created_at`).bind(auth.cooperativeId).all<Row>();
  const documents=await c.env.DB.prepare(`SELECT r.*,d.name driver_name,d.cnh_number current_cnh_number,d.cnh_expires_at current_cnh_expires_at,d.vehicle_document_number current_vehicle_document_number,d.vehicle_document_expires_at current_vehicle_document_expires_at FROM driver_document_submissions r JOIN drivers d ON d.id=r.driver_id WHERE r.cooperative_id=? AND r.status='pending' ORDER BY r.created_at`).bind(auth.cooperativeId).all<Row>();
  return c.json({ok:true,cooperative,drivers:drivers.results,photo_requests:(photos.results||[]).map(item=>({...item,preview_data_url:dataUrl(item),data_base64:undefined})),document_requests:documents.results});
});

driverExperienceRoutes.put('/v18/admin/driver-experience/settings',async c=>{
  const auth=tenant(c,['cooperative_admin']),body=await bodyJson<Row>(c),supportEmail=nullableText(body.support_email,200),required=body.driver_compliance_required===true||body.driver_compliance_required===1||body.driver_compliance_required==='1'||body.driver_compliance_required==='true';
  if(supportEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail))return c.json({ok:false,error:'Informe um e-mail de suporte válido.'},400);
  await c.env.DB.prepare(`UPDATE cooperatives SET support_email=?,driver_compliance_required=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(supportEmail,required?1:0,auth.cooperativeId).run();
  await refreshCooperativeCompliance(c.env,auth.cooperativeId);await audit(c,'driver.compliance.settings','cooperative',auth.cooperativeId,null,{support_email:supportEmail,driver_compliance_required:required},auth.cooperativeId);
  return c.json({ok:true});
});

driverExperienceRoutes.post('/v18/admin/photo-requests/:id/review',async c=>{
  const auth=tenant(c,['cooperative_admin']),body=await bodyJson<Row>(c),decision=cleanText(body.decision,20),notes=nullableText(body.notes,500),request=await c.env.DB.prepare(`SELECT * FROM driver_photo_requests WHERE id=? AND cooperative_id=? AND status='pending'`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!request)return c.json({ok:false,error:'Solicitação de foto não encontrada.'},404);if(!['approved','rejected'].includes(decision))return c.json({ok:false,error:'Decisão inválida.'},400);
  if(decision==='approved'){
    const asset=await c.env.DB.prepare(`SELECT mime_type,data_base64 FROM branding_assets WHERE entity_type='driver_pending' AND entity_id=?`).bind(request.id).first<Row>();if(!asset)return c.json({ok:false,error:'Arquivo da nova foto não encontrado.'},404);
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO branding_assets(entity_type,entity_id,mime_type,data_base64,updated_at) VALUES ('driver',?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(entity_type,entity_id) DO UPDATE SET mime_type=excluded.mime_type,data_base64=excluded.data_base64,updated_at=CURRENT_TIMESTAMP`).bind(request.driver_id,asset.mime_type,asset.data_base64),
      c.env.DB.prepare(`UPDATE drivers SET photo_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(`/api/public/asset-logo/driver/${request.driver_id}?v=${Date.now()}`,request.driver_id)
    ]);
  }
  await c.env.DB.prepare(`UPDATE driver_photo_requests SET status=?,reviewed_by=?,review_notes=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(decision,auth.id,notes,request.id).run();
  await audit(c,`driver.photo.${decision}`,'driver_photo_request',request.id,request,{decision,notes},auth.cooperativeId);return c.json({ok:true});
});

driverExperienceRoutes.post('/v18/admin/document-requests/:id/review',async c=>{
  const auth=tenant(c,['cooperative_admin']),body=await bodyJson<Row>(c),decision=cleanText(body.decision,20),notes=nullableText(body.notes,500),request=await c.env.DB.prepare(`SELECT * FROM driver_document_submissions WHERE id=? AND cooperative_id=? AND status='pending'`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!request)return c.json({ok:false,error:'Solicitação de documentos não encontrada.'},404);if(!['approved','rejected'].includes(decision))return c.json({ok:false,error:'Decisão inválida.'},400);
  if(decision==='approved')await c.env.DB.prepare(`UPDATE drivers SET cnh_number=?,cnh_expires_at=?,vehicle_document_number=?,vehicle_document_expires_at=?,compliance_status='approved',compliance_reviewed_at=CURRENT_TIMESTAMP,compliance_reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(request.cnh_number,request.cnh_expires_at,request.vehicle_document_number,request.vehicle_document_expires_at,auth.id,request.driver_id).run();
  await c.env.DB.prepare(`UPDATE driver_document_submissions SET status=?,reviewed_by=?,review_notes=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(decision,auth.id,notes,request.id).run();
  if(decision==='approved')await refreshDriverCompliance(c.env,request.driver_id);await audit(c,`driver.documents.${decision}`,'driver_document_submission',request.id,request,{decision,notes},auth.cooperativeId);return c.json({ok:true});
});

driverExperienceRoutes.post('/v18/admin/drivers/:id/compliance-release',async c=>{
  const auth=tenant(c,['cooperative_admin']),body=await bodyJson<Row>(c),until=cleanText(body.until,10),reason=cleanText(body.reason,500),driver=await c.env.DB.prepare(`SELECT id,name FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!driver)return c.json({ok:false,error:'Cooperado não encontrado.'},404);if(!validDate(until)||reason.length<5)return c.json({ok:false,error:'Informe a data final da liberação e o motivo.'},400);
  await c.env.DB.prepare(`UPDATE drivers SET compliance_override_until=?,compliance_override_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(until,reason,driver.id).run();await refreshDriverCompliance(c.env,driver.id);
  await audit(c,'driver.compliance.released','driver',driver.id,null,{until,reason},auth.cooperativeId);return c.json({ok:true});
});

driverExperienceRoutes.get('/v18/admin/support',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']);const rows=await c.env.DB.prepare(`SELECT s.*,d.name driver_name,u.name user_name,r.name responded_by_name FROM support_requests s JOIN users u ON u.id=s.user_id LEFT JOIN drivers d ON d.id=s.driver_id LEFT JOIN users r ON r.id=s.responded_by WHERE s.cooperative_id=? ORDER BY CASE s.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,s.created_at DESC LIMIT 300`).bind(auth.cooperativeId).all<Row>();return c.json({ok:true,items:rows.results});
});

driverExperienceRoutes.post('/v18/admin/support/:id/reply',async c=>{
  const auth=tenant(c,['cooperative_admin','dispatcher']),body=await bodyJson<Row>(c),response=cleanText(body.response,2000),status=cleanText(body.status||'answered',30),request=await c.env.DB.prepare(`SELECT * FROM support_requests WHERE id=? AND cooperative_id=?`).bind(c.req.param('id'),auth.cooperativeId).first<Row>();
  if(!request)return c.json({ok:false,error:'Pedido de suporte não encontrado.'},404);if(response.length<3||!['in_progress','answered','closed'].includes(status))return c.json({ok:false,error:'Informe a resposta e o status.'},400);
  await c.env.DB.prepare(`UPDATE support_requests SET response=?,status=?,responded_by=?,responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(response,status,auth.id,request.id).run();await audit(c,'support.replied','support_request',request.id,request,{status},auth.cooperativeId);return c.json({ok:true});
});

driverExperienceRoutes.get('/v18/driver/navigation/:id',async c=>{
  const auth=tenant(c,['driver']),lat=Number(c.req.query('lat')),lng=Number(c.req.query('lng'));if(!Number.isFinite(lat)||!Number.isFinite(lng))return c.json({ok:false,error:'Localização atual inválida.'},400);
  const delivery=await c.env.DB.prepare(`SELECT id,display_code,status,pickup_address,pickup_lat,pickup_lng,delivery_address,delivery_lat,delivery_lng FROM deliveries WHERE id=? AND cooperative_id=? AND assigned_driver_id=? AND status NOT IN ('delivered','cancelled') AND deleted_at IS NULL`).bind(c.req.param('id'),auth.cooperativeId,auth.driverId).first<Row>();
  if(!delivery)return c.json({ok:false,error:'Entrega ativa não encontrada.'},404);const toDelivery=['picked_up','in_route','problem'].includes(delivery.status),targetLat=Number(toDelivery?delivery.delivery_lat:delivery.pickup_lat),targetLng=Number(toDelivery?delivery.delivery_lng:delivery.pickup_lng),address=String(toDelivery?delivery.delivery_address:delivery.pickup_address);
  if(!Number.isFinite(targetLat)||!Number.isFinite(targetLng))return c.json({ok:false,error:'O endereço ainda não possui coordenadas confirmadas.'},409);
  const route=await navigationRoute(c.env,{lat,lng},{lat:targetLat,lng:targetLng});if(!route)return c.json({ok:false,error:'Não foi possível calcular a navegação agora.'},503);
  return c.json({ok:true,item:{delivery_id:delivery.id,display_code:delivery.display_code,stage:toDelivery?'delivery':'pickup',destination_address:address,destination_lat:targetLat,destination_lng:targetLng,...route}});
});
