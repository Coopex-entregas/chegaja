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
css_path='public/chegaja-v217-driver-navigation.css'
index_path='public/index.html'
test_path='scripts/test-v14153-logo-google-maps.mjs'

js=read(js_path)
if 'ChegaJá 14.33.29' not in js:
    js=js.replace('/* ChegaJá 14.33.28 — bearing corrigido: direção da marcha para cima */','/* ChegaJá 14.33.29 — câmera alinhada à rua e instrução compacta */',1)
    js=js.replace('__CJ_DRIVER_LEAFLET_143328__','__CJ_DRIVER_LEAFLET_143329__')

    js=replace_line(js,'function effectiveHeading(',"function effectiveHeading(){const speed=Number(A.lastSpeed||window.ChegaJaLastDriverLocation?.speed||0),gps=normAngle(A.lastHeading),device=normAngle(A.deviceHeading),raw=speed>=1&&gps!=null?gps:(device!=null?device:gps),road=routeHeadingNearGps();if(raw==null)return road;if(road==null)return raw;const delta=angleDelta(raw,road),gap=Math.abs(delta);if(gap<=18)return road;if(gap<=32&&speed<2.2)return normAngle(raw+delta*.55);return raw}",'heading alinhado à rua')

    marker="function segmentBearing(a,b){if(!valid(a)||!valid(b))return 0;const lat1=a.lat*Math.PI/180,lat2=b.lat*Math.PI/180,dLon=(b.lng-a.lng)*Math.PI/180,y=Math.sin(dLon)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);return normAngle(Math.atan2(y,x)*180/Math.PI)||0}"
    route_fn="function routeHeadingNearGps(){if(!navigationActive()||!valid(A.gps)||!Array.isArray(A.routePoints)||A.routePoints.length<2)return null;let best=0,bestD=Infinity;for(let i=0;i<A.routePoints.length;i++){const d=distance(A.gps,A.routePoints[i]);if(d<bestD){bestD=d;best=i}}if(bestD>70)return null;const anchor=A.routePoints[best];let ahead=null;for(let i=best+1;i<A.routePoints.length;i++){if(distance(anchor,A.routePoints[i])>=8){ahead=A.routePoints[i];break}}if(!ahead&&best>0)return segmentBearing(A.routePoints[best-1],anchor);return valid(ahead)?segmentBearing(anchor,ahead):null}"
    if 'function routeHeadingNearGps()' not in js:
        if marker not in js: raise RuntimeError('segmentBearing não encontrado')
        js=js.replace(marker,marker+'\n'+route_fn,1)
    write(js_path,js)

css=read(css_path)
if 'ChegaJá 14.33.29' not in css:
    css += """

/* ChegaJá 14.33.29 — instruções compactas e legíveis */
#cj199-metric.cj217-navigation-card{min-height:102px!important;padding:12px 16px 11px!important}
#cj199-metric.cj217-navigation-card strong{font-size:clamp(18px,5.15vw,25px)!important;line-height:1.06!important;letter-spacing:-.025em!important;white-space:normal!important;display:-webkit-box!important;-webkit-line-clamp:3!important;-webkit-box-orient:vertical!important;overflow:hidden!important;text-overflow:clip!important;overflow-wrap:anywhere!important}
#cj199-metric.cj217-navigation-card span{font-size:12px!important;line-height:1.15!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
@media(max-width:390px){#cj199-metric.cj217-navigation-card{min-height:98px!important;padding:10px 13px!important}#cj199-metric.cj217-navigation-card strong{font-size:clamp(17px,5vw,22px)!important}}
"""
    write(css_path,css)

index=read(index_path)
index=index.replace('app-version" content="14.33.28"','app-version" content="14.33.29"')
index=index.replace('chegaja-v217-driver-navigation.js?v=14.33.28&recovery=143328','chegaja-v217-driver-navigation.js?v=14.33.29&recovery=143329')
index=index.replace('chegaja-v217-driver-navigation.css?v=14.33.28&recovery=143328','chegaja-v217-driver-navigation.css?v=14.33.29&recovery=143329')
write(index_path,index)

test=read(test_path)
test=test.replace('14\\.33\\.28','14\\.33\\.29').replace('143328','143329')
if 'routeHeadingNearGps' not in test:
    test += "\nassert.match(driver,/function routeHeadingNearGps\\(\\)/);\nassert.match(driver,/gap<=18\\)return road/);\nassert.match(driverCss,/font-size:clamp\\(18px,5\\.15vw,25px\\)/);\nassert.match(driverCss,/-webkit-line-clamp:3/);\n"
write(test_path,test)

print('ChegaJá 14.33.29: câmera encaixa no sentido da rua quando a bússola difere poucos graus; card de direção menor e até 3 linhas.')
