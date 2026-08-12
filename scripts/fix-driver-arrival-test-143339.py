from pathlib import Path

p=Path('scripts/test-v14153-logo-google-maps.mjs')
s=p.read_text()
s=s.replace(r'14\.33\.38',r'14\.33\.39')
s=s.replace('recovery=143338','recovery=143339')
s=s.replace('ChegaJá 14\\.33\\.38','ChegaJá 14\\.33\\.39')
p.write_text(s)
print('Expectativas regressivas normalizadas para 14.33.39.')
