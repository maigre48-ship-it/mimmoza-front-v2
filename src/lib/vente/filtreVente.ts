/**
 * VIS-67 (27/11/2026) — FILTRES DE LA GRILLE DE VENTE (outil de vente « bureau de vente » du promoteur). Module PUR.
 *
 * COPIE IDENTIQUE dans les deux dépôts (aucun import : le fichier se compile seul dans le Studio, le site et l'Edge) :
 *   - mimmozia-studio/src/core/vente/filtreVente.ts
 *   - mimmoza-front-v2/src/lib/vente/filtreVente.ts
 * Vérification : `cmp` des deux fichiers (rapport VIS-67) et test de l'empreinte `EMPREINTE_FILTRE_VENTE`.
 *
 * Contenu :
 *   · vocabulaire commun : statuts (libre / optionné / réservé / vendu), 8 orientations, typologies (T1…T5, commerce) ;
 *   · `FiltreVente` et `filtrerLots` : étage (min / max), prix, surface, typologie, orientation, extérieur, parkings, statut ;
 *   · `filtreDepuisPhrase` : « montre-moi les T3 libres au-dessus du 2e étage orientés sud » → filtre (sans IA) ;
 *   · `filtreVersParams` / `filtreDepuisParams` : paramètres plats de la commande `grille-vente` du pont
 *     `mimmoza-commandes-studio` (texte, nombre, booléen) ;
 *   · `syntheseLots` et `resumeFiltre` : la carte de synthèse du chat et la phrase dite à l'utilisateur.
 *
 * Règles (dites, jamais en silence) :
 *   · étage = numéro de niveau, 0 = RDC ; « au-dessus du 2e étage » = à partir du 3e (strictement au-dessus) ;
 *   · orientation : un lot correspond si l'une de ses façades vitrées est à 45° au plus de l'orientation demandée
 *     (« orienté sud » retient sud, sud-est et sud-ouest) ;
 *   · extérieur : balcon, loggia, terrasse ou jardin privatif de surface > 0.
 */

export const VERSION_FILTRE_VENTE = 1 as const;

export const STATUTS_LOT = ['libre', 'optionne', 'reserve', 'vendu'] as const;
export type StatutLot = (typeof STATUTS_LOT)[number];
export const LIBELLES_STATUT: Readonly<Record<StatutLot, string>> = { libre: 'Libre', optionne: 'Optionné', reserve: 'Réservé', vendu: 'Vendu' };
/** Couleurs des statuts (fond clair lisible, trait, encre) : mêmes valeurs dans la maquette 3D, la liste et la carte du chat. */
export const COULEURS_STATUT: Readonly<Record<StatutLot, { readonly fond: string; readonly trait: string; readonly encre: string; readonly volume: string }>> = {
  libre: { fond: '#dcfce7', trait: '#16a34a', encre: '#14532d', volume: '#22c55e' },
  optionne: { fond: '#fef3c7', trait: '#d97706', encre: '#78350f', volume: '#f59e0b' },
  reserve: { fond: '#ffedd5', trait: '#ea580c', encre: '#7c2d12', volume: '#f97316' },
  vendu: { fond: '#fee2e2', trait: '#dc2626', encre: '#7f1d1d', volume: '#ef4444' },
};

export const ORIENTATIONS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export const LIBELLES_ORIENTATION: Readonly<Record<Orientation, string>> = {
  nord: 'Nord', 'nord-est': 'Nord-est', est: 'Est', 'sud-est': 'Sud-est', sud: 'Sud', 'sud-ouest': 'Sud-ouest', ouest: 'Ouest', 'nord-ouest': 'Nord-ouest',
};
/** Azimut (degrés, 0 = nord, sens horaire) du centre de chaque orientation. */
export const AZIMUT_ORIENTATION: Readonly<Record<Orientation, number>> = {
  nord: 0, 'nord-est': 45, est: 90, 'sud-est': 135, sud: 180, 'sud-ouest': 225, ouest: 270, 'nord-ouest': 315,
};

export const TYPOLOGIES_VENTE = ['T1', 'T2', 'T3', 'T4', 'T5', 'commerce'] as const;
export type TypologieVente = (typeof TYPOLOGIES_VENTE)[number];

/** Orientation (8 secteurs de 45°) d'un azimut (0 = nord, sens horaire). */
export function orientationDeLAzimut(azimutDeg: number): Orientation {
  const a = ((azimutDeg % 360) + 360) % 360;
  return ORIENTATIONS[Math.round(a / 45) % 8]!;
}

/** Écart angulaire (0 à 180°) entre deux azimuts. */
export function ecartAzimut(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Ce que le filtre lit d'un lot (le lot commercial complet du Studio, ou la ligne d'une synthèse côté site). */
export interface LotFiltrable {
  readonly id: string;
  readonly lot: string;
  /** Niveau : 0 = RDC, 1 = 1er étage… */
  readonly niveau: number;
  readonly typologie: string;
  readonly shabM2: number;
  /** Prix proposé TTC (€) ; null : non chiffré. */
  readonly prixEur: number | null;
  /** Azimuts des façades vitrées du lot, la principale en premier. */
  readonly azimutsDeg: readonly number[];
  readonly orientation: Orientation | null;
  readonly exterieurM2: number;
  readonly parkings: number;
  readonly statut: StatutLot;
}

/** Champ absent ou `undefined` : pas de contrainte. */
export interface FiltreVente {
  readonly etageMin?: number | undefined;
  readonly etageMax?: number | undefined;
  readonly prixMin?: number | undefined;
  readonly prixMax?: number | undefined;
  readonly surfaceMin?: number | undefined;
  readonly surfaceMax?: number | undefined;
  readonly typologies?: readonly TypologieVente[] | undefined;
  readonly orientations?: readonly Orientation[] | undefined;
  readonly exterieur?: boolean | undefined;
  readonly parkingsMin?: number | undefined;
  readonly statuts?: readonly StatutLot[] | undefined;
}

/** Un lot passe-t-il le filtre ? (champ absent = pas de contrainte). Pur. */
export function lotCorrespond(l: LotFiltrable, f: FiltreVente): boolean {
  if (f.etageMin !== undefined && l.niveau < f.etageMin) return false;
  if (f.etageMax !== undefined && l.niveau > f.etageMax) return false;
  if (f.prixMin !== undefined && (l.prixEur === null || l.prixEur < f.prixMin)) return false;
  if (f.prixMax !== undefined && (l.prixEur === null || l.prixEur > f.prixMax)) return false;
  if (f.surfaceMin !== undefined && l.shabM2 < f.surfaceMin - 1e-6) return false;
  if (f.surfaceMax !== undefined && l.shabM2 > f.surfaceMax + 1e-6) return false;
  if (f.typologies && f.typologies.length > 0 && !f.typologies.includes(l.typologie as TypologieVente)) return false;
  if (f.orientations && f.orientations.length > 0) {
    const ok = f.orientations.some((o) => l.azimutsDeg.some((a) => ecartAzimut(a, AZIMUT_ORIENTATION[o]) <= 45 + 1e-6));
    if (!ok) return false;
  }
  if (f.exterieur === true && !(l.exterieurM2 > 0)) return false;
  if (f.exterieur === false && l.exterieurM2 > 0) return false;
  if (f.parkingsMin !== undefined && l.parkings < f.parkingsMin) return false;
  if (f.statuts && f.statuts.length > 0 && !f.statuts.includes(l.statut)) return false;
  return true;
}

export function filtrerLots<L extends LotFiltrable>(lots: readonly L[], f: FiltreVente): L[] {
  return lots.filter((l) => lotCorrespond(l, f));
}

export function filtreVide(f: FiltreVente): boolean {
  return Object.values(f).every((v) => v === undefined || (Array.isArray(v) && v.length === 0));
}

/* ───────────────────────── Paramètres plats du pont (commande `grille-vente`) ───────────────────────── */

export type ParamsPlats = Readonly<Record<string, string | number | boolean>>;

const liste = <T extends string>(v: unknown, permis: readonly T[]): T[] => {
  if (typeof v !== 'string') return [];
  const out: T[] = [];
  for (const brut of v.split(/[,;|\s]+/)) {
    const x = normaliser(brut).replace(/^t(\d)$/, 'T$1').replace(/^commerces?$/, 'commerce');
    const trouve = permis.find((p) => normaliser(p) === normaliser(x));
    if (trouve && !out.includes(trouve)) out.push(trouve);
  }
  return out;
};
const nombre = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/\s/g, '').replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Paramètres plats (pont, URL) → filtre. Les valeurs illisibles sont ignorées. Pur. */
export function filtreDepuisParams(p: ParamsPlats | Readonly<Record<string, unknown>>): FiltreVente {
  const f: { -readonly [K in keyof FiltreVente]: FiltreVente[K] } = {};
  const n = (k: string): number | undefined => nombre((p as Record<string, unknown>)[k]);
  const em = n('etageMin'), eM = n('etageMax'), pm = n('prixMin'), pM = n('prixMax'), sm = n('surfaceMin'), sM = n('surfaceMax'), pk = n('parkingsMin');
  if (em !== undefined) f.etageMin = Math.max(0, Math.round(em));
  if (eM !== undefined) f.etageMax = Math.max(0, Math.round(eM));
  if (pm !== undefined && pm >= 0) f.prixMin = pm;
  if (pM !== undefined && pM >= 0) f.prixMax = pM;
  if (sm !== undefined && sm >= 0) f.surfaceMin = sm;
  if (sM !== undefined && sM >= 0) f.surfaceMax = sM;
  if (pk !== undefined && pk >= 0) f.parkingsMin = Math.round(pk);
  const t = liste((p as Record<string, unknown>).typologies, TYPOLOGIES_VENTE); if (t.length) f.typologies = t;
  const o = liste((p as Record<string, unknown>).orientations, ORIENTATIONS); if (o.length) f.orientations = o;
  const s = liste((p as Record<string, unknown>).statuts, STATUTS_LOT); if (s.length) f.statuts = s;
  const x = (p as Record<string, unknown>).exterieur;
  if (x === true || x === false) f.exterieur = x;
  return f;
}

/** Filtre → paramètres plats (seulement les champs renseignés). Pur. */
export function filtreVersParams(f: FiltreVente): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const k of ['etageMin', 'etageMax', 'prixMin', 'prixMax', 'surfaceMin', 'surfaceMax', 'parkingsMin'] as const) if (f[k] !== undefined) out[k] = f[k]!;
  if (f.typologies?.length) out.typologies = f.typologies.join(',');
  if (f.orientations?.length) out.orientations = f.orientations.join(',');
  if (f.statuts?.length) out.statuts = f.statuts.join(',');
  if (f.exterieur !== undefined) out.exterieur = f.exterieur;
  return out;
}

/* ───────────────────────── Phrase française → filtre (sans IA) ───────────────────────── */

function normaliser(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
}

const ORDINAUX: Readonly<Record<string, number>> = {
  premier: 1, '1er': 1, '1re': 1, '1ere': 1, deuxieme: 2, second: 2, seconde: 2, troisieme: 3, quatrieme: 4, cinquieme: 5,
  sixieme: 6, septieme: 7, huitieme: 8, neuvieme: 9, dixieme: 10,
};
const NB_LETTRES: Readonly<Record<string, number>> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };

/** « 2e », « 2ème », « deuxième », « R+2 », « 1er » → 2 ; « rdc », « rez-de-chaussée » → 0. */
function lireEtage(m: string): number | null {
  const t = m.trim();
  if (/^(rdc|rez[- ]de[- ]chaussee|rez)$/.test(t)) return 0;
  const r = /^r\s*\+\s*(\d{1,2})$/.exec(t); if (r) return Number(r[1]);
  const d = /^(\d{1,2})\s*(?:e|eme|er|ere|re|°)?$/.exec(t); if (d) return Number(d[1]);
  return ORDINAUX[t] ?? null;
}

/** Montant (« 300 000 € », « 300k€ », « 300 k », « 1,2 M€ ») → euros. */
function lireMontant(nb: string, unite: string | undefined): number | null {
  const n = Number(nb.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const u = (unite ?? '').replace(/\s/g, '');
  if (/^(k|k€|keur|kilo)/.test(u)) return Math.round(n * 1000);
  if (/^(m|m€|meur|million)/.test(u)) return Math.round(n * 1_000_000);
  return n < 5000 ? Math.round(n * 1000) : Math.round(n); // « 300 » dans une phrase de prix : 300 k€
}

export interface LectureFiltre {
  readonly filtre: FiltreVente;
  /** Lots nommés à comparer (« compare A203 et A305 »). */
  readonly comparer: readonly string[];
  /** Ce qui a été compris, en clair (pour la réponse du chat). */
  readonly compris: readonly string[];
}

const ETAGE = '(rdc|rez[- ]de[- ]chaussee|r\\s*\\+\\s*\\d{1,2}|\\d{1,2}\\s*(?:e|eme|er|ere|re|°)?|premier|1er|1re|1ere|deuxieme|second|seconde|troisieme|quatrieme|cinquieme|sixieme|septieme|huitieme|neuvieme|dixieme)';
const MONTANT = '(\\d[\\d\\s]*(?:[.,]\\d+)?)\\s*(k\\s*€|k\\s*eur|k\\b|m\\s*€|millions?|m(?![2²])\\b|€|eur(?:os)?)?';

/**
 * Phrase française → filtre de la grille de vente. Pur, déterministe, sans IA.
 * Exemple : « montre-moi les T3 libres au-dessus du 2e étage orientés sud » →
 *   { typologies: ['T3'], statuts: ['libre'], etageMin: 3, orientations: ['sud'] }.
 */
export function filtreDepuisPhrase(phrase: string): LectureFiltre {
  const t = ` ${normaliser(phrase)} `;
  const f: { -readonly [K in keyof FiltreVente]: FiltreVente[K] } = {};
  const compris: string[] = [];

  // Typologies : T1…T5, « studio », « 3 pièces », « 2 chambres » (chambres + 1), « commerce ».
  const typos = new Set<TypologieVente>();
  for (const m of t.matchAll(/\bt\s?([1-5])\b/g)) typos.add(`T${m[1]}` as TypologieVente);
  if (/\bstudios?\b/.test(t)) typos.add('T1');
  for (const m of t.matchAll(/\b(\d|un|une|deux|trois|quatre|cinq)\s*(pieces|piece|p)\b/g)) {
    const n = /^\d$/.test(m[1]!) ? Number(m[1]) : NB_LETTRES[m[1]!]!;
    if (n >= 1 && n <= 5) typos.add(`T${n}` as TypologieVente);
  }
  for (const m of t.matchAll(/\b(\d|une|deux|trois|quatre)\s*chambres?\b/g)) {
    const n = (/^\d$/.test(m[1]!) ? Number(m[1]) : NB_LETTRES[m[1]!]!) + 1;
    if (n >= 2 && n <= 5) typos.add(`T${n}` as TypologieVente);
  }
  if (/\b(commerces?|locaux commerciaux|local commercial|boutiques?)\b/.test(t)) typos.add('commerce');
  if (typos.size) { f.typologies = TYPOLOGIES_VENTE.filter((x) => typos.has(x)); compris.push(`typologie ${f.typologies.join(', ')}`); }

  // Statuts.
  const st = new Set<StatutLot>();
  if (/\b(libres?|disponibles?|dispos?|a vendre|invendus?)\b/.test(t)) st.add('libre');
  if (/\b(optionnes?|optionnees?|en option|sous option|options?)\b/.test(t) && !/\boptions? de\b/.test(t)) st.add('optionne');
  if (/\b(reserves?|reservees?|reservation)\b/.test(t)) st.add('reserve');
  if (/\b(vendus?|vendues?)\b/.test(t) && !/\binvendus?\b/.test(t)) st.add('vendu');
  if (st.size) { f.statuts = STATUTS_LOT.filter((x) => st.has(x)); compris.push(`statut ${f.statuts.map((s) => LIBELLES_STATUT[s].toLowerCase()).join(', ')}`); }

  // Étages.
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`\\bentre (?:le |la )?${ETAGE}(?: etage)? et (?:le |la )?${ETAGE}(?: etage)?`).exec(t))) {
    const a = lireEtage(m[1]!), b = lireEtage(m[2]!);
    if (a !== null && b !== null) { f.etageMin = Math.min(a, b); f.etageMax = Math.max(a, b); }
  }
  if (f.etageMin === undefined && (m = new RegExp(`\\b(?:au[- ]dessus d[ue]|plus haut que(?: le)?|apres le|superieurs? au|superieure au)\\s*(?:l')?${ETAGE}`).exec(t))) {
    const a = lireEtage(m[1]!); if (a !== null) f.etageMin = a + 1;
  }
  if (f.etageMin === undefined && (m = new RegExp(`\\b(?:a partir d[ue]|des le|au moins au|minimum au|depuis le)\\s*(?:l')?${ETAGE}`).exec(t))) {
    const a = lireEtage(m[1]!); if (a !== null) f.etageMin = a;
  }
  if (f.etageMax === undefined && (m = new RegExp(`\\b(?:en[- ]dessous d[ue]|au[- ]dessous d[ue]|plus bas que(?: le)?|avant le|sous le)\\s*(?:l')?${ETAGE}`).exec(t))) {
    const a = lireEtage(m[1]!); if (a !== null) f.etageMax = Math.max(0, a - 1);
  }
  if (f.etageMax === undefined && (m = new RegExp(`\\b(?:jusqu'au|au plus au|maximum au)\\s*${ETAGE}`).exec(t))) {
    const a = lireEtage(m[1]!); if (a !== null) f.etageMax = a;
  }
  if (f.etageMin === undefined && f.etageMax === undefined) {
    if ((m = /\b(?:au |en )(rdc|rez[- ]de[- ]chaussee)\b/.exec(t))) { f.etageMin = 0; f.etageMax = 0; }
    else if ((m = new RegExp(`\\bau ${ETAGE} etage\\b`).exec(t)) || (m = /\b(?:en|au) (r\s*\+\s*\d{1,2})\b/.exec(t))) {
      const a = lireEtage(m[1]!); if (a !== null) { f.etageMin = a; f.etageMax = a; }
    } else if (/\ben etage\b|\bpas au rdc\b|\bhors rdc\b/.test(t)) f.etageMin = 1;
  }
  if (f.etageMin !== undefined || f.etageMax !== undefined) {
    const lib = (n: number): string => (n === 0 ? 'RDC' : `${n}${n === 1 ? 'er' : 'e'} étage`);
    compris.push(f.etageMin !== undefined && f.etageMax !== undefined
      ? (f.etageMin === f.etageMax ? `au ${lib(f.etageMin)}` : `du ${lib(f.etageMin)} au ${lib(f.etageMax)}`)
      : f.etageMin !== undefined ? `à partir du ${lib(f.etageMin)}` : `jusqu'au ${lib(f.etageMax!)}`);
  }

  // Prix (€).
  const P = MONTANT;
  if ((m = new RegExp(`\\bentre ${P} et ${P}`).exec(t)) && /(€|eur|k\b|prix|budget|euros?)/.test(m[0] + t)) {
    const a = lireMontant(m[1]!, m[2] ?? m[4]), b = lireMontant(m[3]!, m[4] ?? m[2]);
    if (a !== null && b !== null && Math.max(a, b) >= 20000) { f.prixMin = Math.min(a, b); f.prixMax = Math.max(a, b); }
  }
  if (f.prixMax === undefined && (m = new RegExp(`\\b(?:moins de|sous|maxi(?:mum)?|max|budget(?: de)?|jusqu'a|au plus|inferieurs? a|pas plus de)\\s*${P}`).exec(t))) {
    const v = lireMontant(m[1]!, m[2]);
    if (v !== null && v >= 20000 && !/^\s*(m2|m²|metres)/.test(t.slice(m.index + m[0].length))) f.prixMax = v;
  }
  if (f.prixMin === undefined && (m = new RegExp(`\\b(?:plus de|au moins|mini(?:mum)?|a partir de|superieurs? a)\\s*${P}`).exec(t))) {
    const v = lireMontant(m[1]!, m[2]);
    const suite = t.slice(m.index + m[0].length);
    if (v !== null && v >= 20000 && !/^\s*(m2|m²|metres)/.test(suite)) f.prixMin = v;
  }
  if (f.prixMin !== undefined || f.prixMax !== undefined) compris.push(`prix ${f.prixMin !== undefined ? `≥ ${euros(f.prixMin)}` : ''}${f.prixMin !== undefined && f.prixMax !== undefined ? ' et ' : ''}${f.prixMax !== undefined ? `≤ ${euros(f.prixMax)}` : ''}`);

  // Surface (m²).
  const S = '(\\d{1,3}(?:[.,]\\d+)?)\\s*(?:m2|m²|m\\b|metres? carres?)';
  if ((m = new RegExp(`\\bentre (\\d{1,3}(?:[.,]\\d+)?)\\s*(?:m2|m²)?\\s*et ${S}`).exec(t))) {
    const a = Number(m[1]!.replace(',', '.')), b = Number(m[2]!.replace(',', '.'));
    f.surfaceMin = Math.min(a, b); f.surfaceMax = Math.max(a, b);
  }
  if (f.surfaceMin === undefined && (m = new RegExp(`\\b(?:plus de|au moins|mini(?:mum)?|a partir de|superieurs? a|>=?)\\s*${S}`).exec(t))) f.surfaceMin = Number(m[1]!.replace(',', '.'));
  if (f.surfaceMax === undefined && (m = new RegExp(`\\b(?:moins de|au plus|maxi(?:mum)?|max|inferieurs? a|<=?)\\s*${S}`).exec(t))) f.surfaceMax = Number(m[1]!.replace(',', '.'));
  if (f.surfaceMin !== undefined || f.surfaceMax !== undefined) compris.push(`surface ${f.surfaceMin !== undefined ? `≥ ${f.surfaceMin} m²` : ''}${f.surfaceMin !== undefined && f.surfaceMax !== undefined ? ' et ' : ''}${f.surfaceMax !== undefined ? `≤ ${f.surfaceMax} m²` : ''}`);

  // Orientations (« est » seul est un verbe : exigé après orienté / exposé / plein / côté, ou composé).
  const ori = new Set<Orientation>();
  for (const mm of t.matchAll(/\b(nord|sud)[- ](est|ouest)\b/g)) ori.add(`${mm[1]}-${mm[2]}` as Orientation);
  const sansComposes = t.replace(/\b(nord|sud)[- ](est|ouest)\b/g, ' ');
  if (/\bsud\b/.test(sansComposes)) ori.add('sud');
  if (/\bnord\b/.test(sansComposes)) ori.add('nord');
  if (/\bouest\b/.test(sansComposes)) ori.add('ouest');
  if (/\b(?:orientes?|orientees?|exposes?|exposees?|plein|cote|face|vers l'|a l'|plutot|et|ou)\s*est\b/.test(sansComposes) && /\b(orient|expos|plein est|cote est|face est|soleil)/.test(t)) ori.add('est');
  if (ori.size) { f.orientations = ORIENTATIONS.filter((o) => ori.has(o)); compris.push(`orientation ${f.orientations.map((o) => LIBELLES_ORIENTATION[o].toLowerCase()).join(', ')}`); }

  // Extérieur.
  if (/\bsans (exterieur|balcon|terrasse|jardin)\b/.test(t)) { f.exterieur = false; compris.push('sans extérieur'); }
  else if (/\b(avec|ayant|et) (un |une |du |de la )?(exterieur|balcon|terrasse|jardin|loggia)s?\b|\bexterieurs?\b|\bbalcons?\b|\bterrasses?\b/.test(t)) { f.exterieur = true; compris.push('avec extérieur'); }

  // Parking.
  if ((m = /\b(?:avec )?(\d|un|une|deux|trois) (?:places? de )?(?:parkings?|stationnements?|garages?|box)\b/.exec(t))) {
    const n = /^\d$/.test(m[1]!) ? Number(m[1]) : NB_LETTRES[m[1]!]!; f.parkingsMin = n; compris.push(`${n} parking${n > 1 ? 's' : ''} au moins`);
  } else if (/\bavec (?:une? )?(?:place de )?(parking|stationnement|garage|box)\b/.test(t)) { f.parkingsMin = 1; compris.push('avec parking'); }

  // Lots à comparer (« compare A203 et A305 », « A102 vs B201 »).
  const comparer: string[] = [];
  if (/\b(compar|versus|vs\b|face a face|cote a cote)/.test(t)) {
    for (const mm of phrase.matchAll(/\b([A-Za-z]\d{3,4})\b/g)) { const x = mm[1]!.toUpperCase(); if (!comparer.includes(x)) comparer.push(x); }
  }
  if (comparer.length) compris.push(`comparer ${comparer.join(', ')}`);
  return { filtre: f, comparer: comparer.slice(0, 3), compris };
}

/* ───────────────────────── Synthèse et textes ───────────────────────── */

export function euros(v: number): string {
  const r = Math.round(v);
  return `${String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
}

export function resumeFiltre(f: FiltreVente): string {
  const p: string[] = [];
  if (f.typologies?.length) p.push(f.typologies.map((x) => (x === 'commerce' ? 'commerces' : x)).join(', '));
  if (f.statuts?.length) p.push(f.statuts.map((s) => LIBELLES_STATUT[s].toLowerCase()).join(' ou '));
  const lib = (n: number): string => (n === 0 ? 'RDC' : `${n}${n === 1 ? 'er' : 'e'}`);
  if (f.etageMin !== undefined && f.etageMax !== undefined) p.push(f.etageMin === f.etageMax ? `au ${lib(f.etageMin)}` : `du ${lib(f.etageMin)} au ${lib(f.etageMax)}`);
  else if (f.etageMin !== undefined) p.push(`à partir du ${lib(f.etageMin)}`);
  else if (f.etageMax !== undefined) p.push(`jusqu'au ${lib(f.etageMax)}`);
  if (f.orientations?.length) p.push(`orientés ${f.orientations.map((o) => LIBELLES_ORIENTATION[o].toLowerCase()).join(' ou ')}`);
  if (f.surfaceMin !== undefined) p.push(`≥ ${f.surfaceMin} m²`);
  if (f.surfaceMax !== undefined) p.push(`≤ ${f.surfaceMax} m²`);
  if (f.prixMin !== undefined) p.push(`≥ ${euros(f.prixMin)}`);
  if (f.prixMax !== undefined) p.push(`≤ ${euros(f.prixMax)}`);
  if (f.exterieur === true) p.push('avec extérieur');
  if (f.exterieur === false) p.push('sans extérieur');
  if (f.parkingsMin !== undefined) p.push(`${f.parkingsMin} parking${f.parkingsMin > 1 ? 's' : ''} ou plus`);
  return p.length ? p.join(' · ') : 'tous les lots';
}

export interface SyntheseLots {
  readonly total: number;
  readonly retenus: number;
  readonly parStatut: Readonly<Record<StatutLot, number>>;
  readonly parTypologie: Readonly<Record<string, number>>;
  readonly prixMin: number | null;
  readonly prixMax: number | null;
  readonly surfaceMin: number | null;
  readonly surfaceMax: number | null;
  /** Prix moyen au m² SHAB des lots retenus chiffrés (€/m²). */
  readonly prixM2Moyen: number | null;
  /** Les premiers lots retenus (au plus `max`), triés par niveau puis numéro. */
  readonly lots: readonly { readonly lot: string; readonly niveau: number; readonly typologie: string; readonly shabM2: number; readonly prixEur: number | null; readonly orientation: Orientation | null; readonly statut: StatutLot }[];
}

/** Synthèse d'une sélection (carte du chat, en-tête de la grille). Pur. */
export function syntheseLots(tous: readonly LotFiltrable[], f: FiltreVente, max = 8): SyntheseLots {
  const r = filtrerLots(tous, f).sort((a, b) => a.niveau - b.niveau || a.lot.localeCompare(b.lot));
  const parStatut = { libre: 0, optionne: 0, reserve: 0, vendu: 0 } as Record<StatutLot, number>;
  const parTypologie: Record<string, number> = {};
  for (const l of r) { parStatut[l.statut]++; parTypologie[l.typologie] = (parTypologie[l.typologie] ?? 0) + 1; }
  const prix = r.map((l) => l.prixEur).filter((x): x is number => x !== null);
  const s = r.map((l) => l.shabM2);
  const chiffres = r.filter((l) => l.prixEur !== null && l.shabM2 > 0);
  const m2 = chiffres.reduce((a, l) => a + l.shabM2, 0);
  return {
    total: tous.length, retenus: r.length, parStatut, parTypologie,
    prixMin: prix.length ? Math.min(...prix) : null, prixMax: prix.length ? Math.max(...prix) : null,
    surfaceMin: s.length ? Math.min(...s) : null, surfaceMax: s.length ? Math.max(...s) : null,
    prixM2Moyen: m2 > 0 ? Math.round(chiffres.reduce((a, l) => a + (l.prixEur as number), 0) / m2) : null,
    lots: r.slice(0, max).map((l) => ({ lot: l.lot, niveau: l.niveau, typologie: l.typologie, shabM2: l.shabM2, prixEur: l.prixEur, orientation: l.orientation, statut: l.statut })),
  };
}

/** Empreinte FNV-1a du vocabulaire (statuts, orientations, typologies) : les deux copies doivent la partager. */
export function empreinteFiltreVente(): string {
  const s = JSON.stringify([VERSION_FILTRE_VENTE, STATUTS_LOT, ORIENTATIONS, TYPOLOGIES_VENTE, AZIMUT_ORIENTATION]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `fnv1a32:${h.toString(16).padStart(8, '0')}`;
}
