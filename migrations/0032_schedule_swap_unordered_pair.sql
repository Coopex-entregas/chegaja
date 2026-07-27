-- Uma troca A↔B só pode possuir uma solicitação pendente, independentemente da direção.
UPDATE schedule_swap_requests AS current_request
SET status = 'cancelled',
    responded_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE current_request.status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM schedule_swap_requests AS older_request
    WHERE older_request.status = 'pending'
      AND older_request.cooperative_id = current_request.cooperative_id
      AND min(older_request.source_schedule_id, older_request.target_schedule_id) = min(current_request.source_schedule_id, current_request.target_schedule_id)
      AND max(older_request.source_schedule_id, older_request.target_schedule_id) = max(current_request.source_schedule_id, current_request.target_schedule_id)
      AND (
        older_request.created_at < current_request.created_at
        OR (older_request.created_at = current_request.created_at AND older_request.id < current_request.id)
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_swap_pending_unordered_pair
  ON schedule_swap_requests(
    cooperative_id,
    min(source_schedule_id, target_schedule_id),
    max(source_schedule_id, target_schedule_id)
  )
  WHERE status = 'pending';
