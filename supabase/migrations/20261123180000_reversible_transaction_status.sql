-- An approval has one balance effect while it is active. Leaving approved
-- reverses that effect, so requests can be reopened and reviewed repeatedly.
CREATE OR REPLACE FUNCTION public.update_balance_on_transaction_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_apply boolean := NEW.status = 'approved';
  v_applied boolean := OLD.balance_applied_at IS NOT NULL;
  v_currency text := upper(btrim(NEW.currency));
  v_portfolio boolean := NEW.crypto_id IS NOT NULL AND NEW.quantity IS NOT NULL AND NEW.quantity > 0;
  v_delta numeric; v_before numeric; v_quantity numeric;
BEGIN
  IF NEW.balance_applied_at IS DISTINCT FROM OLD.balance_applied_at THEN
    RAISE EXCEPTION 'The balance application marker is managed automatically' USING ERRCODE = '42501';
  END IF;
  IF (v_applied OR v_apply) AND (
    ROW(NEW.customer_id,NEW.type,NEW.amount,NEW.currency,NEW.crypto_id,NEW.quantity,NEW.unit_price)
    IS DISTINCT FROM ROW(OLD.customer_id,OLD.type,OLD.amount,OLD.currency,OLD.crypto_id,OLD.quantity,OLD.unit_price)
  ) THEN
    RAISE EXCEPTION 'Reopen the transaction before changing its amount or account details' USING ERRCODE = '22023';
  END IF;
  IF v_apply = v_applied THEN RETURN NEW; END IF;
  IF NEW.amount <= 0 OR NEW.amount::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Transaction amount must be greater than zero' USING ERRCODE = '22023';
  END IF;
  v_delta := (CASE WHEN v_apply THEN 1 ELSE -1 END) * (CASE WHEN NEW.type = 'deposit' THEN 1 ELSE -1 END);
  IF v_portfolio THEN
    IF NEW.quantity::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'Invalid asset quantity' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.customer_id::text || ':' || NEW.crypto_id, 0));
    SELECT quantity INTO v_quantity FROM public.portfolio_items
      WHERE user_id = NEW.customer_id AND crypto_id = NEW.crypto_id FOR UPDATE;
    IF coalesce(v_quantity, 0) + v_delta * NEW.quantity < 0 THEN
      RAISE EXCEPTION 'Insufficient % balance for this status change', NEW.crypto_id USING ERRCODE = '22023';
    END IF;
    IF v_quantity IS NULL THEN
      INSERT INTO public.portfolio_items(user_id,crypto_id,crypto_symbol,crypto_name,quantity,purchase_price,purchase_date)
      VALUES (NEW.customer_id,NEW.crypto_id,coalesce(NEW.crypto_symbol,upper(NEW.crypto_id)),
        coalesce(NEW.crypto_name,NEW.crypto_id),v_delta * NEW.quantity,coalesce(NEW.unit_price,NEW.amount / NEW.quantity),now())
      ON CONFLICT (user_id,crypto_id) DO UPDATE
        SET quantity = public.portfolio_items.quantity + EXCLUDED.quantity, updated_at = now();
    ELSE
      -- Keep a zero holding so reopening preserves its original cost metadata.
      UPDATE public.portfolio_items SET quantity = quantity + v_delta * NEW.quantity, updated_at = now()
        WHERE user_id = NEW.customer_id AND crypto_id = NEW.crypto_id;
    END IF;
  ELSE
    IF v_currency NOT IN ('EUR','USD','CAD') THEN
      RAISE EXCEPTION 'Unsupported balance currency: %', v_currency USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.customer_balances(customer_id,currency,balance,updated_by)
      VALUES (NEW.customer_id,v_currency,0,NEW.processed_by)
      ON CONFLICT (customer_id,currency) DO NOTHING;
    SELECT balance INTO v_before FROM public.customer_balances
      WHERE customer_id = NEW.customer_id AND currency = v_currency FOR UPDATE;
    IF v_before + v_delta * NEW.amount < 0 THEN
      RAISE EXCEPTION 'Insufficient % balance for this status change', v_currency USING ERRCODE = '22023';
    END IF;
    UPDATE public.customer_balances
      SET balance = balance + v_delta * NEW.amount, updated_by = coalesce(NEW.processed_by,auth.uid()), updated_at = now()
      WHERE customer_id = NEW.customer_id AND currency = v_currency;
  END IF;
  NEW.balance_applied_at := CASE WHEN v_apply THEN now() ELSE NULL END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.update_balance_on_transaction_approval() FROM PUBLIC, anon, authenticated;
DROP TRIGGER trg_update_balance_on_transaction_approval ON public.transaction_requests;
CREATE TRIGGER trg_update_balance_on_transaction_approval BEFORE UPDATE ON public.transaction_requests
FOR EACH ROW EXECUTE FUNCTION public.update_balance_on_transaction_approval();
COMMENT ON COLUMN public.transaction_requests.balance_applied_at IS
  'Present while the approval balance effect is applied; cleared when that effect is reversed.';

CREATE FUNCTION public.review_transaction_request(
  p_transaction_id uuid, p_status public.transaction_status, p_expected_status public.transaction_status,
  p_message text DEFAULT NULL
)
RETURNS public.transaction_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_request public.transaction_requests%ROWTYPE; v_message text; v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_request FROM public.transaction_requests WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_customer(v_actor, v_request.customer_id) THEN
    RAISE EXCEPTION 'You cannot manage this transaction request' USING ERRCODE = '42501';
  END IF;
  IF v_request.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'This request changed. Refresh it before saving.' USING ERRCODE = '40001';
  END IF;
  IF p_status IS NULL OR p_status = v_request.status THEN
    RAISE EXCEPTION 'Choose a different transaction status' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_message,'')) > 2000 THEN
    RAISE EXCEPTION 'The client message must be at most 2000 characters' USING ERRCODE = '22023';
  END IF;
  v_message := coalesce(nullif(btrim(p_message),''), format('Your %s request for %s %s is now %s.',
    CASE WHEN v_request.type = 'withdraw' THEN 'withdrawal' ELSE 'deposit' END, v_request.amount,v_request.currency,p_status));
  UPDATE public.transaction_requests SET status = p_status, review_message = v_message,
    processed_by = CASE WHEN p_status = 'pending' THEN NULL ELSE v_actor END,
    processed_at = CASE WHEN p_status = 'pending' THEN NULL ELSE now() END
    WHERE id = p_transaction_id RETURNING * INTO v_request;
  INSERT INTO public.notifications(user_id,type,title,message)
  VALUES (v_request.customer_id, CASE p_status WHEN 'approved' THEN 'success' WHEN 'rejected' THEN 'error' ELSE 'info' END,
    format('%s status updated', CASE WHEN v_request.type = 'withdraw' THEN 'Withdrawal' ELSE 'Deposit' END), v_message);
  RETURN v_request;
END;
$$;
REVOKE ALL ON FUNCTION public.review_transaction_request(uuid,public.transaction_status,public.transaction_status,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_transaction_request(uuid,public.transaction_status,public.transaction_status,text) TO authenticated;
