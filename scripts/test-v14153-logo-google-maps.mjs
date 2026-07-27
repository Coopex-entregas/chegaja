import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const auth = read('../src/routes/auth.ts');
const types = read('../src/types.ts');
const app = read('../public/app.js');
const final = read('../public/chegaja-final.js');
const mapsUi = read('../public/chegaja-v149.js');
const css = read('../public/chegaja-final.css');
const index = read('../public/index.html');
const sw = read('../public/sw.js');

assert.match(auth, /e\.logo_url establishment_logo_url/);
assert.match(auth, /authRoutes\.get\('\/maps-config'/);
assert.match(types, /GOOGLE_MAPS_BROWSER_KEY\?: string/);
assert.match(types, /GOOGLE_MAPS_MAP_ID\?: string/);
assert.match(app, /footerLogo=establishmentAccess\?state\.user\.establishment_logo_url:null/);
assert.match(app, /avatar\.classList\.add\('has-logo'\)/);
assert.match(css, /\.avatar\.has-logo img/);
assert.match(mapsUi, /\/api\/auth\/maps-config/);
assert.match(mapsUi, /maps\.googleapis\.com\/maps\/api\/js/);
assert.match(mapsUi, /google\.maps\.importLibrary\('maps'\)/);
assert.match(final, /function drawEstLeaflet/);
assert.match(index, /app\.js\?v=14\.15\.9/);
assert.match(index, /chegaja-final\.js\?v=14\.15\.9/);
assert.match(sw, /chegaja-14-15-9/);

console.log('ChegaJá 14.15.9: logo do estabelecimento e Google Maps verificados.');
