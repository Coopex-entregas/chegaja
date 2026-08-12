from pathlib import Path

p=Path('scripts/test-v14153-logo-google-maps.mjs')
s=p.read_text()
s=s.replace("assert.match(driver,/L\\.polyline\\(ll,\\{color:'#075dff'/);","assert.match(driver,/L\\.polyline\\(ll,\\{pane:'cj217-route-pane',renderer:A\\.routeRenderer,color:'#075dff'/);")
p.write_text(s)
print('Regressão 14.33.40 ajustada para a camada dedicada da rota.')
