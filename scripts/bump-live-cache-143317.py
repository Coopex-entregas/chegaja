from pathlib import Path
p=Path('public/index.html')
s=p.read_text(encoding='utf-8')
s=s.replace('/app.js?v=14.15.9&recovery=143314','/app.js?v=14.33.17&recovery=143317')
s=s.replace('/chegaja-v201-operational.js?v=14.33.2&recovery=143314','/chegaja-v201-operational.js?v=14.33.17&recovery=143317')
p.write_text(s,encoding='utf-8')
print('Cache de app.js e mapa operacional atualizado para 14.33.17.')
