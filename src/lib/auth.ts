import type { MiddlewareHandler } from 'hono';
import type { AppBindings, AuthUser, Role } from '../types';
import { verifyJwt } from './crypto';

export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return c.json({ ok: false, error: 'Não autenticado.' }, 401);

  try {
    const payload = await verifyJwt<AuthUser>(token, c.env.JWT_SECRET);
    // O JWT não basta sozinho: o status atual é conferido no banco em todas as
    // chamadas. Assim, ao inativar um cooperado, uma sessão que já estava aberta
    // também perde o acesso imediatamente, sem apagar o histórico dele.
    const row = await c.env.DB.prepare(`
      SELECT u.id,u.cooperative_id,u.establishment_id,u.driver_id,u.name,u.email,u.role,u.status user_status,u.deleted_at user_deleted,
             c.status cooperative_status,c.deleted_at cooperative_deleted,
             d.status driver_status,d.deleted_at driver_deleted,
             e.active establishment_active,e.deleted_at establishment_deleted
      FROM users u
      LEFT JOIN cooperatives c ON c.id=u.cooperative_id
      LEFT JOIN drivers d ON d.id=u.driver_id
      LEFT JOIN establishments e ON e.id=u.establishment_id
      WHERE u.id=?
      LIMIT 1
    `).bind(payload.id).first<any>();
    if (!row || row.user_status !== 'active' || row.user_deleted) return c.json({ ok:false, error:'Este acesso foi inativado.' }, 401);
    if (row.cooperative_id && (row.cooperative_status !== 'active' || row.cooperative_deleted)) return c.json({ ok:false, error:'Cooperativa bloqueada ou inativa.' }, 403);
    if (row.role === 'driver' && (!row.driver_id || row.driver_status !== 'active' || row.driver_deleted)) return c.json({ ok:false, error:'Cadastro do cooperado inativo ou bloqueado.' }, 403);
    if (row.role === 'establishment' && (!row.establishment_id || Number(row.establishment_active || 0) !== 1 || row.establishment_deleted)) return c.json({ ok:false, error:'Estabelecimento inativo ou bloqueado.' }, 403);

    c.set('auth', {
      ...payload,
      cooperativeId:row.cooperative_id || null,
      establishmentId:row.establishment_id || null,
      driverId:row.driver_id || null,
      name:String(row.name || payload.name),
      email:String(row.email || payload.email),
      role:row.role as Role
    });
    await next();
  } catch (error) {
    if (error instanceof Response) throw error;
    return c.json({ ok: false, error: 'Sessão inválida ou expirada.' }, 401);
  }
};
