import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppBindings } from './types';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { operationRoutes } from './routes/operations';
import { integrationRoutes } from './routes/integration';
import { publicRoutes } from './routes/public';
import { tenantRoutes } from './routes/tenant';
import { customerRoutes } from './routes/customer';
import { ligerimRoutes } from './routes/ligerim';
import { clientRoutes } from './routes/client';
import { customerPasswordRoutes } from './routes/customer-password';
import { dispatchV6Routes } from './routes/dispatch-v6';
import { dispatchV7Routes } from './routes/dispatch-v7';
import { scheduleV8Routes } from './routes/schedule-v8';
import { dispatchV9Routes } from './routes/dispatch-v9';
import { platformV10Routes } from './routes/platform-v10';
import { platformV14Routes } from './routes/platform-v14';
import { platformV15Routes } from './routes/platform-v15';
import { platformV16Routes, publicV16Routes } from './routes/platform-v16';
import { platformV17Routes } from './routes/platform-v17';
import { driverExperienceRoutes } from './routes/driver-experience';
import { platformV19Routes } from './routes/platform-v19';
import { platformV21Routes } from './routes/platform-v21';
import { platformV22Routes } from './routes/platform-v22';
import { platformV23Routes } from './routes/platform-v23';
import { mapSafeRoutes, publicMapSafeRoutes } from './routes/map-safe';
import { driverLiveRoutes } from './routes/driver-live';
import { settleDueGuarantees } from './lib/guarantees';
import { enforceUserPermissions } from './lib/permissions';
import { requireAuth } from './lib/auth';
import { jsonError } from './lib/util';
import { processWebhookQueue } from './lib/webhooks';
import { refreshCooperativeCompliance } from './lib/compliance';
import { processScheduledDeliveries } from './lib/scheduled-deliveries';

const app = new Hono<AppBindings>();
app.use('*', secureHeaders());
app.use('/api/*', cors({ origin: '*', allowHeaders: ['Authorization','Content-Type','X-API-Key'], allowMethods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] }));

app.get('/api/health', (c) => c.json({ ok: true, app: c.env.APP_NAME, time: new Date().toISOString() }));
app.route('/api/auth', authRoutes);
app.route('/api/public', publicMapSafeRoutes);
app.route('/api/public', publicRoutes);
app.route('/api/public/customer', customerRoutes);
app.route('/api/public', publicV16Routes);
app.route('/api/client', customerPasswordRoutes);
app.route('/api/client', clientRoutes);
app.route('/api/v1', integrationRoutes);

app.use('/api/app/*', requireAuth);
app.use('/api/app/*', enforceUserPermissions);
app.use('/api/app/*', async (c, next) => {
  const legacy = [
    /^\/api\/app\/contract-prices(?:\/|$)/,
    /^\/api\/app\/price-tables(?:\/|$)/,
    /^\/api\/app\/price-rules(?:\/|$)/
  ];
  if (legacy.some((pattern) => pattern.test(c.req.path))) {
    return c.json({ ok:false, error:'Módulo removido. Os valores são configurados por quilômetro e taxa mínima no estabelecimento.' },410);
  }
  await next();
});
app.use('/api/app/*', async (c, next) => {
  const auth = c.get('auth');
  if (auth.role === 'establishment' && c.req.method !== 'GET' && /\/(?:schedules?|schedule-grid|schedule-planner|schedule-swaps)(?:\/|$)/.test(c.req.path)) {
    return c.json({ ok:false, error:'O estabelecimento possui acesso somente para visualizar a escala. Alterações são feitas pela cooperativa; trocas são solicitadas pelos próprios cooperados.' },403);
  }
  if (auth.role === 'platform_admin') {
    const allowed = ['/api/app/dashboard','/api/app/cooperatives','/api/app/platform/','/api/app/audit','/api/app/map/'];
    if (!allowed.some((prefix) => c.req.path === prefix || c.req.path.startsWith(prefix))) return c.json({ ok:false, error:'O Administrador Principal acessa somente cooperativas, indicadores e auditoria da plataforma.' },403);
  }
  await next();
});
app.route('/api/app', driverLiveRoutes);
app.route('/api/app', mapSafeRoutes);
app.route('/api/app', adminRoutes);
app.route('/api/app', operationRoutes);
app.route('/api/app', tenantRoutes);
app.route('/api/app', ligerimRoutes);
app.route('/api/app/v6', dispatchV6Routes);
app.route('/api/app/v7', dispatchV7Routes);
app.route('/api/app', scheduleV8Routes);
app.route('/api/app/v9', dispatchV9Routes);
app.route('/api/app', platformV10Routes);
app.route('/api/app', platformV14Routes);
app.route('/api/app', platformV15Routes);
app.route('/api/app', platformV16Routes);
app.route('/api/app', platformV17Routes);
app.route('/api/app', driverExperienceRoutes);
app.route('/api/app', platformV19Routes);
app.route('/api/app', platformV21Routes);
app.route('/api/app', platformV22Routes);
app.route('/api/app', platformV23Routes);

app.onError((error, c) => {
  console.error(error);
  const message = error instanceof Error ? error.message : 'Erro interno.';
  const status = message.includes('não autorizado') ? 403 : 400;
  return c.json({ ok: false, error: c.env.APP_ENV === 'production' && status === 400 && message.includes('D1') ? 'Não foi possível concluir a operação.' : message }, status);
});

app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) return jsonError('Rota não encontrada.', 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: AppBindings['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(processWebhookQueue(env, 50));
    ctx.waitUntil(env.DB.prepare(`DELETE FROM driver_locations WHERE recorded_at < datetime('now','-30 days')`).run());
    ctx.waitUntil(env.DB.prepare(`DELETE FROM password_reset_tokens WHERE expires_at < datetime('now','-1 day')`).run());
    ctx.waitUntil(env.DB.prepare(`DELETE FROM customer_password_reset_tokens WHERE expires_at < datetime('now','-1 day')`).run());
    ctx.waitUntil(env.DB.prepare(`UPDATE drivers SET online=0 WHERE online=1 AND datetime(last_seen_at) < datetime('now','-10 minutes')`).run());
    ctx.waitUntil(settleDueGuarantees(env));
    ctx.waitUntil(refreshCooperativeCompliance(env));
    ctx.waitUntil(processScheduledDeliveries(env,100));
    ctx.waitUntil(env.DB.prepare(`UPDATE drivers SET on_leave=0,leave_start_date=NULL,leave_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE on_leave=1 AND leave_return_date IS NOT NULL AND date(leave_return_date)<=date('now','-3 hours')`).run());
  }
};
