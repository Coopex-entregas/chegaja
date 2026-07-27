import type { Env } from '../types';

const allowed = new Set(['image/png','image/jpeg','image/webp']);

export function parseImageDataUrl(value: unknown) {
  const text=String(value||'').trim();
  const match=text.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if(!match||!allowed.has(match[1]))throw new Error('Escolha uma imagem PNG, JPG ou WEBP.');
  const mime=match[1],base64=match[2].replace(/\s+/g,'');
  const padding=base64.endsWith('==')?2:base64.endsWith('=')?1:0;
  const bytes=Math.floor(base64.length*3/4)-padding;
  if(bytes>480_000)throw new Error('A imagem ficou maior que 480 KB. Escolha outra imagem ou tente novamente para reduzir.');
  return {mime,base64};
}

export async function saveBrandingAsset(env:Env, entityType:'cooperative'|'establishment'|'driver'|'driver_pending', entityId:string, dataUrl:unknown){
  const {mime,base64}=parseImageDataUrl(dataUrl);
  await env.DB.prepare(`INSERT INTO branding_assets(entity_type,entity_id,mime_type,data_base64,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(entity_type,entity_id) DO UPDATE SET mime_type=excluded.mime_type,data_base64=excluded.data_base64,updated_at=CURRENT_TIMESTAMP`)
    .bind(entityType,entityId,mime,base64).run();
  return `/api/public/asset-logo/${entityType}/${entityId}?v=${Date.now()}`;
}
