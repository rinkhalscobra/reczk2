-- CRM staff can choose which individual fiat and crypto balances appear in
-- the client's balance cards. Existing balances remain visible by default.
ALTER TABLE public.customer_balances
  ADD COLUMN IF NOT EXISTS visible_on_dashboard boolean NOT NULL DEFAULT true;

ALTER TABLE public.portfolio_items
  ADD COLUMN IF NOT EXISTS visible_on_dashboard boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.customer_balances.visible_on_dashboard IS
  'Whether this fiat balance is rendered in client-facing balance cards.';

COMMENT ON COLUMN public.portfolio_items.visible_on_dashboard IS
  'Whether this crypto balance is rendered in client-facing balance cards.';

CREATE OR REPLACE FUNCTION public.set_balance_dashboard_visibility(
  p_customer_id uuid,
  p_balance_kind text,
  p_balance_id uuid,
  p_visible boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_can_manage boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_can_manage :=
    public.has_role(v_actor, 'admin'::public.app_role)
    OR (
      (
        public.has_role(v_actor, 'group_admin'::public.app_role)
        OR public.has_role(v_actor, 'supervisor'::public.app_role)
      )
      AND public.is_same_group(v_actor, p_customer_id)
    )
    OR (
      public.has_role(v_actor, 'agent'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = p_customer_id AND assigned_to = v_actor
      )
    );

  IF NOT v_can_manage THEN
    RAISE EXCEPTION 'You do not have permission to manage this customer' USING ERRCODE = '42501';
  END IF;

  IF p_balance_kind = 'fiat' THEN
    UPDATE public.customer_balances
    SET visible_on_dashboard = p_visible,
        updated_by = v_actor,
        updated_at = now()
    WHERE id = p_balance_id AND customer_id = p_customer_id;
  ELSIF p_balance_kind = 'crypto' THEN
    UPDATE public.portfolio_items
    SET visible_on_dashboard = p_visible,
        updated_at = now()
    WHERE id = p_balance_id AND user_id = p_customer_id;
  ELSE
    RAISE EXCEPTION 'Balance kind must be fiat or crypto' USING ERRCODE = '22023';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Balance was not found for this customer' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_balance_dashboard_visibility(uuid, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_balance_dashboard_visibility(uuid, text, uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.set_balance_dashboard_visibility(uuid, text, uuid, boolean) IS
  'Allows authorized CRM staff to show or hide one customer balance on client-facing balance cards.';
