PRAGMA foreign_keys = ON;

-- Corrige horários antigos da Base que foram ligados ao estabelecimento virtual
-- criado internamente para a Base.
UPDATE shift_templates
   SET base_id = (
         SELECT b.id
           FROM bases b
          WHERE b.cooperative_id = shift_templates.cooperative_id
            AND b.virtual_establishment_id = shift_templates.establishment_id
            AND b.deleted_at IS NULL
          LIMIT 1
       ),
       establishment_id = NULL,
       contract_id = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE base_id IS NULL
   AND establishment_id IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM bases b
          WHERE b.cooperative_id = shift_templates.cooperative_id
            AND b.virtual_establishment_id = shift_templates.establishment_id
            AND b.deleted_at IS NULL
       );

-- Corrige horários vinculados ao antigo contrato técnico chamado BASE.
UPDATE shift_templates
   SET base_id = (
         SELECT b.id
           FROM contracts ct
           JOIN bases b
             ON b.cooperative_id = ct.cooperative_id
            AND b.virtual_establishment_id = ct.establishment_id
            AND b.deleted_at IS NULL
          WHERE ct.id = shift_templates.contract_id
            AND ct.cooperative_id = shift_templates.cooperative_id
            AND lower(trim(ct.name)) = 'base'
            AND ct.deleted_at IS NULL
          LIMIT 1
       ),
       contract_id = NULL,
       establishment_id = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE base_id IS NULL
   AND contract_id IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM contracts ct
           JOIN bases b
             ON b.cooperative_id = ct.cooperative_id
            AND b.virtual_establishment_id = ct.establishment_id
            AND b.deleted_at IS NULL
          WHERE ct.id = shift_templates.contract_id
            AND ct.cooperative_id = shift_templates.cooperative_id
            AND lower(trim(ct.name)) = 'base'
            AND ct.deleted_at IS NULL
       );

-- Converte rascunhos antigos que ainda tratavam a Base como contrato ou
-- estabelecimento para o único tipo correto: base.
UPDATE schedule_week_rows
   SET assignment_type = 'base',
       base_id = (
         SELECT b.id
           FROM contracts ct
           JOIN bases b
             ON b.cooperative_id = ct.cooperative_id
            AND b.virtual_establishment_id = ct.establishment_id
            AND b.deleted_at IS NULL
          WHERE ct.id = schedule_week_rows.contract_id
            AND ct.cooperative_id = schedule_week_rows.cooperative_id
            AND lower(trim(ct.name)) = 'base'
            AND ct.deleted_at IS NULL
          LIMIT 1
       ),
       contract_id = NULL,
       establishment_id = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE entry_type = 'work'
   AND base_id IS NULL
   AND contract_id IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM contracts ct
           JOIN bases b
             ON b.cooperative_id = ct.cooperative_id
            AND b.virtual_establishment_id = ct.establishment_id
            AND b.deleted_at IS NULL
          WHERE ct.id = schedule_week_rows.contract_id
            AND ct.cooperative_id = schedule_week_rows.cooperative_id
            AND lower(trim(ct.name)) = 'base'
            AND ct.deleted_at IS NULL
       );

UPDATE schedule_week_rows
   SET assignment_type = 'base',
       base_id = (
         SELECT b.id
           FROM bases b
          WHERE b.cooperative_id = schedule_week_rows.cooperative_id
            AND b.virtual_establishment_id = schedule_week_rows.establishment_id
            AND b.deleted_at IS NULL
          LIMIT 1
       ),
       contract_id = NULL,
       establishment_id = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE entry_type = 'work'
   AND base_id IS NULL
   AND establishment_id IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM bases b
          WHERE b.cooperative_id = schedule_week_rows.cooperative_id
            AND b.virtual_establishment_id = schedule_week_rows.establishment_id
            AND b.deleted_at IS NULL
       );

-- Corrige também escalas já publicadas para que a Base continue única.
UPDATE schedules
   SET base_id = (
         SELECT b.id
           FROM contracts ct
           JOIN bases b
             ON b.cooperative_id = ct.cooperative_id
            AND b.virtual_establishment_id = ct.establishment_id
            AND b.deleted_at IS NULL
          WHERE ct.id = schedules.contract_id
            AND ct.cooperative_id = schedules.cooperative_id
            AND lower(trim(ct.name)) = 'base'
            AND ct.deleted_at IS NULL
          LIMIT 1
       ),
       contract_id = NULL,
       establishment_id = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE base_id IS NULL
   AND contract_id IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM contracts ct
           JOIN bases b
             ON b.cooperative_id = ct.cooperative_id
            AND b.virtual_establishment_id = ct.establishment_id
            AND b.deleted_at IS NULL
          WHERE ct.id = schedules.contract_id
            AND ct.cooperative_id = schedules.cooperative_id
            AND lower(trim(ct.name)) = 'base'
            AND ct.deleted_at IS NULL
       );

UPDATE schedules
   SET base_id = (
         SELECT b.id
           FROM bases b
          WHERE b.cooperative_id = schedules.cooperative_id
            AND b.virtual_establishment_id = schedules.establishment_id
            AND b.deleted_at IS NULL
          LIMIT 1
       ),
       contract_id = NULL,
       establishment_id = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE base_id IS NULL
   AND establishment_id IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM bases b
          WHERE b.cooperative_id = schedules.cooperative_id
            AND b.virtual_establishment_id = schedules.establishment_id
            AND b.deleted_at IS NULL
       );
