PRAGMA foreign_keys = ON;

-- Cada horário pertence a um único alvo operacional, mas o mesmo alvo pode ter
-- quantos horários forem necessários. Corrige registros antigos que ficaram com
-- mais de um identificador preenchido por versões anteriores do formulário.

-- A Base verdadeira sempre prevalece sobre o estabelecimento virtual e o
-- contrato técnico usados internamente para operar as entregas.
UPDATE shift_templates
   SET contract_id = NULL,
       establishment_id = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE base_id IS NOT NULL
   AND (contract_id IS NOT NULL OR establishment_id IS NOT NULL);

-- Quando contrato e estabelecimento representam o mesmo local, mantém o
-- contrato como alvo canônico, pois ele é a opção exibida na grade da escala.
UPDATE shift_templates
   SET establishment_id = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE contract_id IS NOT NULL
   AND establishment_id IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM contracts ct
          WHERE ct.id = shift_templates.contract_id
            AND ct.cooperative_id = shift_templates.cooperative_id
            AND ct.establishment_id = shift_templates.establishment_id
            AND ct.deleted_at IS NULL
       );

-- Proteção final para dados antigos inconsistentes: nunca deixa duas origens
-- preenchidas no mesmo horário. Isso não limita a quantidade de horários que
-- podem ser cadastrados para o mesmo contrato ou estabelecimento.
UPDATE shift_templates
   SET establishment_id = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE contract_id IS NOT NULL
   AND establishment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shift_templates_contract_time
  ON shift_templates(cooperative_id, contract_id, active, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_shift_templates_establishment_time
  ON shift_templates(cooperative_id, establishment_id, active, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_shift_templates_base_time
  ON shift_templates(cooperative_id, base_id, active, start_time, end_time);
