import type { Env } from '../types';
import { id } from './util';

type Row = Record<string, any>;

export async function cooperativeCreditBalance(env: Env, customerId: string, cooperativeId: string): Promise<number> {
  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(CASE WHEN t.entry_type='credit' THEN t.amount_cents ELSE -t.amount_cents END),0) balance_cents
    FROM customer_wallet_transactions t
    JOIN customer_wallets w ON w.id=t.wallet_id
    WHERE w.customer_id=? AND t.cooperative_id=? AND t.status='confirmed'
  `).bind(customerId, cooperativeId).first<Row>();
  return Number(row?.balance_cents || 0);
}

async function ensureWallet(env: Env, customerId: string): Promise<Row> {
  let wallet = await env.DB.prepare(`SELECT id,balance_cents FROM customer_wallets WHERE customer_id=?`).bind(customerId).first<Row>();
  if (!wallet) {
    wallet = { id:id(), balance_cents:0 };
    await env.DB.prepare(`INSERT INTO customer_wallets(id,customer_id,balance_cents) VALUES (?,?,0)`).bind(wallet.id,customerId).run();
  }
  return wallet;
}

export async function deliveryCreditApplied(env: Env, deliveryId: string, cooperativeId: string): Promise<number> {
  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(CASE WHEN entry_type='debit' THEN amount_cents ELSE -amount_cents END),0) applied_cents
    FROM customer_wallet_transactions
    WHERE delivery_id=? AND cooperative_id=? AND status='confirmed'
      AND category IN ('delivery','delivery_adjustment','delivery_refund')
  `).bind(deliveryId,cooperativeId).first<Row>();
  return Math.max(0,Number(row?.applied_cents||0));
}

export async function reconcileDeliveryCredit(env: Env, input: {
  deliveryId:string;
  cooperativeId:string;
  customerId:string;
  desiredCents:number;
  displayCode:string;
  reason:string;
  requestId?:string|null;
}): Promise<{ previousCents:number; currentCents:number; balanceCents:number; deltaCents:number }> {
  const desired = Math.max(0,Math.round(Number(input.desiredCents||0)));
  const wallet = await ensureWallet(env,input.customerId);
  const previous = await deliveryCreditApplied(env,input.deliveryId,input.cooperativeId);
  const delta = desired-previous;
  if (!delta) {
    const balance = await cooperativeCreditBalance(env,input.customerId,input.cooperativeId);
    await env.DB.prepare(`UPDATE deliveries SET customer_id=?,credit_used_cents=?,payment_status=CASE WHEN ?>0 THEN 'paid' ELSE payment_status END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(input.customerId,desired,desired,input.deliveryId).run();
    return {previousCents:previous,currentCents:desired,balanceCents:balance,deltaCents:0};
  }

  if (delta>0) {
    const balance = await cooperativeCreditBalance(env,input.customerId,input.cooperativeId);
    if (balance<delta) throw new Error(`Crédito insuficiente. Disponível: R$ ${(balance/100).toFixed(2).replace('.',',')}.`);
    const description = previous>0
      ? `Ajuste de crédito da entrega ${input.displayCode}: acréscimo de R$ ${(delta/100).toFixed(2).replace('.',',')}`
      : `Crédito utilizado na entrega ${input.displayCode}`;
    await env.DB.batch([
      env.DB.prepare(`UPDATE customer_wallets SET balance_cents=balance_cents-?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delta,wallet.id),
      env.DB.prepare(`INSERT INTO customer_wallet_transactions(id,wallet_id,cooperative_id,request_id,delivery_id,entry_type,category,amount_cents,description,reason) VALUES (?,?,?,?,?,'debit',?,?,?,?)`)
        .bind(id(),wallet.id,input.cooperativeId,input.requestId||null,input.deliveryId,previous>0?'delivery_adjustment':'delivery',delta,description,input.reason),
      env.DB.prepare(`UPDATE deliveries SET customer_id=?,credit_used_cents=?,payment_method='credit',payment_status='paid',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(input.customerId,desired,input.deliveryId),
      env.DB.prepare(`UPDATE customer_requests SET credit_used_cents=?,payment_method='credit',quoted_cents=?,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`)
        .bind(desired,desired,input.deliveryId)
    ]);
  } else {
    const refund = Math.abs(delta);
    const description = desired===0
      ? `Estorno do crédito da entrega ${input.displayCode}`
      : `Ajuste de crédito da entrega ${input.displayCode}: devolução de R$ ${(refund/100).toFixed(2).replace('.',',')}`;
    await env.DB.batch([
      env.DB.prepare(`UPDATE customer_wallets SET balance_cents=balance_cents+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(refund,wallet.id),
      env.DB.prepare(`INSERT INTO customer_wallet_transactions(id,wallet_id,cooperative_id,request_id,delivery_id,entry_type,category,amount_cents,description,reason) VALUES (?,?,?,?,?,'credit','delivery_refund',?,?,?)`)
        .bind(id(),wallet.id,input.cooperativeId,input.requestId||null,input.deliveryId,refund,description,input.reason),
      env.DB.prepare(`UPDATE deliveries SET customer_id=?,credit_used_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(input.customerId,desired,input.deliveryId),
      env.DB.prepare(`UPDATE customer_requests SET credit_used_cents=?,quoted_cents=CASE WHEN ?>0 THEN ? ELSE quoted_cents END,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=?`)
        .bind(desired,desired,desired,input.deliveryId)
    ]);
  }
  const balance = await cooperativeCreditBalance(env,input.customerId,input.cooperativeId);
  return {previousCents:previous,currentCents:desired,balanceCents:balance,deltaCents:delta};
}
