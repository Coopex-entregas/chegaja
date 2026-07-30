/* ChegaJá 14.24.0 — operação rápida, sem observadores pesados */
(()=>{
'use strict';
if(window.__CJ212_FAST__)return;window.__CJ212_FAST__=true;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const token=()=>String(window.state?.token||localStorage.getItem('lg_token')||'').trim();
const role=()=>window.state?.user?.role||'';
const esc=v=>String(v??'').