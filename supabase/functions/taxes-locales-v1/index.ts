// supabase/functions/taxes-locales-v1/index.ts
// =============================================================
// Mimmoza — Taxes locales (source #5)
//
// Rôle : renvoyer les taux de fiscalité directe locale VOTÉS d'une commune :
//   - taxe foncière sur les propriétés bâties (TFB)      ← la plus utile en immo
//   - taxe foncière sur les propriétés non bâties (TFNB)
//   - taxe d'habitation (TH)  — ⚠️ résidences secondaires (THRS) + logements
//       vacants (THLV) uniquement : la TH sur résidence principale est SUPPRIMÉE
//       depuis 2023.
//   - majoration THRS (5–60 %) le cas échéant (communes en zone tendue)
//   - taxe d'enlèvement des ordures ménagères (TEOM)
//
// Source : DGFiP « Fiscalité locale des particuliers » via l'API Opendatasoft
//   de data.economie.gouv.fr (taux issus du REI). Interrogée par code INSEE.
//   → Pas d'import de table : officiel, toujours à jour.
//
// Robustesse : le schéma ODS exact n'étant pas figé, la fonction SONDE le
//   dataset (1 enregistrement) pour DÉTECTER les noms de champs par motif, puis
//   cache ce mapping. Elle logue le mapping détecté (débogage). Un repli renvoie
//   aussi tous les champs « taux » bruts si une détection fine échoue.
//
// Autonome (Dashboard, aucun import _shared, aucune clé requise).
//
// Contrat de sortie (aligné dpe/loyers/servitudes/solaire/zonage) :
//   { status, summary, stats, items }  — toujours HTTP 200
// =============================================================

// Dataset ODS (surchargeable si l'id évolue).
const DATASET = Deno.env.get('TAXES_ODS_DATASET') ?? 'fiscalite-locale-des-particuliers';
const ODS_RECORDS = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/${DATASET}/records`;
const FETCH_TIMEOUT_MS = 8000;

const NOTE_TH =
  "La taxe d'habitation sur la résidence principale est supprimée depuis 2023 : ce taux TH ne s'applique qu'aux résidences secondaires (THRS) et aux logements vacants (THLV).";
const NOTE_MAJORATION =
  "Majoration THRS (5–60 %) possible dans les communes en zone tendue ; elle porte sur la seule part communale de la cotisation.";
const SOURCE = 'DGFiP — Fiscalité locale des particuliers (data.economie.gouv.fr, taux votés issus du REI)';

// PLM : repli sur un arrondissement si le code « commune globale » est absent.
const PLM_FALLBACK: Record<string, string> = {
  '75056': '75101', '69123': '69381', '13055': '13201',
};

/**
 * ⚠️ Correctif A — ordre d'interrogation PLM, dans LES DEUX SENS.
 *   Le REI indexe tantôt la commune globale (75056), tantôt les arrondissements
 *   (75101…) : `PLM_FALLBACK` couvrait le sens global → arrondissement. Mais depuis
 *   que `resoudreInsee` ressort l'ARRONDISSEMENT quand le code postal le permet
 *   (75004 → 75104), l'entrée n'est plus jamais un code global sur ce chemin :
 *   `PLM_FALLBACK['75104']` est `undefined`, le repli ne se déclenchait plus, et
 *   Paris / Lyon / Marseille ressortaient en `no_data` — une absence FABRIQUÉE.
 *   Le sens arrondissement → commune globale est donc ajouté, en premier.
 *     75104 → [75104, 75056]   |   75056 → [75056, 75101]
 *   `communeGlobaleDArrondissement` vient du bloc INSEE partagé (cf. ppr-detail-v1).
 */
function codesPlmAEssayer(code: string): string[] {
  const out = [code];
  const global = communeGlobaleDArrondissement(code);
  if (global) out.push(global);
  const arrondissement = PLM_FALLBACK[code];
  if (arrondissement) out.push(arrondissement);
  return out;
}

interface FieldMap {
  insee?: string; commune?: string; annee?: string;
  tfb?: string; tfnb?: string; th?: string; teom?: string; majoration?: string;
  tauxKeys: string[];
}
let _fieldMap: FieldMap | null = null;

// ── Helpers HTTP ─────────────────────────────────────────────
function cors(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...cors(), 'Content-Type': 'application/json' },
  });
}
function normStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
async function fetchJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Référentiel INSEE (geo.api.gouv.fr) : vérification SYSTÉMATIQUE ──────────
// ⚠️ L'ancienne garde négative `if (!codeInsee && (commune || zipCode))` désactivait
//   la seule vérification existante dès qu'un code_insee était fourni : un code
//   inexistant, ou existant mais désignant une autre commune, traversait la
//   fonction sans contrôle et ressortait avec une source officielle attachée.
//   Tout code reçu (fourni OU déduit) est désormais confronté au référentiel.

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
      console.error(`[taxes-locales] référentiel INSEE HTTP ${r.status} (${query})`);
      _geoIndisponibleJusqua = Date.now() + COUPE_CIRCUIT_MS;
      return { disponible: false, item: null };
    }
    if (!r.ok) return { disponible: true, item: null };
    const d = await r.json();
    return { disponible: true, item: Array.isArray(d) && d[0] ? d[0] : null };
  } catch (e) {
    console.error(`[taxes-locales] référentiel INSEE injoignable (${query}) — ${e instanceof Error ? e.message : String(e)}`);
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

// ── Détection des champs ODS par motif (insensible à la casse) ──
function detectFields(rec: Record<string, any>): FieldMap {
  const keys = Object.keys(rec);
  const find = (re: RegExp, exclude?: RegExp) =>
    keys.find((k) => re.test(k) && !(exclude && exclude.test(k)));
  return {
    insee: find(/insee|codgeo|depcom|code_?comm/i),
    commune: find(/libgeo|lib_?com|libelle|commune|nom_?com/i, /epci|interco|dep|region/i),
    annee: find(/annee|exercice|millesime/i),
    tfb: find(/tf(p)?b|fonc.*bat|taux.*fb/i, /non|tfnb/i),
    tfnb: find(/tfnb|non.?bat/i),
    th: find(/habitation|(^|_)th($|_|glob)/i, /major|thlv|thrs/i) ?? find(/(^|_)th|habitation/i, /major/i),
    teom: find(/teom|ordure/i),
    majoration: find(/major|surtax|thrs.*tau|sup.*rs/i),
    tauxKeys: keys.filter((k) => /taux|(^|_)tf|(^|_)th|teom|major/i.test(k)),
  };
}

async function getFieldMap(): Promise<FieldMap> {
  if (_fieldMap) return _fieldMap;
  const j = await fetchJson(`${ODS_RECORDS}?limit=1`);
  const rec = Array.isArray(j?.results) ? j.results[0] : null;
  _fieldMap = rec ? detectFields(rec) : { tauxKeys: [] };
  console.log('[taxes-locales] champs détectés:', JSON.stringify(_fieldMap));
  return _fieldMap;
}

const INSEE_CANDIDATES = ['code_insee', 'insee', 'codgeo', 'insee_com', 'com_code', 'code_commune'];

async function fetchByInsee(insee: string, fm: FieldMap): Promise<Record<string, any> | null> {
  const orderBy = fm.annee ? `&order_by=${encodeURIComponent(fm.annee + ' desc')}` : '';
  const tryField = async (field: string) => {
    const where = encodeURIComponent(`${field}="${insee}"`);
    const j = await fetchJson(`${ODS_RECORDS}?where=${where}${orderBy}&limit=1`);
    return Array.isArray(j?.results) && j.results[0] ? j.results[0] : null;
  };
  // Champ détecté d'abord, puis repli sur une courte liste de candidats.
  if (fm.insee) { const r = await tryField(fm.insee); if (r) return r; }
  for (const c of INSEE_CANDIDATES) {
    if (c === fm.insee) continue;
    const r = await tryField(c);
    if (r) { if (!fm.insee) fm.insee = c; return r; }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json({ status: 'error', summary: 'POST only', stats: null, items: [] }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* {} */ }

  const commune = normStr(body.commune) ?? normStr(body.city);
  const zipCode = normStr(body.zip_code) ?? normStr(body.code_postal);

  // ⚠️ Remplace `if (!codeInsee && (commune || zipCode)) { codeInsee = await resolveInseeFromGeo(...) }` :
  //   cette garde négative laissait passer sans aucun contrôle tout code_insee fourni en entrée.
  const resolution = await resoudreInsee({ codeInsee: normStr(body.code_insee), commune, zipCode });
  const codeInsee = resolution.code;
  // Traçabilité : tout écart entre code proposé et code retenu est exposé dans la réponse.
  const _insee: {
    propose: string | null;
    retenu: string | null;
    commune: string | null;
    origine: ResolutionInsee['origine'];
    ajustement: string | null;
    // Code réellement interrogé dans le REI : diffère de `retenu` quand un repli
    // PLM s'est déclenché (dans un sens ou dans l'autre). Cf. `codesPlmAEssayer`.
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
      stats: null, items: [], _insee,
    }, 200);
  }

  try {
    const fm = await getFieldMap();
    let rec: Record<string, any> | null = null;
    let codeInterroge: string | null = null;
    for (const candidat of codesPlmAEssayer(codeInsee)) {
      rec = await fetchByInsee(candidat, fm);
      if (rec) { codeInterroge = candidat; break; }
    }
    _insee.interroge = codeInterroge;
    _insee.repli_plm = codeInterroge != null && codeInterroge !== codeInsee;
    const suffixeRepli = _insee.repli_plm
      ? ` (Taux relevés au niveau du code INSEE ${codeInterroge}, le REI ne détaillant pas ${codeInsee}.)`
      : '';

    if (!rec) {
      return json({
        status: 'no_data',
        summary: `Aucun taux de fiscalité locale trouvé pour le code INSEE ${codeInsee}.` + suffixeAjustement,
        stats: null, items: [], _insee,
      }, 200);
    }

    const get = (field?: string) => (field ? num(rec![field]) : null);
    const tfb = get(fm.tfb);
    const tfnb = get(fm.tfnb);
    const th = get(fm.th);
    const teom = get(fm.teom);
    const majoration = get(fm.majoration);
    const communeNom = fm.commune ? (rec[fm.commune] ?? null) : null;
    const annee = fm.annee ? (rec[fm.annee] ?? null) : null;

    // Repli : tous les champs « taux » bruts, si une détection fine a manqué.
    const tauxBruts: Record<string, unknown> = {};
    for (const k of fm.tauxKeys) tauxBruts[k] = rec[k];

    const parts = [
      tfb != null ? `taxe foncière bâtie ${tfb} %` : null,
      tfnb != null ? `TFNB ${tfnb} %` : null,
      th != null ? `TH (rés. secondaires/vacants) ${th} %` : null,
      majoration != null && majoration > 0 ? `majoration THRS ${majoration} %` : null,
      teom != null ? `TEOM ${teom} %` : null,
    ].filter(Boolean);

    return json({
      status: 'ok',
      summary:
        `Taxes locales ${communeNom ?? `INSEE ${codeInsee}`}${annee ? ` (${annee})` : ''} : ` +
        `${parts.length ? parts.join(', ') : 'taux non détaillés'}.` + suffixeRepli + suffixeAjustement,
      _insee,
      stats: {
        code_insee: codeInsee,
        code_insee_interroge: codeInterroge,
        commune_nom: communeNom,
        annee,
        taxe_fonciere_batie_pct: tfb,
        taxe_fonciere_non_batie_pct: tfnb,
        taxe_habitation_pct: th,
        majoration_thrs_pct: majoration,
        teom_pct: teom,
        note_th: NOTE_TH,
        note_majoration: NOTE_MAJORATION,
        ...(parts.length === 0 ? { taux_bruts: tauxBruts } : {}),
        source: SOURCE,
      },
      items: [rec],
    }, 200);
  } catch (e) {
    return json({
      status: 'error',
      summary: `Erreur interrogation fiscalité locale : ${e instanceof Error ? e.message : String(e)}`,
      stats: null, items: [], _insee,
    }, 200);
  }
});