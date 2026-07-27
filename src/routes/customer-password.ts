import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { hashPassword, randomToken, sha256 } from '../lib/crypto';
import { bodyJson, cleanText, id, nowIso } from '../lib/util';

type Row = Record<string, any>;

export const customerPasswordRoutes = new Hono<AppBindings>();

customerPasswordRoutes.post('/forgot-password', async c => {
  const body=await bodyJson<Row>(c).catch(()=>({} as Row));
  const email=cleanText(body.email,200).toLowerCase();
  const cooperativeId=cleanText(body.cooperative_id,100);
  const generic={ok:true,message:'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha.'};
  if(!email||!cooperativeId)return c.json(generic);

  const row=await c.env.DB.prepare(`
    SELECT a.id account_id,a.customer_id,c.name,c.email customer_email,a.email account_email,cp.name cooperative_name
    FROM customer_accounts a
    JOIN customers c ON c.id=a.customer_id
    JOIN cooperative_customers cc ON cc.customer_id=a.customer_id AND cc.cooperative_id=? AND cc.status='active'
    JOIN cooperatives cp ON cp.id=cc.cooperative_id AND cp.status='active' AND cp.deleted_at IS NULL
    WHERE a.provider='password' AND a.status='active'
      AND lower(trim(COALESCE(a.email,c.email,'')))=?
    LIMIT 1
  `).bind(cooperativeId,email).first<Row>();
  if(!row)return c.json(generic);

  const rawToken=randomToken(40),tokenHash=await sha256(rawToken),expiresAt=new Date(Date.now()+30*60_000).toISOString();
  await c.env.DB.prepare(`INSERT INTO customer_password_reset_tokens(id,account_id,cooperative_id,token_hash,expires_at) VALUES (?,?,?,?,?)`)
    .bind(id(),row.account_id,cooperativeId,tokenHash,expiresAt).run();

  const baseUrl=String(c.env.APP_URL||new URL(c.req.url).origin).replace(/\/$/,'');
  const resetUrl=`${baseUrl}/?cliente=1&coop=${encodeURIComponent(cooperativeId)}&customer_reset=${encodeURIComponent(rawToken)}`;
  let emailSent=false;
  if(c.env.RESEND_API_KEY){
    try{
      const response=await fetch('https://api.resend.com/emails',{
        method:'POST',
        headers:{Authorization:`Bearer ${c.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify({
          from:c.env.MAIL_FROM,
          to:[email],
          subject:`Redefinição de senha — ${row.cooperative_name||'ChegaJá'}`,
          html:`<div style="font-family:Arial,sans-serif;max-width:560px"><h2 style="color:#0D257A">ChegaJá</h2><p>Olá, ${String(row.name||'cliente')}.</p><p>Use o botão abaixo para criar uma nova senha. O link expira em 30 minutos.</p><p><a href="${resetUrl}" style="display:inline-block;background:#0D257A;color:#fff;padding:12px 18px;text-decoration:none;border-radius:9px">Criar nova senha</a></p><p>Se você não solicitou, ignore esta mensagem.</p></div>`
        })
      });
      emailSent=response.ok;
      if(!response.ok)console.error('Falha ao enviar redefinição do cliente:',response.status,await response.text());
    }catch(error){console.error('Falha no envio de redefinição do cliente:',error);}
  }
  return c.json({...generic,email_configured:Boolean(c.env.RESEND_API_KEY),email_sent:emailSent});
});

customerPasswordRoutes.post('/reset-password', async c => {
  const body=await bodyJson<Row>(c).catch(()=>({} as Row));
  const token=cleanText(body.token,300),password=String(body.password||''),cooperativeId=cleanText(body.cooperative_id,100);
  if(!token||!cooperativeId||password.length<8)return c.json({ok:false,error:'Link inválido ou senha com menos de 8 caracteres.'},400);
  const tokenHash=await sha256(token);
  const row=await c.env.DB.prepare(`SELECT id,account_id FROM customer_password_reset_tokens WHERE cooperative_id=? AND token_hash=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP LIMIT 1`)
    .bind(cooperativeId,tokenHash).first<Row>();
  if(!row)return c.json({ok:false,error:'Link inválido ou expirado.'},400);
  const hashed=await hashPassword(password),now=nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE customer_accounts SET password_hash=?,password_salt=?,updated_at=? WHERE id=?`).bind(hashed.hash,hashed.salt,now,row.account_id),
    c.env.DB.prepare(`UPDATE customer_password_reset_tokens SET used_at=? WHERE id=?`).bind(now,row.id)
  ]);
  return c.json({ok:true,message:'Senha atualizada. Entre com a nova senha.'});
});
