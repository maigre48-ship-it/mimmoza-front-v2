// supabase/functions/ppr-detail-v1/index.ts
// =============================================================
// Mimmoza — PPR détaillés (source #6)
//
// Rôle : détailler les Plans de Prévention des Risques (PPRN/PPRT/PPRM) qui
//   concernent une commune, AU-DELÀ du booléen déjà fourni par risk-study :
//   - nom du PPR, type de risque (inondation, mouvement de terrain, techno…) ;
//   - statut : APPROUVÉ (opposable, vaut servitude, annexé au PLU) vs PRESCRIT
//     (application anticipée possible, sursis à statuer) ;
//   - dates d'approbation / fin de validité ;
//   - si des coordonnées parcelle sont fournies : test POINT-IN-PÉRIMÈTRE pour
//     dire si la parcelle est RÉELLEMENT dans l'emprise du PPR (pas seulement
//     « la commune est concernée »).
//
// ⚠️ LIMITE ASSUMÉE : l'API ne fournit PAS le zonage réglementaire interne
//   (zone rouge / bleue / etc.) ni son règlement — ces données sont diffusées
//   en WMS/COVADIS morcelé par PPR, sans API nationale. La réponse renvoie vers
//   le document du PPR (Géorisques / Errial / DDT) pour la couleur de zone exacte.
//   Ne jamais inventer une zone rouge/bleue.
//
// Source : API Géorisques v1 (BD GASPAR), publique, sans jeton.
// Autonome (Dashboard, aucun import _shared, aucune clé requise).
//
// Contrat de sortie : { status, summary, stats, items } — toujours HTTP 200
//   status ∈ 'ok' | 'no_data' | 'no_localization' | 'error'
// =============================================================

// gaspar/ppr n'existe PAS en v1 (404 « No endpoint »). On tente d'abord la v2
// (schéma riche : nom_ppr, etat, risque, geom_perimetre — le mapping ci-dessous
// est calé dessus, comme le package R officiel), puis repli sur v1 gaspar/risques
// (confirmé en prod, sans jeton). La fonction logue l'endpoint réellement retenu.
const PPR_ENDPOINTS: Array<(insee: string) => string> = [
  (insee) => `https://georisques.gouv.fr/api/v2/gaspar/ppr?code_insee=${encodeURIComponent(insee)}&page_size=20`,
  (insee) => `https://georisques.gouv.fr/api/v1/gaspar/risques?code_insee=${encodeURIComponent(insee)}&rayon=1000`,
];
const FETCH_TIMEOUT_MS = 9000;

const NOTE_ZONAGE =
  "L'API Géorisques donne le périmètre et le statut de chaque PPR, PAS le zonage réglementaire interne (zone rouge/bleue) ni son règlement. Pour la zone précise applicable à la parcelle et ses prescriptions, consulter le règlement du PPR (Géorisques / errial.georisques.gouv.fr) ou la DDT.";
const SOURCE = 'Géorisques — BD GASPAR (API v1)';

function cors(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors(), 'Content-Type': 'application/json' } });
}
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}
function normStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
async function fetchJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`[ppr-detail] HTTP ${r.status} sur ${url} — ${body.slice(0, 300)}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error(`[ppr-detail] fetch échec ${url} — ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
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
      console.error(`[ppr-detail] référentiel INSEE HTTP ${r.status} (${query})`);
      _geoIndisponibleJusqua = Date.now() + COUPE_CIRCUIT_MS;
      return { disponible: false, item: null };
    }
    if (!r.ok) return { disponible: true, item: null };
    const d = await r.json();
    return { disponible: true, item: Array.isArray(d) && d[0] ? d[0] : null };
  } catch (e) {
    console.error(`[ppr-detail] référentiel INSEE injoignable (${query}) — ${e instanceof Error ? e.message : String(e)}`);
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

// ── Point-in-polygon (ray casting), Polygon + MultiPolygon + trous ──
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygon(lon: number, lat: number, poly: number[][][]): boolean {
  if (!poly?.length || !pointInRing(lon, lat, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(lon, lat, poly[k])) return false; // trou
  return true;
}
function pointInGeoJSON(lon: number, lat: number, geom: any): boolean {
  if (!geom || !geom.type) return false;
  try {
    if (geom.type === 'Polygon') return pointInPolygon(lon, lat, geom.coordinates);
    if (geom.type === 'MultiPolygon') return geom.coordinates.some((p: number[][][]) => pointInPolygon(lon, lat, p));
  } catch { /* géométrie inattendue */ }
  return false;
}

// ── Normalisation d'un item PPR (tolérante aux variations de champs) ──
function normalizePpr(it: Record<string, any>): Record<string, any> {
  const nom = it.nom_ppr ?? it.libelle_ppr ?? it.libelle ?? null;
  const id = it.id_gaspar ?? it.code_national_ppr ?? it.code_ppr ?? null;

  // état : string ou objet { code_etat, libelle_etat }
  let etat: string | null = null;
  if (typeof it.etat === 'string') etat = it.etat;
  else if (it.etat && typeof it.etat === 'object') etat = it.etat.libelle_etat ?? it.etat.libelle ?? it.etat.code_etat ?? null;
  etat = etat ?? it.libelle_etat ?? it.code_etat ?? null;

  // risque(s) : objet, tableau, ou champ plat
  const risques: string[] = [];
  const pushRisque = (r: any) => {
    if (!r) return;
    if (typeof r === 'string') risques.push(r);
    else if (typeof r === 'object') { const l = r.libelle_risque ?? r.libelle ?? r.code_risque; if (l) risques.push(String(l)); }
  };
  if (Array.isArray(it.risques)) it.risques.forEach(pushRisque);
  else if (Array.isArray(it.risque)) it.risque.forEach(pushRisque);
  else { pushRisque(it.risque); pushRisque(it.libelle_risque); }

  const opposable = typeof etat === 'string' && /approuv/i.test(etat);

  return {
    nom_ppr: nom,
    id_gaspar: id,
    risques: [...new Set(risques)],
    statut: etat,
    opposable,                                   // approuvé => opposable (vaut SUP)
    date_approbation: it.date_approbation ?? it.dat_approbation ?? null,
    date_fin_validite: it.date_fin_validite ?? null,
    _geom: it.geom_perimetre ?? it.perimetre ?? it.geom ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json({ status: 'error', summary: 'POST only', stats: null, items: [] }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* {} */ }

  const commune = normStr(body.commune) ?? normStr(body.city);
  const zipCode = normStr(body.zip_code) ?? normStr(body.code_postal);
  const lat = num(body.lat);
  const lon = num(body.lon) ?? num((body as any).lng);

  // ⚠️ Remplace `if (!codeInsee && (commune || zipCode)) codeInsee = await resolveInseeFromGeo(...)` :
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
    // Code réellement envoyé à Géorisques : diffère de `retenu` quand le repli PLM
    // (arrondissement → commune globale) s'est déclenché. Cf. encadré plus bas.
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
      summary: "Code INSEE requis (ou commune / code postal) pour lister les PPR." + suffixeAjustement,
      stats: null, items: [], _insee,
    }, 200);
  }

  // ⚠️ Correctif A — REPLI PLM INVERSE (arrondissement → commune globale).
  //   Depuis que `resoudreInsee` ressort le code d'ARRONDISSEMENT (75104) — plus précis,
  //   et c'est tout l'intérêt du correctif — les consommateurs qui indexent sur la
  //   COMMUNE GLOBALE ne trouvent plus rien. La BD GASPAR est dans ce cas : les PPR y
  //   sont rattachés à 75056 / 69123 / 13055, jamais à un arrondissement. Sans ce repli,
  //   tout Paris / Lyon / Marseille localisé par code postal ressortait en `no_data` —
  //   une absence FABRIQUÉE, exactement le défaut que les correctifs A et B combattent.
  //   Le repli est signalé (`_insee.interroge` + mention dans le résumé) : on ne substitue
  //   jamais une donnée d'un périmètre à celle d'un autre sans le dire.
  const codesAInterroger = [codeInsee, communeGlobaleDArrondissement(codeInsee)]
    .filter((c): c is string => typeof c === 'string');

  /** Les trois endpoints Géorisques n'enveloppent pas leur liste de la même façon. */
  const extraitListe = (r: any): any[] =>
    Array.isArray(r?.results) ? r.results
      : Array.isArray(r?.data) ? r.data
      : Array.isArray(r) ? r : [];

  try {
    let raw: any = null;
    let usedUrl = '';
    let codeInterroge: string | null = null;
    let list: any[] = [];
    // ⚠️ Distinct de `raw == null` : « aucun endpoint n'a répondu » (panne) et
    //   « un endpoint a répondu une liste vide » (pas de PPR) sont deux faits
    //   différents et ne doivent pas produire le même statut.
    let auMoinsUneReponse = false;

    for (const candidat of codesAInterroger) {
      for (const build of PPR_ENDPOINTS) {
        const url = build(candidat);
        const r = await fetchJson(url);
        if (r == null) continue; // endpoint muet : on tente le suivant
        auMoinsUneReponse = true;
        const l = extraitListe(r);
        // Première réponse obtenue, même vide : mémorisée pour ne pas perdre
        // la trace du service qui a effectivement répondu.
        if (raw == null) { raw = r; usedUrl = url; codeInterroge = candidat; list = l; }
        if (l.length) { raw = r; usedUrl = url; codeInterroge = candidat; list = l; break; }
      }
      if (list.length) break; // trouvé sur ce code : inutile de replier
    }

    console.log('[ppr-detail] endpoint retenu:', usedUrl || 'AUCUN (tous en échec)', '| code interrogé:', codeInterroge ?? '—');

    if (!auMoinsUneReponse) {
      return json({
        status: 'error',
        summary: "L'API Géorisques est momentanément injoignable pour les PPR." + suffixeAjustement,
        stats: null, items: [], _insee,
      }, 200);
    }

    const repliPlm = codeInterroge != null && codeInterroge !== codeInsee;
    const suffixeRepli = repliPlm
      ? ` (Les PPR sont recensés au niveau de la commune globale ${codeInterroge}, pas de l'arrondissement ${codeInsee} : périmètre communal entier.)`
      : '';
    _insee.interroge = codeInterroge;
    _insee.repli_plm = repliPlm;

    if (list.length) console.log('[ppr-detail] item brut[0]:', JSON.stringify(list[0]).slice(0, 600));

    if (list.length === 0) {
      return json({
        status: 'no_data',
        summary: `Aucun PPR recensé pour la commune (INSEE ${codeInterroge}) dans la BD GASPAR.` + suffixeRepli + suffixeAjustement,
        stats: { code_insee: codeInsee, code_insee_interroge: codeInterroge, nb_ppr: 0, source: SOURCE }, items: [], _insee,
      }, 200);
    }

    const hasPoint = lat != null && lon != null;
    const items = list.map((it: Record<string, any>) => {
      const n = normalizePpr(it);
      // null = non testé (pas de point, ou PPR sans géométrie). Ne JAMAIS rendre
      // `false` dans ces cas : « hors périmètre » et « périmètre non testé » sont
      // deux faits distincts, et le second ne rassure pas.
      const dans = hasPoint && n._geom ? pointInGeoJSON(lon!, lat!, n._geom) : null;
      const { _geom, ...rest } = n;
      return { ...rest, parcelle_dans_perimetre: dans };
    });

    const nbApprouves = items.filter((i: any) => i.opposable).length;
    const nbPrescrits = items.length - nbApprouves;
    const couvrants = hasPoint ? items.filter((i: any) => i.parcelle_dans_perimetre === true) : [];

    const teteliste = items.slice(0, 4).map((i: any) =>
      `${i.nom_ppr ?? 'PPR'}${i.risques?.length ? ` (${i.risques.join('/')})` : ''} — ${i.opposable ? 'approuvé' : (i.statut ?? 'statut n.c.')}`,
    ).join(' ; ');

    const summary =
      `${items.length} PPR concernent la commune (${nbApprouves} approuvé(s), ${nbPrescrits} autre(s)) : ${teteliste}${items.length > 4 ? '…' : ''}.` +
      (hasPoint
        ? (couvrants.length
            ? ` La parcelle est DANS le périmètre de : ${couvrants.map((i: any) => i.nom_ppr).join(', ')}.`
            : ` La parcelle ne ressort dans aucun périmètre PPR testé (vérifier le règlement en cas de doute).`)
        : ' (Aucune coordonnée fournie : liste au niveau commune, périmètre parcelle non testé.)') +
      ` ${NOTE_ZONAGE}` + suffixeRepli + suffixeAjustement;

    return json({
      status: 'ok',
      summary,
      _insee,
      stats: {
        code_insee: codeInsee,
        code_insee_interroge: codeInterroge,
        nb_ppr: items.length,
        nb_approuves: nbApprouves,
        nb_prescrits_autres: nbPrescrits,
        test_perimetre_parcelle: hasPoint,
        nb_ppr_couvrant_parcelle: hasPoint ? couvrants.length : null,
        note_zonage: NOTE_ZONAGE,
        note_statut: "Un PPR approuvé est opposable (vaut servitude, annexé au PLU). Un PPR prescrit permet un sursis à statuer et l'application anticipée de mesures.",
        source: SOURCE,
      },
      items,
    }, 200);
  } catch (e) {
    return json({
      status: 'error',
      summary: `Erreur interrogation PPR (Géorisques) : ${e instanceof Error ? e.message : String(e)}`,
      stats: null, items: [], _insee,
    }, 200);
  }
});