const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return bytesToBase64Url(data);
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hmacSha256(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function hashPassword(password: string, salt = randomToken(16)): Promise<{ hash: string; salt: string }> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 210_000,
      hash: 'SHA-256'
    },
    material,
    256
  );
  return { hash: bytesToBase64Url(new Uint8Array(bits)), salt };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  if (hash.length !== expectedHash.length) return false;
  const a = encoder.encode(hash);
  const b = encoder.encode(expectedHash);
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

export async function signJwt(payload: Record<string, unknown>, secret: string, expiresInSeconds = 43_200): Promise<string> {
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const body = bytesToBase64Url(encoder.encode(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })));
  const signature = await hmacSha256(secret, `${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export async function verifyJwt<T>(token: string, secret: string): Promise<T & { exp: number }> {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) throw new Error('Token inválido');
  const expected = await hmacSha256(secret, `${header}.${body}`);
  if (expected !== signature) throw new Error('Assinatura inválida');
  const payload = JSON.parse(decoder.decode(base64UrlToBytes(body))) as T & { exp: number };
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expirado');
  return payload;
}
