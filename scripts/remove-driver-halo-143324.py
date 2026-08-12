from pathlib import Path
p=Path('public/chegaja-v217-driver-navigation.css')
s=p.read_text(encoding='utf-8')
legacy="body.cj199-driver #cj199-map .cj217-self-icon:before{content:'';position:absolute;left:50%;top:50%;width:58px;height:58px;transform:translate(-50%,-50%);border-radius:50%;background:rgba(20,89,255,.16);border:2px solid rgba(20,89,255,.38);box-shadow:0 0 0 8px rgba(20,89,255,.08);pointer-events:none}\n"
s=s.replace(legacy,'')
p.write_text(s,encoding='utf-8')
print('Halo antigo removido do CSS.')
