-- 0010: Atomic video credit debit function.
-- Checks balance, claims log row, debits FIFO across packs — one transaction.
-- Returns (charged BOOLEAN, seconds_charged INT).

CREATE OR REPLACE FUNCTION debit_video_seconds(
  p_account_id UUID,
  p_video_id UUID,
  p_seconds INT
) RETURNS TABLE(charged BOOLEAN, seconds_charged INT) AS $$
DECLARE
  v_balance INT;
  v_remaining INT;
  v_pack RECORD;
  v_take INT;
  v_available INT;
BEGIN
  -- Idempotency: already charged → return false.
  IF EXISTS (SELECT 1 FROM generations_log WHERE video_id = p_video_id) THEN
    RETURN QUERY SELECT FALSE, 0;
    RETURN;
  END IF;

  -- Lock and sum available balance across non-expired packs.
  SELECT COALESCE(SUM(GREATEST(0, cp.seconds_total - cp.seconds_used)), 0)::INT
    INTO v_balance
    FROM credit_packs cp
   WHERE cp.account_id = p_account_id
     AND cp.expires_at > NOW()
     FOR UPDATE;

  IF v_balance < p_seconds THEN
    RETURN QUERY SELECT FALSE, 0;
    RETURN;
  END IF;

  -- Claim the charge (video_id is unique).
  INSERT INTO generations_log (video_id, seconds_charged)
  VALUES (p_video_id, p_seconds);

  -- FIFO debit across packs, oldest first.
  v_remaining := p_seconds;
  FOR v_pack IN
    SELECT cp.id, cp.seconds_total, cp.seconds_used
      FROM credit_packs cp
     WHERE cp.account_id = p_account_id
       AND cp.expires_at > NOW()
     ORDER BY cp.purchased_at ASC
       FOR UPDATE
  LOOP
    IF v_remaining <= 0 THEN EXIT; END IF;
    v_available := GREATEST(0, v_pack.seconds_total - v_pack.seconds_used);
    IF v_available <= 0 THEN CONTINUE; END IF;
    v_take := LEAST(v_available, v_remaining);
    UPDATE credit_packs SET seconds_used = seconds_used + v_take WHERE id = v_pack.id;
    v_remaining := v_remaining - v_take;
  END LOOP;

  RETURN QUERY SELECT TRUE, p_seconds;
END;
$$ LANGUAGE plpgsql;
