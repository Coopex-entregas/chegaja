import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { assertRole, bodyJson, cleanText, id } from '../lib/util';

export const platformV26Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

const MODULES = [
  ['dashboard','Visão geral'],['users','Usuários e acessos'],['establishments','Estabelecimentos'],['drivers','Cooperados'],
  ['bases','Bases'],['services','Serviços'],['shifts','Horários'],['schedules','Escalas'],['attendance','Presença'],
  ['deliveries','Entregas'],['tracking','Rastreamento'],['financial','Financeiro'],['closings','Fechamentos'],
  ['advances','Adiantamentos'],['credits','Créditos'],['integrations','Integrações'],['settings','Configurações']
] as const;

async function targetUser(c:any,userId:string){
  const auth=c.get('auth');assertRole(auth,['platform_admin','cooperative_admin']);
  const user=(await c.env.DB.prepare(`SELECT id,name,email,role,status,cooperative_id FROM users WHERE id=? AND deleted_at IS NULL`).bind(userId).first()) as Row|null;
  if(!user)return null;
  if(auth.role!=='platform_admin'&&auth.cooperativeId!==user.cooperative_id)return null;
  if(['platform_admin','driver','establishment'].includes(String(user.role)))return {...user,permissions_locked:1};
  return user;
}

platformV26Routes.get('/v26/users/:id/permissions',async c=>{
  const user=await targetUser(c,c.req.param('id'));
  if(!user)return c.json({ok:false,error:'Usuário não encontrado ou acesso não autorizado.'},404);
  const rows=await c.env.DB.prepare(`SELECT module_key,can_view,can_create,can_edit,can_delete FROM user_permissions WHERE user_id=?`).bind(user.id).all<Row>();
  const map=new Map((rows.results||[]).map((row:Row)=>[String(row.module_key),row]));
  return c.json({ok:true,user,modules:MODULES.map(([key,label])=>({key,label,...(map.get(key)||{can_view:0,can_create:0,can_edit:0,can_delete:0})})),customized:(rows.results||[]).length>0});
});

platformV26Routes.put('/v26/users/:id/permissions',async c=>{
  const auth=c.get('auth');const user=await targetUser(c,c.req.param('id'));
  if(!user)return c.json({ok:false,error:'Usuário não encontrado ou acesso não autorizado.'},404);
  if(user.permissions_locked)return c.json({ok:false,error:'Este perfil usa permissões fixas do sistema.'},409);
  const body=await bodyJson<Row>(c),items=Array.isArray(body.items)?body.items:[];
  const allowed=new Set(MODULES.map(([key])=>key));
  const statements:D1PreparedStatement[]=[c.env.DB.prepare(`DELETE FROM user_permissions WHERE user_id=?`).bind(user.id)];
  for(const raw of items){
    const key=cleanText(raw?.module_key,60);if(!allowed.has(key as any))continue;
    const view=raw.can_view?1:0,create=view&&raw.can_create?1:0,edit=view&&raw.can_edit?1:0,del=view&&raw.can_delete?1:0;
    if(!view&&!create&&!edit&&!del)continue;
    statements.push(c.env.DB.prepare(`INSERT INTO user_permissions(id,user_id,module_key,can_view,can_create,can_edit,can_delete,created_by) VALUES (?,?,?,?,?,?,?,?)`).bind(id(),user.id,key,view,create,edit,del,auth.id));
  }
  await c.env.DB.batch(statements);
  return c.json({ok:true,count:Math.max(0,statements.length-1)});
});

platformV26Routes.delete('/v26/users/:id/permissions',async c=>{
  const user=await targetUser(c,c.req.param('id'));
  if(!user)return c.json({ok:false,error:'Usuário não encontrado ou acesso não autorizado.'},404);
  if(user.permissions_locked)return c.json({ok:false,error:'Este perfil usa permissões fixas do sistema.'},409);
  await c.env.DB.prepare(`DELETE FROM user_permissions WHERE user_id=?`).bind(user.id).run();
  return c.json({ok:true,message:'Permissões personalizadas removidas. O perfil voltou ao acesso padrão.'});
});
