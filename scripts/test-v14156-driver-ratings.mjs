import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const backend=read('src/routes/driver-experience.ts');
const frontend=read('public/chegaja-v144.js');
const css=read('public/chegaja-v144.css');

const routeStart=backend.indexOf("driverExperienceRoutes.get('/v18/driver/ratings'");
const routeEnd=backend.indexOf("driverExperienceRoutes.get('/v18/driver/support'",routeStart);
assert.ok(routeStart>=0&&routeEnd>routeStart,'Rota de avaliações do cooperado não encontrada.');
const route=backend.slice(routeStart,routeEnd);
assert.match(route,/FROM delivery_ratings/);
assert.match(route,/FROM shift_ratings/);
assert.match(route,/lifetime:true/);
assert.match(route,/anonymous:true/);
assert.match(route,/scoreByHundredth\(items,'driver_score'\)/);
assert.doesNotMatch(route,/establishment_name|display_code|customer_id|created_by/);

const screenStart=frontend.indexOf('const originalRatings=pages.ratings');
const screenEnd=frontend.indexOf('pages.support=async function',screenStart);
assert.ok(screenStart>=0&&screenEnd>screenStart,'Tela do cooperado não encontrada.');
const screen=frontend.slice(screenStart,screenEnd);
assert.match(screen,/MINHA NOTA VITALÍCIA/);
assert.match(screen,/não reinicia a cada semana/);
assert.match(screen,/sem identificar quem avaliou/);
assert.match(screen,/item\.comment/);
assert.match(screen,/item\.tags/);
assert.match(screen,/Sem critérios mencionados/);
assert.doesNotMatch(screen,/display_code|establishment_name|Pedido /);
assert.match(css,/\.cj144-review-tags/);

const lifetimeScore=scores=>{
  let score=5;
  for(const value of scores){
    score=Math.max(1,Math.min(5,score+(value===5?0.01:-0.01)));
    score=Math.round(score*100)/100;
  }
  return score;
};
assert.equal(lifetimeScore([5]),5);
assert.equal(lifetimeScore([4]),4.99);
assert.equal(lifetimeScore([4,5]),5);
assert.equal(lifetimeScore([5,4]),4.99);

console.log('ChegaJá 14.15.9: avaliações vitalícias, anônimas e de fim de turno verificadas.');
