-- ═══════════════════════════════════════════════════════════════════════════
-- Fraîcheur des données de référence
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mimmoza s'appuie sur une trentaine de jeux de données publics — cadastre,
-- INSEE, DGFiP, ANIL, logement social — qui se périment chacun à leur rythme.
-- Rien ne le signalait : une donnée de 2021 s'affichait avec le même aplomb
-- qu'une donnée de la semaine.
--
-- ─── Pourquoi un registre plutôt qu'une date écrite par les scripts ─────────
-- La tentation est de faire écrire à chaque script d'import sa date de fin.
-- Mais un script qui échoue à mi-parcours, ou qu'on oublie de brancher, laisse
-- alors une date rassurante sur une donnée périmée — le pire résultat possible
-- pour un tableau de bord d'alertes.
--
-- Ici, le registre déclare seulement OÙ REGARDER : la table et la colonne. La
-- mesure est faite à la lecture, sur la donnée réelle. Un import qui n'a pas
-- tourné ne peut pas prétendre le contraire.
--
-- ─── Les trois modes de mesure ──────────────────────────────────────────────
--   millesime   la colonne porte une année (2025, ou « 2025 » en texte selon
--               les tables). Date de référence : le 31 décembre de cette année.
--   horodatage  la colonne porte une date ou un timestamp. Date de référence :
--               la valeur maximale trouvée.
--   manuel      la table ne porte aucune colonne datable — c'est le cas du
--               cadastre, de la BPE, des EHPAD. La date est saisie dans le
--               registre. Laissée vide, le statut reste « inconnu », ce qui est
--               l'aveu honnête : personne ne sait de quand date ce chargement.

-- ── Registre ────────────────────────────────────────────────────────────────

create table if not exists public.sources_donnees_reference (
  cle               text primary key,
  libelle           text not null,
  categorie         text not null,

  -- Où regarder. NULL pour une source purement déclarative.
  table_cible       text,
  colonne_fraicheur text,
  mode_mesure       text not null
    check (mode_mesure in ('millesime', 'horodatage', 'manuel')),

  -- Périodicité attendue, puis délai de grâce avant de crier au périmé. La
  -- publication d'un jeu de données glisse souvent de quelques semaines : sans
  -- tolérance, le tableau de bord passerait son temps en rouge pour rien.
  cadence_jours     integer not null check (cadence_jours > 0),
  tolerance_jours   integer not null default 60 check (tolerance_jours >= 0),

  source_url        text,
  commande_maj      text,   -- la commande exacte à relancer
  date_manuelle     date,   -- mode « manuel » uniquement
  actif             boolean not null default true,
  notes             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Une mesure automatique sans table ni colonne ne mesurerait rien : autant
  -- que la base refuse la déclaration incohérente plutôt que d'afficher un
  -- « inconnu » qu'on mettrait des mois à comprendre.
  constraint sources_donnees_mesure_coherente check (
    mode_mesure = 'manuel'
    or (table_cible is not null and colonne_fraicheur is not null)
  )
);

comment on table public.sources_donnees_reference is
  'Registre des jeux de données de référence et de leur périodicité attendue. '
  'Déclare où lire la fraîcheur, jamais la fraîcheur elle-même : celle-ci est '
  'mesurée à la lecture par admin_fraicheur_donnees(), sur la donnée réelle.';

alter table public.sources_donnees_reference enable row level security;

drop policy if exists sources_donnees_lecture_admin on public.sources_donnees_reference;
create policy sources_donnees_lecture_admin
  on public.sources_donnees_reference
  for select using (public.is_current_user_admin());

drop policy if exists sources_donnees_ecriture_admin on public.sources_donnees_reference;
create policy sources_donnees_ecriture_admin
  on public.sources_donnees_reference
  for all using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- ── Mesure ──────────────────────────────────────────────────────────────────

create or replace function public.admin_fraicheur_donnees()
returns table (
  cle             text,
  libelle         text,
  categorie       text,
  table_cible     text,
  mode_mesure     text,
  valeur_mesuree  text,
  date_reference  date,
  age_jours       integer,
  lignes          bigint,
  cadence_jours   integer,
  tolerance_jours integer,
  statut          text,
  source_url      text,
  commande_maj    text,
  notes           text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_src    record;
  v_valeur text;
  v_lignes bigint;
  v_date   date;
  v_annee  integer;
  v_age    integer;
begin
  if not public.is_current_user_admin() then
    raise exception 'forbidden';
  end if;

  for v_src in
    select * from public.sources_donnees_reference
    where actif
    order by categorie, libelle
  loop
    cle             := v_src.cle;
    libelle         := v_src.libelle;
    categorie       := v_src.categorie;
    table_cible     := v_src.table_cible;
    mode_mesure     := v_src.mode_mesure;
    cadence_jours   := v_src.cadence_jours;
    tolerance_jours := v_src.tolerance_jours;
    source_url      := v_src.source_url;
    commande_maj    := v_src.commande_maj;
    notes           := v_src.notes;
    valeur_mesuree  := null;
    date_reference  := null;
    age_jours       := null;
    lignes          := null;

    -- Une table déclarée peut avoir été renommée ou supprimée par une
    -- migration. On le dit franchement plutôt que de laisser l'exception
    -- emporter tout le tableau de bord : une ligne fausse est plus facile à
    -- corriger qu'un écran vide.
    if v_src.table_cible is not null
       and to_regclass('public.' || quote_ident(v_src.table_cible)) is null then
      statut := 'table_absente';
      return next;
      continue;
    end if;

    if v_src.table_cible is not null then
      execute format('select count(*) from public.%I', v_src.table_cible)
        into lignes;
    end if;

    if v_src.mode_mesure = 'manuel' then
      date_reference := v_src.date_manuelle;
      valeur_mesuree := to_char(v_src.date_manuelle, 'YYYY-MM-DD');

    elsif v_src.colonne_fraicheur is not null then
      -- %I échappe les identifiants ; ils viennent du registre, lui-même
      -- réservé aux administrateurs, mais on ne concatène jamais en clair.
      execute format(
        'select max(%I)::text from public.%I',
        v_src.colonne_fraicheur, v_src.table_cible
      ) into valeur_mesuree;

      if valeur_mesuree is not null then
        if v_src.mode_mesure = 'millesime' then
          -- `millesime` est un entier sur la plupart des tables, du texte sur
          -- zonage_abc et logements_sociaux_sru. On extrait l'année plutôt que
          -- de parier sur le type.
          v_annee := nullif(substring(valeur_mesuree from '\d{4}'), '')::integer;
          if v_annee between 1900 and 2200 then
            date_reference := make_date(v_annee, 12, 31);
          end if;
        else
          begin
            date_reference := valeur_mesuree::timestamptz::date;
          exception when others then
            date_reference := null;
          end;
        end if;
      end if;
    end if;

    -- Statut. Une table vide n'est pas « périmée » mais « jamais chargée » :
    -- confondre les deux enverrait relancer un import qui n'a jamais eu lieu
    -- en croyant en rejouer un ancien.
    if coalesce(lignes, 0) = 0 and v_src.table_cible is not null then
      statut := 'vide';
    elsif date_reference is null then
      statut := 'inconnu';
    else
      v_age := current_date - date_reference;
      age_jours := v_age;
      if v_age <= v_src.cadence_jours then
        statut := 'a_jour';
      elsif v_age <= v_src.cadence_jours + v_src.tolerance_jours then
        statut := 'a_verifier';
      else
        statut := 'perime';
      end if;
    end if;

    return next;
  end loop;
end;
$$;

comment on function public.admin_fraicheur_donnees() is
  'Mesure la fraîcheur réelle de chaque source déclarée dans '
  'sources_donnees_reference. Réservée aux administrateurs.';

revoke all on function public.admin_fraicheur_donnees() from public, anon;
grant execute on function public.admin_fraicheur_donnees() to authenticated;
