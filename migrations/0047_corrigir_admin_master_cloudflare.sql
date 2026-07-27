-- Corrige o Administrador Master para o limite de PBKDF2 do Cloudflare.
-- E-mail: chegajja@gmail.com
-- Senha informada pelo administrador: armazenada apenas como hash + salt.

UPDATE users
SET name = 'Administrador Master',
    email = 'chegajja@gmail.com',
    username = NULL,
    password_hash = 'aFVAhCEgE_0KV4qtd5jMd401cUFRtXvRjTMlbjKmYxY',
    password_salt = 'gg4Zz6-RDkXUlFthb85A5g',
    role = 'platform_admin',
    status = 'active',
    cooperative_id = NULL,
    establishment_id = NULL,
    driver_id = NULL,
    deleted_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE role = 'platform_admin';

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
  'chegajja@gmail.com',
  NULL,
  'aFVAhCEgE_0KV4qtd5jMd401cUFRtXvRjTMlbjKmYxY',
  'gg4Zz6-RDkXUlFthb85A5g',
  'platform_admin',
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE role = 'platform_admin'
);
