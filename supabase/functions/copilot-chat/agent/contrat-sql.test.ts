// deno test -A supabase/functions/copilot-chat/agent/contrat-sql.test.ts
// Lot Q3 (point 9) — TEST DE CONTRAT : chaque forme de règle produite par conception.ts passe la
// fonction SQL RÉELLE agent_conception_regles_valides (contrainte agent_conceptions_regles_plu_check).
// Constat du 05/11/2026 : une forme nouvelle (UC 9 « non réglementée ») refusée par la contrainte a
// fait boucler la mission. Le SQL ci-dessous est la COPIE de
// supabase/migrations/20261105090000_regles_plu_non_reglementee.sql (vérifiée identique au fichier).
// Exécuté dans PGlite (Postgres en WASM, npm:@electric-sql/pglite) — aucun réseau après installation.
import * as na from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.15';
import {
  appliquerSecteursDeclares, completerRegles, normaliserRegle, reglesDepuisLecture, type RegleConception,
} from './conception.ts';

const SQL_AGENT_CONCEPTION_REGLES_VALIDES = `create or replace function public.agent_conception_regles_valides(p jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when p is null or jsonb_typeof(p) <> 'array' then false else (
     (select count(*) = count(distinct e->>'cle') from jsonb_array_elements(p) e)
     and not exists (
       select 1
         from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(e->>'cle', '') not in ('hauteur_max_m', 'niveaux_max', 'emprise_sol_max_pct',
                                              'recul_voie_m', 'recul_limites_m', 'recul_limites_formule',
                                              'pleine_terre_min_pct', 'stationnement_par_logement',
                                              'mixite_sociale_pct')
           or coalesce(e->>'statut', '') not in ('confirme', 'estime', 'manquant')
           or coalesce(jsonb_typeof(e->'source'), '') <> 'string'
           or btrim(e->>'source') = ''
           or coalesce(jsonb_typeof(e->'unite'), '') <> 'string'
           or not (e ? 'valeur')
           or jsonb_typeof(e->'valeur') not in ('number', 'string', 'null')
           or (e->>'statut' = 'manquant' and jsonb_typeof(e->'valeur') <> 'null')
           or (e->>'statut' <> 'manquant' and jsonb_typeof(e->'valeur') = 'null'
               and not (coalesce(e->>'nature', '') = 'non_reglementee'
                        and coalesce(jsonb_typeof(e->'article'), '') = 'string'
                        and btrim(coalesce(e->>'article', '')) <> ''))
           or (e ? 'article' and jsonb_typeof(e->'article') <> 'string')
           or (e ? 'texte' and jsonb_typeof(e->'texte') <> 'string')
           or (e ? 'nature' and coalesce(e->>'nature', '') not in ('chiffree', 'non_reglementee', 'par_secteur'))
           or (e ? 'secteur' and jsonb_typeof(e->'secteur') not in ('string', 'null'))
           or (e ? 'valeurs_par_secteur' and jsonb_typeof(e->'valeurs_par_secteur') <> 'array')
           or (e ? 'renvoi_document_graphique' and jsonb_typeof(e->'renvoi_document_graphique') not in ('string', 'null', 'boolean'))
           or (e ? 'regle_relative' and jsonb_typeof(e->'regle_relative') not in ('string', 'null'))
           or (e ? 'toiture' and jsonb_typeof(e->'toiture') not in ('string', 'null'))
           or (e ? 'mesure_retenue' and jsonb_typeof(e->'mesure_retenue') not in ('string', 'null'))
     )) end
$$;`;

const MIGRATION = new URL('../../../migrations/20261105090000_regles_plu_non_reglementee.sql', import.meta.url);
const SOURCE = 'Règlement GPU — 92050_PLU_20251209';

async function base(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SQL_AGENT_CONCEPTION_REGLES_VALIDES);
  return db;
}
async function valide(db: PGlite, regles: unknown): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>('select public.agent_conception_regles_valides($1::jsonb) as ok', [JSON.stringify(regles)]);
  return r.rows[0].ok;
}

Deno.test('Q3-9 : copie du SQL identique à la migration 20261105090000', async () => {
  let fichier: string | null = null;
  try { fichier = await Deno.readTextFile(MIGRATION); } catch { fichier = null; }
  if (fichier) na.ok(fichier.replace(/\r\n/g, '\n').includes(SQL_AGENT_CONCEPTION_REGLES_VALIDES), 'le test doit suivre la migration');
});

Deno.test('Q3-9 : toutes les formes de règle de conception.ts passent agent_conception_regles_valides', async () => {
  const db = await base();
  // Valeurs : uniquement celles des preuves (UC 9 non réglementée, UC 10 par secteur — fixture de lecture
  // réelle p. 109 —, UC 6-1 alignement ou recul 4 m, UC 12 « Zone 3 – logements : 1 places/logement »).
  const lues = reglesDepuisLecture({ regles: [
    { cle: 'emprise_sol_max_pct', nature: 'non_reglementee', valeur: null, article: 'UC 9, p. 109', texte: 'Il n’est pas fixé de règle.' },
    { cle: 'hauteur_max_m', nature: 'par_secteur', valeur: null, article: 'UC 10, p. 109', regle_relative: 'UC 10-1 : hauteur ≤ distance à l’alignement opposé + 2 m',
      renvoi_document_graphique: 'Secteurs de hauteur 1 à 4 repérés sur les documents graphiques',
      valeurs_par_secteur: [{ secteur: '1', acrotere_terrasse: 28, egout: 26, faitage: 28, texte: '28 m à l’acrotère' }] },
    { cle: 'stationnement_par_logement', nature: 'par_secteur', valeur: null, article: 'UC 12',
      valeurs_par_secteur: [{ secteur: 'Zone 3', valeur: 1, texte: 'Zone 3 – logements : 1 places/logement' }] },
    { cle: 'recul_voie_m', nature: 'alternative', valeur: null, article: 'UC 6-1, p. 106', texte: 'alignement ou recul minimum de 4 m',
      alternatives: [{ libelle: 'alignement', valeur: 0 }, { libelle: 'recul minimum', valeur: 4 }] },
  ] }, 'gpu', SOURCE);
  const formes: Record<string, RegleConception[]> = {};
  // 1. non réglementée (valeur null, confirmée, article cité)
  formes.non_reglementee = completerRegles(lues.filter((r) => r.nature === 'non_reglementee'));
  // 2. par secteur SANS secteur connu (valeur null → manquant)
  formes.par_secteur_sans_secteur = completerRegles(lues.filter((r) => r.nature === 'par_secteur'));
  // 3. par secteur AVEC secteur (déclaré par l'utilisateur, toiture terrasse)
  formes.par_secteur_avec_secteur = appliquerSecteursDeclares(lues, { hauteur: '1', stationnement: '3', toiture: 'terrasse' }).regles;
  // 4. alternative UC 6-1 (chiffrée, valeur 0, alternatives)
  formes.alternative = completerRegles(lues.filter((r) => r.alternatives));
  // 5. chiffrée simple (modèle → estime) et 6. manquant (completerRegles)
  formes.chiffree = completerRegles([normaliserRegle({ cle: 'recul_voie_m', valeur: 4, source: 'get_prescriptions_urbanisme' }, 'modele')!]);
  formes.manquant = completerRegles([]);
  // 7. toutes ensemble, relues depuis la base (normaliserRegle 'base')
  formes.relues_base = completerRegles(formes.par_secteur_avec_secteur.map((r) => normaliserRegle(r, 'base')!));
  for (const [nom, regles] of Object.entries(formes)) {
    na.ok(await valide(db, regles), `forme « ${nom} » refusée par la contrainte : ${JSON.stringify(regles)}`);
  }
  // Les formes attendues sont bien présentes.
  const ps = formes.par_secteur_avec_secteur;
  na.deepStrictEqual(ps.find((r) => r.cle === 'hauteur_max_m')!.valeur, 28);
  na.deepStrictEqual(ps.find((r) => r.cle === 'stationnement_par_logement')!.valeur, 1);
  na.deepStrictEqual(formes.alternative.find((r) => r.cle === 'recul_voie_m')!.valeur, 0);
  na.deepStrictEqual(formes.par_secteur_sans_secteur.find((r) => r.cle === 'hauteur_max_m')!.statut, 'manquant');
  // Contrôle négatif : la contrainte refuse bien ce qu'elle doit refuser.
  na.equal(await valide(db, [{ cle: 'emprise_sol_max_pct', valeur: null, unite: '%', statut: 'confirme', source: SOURCE, nature: 'non_reglementee' }]), false, 'non réglementée sans article');
  na.equal(await valide(db, [{ cle: 'recul_voie_m', valeur: 0, unite: 'm', statut: 'confirme', source: SOURCE, nature: 'alternative' }]), false, 'nature hors liste');
  await db.close();
});
