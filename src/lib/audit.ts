import type { Context } from 'hono';
import type { AppBindings } from '../types';
import { getIp } from './util';

export async function audit(
  c: Context<AppBindings>,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown = null,
  after: unknown = null,
  cooperativeId?: string | null
): Promise<void> {
  const auth = c.get('auth');
  await c.env.DB.prepare(`
    INSERT INTO audit_logs (cooperative_id, user_id, action, entity_type, entity_id, before_json, after_json, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    cooperativeId ?? auth?.cooperativeId ?? null,
    auth?.id ?? null,
    action,
    entityType,
    entityId,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    getIp(c),
    c.req.header('User-Agent') || null
  ).run();
}
