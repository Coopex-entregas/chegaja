import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../types';

type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

const routeModules: Array<[RegExp, string]> = [
  [/^\/api\/app\/dashboard(?:\/|$)/, 'dashboard'],
  [/^\/api\/app\/users(?:\/|$)/, 'users'],
  [/^\/api\/app\/establishments(?:\/|$)/, 'establishments'],
  [/^\/api\/app\/drivers(?:\/|$)/, 'drivers'],
  [/^\/api\/app\/v18\/admin\/(?:driver-experience|photo-requests|document-requests|drivers|support)(?:\/|$)/, 'drivers'],
  [/^\/api\/app\/tenant\/bases(?:\/|$)/, 'bases'],
  [/^\/api\/app\/tenant\/services(?:\/|$)/, 'services'],
  [/^\/api\/app\/shift-templates(?:\/|$)/, 'shifts'],
  [/^\/api\/app\/(?:tenant\/schedules|schedule-grid|schedule-swaps)(?:\/|$)/, 'schedules'],
  [/^\/api\/app\/(?:deliveries|v6\/deliveries|v7\/deliveries|v9\/deliveries|v10\/deliveries|v10\/queue|v15\/base\/delivery-form-data|v15\/base\/deliveries|v15\/deliveries|v15\/messages|v15\/calls|v15\/driver\/deliveries|v15\/sos|v16\/base|v16\/deliveries|v17\/base|v17\/driver)(?:\/|$)/, 'deliveries'],
  [/^\/api\/app\/(?:online-drivers|tenant\/online-drivers|tracking)(?:\/|$)/, 'tracking'],
  [/^\/api\/app\/(?:financial|deductions|v10\/reports\/financial|v10\/expenses)(?:\/|$)/, 'financial'],
  [/^\/api\/app\/v10\/reports\/deliveries(?:\/|$)/, 'deliveries'],
  [/^\/api\/app\/v10\/base\/customers(?:\/|$)/, 'credits'],
  [/^\/api\/app\/(?:weekly-closing|closings)(?:\/|$)/, 'closings'],
  [/^\/api\/app\/(?:advances|advance-requests)(?:\/|$)/, 'advances'],
  [/^\/api\/app\/(?:credit-requests|customer-credit)(?:\/|$)/, 'credits'],
  [/^\/api\/app\/(?:api-clients|webhooks)(?:\/|$)/, 'integrations'],
  [/^\/api\/app\/(?:attendance|driver\/presence)(?:\/|$)/, 'attendance'],
  [/^\/api\/app\/settings(?:\/|$)/, 'settings']
];

function actionFromMethod(method: string): PermissionAction {
  if (method === 'GET' || method === 'HEAD') return 'view';
  if (method === 'POST') return 'create';
  if (method === 'DELETE') return 'delete';
  return 'edit';
}

export const enforceUserPermissions: MiddlewareHandler<AppBindings> = async (c, next) => {
  const auth = c.get('auth');

  // Localização em tempo real de cooperados é uma permissão do estabelecimento,
  // aplicada no servidor. A interface não consegue contornar esta checagem.
  if (auth?.role === 'establishment' && /^\/api\/app\/tenant\/online-drivers(?:\/|$)/.test(c.req.path)) {
    if (!auth.establishmentId || !auth.cooperativeId) return c.json({ ok:true, items:[], location_allowed:false });
    const establishment = await c.env.DB.prepare(`
      SELECT driver_map_enabled
      FROM establishments
      WHERE id=? AND cooperative_id=? AND deleted_at IS NULL
      LIMIT 1
    `).bind(auth.establishmentId, auth.cooperativeId).first<{ driver_map_enabled:number }>();
    if (!establishment || Number(establishment.driver_map_enabled || 0) !== 1) {
      return c.json({ ok:true, items:[], location_allowed:false });
    }
  }

  if (!auth || auth.role === 'platform_admin' || auth.role === 'driver' || auth.role === 'establishment') {
    await next();
    return;
  }

  const moduleEntry = routeModules.find(([pattern]) => pattern.test(c.req.path));
  if (!moduleEntry) {
    await next();
    return;
  }

  if (/^\/api\/app\/users\/[^/]+\/permissions$/.test(c.req.path) && auth.role === 'cooperative_admin') {
    await next();
    return;
  }

  const anyPermission = await c.env.DB.prepare(`SELECT 1 ok FROM user_permissions WHERE user_id=? LIMIT 1`)
    .bind(auth.id).first<{ ok: number }>();
  if (!anyPermission) {
    await next();
    return;
  }

  const moduleKey = moduleEntry[1];
  const action = actionFromMethod(c.req.method);
  const column = action === 'view' ? 'can_view' : action === 'create' ? 'can_create' : action === 'edit' ? 'can_edit' : 'can_delete';
  const permission = await c.env.DB.prepare(`SELECT ${column} allowed FROM user_permissions WHERE user_id=? AND module_key=? LIMIT 1`)
    .bind(auth.id, moduleKey).first<{ allowed: number }>();
  if (!permission?.allowed) return c.json({ ok: false, error: `Seu usuário não possui permissão para ${action === 'view' ? 'visualizar' : action === 'create' ? 'criar' : action === 'edit' ? 'editar' : 'excluir'} este módulo.` }, 403);

  await next();
};