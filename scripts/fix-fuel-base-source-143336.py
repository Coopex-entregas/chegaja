from pathlib import Path
import re

ROOT = Path('.')
v28_path = ROOT / 'src/routes/platform-v28.ts'
v16_path = ROOT / 'src/routes/platform-v16.ts'
index_path = ROOT / 'public/index.html'
test_path = ROOT / 'scripts/test-v14153-logo-google-maps.mjs'

v28 = v28_path.read_text(encoding='utf-8')
v16 = v16_path.read_text(encoding='utf-8')
index = index_path.read_text(encoding='utf-8')
test = test_path.read_text(encoding='utf-8')

# A precificação de combustível já existe em bases desde a migração 0019.
# Não depender das colunas novas em cooperatives: se a migração global não tiver
# sido aplicada no D1 de produção, a consulta inteira quebra e o app perde os dados.
v28 = re.sub(
    r",\s*\(SELECT NULLIF\(cx\.fuel_km_per_liter,0\) FROM cooperatives cx WHERE cx\.id=d\.cooperative_id\)",
    "",
    v28,
)
v28 = re.sub(
    r",\s*\(SELECT NULLIF\(cx\.fuel_price_cents,0\) FROM cooperatives cx WHERE cx\.id=d\.cooperative_id\)",
    "",
    v28,
)

# Salvar somente na Base. Isto mantém a configuração compatível com o banco atual
# e a mesma Base passa a ser a referência global/fallback para qualquer estabelecimento.
v16 = re.sub(
    r",c\.env\.DB\.prepare\(`UPDATE cooperatives SET fuel_km_per_liter=\?,fuel_price_cents=\?,updated_at=CURRENT_TIMESTAMP WHERE id=\?`\)\.bind\(fuelKm,fuelPrice,auth\.cooperativeId\)",
    "",
    v16,
)

# Identificação da publicação. O JS do cooperado não mudou, mas o novo query string
# força o navegador a refazer a leitura do app após a troca do backend.
index = index.replace('app-version" content="14.33.35"', 'app-version" content="14.33.36"')
index = index.replace('chegaja-v217-driver-navigation.js?v=14.33.35&recovery=143335', 'chegaja-v217-driver-navigation.js?v=14.33.36&recovery=143336')

# Ajustar teste regressivo sem depender das colunas globais de cooperatives.
test = test.replace(r'app-version\" content=\"14\.33\.35\"', r'app-version\" content=\"14\.33\.36\"')
test = test.replace(r'chegaja-v217-driver-navigation\.js\?v=14\.33\.35&recovery=143335', r'chegaja-v217-driver-navigation\.js\?v=14\.33\.36&recovery=143336')
test = re.sub(r"^assert\.match\(v28,/SELECT NULLIF\\\(cx\\\.fuel_km_per_liter,0\\\) FROM cooperatives/\);\n?", "", test, flags=re.M)
test = re.sub(r"^assert\.match\(v28,/.*FROM cooperatives.*fuel.*\);\n?", "", test, flags=re.M)
test = re.sub(r"^assert\.match\(v16,/UPDATE cooperatives SET fuel_km_per_liter.*\);\n?", "", test, flags=re.M)
marker = "\n// 14.33.36 — combustível usa diretamente a precificação das Bases.\nassert.doesNotMatch(v28,/FROM cooperatives cx/);\nassert.doesNotMatch(v16,/UPDATE cooperatives SET fuel_km_per_liter/);\nassert.match(v28,/FROM bases bx/);\nassert.match(v28,/COALESCE\\(bx\\.fuel_price_cents,0\\)>0/);\n"
if '14.33.36 — combustível usa diretamente' not in test:
    test += marker

if 'FROM cooperatives cx' in v28:
    raise SystemExit('platform-v28 ainda depende de cooperatives para combustível')
if 'UPDATE cooperatives SET fuel_km_per_liter' in v16:
    raise SystemExit('platform-v16 ainda tenta salvar combustível em cooperatives')
if 'FROM bases bx' not in v28 or 'fuel_price_cents' not in v28:
    raise SystemExit('fallback de combustível por Base não encontrado')
if 'app-version" content="14.33.36"' not in index:
    raise SystemExit('versão 14.33.36 não aplicada no index')

v28_path.write_text(v28, encoding='utf-8')
v16_path.write_text(v16, encoding='utf-8')
index_path.write_text(index, encoding='utf-8')
test_path.write_text(test, encoding='utf-8')
print('ChegaJá 14.33.36 aplicado: combustível direto da Base, sem dependência de migração global.')
