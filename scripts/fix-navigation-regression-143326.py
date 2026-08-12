from pathlib import Path
p=Path('scripts/test-v14153-logo-google-maps.mjs')
s=p.read_text(encoding='utf-8')
old="""assert.match(driver,/fitBounds\\(bounds/);
assert.match(driver,/paddingTopLeft:\\[24,132\\]/);
assert.match(driver,/paddingBottomRight:\\[24,148\\]/);
assert.match(driver,/maxZoom:17/);"""
new="""assert.match(driver,/A\\.map\\.setView\\(\\[A\\.gps\\.lat,A\\.gps\\.lng\\],zoom/);
assert.match(driver,/applyMapBearing\\(force\\)/);
assert.match(driver,/d<180\\?18\\.5/);
assert.doesNotMatch(driver,/fitBounds\\(bounds/);"""
if old in s:
    s=s.replace(old,new,1)
elif 'assert.match(driver,/A\\.map\\.setView' not in s:
    raise SystemExit('Bloco antigo de camera não encontrado')
p.write_text(s,encoding='utf-8')
print('Teste regressivo alinhado com camera heading-up 14.33.26.')
