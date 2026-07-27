import type { Env } from '../types';
import { reconcileDriverFinancialBalance } from './financial-settlement';

function makeId(): string { return crypto.randomUUID().replace(/-/g, ''); }
type Row=Record<string,any>;

async function scheduleRow(env:Env,cooperativeId:string,scheduleId:string):Promise<Row|null>{
  return env.DB.prepare(`
    SELECT s.id,s.cooperative_id,s.driver_id,s.establishment_id,s.base_id,s.shift_template_id,s.start_at,s.end_at,
      COALESCE(s.guaranteed_cents,0) guaranteed_cents,
      e.name establishment_name,b.name base_name,c.inss_percent,c.sest_senat_percent,
      a.declared_total_cents,a.notes adjustment_notes
    FROM schedules s
    LEFT JOIN establishments e ON e.id=s.establishment_id
    LEFT JOIN bases b ON b.id=s.base_id
    LEFT JOIN cooperatives c ON c.id=s.cooperative_id
    LEFT JOIN guarantee_turn_adjustments a ON a.schedule_id=s.id
    WHERE s.id=? AND s.cooperative_id=? AND s.deleted_at IS NULL
      AND s.status IN ('scheduled','confirmed','completed')
  `).bind(scheduleId,cooperativeId).first<Row>();
}

async function eligibleDeliveryTotal(env:Env,schedule:Row):Promise<number>{
  if(schedule.declared_total_cents!=null)return Math.max(0,Number(schedule.declared_total_cents||0));
  if(!schedule.establishment_id)return 0;

  // Os horários da escala são gravados no horário local de Brasília, enquanto os
  // carimbos automáticos das entregas são UTC. Para correlacionar corretamente,
  // usamos a hora em que a corrida foi lançada no estabelecimento convertida para
  // Brasília. O accepted_at fica como alternativa para registros antigos sem created_at.
  // Cada corrida pertence a um único turno; em sobreposição vence o horário mais
  // específico: início mais recente, término mais cedo e, por fim, o menor id.
  const serviceMoment=`datetime(COALESCE(deliveries.created_at,deliveries.accepted_at,deliveries.delivered_at,deliveries.updated_at),'-3 hours')`;
  const otherMoment=`datetime(COALESCE(deliveries.created_at,deliveries.accepted_at,deliveries.delivered_at,deliveries.updated_at),'-3 hours')`;
  await env.DB.prepare(`
    UPDATE deliveries
       SET guarantee_schedule_id=?,updated_at=CURRENT_TIMESTAMP
     WHERE cooperative_id=? AND assigned_driver_id=? AND establishment_id=?
       AND delivery_type='establishment' AND status='delivered' AND deleted_at IS NULL
       AND (guarantee_schedule_id IS NULL OR trim(guarantee_schedule_id)='')
       AND ${serviceMoment}>=datetime(?)
       AND ${serviceMoment}<=datetime(?)
       AND NOT EXISTS (
         SELECT 1 FROM schedules other
          WHERE other.id<>? AND other.cooperative_id=? AND other.driver_id=?
            AND other.establishment_id=? AND other.base_id IS NULL
            AND other.deleted_at IS NULL AND other.status IN ('scheduled','confirmed','completed')
            AND ${otherMoment}>=datetime(other.start_at)
            AND ${otherMoment}<=datetime(other.end_at)
            AND (
              datetime(other.start_at)>datetime(?)
              OR (datetime(other.start_at)=datetime(?) AND datetime(other.end_at)<datetime(?))
              OR (datetime(other.start_at)=datetime(?) AND datetime(other.end_at)=datetime(?) AND other.id<?)
            )
       )
  `).bind(
    schedule.id,schedule.cooperative_id,schedule.driver_id,schedule.establishment_id,
    schedule.start_at,schedule.end_at,
    schedule.id,schedule.cooperative_id,schedule.driver_id,schedule.establishment_id,
    schedule.start_at,schedule.start_at,schedule.end_at,schedule.start_at,schedule.end_at,schedule.id
  ).run();

  // A soma usa primeiro o lançamento financeiro da corrida, pois é exatamente o
  // valor que entra como produção do cooperado. Registros antigos recebem fallback
  // para os campos financeiros da própria entrega, sem perder corridas já concluídas.
  const row=await env.DB.prepare(`
    SELECT COALESCE(SUM(
      COALESCE(
        NULLIF((
          SELECT MAX(f.amount_cents)
            FROM financial_entries f
           WHERE f.delivery_id=deliveries.id
             AND f.entry_type='credit' AND f.category='delivery'
             AND f.deleted_at IS NULL AND f.status!='cancelled'
        ),0),
        NULLIF(deliveries.driver_gross_cents,0),
        NULLIF(deliveries.driver_earnings_cents,0),
        CASE
          WHEN COALESCE(deliveries.charge_cents,0)>0
          THEN MAX(0,COALESCE(deliveries.charge_cents,0)-COALESCE(deliveries.cooperative_fee_cents,0))
          ELSE 0
        END
      )
    ),0) total
      FROM deliveries
     WHERE cooperative_id=? AND assigned_driver_id=? AND establishment_id=?
       AND delivery_type='establishment' AND status='delivered' AND deleted_at IS NULL
       AND guarantee_schedule_id=?
  `).bind(schedule.cooperative_id,schedule.driver_id,schedule.establishment_id,schedule.id).first<{total:number}>();
  return Math.max(0,Number(row?.total||0));
}

async function linkedEntries(env:Env,settlementId:string):Promise<Map<string,Row>>{
  const rows=await env.DB.prepare(`SELECT l.entry_kind,f.* FROM guarantee_settlement_financial_entries l JOIN financial_entries f ON f.id=l.financial_entry_id WHERE l.settlement_id=?`).bind(settlementId).all<Row>();
  return new Map((rows.results||[]).map(row=>[String(row.entry_kind),row]));
}

async function ensureFinancialEntry(env:Env,settlement:Row,schedule:Row,kind:'complement'|'inss'|'sest_senat',amount:number,description:string,category:string,entryType:'credit'|'debit',existing?:Row){
  const cents=Math.max(0,Math.round(amount));
  if(cents<=0){
    if(existing)await env.DB.prepare(`UPDATE financial_entries SET status='cancelled',deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(existing.id).run();
    return null;
  }
  if(existing){
    await env.DB.prepare(`UPDATE financial_entries SET amount_cents=?,settled_cents=0,status='open',deleted_at=NULL,description=?,category=?,reference_date=date(?),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(cents,description,category,schedule.end_at,existing.id).run();
    return existing.id;
  }
  const entryId=makeId();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO financial_entries(id,cooperative_id,driver_id,establishment_id,entry_type,category,description,amount_cents,settled_cents,reference_date,status)
      VALUES (?,?,?,?,?,?,?,?,0,date(?),'open')`).bind(entryId,schedule.cooperative_id,schedule.driver_id,schedule.establishment_id||null,entryType,category,description,cents,schedule.end_at),
    env.DB.prepare(`INSERT INTO guarantee_settlement_financial_entries(settlement_id,entry_kind,financial_entry_id) VALUES (?,?,?)`).bind(settlement.id,kind,entryId)
  ]);
  return entryId;
}

export async function recalculateGuaranteeSettlement(env:Env,cooperativeId:string,scheduleId:string):Promise<{guaranteed_cents:number;eligible_cents:number;complement_cents:number;settlement_id:string|null}>{
  const schedule=await scheduleRow(env,cooperativeId,scheduleId);
  if(!schedule||schedule.base_id||!schedule.establishment_id)return {guaranteed_cents:0,eligible_cents:0,complement_cents:0,settlement_id:null};
  const guaranteed=Math.max(0,Number(schedule.guaranteed_cents||0));
  const eligible=await eligibleDeliveryTotal(env,schedule);
  let settlement=await env.DB.prepare(`SELECT * FROM guarantee_settlements WHERE schedule_id=?`).bind(schedule.id).first<Row>();
  if(guaranteed<=0){
    if(settlement){
      const links=await linkedEntries(env,String(settlement.id));
      for(const row of links.values())await env.DB.prepare(`UPDATE financial_entries SET status='cancelled',deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.id).run();
      await env.DB.prepare(`UPDATE guarantee_settlements SET guaranteed_cents=0,eligible_delivery_cents=?,complement_cents=0,financial_entry_id=NULL,settled_at=CURRENT_TIMESTAMP WHERE id=?`).bind(eligible,settlement.id).run();
      await reconcileDriverFinancialBalance(env,cooperativeId,String(schedule.driver_id));
    }
    return {guaranteed_cents:0,eligible_cents:eligible,complement_cents:0,settlement_id:settlement?String(settlement.id):null};
  }
  const complement=Math.max(0,guaranteed-eligible);
  if(!settlement){
    const settlementId=makeId();
    await env.DB.prepare(`INSERT INTO guarantee_settlements(id,cooperative_id,schedule_id,driver_id,establishment_id,base_id,guaranteed_cents,eligible_delivery_cents,complement_cents,financial_entry_id)
      VALUES (?,?,?,?,?,?,?,?,?,NULL)`).bind(settlementId,schedule.cooperative_id,schedule.id,schedule.driver_id,schedule.establishment_id,null,guaranteed,eligible,complement).run();
    settlement={id:settlementId};
  }else{
    await env.DB.prepare(`UPDATE guarantee_settlements SET guaranteed_cents=?,eligible_delivery_cents=?,complement_cents=?,settled_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(guaranteed,eligible,complement,settlement.id).run();
  }
  const links=await linkedEntries(env,String(settlement.id));
  const location=schedule.establishment_name||'estabelecimento';
  // O complemento completa a produção do turno. A descrição continua identificando
  // que o valor veio do garantido, mas a categoria financeira deve ser 'delivery'
  // para entrar nos cards, relatórios e fechamento como produção do cooperado.
  const complementId=await ensureFinancialEntry(env,settlement,schedule,'complement',complement,`Complemento de garantido • ${location}`,'delivery','credit',links.get('complement'));
  const inss=Math.round(complement*Math.max(0,Number(schedule.inss_percent||0))/100);
  const sest=Math.round(complement*Math.max(0,Number(schedule.sest_senat_percent||0))/100);
  await ensureFinancialEntry(env,settlement,schedule,'inss',inss,`INSS sobre complemento de garantido • ${location}`,'INSS','debit',links.get('inss'));
  await ensureFinancialEntry(env,settlement,schedule,'sest_senat',sest,`SEST/SENAT sobre complemento de garantido • ${location}`,'SEST/SENAT','debit',links.get('sest_senat'));
  await env.DB.prepare(`UPDATE guarantee_settlements SET financial_entry_id=? WHERE id=?`).bind(complementId,settlement.id).run();
  await reconcileDriverFinancialBalance(env,cooperativeId,String(schedule.driver_id));
  return {guaranteed_cents:guaranteed,eligible_cents:eligible,complement_cents:complement,settlement_id:String(settlement.id)};
}

export async function settleDueGuarantees(env: Env, cooperativeId?: string | null): Promise<{ settled: number; totalComplementCents: number }> {
  let sql=`SELECT s.id,s.cooperative_id FROM schedules s
    WHERE s.deleted_at IS NULL AND s.status IN ('scheduled','confirmed','completed')
      AND s.establishment_id IS NOT NULL AND s.base_id IS NULL
      AND COALESCE(s.guaranteed_cents,0)>0
      AND datetime(s.end_at)<=datetime('now','-3 hours')`;
  const params:any[]=[];
  if(cooperativeId){sql+=` AND s.cooperative_id=?`;params.push(cooperativeId);}
  sql+=` ORDER BY s.end_at DESC LIMIT 500`;
  const rows=await env.DB.prepare(sql).bind(...params).all<Row>();
  let settled=0,totalComplementCents=0;
  for(const row of rows.results||[]){
    try{
      const result=await recalculateGuaranteeSettlement(env,String(row.cooperative_id),String(row.id));
      if(result.settlement_id){settled++;totalComplementCents+=result.complement_cents;}
    }catch(error){console.warn('Falha ao liquidar garantido:',error instanceof Error?error.message:String(error));}
  }
  return {settled,totalComplementCents};
}

