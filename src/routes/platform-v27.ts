import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { assertRole, cleanText } from '../lib/util';

export const platformV27Routes = new Hono<AppBindings>();
type Row = Record<string, any>;

platformV27Routes.get('/v27/base/live-map', async c => {
  const auth = c.get('auth');
  assertRole(auth, ['cooperative_admin','dispatcher']);
  if (!auth.cooperativeId) return c.json({ok:false,error:'Cooperativa não vinculada.'},403);

  const baseId = cleanText(c.req.query('base_id'),100);
  if (!baseId) return c.json({ok:false,error:'Selecione uma Base.'},400);

  const base = await c.env.DB.prepare(`SELECT id,name,address,latitude,longitude,checkin_radius_meters
    FROM bases WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1`)
    .bind(baseId,auth.cooperativeId).first<Row>();
  if (!base) return c.json({ok:false,error:'Base não encontrada.'},404);

  if (auth.role === 'dispatcher') {
    const count = await c.env.DB.prepare(`SELECT COUNT(*) total FROM base_attendants WHERE cooperative_id=? AND active=1`)
      .bind(auth.cooperativeId).first<Row>();
    if (Number(count?.total||0)>0) {
      const linked = await c.env.DB.prepare(`SELECT 1 ok FROM base_attendants WHERE cooperative_id=? AND base_id=? AND user_id=? AND active=1 LIMIT 1`)
        .bind(auth.cooperativeId,baseId,auth.id).first<Row>();
      if (!linked) return c.json({ok:false,error:'Este atendente não está vinculado a esta Base.'},403);
    }
  }

  const rows = await c.env.DB.prepare(`WITH queue_here AS (
      SELECT q.id,q.driver_id,q.arrived_at,q.queue_order,
        ROW_NUMBER() OVER(ORDER BY CASE WHEN q.queue_order>0 THEN q.queue_order ELSE 2147483647 END,datetime(q.arrived_at),q.id) queue_position
      FROM waiting_queue q
      WHERE q.cooperative_id=? AND q.base_id=? AND q.establishment_id IS NULL AND q.status='waiting'
    ), driver_state AS (
      SELECT d.id,d.name,d.phone,d.photo_url,d.vehicle_model,d.vehicle_plate,d.current_lat,d.current_lng,
        d.location_accuracy,d.location_updated_at,d.last_seen_at,
        CASE WHEN d.online=1 AND datetime(d.last_seen_at)>=datetime('now','-10 minutes') THEN 1 ELSE 0 END online,
        q.id queue_id,q.arrived_at,q.queue_order,q.queue_position,
        CASE WHEN EXISTS(SELECT 1 FROM schedules s WHERE s.driver_id=d.id AND s.base_id=? AND s.deleted_at IS NULL
          AND s.status IN ('scheduled','confirmed') AND date(s.start_at)=date('now','-3 hours')) THEN 1 ELSE 0 END scheduled_here,
        (SELECT COUNT(*) FROM deliveries x WHERE x.assigned_driver_id=d.id AND x.base_id=? AND x.deleted_at IS NULL
          AND x.status NOT IN ('delivered','cancelled')) active_delivery_count
      FROM drivers d LEFT JOIN queue_here q ON q.driver_id=d.id
      WHERE d.cooperative_id=? AND d.status='active' AND d.deleted_at IS NULL
    )
    SELECT * FROM driver_state
    WHERE online=1 OR queue_id IS NOT NULL OR scheduled_here=1 OR active_delivery_count>0
    ORDER BY CASE WHEN queue_position IS NULL THEN 1 ELSE 0 END,queue_position,online DESC,name COLLATE NOCASE`)
    .bind(auth.cooperativeId,baseId,baseId,baseId,auth.cooperativeId).all<Row>();

  return c.json({ok:true,base,items:rows.results||[]});
});
