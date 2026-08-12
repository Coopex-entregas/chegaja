from pathlib import Path
p=Path(__file__).resolve().parents[1]/'scripts/test-v14153-logo-google-maps.mjs'
s=p.read_text(encoding='utf-8')
s=s.replace(r"chegaja-v217-driver-navigation\.css\?v=14\.33\.35&recovery=143335",r"chegaja-v217-driver-navigation\.css\?v=14\.33\.33&recovery=143333")
p.write_text(s,encoding='utf-8')
print('Expectativa do CSS preservada em 14.33.33.')
