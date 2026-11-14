// deno test -A supabase/functions/copilot-chat/agent/extension-sql.test.ts
// LOT X3 — migration 20261114120000_studio_image_existant.sql exécutée TELLE QUELLE dans PGlite (Postgres en WASM) :
//   · rejouable ;
//   · ÉQUIVALENTE à la définition de PRODUCTION (lue le 14/11/2026, recopiée ci-dessous sous un autre nom) pour toute
//     option sans `existant` (film, visite, image : 40 cas, dont photo de rue, photo du client, calage, zone à effacer) ;
//   · accepte `existant` ∈ {conserver, effacer} pour une image, refuse « partiel », une valeur non textuelle, la clé
//     pour un film ou une visite, et `existant = conserver` avec `masque_existant`.
import * as na from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.15';

const MIGRATION = new URL('../../../migrations/20261114120000_studio_image_existant.sql', import.meta.url);

// Fonctions auxiliaires : définitions de PRODUCTION (pg_get_functiondef, 14/11/2026, lecture seule), sans changement.
const AUXILIAIRES = String.raw`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
CREATE OR REPLACE FUNCTION public._studio_masque_existant_valide(p jsonb)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_octets numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('chemin', 'octets')) then return false; end if;
  if jsonb_typeof(p->'chemin') is distinct from 'string'
     or (p->>'chemin') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.png$' then return false; end if;
  if jsonb_typeof(p->'octets') is distinct from 'number' then return false; end if;
  v_octets := (p->>'octets')::numeric;
  if v_octets <> trunc(v_octets) or v_octets < 1 or v_octets > 8388608 then return false; end if;
  return true;
end;
$function$;
CREATE OR REPLACE FUNCTION public._studio_calage_client_valide(p jsonb)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_l numeric; v_h numeric; v_c jsonb; v_i jsonb; v_m jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k
              where k not in ('version', 'correspondances', 'largeur_image', 'hauteur_image', 'valide_le')) then return false; end if;
  if jsonb_typeof(p->'version') is distinct from 'number' or (p->>'version')::numeric <> 1 then return false; end if;
  if jsonb_typeof(p->'largeur_image') is distinct from 'number' or jsonb_typeof(p->'hauteur_image') is distinct from 'number' then return false; end if;
  v_l := (p->>'largeur_image')::numeric;
  v_h := (p->>'hauteur_image')::numeric;
  if v_l <> trunc(v_l) or v_h <> trunc(v_h) or v_l < 1 or v_h < 1 or v_l > 20000 or v_h > 20000 then return false; end if;
  if jsonb_typeof(p->'valide_le') is distinct from 'string' or length(p->>'valide_le') > 40
     or (p->>'valide_le') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}' then return false; end if;
  if jsonb_typeof(p->'correspondances') is distinct from 'array'
     or jsonb_array_length(p->'correspondances') not between 2 and 12 then return false; end if;
  for v_c in select x from jsonb_array_elements(p->'correspondances') as x loop
    if jsonb_typeof(v_c) is distinct from 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v_c) k where k not in ('image', 'monde')) then return false; end if;
    v_i := v_c->'image';
    v_m := v_c->'monde';
    if jsonb_typeof(v_i) is distinct from 'array' or jsonb_array_length(v_i) <> 2
       or jsonb_typeof(v_m) is distinct from 'array' or jsonb_array_length(v_m) <> 3 then return false; end if;
    if jsonb_typeof(v_i->0) is distinct from 'number' or jsonb_typeof(v_i->1) is distinct from 'number'
       or jsonb_typeof(v_m->0) is distinct from 'number' or jsonb_typeof(v_m->1) is distinct from 'number'
       or jsonb_typeof(v_m->2) is distinct from 'number' then return false; end if;
    if (v_i->>0)::numeric < 0 or (v_i->>1)::numeric < 0 or (v_i->>0)::numeric > v_l or (v_i->>1)::numeric > v_h then return false; end if;
    if abs((v_m->>0)::numeric) > 180 or abs((v_m->>1)::numeric) > 90 or abs((v_m->>2)::numeric) > 1000 then return false; end if;
  end loop;
  return true;
end;
$function$;
CREATE OR REPLACE FUNCTION public._studio_photo_client_valide(p jsonb)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_pdv jsonb; v_octets numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('chemin', 'octets', 'point_de_vue')) then return false; end if;
  if jsonb_typeof(p->'chemin') is distinct from 'string'
     or (p->>'chemin') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png)$' then return false; end if;
  if jsonb_typeof(p->'octets') is distinct from 'number' then return false; end if;
  v_octets := (p->>'octets')::numeric;
  if v_octets <> trunc(v_octets) or v_octets < 1 or v_octets > 20971520 then return false; end if;
  v_pdv := p->'point_de_vue';
  if v_pdv is not null then
    if jsonb_typeof(v_pdv) is distinct from 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v_pdv) k where k not in ('lon', 'lat', 'cap_deg')) then return false; end if;
    if jsonb_typeof(v_pdv->'lon') is distinct from 'number' or jsonb_typeof(v_pdv->'lat') is distinct from 'number' then return false; end if;
    if abs((v_pdv->>'lon')::numeric) > 180 or abs((v_pdv->>'lat')::numeric) > 90 then return false; end if;
    if v_pdv->'cap_deg' is not null then
      if jsonb_typeof(v_pdv->'cap_deg') is distinct from 'number' then return false; end if;
      if (v_pdv->>'cap_deg')::numeric < 0 or (v_pdv->>'cap_deg')::numeric >= 360 then return false; end if;
    end if;
  end if;
  return true;
end;
$function$;
`;

// Définition de PRODUCTION de _studio_job_options_valides (14/11/2026), renommée « _prod » pour la comparaison.
const PRODUCTION = String.raw`
CREATE OR REPLACE FUNCTION public._studio_job_options_valides_prod(p_type text, p_options jsonb)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when jsonb_typeof(p_options) is distinct from 'object' then false
    when p_type = 'film' then
          (select coalesce(bool_and(k in ('duree_s', 'ambiance', 'format', 'interieurs', 'musique')), true)
             from jsonb_object_keys(p_options) as k)
      and coalesce(p_options->>'duree_s', '60') in ('30', '60', '90')
      and coalesce(p_options->>'ambiance', 'jour') in ('jour', 'fin_de_journee', 'nuit')
      and coalesce(p_options->>'format', '16:9') in ('16:9', '9:16')
      and coalesce(jsonb_typeof(p_options->'interieurs'), 'boolean') = 'boolean'
      and coalesce(jsonb_typeof(p_options->'musique'), 'boolean') = 'boolean'
    when p_type = 'visite360' then
          (select coalesce(bool_and(k in ('ambiance', 'interieurs', 'resolution')), true)
             from jsonb_object_keys(p_options) as k)
      and coalesce(p_options->>'ambiance', 'jour') in ('jour', 'fin_de_journee', 'nuit')
      and coalesce(jsonb_typeof(p_options->'interieurs'), 'boolean') = 'boolean'
      and coalesce(p_options->>'resolution', '6k') in ('6k', '8k')
    when p_type = 'image' then
          (select coalesce(bool_and(k in ('vues', 'ambiance', 'qualite', 'fond', 'photo_rue', 'photo_client', 'calage_client', 'masque_existant')), true)
             from jsonb_object_keys(p_options) as k)
      and coalesce(p_options->>'ambiance', 'jour') in ('jour', 'fin_de_journee')
      and coalesce(p_options->>'qualite', 'finale') in ('finale', 'apercu')
      and (
        p_options->'vues' is null
        or case when jsonb_typeof(p_options->'vues') is distinct from 'array' then false else (
          jsonb_array_length(p_options->'vues') between 1 and 3
          and (select bool_and(jsonb_typeof(v) = 'string'
                               and v #>> '{}' in ('trois_quarts_gauche', 'trois_quarts_droite', 'face'))
                 from jsonb_array_elements(p_options->'vues') as v)
          and (select count(distinct v #>> '{}') from jsonb_array_elements(p_options->'vues') as v)
              = jsonb_array_length(p_options->'vues')
        ) end
      )
      and (p_options->'fond' is null
           or (jsonb_typeof(p_options->'fond') = 'string' and p_options->>'fond' in ('etude', 'photo_rue', 'photo_client')))
      and (p_options->'photo_rue' is null
           or case when coalesce(p_options->>'fond', 'etude') <> 'photo_rue' or jsonb_typeof(p_options->'photo_rue') is distinct from 'object' then false
                   else (select coalesce(bool_and(k = 'id'), true) from jsonb_object_keys(p_options->'photo_rue') as k)
                        and jsonb_typeof(p_options->'photo_rue'->'id') = 'string'
                        and (p_options->'photo_rue'->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' end)
      and case when coalesce(p_options->>'fond', 'etude') = 'photo_client'
               then p_options->'photo_client' is not null and public._studio_photo_client_valide(p_options->'photo_client')
               else p_options->'photo_client' is null end
      and (p_options->'calage_client' is null
           or (coalesce(p_options->>'fond', 'etude') in ('photo_rue', 'photo_client')
               and public._studio_calage_client_valide(p_options->'calage_client')))
      and (p_options->'masque_existant' is null
           or (p_options->'calage_client' is not null
               and public._studio_masque_existant_valide(p_options->'masque_existant')))
    else false
  end;
$function$;
`;

const U1 = '11111111-1111-4111-8111-111111111111';
const CALAGE = { version: 1, largeur_image: 4032, hauteur_image: 3024, valide_le: '2026-11-12T12:00:00Z', correspondances: [{ image: [1, 1], monde: [2.4, 48.8, 0] }, { image: [2, 2], monde: [2.4, 48.8, 0] }] };
const MASQUE = { chemin: `${U1}/22222222-2222-4222-8222-222222222222.png`, octets: 12345 };
const PHOTO = { chemin: `${U1}/33333333-3333-4333-8333-333333333333.jpg`, octets: 5000, point_de_vue: { lon: 2.4, lat: 48.8, cap_deg: 90 } };

/** Options SANS `existant` : la nouvelle fonction doit répondre exactement comme la production. */
const CAS_SANS_EXISTANT: [string, unknown][] = [
  ['film', {}], ['film', { duree_s: 30, ambiance: 'nuit', format: '9:16', interieurs: false, musique: true }], ['film', { duree_s: 45 }], ['film', { vues: ['face'] }],
  ['film', { interieurs: 'oui' }], ['visite360', {}], ['visite360', { resolution: '8k', ambiance: 'fin_de_journee' }], ['visite360', { resolution: '4k' }],
  ['visite360', { duree_s: 30 }], ['image', {}], ['image', { vues: ['face', 'trois_quarts_gauche'], ambiance: 'jour', qualite: 'apercu' }],
  ['image', { vues: ['face', 'face'] }], ['image', { vues: [] }], ['image', { vues: ['dessus'] }], ['image', { vues: 'face' }], ['image', { ambiance: 'nuit' }],
  ['image', { qualite: 'brouillon' }], ['image', { fond: 'etude' }], ['image', { fond: 'lune' }], ['image', { fond: 'photo_rue' }],
  ['image', { fond: 'photo_rue', photo_rue: { id: '44444444-4444-4444-8444-444444444444' } }], ['image', { fond: 'photo_rue', photo_rue: { id: 'x' } }],
  ['image', { photo_rue: { id: '44444444-4444-4444-8444-444444444444' } }], ['image', { fond: 'photo_client', photo_client: PHOTO }],
  ['image', { fond: 'photo_client' }], ['image', { photo_client: PHOTO }], ['image', { fond: 'photo_client', photo_client: { ...PHOTO, octets: 0 } }],
  ['image', { fond: 'photo_rue', calage_client: CALAGE }], ['image', { calage_client: CALAGE }], ['image', { fond: 'photo_rue', calage_client: { ...CALAGE, version: 2 } }],
  ['image', { fond: 'photo_rue', calage_client: CALAGE, masque_existant: MASQUE }], ['image', { fond: 'photo_rue', masque_existant: MASQUE }],
  ['image', { fond: 'photo_rue', calage_client: CALAGE, masque_existant: { ...MASQUE, chemin: 'a.png' } }], ['image', { inconnue: 1 }],
  ['image', { fond: 'photo_client', photo_client: PHOTO, calage_client: CALAGE, masque_existant: MASQUE }], ['inconnu', {}], ['image', null as unknown],
  ['film', { masque_existant: MASQUE }], ['visite360', { interieurs: true }], ['image', { vues: ['trois_quarts_droite'], ambiance: 'fin_de_journee' }],
];

async function base(): Promise<PGlite | null> {
  let sql: string;
  try { sql = await Deno.readTextFile(MIGRATION); } catch { return null; }
  const db = new PGlite();
  await db.exec(AUXILIAIRES);
  await db.exec(PRODUCTION);
  await db.exec(sql);
  await db.exec(sql); // rejouable
  return db;
}

const valide = async (db: PGlite, f: string, type: string, o: unknown): Promise<boolean | null> =>
  (await db.query<{ r: boolean | null }>(`select public.${f}($1, $2::jsonb) as r`, [type, o === null ? 'null' : JSON.stringify(o)])).rows[0].r;

Deno.test('X3-SQL-1 : migration rejouable ; équivalente à la production pour toute option sans « existant » (40 cas)', async () => {
  const db = await base();
  if (!db) return;
  na.equal(CAS_SANS_EXISTANT.length, 40);
  for (const [t, o] of CAS_SANS_EXISTANT) {
    na.equal(await valide(db, '_studio_job_options_valides', t, o), await valide(db, '_studio_job_options_valides_prod', t, o), `${t} ${JSON.stringify(o)}`);
  }
  // Témoins : la production refuse bien la clé `existant` (constat du 14/11/2026).
  na.equal(await valide(db, '_studio_job_options_valides_prod', 'image', { existant: 'conserver' }), false);
  await db.close();
});

Deno.test('X3-SQL-2 : « existant » accepté pour une image (conserver, effacer), refusé sinon ; jamais avec une zone à effacer si conservé', async () => {
  const db = await base();
  if (!db) return;
  const f = '_studio_job_options_valides';
  na.equal(await valide(db, f, 'image', { vues: ['face'], existant: 'conserver' }), true);
  na.equal(await valide(db, f, 'image', { existant: 'effacer' }), true);
  na.equal(await valide(db, f, 'image', { fond: 'photo_rue', photo_rue: { id: '44444444-4444-4444-8444-444444444444' }, existant: 'conserver' }), true);
  na.equal(await valide(db, f, 'image', { fond: 'photo_client', photo_client: PHOTO, calage_client: CALAGE, existant: 'conserver' }), true);
  na.equal(await valide(db, f, 'image', { existant: 'partiel' }), false, 'démolition partielle réservée');
  na.equal(await valide(db, f, 'image', { existant: true }), false);
  na.equal(await valide(db, f, 'image', { existant: null }), false, 'null JSON explicite refusé');
  na.equal(await valide(db, f, 'film', { existant: 'conserver' }), false);
  na.equal(await valide(db, f, 'visite360', { existant: 'conserver' }), false);
  // Conserver + zone à effacer : refusé ; effacer + zone à effacer : accepté (comportement P5 inchangé).
  na.equal(await valide(db, f, 'image', { fond: 'photo_rue', calage_client: CALAGE, masque_existant: MASQUE, existant: 'conserver' }), false);
  na.equal(await valide(db, f, 'image', { fond: 'photo_rue', calage_client: CALAGE, masque_existant: MASQUE, existant: 'effacer' }), true);
  // Jamais de réponse NULL (le déclencheur attend vrai ou faux).
  for (const [t, o] of [...CAS_SANS_EXISTANT, ['image', { existant: 'conserver' }] as [string, unknown]]) {
    if (o === null) continue;
    na.notEqual(await valide(db, f, t, o), null, `${t} ${JSON.stringify(o)}`);
  }
  await db.close();
});
