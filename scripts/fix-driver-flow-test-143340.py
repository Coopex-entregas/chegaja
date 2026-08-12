from pathlib import Path

p=Path('scripts/test-v14153-logo-google-maps.mjs')
s=p.read_text()
s=s.replace("assert.match(driver,/L\\.polyline\\(ll,\\{color:'#075dff'/);","assert.match(driver,/L\\.polyline\\(ll,\\{pane:'cj217-route-pane',renderer:A\\.routeRenderer,color:'#075dff'/);")
s=s.replace("assert.match(driver,/manual:true,stage:'pickup'/);","assert.match(driver,/v16\\/driver\\/deliveries\\/\\$\\{encodeURIComponent\\(A\\.detail\\.id\\)\\}\\/arrive/);")
s=s.replace("assert.match(driver,/Confirme COLETA REALIZADA somente depois de retirar o pedido/);","assert.match(driver,/O contador iniciou\\. Toque em COLETA REALIZADA somente depois de retirar o pedido/);")
s=s.replace("assert.match(driver,/stage:'pickup',delivery_id:A\\.detail\\.id/);","assert.match(driver,/body:\\{stage:'pickup',\\.\\.\\.loc\\}/);")
p.write_text(s)
print('Regressão 14.33.40 ajustada para pane da rota e chegada atômica pela URL da entrega.')
