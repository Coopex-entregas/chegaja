from pathlib import Path

ROOT=Path('.')
def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')

app_path='public/app.js'
index_path='public/index.html'
test_path='scripts/test-v14153-logo-google-maps.mjs'

app=read(app_path)

old_date="function dateTime(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}"
new_date="const APP_TIME_ZONE='America/Sao_Paulo';const sqlUtc=/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?$/;const wallClock=/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::\\d{2})?$/;function dateTime(v){if(!v)return '—';const text=String(v).trim();if(!text)return '—';if(sqlUtc.test(text)){const d=new Date(text.replace(' ','T')+'Z');return Number.isNaN(d.getTime())?esc(v):d.toLocaleString('pt-BR',{timeZone:APP_TIME_ZONE,dateStyle:'short',timeStyle:'short'})}const wall=text.match(wallClock);if(wall)return `${wall[3]}/${wall[2]}/${wall[1]} ${wall[4]}:${wall[5]}`;const d=new Date(text);return Number.isNaN(d.getTime())?esc(v):d.toLocaleString('pt-BR',{timeZone:APP_TIME_ZONE,dateStyle:'short',timeStyle:'short'})}"
if "const APP_TIME_ZONE='America/Sao_Paulo'" not in app:
    if old_date not in app: raise RuntimeError('dateTime original não encontrado')
    app=app.replace(old_date,new_date,1)

old_show="const freshDriver=state.user.role==='driver'&&Boolean(state.freshLogin);const targetPage=freshDriver?'dashboard':(location.hash.slice(1)||defaultPage);if(freshDriver){state.freshLogin=false;try{history.replaceState(null,'','#dashboard')}catch{}}navigate(targetPage,false)"
new_show="const freshDriver=state.user.role==='driver'&&(Boolean(state.freshLogin)||(()=>{try{return sessionStorage.getItem('cj_driver_fresh_login')==='1'}catch{return false}})());const targetPage=freshDriver?'dashboard':(location.hash.slice(1)||defaultPage);if(freshDriver){state.freshLogin=false;state.page='dashboard';try{sessionStorage.removeItem('cj_driver_fresh_login')}catch{}try{history.replaceState(null,'','#dashboard')}catch{}}navigate(targetPage,false)"
if "sessionStorage.getItem('cj_driver_fresh_login')" not in app:
    if old_show not in app: raise RuntimeError('showApp freshDriver original não encontrado')
    app=app.replace(old_show,new_show,1)

old_login="state.token=d.token;state.freshLogin=true;localStorage.setItem('lg_token',d.token);try{history.replaceState(null,'','#dashboard')}catch{}await loadMe()"
new_login="state.token=d.token;state.freshLogin=true;state.page='dashboard';try{sessionStorage.setItem('cj_driver_fresh_login','1')}catch{}localStorage.setItem('lg_token',d.token);try{history.replaceState(null,'','#dashboard')}catch{}await loadMe()"
if "sessionStorage.setItem('cj_driver_fresh_login','1')" not in app:
    if old_login not in app: raise RuntimeError('login original não encontrado')
    app=app.replace(old_login,new_login,1)

old_logout="function logout(msg=true){localStorage.removeItem('lg_token');state.token='';state.user=null;stopLocation();"
new_logout="function logout(msg=true){localStorage.removeItem('lg_token');try{sessionStorage.removeItem('cj_driver_fresh_login')}catch{}state.token='';state.user=null;stopLocation();"
if old_logout in app:
    app=app.replace(old_logout,new_logout,1)

write(app_path,app)

index=read(index_path)
index=index.replace('app-version" content="14.33.29"','app-version" content="14.33.30"')
index=index.replace('/app.js?v=14.33.25&recovery=143325','/app.js?v=14.33.30&recovery=143330')
index=index.replace('/chegaja-final.js?v=14.33.21&recovery=143321','/chegaja-final.js?v=14.33.30&recovery=143330')
write(index_path,index)

test=read(test_path)
test=test.replace('app-version\\" content=\\"14\\.33\\.29\\"','app-version\\" content=\\"14\\.33\\.30\\"')
test=test.replace('/\\/app\\.js\\?v=14\\.33\\.25&recovery=143325/','/\\/app\\.js\\?v=14\\.33\\.30&recovery=143330/')
test=test.replace('/chegaja-final\\.js\\?v=14\\.33\\.21&recovery=143321/','/chegaja-final\\.js\\?v=14\\.33\\.30&recovery=143330/')
extra="""
assert.match(app,/APP_TIME_ZONE='America\\/Sao_Paulo'/);
assert.match(app,/sqlUtc\.test\(text\)/);
assert.match(app,/text\.replace\(' ','T'\)\+'Z'/);
assert.match(app,/sessionStorage\.setItem\('cj_driver_fresh_login','1'\)/);
assert.match(app,/sessionStorage\.getItem\('cj_driver_fresh_login'\)/);
assert.match(app,/state\.page='dashboard'/);
assert.match(index,/\\/app\\.js\\?v=14\.33\.30&recovery=143330/);
assert.match(index,/chegaja-final\.js\\?v=14\.33\.30&recovery=143330/);
"""
if "cj_driver_fresh_login" not in test:
    test += extra
write(test_path,test)

print('ChegaJá 14.33.30: login do cooperado força Início/mapa; horários SQL UTC são exibidos em America/Sao_Paulo (UTC-3).')
