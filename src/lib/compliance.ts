import type { Env } from '../types';

type ComplianceRow = {
  id: string;
  status: string;
  compliance_suspended: number;
  compliance_override_until: string | null;
  cnh_number: string | null;
  cnh_expires_at: string | null;
  vehicle_document_number: string | null;
  vehicle_document_expires_at: string | null;
  driver_compliance_required: number;
};

export type ComplianceResult = {
  required: boolean;
  allowed: boolean;
  status: 'not_required' | 'pending' | 'approved' | 'released' | 'suspended';
  reason: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

export async function refreshDriverCompliance(env: Env, driverId: string): Promise<ComplianceResult> {
  const row = await env.DB.prepare(`
    SELECT d.id,d.status,d.compliance_suspended,d.compliance_override_until,
      d.cnh_number,d.cnh_expires_at,d.vehicle_document_number,d.vehicle_document_expires_at,
      c.driver_compliance_required
    FROM drivers d JOIN cooperatives c ON c.id=d.cooperative_id
    WHERE d.id=? AND d.deleted_at IS NULL LIMIT 1
  `).bind(driverId).first<ComplianceRow>();
  if (!row) return { required:false, allowed:false, status:'suspended', reason:'Cooperado não encontrado.' };

  const required = Boolean(row.driver_compliance_required);
  const now = today();
  const released = Boolean(row.compliance_override_until && row.compliance_override_until >= now);
  const missing = !row.cnh_number || !row.cnh_expires_at || !row.vehicle_document_number || !row.vehicle_document_expires_at;
  const expiredCnh = Boolean(row.cnh_expires_at && row.cnh_expires_at < now);
  const expiredVehicle = Boolean(row.vehicle_document_expires_at && row.vehicle_document_expires_at < now);

  let status: ComplianceResult['status'] = 'approved';
  let reason: string | null = null;
  if (!required) status = 'not_required';
  else if (released) status = 'released';
  else if (missing) { status = 'pending'; reason = 'Cadastre CNH e documento da moto e aguarde a aprovação.'; }
  else if (expiredCnh || expiredVehicle) {
    status = 'suspended';
    reason = expiredCnh && expiredVehicle ? 'CNH e documento da moto estão vencidos.' : expiredCnh ? 'A CNH está vencida.' : 'O documento da moto está vencido.';
  }

  const shouldSuspend = required && !released && (missing || expiredCnh || expiredVehicle);
  if (shouldSuspend) {
    // A suspensão documental impede trabalho, mas preserva o acesso ao aplicativo
    // para o cooperado atualizar os dados e acompanhar a nova aprovação.
    await env.DB.prepare(`UPDATE drivers SET compliance_status=?,compliance_suspended=1,online=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(status, row.id).run();
  } else {
    await env.DB.prepare(`UPDATE drivers SET compliance_status=?,compliance_suspended=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(status, row.id).run();
  }
  return { required, allowed:!shouldSuspend, status, reason };
}

export async function refreshCooperativeCompliance(env: Env, cooperativeId?: string | null): Promise<void> {
  let sql = `SELECT id FROM drivers WHERE deleted_at IS NULL`;
  const params: unknown[] = [];
  if (cooperativeId) { sql += ` AND cooperative_id=?`; params.push(cooperativeId); }
  const rows = await env.DB.prepare(sql).bind(...params).all<{ id: string }>();
  for (const item of rows.results || []) await refreshDriverCompliance(env, item.id);
}
