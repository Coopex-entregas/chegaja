/* ChegaJá 14.23.3 — chamada fixa, botões confiáveis, som iPhone e escala estável */
(()=>{
'use strict';
if(window.__CJ210_DRIVER_CALL_14233__)return;
window.__CJ210_DRIVER_CALL_14233__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)/100);
const km=v=>Number(v||0)>0?`${(Number(v)/1000).toFixed(2).replace('.',',')} km`:'—';
const meters=v=>Number(v||0)>0?`${Math.round(Number(v))} m`:'—';
const mins=v=>Number(v||0)>0?`${Math.max(1,Math.round(Number(v)/60))} min`:'—';
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>