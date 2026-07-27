import type { Env } from '../types';
import { dispatchNextDriver } from './auto-dispatch';
import { id } from './util';
import { queueWebhookEvent } from './webhooks';

type Row = Record<string, any>;

export async function processScheduledDeliveries(env: Env, limit = 100): Promise<{processed:number;assigned:number;waiting:number}> {
  const rows = await env.DB.prepare(`
    SELECT d.id,d.cooperative_id,d.establishment_id,d.base_id,d.display_code,d.status,ds.dispatch_mode,ds.planned_driver_id,ds.scheduled_for
    FROM deliveries d JOIN delivery_schedules ds ON ds.delivery_id=d.id
    WHERE d.deleted_at IS NULL AND d.delivery_type='base'
      AND (
        (ds.scheduled_for IS NOT NULL AND datetime(ds.scheduled_for)<=datetime('now','-3 hours'))
        OR (ds.scheduled_for IS NULL AND ds.dispatch_mode='automatic')
      )
      AND ds.dispatch_processed_at IS NULL
      AND d.status IN ('new','offered')
    ORDER BY datetime(ds.scheduled_for),d.created_at
    LIMIT ?
  `).bind(Math.max(1,Math.min(500,limit))).all<Row>();

  let processed=0,assigned=0,waiting=0;
  for (const delivery of rows.results || []) {
    const mode=String(delivery.dispatch_mode||'none');
    if (mode==='automatic') {
      const result=await dispatchNextDriver(env,String(delivery.id),null,true);
      if (result.assigned) {
        await env.DB.batch([
          env.DB.prepare(`UPDATE delivery_schedules SET dispatch_processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`).bind(delivery.id),
          env.DB.prepare(`UPDATE deliveries SET assignment_source='scheduled_auto',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delivery.id)
        ]);
        await queueWebhookEvent(env,String(delivery.cooperative_id),String(delivery.establishment_id),'delivery.assigned',{id:delivery.id,display_code:delivery.display_code,driver_id:result.driverId,driver_name:result.driverName,status:'assigned',scheduled_for:delivery.scheduled_for});
        processed++;assigned++;
      } else {
        await env.DB.prepare(`UPDATE deliveries SET assignment_source='scheduled_auto_waiting',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delivery.id).run();
        waiting++;
      }
      continue;
    }

    if (mode==='manual' && delivery.planned_driver_id) {
      const driver=await env.DB.prepare(`SELECT id,name FROM drivers WHERE id=? AND cooperative_id=? AND status='active' AND COALESCE(on_leave,0)=0 AND deleted_at IS NULL`).bind(delivery.planned_driver_id,delivery.cooperative_id).first<Row>();
      if (driver) {
        const update=await env.DB.prepare(`UPDATE deliveries SET assigned_driver_id=?,status='assigned',assigned_by_role='system',assigned_by_user_id=NULL,assignment_source='scheduled_manual',updated_at=CURRENT_TIMESTAMP WHERE id=? AND assigned_driver_id IS NULL AND status IN ('new','offered')`).bind(driver.id,delivery.id).run();
        if (update.meta.changes) {
          await env.DB.batch([
            env.DB.prepare(`UPDATE delivery_schedules SET dispatch_processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`).bind(delivery.id),
            env.DB.prepare(`INSERT INTO delivery_status_history(id,delivery_id,cooperative_id,old_status,new_status,notes,changed_by) VALUES (?,?,?,?,'assigned',?,NULL)`).bind(id(),delivery.id,delivery.cooperative_id,delivery.status,`Entrega agendada atribuída a ${driver.name}`),
            env.DB.prepare(`UPDATE waiting_queue SET status='assigned',served_at=CURRENT_TIMESTAMP,served_delivery_id=?,updated_at=CURRENT_TIMESTAMP WHERE driver_id=? AND base_id=? AND status='waiting'`).bind(delivery.id,driver.id,delivery.base_id)
          ]);
          await queueWebhookEvent(env,String(delivery.cooperative_id),String(delivery.establishment_id),'delivery.assigned',{id:delivery.id,display_code:delivery.display_code,driver_id:driver.id,driver_name:driver.name,status:'assigned',scheduled_for:delivery.scheduled_for});
          processed++;assigned++;
          continue;
        }
      }
      await env.DB.batch([
        env.DB.prepare(`UPDATE delivery_schedules SET dispatch_processed_at=CURRENT_TIMESTAMP,planned_driver_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`).bind(delivery.id),
        env.DB.prepare(`UPDATE deliveries SET assignment_source='scheduled_manual_pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delivery.id)
      ]);
      processed++;waiting++;
      continue;
    }

    await env.DB.batch([
      env.DB.prepare(`UPDATE delivery_schedules SET dispatch_processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`).bind(delivery.id),
      env.DB.prepare(`UPDATE deliveries SET assignment_source=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(mode==='manual'?'scheduled_manual_pending':'scheduled_no_assignment',delivery.id)
    ]);
    processed++;waiting++;
  }
  return {processed,assigned,waiting};
}
