from pathlib import Path

ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def replace_line(text,prefix,new,label):
    lines=text.splitlines()
    for i,line in enumerate(lines):
        if line.startswith(prefix):
            lines[i]=new
            return '\n'.join(lines)+('\n' if text.endswith('\n') else '')
    raise RuntimeError(f'Linha não encontrada: {label}')

js_path='public/chegaja-v217-driver-navigation.js'
index_path='public/index.html'
test_path='scripts/test-v14153-logo-google-maps.mjs'

js=read(js_path)
if 'ChegaJá 14.33.28' not in js:
    js=js.replace('/* ChegaJá 14.33.27 — navegação automática, próxima manobra e mapa limpo */','/* ChegaJá 14.33.28 — bearing corrigido: direção da marcha para cima */',1)
    js=js.replace('__CJ_DRIVER_LEAFLET_143327__','__CJ_DRIVER_LEAFLET_143328__')
    anchor='function currentMapBearing(){try{return normAngle(A.map?.getBearing?.())??0}catch{return 0}}'
    if anchor not in js: raise RuntimeError('currentMapBearing não encontrado')
    js=js.replace(anchor,anchor+'\nfunction mapRotationForHeading(heading){const h=normAngle(heading);return h==null?0:normAngle(360-h)}',1)
    js=replace_line(js,'function applyMapBearing(',"function applyMapBearing(force=false){if(!A.map||typeof A.map.setBearing!=='function')return;if(navigationActive())A.headingUp=true;const b=$('#cj217-bearing');if(b){b.classList.remove('north');const small=b.querySelector('small');if(small)small.textContent='AUTO'}const target=A.headingUp&&navigationActive()?effectiveHeading():0;if(target==null&&!force)return;const wanted=target==null?0:mapRotationForHeading(target),current=currentMapBearing(),delta=angleDelta(current,wanted);if(!force&&Math.abs(delta)<1.2)return;const next=force?wanted:normAngle(current+delta*.30);try{A.map.setBearing(next)}catch{}paintHeading();refreshRouteArrowAngles()}",'bearing inverso')
    js=replace_line(js,'function paintHeading(',"function paintHeading(){const el=A.self?.getElement?.()?.querySelector('.cj217-self-marker');if(!el)return;const h=effectiveHeading(),mapBearing=currentMapBearing(),angle=h==null?0:normAngle(h+mapBearing);el.style.transform=`rotate(${angle||0}deg)`}",'seta compensada')
    write(js_path,js)

index=read(index_path)
index=index.replace('app-version" content="14.33.27"','app-version" content="14.33.28"')
index=index.replace('chegaja-v217-driver-navigation.js?v=14.33.27&recovery=143327','chegaja-v217-driver-navigation.js?v=14.33.28&recovery=143328')
index=index.replace('chegaja-v217-driver-navigation.css?v=14.33.27&recovery=143327','chegaja-v217-driver-navigation.css?v=14.33.28&recovery=143328')
write(index_path,index)

test=read(test_path)
test=test.replace('14\\.33\\.27','14\\.33\\.28').replace('143327','143328')
extra="""
assert.match(driver,/function mapRotationForHeading\\(heading\\)/);
assert.match(driver,/normAngle\\(360-h\\)/);
assert.match(driver,/wanted=target==null\\?0:mapRotationForHeading\\(target\\)/);
assert.match(driver,/angle=h==null\\?0:normAngle\\(h\\+mapBearing\\)/);
"""
if 'mapRotationForHeading' not in test:
    test += '\n'+extra
write(test_path,test)

print('ChegaJá 14.33.28: rotação da câmera invertida corretamente e seta compensada para permanecer apontando à frente.')
