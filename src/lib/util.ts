import type { Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';

export const nowIso = () => new Date().toISOString();
export const APP_TIME_ZONE = 'America/Sao_Paulo';

export function saoPauloDate(reference = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(reference);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export const id = () => crypto.randomUUID();

export function cleanText(value: unknown, max = 500): string {
  return String(value ?? '').trim().slice(0, max);
}

export function nullableText(value: unknown, max = 500): string | null {
  const text = cleanText(value, max);
  return text || null;
}

export function toNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toCents(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function intValue(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function bodyJson<T = Record<string, unknown>>(c: Context<AppBindings>): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    throw new Error('Corpo JSON inválido.');
  }
}

export function getIp(c: Context<AppBindings>): string | null {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
}

export function assertRole(auth: AuthUser, roles: AuthUser['role'][]): void {
  if (!roles.includes(auth.role)) throw new Error('Acesso não autorizado.');
}

export function cooperativeScope(auth: AuthUser, requested?: string | null): string | null {
  if (auth.role === 'platform_admin') return requested || null;
  return auth.cooperativeId;
}

export function ensureSameCooperative(auth: AuthUser, cooperativeId: string): void {
  if (auth.role !== 'platform_admin' && auth.cooperativeId !== cooperativeId) throw new Error('Acesso não autorizado.');
}

export function sqlLike(value: string): string {
  return `%${value.replace(/[%_]/g, '')}%`;
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ ok: false, error: message }, { status });
}
