import type { Env } from '../types';
import { hmacSha256 } from './crypto';
import { id, nowIso } from './util';

export async function queueWebhookEvent(env: Env, cooperativeId: string, establishmentId: string | null, event: string, data: unknown): Promise<void> {
  const hooks = await env.DB.prepare(`
    SELECT id FROM webhooks
    WHERE cooperative_id = ? AND status = 'active'
      AND (establishment_id IS NULL OR establishment_id = ?)
      AND instr(',' || events || ',', ',' || ? || ',') > 0
  `).bind(cooperativeId, establishmentId, event).all<{ id: string }>();

  if (!hooks.results.length) return;
  const payload = JSON.stringify({ event, created_at: nowIso(), data });
  await env.DB.batch(hooks.results.map((hook) => env.DB.prepare(`
    INSERT INTO webhook_deliveries (id, webhook_id, event, payload) VALUES (?, ?, ?, ?)
  `).bind(id(), hook.id, event, payload)));
}

export async function processWebhookQueue(env: Env, limit = 30): Promise<void> {
  const queue = await env.DB.prepare(`
    SELECT wd.id, wd.payload, wd.attempts, w.url, w.secret
    FROM webhook_deliveries wd
    JOIN webhooks w ON w.id = wd.webhook_id
    WHERE wd.status IN ('pending','failed') AND wd.next_attempt_at <= CURRENT_TIMESTAMP AND w.status = 'active'
    ORDER BY wd.created_at ASC LIMIT ?
  `).bind(limit).all<{ id: string; payload: string; attempts: number; url: string; secret: string }>();

  for (const item of queue.results) {
    try {
      const signature = await hmacSha256(item.secret, item.payload);
      const response = await fetch(item.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ligerim-Signature': signature,
          'User-Agent': 'Ligerim-Webhooks/1.0'
        },
        body: item.payload
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await env.DB.prepare(`
        UPDATE webhook_deliveries SET status='delivered', attempts=attempts+1, delivered_at=CURRENT_TIMESTAMP, last_error=NULL WHERE id=?
      `).bind(item.id).run();
    } catch (error) {
      const attempts = item.attempts + 1;
      const minutes = Math.min(60, 2 ** attempts);
      const next = new Date(Date.now() + minutes * 60_000).toISOString();
      await env.DB.prepare(`
        UPDATE webhook_deliveries SET status='failed', attempts=?, next_attempt_at=?, last_error=? WHERE id=?
      `).bind(attempts, next, String(error).slice(0, 500), item.id).run();
    }
  }
}
