import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { bodyJson, cleanText, id } from '../lib/util';

export const driverCancelRoutes = new Hono<AppBindings>();
type Row = Record<string, any>;
const cancellable = ['assigned','accepted','to_pickup','at_pickup','picked_up','in_route','problem'];

driverCancelRoutes.post('/driver/deliveries/:id/cancel', async c => {
  const auth = c.get('auth');
  if (auth.role !== 'driver' || !auth.driverId || !auth.cooperativeId) {
    return c.json({ ok:false, error:'Acesso exclusivo do cooperado.' },403);
  }

  const body = await bodyJson<Row>(c);
  const reason = cleanText(body.reason,800);
  if (reason.length < 3) return c.json({ ok:false, error:'Informe o motivo do cancelamento.' },400);

  const delivery = await c.env.DB.prepare(`
    SELECT id,status,assigned_driver_id,notes,display_code
    FROM deliveries
    WHERE id=? AND cooperative_id=? AND deleted_at IS NULL
    LIMIT 1
  `).bind(c.req.param('id'),auth.cooperativeId).first<Row>();

  if (!delivery) return c.json({ ok:false, error:'Entrega não encontrada.' },404);
  if (delivery.assigned_driver_id !== auth.driverId) {
    return c.json({ ok:false, error:'Esta entrega não está atribuída a você.' },403);
  }
  if (!cancellable.includes(String(delivery.status))) {
    return c.json({ ok:false, error:'Esta entrega não pode mais ser cancelada.' },409);
  }

  const note = `Cancelada pelo cooperado: ${reason}`;
  const mergedNotes = [delivery.notes,note].filter(Boolean).join('\n');
  const result = await c.env.DB.prepare(`
    UPDATE deliveries
    SET status='cancelled',notes=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND cooperative_id=? AND assigned_driver_id=? AND status=?
  `).bind(mergedNotes,delivery.id,auth.cooperativeId,auth.driverId,delivery.status).run();

  if (!result.meta.changes) return c.json({ ok:false, error:'A entrega foi alterada antes do cancelamento.' },409);

  await c.env.DB.prepare(`
    INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by)
    VALUES (?,?,?,?,'cancelled',?,?)
  `).bind(id(),delivery.id,auth.cooperativeId,delivery.status,note,auth.id).run();

  return c.json({ ok:true, status:'cancelled', message:`Entrega ${delivery.display_code || ''} cancelada e Base informada.`.trim() });
});
