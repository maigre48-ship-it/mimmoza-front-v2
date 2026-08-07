// supabase/functions/loyers-reference-v1/index.ts
// =============================================================
// Mimmoza — Loyers de référence (Carte des loyers ANIL/DHUP)
// Source de données #1 branchée dans MimmozIA.
//
// Rôle : renvoyer le loyer médian (€/m²/mois) d'une commune,
//   ventilé appartement / maison + médiane globale, à partir de
//   la table public.loyers_reference (34 900 communes, millésime 2025).
//
// Autonome (éditée dans le Dashboard, aucun import _shared) :
//   - chemin principal : lit la table par code_insee ;
//   - repli : résout code_insee depuis une commune / un code postal
//     via geo.api.gouv.fr (déjà whitelistée réseau) ;
//   - PLM : Paris (75056), Lyon (69123), Marseille (13055) n'ont PAS
//     de ligne « commune globale » → éclatement sur les arrondissements
//     et renvoi d'une fourchette min–médiane–max.
//
// Contrat de sortie (aligné dpe-ademe-v1 / patrimoine-merimee-v1 / batiment-bdnb-v1) :
//   { status, summary, stats, items }
//   status ∈ 'ok' | 'no_data' | 'no_localization' | 'error'
//   → renvoyé en HTTP 200 même pour no_data / error, pour que
//     l'orchestrateur (callInternalFunction) ne les traite pas comme
//     des erreurs HTTP mais comme des statuts métier.
//
// Secrets utilisés : SUPABASE_URL + clé service-role.
//   ⚠️ Projet sur JWT Signing Keys : on lit SUPABASE_SECRET_KEYS
//      (dictionnaire JSON) EN PRIORITÉ ; la legacy provoque un 401.
// =============================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ── PLM : codes « commune globale » (absents de la table) → arrondissements ──
const PLM_ARRONDISSEMENTS: Record<string, string[]> = {
  '75056': range(75101, 75120), // Paris  (20 arrondissements)
  '69123': range(69381, 69389), // Lyon   (9 arrondissements)
  '13055': range(13201, 13216), // Marseille (16 arrondissements)
};
const PLM_LABEL: Record<string, string> = {
  '75056': 'Paris',
  '69123': 'Lyon',
  '13055': 'Marseille',
};

function range(from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(String(i));
  return out;
}

// ── Colonnes lues (schéma public.loyers_reference) ───────────
const COLS = [
  'code_insee', 'commune_nom',
  'loyer_median_appartement', 'loyer_median_maison', 'loyer_median_global',
  'nbobs_appartement', 'nbobs_maison', 'nb_observations',
  'typpred_appartement', 'typpred_maison',
  'millesime',
].join(', ');

// =============================================================
// Client Supabase service-role (multi-clés, JWT Signing Keys)
// =============================================================

function readFirstJsonKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      const first = Object.values(parsed).find((v) => typeof v === 'string');
      if (typeof first === 'string') return first;
    }
  } catch {
    return raw; // valeur brute (pas du JSON)
  }
  return null;
}

let _admin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = Deno.env.get('SUPABASE_URL');
  const key =
    readFirstJsonKey(Deno.env.get('SUPABASE_SECRET_KEYS')) ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
    Deno.env.get('SERVICE_ROLE_KEY');
  if (!url) throw new Error('Missing SUPABASE_URL env');
  if (!key) throw new Error('Missing Supabase service role key env');
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  });
  return _admin;
}

// =============================================================
// Helpers
// =============================================================

function cors(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json' },
  });
}

function normStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

// =============================================================
// Référentiel INSEE (geo.api.gouv.fr) : vérification SYSTÉMATIQUE
// ⚠️ L'ancienne garde négative `if (!codeInsee && (commune || zipCode))` désactivait
//   la seule vérification existante dès qu'un code_insee était fourni : un code
//   inexistant, ou existant mais désignant une autre commune, traversait la
//   fonction sans contrôle et ressortait avec une source officielle attachée.
//   Tout code reçu (fourni OU déduit) est désormais confronté au référentiel.
// =============================================================

const FORME_INSEE = /^(?:\d{5}|2[AB]\d{3})$/i;

type EtatInsee = 'trouve' | 'inexistant' | 'indisponible';
interface VerifInsee { etat: EtatInsee; code?: string; nom?: string }

// Coupe-circuit court : un tour de conversation peut appeler une dizaine d'outils.
// Si geo.api vient de ne pas répondre, réessayer à chaque appel cumule autant de
// timeouts de 4 s. On considère le référentiel injoignable pendant COUPE_CIRCUIT_MS,
// délai volontairement court pour rester réessayable au tour suivant.
const COUPE_CIRCUIT_MS = 15_000;
let _geoIndisponibleJusqua = 0;

/** Appel bas niveau geo.api : distingue « le référentiel a répondu » de « injoignable ». */
async function interrogeGeo(query: string): Promise<{ disponible: boolean; item: any | null }> {
  if (Date.now() < _geoIndisponibleJusqua) {
    // Panne constatée il y a moins de 15 s : on répond « indisponible » sans payer le timeout.
    return { disponible: false, item: null };
  }
  try {
    const r = await fetch(`https://geo.api.gouv.fr/communes?${query}`, { signal: AbortSignal.timeout(4000) });
    // 5xx / 429 → indisponibilité ; 4xx → réponse ferme du référentiel (rien trouvé).
    if (r.status >= 500 || r.status === 429) {
      console.error(`[loyers-reference] référentiel INSEE HTTP ${r.status} (${query})`);
      _geoIndisponibleJusqua = Date.now() + COUPE_CIRCUIT_MS;
      return { disponible: false, item: null };
    }
    if (!r.ok) return { disponible: true, item: null };
    const d = await r.json();
    return { disponible: true, item: Array.isArray(d) && d[0] ? d[0] : null };
  } catch (e) {
    console.error(`[loyers-reference] référentiel INSEE injoignable (${query}) — ${e instanceof Error ? e.message : String(e)}`);
    _geoIndisponibleJusqua = Date.now() + COUPE_CIRCUIT_MS;
    return { disponible: false, item: null };
  }
}

/** Comparaison tolérante de noms de communes (accents NFD, casse, Saint/St, tirets, espaces). */
function cleCommune(v: string): string {
  // NFD puis suppression des marques combinantes (accents), casse, Saint/St, séparateurs.
  return v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\bste?\b/g, (m) => (m === 'ste' ? 'sainte' : 'saint'))
    .replace(/[^a-z0-9]/g, '');
}

/** Retire le suffixe « Ne arrondissement » d'un nom PLM (« Paris 4e arrondissement » → « Paris »). */
function sansSuffixeArrondissement(v: string): string {
  return v.replace(/\s+\d{1,2}\s*(?:er|ers|e|è|ème|eme)?\s+arrondissement\s*$/i, '').trim();
}

/**
 * Deux noms désignent-ils la même commune ?
 * ⚠️ « Paris » (demandé) face à « Paris 4e arrondissement » (retenu) N'EST PAS un conflit :
 *    l'arrondissement est une subdivision de la commune nommée, donc plus précis, pas
 *    contradictoire. Sans ce test, la simple comparaison de clés déclencherait un repli
 *    par nom et ferait perdre l'arrondissement.
 *    Le suffixe est retiré des DEUX côtés avant comparaison : ne le retirer que du nom
 *    retenu rendait la comparaison asymétrique et faisait échouer le cas symétrique
 *    (« Paris 4e arrondissement » demandé face à « Paris » retenu — atteignable dès que
 *    le copilote transmet commune = « Paris 4e arrondissement » avec code_insee 75056),
 *    d'où un faux conflit.
 *    On compare la RACINE (suffixe retiré) à l'identique, jamais par préfixe : un
 *    `startsWith` tiendrait « Saint-Denis-de-Pile » pour un arrondissement de « Saint-Denis ».
 */
function memeCommune(demande: string, refere: string): boolean {
  const a = cleCommune(demande);
  const b = cleCommune(refere);
  if (a === b) return true;
  const ra = cleCommune(sansSuffixeArrondissement(demande));
  const rb = cleCommune(sansSuffixeArrondissement(refere));
  return ra.length > 0 && ra === rb;
}

// ── Arrondissements municipaux (Paris / Lyon / Marseille) ────────────────────
// ⚠️ CONTRE-INTUITIF — NE PAS « SIMPLIFIER » EN INTERROGEANT L'API AVEC LE CODE :
//   geo.api.gouv.fr/communes NE CONTIENT PAS les arrondissements municipaux.
//   Vérifié empiriquement contre l'API :
//     GET /communes?code=75104        → []   (et NON « Paris 4e »)
//     GET /communes?code=69383        → []
//     GET /communes?codePostal=75004  → [{ "code": "75056", "nom": "Paris" }]
//   Conséquence : demander 75104 au référentiel conclut TOUJOURS « inexistant », ce qui
//   est faux et ferait remonter un message mensonger à l'utilisateur, tout en dégradant
//   la précision (75104 remplacé par 75056). On valide donc la COMMUNE GLOBALE
//   (75056 / 69123 / 13055) et on ressort le code d'arrondissement INCHANGÉ.

/** Bornes RÉELLES : Paris 75101→75120, Lyon 69381→69389, Marseille 13201→13216.
 *  (`/^132\d{2}$/` acceptait 13217→13299, qui n'existent pas.) */
const PLM_ARRONDISSEMENT_RE: Record<string, RegExp> = {
  '75056': /^751(?:0[1-9]|1\d|20)$/,
  '69123': /^6938[1-9]$/,
  '13055': /^132(?:0[1-9]|1[0-6])$/,
};
/** Nom de secours de la commune globale si le référentiel ne renvoie pas le libellé. */
const PLM_NOM_GLOBAL: Record<string, string> = { '75056': 'Paris', '69123': 'Lyon', '13055': 'Marseille' };

function estArrondissementDe(code: string, codeGlobal: string): boolean {
  return PLM_ARRONDISSEMENT_RE[codeGlobal]?.test(code) ?? false;
}
/** Code de la commune globale dont `code` est un arrondissement municipal, sinon null. */
function communeGlobaleDArrondissement(code: string): string | null {
  for (const global of Object.keys(PLM_ARRONDISSEMENT_RE)) {
    if (estArrondissementDe(code, global)) return global;
  }
  return null;
}
/** Rang de l'arrondissement (1..20) : Lyon tient sur 1 chiffre, Paris/Marseille sur 2. */
function rangArrondissement(code: string, codeGlobal: string): number {
  return Number(codeGlobal === '69123' ? code.slice(4) : code.slice(3));
}
/** « Paris 4e arrondissement », « Lyon 1er arrondissement ». */
function libelleArrondissement(nomGlobal: string, rang: number): string {
  return `${nomGlobal} ${rang === 1 ? '1er' : `${rang}e`} arrondissement`;
}

/**
 * Code postal d'arrondissement → code INSEE d'arrondissement, purement ARITHMÉTIQUE.
 * L'API ne sait pas faire cette conversion : `?codePostal=75004` renvoie 75056 (Paris
 * global), jamais 75104. Sans cette table on perdrait l'arrondissement sur le repli CP.
 *   75001..75020 → 751 + NN         (75004 → 75104)
 *   75101..75120 → 751 + (NN-100)   (75116 → 75116)  ← cf. encadré dans le corps
 *   69001..69009 → 6938 + N         (69003 → 69383)
 *   13001..13016 → 132 + NN         (13008 → 13208)
 */
function inseeArrondissementDepuisCp(cp: string): string | null {
  if (!/^\d{5}$/.test(cp)) return null;
  const n = Number(cp);
  if (n >= 75001 && n <= 75020) return `751${String(n - 75000).padStart(2, '0')}`;
  // ⚠️ Paris possède un SECOND code postal d'arrondissement, en 751xx : geo.api.gouv.fr
  //   liste bien "75116" dans les `codesPostaux` de 75056, à côté de "75016" (seul cas
  //   réellement en service aujourd'hui, la plage complète est traitée par sûreté).
  //   Le code INSEE obtenu est alors IDENTIQUE au code postal (75116 → 75116) : ce n'est
  //   PAS un copier-coller raté. Sans cette plage, 75116 ne matchait aucune borne, la
  //   fonction rendait null et on retombait sur 75056 (Paris global) : arrondissement perdu.
  if (n >= 75101 && n <= 75120) return `751${String(n - 75100).padStart(2, '0')}`;
  if (n >= 69001 && n <= 69009) return `6938${n - 69000}`;
  if (n >= 13001 && n <= 13016) return `132${String(n - 13000).padStart(2, '0')}`;
  return null;
}

/**
 * Cache des seules réponses DÉFINITIVES : « trouvé » ET « inexistant » (échec FERME)
 * sont mémorisés, pour qu'un code faux proposé par le modèle ne coûte pas un
 * aller-retour par outil appelé dans le tour. Une INDISPONIBILITÉ n'est JAMAIS
 * mémorisée : elle doit rester réessayable (c'est le rôle du coupe-circuit, borné
 * dans le temps, de limiter le coût réseau d'une panne).
 */
const _cacheInsee = new Map<string, VerifInsee>();

/** Confronte un code INSEE au référentiel : trouvé / inexistant / référentiel injoignable. */
async function verifieInseeAuReferentiel(code: string): Promise<VerifInsee> {
  const cle = code.toUpperCase();
  const memo = _cacheInsee.get(cle);
  if (memo) return memo;

  // Arrondissement municipal : absent du référentiel (cf. encadré ci-dessus) → on
  // valide la commune globale, et on RESSORT le code d'arrondissement tel quel.
  const codeGlobal = communeGlobaleDArrondissement(cle);
  if (codeGlobal) {
    const vGlobal = await verifieInseeAuReferentiel(codeGlobal);
    if (vGlobal.etat === 'indisponible') return { etat: 'indisponible' };
    const resArr: VerifInsee = vGlobal.etat === 'trouve'
      ? {
          etat: 'trouve',
          code: cle, // ← inchangé : plus précis que la commune globale, c'est tout l'intérêt.
          nom: libelleArrondissement(vGlobal.nom ?? PLM_NOM_GLOBAL[codeGlobal], rangArrondissement(cle, codeGlobal)),
        }
      : { etat: 'inexistant' };
    _cacheInsee.set(cle, resArr);
    return resArr;
  }

  const { disponible, item } = await interrogeGeo(
    `code=${encodeURIComponent(cle)}&fields=code,nom,codesPostaux&limit=1`,
  );
  if (!disponible) return { etat: 'indisponible' };
  const res: VerifInsee = item?.code
    ? { etat: 'trouve', code: String(item.code), nom: typeof item.nom === 'string' ? item.nom : undefined }
    : { etat: 'inexistant' };
  _cacheInsee.set(cle, res); // échec FERME mis en cache : pas de réinterrogation dans le tour.
  return res;
}

interface ResolutionInsee {
  code?: string;
  commune?: string;
  propose?: string;
  // 'introuvable' / 'indisponible' : aucun code retenu. Les distinguer est
  // indispensable — « cette commune n'existe pas » et « le référentiel est en
  // panne » ne doivent pas produire le même message à l'utilisateur.
  origine: 'verifie' | 'resolu_nom' | 'resolu_cp' | 'non_verifie' | 'introuvable' | 'indisponible';
  ajustement: string | null;
}

/** PLM : une recherche par nom ou par code postal ne renvoie QUE la commune
 *  globale. Le code postal permet de redescendre à l'arrondissement, plus
 *  précis — conversion arithmétique, l'API ne sait pas la faire. */
function affinePlm(
  code: string,
  nom: string | undefined,
  cp: string | undefined,
  origine: 'resolu_nom' | 'resolu_cp',
): ResolutionInsee {
  const nomGlobal = nom ?? PLM_NOM_GLOBAL[code];
  if (cp && PLM_ARRONDISSEMENT_RE[code]) {
    const arr = inseeArrondissementDepuisCp(cp);
    if (arr && estArrondissementDe(arr, code)) {
      return {
        code: arr,
        commune: libelleArrondissement(nomGlobal ?? code, rangArrondissement(arr, code)),
        origine, ajustement: null,
      };
    }
  }
  return { code, commune: nomGlobal, origine, ajustement: null };
}

/** Repli : résolution par nom de commune, puis par code postal.
 *  Retourne 'indisponible' quand le référentiel n'a pas répondu : ce chemin
 *  perdait l'information de panne et concluait « commune introuvable ». */
async function repliNomPuisCp(
  p: { commune?: string; zipCode?: string },
): Promise<ResolutionInsee | 'indisponible' | null> {
  if (p.commune) {
    const { disponible, item } = await interrogeGeo(`nom=${encodeURIComponent(p.commune)}&fields=code,nom&limit=1`);
    if (!disponible) return 'indisponible';
    if (item?.code) return affinePlm(String(item.code), item.nom, p.zipCode, 'resolu_nom');
  }
  if (p.zipCode) {
    const { disponible, item } = await interrogeGeo(`codePostal=${encodeURIComponent(p.zipCode)}&fields=code,nom&limit=1`);
    if (!disponible) return 'indisponible';
    if (item?.code) return affinePlm(String(item.code), item.nom, p.zipCode, 'resolu_cp');
  }
  return null;
}

/** Résolution complète : forme, puis référentiel, puis replis — tout écart est tracé. */
async function resoudreInsee(p: { codeInsee?: string; commune?: string; zipCode?: string }): Promise<ResolutionInsee> {
  const propose = p.codeInsee;

  if (propose) {
    if (FORME_INSEE.test(propose)) {
      const v = await verifieInseeAuReferentiel(propose);

      // Référentiel injoignable : on n'invente rien, on garde le code MAIS on le dit.
      if (v.etat === 'indisponible') {
        return {
          code: propose, commune: p.commune, propose, origine: 'non_verifie',
          ajustement: `Le référentiel des communes (geo.api.gouv.fr) est momentanément injoignable : le code INSEE ${propose} n'a PAS pu être vérifié, le résultat est donné sous réserve.`,
        };
      }

      if (v.etat === 'trouve') {
        const nomRef = v.nom;
        // « Paris » vs « Paris 4e arrondissement » n'est pas un conflit : `memeCommune`
        // compare la racine du libellé, suffixe d'arrondissement retiré (et non par
        // préfixe, qui confondrait « Saint-Denis » et « Saint-Denis-de-Pile »).
        if (p.commune && nomRef && !memeCommune(p.commune, nomRef)) {
          const rNom = await repliNomPuisCp({ commune: p.commune, zipCode: p.zipCode });
          if (rNom === 'indisponible') {
            return {
              code: propose, commune: nomRef, propose, origine: 'non_verifie',
              ajustement: `Le code INSEE ${propose} désigne ${nomRef}, alors que la commune demandée est « ${p.commune} ». Le référentiel étant momentanément injoignable, l'écart n'a PAS pu être arbitré : le résultat est donné sous réserve.`,
            };
          }
          const parNom = rNom;
          // Exception PLM : 751xx / 6938x / 132xx face à 75056 / 69123 / 13055.
          if (parNom?.code && estArrondissementDe(propose, parNom.code)) {
            return { code: propose, commune: nomRef, propose, origine: 'verifie', ajustement: null };
          }
          if (parNom?.code) {
            return {
              code: parNom.code, commune: parNom.commune ?? p.commune, propose, origine: 'resolu_nom',
              ajustement: `Le code INSEE fourni (${propose}) désigne ${nomRef}, pas « ${p.commune} » : le code ${parNom.code} (${parNom.commune ?? p.commune}), résolu depuis le nom de commune, a été retenu.`,
            };
          }
          return {
            code: propose, commune: nomRef, propose, origine: 'verifie',
            ajustement: `Le code INSEE ${propose} désigne ${nomRef}, alors que la commune demandée est « ${p.commune} » ; aucune commune de ce nom n'ayant été trouvée, le code fourni a été conservé.`,
          };
        }
        return { code: propose, commune: nomRef ?? p.commune, propose, origine: 'verifie', ajustement: null };
      }
    }

    // Malformé ou inexistant → repli sur le nom, puis sur le code postal, et on le signale.
    const motif = FORME_INSEE.test(propose)
      ? "n'existe pas au référentiel des communes"
      : "n'a pas une forme valide de code commune";
    const repli = await repliNomPuisCp(p);
    if (repli === 'indisponible') {
      return {
        code: propose, propose, commune: p.commune, origine: 'non_verifie',
        ajustement: `Le code INSEE fourni (${propose}) ${motif}, et le référentiel est momentanément injoignable : aucun repli n'a pu être calculé. Le résultat est donné sous réserve.`,
      };
    }
    if (repli?.code) {
      return {
        ...repli, propose,
        ajustement: `Le code INSEE fourni (${propose}) ${motif} : il a été écarté au profit de ${repli.code}${repli.commune ? ` (${repli.commune})` : ''}, résolu depuis ${repli.origine === 'resolu_nom' ? 'le nom de commune' : 'le code postal'}.`,
      };
    }
    return {
      propose, origine: 'introuvable',
      ajustement: `Le code INSEE fourni (${propose}) ${motif}, et aucune commune n'a pu être identifiée depuis le nom ou le code postal fournis.`,
    };
  }

  // Aucun code fourni : résolution depuis le nom, puis le code postal.
  const sansCode = await repliNomPuisCp(p);
  if (sansCode === 'indisponible') {
    return {
      origine: 'indisponible',
      ajustement: `Le référentiel des communes (geo.api.gouv.fr) est momentanément injoignable : la commune n'a pas pu être identifiée. Ce n'est PAS un « secteur inconnu » — propose de réessayer.`,
    };
  }
  return sansCode ?? { origine: 'introuvable', ajustement: null };
}

/** min / médiane / max d'une série numérique (ignore les valeurs non finies). */
function stat(values: unknown[]): { min: number; median: number; max: number } | null {
  const v = values
    .map((x) => (typeof x === 'string' ? Number(x) : x))
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    .sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return {
    min: v[0],
    median: Math.round(median * 100) / 100,
    max: v[v.length - 1],
  };
}

/** Arrondi d'affichage : 13.5907932383616 → 13.59. Renvoie undefined si non numérique. */
function money(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

// ── Lectures table ───────────────────────────────────────────
async function readCommune(codeInsee: string): Promise<Record<string, any> | null> {
  const { data, error } = await getAdmin()
    .from('loyers_reference').select(COLS)
    .eq('code_insee', codeInsee).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function readArrondissements(codes: string[]): Promise<Record<string, any>[]> {
  const { data, error } = await getAdmin()
    .from('loyers_reference').select(COLS)
    .in('code_insee', codes)
    .order('code_insee', { ascending: true });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

// =============================================================
// Handler
// =============================================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json({ status: 'error', summary: 'POST only', stats: null, items: [] }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corps vide/illisible → {} */ }

  const commune = normStr(body.commune) ?? normStr(body.city);
  const zipCode = normStr(body.zip_code) ?? normStr(body.code_postal);

  // ── Résolution + VÉRIFICATION INSEE (autonome) ─────────────
  // geo.api renvoie le code « commune globale » (75056/69123/13055) pour
  // Paris/Lyon/Marseille recherchés par nom → l'éclatement PLM prend le relais.
  // Un code postal d'arrondissement (ex. 75001) renvoie l'arrondissement (75101).
  // ⚠️ Remplace `if (!codeInsee && (commune || zipCode)) { const g = await resolveInseeFromGeo(...) }` :
  //   cette garde négative laissait passer sans aucun contrôle tout code_insee fourni en entrée.
  const resolution = await resoudreInsee({ codeInsee: normStr(body.code_insee), commune, zipCode });
  const codeInsee = resolution.code;
  const communeNomResolu = resolution.commune;
  // Traçabilité : tout écart entre code proposé et code retenu est exposé dans la réponse.
  const _insee: {
    propose: string | null;
    retenu: string | null;
    commune: string | null;
    origine: ResolutionInsee['origine'];
    ajustement: string | null;
    // Code réellement lu : diffère de `retenu` quand le repli PLM inverse
    // (arrondissement absent de la table → éclatement sur la commune globale)
    // s'est déclenché.
    interroge: string | null;
    repli_plm: boolean;
  } = {
    propose: resolution.propose ?? null,
    retenu: resolution.code ?? null,
    commune: resolution.commune ?? null,
    origine: resolution.origine,
    ajustement: resolution.ajustement,
    interroge: null,
    repli_plm: false,
  };
  const suffixeAjustement = resolution.ajustement ? ` ${resolution.ajustement}` : '';

  if (!codeInsee) {
    return json({
      status: 'no_localization',
      summary: "Localisation insuffisante : fournir un code INSEE, une commune ou un code postal." + suffixeAjustement,
      stats: null,
      items: [],
      _insee,
    }, 200);
  }

  try {
    // ── Cas PLM : code « commune globale » → éclatement arrondissements ──
    //   Extrait en fonction locale (et non plus inliné) pour servir DEUX entrées :
    //   le code global reçu directement, et le repli inverse depuis un arrondissement
    //   absent de la table (cf. plus bas). `repli` ne change que la traçabilité.
    const reponsePlm = async (codeGlobal: string, repli: boolean): Promise<Response> => {
      _insee.interroge = codeGlobal;
      _insee.repli_plm = repli;
      const suffixeRepli = repli
        ? ` (Arrondissement ${codeInsee} absent de la Carte des loyers : fourchette calculée sur l'ensemble des arrondissements.)`
        : '';
      const label = PLM_LABEL[codeGlobal];
      const rows = await readArrondissements(PLM_ARRONDISSEMENTS[codeGlobal]);
      if (rows.length === 0) {
        return json({
          status: 'no_data',
          summary: `Aucun loyer de référence trouvé pour les arrondissements de ${label}.` + suffixeRepli + suffixeAjustement,
          stats: { is_plm: true, commune_nom: label, unite: '€/m²/mois' },
          items: [],
          _insee,
        }, 200);
      }
      const millesime = rows[0].millesime ?? null;
      const g = stat(rows.map((r) => r.loyer_median_global));
      const app = stat(rows.map((r) => r.loyer_median_appartement));
      const mai = stat(rows.map((r) => r.loyer_median_maison));
      const ref = g ?? app ?? mai; // repli si la médiane globale manque partout
      return json({
        status: 'ok',
        summary: (ref
          ? `Loyers de référence ${label} (millésime ${millesime}) — varie selon arrondissement : ` +
            `${ref.min}–${ref.max} €/m²/mois (médiane ${ref.median})${g ? '' : ' — sur la base des ventilations appartement/maison'}.`
          : `Loyers de référence ${label} (millésime ${millesime}) : données par arrondissement disponibles, médiane non calculable.`)
          + suffixeRepli + suffixeAjustement,
        _insee,
        stats: {
          is_plm: true,
          commune_nom: label,
          code_insee_demande: codeInsee,
          millesime,
          nb_arrondissements: rows.length,
          global: g,
          appartement: app,
          maison: mai,
          unite: '€/m²/mois',
          source: 'Carte des loyers ANIL/DHUP',
        },
        items: rows.map((r) => ({
          code_insee: r.code_insee,
          commune_nom: r.commune_nom,
          loyer_median_global: r.loyer_median_global,
          loyer_median_appartement: r.loyer_median_appartement,
          loyer_median_maison: r.loyer_median_maison,
        })),
      }, 200);
    };

    if (PLM_ARRONDISSEMENTS[codeInsee]) return await reponsePlm(codeInsee, false);

    // ── Cas standard : commune unique ou arrondissement précis ──
    const row = await readCommune(codeInsee);
    if (!row) {
      // ⚠️ Correctif A — repli PLM INVERSE. Le commentaire d'en-tête PARIE sur le fait
      //   que la table contient les arrondissements ; si ce pari est faux pour un
      //   arrondissement donné (millésime incomplet, arrondissement non couvert), la
      //   fonction rendait « non couverte par la Carte des loyers » alors que la ville
      //   l'est — une absence FABRIQUÉE. On replie sur l'éclatement, en le disant.
      const codeGlobal = communeGlobaleDArrondissement(codeInsee);
      if (codeGlobal && PLM_ARRONDISSEMENTS[codeGlobal]) return await reponsePlm(codeGlobal, true);

      const who = communeNomResolu ?? commune ?? `code INSEE ${codeInsee}`;
      return json({
        status: 'no_data',
        summary: `Aucun loyer de référence pour ${who} (code INSEE ${codeInsee}). Commune peut-être non couverte par la Carte des loyers.` + suffixeAjustement,
        stats: null,
        items: [],
        _insee,
      }, 200);
    }
    _insee.interroge = codeInsee;
    // La source ne fournit pas toujours la médiane globale : on la reconstitue
    // à partir des ventilations plutôt que d'afficher « null » à l'utilisateur.
    const app = money(row.loyer_median_appartement);
    const mai = money(row.loyer_median_maison);
    let global = money(row.loyer_median_global);
    let globalEstime = false;
    if (global === undefined) {
      const dispo = [app, mai].filter((x): x is number => x !== undefined);
      if (dispo.length) {
        global = Math.round((dispo.reduce((a, b) => a + b, 0) / dispo.length) * 100) / 100;
        globalEstime = true;
      }
    }
    const ventilation = [
      app !== undefined ? `appartement ${app}` : null,
      mai !== undefined ? `maison ${mai}` : null,
    ].filter(Boolean).join(', ');
    const tete = global !== undefined
      ? `${global} €/m²/mois${globalEstime ? ' (estimé : moyenne appartement/maison, la source ne publie pas de médiane globale ici)' : ''}`
      : 'médiane non disponible';

    return json({
      status: 'ok',
      summary:
        `Loyer médian ${row.commune_nom} (millésime ${row.millesime}) : ${tete}` +
        `${ventilation ? ` — ${ventilation}` : ''}.` + suffixeAjustement,
      _insee,
      stats: {
        is_plm: false,
        code_insee: row.code_insee,
        commune_nom: row.commune_nom,
        millesime: row.millesime,
        loyer_median_global: global ?? null,
        loyer_median_global_estime: globalEstime,
        loyer_median_appartement: app ?? null,
        loyer_median_maison: mai ?? null,
        nb_observations: row.nb_observations,
        nbobs_appartement: row.nbobs_appartement,
        nbobs_maison: row.nbobs_maison,
        typpred_appartement: row.typpred_appartement,
        typpred_maison: row.typpred_maison,
        unite: '€/m²/mois',
        source: 'Carte des loyers ANIL/DHUP',
      },
      items: [row],
    }, 200);
  } catch (e) {
    return json({
      status: 'error',
      summary: `Erreur lecture loyers_reference : ${e instanceof Error ? e.message : String(e)}`,
      stats: null,
      items: [],
      _insee,
    }, 200);
  }
});