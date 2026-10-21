-- =============================================================================
-- Facturation Copilot au coût réel — suppression du plafond de règlement
-- =============================================================================
--
-- Le problème
-- -----------
-- `copilot_settle_credits` plafonnait le débit au montant réservé :
--
--     if v_final > v_reserved then v_final := v_reserved; end if;
--
-- Or la réservation est calculée sur une HYPOTHÈSE d'entrée (ASSUMED_MAX_INPUT_TOKENS
-- côté Edge Function), pas sur l'usage constaté. Dès que la consommation réelle
-- dépassait cette hypothèse, la différence n'était pas facturée : elle était
-- offerte, silencieusement.
--
-- Mesuré sur 90 jours de production avant ce correctif : 41 réponses en mode
-- `report` au-dessus du plafond de réservation, jusqu'à 145 000 tokens d'entrée
-- pour une hypothèse à 60 000. La marge de 3× absorbait encore l'écart, mais le
-- point de bascule était à ~300 000 tokens d'entrée — et les corrections
-- apportées à la troncature (timeout d'inactivité, bloc de rappel des outils
-- enfin fonctionnel) poussent mécaniquement l'entrée à la hausse.
--
-- Ce que change cette migration
-- -----------------------------
-- Le règlement devient la VÉRITÉ, la réservation n'est plus qu'une empreinte :
--   · débit réel INFÉRIEUR au réservé  → on rend la différence (inchangé) ;
--   · débit réel SUPÉRIEUR au réservé  → on prélève le complément (nouveau).
--
-- Le plancher de 1 jeton est conservé. Le plafond disparaît.
--
-- Solde négatif : assumé et voulu
-- -------------------------------
-- `credit_accounts.current_credits` n'a aucune contrainte CHECK : le complément
-- peut donc faire passer un solde sous zéro. C'est le comportement recherché —
-- `copilot_reserve_credits` refuse toute nouvelle demande tant que le solde est
-- inférieur au montant réservé, un solde négatif bloque donc naturellement le
-- service jusqu'au rechargement, au lieu d'effacer une dette réelle.
--
-- Réversible : réappliquer l'ancienne définition rétablit le plafond.
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
  v_reserved int;
  v_final    int;
  v_delta    int;
begin
  -- Verrouille la réservation et lit le montant immobilisé (pire cas estimé).
  select amount into v_reserved
  from copilot_reservations
  where id = p_reservation_id and user_id = p_user_id and status = 'reserved'
  for update;

  if v_reserved is null then
    return;  -- déjà settled/refunded → rien à faire (idempotent)
  end if;

  -- Débit réel. Plancher à 1 jeton, PLUS DE PLAFOND : sous-facturer un
  -- dépassement revenait à offrir la différence à chaque requête lourde.
  -- p_final_amount NULL conserve l'ancien repli (on débite le réservé).
  v_final := greatest(coalesce(p_final_amount, v_reserved), 1);

  -- > 0 : part réservée non consommée, à rendre.
  -- < 0 : dépassement de l'estimation, à prélever.
  v_delta := v_reserved - v_final;

  update copilot_reservations
  set status     = 'settled',
      message_id = p_message_id,
      settled_at = now(),
      amount     = v_final        -- on stocke ce qui a réellement été consommé
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
             else 'Complément de débit Copilot (usage réel supérieur à la réservation)'
      end
    );
  end if;
end
$function$;

comment on function public.copilot_settle_credits(uuid, uuid, uuid, jsonb, integer) is
  'Règle une réservation Copilot au coût réel. Rend le trop-réservé, prélève le '
  'dépassement. Sans plafond depuis 2026-09-08 : la réservation est une empreinte, '
  'le règlement fait foi. Peut rendre le solde négatif, ce qui bloque le service '
  'jusqu''au rechargement.';
