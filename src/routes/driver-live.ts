import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { bodyJson, cleanText, id } from '../lib/util';

export const driverLiveRoutes = new Hono<AppBindings>();
type Row = Record<string, any>;

function localDateSql() { return `date('now','-3 hours')`; }

async function eligible(c: any, driverId: string, delivery: Row) {
  const online = await c.env.DB.prepare(`
    SELECT 1 ok FROM drivers
    WHERE id=? AND cooperative_id=? AND status='active' AND online=1
      AND datetime(last_seen_at)>=datetime('now','-10 minutes')
      AND deleted_at IS NULL
  `).bind(driverId, delivery.cooperative_id).first();
  if (!online) return false;

  if (delivery.delivery_type === 'base') {
    return Boolean(await c.env.DB.prepare(`
      SELECT 1 ok FROM schedules
      WHERE driver_id=? AND base_id=? AND deleted_at IS NULL
        AND status IN ('scheduled','confirmed')
        AND COALESCE(entry_type,'work')='work'
        AND date(start_at)=${localDateSql()}
      LIMIT 1
    `).bind(driverId, delivery.base_id).first());
  }

  return Boolean(await c.env.DB.prepare(`
    SELECT 1 ok WHERE EXISTS(
      SELECT 1 FROM schedules
      WHERE driver_id=? AND establishment_id=? AND deleted_at IS NULL
        AND status IN ('scheduled','confirmed')
        AND COALESCE(entry_type,'work')='work'
        AND date(start_at)=${localDateSql()}
    ) OR EXISTS(
      SELECT 1 FROM establishment_driver_permissions
      WHERE driver_id=? AND establishment_id=? AND active=1
        AND date(service_date)=${localDateSql()}
    )
    LIMIT 1
  `).bind(driverId, delivery.establishment_id, driverId, delivery.establishment_id).first());
}

const liveFields = `
  d.id,d.cooperative_id,d.establishment_id,d.base_id,d.delivery_type,d.status,d.assigned_driver_id,
  d.display_code,d.customer_name,d.recipient_name,d.pickup_address,d.delivery_address,
  d.pickup_lat,d.pickup_lng,d.delivery_lat,d.delivery_lng,d.route_geometry,
  d.distance_meters,d.duration_seconds,d.driver_net_cents,d.driver_earnings_cents,
  d.charge_cents,d.payment_method,d.item_description,d.notes,d.created_at,
  e.name establishment_name,b.name base_name
`;

// Consulta leve para o aplicativo do cooperado. Não recalcula financeiro,
// garantidos ou relatórios; por isso pode ser chamada frequentemente.
driverLiveRoutes.get('/driver/live', async c => {
  const auth = c.get('auth');
  if (auth.role !== 'driver' || !auth.driverId || !auth.cooperativeId) {
    return c.json({ ok:false, error:'Acesso exclusivo do cooperado.' },403);
  }

  const driver = await c.env.DB.prepare(`
    SELECT id,name,photo_url,online,last_seen_at,current_lat,current_lng,location_updated_at
    FROM drivers WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1
  `).bind(auth.driverId, auth.cooperativeId).first<Row>();

  const assigned = await c.env.DB.prepare(`
    SELECT ${liveFields}
    FROM deliveries d
    JOIN establishments e ON e.id=d.establishment_id
    LEFT JOIN bases b ON b.id=d.base_id
    WHERE d.cooperative_id=? AND d.assigned_driver_id=? AND d.deleted_at IS NULL
      AND d.status NOT IN ('delivered','cancelled')
    ORDER BY CASE d.status
      WHEN 'assigned' THEN 0 WHEN 'accepted' THEN 1 WHEN 'to_pickup' THEN 2
      WHEN 'at_pickup' THEN 3 WHEN 'picked_up' THEN 4 WHEN 'in_route' THEN 5 ELSE 6 END,
      d.created_at
    LIMIT 1
  `).bind(auth.cooperativeId, auth.driverId).first<Row>();

  let call: Row | null = assigned?.status === 'assigned' ? { ...assigned, call_mode:'assigned' } : null;

  if (!call && Number(driver?.online || 0) === 1) {
    const offered = await c.env.DB.prepare(`
      SELECT ${liveFields}
      FROM deliveries d
      JOIN establishments e ON e.id=d.establishment_id
      LEFT JOIN bases b ON b.id=d.base_id
      WHERE d.cooperative_id=? AND d.status='offered' AND d.assigned_driver_id IS NULL
        AND d.deleted_at IS NULL
        AND NOT EXISTS(
          SELECT 1 FROM driver_offer_responses r
          WHERE r.delivery_id=d.id AND r.driver_id=? AND r.response='declined'
        )
        AND (
          (d.delivery_type='base' AND EXISTS(
            SELECT 1 FROM schedules s
            WHERE s.driver_id=? AND s.base_id=d.base_id AND s.deleted_at IS NULL
              AND s.status IN ('scheduled','confirmed')
              AND COALESCE(s.entry_type,'work')='work'
              AND date(s.start_at)=${localDateSql()}
          ))
          OR
          (d.delivery_type='establishment' AND (
            EXISTS(
              SELECT 1 FROM schedules s
              WHERE s.driver_id=? AND s.establishment_id=d.establishment_id AND s.deleted_at IS NULL
                AND s.status IN ('scheduled','confirmed')
                AND COALESCE(s.entry_type,'work')='work'
                AND date(s.start_at)=${localDateSql()}
            )
            OR EXISTS(
              SELECT 1 FROM establishment_driver_permissions p
              WHERE p.driver_id=? AND p.establishment_id=d.establishment_id AND p.active=1
                AND date(p.service_date)=${localDateSql()}
            )
          ))
        )
      ORDER BY d.created_at
      LIMIT 1
    `).bind(auth.cooperativeId, auth.driverId, auth.driverId, auth.driverId, auth.driverId).first<Row>();
    if (offered) call = { ...offered, call_mode:'offered' };
  }

  return c.json({
    ok:true,
    driver,
    call,
    active: assigned && assigned.status !== 'assigned' ? assigned : null,
    server_time:new Date().toISOString()
  });
});

driverLiveRoutes.post('/driver/live/:id/accept', async c => {
  const auth = c.get('auth');
  if (auth.role !== 'driver' || !auth.driverId || !auth.cooperativeId) {
    return c.json({ ok:false, error:'Acesso exclusivo do cooperado.' },403);
  }

  const delivery = await c.env.DB.prepare(`
    SELECT d.* FROM deliveries d
    WHERE d.id=? AND d.cooperative_id=? AND d.deleted_at IS NULL LIMIT 1
  `).bind(c.req.param('id'), auth.cooperativeId).first<Row>();
  if (!delivery) return c.json({ ok:false, error:'A entrega não está mais disponível.' },409);
  if (!(await eligible(c, auth.driverId, delivery))) {
    return c.json({ ok:false, error:'Fique online e confirme sua escala neste local.' },409);
  }

  let result;
  if (delivery.status === 'assigned' && delivery.assigned_driver_id === auth.driverId) {
    result = await c.env.DB.prepare(`
      UPDATE deliveries SET status='accepted',accepted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND assigned_driver_id=? AND status='assigned'
    `).bind(delivery.id, auth.driverId).run();
  } else if (delivery.status === 'offered' && !delivery.assigned_driver_id) {
    result = await c.env.DB.prepare(`
      UPDATE deliveries SET assigned_driver_id=?,status='accepted',accepted_at=CURRENT_TIMESTAMP,
        assignment_source='offer_live',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND assigned_driver_id IS NULL AND status='offered'
    `).bind(auth.driverId, delivery.id).run();
  } else {
    return c.json({ ok:false, error:'A entrega já foi aceita ou retirada.' },409);
  }

  if (!result.meta.changes) return c.json({ ok:false, error:'Outro cooperado aceitou primeiro.' },409);

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO driver_offer_responses(delivery_id,driver_id,response,responded_at)
      VALUES (?,?,'accepted',CURRENT_TIMESTAMP)
      ON CONFLICT(delivery_id,driver_id) DO UPDATE SET response='accepted',responded_at=CURRENT_TIMESTAMP
    `).bind(delivery.id, auth.driverId),
    c.env.DB.prepare(`
      INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by)
      VALUES (?,?,?,?, 'accepted','Aceita pela chamada em tela cheia',?)
    `).bind(id(), delivery.id, auth.cooperativeId, delivery.status, auth.id),
    c.env.DB.prepare(`
      UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE driver_id=? AND status='waiting'
        AND ((? IS NOT NULL AND base_id=?) OR (? IS NOT NULL AND establishment_id=?))
    `).bind(delivery.id, auth.driverId, delivery.base_id, delivery.base_id, delivery.establishment_id, delivery.establishment_id)
  ]);

  return c.json({ ok:true, item:{ ...delivery, status:'accepted', assigned_driver_id:auth.driverId } });
});

driverLiveRoutes.post('/driver/live/:id/decline', async c => {
  const auth = c.get('auth');
  if (auth.role !== 'driver' || !auth.driverId || !auth.cooperativeId) {
    return c.json({ ok:false, error:'Acesso exclusivo do cooperado.' },403);
  }
  const body = await bodyJson<Row>(c).catch(() => ({} as Row));
  const reason = cleanText(body.reason || 'Recusada pelo cooperado',300);
  const delivery = await c.env.DB.prepare(`
    SELECT id,cooperative_id,establishment_id,base_id,status,assigned_driver_id,display_code
    FROM deliveries WHERE id=? AND cooperative_id=? AND deleted_at IS NULL LIMIT 1
  `).bind(c.req.param('id'), auth.cooperativeId).first<Row>();
  if (!delivery) return c.json({ ok:true });

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT INTO driver_offer_responses(delivery_id,driver_id,response,reason,responded_at)
      VALUES (?,?,'declined',?,CURRENT_TIMESTAMP)
      ON CONFLICT(delivery_id,driver_id) DO UPDATE SET response='declined',reason=excluded.reason,responded_at=CURRENT_TIMESTAMP
    `).bind(delivery.id, auth.driverId, reason)
  ];

  if (delivery.status === 'assigned' && delivery.assigned_driver_id === auth.driverId) {
    statements.push(
      c.env.DB.prepare(`
        UPDATE deliveries SET assigned_driver_id=NULL,status='offered',assignment_source='declined_live',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND assigned_driver_id=? AND status='assigned'
      `).bind(delivery.id, auth.driverId),
      c.env.DB.prepare(`
        INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by)
        VALUES (?,?,?,'assigned','offered',?,?)
      `).bind(id(), delivery.id, auth.cooperativeId, reason, auth.id)
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ ok:true });
});
