const FIELDS = [
  'id','cooperative_id','establishment_id','contract_id','base_id','source','external_id',
  'customer_id','customer_mode','customer_name','customer_phone','pickup_contact_name','pickup_phone',
  'pickup_address','pickup_neighborhood','pickup_apartment','pickup_complement','pickup_lat','pickup_lng','pickup_address_json','pickup_place_id',
  'recipient_name','recipient_phone','delivery_address','delivery_neighborhood','delivery_apartment','delivery_complement','delivery_lat','delivery_lng','delivery_address_json','delivery_place_id',
  'item_description','amount_to_collect_cents','status','charge_cents','base_charge_cents','route_charge_cents',
  'displacement_distance_meters','displacement_cents','actual_displacement_distance_meters','actual_displacement_cents',
  'return_required','return_cents','service_charge_cents','services_cents','wait_charge_cents','cancellation_charge_cents',
  'paid_cents','outstanding_cents','credit_used_cents','driver_earnings_cents','driver_gross_cents','driver_net_cents','cooperative_fee_cents',
  'payment_method','payment_status','cash_payment_location','notes','tracking_token','created_by','created_at','updated_at','display_code','delivery_type',
  'assigned_driver_id','assigned_by_role','assigned_by_user_id','assignment_source','distance_meters','duration_seconds','route_geometry','addresses_confirmed',
  'wait_free_seconds','wait_rate_cents_per_15m','confirmation_required','confirmation_code','finish_without_code_authorized','finish_without_code_authorized_by',
  'customer_chat_enabled','driver_call_enabled','customer_confirmed_received_at','completion_source','received_by_name','accepted_at','picked_up_at','delivered_at','cancelled_at',
  'approach_alert_sent_at','launched_by_user_id','launched_by_name','deleted_at'
] as const;

export function deliveryFields(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  const deliveryId = alias ? `${alias}.id` : 'deliveries.id';
  const baseFields = FIELDS.map((field) => `${prefix}${field}`);
  const scheduleFields = [
    `(SELECT ds.scheduled_for FROM delivery_schedules ds WHERE ds.delivery_id=${deliveryId}) AS scheduled_for`,
    `COALESCE((SELECT ds.dispatch_mode FROM delivery_schedules ds WHERE ds.delivery_id=${deliveryId}),'none') AS dispatch_mode`,
    `(SELECT ds.planned_driver_id FROM delivery_schedules ds WHERE ds.delivery_id=${deliveryId}) AS planned_driver_id`,
    `(SELECT ds.dispatch_processed_at FROM delivery_schedules ds WHERE ds.delivery_id=${deliveryId}) AS dispatch_processed_at`
  ];
  return [...baseFields,...scheduleFields].join(',');
}
