import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { bodyJson, cleanText, id, nullableText } from '../lib/util';

export const customerRoutes = new Hono<AppBindings>();

type AnyRow = Record<string, any>;

async function quoteRule(c: any, cooperativeId: string, contractId: string | null, neighborhood: string): Promise<AnyRow | null> {
  let sql = `SELECT r.*,ct.name contract_name FROM contract_price_rules r JOIN contracts ct ON ct.id=r.contract_id WHERE r.cooperative_id=? AND r.active=1 AND ct.active=1 AND ct.deleted_at IS NULL AND lower(trim(r.neighborhood))=lower(trim(?))`;
  const params: unknown[] = [cooperativeId, neighborhood];
  if (contractId) { sql += ` AND r.contract_id=?`; params.push(contractId); }
  sql += ` ORDER BY CASE WHEN r.fixed_cents>0 THEN 0 ELSE 1 END, r.fixed_cents DESC, r.base_cents DESC LIMIT 1`;
  return c.env.DB.prepare(sql).bind(...params).first() as any;
}

customerRoutes.get('/cooperatives', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT c.id,c.name,c.phone,c.email,c.address,c.logo_url,c.primary_color,
      (SELECT COUNT(*) FROM contracts ct WHERE ct.cooperative_id=c.id AND ct.active=1 AND ct.deleted_at IS NULL) contract_count
    FROM cooperatives c WHERE c.status='active' AND c.deleted_at IS NULL ORDER BY c.name
  `).all();
  return c.json({ ok: true, items: rows.results });
});

customerRoutes.get('/contracts', async (c) => {
  const cooperativeId = cleanText(c.req.query('cooperative_id'),100);
  if (!cooperativeId) return c.json({ok:false,error:'Informe a cooperativa.'},400);
  const rows = await c.env.DB.prepare(`SELECT id,name,code FROM contracts WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL ORDER BY name`).bind(cooperativeId).all();
  return c.json({ok:true,items:rows.results});
});

customerRoutes.get('/neighborhoods', async (c) => {
  const cooperativeId=cleanText(c.req.query('cooperative_id'),100),contractId=cleanText(c.req.query('contract_id'),100);
  if(!cooperativeId)return c.json({ok:false,error:'Informe a cooperativa.'},400);
  let sql=`SELECT DISTINCT neighborhood FROM contract_price_rules WHERE cooperative_id=? AND active=1`;const params:unknown[]=[cooperativeId];if(contractId){sql+=` AND contract_id=?`;params.push(contractId);}sql+=` ORDER BY neighborhood`;const rows=await c.env.DB.prepare(sql).bind(...params).all();return c.json({ok:true,items:rows.results});
});

customerRoutes.post('/quote', async(c)=>{
  const body=await bodyJson<Record<string,unknown>>(c);const cooperativeId=cleanText(body.cooperative_id,100),contractId=nullableText(body.contract_id,100),neighborhood=cleanText(body.delivery_neighborhood,150);if(!cooperativeId||!neighborhood)return c.json({ok:false,error:'Informe a cooperativa e o bairro de entrega.'},400);const cooperative=await c.env.DB.prepare(`SELECT id,name FROM cooperatives WHERE id=? AND status='active' AND deleted_at IS NULL`).bind(cooperativeId).first() as any;if(!cooperative)return c.json({ok:false,error:'Cooperativa indisponível.'},404);const rule=await quoteRule(c,cooperativeId,contractId,neighborhood);if(!rule)return c.json({ok:true,found:false,message:'Valor ainda não cadastrado. A cooperativa confirmará o orçamento.'});const amount=Number(rule.fixed_cents||rule.base_cents||0);return c.json({ok:true,found:true,amount_cents:amount,contract_id:rule.contract_id,contract_name:rule.contract_name,neighborhood:rule.neighborhood});
});

customerRoutes.post('/requests', async(c)=>{
  const body=await bodyJson<Record<string,unknown>>(c);const cooperativeId=cleanText(body.cooperative_id,100),customerName=cleanText(body.customer_name,150),customerPhone=cleanText(body.customer_phone,50),pickup=cleanText(body.pickup_address,500),destination=cleanText(body.delivery_address,500);if(!cooperativeId||!customerName||!customerPhone||!pickup||!destination)return c.json({ok:false,error:'Preencha cooperativa, nome, telefone, coleta e entrega.'},400);const cooperative=await c.env.DB.prepare(`SELECT id FROM cooperatives WHERE id=? AND status='active' AND deleted_at IS NULL`).bind(cooperativeId).first();if(!cooperative)return c.json({ok:false,error:'Cooperativa indisponível.'},404);let customer=await c.env.DB.prepare(`SELECT id FROM customers WHERE phone=? ORDER BY created_at DESC LIMIT 1`).bind(customerPhone).first() as any;if(!customer){customer={id:id()};await c.env.DB.prepare(`INSERT INTO customers (id,name,phone,email) VALUES (?,?,?,?)`).bind(customer.id,customerName,customerPhone,nullableText(body.customer_email,200)).run();}
  const neighborhood=cleanText(body.delivery_neighborhood,150);const contractId=nullableText(body.contract_id,100);const rule=neighborhood?await quoteRule(c,cooperativeId,contractId,neighborhood):null;const requestId=id();const quoted=rule?Number(rule.fixed_cents||rule.base_cents||0):0;
  await c.env.DB.prepare(`INSERT INTO customer_requests (id,cooperative_id,customer_id,customer_name,customer_phone,pickup_address,pickup_neighborhood,pickup_contact_name,pickup_phone,delivery_address,delivery_neighborhood,recipient_name,recipient_phone,item_description,payment_method,quoted_cents,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(requestId,cooperativeId,customer.id,customerName,customerPhone,pickup,nullableText(body.pickup_neighborhood,150),nullableText(body.pickup_contact_name,150),nullableText(body.pickup_phone,50),destination,nullableText(body.delivery_neighborhood,150),nullableText(body.recipient_name,150),nullableText(body.recipient_phone,50),nullableText(body.item_description,500),nullableText(body.payment_method,50),quoted,nullableText(body.notes,1500)).run();return c.json({ok:true,id:requestId,status:'new',quoted_cents:quoted,message:'Solicitação enviada para a cooperativa.'},201);
});
