import { existsSync, readFileSync } from 'node:fs';
const required=[
  'src/routes/auth.ts','src/index.ts','src/types.ts','src/lib/guarantees.ts',
  'src/routes/dispatch-v7.ts','src/routes/platform-v10.ts','src/routes/ligerim.ts',
  'public/app.js','public/chegaja-final.js','public/chegaja-final.css','public/index.html','public/sw.js',
  'public/icons/icon-official.png','public/icons/logo-official.png',
  'public/vendor/leaflet/leaflet.css','public/vendor/leaflet/leaflet.js',
  'ATUALIZAR_SEM_PERDER_CADASTROS.bat','ATUALIZAR_LOCAL_SEM_PERDER_CADASTROS.bat'
];
for(const file of required){if(!existsSync(file))throw new Error(`Arquivo obrigatório ausente: ${file}`)}
const index=readFileSync('src/index.ts','utf8');
if(!index.includes("from './routes/auth'"))throw new Error('Importação de auth não encontrada em src/index.ts');
const auth=readFileSync('src/routes/auth.ts','utf8');
if(!auth.includes('authRoutes'))throw new Error('src/routes/auth.ts inválido');
console.log('Pacote completo 14.15.9 verificado: auth e arquivos essenciais presentes.');
