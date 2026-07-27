import { Hono } from 'hono';
import type { AppBindings, Role } from '../types';
import { hashPassword, randomToken, sha256, signJwt, verifyPassword } from '../lib/crypto';
import { bodyJson, cleanText, id, nowIso } from '../lib/util';
import { requireAuth } from '../lib/auth';
import { audit } from '../lib/audit';
import { getMapsRuntimeConfig } from '../lib/platform-config';

interface UserRow {
  id: string;
  cooperative_id: string | null;
  establishment_id: string | null;
  driver_id: string | null;
  name: string;
  email: string;
  username: string | null;
  password_hash: string;
  password_salt: string;
  role: Role;
  status: string;
}

export const authRoutes = new Hono<AppBindings>();

authRoutes.post('/login', async (c) => {
  const body = await bodyJson<{ login?: string; password?: string }>(c);
  const rawLogin = cleanText(body.login, 200);
  const login = rawLogin.toLowerCase().trim();
  const digits = rawLogin.replace(/\D/g, '');
  const password = String(body.password ?? '');
  if (!login || !password) return c.json({ ok: false, error: 'Informe usuário/e-mail e senha.' }, 400);

  // Pode existir cadastro antigo duplicado com o mesmo e-mail. Por isso não usamos
  // LIMIT 1 antes de validar a senha: verificamos todos os acessos candidatos e
  // selecionamos o que realmente corresponde à senha informada.
  const direct = await c.env.DB.prepare(`
    SELECT * FROM users
    WHERE deleted_at IS NULL AND (lower(trim(email)) = ? OR lower(trim(COALESCE(username,''))) = ?)
    ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 20
  `).bind(login, login).all<UserRow>();

  let user: UserRow | null = null;
  for (const candidate of direct.results || []) {
    if (candidate.status === 'active' && await verifyPassword(password, candidate.password_salt, candidate.password_hash)) {
      user = candidate;
      break;
    }
  }

  // O e-mail institucional da cooperativa também funciona como identificador de acesso.
  // Ele é tratado como um alias do primeiro administrador ativo da cooperativa.
  // Isso evita confusão entre "e-mail institucional" e "e-mail do administrador".
  if (!user) {
    const cooperativeCandidates = await c.env.DB.prepare(`
      SELECT u.*
      FROM cooperatives c
      JOIN users u ON u.cooperative_id=c.id
      WHERE c.deleted_at IS NULL AND c.status='active'
        AND lower(trim(COALESCE(c.email,'')))=?
        AND u.role='cooperative_admin' AND u.status='active' AND u.deleted_at IS NULL
      ORDER BY u.created_at ASC
      LIMIT 20
    `).bind(login).all<UserRow>();

    for (const candidate of cooperativeCandidates.results || []) {
      if (await verifyPassword(password, candidate.password_salt, candidate.password_hash)) {
        user = candidate;
        break;
      }
    }
  }

  // Também aceita e-mail, telefone ou CPF cadastrados diretamente no cooperado.
  // A consulta encontra o acesso vinculado e também repara acessos antigos ainda
  // sem driver_id quando nome/e-mail e cooperativa correspondem ao cooperado.
  if (!user) {
    const driverCandidates = await c.env.DB.prepare(`
      SELECT u.*, d.id matched_driver_id
      FROM drivers d
      JOIN users u ON u.cooperative_id=d.cooperative_id AND u.role='driver' AND u.deleted_at IS NULL
        AND (
          u.driver_id=d.id
          OR (
            u.driver_id IS NULL AND (
              lower(trim(COALESCE(u.email,'')))=lower(trim(COALESCE(d.email,'')))
              OR lower(trim(COALESCE(u.name,'')))=lower(trim(COALESCE(d.name,'')))
            )
          )
        )
      WHERE d.deleted_at IS NULL AND d.status='active' AND (
        lower(trim(COALESCE(d.email,'')))=?
        OR replace(replace(replace(replace(replace(COALESCE(d.phone,''),'(',''),')',''),'-',''),' ',''),'+','')=?
        OR replace(replace(replace(COALESCE(d.cpf,''),'.',''),'-',''),' ','')=?
      )
      ORDER BY CASE WHEN u.status='active' THEN 0 ELSE 1 END, u.updated_at DESC
      LIMIT 20
    `).bind(login, digits, digits).all<UserRow & { matched_driver_id: string }>();

    for (const candidate of driverCandidates.results || []) {
      if (candidate.status === 'active' && await verifyPassword(password, candidate.password_salt, candidate.password_hash)) {
        if (!candidate.driver_id && candidate.matched_driver_id) {
          candidate.driver_id = candidate.matched_driver_id;
          await c.env.DB.prepare(`UPDATE users SET driver_id=?,updated_at=? WHERE id=?`)
            .bind(candidate.driver_id, nowIso(), candidate.id).run();
        }
        user = candidate;
        break;
      }
    }
  }

  if (!user) return c.json({ ok: false, error: 'Usuário ou senha incorretos.' }, 401);

  // Repara acessos antigos de cooperados que foram criados sem driver_id, desde que
  // exista um único cooperado da mesma cooperativa com o mesmo e-mail ou nome.
  if (user.role === 'driver' && !user.driver_id && user.cooperative_id) {
    const matches = await c.env.DB.prepare(`
      SELECT id FROM drivers
      WHERE cooperative_id=? AND deleted_at IS NULL AND status='active'
        AND (lower(trim(COALESCE(email,'')))=lower(trim(?)) OR lower(trim(name))=lower(trim(?)))
      LIMIT 2
    `).bind(user.cooperative_id, user.email, user.name).all<{id:string}>();
    if ((matches.results || []).length === 1) {
      user.driver_id = matches.results[0].id;
      await c.env.DB.prepare(`UPDATE users SET driver_id=?,updated_at=? WHERE id=?`).bind(user.driver_id, nowIso(), user.id).run();
    }
  }

  if (user.role === 'driver') {
    if (!user.driver_id) return c.json({ ok:false, error:'Acesso do cooperado sem vínculo. A cooperativa deve abrir Cooperados > Acesso e salvar novamente.' }, 403);
    const driver = await c.env.DB.prepare(`SELECT status FROM drivers WHERE id=? AND deleted_at IS NULL`).bind(user.driver_id).first<{status:string}>();
    if (!driver || driver.status !== 'active') return c.json({ ok:false, error:'Cadastro do cooperado inativo ou bloqueado.' }, 403);
  }

  if (user.cooperative_id) {
    const cooperative = await c.env.DB.prepare(`SELECT status FROM cooperatives WHERE id=? AND deleted_at IS NULL`).bind(user.cooperative_id).first<{ status: string }>();
    if (!cooperative || cooperative.status !== 'active') return c.json({ ok: false, error: 'Cooperativa bloqueada ou inativa.' }, 403);
  }

  const token = await signJwt({
    id: user.id,
    cooperativeId: user.cooperative_id,
    establishmentId: user.establishment_id,
    driverId: user.driver_id,
    name: user.name,
    email: user.email,
    role: user.role
  }, c.env.JWT_SECRET);

  await c.env.DB.prepare(`UPDATE users SET last_login_at=?, updated_at=? WHERE id=?`).bind(nowIso(), nowIso(), user.id).run();

  return c.json({
    ok: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      cooperative_id: user.cooperative_id,
      establishment_id: user.establishment_id,
      driver_id: user.driver_id
    }
  });
});

authRoutes.post('/forgot-password', async (c) => {
  const body = await bodyJson<{ email?: string }>(c);
  const email = cleanText(body.email, 200).toLowerCase();
  const generic = { ok: true, message: 'Se o e-mail estiver cadastrado, as instruções serão enviadas.' };
  if (!email) return c.json(generic);

  const user = await c.env.DB.prepare(`SELECT id, name, email FROM users WHERE lower(email)=? AND status='active' AND deleted_at IS NULL LIMIT 1`)
    .bind(email).first<{ id: string; name: string; email: string }>();
  if (!user) return c.json(generic);

  const rawToken = randomToken(40);
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  await c.env.DB.prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(id(), user.id, tokenHash, expiresAt).run();

  const requestUrl = new URL(c.req.url);
  const isLocal = requestUrl.hostname === '127.0.0.1' || requestUrl.hostname === 'localhost';
  const baseUrl = isLocal ? `${requestUrl.protocol}//${requestUrl.host}` : c.env.APP_URL.replace(/\/$/, '');
  const resetUrl = `${baseUrl}/?reset=${encodeURIComponent(rawToken)}`;

  let emailSent = false;
  if (c.env.RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${c.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: c.env.MAIL_FROM,
          to: [user.email],
          subject: 'Redefinição de senha — ChegaJá',
          html: `<div style="font-family:Arial,sans-serif;max-width:560px"><h2 style="color:#0D257A">ChegaJá</h2><p>Olá, ${user.name}.</p><p>Use o botão abaixo para redefinir sua senha. O link expira em 30 minutos.</p><p><a href="${resetUrl}" style="background:#0D257A;color:#fff;padding:12px 18px;text-decoration:none;border-radius:8px">Redefinir senha</a></p><p>Se você não solicitou, ignore esta mensagem.</p></div>`
        })
      });
      emailSent = response.ok;
      if (!response.ok) console.error('Falha no envio pelo Resend:', response.status, await response.text());
    } catch (error) {
      console.error('Falha ao chamar o Resend:', error);
    }
  }

  return c.json({
    ...generic,
    email_configured: Boolean(c.env.RESEND_API_KEY),
    email_sent: emailSent,
    ...((isLocal || c.env.APP_ENV !== 'production') ? { development_reset_url: resetUrl } : {})
  });
});

authRoutes.post('/reset-password', async (c) => {
  const body = await bodyJson<{ token?: string; password?: string }>(c);
  const token = cleanText(body.token, 300);
  const password = String(body.password ?? '');
  if (!token || password.length < 8) return c.json({ ok: false, error: 'Token inválido ou senha com menos de 8 caracteres.' }, 400);
  const tokenHash = await sha256(token);
  const row = await c.env.DB.prepare(`
    SELECT id, user_id FROM password_reset_tokens
    WHERE token_hash=? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP LIMIT 1
  `).bind(tokenHash).first<{ id: string; user_id: string }>();
  if (!row) return c.json({ ok: false, error: 'Link inválido ou expirado.' }, 400);
  const hashed = await hashPassword(password);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash=?, password_salt=?, updated_at=? WHERE id=?`).bind(hashed.hash, hashed.salt, nowIso(), row.user_id),
    c.env.DB.prepare(`UPDATE password_reset_tokens SET used_at=? WHERE id=?`).bind(nowIso(), row.id)
  ]);
  return c.json({ ok: true, message: 'Senha atualizada.' });
});

authRoutes.use('/me', requireAuth);
authRoutes.get('/me', async (c) => {
  const auth = c.get('auth');
  const user = await c.env.DB.prepare(`
    SELECT u.id,u.name,u.email,u.username,u.role,u.cooperative_id,u.establishment_id,u.driver_id,
           c.name cooperative_name,c.logo_url cooperative_logo_url,c.primary_color,e.name establishment_name,e.logo_url establishment_logo_url,d.name driver_name,d.online,d.last_seen_at,d.location_updated_at
    FROM users u
    LEFT JOIN cooperatives c ON c.id=u.cooperative_id
    LEFT JOIN establishments e ON e.id=u.establishment_id
    LEFT JOIN drivers d ON d.id=u.driver_id
    WHERE u.id=? AND u.deleted_at IS NULL
  `).bind(auth.id).first<any>();
  const permissionRows = await c.env.DB.prepare(`SELECT module_key,can_view,can_create,can_edit,can_delete FROM user_permissions WHERE user_id=? ORDER BY module_key`).bind(auth.id).all();
  const permissions: Record<string, any> = {};
  for (const row of permissionRows.results as any[]) permissions[row.module_key] = { view:Boolean(row.can_view), create:Boolean(row.can_create), edit:Boolean(row.can_edit), delete:Boolean(row.can_delete) };
  return c.json({ ok: true, user: user ? { ...user, permissions, has_custom_permissions: Boolean(permissionRows.results.length) } : user });
});

authRoutes.use('/maps-config', requireAuth);
authRoutes.get('/maps-config', async (c) => {
  const config = await getMapsRuntimeConfig(c.env);
  const enabled = config.provider === 'google' && Boolean(config.browserKey);
  return c.json({
    ok:true,
    item:{
      provider:config.provider,
      enabled,
      api_key:enabled ? config.browserKey : null,
      map_id:config.mapId,
      search_provider:config.provider,
      route_provider:config.provider
    }
  });
});

authRoutes.use('/change-password', requireAuth);
authRoutes.post('/change-password', async (c) => {
  const auth = c.get('auth');
  const body = await bodyJson<{ current_password?: string; new_password?: string }>(c);
  const current = String(body.current_password ?? '');
  const next = String(body.new_password ?? '');
  if (next.length < 8) return c.json({ ok: false, error: 'A nova senha deve ter pelo menos 8 caracteres.' }, 400);
  const user = await c.env.DB.prepare(`SELECT password_hash,password_salt FROM users WHERE id=?`).bind(auth.id).first<{ password_hash: string; password_salt: string }>();
  if (!user || !(await verifyPassword(current, user.password_salt, user.password_hash))) return c.json({ ok: false, error: 'Senha atual incorreta.' }, 400);
  const hashed = await hashPassword(next);
  await c.env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?`).bind(hashed.hash, hashed.salt, nowIso(), auth.id).run();
  await audit(c, 'password.changed', 'user', auth.id);
  return c.json({ ok: true, message: 'Senha alterada.' });
});
