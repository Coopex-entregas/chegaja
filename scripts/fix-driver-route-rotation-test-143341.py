from pathlib import Path
p=Path('scripts/test-v14153-logo-google-maps.mjs')
s=p.read_text()
s=s.replace("assert.match(driver,/pane:'cj217-route-pane'/);","assert.doesNotMatch(driver,/pane:'cj217-route-pane',renderer:A\\.routeRenderer,color:'#075dff'/);")
p.write_text(s)
print('Regressão 14.33.41 atualizada: rota não usa mais a pane customizada antiga.')
