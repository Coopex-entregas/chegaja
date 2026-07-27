import { Hono, type Context } from 'hono';
import type { AppBindings, AuthUser } from '../types';
import { assertRole, bodyJson, cleanText, id, nullableText, toCents } from '../lib/util';

export const platformV21Routes = new Hono<AppBindings>();
type Row = Record<string, any>;
type AssignmentKind = 'contract' | 'base' | 'establishment' | 'day_off' | 'leave';

function tenant(c: Context<AppBindings>, roles: AuthUser['role'][]): AuthUser {
  const auth = c.get('auth');
  assertRole(auth, roles);
  if (!auth.cooperativeId) throw new Error('Cooperativa não vinculada.');
  return auth;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function mondayOf(input: string): string {
  const safe = validDate(input) ? input : new Date().toISOString().slice(0, 10);
  const parsed = new Date(`${safe}T12:00:00Z`);
  const day = parsed.getUTCDay();
  parsed.setUTCDate(parsed.getUTCDate() - (day === 0 ? 6 : day - 1));
  return parsed.toISOString().slice(0, 10);
}

function localIso(date: string, time: string, nextDay = false): string {
  return `${nextDay ? addDays(date, 1) : date}T${time}:00`;
}

function brazilToday(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function onLeaveAt(driver: Row | undefined, date: string): boolean {
  if (!driver || Number(driver.on_leave || 0) !== 1) return false;
  const start = String(driver.leave_start_date || '');
  const end = String(driver.leave_return_date || '');
  return (!start || date >= start) && (!end || date < end);
}

async function normalizeReturns(c: Context<AppBindings>, cooperativeId: string): Promise<void> {
  await c.env.DB.prepare(`
    UPDATE drivers
       SET on_leave=0,
           leave_start_date=NULL,
           leave_reason=NULL,
           updated_at=CURRENT_TIMESTAMP
     WHERE cooperative_id=?
       AND on_leave=1
       AND leave_return_date IS NOT NULL
       AND date(leave_return_date)<=date(?)
  `).bind(cooperativeId, brazilToday()).run();
}

async function batchChunks(db: D1Database, statements: D1PreparedStatement[], size = 70): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += size) {
    await db.batch(statements.slice(offset, offset + size));
  }
}

function defaultTimes(slot: number): { turn: string; start: string; end: string } {
  return slot === 1
    ? { turn: 'DIA', start: '08:00', end: '12:00' }
    : { turn: 'NOITE', start: '18:00', end: '22:00' };
}

function rowKey(driverId: string, dayIndex: number, rowOrder: number): string {
  return `${driverId}:${dayIndex}:${rowOrder}`;
}

function assignmentFrom(row: Row): AssignmentKind {
  if (String(row.entry_type) === 'leave') return 'leave';
  if (String(row.entry_type) !== 'work') return 'day_off';
  if (row.base_id) return 'base';
  if (row.contract_id) return 'contract';
  if (row.establishment_id) return 'establishment';
  return 'day_off';
}

function dateTimeFor(row: Row, field: 'start_time' | 'end_time'): string | null {
  const time = String(row[field] || '');
  if (!validTime(time)) return null;
  const nextDay = field === 'end_time' && String(row.end_time) <= String(row.start_time);
  return localIso(String(row.date), time, nextDay);
}

function assignmentLabel(row: Row): string {
  if (row.entry_type === 'leave' || row.assignment_type === 'leave') return 'AFASTADO';
  if (row.entry_type !== 'work' || row.assignment_type === 'day_off') return 'FOLGA';
  if (row.assignment_type === 'base') return `BASE — ${row.base_name || 'Base'}`;
  if (row.assignment_type === 'establishment') return `${row.establishment_name || 'Estabelecimento'}`;
  return `${row.contract_name || 'Contrato'}`;
}

function locationKey(row: Row): string {
  if (row.base_id) return `base:${row.base_id}`;
  if (row.establishment_id) return `establishment:${row.establishment_id}`;
  if (row.contract_id) return `contract:${row.contract_id}`;
  return '';
}

async function ensureRowsV21(
  c: Context<AppBindings>,
  cooperativeId: string,
  week: string,
  createdBy: string,
): Promise<void> {
  const previousWeek = addDays(week, -7);
  const [
    driversResult,
    existingResult,
    legacyDrafts,
    publishedResult,
    targetPublication,
    previousRowsResult,
    previousPublishedResult,
  ] = await Promise.all([
    c.env.DB.prepare(`
      SELECT id,name,status,on_leave,leave_start_date,leave_return_date,leave_reason
        FROM drivers
       WHERE cooperative_id=? AND deleted_at IS NULL AND status='active'
       ORDER BY name COLLATE NOCASE
    `).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`
      SELECT * FROM schedule_week_rows
       WHERE cooperative_id=? AND week_start=? AND active=1
       ORDER BY group_driver_id,day_index,row_order,created_at
    `).bind(cooperativeId, week).all<Row>(),
    c.env.DB.prepare(`
      SELECT * FROM schedule_week_drafts
       WHERE cooperative_id=? AND week_start=?
    `).bind(cooperativeId, week).all<Row>(),
    c.env.DB.prepare(`
      SELECT * FROM schedules
       WHERE cooperative_id=?
         AND deleted_at IS NULL
         AND status!='cancelled'
         AND date(start_at) BETWEEN date(?) AND date(?)
         AND (publication_week_start=? OR week_start=?)
    `).bind(cooperativeId, week, addDays(week, 6), week, week).all<Row>(),
    c.env.DB.prepare(`
      SELECT status,published_at FROM schedule_week_publications
       WHERE cooperative_id=? AND week_start=? LIMIT 1
    `).bind(cooperativeId, week).first<Row>(),
    c.env.DB.prepare(`
      SELECT * FROM schedule_week_rows
       WHERE cooperative_id=? AND week_start=? AND active=1
       ORDER BY group_driver_id,day_index,row_order,created_at
    `).bind(cooperativeId, previousWeek).all<Row>(),
    c.env.DB.prepare(`
      SELECT * FROM schedules
       WHERE cooperative_id=?
         AND deleted_at IS NULL
         AND status!='cancelled'
         AND date(start_at) BETWEEN date(?) AND date(?)
         AND (publication_week_start=? OR week_start=?)
       ORDER BY template_driver_id,date(start_at),slot_index,sort_order,start_at
    `).bind(cooperativeId, previousWeek, addDays(previousWeek, 6), previousWeek, previousWeek).all<Row>(),
  ]);

  const drivers = driversResult.results || [];
  const existingRows = existingResult.results || [];
  const existing = new Set(
    existingRows.map(row => rowKey(String(row.group_driver_id), Number(row.day_index), Number(row.row_order))),
  );
  const draftMap = new Map<string, Row>();
  for (const row of legacyDrafts.results || []) {
    draftMap.set(rowKey(String(row.template_driver_id), Number(row.day_index), Number(row.slot_index)), row);
  }
  const publishedMap = new Map<string, Row>();
  for (const row of publishedResult.results || []) {
    const dayIndex = Math.round(
      (Date.parse(`${String(row.start_at).slice(0, 10)}T12:00:00Z`) - Date.parse(`${week}T12:00:00Z`)) / 86400000,
    );
    const rowOrder = Number(row.slot_index || row.sort_order || 0);
    const groupId = String(row.template_driver_id || row.driver_id || '');
    if (groupId && dayIndex >= 0 && dayIndex <= 6 && rowOrder > 0) {
      publishedMap.set(rowKey(groupId, dayIndex, rowOrder), row);
    }
  }

  const previousRows = previousRowsResult.results || [];
  const previousMeaningful = previousRows.some(row =>
    String(row.entry_type || 'day_off') !== 'day_off'
    || String(row.assignment_type || 'day_off') !== 'day_off'
    || Number(row.row_order || 0) > 2
    || Boolean(row.contract_id || row.base_id || row.establishment_id || row.shift_template_id)
    || Boolean(String(row.notes || '').trim()),
  );
  let copySource: Row[] = previousMeaningful ? previousRows : [];

  // Compatibilidade com escalas antigas já enviadas antes da grade em planilha.
  // Quando a semana anterior não possui linhas úteis em schedule_week_rows,
  // reconstrói a fonte a partir das escalas publicadas.
  if (!copySource.length && (previousPublishedResult.results || []).length) {
    copySource = (previousPublishedResult.results || []).map(source => {
      const sourceDate = String(source.start_at || '').slice(0, 10);
      const dayIndex = Math.round(
        (Date.parse(`${sourceDate}T12:00:00Z`) - Date.parse(`${previousWeek}T12:00:00Z`)) / 86400000,
      );
      const rowOrder = Math.max(1, Number(source.slot_index || source.sort_order || 1));
      const entryType = ['work', 'day_off', 'leave'].includes(String(source.entry_type))
        ? String(source.entry_type)
        : 'work';
      return {
        ...source,
        group_driver_id: source.template_driver_id || source.driver_id,
        day_index: dayIndex,
        row_order: rowOrder,
        turn_label: rowOrder === 1 ? 'DIA' : 'NOITE',
        entry_type: entryType,
        assignment_type: entryType === 'work' ? assignmentFrom(source) : entryType === 'leave' ? 'leave' : 'day_off',
        start_time: String(source.start_at || '').slice(11, 16),
        end_time: String(source.end_at || '').slice(11, 16),
        is_default: rowOrder <= 2 ? 1 : 0,
        active: 1,
        leave_auto: 0,
      };
    }).filter(source => Number(source.day_index) >= 0 && Number(source.day_index) <= 6);
  }

  const driverIds = new Set(drivers.map(driver => String(driver.id)));
  const driverMap = new Map(drivers.map(driver => [String(driver.id), driver]));
  const statements: D1PreparedStatement[] = [];

  const targetIsPristine = !targetPublication
    && (publishedResult.results || []).length === 0
    && existingRows.every(row =>
      String(row.entry_type || 'day_off') === 'day_off'
      && String(row.assignment_type || 'day_off') === 'day_off'
      && String(row.driver_id || '') === String(row.group_driver_id || '')
      && !row.contract_id && !row.base_id && !row.establishment_id && !row.shift_template_id
      && !String(row.notes || '').trim()
      && Number(row.guaranteed_cents || 0) === 0,
    );
  const currentMonday = mondayOf(brazilToday());
  const shouldCopyPrevious = week >= currentMonday
    && copySource.length > 0
    && (existingRows.length === 0 || targetIsPristine);

  // A semana atual ou futura, quando ainda está vazia ou apenas com as 14 linhas
  // automáticas em FOLGA, recebe uma cópia exata da semana anterior. Isso também
  // corrige semanas que já haviam sido abertas antes desta versão e ficaram vazias.
  if (shouldCopyPrevious) {
    if (existingRows.length) {
      statements.push(c.env.DB.prepare(`
        UPDATE schedule_week_rows
           SET active=0,updated_at=CURRENT_TIMESTAMP
         WHERE cooperative_id=? AND week_start=? AND active=1
      `).bind(cooperativeId, week));
      existing.clear();
    }

    for (const source of copySource) {
      const groupId = String(source.group_driver_id || source.template_driver_id || source.driver_id || '');
      if (!driverIds.has(groupId)) continue;
      const dayIndex = Number(source.day_index);
      const rowOrder = Number(source.row_order || source.slot_index || source.sort_order || 1);
      if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6 || !Number.isInteger(rowOrder) || rowOrder < 1) continue;
      const key = rowKey(groupId, dayIndex, rowOrder);
      if (existing.has(key)) continue;

      const group = driverMap.get(groupId)!;
      const requestedDriverId = String(source.driver_id || groupId);
      const assignedDriverId = driverIds.has(requestedDriverId) ? requestedDriverId : groupId;
      const assigned = driverMap.get(assignedDriverId) || group;
      const date = addDays(week, dayIndex);
      const forcedLeave = onLeaveAt(group, date) || onLeaveAt(assigned, date);
      const sourceEntry = ['work', 'day_off', 'leave'].includes(String(source.entry_type))
        ? String(source.entry_type)
        : 'day_off';
      const previousAutoLeave = sourceEntry === 'leave' && Number(source.leave_auto || 0) === 1;
      const entryType = forcedLeave ? 'leave' : previousAutoLeave ? 'day_off' : sourceEntry;
      const assignmentType = entryType === 'work'
        ? assignmentFrom(source)
        : entryType === 'leave' ? 'leave' : 'day_off';
      const preset = defaultTimes(rowOrder === 1 ? 1 : 2);
      const start = entryType === 'work' && validTime(String(source.start_time || ''))
        ? String(source.start_time)
        : preset.start;
      const end = entryType === 'work' && validTime(String(source.end_time || ''))
        ? String(source.end_time)
        : preset.end;

      statements.push(c.env.DB.prepare(`
        INSERT INTO schedule_week_rows(
          id,cooperative_id,week_start,group_driver_id,driver_id,day_index,row_order,turn_label,
          entry_type,assignment_type,contract_id,base_id,establishment_id,shift_template_id,
          start_time,end_time,shift_label,guaranteed_cents,notes,is_default,active,leave_auto,created_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
      `).bind(
        id(), cooperativeId, week, groupId, assignedDriverId, dayIndex, rowOrder,
        cleanText(source.turn_label || preset.turn, 20) || preset.turn,
        entryType, assignmentType,
        entryType === 'work' ? source.contract_id || null : null,
        entryType === 'work' ? source.base_id || null : null,
        entryType === 'work' ? source.establishment_id || null : null,
        entryType === 'work' ? source.shift_template_id || null : null,
        start, end,
        entryType === 'work' ? source.shift_label || null : entryType === 'leave' ? 'AFASTADO' : 'FOLGA',
        entryType === 'work' ? Math.max(0, Number(source.guaranteed_cents || 0)) : 0,
        source.notes || null,
        Number(source.is_default || 0) === 1 || rowOrder <= 2 ? 1 : 0,
        forcedLeave ? 1 : 0,
        createdBy,
      ));
      existing.add(key);
    }
  }

  // Cooperados novos, que não existiam na semana copiada, começam com suas 14
  // linhas padrão em FOLGA. Nenhuma escala de outro cooperado é atribuída a eles.
  for (const group of drivers) {
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      for (let rowOrder = 1; rowOrder <= 2; rowOrder += 1) {
        const key = rowKey(String(group.id), dayIndex, rowOrder);
        if (existing.has(key)) continue;
        const legacy = draftMap.get(key) || publishedMap.get(key);
        const date = addDays(week, dayIndex);
        const preset = defaultTimes(rowOrder);
        const assignedDriverId = legacy && driverIds.has(String(legacy.driver_id))
          ? String(legacy.driver_id)
          : String(group.id);
        const assigned = drivers.find(driver => String(driver.id) === assignedDriverId);
        const leave = onLeaveAt(group, date) || onLeaveAt(assigned, date);
        const legacyEntry = String(legacy?.entry_type || 'day_off');
        const entryType = leave
          ? 'leave'
          : legacyEntry === 'work'
            ? 'work'
            : legacyEntry === 'leave'
              ? 'leave'
              : 'day_off';
        const assignmentType = leave ? 'leave' : assignmentFrom({ ...legacy, entry_type: entryType });
        const legacyStart = String(legacy?.start_time || String(legacy?.start_at || '').slice(11, 16));
        const legacyEnd = String(legacy?.end_time || String(legacy?.end_at || '').slice(11, 16));
        const start = entryType === 'work' && validTime(legacyStart) ? legacyStart : preset.start;
        const end = entryType === 'work' && validTime(legacyEnd) ? legacyEnd : preset.end;
        statements.push(c.env.DB.prepare(`
          INSERT INTO schedule_week_rows(
            id,cooperative_id,week_start,group_driver_id,driver_id,day_index,row_order,turn_label,
            entry_type,assignment_type,contract_id,base_id,establishment_id,shift_template_id,
            start_time,end_time,shift_label,guaranteed_cents,notes,is_default,active,leave_auto,created_by
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
        `).bind(
          id(), cooperativeId, week, group.id, assignedDriverId, dayIndex, rowOrder, preset.turn,
          entryType, assignmentType, legacy?.contract_id || null, legacy?.base_id || null,
          legacy?.establishment_id || null, legacy?.shift_template_id || null, start, end,
          legacy?.shift_label || null, Math.max(0, Number(legacy?.guaranteed_cents || 0)),
          legacy?.notes || null, 1, leave ? 1 : 0, createdBy,
        ));
        existing.add(key);
      }
    }
  }
  if (statements.length) await batchChunks(c.env.DB, statements);
}

function warningsV21(rows: Row[]): string[] {
  const warnings: string[] = [];
  const byDriverDay = new Map<string, Row[]>();
  for (const row of rows) {
    if (row.entry_type !== 'work' || !row.driver_id || !validTime(String(row.start_time)) || !validTime(String(row.end_time))) continue;
    const key = `${row.driver_id}:${row.date}`;
    const list = byDriverDay.get(key) || [];
    list.push(row);
    byDriverDay.set(key, list);
  }

  for (const list of byDriverDay.values()) {
    const byTurn = new Map<string, Row[]>();
    const exact = new Map<string, Row[]>();
    for (const row of list) {
      const turn = String(row.turn_label || 'DIA');
      const turnRows = byTurn.get(turn) || [];
      turnRows.push(row);
      byTurn.set(turn, turnRows);
      const exactKey = `${row.start_time}-${row.end_time}`;
      const exactRows = exact.get(exactKey) || [];
      exactRows.push(row);
      exact.set(exactKey, exactRows);
    }
    for (const sameTurn of byTurn.values()) {
      if (sameTurn.length > 1) {
        const row = sameTurn[0];
        warnings.push(`ATENÇÃO: ${row.driver_name} está escalado ${sameTurn.length} vezes no turno ${row.turn_label} em ${row.date}.`);
      }
    }
    for (const sameTime of exact.values()) {
      if (sameTime.length > 1) {
        const row = sameTime[0];
        warnings.push(`ATENÇÃO: ${row.driver_name} aparece ${sameTime.length} vezes no mesmo horário (${row.start_time} às ${row.end_time}) em ${row.date}.`);
      }
    }

    list.sort((a, b) => String(dateTimeFor(a, 'start_time') || '').localeCompare(String(dateTimeFor(b, 'start_time') || '')));
    for (let first = 0; first < list.length; first += 1) {
      for (let second = first + 1; second < list.length; second += 1) {
        const a = list[first];
        const b = list[second];
        const aStart = dateTimeFor(a, 'start_time');
        const aEnd = dateTimeFor(a, 'end_time');
        const bStart = dateTimeFor(b, 'start_time');
        const bEnd = dateTimeFor(b, 'end_time');
        if (!aStart || !aEnd || !bStart || !bEnd) continue;
        const startA = new Date(aStart).getTime();
        const endA = new Date(aEnd).getTime();
        const startB = new Date(bStart).getTime();
        const endB = new Date(bEnd).getTime();
        const sameExact = a.start_time === b.start_time && a.end_time === b.end_time;
        if (startA < endB && startB < endA && !sameExact) {
          const overlap = Math.max(1, Math.round((Math.min(endA, endB) - Math.max(startA, startB)) / 60000));
          warnings.push(`ATENÇÃO: ${b.driver_name} tem escalas sobrepostas por ${overlap} min em ${b.date}: ${assignmentLabel(a)} e ${assignmentLabel(b)}. A escala foi mantida.`);
        }
        const firstLocation = locationKey(a);
        const secondLocation = locationKey(b);
        if (startB >= endA && startB - endA <= 45 * 60000 && firstLocation && secondLocation && firstLocation !== secondLocation) {
          const gap = Math.round((startB - endA) / 60000);
          if (gap === 0) {
            warnings.push(`ATENÇÃO: ${b.driver_name} termina ${a.end_time} em ${assignmentLabel(a)} e começa ${b.start_time} em ${assignmentLabel(b)}. Não há tempo de deslocamento; a escala foi mantida.`);
          } else {
            warnings.push(`ATENÇÃO: ${b.driver_name} tem somente ${gap} min para sair de ${assignmentLabel(a)} e chegar a ${assignmentLabel(b)} em ${b.date}.`);
          }
        }
      }
    }
  }
  return [...new Set(warnings)];
}

function countsV21(rows: Row[]): Row[] {
  const map = new Map<string, Row>();
  for (const row of rows) {
    if (row.entry_type !== 'work') continue;
    const label = assignmentLabel(row);
    const hours = `${row.start_time || '--:--'} às ${row.end_time || '--:--'}`;
    const key = `${row.day_index}|${label}|${hours}`;
    const item = map.get(key) || {
      day_index: Number(row.day_index),
      assignment_label: label,
      hours,
      count: 0,
      drivers: new Set<string>(),
    };
    item.count += 1;
    item.drivers.add(String(row.driver_id));
    map.set(key, item);
  }
  const output: Row[] = [...map.values()]
    .map(item => ({ ...item, driver_count: item.drivers.size, drivers: undefined }));
  return output.sort((a, b) => Number(a.day_index) - Number(b.day_index)
    || String(a.assignment_label).localeCompare(String(b.assignment_label), 'pt-BR')
    || String(a.hours).localeCompare(String(b.hours)));
}

function normalizedName(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('pt-BR');
}

function isTechnicalBaseContract(contract: Row, virtualBaseEstablishmentIds: Set<string>): boolean {
  return normalizedName(contract.name) === 'base'
    && virtualBaseEstablishmentIds.has(String(contract.establishment_id || ''));
}

function workplacesV21(contracts: Row[], bases: Row[], establishments: Row[]): Row[] {
  // Toda Base possui um estabelecimento virtual interno para operar entregas.
  // O estabelecimento virtual e o antigo contrato técnico chamado BASE não podem
  // aparecer como opções separadas da Base verdadeira.
  const virtualBaseEstablishmentIds = new Set(
    bases
      .map(item => String(item.virtual_establishment_id || ''))
      .filter(Boolean),
  );
  const visibleContracts = contracts.filter(
    item => !isTechnicalBaseContract(item, virtualBaseEstablishmentIds),
  );
  const contractEstablishmentIds = new Set(
    visibleContracts
      .map(item => String(item.establishment_id || ''))
      .filter(Boolean),
  );
  const visibleEstablishments = establishments.filter(
    item => !virtualBaseEstablishmentIds.has(String(item.id))
      && !contractEstablishmentIds.has(String(item.id)),
  );

  const items = [
    ...bases.map(item => ({
      value: `base:${item.id}`,
      kind: 'base',
      id: item.id,
      name: item.name,
      label: `BASE — ${item.name}`,
      establishment_id: null,
    })),
    ...visibleContracts.map(item => ({
      value: `contract:${item.id}`,
      kind: 'contract',
      id: item.id,
      name: item.name,
      label: item.establishment_name ? `${item.name} — ${item.establishment_name}` : item.name,
      establishment_id: item.establishment_id || null,
    })),
    ...visibleEstablishments.map(item => ({
      value: `establishment:${item.id}`,
      kind: 'establishment',
      id: item.id,
      name: item.name,
      label: item.name,
      establishment_id: item.id,
    })),
  ];

  // Proteção adicional contra registros repetidos no banco ou respostas antigas em cache.
  const unique = new Map<string, Row>();
  for (const item of items) {
    if (!unique.has(String(item.value))) unique.set(String(item.value), item);
  }
  return [...unique.values()].sort(
    (a, b) => String(a.label).localeCompare(String(b.label), 'pt-BR'),
  );
}

async function loadMatrixV21(
  c: Context<AppBindings>,
  cooperativeId: string,
  weekInput: string,
  createdBy: string,
): Promise<Row> {
  await normalizeReturns(c, cooperativeId);
  const week = mondayOf(weekInput);
  await ensureRowsV21(c, cooperativeId, week, createdBy);

  const [driversResult, contractsResult, basesResult, establishmentsResult, shiftsResult, rowsResult, blocksResult, publication] = await Promise.all([
    c.env.DB.prepare(`
      SELECT id,name,status,on_leave,leave_start_date,leave_return_date,leave_reason,vehicle_plate,vehicle_model
        FROM drivers
       WHERE cooperative_id=? AND deleted_at IS NULL AND status='active'
       ORDER BY name COLLATE NOCASE
    `).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`
      SELECT ct.id,ct.name,ct.establishment_id,e.name establishment_name
        FROM contracts ct
        LEFT JOIN establishments e ON e.id=ct.establishment_id AND e.deleted_at IS NULL
       WHERE ct.cooperative_id=? AND ct.active=1 AND ct.deleted_at IS NULL
       ORDER BY ct.name COLLATE NOCASE
    `).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`
      SELECT id,name,address,virtual_establishment_id
        FROM bases
       WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL
       ORDER BY name COLLATE NOCASE
    `).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`
      SELECT id,name,address
        FROM establishments
       WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL
       ORDER BY name COLLATE NOCASE
    `).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`
      SELECT id,name,start_time,end_time,shift_label,contract_id,establishment_id,base_id,guaranteed_cents
        FROM shift_templates
       WHERE cooperative_id=? AND active=1 AND deleted_at IS NULL
       ORDER BY start_time,name COLLATE NOCASE
    `).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`
      SELECT * FROM schedule_week_rows
       WHERE cooperative_id=? AND week_start=? AND active=1
       ORDER BY group_driver_id,day_index,row_order,created_at
    `).bind(cooperativeId, week).all<Row>(),
    c.env.DB.prepare(`
      SELECT driver_id,establishment_id,reason
        FROM driver_establishment_blocks
       WHERE cooperative_id=? AND active=1
    `).bind(cooperativeId).all<Row>(),
    c.env.DB.prepare(`
      SELECT * FROM schedule_week_publications
       WHERE cooperative_id=? AND week_start=?
       LIMIT 1
    `).bind(cooperativeId, week).first<Row>(),
  ]);

  const drivers = driversResult.results || [];
  const contracts = contractsResult.results || [];
  const bases = basesResult.results || [];
  const establishments = establishmentsResult.results || [];
  const rawShifts = shiftsResult.results || [];
  const driverMap = new Map(drivers.map(item => [String(item.id), item]));
  const contractMap = new Map(contracts.map(item => [String(item.id), item]));
  const baseMap = new Map(bases.map(item => [String(item.id), item]));
  const establishmentMap = new Map(establishments.map(item => [String(item.id), item]));
  const baseByVirtualEstablishment = new Map(
    bases
      .filter(item => item.virtual_establishment_id)
      .map(item => [String(item.virtual_establishment_id), item]),
  );
  const technicalBaseContractToBase = new Map<string, Row>();
  for (const contract of contracts) {
    const base = baseByVirtualEstablishment.get(String(contract.establishment_id || ''));
    if (base && normalizedName(contract.name) === 'base') {
      technicalBaseContractToBase.set(String(contract.id), base);
    }
  }
  const shifts = rawShifts.map(shift => {
    const legacyBase = baseByVirtualEstablishment.get(String(shift.establishment_id || ''))
      || technicalBaseContractToBase.get(String(shift.contract_id || ''));
    if (!shift.base_id && legacyBase) {
      return {
        ...shift,
        base_id: legacyBase.id,
        contract_id: null,
        establishment_id: null,
        scope_repaired: 1,
      };
    }
    return shift;
  });
  const rows: Row[] = [];
  const repairs: D1PreparedStatement[] = [];

  for (const original of rowsResult.results || []) {
    const group = driverMap.get(String(original.group_driver_id));
    if (!group) continue;
    let assigned = driverMap.get(String(original.driver_id));
    const row: Row = { ...original, date: addDays(week, Number(original.day_index)) };
    if (!assigned) {
      assigned = group;
      row.driver_id = group.id;
      repairs.push(c.env.DB.prepare(`
        UPDATE schedule_week_rows SET driver_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(group.id, row.id));
    }
    row.group_driver_name = group.name || 'Cooperado';
    row.driver_name = assigned.name || row.group_driver_name;

    const legacyBase = technicalBaseContractToBase.get(String(row.contract_id || ''))
      || baseByVirtualEstablishment.get(String(row.establishment_id || ''));
    if (row.entry_type === 'work' && !row.base_id && legacyBase) {
      Object.assign(row, {
        assignment_type: 'base',
        contract_id: null,
        base_id: legacyBase.id,
        establishment_id: null,
      });
      repairs.push(c.env.DB.prepare(`
        UPDATE schedule_week_rows
           SET assignment_type='base',contract_id=NULL,base_id=?,establishment_id=NULL,
               updated_at=CURRENT_TIMESTAMP
         WHERE id=?
      `).bind(legacyBase.id, row.id));
    }

    const forcedLeave = onLeaveAt(assigned, row.date);
    const returnedForThisDate = Number(row.leave_auto || 0) === 1
      && assigned.leave_return_date
      && row.date >= String(assigned.leave_return_date)
      && !forcedLeave;
    if (forcedLeave && (row.entry_type !== 'leave' || row.assignment_type !== 'leave')) {
      Object.assign(row, {
        entry_type: 'leave',
        assignment_type: 'leave',
        contract_id: null,
        base_id: null,
        establishment_id: null,
        shift_template_id: null,
        shift_label: 'AFASTADO',
        leave_auto: 1,
      });
      repairs.push(c.env.DB.prepare(`
        UPDATE schedule_week_rows
           SET entry_type='leave',assignment_type='leave',contract_id=NULL,base_id=NULL,
               establishment_id=NULL,shift_template_id=NULL,shift_label='AFASTADO',leave_auto=1,
               updated_at=CURRENT_TIMESTAMP
         WHERE id=?
      `).bind(row.id));
    } else if (returnedForThisDate) {
      Object.assign(row, {
        entry_type: 'day_off',
        assignment_type: 'day_off',
        contract_id: null,
        base_id: null,
        establishment_id: null,
        shift_template_id: null,
        shift_label: 'FOLGA',
        leave_auto: 0,
      });
      repairs.push(c.env.DB.prepare(`
        UPDATE schedule_week_rows
           SET entry_type='day_off',assignment_type='day_off',contract_id=NULL,base_id=NULL,
               establishment_id=NULL,shift_template_id=NULL,shift_label='FOLGA',leave_auto=0,
               updated_at=CURRENT_TIMESTAMP
         WHERE id=?
      `).bind(row.id));
    }

    const contract = contractMap.get(String(row.contract_id || ''));
    const base = baseMap.get(String(row.base_id || ''));
    const establishment = establishmentMap.get(String(row.establishment_id || contract?.establishment_id || ''));
    if (contract?.establishment_id && !row.establishment_id) row.establishment_id = contract.establishment_id;
    row.contract_name = contract?.name || null;
    row.base_name = base?.name || null;
    row.establishment_name = establishment?.name || contract?.establishment_name || null;
    row.assignment_label = assignmentLabel(row);
    row.assignment_value = row.entry_type === 'leave'
      ? 'leave'
      : row.entry_type !== 'work'
        ? 'day_off'
        : row.assignment_type === 'base'
          ? `base:${row.base_id}`
          : row.assignment_type === 'establishment'
            ? `establishment:${row.establishment_id}`
            : `contract:${row.contract_id}`;
    row.location_key = locationKey(row);
    rows.push(row);
  }
  if (repairs.length) await batchChunks(c.env.DB, repairs);

  const today = brazilToday();
  const returnAlerts = drivers.filter(driver => Number(driver.on_leave || 0) === 1
    && driver.leave_return_date
    && String(driver.leave_return_date) >= today
    && String(driver.leave_return_date) <= addDays(today, 7));

  return {
    week_start: week,
    week_end: addDays(week, 6),
    drivers,
    contracts,
    bases,
    establishments,
    workplaces: workplacesV21(contracts, bases, establishments),
    shifts,
    blocks: blocksResult.results || [],
    publication: publication || { status: 'draft', published_at: null },
    return_alerts: returnAlerts,
    rows,
    warnings: warningsV21(rows),
    counts: countsV21(rows),
  };
}

function effectiveShiftBaseIdV21(shift: Row): string {
  return String(
    shift.base_id
      || shift.legacy_base_from_establishment
      || shift.legacy_base_from_contract
      || '',
  );
}

function shiftFitsAssignmentV21(shift: Row, assignment: Row): boolean {
  if (assignment.assignment_type === 'base') {
    return Boolean(effectiveShiftBaseIdV21(shift))
      && effectiveShiftBaseIdV21(shift) === String(assignment.base_id);
  }
  if (assignment.assignment_type === 'establishment') {
    const establishmentId=shift.establishment_id||shift.contract_establishment_id;
    return Boolean(establishmentId)
      && String(establishmentId) === String(assignment.establishment_id);
  }
  if (assignment.assignment_type === 'contract') {
    return Boolean(shift.contract_id) && String(shift.contract_id) === String(assignment.contract_id);
  }
  return false;
}

function shiftScopePredicateV21(assignment: Row): { sql: string; params: unknown[] } {
  if (assignment.assignment_type === 'base') {
    return {
      sql: '(st.base_id=? OR legacy_establishment_base.id=? OR legacy_contract_base.id=?)',
      params: [assignment.base_id, assignment.base_id, assignment.base_id],
    };
  }
  if (assignment.assignment_type === 'establishment') {
    return { sql: '(st.establishment_id=? OR target_contract.establishment_id=?)', params: [assignment.establishment_id,assignment.establishment_id] };
  }
  if (assignment.assignment_type === 'contract') {
    return { sql: 'st.contract_id=?', params: [assignment.contract_id] };
  }
  return { sql: '1=0', params: [] };
}

async function findShiftForAssignmentV21(
  c: Context<AppBindings>,
  cooperativeId: string,
  assignment: Row,
  requestedShiftId: string,
  requestedStart: string,
  requestedEnd: string,
): Promise<Row | null> {
  const select = `
    SELECT st.*,
           target_contract.establishment_id contract_establishment_id,
           legacy_establishment_base.id legacy_base_from_establishment,
           legacy_contract_base.id legacy_base_from_contract
      FROM shift_templates st
      LEFT JOIN contracts target_contract
        ON target_contract.id=st.contract_id
       AND target_contract.cooperative_id=st.cooperative_id
       AND target_contract.active=1
       AND target_contract.deleted_at IS NULL
      LEFT JOIN bases legacy_establishment_base
        ON legacy_establishment_base.cooperative_id=st.cooperative_id
       AND legacy_establishment_base.virtual_establishment_id=st.establishment_id
       AND legacy_establishment_base.active=1
       AND legacy_establishment_base.deleted_at IS NULL
      LEFT JOIN contracts legacy_contract
        ON legacy_contract.id=st.contract_id
       AND legacy_contract.cooperative_id=st.cooperative_id
       AND legacy_contract.active=1
       AND legacy_contract.deleted_at IS NULL
       AND lower(trim(legacy_contract.name))='base'
      LEFT JOIN bases legacy_contract_base
        ON legacy_contract_base.cooperative_id=st.cooperative_id
       AND legacy_contract_base.virtual_establishment_id=legacy_contract.establishment_id
       AND legacy_contract_base.active=1
       AND legacy_contract_base.deleted_at IS NULL
  `;
  const requested = await c.env.DB.prepare(`
    ${select}
     WHERE st.id=? AND st.cooperative_id=? AND st.active=1 AND st.deleted_at IS NULL
     LIMIT 1
  `).bind(requestedShiftId, cooperativeId).first<Row>();
  if (requested && shiftFitsAssignmentV21(requested, assignment)) return requested;

  // Protege contra cache antigo ou horário migrado: procura no local escolhido um
  // horário com o mesmo início e fim exibidos na linha.
  if (!validTime(requestedStart) || !validTime(requestedEnd)) return null;
  const scope = shiftScopePredicateV21(assignment);
  const fallback = await c.env.DB.prepare(`
    ${select}
     WHERE st.cooperative_id=? AND st.active=1 AND st.deleted_at IS NULL
       AND ${scope.sql}
       AND st.start_time=? AND st.end_time=?
     ORDER BY CASE WHEN st.id=? THEN 0 ELSE 1 END, st.created_at, st.id
     LIMIT 1
  `).bind(
    cooperativeId,
    ...scope.params,
    requestedStart,
    requestedEnd,
    requestedShiftId,
  ).first<Row>();
  return fallback || null;
}

async function resolveAssignmentV21(
  c: Context<AppBindings>,
  cooperativeId: string,
  driver: Row,
  date: string,
  assignmentValue: string,
): Promise<Row> {
  if (assignmentValue === 'leave') {
    return {
      entry_type: 'leave', assignment_type: 'leave', contract_id: null, base_id: null,
      establishment_id: null, label: 'AFASTADO', leave_auto: 1,
    };
  }
  if (assignmentValue === 'day_off') {
    return {
      entry_type: 'day_off', assignment_type: 'day_off', contract_id: null, base_id: null,
      establishment_id: null, label: 'FOLGA', leave_auto: 0,
    };
  }
  if (onLeaveAt(driver, date)) {
    throw new Error(`${driver.name} está afastado em ${date} e não pode receber contrato.`);
  }

  const separator = assignmentValue.indexOf(':');
  const kind = separator > 0 ? assignmentValue.slice(0, separator) : '';
  const target = separator > 0 ? assignmentValue.slice(separator + 1) : '';
  let contractId: string | null = null;
  let baseId: string | null = null;
  let establishmentId: string | null = null;
  let label = '';

  if (kind === 'contract') {
    const contract = await c.env.DB.prepare(`
      SELECT id,name,establishment_id
        FROM contracts
       WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL
    `).bind(target, cooperativeId).first<Row>();
    if (!contract) throw new Error('Contrato inválido ou inativo.');
    contractId = String(contract.id);
    establishmentId = contract.establishment_id ? String(contract.establishment_id) : null;
    label = String(contract.name);
  } else if (kind === 'base') {
    const base = await c.env.DB.prepare(`
      SELECT id,name FROM bases
       WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL
    `).bind(target, cooperativeId).first<Row>();
    if (!base) throw new Error('Base inválida ou inativa.');
    baseId = String(base.id);
    label = `BASE — ${base.name}`;
  } else if (kind === 'establishment') {
    const establishment = await c.env.DB.prepare(`
      SELECT id,name FROM establishments
       WHERE id=? AND cooperative_id=? AND active=1 AND deleted_at IS NULL
    `).bind(target, cooperativeId).first<Row>();
    if (!establishment) throw new Error('Estabelecimento inválido ou inativo.');
    establishmentId = String(establishment.id);
    label = String(establishment.name);
  } else {
    throw new Error('Selecione um contrato, uma Base, um estabelecimento ou FOLGA.');
  }

  if (establishmentId) {
    const block = await c.env.DB.prepare(`
      SELECT reason
        FROM driver_establishment_blocks
       WHERE cooperative_id=? AND driver_id=? AND establishment_id=? AND active=1
       LIMIT 1
    `).bind(cooperativeId, driver.id, establishmentId).first<Row>();
    if (block) {
      throw new Error(`${driver.name} está bloqueado neste estabelecimento${block.reason ? `: ${block.reason}` : ''}.`);
    }
  }

  return {
    entry_type: 'work',
    assignment_type: kind,
    contract_id: contractId,
    base_id: baseId,
    establishment_id: establishmentId,
    label,
    leave_auto: 0,
  };
}

platformV21Routes.get('/v21/schedule/matrix', async c => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  const data = await loadMatrixV21(c, auth.cooperativeId!, cleanText(c.req.query('week_start') || '', 10), auth.id);
  return c.json({ ok: true, ...data });
});

platformV21Routes.put('/v21/schedule/rows/:id', async c => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  const body = await bodyJson<Row>(c);
  const rowId = cleanText(c.req.param('id'), 100);
  const row = await c.env.DB.prepare(`
    SELECT * FROM schedule_week_rows
     WHERE id=? AND cooperative_id=? AND active=1
  `).bind(rowId, auth.cooperativeId).first<Row>();
  if (!row) return c.json({ ok: false, error: 'Linha da escala não encontrada.' }, 404);

  const date = addDays(String(row.week_start), Number(row.day_index));
  const driverId = cleanText(body.driver_id || row.driver_id, 100);
  const driver = await c.env.DB.prepare(`
    SELECT * FROM drivers
     WHERE id=? AND cooperative_id=? AND deleted_at IS NULL AND status='active'
  `).bind(driverId, auth.cooperativeId).first<Row>();
  if (!driver) return c.json({ ok: false, error: 'Cooperado inválido ou inativo.' }, 400);

  const assignmentValue = cleanText(body.assignment_value || 'day_off', 180);
  const turn = cleanText(body.turn_label || row.turn_label || 'DIA', 20).toUpperCase();
  let assignment: Row;
  try {
    assignment = await resolveAssignmentV21(c, auth.cooperativeId!, driver, date, assignmentValue);
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : 'Não foi possível salvar a escala.' }, 409);
  }

  let shiftTemplateId = nullableText(body.shift_template_id, 100);
  let start = cleanText(body.start_time || row.start_time, 5);
  let end = cleanText(body.end_time || row.end_time, 5);
  let shiftLabel = assignment.label;
  let guaranteedCents = 0;
  if (assignment.entry_type === 'work') {
    if (!shiftTemplateId) {
      return c.json({ ok: false, error: 'Selecione um dos horários cadastrados para este contrato ou local.' }, 400);
    }
    const shift = await findShiftForAssignmentV21(
      c,
      auth.cooperativeId!,
      assignment,
      shiftTemplateId,
      start,
      end,
    );
    if (!shift) {
      return c.json({
        ok: false,
        error: 'O horário selecionado não pertence a este local ou foi alterado. Escolha novamente um horário do contrato, estabelecimento ou Base.',
      }, 409);
    }
    shiftTemplateId = String(shift.id);
    start = String(shift.start_time);
    end = String(shift.end_time);
    shiftLabel = String(shift.shift_label || shift.name || assignment.label);
    guaranteedCents = assignment.assignment_type === 'base' ? 0 : Math.max(0, Number(shift.guaranteed_cents || 0));
    if (!validTime(start) || !validTime(end)) {
      return c.json({ ok: false, error: 'O horário cadastrado possui início ou fim inválido.' }, 400);
    }

    // Converte automaticamente horários antigos da Base que estavam vinculados
    // ao estabelecimento virtual ou ao antigo contrato técnico chamado BASE.
    if (
      assignment.assignment_type === 'base'
      && String(shift.base_id || '') !== String(assignment.base_id)
      && effectiveShiftBaseIdV21(shift) === String(assignment.base_id)
    ) {
      await c.env.DB.prepare(`
        UPDATE shift_templates
           SET base_id=?,contract_id=NULL,establishment_id=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND cooperative_id=?
      `).bind(assignment.base_id, shift.id, auth.cooperativeId).run();
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE schedule_week_rows
         SET driver_id=?,turn_label=?,entry_type=?,assignment_type=?,contract_id=?,base_id=?,
             establishment_id=?,shift_template_id=?,start_time=?,end_time=?,shift_label=?,
             guaranteed_cents=?,notes=?,leave_auto=?,updated_at=CURRENT_TIMESTAMP
       WHERE id=?
    `).bind(
      driver.id,
      ['DIA', 'NOITE', 'MADRUGADA'].includes(turn) ? turn : 'DIA',
      assignment.entry_type,
      assignment.assignment_type,
      assignment.contract_id,
      assignment.base_id,
      assignment.establishment_id,
      assignment.entry_type === 'work' ? shiftTemplateId : null,
      assignment.entry_type === 'work' ? start : null,
      assignment.entry_type === 'work' ? end : null,
      shiftLabel,
      assignment.entry_type === 'work' ? guaranteedCents : 0,
      nullableText(body.notes, 1000),
      Number(assignment.leave_auto || 0),
      row.id,
    ),
    c.env.DB.prepare(`
      INSERT INTO schedule_week_publications(id,cooperative_id,week_start,status)
      VALUES (?,?,?,'draft')
      ON CONFLICT(cooperative_id,week_start)
      DO UPDATE SET status='draft',updated_at=CURRENT_TIMESTAMP
    `).bind(id(), auth.cooperativeId, row.week_start),
  ]);

  const matrix = await loadMatrixV21(c, auth.cooperativeId!, String(row.week_start), auth.id);
  const updated = (matrix.rows as Row[]).find(item => String(item.id) === String(row.id));
  return c.json({ ok: true, status: 'draft', item: updated, warnings: matrix.warnings, counts: matrix.counts });
});

platformV21Routes.post('/v21/schedule/rows', async c => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  const body = await bodyJson<Row>(c);
  const week = mondayOf(cleanText(body.week_start || new Date().toISOString().slice(0, 10), 10));
  const groupId = cleanText(body.group_driver_id, 100);
  const dayIndex = Number(body.day_index);
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return c.json({ ok: false, error: 'Dia inválido.' }, 400);
  }
  const group = await c.env.DB.prepare(`
    SELECT id FROM drivers
     WHERE id=? AND cooperative_id=? AND deleted_at IS NULL AND status='active'
  `).bind(groupId, auth.cooperativeId).first<Row>();
  if (!group) return c.json({ ok: false, error: 'Cooperado inválido.' }, 400);

  const maximum = await c.env.DB.prepare(`
    SELECT COALESCE(MAX(row_order),0) value
      FROM schedule_week_rows
     WHERE cooperative_id=? AND week_start=? AND group_driver_id=? AND day_index=?
  `).bind(auth.cooperativeId, week, groupId, dayIndex).first<Row>();
  const rowOrder = Number(maximum?.value || 0) + 1;
  const requestedTurn = cleanText(body.turn_label || '', 20).toUpperCase();
  const preset = defaultTimes(requestedTurn === 'NOITE' || requestedTurn === 'MADRUGADA' ? 2 : 1);
  const turn = ['DIA', 'NOITE', 'MADRUGADA'].includes(requestedTurn) ? requestedTurn : preset.turn;
  const rowId = id();
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO schedule_week_rows(
        id,cooperative_id,week_start,group_driver_id,driver_id,day_index,row_order,turn_label,
        entry_type,assignment_type,start_time,end_time,shift_label,is_default,active,leave_auto,created_by
      ) VALUES (?,?,?,?,?,?,?,?,'day_off','day_off',?,?,'FOLGA',0,1,0,?)
    `).bind(rowId, auth.cooperativeId, week, groupId, groupId, dayIndex, rowOrder, turn, preset.start, preset.end, auth.id),
    c.env.DB.prepare(`
      INSERT INTO schedule_week_publications(id,cooperative_id,week_start,status)
      VALUES (?,?,?,'draft')
      ON CONFLICT(cooperative_id,week_start)
      DO UPDATE SET status='draft',updated_at=CURRENT_TIMESTAMP
    `).bind(id(), auth.cooperativeId, week),
  ]);
  return c.json({ ok: true, id: rowId });
});

platformV21Routes.delete('/v21/schedule/rows/:id', async c => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  const row = await c.env.DB.prepare(`
    SELECT * FROM schedule_week_rows
     WHERE id=? AND cooperative_id=? AND active=1
  `).bind(c.req.param('id'), auth.cooperativeId).first<Row>();
  if (!row) return c.json({ ok: false, error: 'Linha não encontrada.' }, 404);
  if (Number(row.is_default || 0) === 1) {
    return c.json({ ok: false, error: 'As 14 linhas padrão não podem ser removidas. Remova somente linhas acrescentadas.' }, 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE schedule_week_rows SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).bind(row.id),
    c.env.DB.prepare(`
      INSERT INTO schedule_week_publications(id,cooperative_id,week_start,status)
      VALUES (?,?,?,'draft')
      ON CONFLICT(cooperative_id,week_start)
      DO UPDATE SET status='draft',updated_at=CURRENT_TIMESTAMP
    `).bind(id(), auth.cooperativeId, row.week_start),
  ]);
  return c.json({ ok: true });
});

platformV21Routes.post('/v21/schedule/publish', async c => {
  const auth = tenant(c, ['cooperative_admin', 'dispatcher']);
  const body = await bodyJson<Row>(c);
  const week = mondayOf(cleanText(body.week_start || new Date().toISOString().slice(0, 10), 10));
  const matrix = await loadMatrixV21(c, auth.cooperativeId!, week, auth.id);
  const driverMap = new Map((matrix.drivers as Row[]).map(item => [String(item.id), item]));
  const shiftMap = new Map((matrix.shifts as Row[]).map(item => [String(item.id), item]));
  if (!(matrix.drivers as Row[]).length) {
    return c.json({ ok: false, error: 'Não existem cooperados ativos para montar a escala.' }, 400);
  }

  const errors: string[] = [];
  const statements: D1PreparedStatement[] = [c.env.DB.prepare(`
    UPDATE schedules
       SET status='cancelled',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
     WHERE cooperative_id=? AND deleted_at IS NULL AND status!='cancelled'
       AND (publication_week_start=? OR week_start=?)
  `).bind(auth.cooperativeId, week, week)];

  for (const row of matrix.rows as Row[]) {
    const assigned = driverMap.get(String(row.driver_id));
    const group = driverMap.get(String(row.group_driver_id));
    if (!assigned || !group) {
      errors.push('Há uma linha com cooperado inativo.');
      continue;
    }
    let entryType = String(row.entry_type || 'day_off');
    let contractId: string | null = null;
    let baseId: string | null = null;
    let establishmentId: string | null = null;
    let start = '';
    let end = '';
    let label = '';
    let guaranteedCents = 0;

    if (entryType === 'work') {
      if (onLeaveAt(assigned, String(row.date))) {
        errors.push(`${assigned.name} está afastado em ${row.date}.`);
        continue;
      }
      const shift = shiftMap.get(String(row.shift_template_id || ''));
      if (!shift) {
        errors.push(`Selecione um horário cadastrado para ${assigned.name} em ${row.date}.`);
        continue;
      }
      if (!shiftFitsAssignmentV21(shift, row)) {
        errors.push(`O horário escolhido para ${assigned.name} em ${row.date} não pertence ao local selecionado.`);
        continue;
      }
      start = String(shift.start_time || row.start_time || '');
      end = String(shift.end_time || row.end_time || '');
      if (!validTime(start) || !validTime(end)) {
        errors.push(`Horário inválido para ${assigned.name} em ${row.date}.`);
        continue;
      }
      contractId = row.assignment_type === 'contract' ? row.contract_id : null;
      baseId = row.assignment_type === 'base' ? row.base_id : null;
      establishmentId = row.establishment_id || null;
      if (!contractId && !baseId && !establishmentId) {
        errors.push(`Selecione contrato, Base ou estabelecimento para ${assigned.name} em ${row.date}.`);
        continue;
      }
      if (establishmentId) {
        const block = await c.env.DB.prepare(`
          SELECT reason FROM driver_establishment_blocks
           WHERE cooperative_id=? AND driver_id=? AND establishment_id=? AND active=1
           LIMIT 1
        `).bind(auth.cooperativeId, assigned.id, establishmentId).first<Row>();
        if (block) {
          errors.push(`${assigned.name} está bloqueado em ${row.establishment_name || row.contract_name || 'estabelecimento'}.`);
          continue;
        }
      }
      label = String(row.shift_label || row.assignment_label || 'TRABALHO');
      guaranteedCents = baseId ? 0 : Math.max(0, Number(shift.guaranteed_cents || 0));
    } else {
      entryType = entryType === 'leave' ? 'leave' : 'day_off';
      start = entryType === 'leave' ? '00:00' : String(row.turn_label) === 'NOITE' ? '12:00' : '00:00';
      end = entryType === 'leave' ? '23:59' : String(row.turn_label) === 'NOITE' ? '23:59' : '11:59';
      label = entryType === 'leave' ? 'AFASTADO' : 'FOLGA';
    }

    const startAt = localIso(String(row.date), start);
    const endAt = localIso(String(row.date), end, end <= start);
    statements.push(c.env.DB.prepare(`
      INSERT INTO schedules(
        id,cooperative_id,establishment_id,driver_id,start_at,end_at,status,guaranteed_cents,
        notes,created_by,base_id,contract_id,shift_template_id,shift_label,entry_type,slot_index,
        week_start,template_driver_id,publication_week_start,sort_order,schedule_row_id
      ) VALUES (?,?,?,?,?,?,'scheduled',?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id(), auth.cooperativeId, establishmentId, assigned.id, startAt, endAt,
      entryType === 'work' ? guaranteedCents : 0, nullableText(row.notes, 1000), auth.id,
      baseId, contractId, row.shift_template_id || null, label, entryType, Number(row.row_order),
      week, group.id, week, Number(row.row_order), row.id,
    ));
  }

  if (errors.length) return c.json({ ok: false, error: errors.slice(0, 30).join('\n') }, 409);
  statements.push(c.env.DB.prepare(`
    INSERT INTO schedule_week_publications(id,cooperative_id,week_start,status,published_at,published_by)
    VALUES (?,?,?,'published',CURRENT_TIMESTAMP,?)
    ON CONFLICT(cooperative_id,week_start)
    DO UPDATE SET status='published',published_at=CURRENT_TIMESTAMP,
                  published_by=excluded.published_by,updated_at=CURRENT_TIMESTAMP
  `).bind(id(), auth.cooperativeId, week, auth.id));
  await batchChunks(c.env.DB, statements);
  return c.json({
    ok: true,
    status: 'published',
    count: (matrix.rows as Row[]).length,
    warnings: matrix.warnings,
    published_at: new Date().toISOString(),
  });
});
