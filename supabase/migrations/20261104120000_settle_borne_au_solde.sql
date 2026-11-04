-- =============================================================================
-- Facturation Copilot : débit au réel, mais jamais sous zéro
-- =============================================================================
--
-- Contexte
-- --------
-- Depuis 20260908_facturation_reelle_copilot.sql, `copilot_settle_credits`
-- prélève le dépassement de la réservation sans limite : le solde de
-- `credit_accounts.current_credits` peut devenir négatif (postpayé de fait).
-- Vérifié en prod le 04/11/2026 (pg_get_functiondef : greatest(coalesce(...)),
-- aucun « if v_final > v_reserved »).
--
-- Décision d'Albé (04/11/2026) : garder le débit au coût réel, mais borné au
-- solde disponible. Le solde ne passe jamais sous zéro.
--
-- Ce que change cette migration
-- -----------------------------
--   · débit réel <= réservé : inchangé (on rend la différence) ;
--   · débit réel  > réservé : on prélève le complément DANS LA LIMITE du solde
--     disponible (verrouillé FOR UPDATE). La part qui ne peut pas être prélevée
--     n'est pas facturée ; elle est tracée dans la description de la transaction
--     et dans le journal Postgres (raise log), pour pouvoir ajuster la réservation.
--   · `copilot_reservations.amount` stocke ce qui a réellement été facturé.
--
-- Inchangé : signature (5 arguments), plancher de 1 jeton, idempotence,
-- `copilot_reserve_credits` (qui refuse déjà une demande si le solde est
-- inférieur au montant réservé), missions autonomes (déjà plafonnées par
-- agent_mission_debiter / agent_mission_regler).
--
-- Réversible : réappliquer la définition de 20260908_facturation_reelle_copilot.sql.
-- =============================================================================

create or replace function public.copilot_settle_credits(
  p_user_id        uuid,
  p_reservation_id uuid,
  p_message_id     uuid,
  p_metadata       jsonb,
  p_final_amount   integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reserved    int;
  v_reel        int;
  v_final       int;
  v_delta       int;
  v_solde       int;
  v_complement  int := 0;
  v_non_facture int := 0;
begin
  -- Verrouille la réservation et lit le montant immobilisé (pire cas estimé).
  select amount into v_reserved
  from copilot_reservations
  where id = p_reservation_id and user_id = p_user_id and status = 'reserved'
  for update;

  if v_reserved is null then
    return;  -- déjà settled/refunded → rien à faire (idempotent)
  end if;

  -- Coût réel demandé. Plancher à 1 jeton. NULL = repli sur le réservé.
  v_reel  := greatest(coalesce(p_final_amount, v_reserved), 1);
  v_final := v_reel;

  if v_reel > v_reserved then
    -- Dépassement : prélevé seulement dans la limite du solde disponible.
    select current_credits into v_solde
    from credit_accounts
    where user_id = p_user_id
    for update;

    v_complement  := least(v_reel - v_reserved, greatest(coalesce(v_solde, 0), 0));
    v_non_facture := (v_reel - v_reserved) - v_complement;
    v_final       := v_reserved + v_complement;

    if v_non_facture > 0 then
      raise log 'copilot_settle_credits: % jeton(s) non facturé(s) faute de solde (user %, reservation %, reel %, reserve %)',
        v_non_facture, p_user_id, p_reservation_id, v_reel, v_reserved;
    end if;
  end if;

  -- > 0 : part réservée non consommée, à rendre.
  -- < 0 : complément prélevé (jamais plus que le solde disponible).
  v_delta := v_reserved - v_final;

  update copilot_reservations
  set status     = 'settled',
      message_id = p_message_id,
      settled_at = now(),
      amount     = v_final        -- ce qui a réellement été facturé
  where id = p_reservation_id;

  if v_delta <> 0 then
    update credit_accounts
    set current_credits = current_credits + v_delta
    where user_id = p_user_id;

    insert into credit_transactions (user_id, type, amount, description)
    values (
      p_user_id,
      case when v_delta > 0 then 'copilot_settle_refund'
           else 'copilot_settle_complement' end,
      v_delta,
      case when v_delta > 0
             then 'Ajustement débit variable Copilot (réservé - réel)'
           when v_non_facture > 0
             then 'Complément de débit Copilot borné au solde ('
                  || v_non_facture || ' jeton(s) non facturé(s))'
           else 'Complément de débit Copilot (usage réel supérieur à la réservation)'
      end
    );
  end if;
end
$function$;

comment on function public.copilot_settle_credits(uuid, uuid, uuid, jsonb, integer) is
  'Règle une réservation Copilot au coût réel, borné au solde disponible depuis '
  '2026-11-04 : rend le trop-réservé, prélève le dépassement sans jamais rendre '
  'le solde négatif. La part non prélevable est tracée (raise log + description).';
