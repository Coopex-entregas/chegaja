import type { Env } from '../types';

export type FinancialRow = Record<string, any>;

const normalize = (value: unknown) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().toLowerCase().replace(/[\s-]+/g, '_');

export function baseReceivablePayment(method: unknown): boolean {
  return ['credit','credito','credito_antecipado','credito_pre_pago','credito_automatico','prepaid','pre_pago','pix_cooperativa'].includes(normalize(method));
}

// Na Base, somente PIX comum e dinheiro são recebidos diretamente pelo cooperado.
// Cartões e vales são formas de cobrança do pedido/mercadoria e nunca viram produção do cooperado.
export function baseDirectReceivedPayment(method: unknown): boolean {
  return ['pix','pix_comum','dinheiro','cash'].includes(normalize(method));
}

export function isDirectReceivedDelivery(row: FinancialRow): boolean {
  return row.entry_type === 'credit' && row.category === 'delivery' &&
    String(row.delivery_type || '') === 'base' && baseDirectReceivedPayment(row.payment_method);
}

export function isReceivableCredit(row: FinancialRow): boolean {
  if (String(row.entry_type || '') !== 'credit') return false;
  if (String(row.category || '') !== 'delivery' || !row.delivery_id) return true;
  if (String(row.delivery_type || '') === 'establishment') return true;
  return String(row.delivery_type || '') === 'base' && baseReceivablePayment(row.payment_method);
}

export function financialDebitPriority(category: unknown, description: unknown = ''): number {
  const value = normalize(`${category || ''} ${description || ''}`);
  if (value.includes('inss')) return 10;
  if (value.includes('sest') || value.includes('senat')) return 20;
  if (value.includes('advance') || value.includes('adiant')) return 30;
  if (value.includes('rateio') || value.includes('imposto') || value.includes('configured_deduction')) return 40;
  return 50;
}

export function cleanFinancialDescription(value: unknown): string {
  return String(value || '')
    .replace(/\s*[•·]\s*lote\s+[a-z0-9-]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function brDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function carryoverDescription(value: unknown, weekStart: string, weekEnd: string): string {
  const base = cleanFinancialDescription(value)
    .replace(/\s*[•·]\s*restante da semana\s+\d{2}\/\d{2}\/\d{4}\s+a\s+\d{2}\/\d{2}\/\d{4}/gi, '')
    .trim() || 'Desconto pendente';
  return `${base} • restante da semana ${brDate(weekStart)} a ${brDate(weekEnd)}`;
}

async function batchInChunks(env: Env, statements: D1PreparedStatement[], size = 75): Promise<void> {
  for (let index = 0; index < statements.length; index += size) {
    await env.DB.batch(statements.slice(index, index + size));
  }
}

export async function reconcileDriverFinancialBalance(env: Env, cooperativeId: string, driverId: string) {
  const lastClosing=await env.DB.prepare(`SELECT MAX(week_end) week_end FROM weekly_closings WHERE cooperative_id=? AND status='closed'`).bind(cooperativeId).first<{week_end:string|null}>();
  const closedThrough=String(lastClosing?.week_end||'1900-01-01');

  const rowsResult=await env.DB.prepare(`
    SELECT f.id,f.entry_type,f.amount_cents,COALESCE(f.settled_cents,0) settled_cents,f.status,f.category,
      f.description,f.delivery_id,f.reference_date,dl.delivery_type,dl.payment_method
    FROM financial_entries f
    LEFT JOIN deliveries dl ON dl.id=f.delivery_id
    WHERE f.cooperative_id=? AND f.driver_id=? AND f.deleted_at IS NULL AND f.status!='cancelled'
      AND (date(f.reference_date)>date(?) OR f.status='open')
    ORDER BY date(f.reference_date),datetime(f.created_at),f.id
  `).bind(cooperativeId,driverId,closedThrough).all<FinancialRow>();

  const statements:D1PreparedStatement[]=[];
  let receivableOpen=0;
  let pendingDebits=0;
  for(const row of rowsResult.results||[]){
    const amount=Math.max(0,Number(row.amount_cents||0));
    const isCurrent=String(row.reference_date||'').slice(0,10)>closedThrough;
    if(isDirectReceivedDelivery(row)){
      if(Number(row.settled_cents||0)!==amount||row.status!=='paid'){
        statements.push(env.DB.prepare(`UPDATE financial_entries SET settled_cents=amount_cents,status='paid',description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(cleanFinancialDescription(row.description),row.id));
      }
      continue;
    }
    if(isCurrent){
      // A semana ainda não fechada é apenas uma prévia. Produção para fechamento e
      // descontos ficam em aberto; a liquidação definitiva acontece ao fechar a semana.
      if(Number(row.settled_cents||0)!==0||row.status!=='open'||cleanFinancialDescription(row.description)!==String(row.description||'')){
        statements.push(env.DB.prepare(`UPDATE financial_entries SET settled_cents=0,status='open',description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(cleanFinancialDescription(row.description),row.id));
      }
      if(row.entry_type==='credit'&&isReceivableCredit(row))receivableOpen+=amount;
      else if(row.entry_type==='debit')pendingDebits+=amount;
      continue;
    }
    // Saldo de semanas fechadas: somente lançamentos ainda em aberto seguem para a próxima.
    const remaining=Math.max(0,amount-Math.max(0,Number(row.settled_cents||0)));
    if(row.status==='open'){
      if(row.entry_type==='credit'&&isReceivableCredit(row))receivableOpen+=remaining;
      else if(row.entry_type==='debit')pendingDebits+=remaining;
    }
    const cleaned=cleanFinancialDescription(row.description);
    if(cleaned!==String(row.description||''))statements.push(env.DB.prepare(`UPDATE financial_entries SET description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(cleaned,row.id));
  }
  if(statements.length)await batchInChunks(env,statements);
  return {applied_cents:0,receivable_open_cents:receivableOpen,pending_debits_cents:pendingDebits,balance_cents:receivableOpen-pendingDebits,closed_through:closedThrough};
}

export async function reconcileCooperativeFinancialBalances(env: Env, cooperativeId: string, driverId?: string | null) {
  const params: any[] = [cooperativeId];
  let sql = `SELECT DISTINCT driver_id FROM financial_entries WHERE cooperative_id=? AND deleted_at IS NULL AND status!='cancelled'`;
  if (driverId) { sql += ` AND driver_id=?`; params.push(driverId); }
  const rows = await env.DB.prepare(sql).bind(...params).all<{driver_id:string}>();
  const results = [];
  for (const row of rows.results || []) results.push(await reconcileDriverFinancialBalance(env, cooperativeId, row.driver_id));
  return results;
}
