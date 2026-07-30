import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { navigationRoute } from '../lib/maps';

export const publicTrackingLiveRoutes = new Hono<AppBindings>();
type Row = Record<string, any>;

function trackingAllowed(item: Row) {
  return Number(item.tracking_enabled || 0) === 1 && (item.delivery_type === 'base'
    ? Number(item.base_tracking_enabled ?? item.cooperative_base_tracking ?? 1) === 1
    : Number(item.establishment_tracking_enabled ?? 1) === 1);
}

function valid(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

publicTrackingLiveRoutes.get('/tracking/:token', async c => {
  const item = await c.env.DB.prepare(`
    SELECT
      d.id,d.cooperative_id,d.establishment_id,d.base_id,d.assigned_driver_id,d.delivery_type,d.tracking_enabled,d.customer_id,
      d.display_code,d.status,d.customer_name,d.recipient_name,d.pickup_address,d.pickup_lat,d.pickup_lng,
      d.pickup_apartment,d.pickup_complement,d.delivery_address,d.delivery_lat,d.delivery_lng,
      d.delivery_apartment,d.delivery_complement,d.notes,d.item_description,d.route_geometry,d.distance_meters,d.duration_seconds,
      d.accepted_at,d.picked_up_at,d.delivered_at,d.updated_at,d.confirmation_code,d.confirmation_required,
      d.finish_without_code_authorized,d.customer_chat_enabled,d.driver_call_enabled,d.cash_payment_location,d.payment_method,
      d.payment_status,d.completion_source,d.customer_confirmed_received_at,d.received_by_name,d.charge_cents,
      d.base_charge_cents,d.wait_charge_cents,d.cancellation_charge_cents,d.paid_cents,d.outstanding_cents,d.credit_used_cents,d.launched_by_name,d.created_by,
      d.launched_by_user_id,d.driver_gross_cents,d.driver_earnings_cents,d.receipt_number,
      e.name establishment_name,e.logo_url,e.tracking_enabled establishment_tracking_enabled,
      b.name base_name,b.tracking_enabled base_tracking_enabled,
      coop.name cooperative_name,coop.primary_color cooperative_color,coop.phone cooperative_phone,
      coop.base_tracking_enabled cooperative_base_tracking,
      dr.name driver_name,dr.phone driver_phone,dr.vehicle_model,dr.vehicle_plate,dr.photo_url driver_photo_url,
      e.phone establishment_phone,e.email establishment_email,
      dr.current_lat driver_lat,dr.current_lng driver_lng,dr.location_updated_at,
      r.id rating_id,u.name created_by_name
    FROM deliveries d
    JOIN establishments e ON e.id=d.establishment_id
    JOIN cooperatives coop ON coop.id=d.cooperative_id
    LEFT JOIN bases b ON b.id=d.base_id
    LEFT JOIN drivers dr ON dr.id=d.assigned_driver_id
    LEFT JOIN delivery_ratings r ON r.delivery_id=d.id
    LEFT JOIN users u ON u.id=COALESCE(d.launched_by_user_id,d.created_by)
    WHERE d.tracking_token=? AND d.deleted_at IS NULL
    LIMIT 1
  `).bind(c.req.param('token')).first<Row>();

  if (!item) return c.json({ ok:false, error:'Rastreamento não encontrado ou expirado.' },404);
  if (!trackingAllowed(item)) return c.json({ ok:false, error:'O rastreamento desta entrega foi desativado pela cooperativa.' },403);

  const showDriver = ['accepted','to_pickup','at_pickup','picked_up','in_route','problem'].includes(String(item.status))
    && item.driver_lat != null && item.driver_lng != null;

  let routeGeometry = item.route_geometry;
  let distanceMeters = Number(item.distance_meters || 0);
  let durationSeconds = Number(item.duration_seconds || 0);

  if (showDriver) {
    const origin={lat:Number(item.driver_lat),lng:Number(item.driver_lng)};
    const goingToDelivery=['picked_up','in_route','problem'].includes(String(item.status));
    const destination=goingToDelivery
      ? {lat:Number(item.delivery_lat),lng:Number(item.delivery_lng)}
      : {lat:Number(item.pickup_lat),lng:Number(item.pickup_lng)};
    if (valid(origin.lat,origin.lng) && valid(destination.lat,destination.lng)) {
      const liveRoute=await navigationRoute(c.env,origin,destination).catch(()=>null);
      if (liveRoute) {
        routeGeometry=liveRoute.geometry;
        distanceMeters=Number(liveRoute.distance_meters || 0);
        durationSeconds=Number(liveRoute.duration_seconds || 0);
      }
    }
  }

  return c.json({ok:true,item:{
    id:item.id,display_code:item.display_code,status:item.status,customer_name:item.customer_name,
    pickup_address:item.pickup_address,pickup_lat:item.pickup_lat,pickup_lng:item.pickup_lng,
    pickup_apartment:item.pickup_apartment,pickup_complement:item.pickup_complement,
    delivery_address:item.delivery_address,delivery_lat:item.delivery_lat,delivery_lng:item.delivery_lng,
    delivery_apartment:item.delivery_apartment,delivery_complement:item.delivery_complement,
    notes:item.notes,item_description:item.item_description,
    route_geometry:routeGeometry,distance_meters:distanceMeters,duration_seconds:durationSeconds,
    accepted_at:item.accepted_at,picked_up_at:item.picked_up_at,delivered_at:item.delivered_at,updated_at:item.updated_at,
    establishment_name:item.establishment_name,base_name:item.base_name,cooperative_name:item.cooperative_name,
    cooperative_phone:item.cooperative_phone,delivery_type:item.delivery_type,logo_url:item.logo_url,
    primary_color:item.cooperative_color||'#721536',
    driver_name:item.driver_name,driver_phone:item.driver_phone,vehicle_model:item.vehicle_model,
    vehicle_plate:item.vehicle_plate,driver_photo_url:item.driver_photo_url,
    establishment_phone:item.establishment_phone,establishment_email:item.establishment_email,
    driver_lat:showDriver?item.driver_lat:null,driver_lng:showDriver?item.driver_lng:null,
    location_updated_at:showDriver?item.location_updated_at:null,
    confirmation_code:Number(item.confirmation_required??1)===1||item.confirmation_code?item.confirmation_code:null,
    confirmation_required:Number(item.confirmation_required??1)===1,
    finish_without_code_authorized:Number(item.finish_without_code_authorized||0)===1,
    customer_chat_enabled:Number(item.customer_chat_enabled??1)===1,
    driver_call_enabled:Number(item.driver_call_enabled??0)===1,
    cash_payment_location:item.cash_payment_location,payment_method:item.payment_method,
    completion_source:item.completion_source,customer_confirmed_received_at:item.customer_confirmed_received_at,
    received_by_name:item.received_by_name,payment_status:item.payment_status,charge_cents:item.charge_cents,
    base_charge_cents:item.base_charge_cents,wait_charge_cents:item.wait_charge_cents,
    paid_cents:item.paid_cents,outstanding_cents:item.outstanding_cents,
    launched_by_name:item.launched_by_name||item.created_by_name||null,
    rating_available:item.status==='delivered'&&!item.rating_id,rated:Boolean(item.rating_id),
    receipt_available:item.status==='delivered'&&item.delivery_type==='base'
  }});
});
