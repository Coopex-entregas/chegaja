-- ChegaJa: cria, reativa ou atualiza o Administrador Master.
-- A senha nao fica gravada em texto; somente hash e salt sao armazenados.

UPDATE users
SET name = 'Administrador Master',
    email = 'chegajja@gmail.com',
    username = NULL,
    password_hash = 'TwWCtVmQiM9OXg5E_0J2D8cff-zXcpEi9ya5H7yYe-c',
    password_salt = 'gg4Zz6-RDkXUlFthb85A5g',
    role = 'platform_admin',
    status = 'active',
    cooperative_id = NULL,
    establishment_id = NULL,
    driver_id = NULL,
    deleted_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = (
  SELECT id
  FROM users
  WHERE role = 'platform_admin'
  ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, created_at
  LIMIT 1
);

INSERT INTO users (
  id,
  cooperative_id,
  establishment_id,
  driver_id,
  name,
  email,
  username,
  password_hash,
  password_salt,
  role,
  status
)
SELECT
  '7ddd3432-e8bc-4a80-91e1-6c97cf886ffe',
  NULL,
  NULL,
  NULL,
  'Administrador Master',
  'chegaja@gmail.com',
  NULL,
  'TwWCtVmQiM9OXg5E_0J2D8cff-zXcpEi9ya5H7yYe-c',
  'gg4Zz6-RDkXUlFthb85A5g',
  'platform_admin',
  'active'
WHERE NOT EXISTS (
  SELECT 1
  FROM users
  WHERE role = 'platform_admin'
);
