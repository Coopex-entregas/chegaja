import type { Env } from '../types';
import { base64UrlToBytes, bytesToBase64Url } from './crypto';

export type MapsProvider = 'google' | 'openstreetmap';
export interface MapsRuntimeConfig {
  provider: MapsProvider;
  serverKey: string;
  browserKey: string;
  mapId: string;
  serverKeySource: 'database' | 'environment' | 'none';
  browserKeySource: 'database' | 'environment' | 'none';
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CACHE_TTL_MS = 15_000;
let cache: { expiresAt: number; value: MapsRuntimeConfig } | null = null;

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`chegaja:maps:${secret}`));
  return crypto.subtle.importKey('raw', digest, { name:'AES-GCM' }, false, ['encrypt','decrypt']);
}

async function encryptValue(secret: string, value: string): Promise<string> {
  if (!value) return '';
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret);
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, encoder.encode(value));
  return `enc:v1:${bytesToBase64Url(iv)}:${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

async function decryptValue(secret: string, value: string): Promise<string> {
  if (!value) return '';
  if (!value.startsWith('enc:v1:')) return value;
  const [, , ivRaw, cipherRaw] = value.split(':');
  if (!ivRaw || !cipherRaw) return '';
  try {
    const key = await aesKey(secret);
    const plain = await crypto.subtle.decrypt(
      { name:'AES-GCM', iv:base64UrlToBytes(ivRaw) },
      key,
      base64UrlToBytes(cipherRaw)
    );
    return decoder.decode(plain);
  } catch {
    return '';
  }
}

async function settingRows(env: Env): Promise<Record<string,string>> {
  const keys = ['maps_provider','google_maps_api_key','google_maps_browser_key','google_maps_map_id'];
  const placeholders = keys.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT key,value FROM settings WHERE key IN (${placeholders})`).bind(...keys).all<{key:string;value:string}>();
  return Object.fromEntries((rows.results || []).map(row => [row.key, String(row.value || '')]));
}

export function invalidateMapsRuntimeConfig(): void { cache = null; }

export async function getMapsRuntimeConfig(env: Env, force = false): Promise<MapsRuntimeConfig> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.value;
  const rows = await settingRows(env).catch(() => ({} as Record<string,string>));
  const storedServer = await decryptValue(env.JWT_SECRET, rows.google_maps_api_key || '');
  const storedBrowser = await decryptValue(env.JWT_SECRET, rows.google_maps_browser_key || '');
  const serverKey = storedServer || String(env.GOOGLE_MAPS_API_KEY || '').trim();
  const browserKey = storedBrowser || String(env.GOOGLE_MAPS_BROWSER_KEY || '').trim();
  const rawProvider = String(rows.maps_provider || 'auto').trim().toLowerCase();

  // A chave do navegador serve apenas para exibir o mapa. Busca de endereços,
  // geocodificação e cálculo de rotas são executados no Worker e precisam de uma
  // chave de servidor. Quando ela não existe, usamos OpenStreetMap/Nominatim/OSRM
  // para que o endereço continue sendo encontrado e o valor seja calculado.
  const provider: MapsProvider = rawProvider === 'openstreetmap'
    ? 'openstreetmap'
    : serverKey
      ? 'google'
      : 'openstreetmap';

  const value: MapsRuntimeConfig = {
    provider,
    serverKey,
    browserKey,
    mapId:String(rows.google_maps_map_id || env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID').trim() || 'DEMO_MAP_ID',
    serverKeySource:storedServer ? 'database' : serverKey ? 'environment' : 'none',
    browserKeySource:storedBrowser ? 'database' : browserKey ? 'environment' : 'none'
  };
  cache = { expiresAt:Date.now() + CACHE_TTL_MS, value };
  return value;
}

export async function saveMapsRuntimeConfig(env: Env, input: {
  provider?: unknown;
  serverKey?: unknown;
  browserKey?: unknown;
  mapId?: unknown;
  clearServerKey?: unknown;
  clearBrowserKey?: unknown;
}): Promise<MapsRuntimeConfig> {
  const current = await getMapsRuntimeConfig(env, true);
  const providerRaw = String(input.provider ?? current.provider).trim().toLowerCase();
  const provider: MapsProvider = providerRaw === 'google' ? 'google' : 'openstreetmap';
  const mapId = String(input.mapId ?? current.mapId ?? 'DEMO_MAP_ID').trim() || 'DEMO_MAP_ID';
  const serverInput = String(input.serverKey ?? '').trim();
  const browserInput = String(input.browserKey ?? '').trim();
  const clearServer = input.clearServerKey === true || input.clearServerKey === 'true' || input.clearServerKey === 1 || input.clearServerKey === '1';
  const clearBrowser = input.clearBrowserKey === true || input.clearBrowserKey === 'true' || input.clearBrowserKey === 1 || input.clearBrowserKey === '1';

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES ('maps_provider',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(provider),
    env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES ('google_maps_map_id',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(mapId)
  ];
  if (serverInput || clearServer) {
    const value = clearServer ? '' : await encryptValue(env.JWT_SECRET, serverInput);
    statements.push(env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES ('google_maps_api_key',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(value));
  }
  if (browserInput || clearBrowser) {
    const value = clearBrowser ? '' : await encryptValue(env.JWT_SECRET, browserInput);
    statements.push(env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES ('google_maps_browser_key',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(value));
  }
  await env.DB.batch(statements);
  invalidateMapsRuntimeConfig();
  return getMapsRuntimeConfig(env, true);
}

export function mapsConfigForAdmin(config: MapsRuntimeConfig) {
  const mask = (value: string) => value ? `${value.slice(0,4)}••••••${value.slice(-4)}` : '';
  return {
    provider:config.provider,
    map_id:config.mapId,
    has_server_key:Boolean(config.serverKey),
    has_browser_key:Boolean(config.browserKey),
    server_key_masked:mask(config.serverKey),
    browser_key_masked:mask(config.browserKey),
    server_key_source:config.serverKeySource,
    browser_key_source:config.browserKeySource
  };
}
