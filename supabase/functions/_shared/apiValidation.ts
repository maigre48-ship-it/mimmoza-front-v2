// supabase/functions/_shared/apiValidation.ts
// ─────────────────────────────────────────────────────────────────────────────
// Validation STRICTE des corps de requête de l'API publique Mimmoza.
//
// Exécutée AVANT toute réservation de crédits : une requête invalide reçoit un
// 400 explicite et ne coûte rien. Règles communes :
//   · champs inconnus refusés (une faute de frappe ne passe pas en silence) ;
//   · nombres attendus en type JSON number (pas de chaîne "48.8") ;
//   · coordonnées bornées à la France métropolitaine (Corse incluse) + DROM
//     (Guadeloupe, Martinique, Guyane, La Réunion, Mayotte) ;
//   · code INSEE : 5 caractères (01–95 hors 20, 2A/2B, 971–976) ;
//   · référence cadastrale (IDU) : 14 caractères INSEE(5)+préfixe(3)+section(2)+numéro(4).
// Module PUR (aucun import) : testable sans réseau.
// ─────────────────────────────────────────────────────────────────────────────

export interface ErreurChamp {
  champ: string;
  message: string;
}

export type Resultat<T> =
  | { ok: true; valeur: T }
  | { ok: false; erreurs: ErreurChamp[] };

// ── Zones géographiques couvertes ──────────────────────────────────────────
// Boîtes englobantes légèrement élargies (≈ 0,1°) pour ne pas rejeter un point
// côtier ; elles excluent l'essentiel de la mer et des pays voisins lointains.
export const ZONES_FRANCE: ReadonlyArray<{ nom: string; latMin: number; latMax: number; lonMin: number; lonMax: number }> = [
  { nom: "France métropolitaine", latMin: 41.2, latMax: 51.2, lonMin: -5.3, lonMax: 9.7 },
  { nom: "Guadeloupe", latMin: 15.8, latMax: 16.6, lonMin: -61.9, lonMax: -60.9 },
  { nom: "Martinique", latMin: 14.35, latMax: 14.95, lonMin: -61.3, lonMax: -60.75 },
  { nom: "Guyane", latMin: 2.0, latMax: 5.9, lonMin: -54.7, lonMax: -51.5 },
  { nom: "La Réunion", latMin: -21.45, latMax: -20.85, lonMin: 55.15, lonMax: 55.9 },
  { nom: "Mayotte", latMin: -13.05, latMax: -12.6, lonMin: 44.95, lonMax: 45.35 },
];

export function estEnFrance(lat: number, lon: number): boolean {
  return ZONES_FRANCE.some((z) => lat >= z.latMin && lat <= z.latMax && lon >= z.lonMin && lon <= z.lonMax);
}

const RE_INSEE = /^(?:(?:0[1-9]|1\d|2[1-9]|[3-8]\d|9[0-5])\d{3}|2[AB]\d{3}|97[1-6]\d{2})$/;

export function estCodeInsee(v: string): boolean {
  return RE_INSEE.test(v) && !/000$/.test(v);
}

/** IDU normalisé : INSEE(5) + préfixe(3 chiffres) + section(2, ex. "AB" ou "0A") + numéro(4 chiffres). */
const RE_IDU = /^([0-9]{2}[0-9]{3}|2[AB][0-9]{3})([0-9]{3})([0-9A-Z][A-Z])([0-9]{4})$/;

export interface ReferenceCadastrale {
  idu: string;
  code_insee: string;
  prefixe: string;
  section: string;
  numero: string;
}

export function analyserReferenceCadastrale(brut: string): ReferenceCadastrale | null {
  const s = brut.replace(/[\s\-_.]/g, "").toUpperCase();
  const m = RE_IDU.exec(s);
  if (!m) return null;
  const [, insee, prefixe, section, numero] = m;
  if (!estCodeInsee(insee) || numero === "0000") return null;
  return { idu: s, code_insee: insee, prefixe, section, numero };
}

// ── Lecteur de corps avec accumulation d'erreurs ───────────────────────────
// deno-lint-ignore no-explicit-any
type Corps = Record<string, any>;

export class LecteurCorps {
  readonly erreurs: ErreurChamp[] = [];
  private readonly lus = new Set<string>();
  constructor(private readonly corps: Corps) {}

  private present(champ: string): boolean {
    this.lus.add(champ);
    return Object.prototype.hasOwnProperty.call(this.corps, champ) && this.corps[champ] !== null && this.corps[champ] !== undefined;
  }

  erreur(champ: string, message: string): void {
    this.erreurs.push({ champ, message });
  }

  a(champ: string): boolean {
    return this.present(champ);
  }

  nombre(champ: string, o: { min: number; max: number; entier?: boolean; requis?: boolean }): number | undefined {
    if (!this.present(champ)) {
      if (o.requis) this.erreur(champ, "champ obligatoire");
      return undefined;
    }
    const v = this.corps[champ];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.erreur(champ, "doit être un nombre (type JSON number)");
      return undefined;
    }
    if (o.entier && !Number.isInteger(v)) {
      this.erreur(champ, "doit être un entier");
      return undefined;
    }
    if (v < o.min || v > o.max) {
      this.erreur(champ, `doit être compris entre ${o.min} et ${o.max}`);
      return undefined;
    }
    return v;
  }

  texte(champ: string, o: { max: number; min?: number; requis?: boolean; motif?: RegExp; messageMotif?: string }): string | undefined {
    if (!this.present(champ)) {
      if (o.requis) this.erreur(champ, "champ obligatoire");
      return undefined;
    }
    const v = this.corps[champ];
    if (typeof v !== "string") {
      this.erreur(champ, "doit être une chaîne de caractères");
      return undefined;
    }
    const t = v.trim();
    // deno-lint-ignore no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(t)) {
      this.erreur(champ, "contient des caractères de contrôle");
      return undefined;
    }
    if (t.length < (o.min ?? 1)) {
      this.erreur(champ, o.requis ? "champ obligatoire (vide)" : "ne doit pas être vide");
      return undefined;
    }
    if (t.length > o.max) {
      this.erreur(champ, `ne doit pas dépasser ${o.max} caractères`);
      return undefined;
    }
    if (o.motif && !o.motif.test(t)) {
      this.erreur(champ, o.messageMotif ?? "format invalide");
      return undefined;
    }
    return t;
  }

  choix<T extends string>(champ: string, valeurs: readonly T[], o: { requis?: boolean } = {}): T | undefined {
    if (!this.present(champ)) {
      if (o.requis) this.erreur(champ, `champ obligatoire (valeurs : ${valeurs.join(", ")})`);
      return undefined;
    }
    const v = this.corps[champ];
    if (typeof v !== "string" || !(valeurs as readonly string[]).includes(v)) {
      this.erreur(champ, `valeur non reconnue (valeurs : ${valeurs.join(", ")})`);
      return undefined;
    }
    return v as T;
  }

  booleen(champ: string): boolean | undefined {
    if (!this.present(champ)) return undefined;
    const v = this.corps[champ];
    if (typeof v !== "boolean") {
      this.erreur(champ, "doit être un booléen (true / false)");
      return undefined;
    }
    return v;
  }

  codeInsee(champ = "code_insee", requis = false): string | undefined {
    const t = this.texte(champ, { max: 5, requis });
    if (t === undefined) return undefined;
    const v = t.toUpperCase();
    if (!estCodeInsee(v)) {
      this.erreur(champ, "code INSEE invalide (5 caractères, ex. 75056, 2A004, 97411)");
      return undefined;
    }
    return v;
  }

  codePostal(champ = "code_postal"): string | undefined {
    return this.texte(champ, { max: 5, motif: /^(?:0[1-9]|[1-8]\d|9[0-8])\d{3}$/, messageMotif: "code postal invalide (5 chiffres)" });
  }

  reference(champ = "reference_cadastrale", requis = false): ReferenceCadastrale | undefined {
    const t = this.texte(champ, { max: 24, requis });
    if (t === undefined) return undefined;
    const r = analyserReferenceCadastrale(t);
    if (!r) {
      this.erreur(
        champ,
        "référence cadastrale invalide : 14 caractères = code INSEE (5) + préfixe (3 chiffres, souvent 000) + section (2, ex. AB ou 0A) + numéro (4 chiffres), ex. 75056000AB0012",
      );
      return undefined;
    }
    return r;
  }

  /** lat et lon : les deux ou aucun ; bornés à la France (métropole + DROM). */
  coordonnees(requis = false): { lat: number; lon: number } | undefined {
    const aLat = this.present("lat");
    const aLon = this.present("lon");
    if (!aLat && !aLon) {
      if (requis) this.erreur("lat", "lat et lon sont obligatoires");
      return undefined;
    }
    if (aLat !== aLon) {
      this.erreur(aLat ? "lon" : "lat", "lat et lon doivent être fournis ensemble");
      return undefined;
    }
    const lat = this.nombre("lat", { min: -90, max: 90 });
    const lon = this.nombre("lon", { min: -180, max: 180 });
    if (lat === undefined || lon === undefined) return undefined;
    if (!estEnFrance(lat, lon)) {
      this.erreur("lat", "coordonnées hors de la zone couverte (France métropolitaine, Corse, Guadeloupe, Martinique, Guyane, La Réunion, Mayotte) ; rappel : lat = latitude, lon = longitude (WGS84)");
      return undefined;
    }
    return { lat, lon };
  }

  /** À appeler en dernier : refuse les champs non lus (inconnus). */
  terminer<T>(valeur: T): Resultat<T> {
    for (const k of Object.keys(this.corps)) {
      if (!this.lus.has(k)) this.erreur(k, "champ inconnu");
    }
    return this.erreurs.length ? { ok: false, erreurs: this.erreurs } : { ok: true, valeur };
  }
}

// ── Entrées normalisées par route ──────────────────────────────────────────

export const TYPES_BIEN_DVF = ["appartement", "maison", "local"] as const;
export type TypeBienDvf = typeof TYPES_BIEN_DVF[number];

export interface Localisation {
  lat?: number;
  lon?: number;
  reference?: ReferenceCadastrale;
  code_insee?: string;
}

function localisationPointOuParcelle(l: LecteurCorps): Localisation {
  const coords = l.coordonnees(false);
  const reference = l.reference("reference_cadastrale", false);
  const code_insee = l.codeInsee("code_insee", false);
  if (!coords && !reference && !l.erreurs.some((e) => e.champ === "lat" || e.champ === "lon" || e.champ === "reference_cadastrale")) {
    l.erreur("lat", "localisation obligatoire : fournir lat + lon, ou reference_cadastrale");
  }
  if (reference && code_insee && reference.code_insee !== code_insee) {
    l.erreur("code_insee", "ne correspond pas au code INSEE de la référence cadastrale");
  }
  return { ...(coords ?? {}), reference, code_insee: code_insee ?? reference?.code_insee };
}

export interface EntreeScoring extends Localisation {
  type_bien?: TypeBienDvf;
  surface_m2?: number;
  prix?: number;
  rayon_km: number;
  horizon_mois: number;
  dpe?: string;
}

export function validerScoring(corps: Corps): Resultat<EntreeScoring> {
  const l = new LecteurCorps(corps);
  const loc = localisationPointOuParcelle(l);
  const type_bien = l.choix("type_bien", TYPES_BIEN_DVF);
  const surface_m2 = l.nombre("surface_m2", { min: 1, max: 100000 });
  const prix = l.nombre("prix", { min: 0, max: 1e9 });
  const rayon_km = l.nombre("rayon_km", { min: 0.2, max: 10 }) ?? 2;
  const horizon_mois = l.nombre("horizon_mois", { min: 6, max: 60, entier: true }) ?? 24;
  const dpe = l.choix("dpe", ["A", "B", "C", "D", "E", "F", "G"] as const);
  return l.terminer({ ...loc, type_bien, surface_m2, prix, rayon_km, horizon_mois, dpe });
}

export interface EntreeDvf extends Localisation {
  types: TypeBienDvf[];
  rayon_km: number;
  horizon_mois: number;
}

export function validerDvf(corps: Corps): Resultat<EntreeDvf> {
  const l = new LecteurCorps(corps);
  const loc = localisationPointOuParcelle(l);
  const type_bien = l.choix("type_bien", TYPES_BIEN_DVF);
  const rayon_km = l.nombre("rayon_km", { min: 0.2, max: 10 }) ?? 2;
  const horizon_mois = l.nombre("horizon_mois", { min: 6, max: 60, entier: true }) ?? 24;
  const types: TypeBienDvf[] = type_bien ? [type_bien] : ["appartement", "maison"];
  return l.terminer({ ...loc, types, rayon_km, horizon_mois });
}

export function validerRisques(corps: Corps): Resultat<Localisation> {
  const l = new LecteurCorps(corps);
  const loc = localisationPointOuParcelle(l);
  return l.terminer(loc);
}

export function validerParcelle(corps: Corps): Resultat<{ reference: ReferenceCadastrale }> {
  const l = new LecteurCorps(corps);
  const reference = l.reference("reference_cadastrale", true);
  return l.terminer({ reference: reference as ReferenceCadastrale });
}

export function validerServitudes(corps: Corps): Resultat<{ lat: number; lon: number }> {
  const l = new LecteurCorps(corps);
  const c = l.coordonnees(true);
  return l.terminer(c as { lat: number; lon: number });
}

export interface EntreeFaisabilite extends Localisation {
  surface_m2?: number;
}

export function validerFaisabilite(corps: Corps): Resultat<EntreeFaisabilite> {
  const l = new LecteurCorps(corps);
  const coords = l.coordonnees(false);
  const reference = l.reference("reference_cadastrale", false);
  const code_insee = l.codeInsee("code_insee", false);
  const surface_m2 = l.nombre("surface_m2", { min: 1, max: 10_000_000 });
  if (!coords && !reference && !code_insee && !l.erreurs.length) {
    l.erreur("reference_cadastrale", "localisation obligatoire : reference_cadastrale (recommandé), ou lat + lon, ou code_insee");
  }
  if (reference && code_insee && reference.code_insee !== code_insee) {
    l.erreur("code_insee", "ne correspond pas au code INSEE de la référence cadastrale");
  }
  return l.terminer({ ...(coords ?? {}), reference, code_insee: code_insee ?? reference?.code_insee, surface_m2 });
}

export interface EntreePermis {
  code_epci?: string;
  code_insee?: string;
  annee_min: number;
}

export function validerPermis(corps: Corps, anneeCourante = new Date().getUTCFullYear()): Resultat<EntreePermis> {
  const l = new LecteurCorps(corps);
  const code_epci = l.texte("code_epci", { max: 9, motif: /^2\d{8}$/, messageMotif: "code EPCI invalide (SIREN à 9 chiffres commençant par 2)" });
  const code_insee = l.codeInsee("code_insee", false);
  const annee_min = l.nombre("annee_min", { min: 2000, max: anneeCourante, entier: true }) ?? anneeCourante - 3;
  if (!code_epci && !code_insee && !l.erreurs.length) l.erreur("code_epci", "fournir code_epci ou code_insee");
  if (code_epci && code_insee) l.erreur("code_insee", "fournir code_epci OU code_insee, pas les deux");
  return l.terminer({ code_epci, code_insee, annee_min });
}

export interface EntreeDpe {
  lat?: number;
  lon?: number;
  adresse?: string;
  code_postal?: string;
  rayon_m: number;
}

export function validerDpe(corps: Corps): Resultat<EntreeDpe> {
  const l = new LecteurCorps(corps);
  const coords = l.coordonnees(false);
  const adresse = l.texte("adresse", { max: 200, min: 3 });
  const code_postal = l.codePostal();
  const rayon_m = l.nombre("rayon_m", { min: 10, max: 500 }) ?? 150;
  if (!coords && !adresse && !code_postal && !l.erreurs.length) l.erreur("lat", "fournir lat + lon, ou adresse, ou code_postal");
  return l.terminer({ ...(coords ?? {}), adresse, code_postal, rayon_m });
}

export function validerBatiment(corps: Corps): Resultat<{ adresse?: string; code_insee?: string }> {
  const l = new LecteurCorps(corps);
  const adresse = l.texte("adresse", { max: 200, min: 3 });
  const code_insee = l.codeInsee("code_insee", false);
  if (!adresse && !code_insee && !l.erreurs.length) l.erreur("adresse", "fournir adresse (recommandé) ou code_insee");
  return l.terminer({ adresse, code_insee });
}

export interface EntreeCommune {
  code_insee?: string;
  code_postal?: string;
  commune?: string;
}

export function validerCommune(corps: Corps): Resultat<EntreeCommune> {
  const l = new LecteurCorps(corps);
  const code_insee = l.codeInsee("code_insee", false);
  const code_postal = l.codePostal();
  const commune = l.texte("commune", { max: 100, min: 2 });
  if (!code_insee && !code_postal && !commune && !l.erreurs.length) l.erreur("code_insee", "fournir code_insee (recommandé), code_postal ou commune");
  return l.terminer({ code_insee, code_postal, commune });
}

export interface EntreeEnvironnement {
  lat: number;
  lon: number;
  reference?: ReferenceCadastrale;
  rayon_patrimoine_m: number;
}

export function validerEnvironnement(corps: Corps): Resultat<EntreeEnvironnement> {
  const l = new LecteurCorps(corps);
  const c = l.coordonnees(true);
  const reference = l.reference("reference_cadastrale", false);
  const rayon_patrimoine_m = l.nombre("rayon_patrimoine_m", { min: 50, max: 2000 }) ?? 500;
  return l.terminer({ ...(c as { lat: number; lon: number }), reference, rayon_patrimoine_m });
}

export function validerMobilite(corps: Corps): Resultat<{ lat: number; lon: number; rayon_m: number }> {
  const l = new LecteurCorps(corps);
  const c = l.coordonnees(true);
  const rayon_m = l.nombre("rayon_m", { min: 200, max: 5000 }) ?? 2000;
  return l.terminer({ ...(c as { lat: number; lon: number }), rayon_m });
}

export const TYPOLOGIES_CONSTRUCTION = ["maison_individuelle", "collectif_r2", "collectif_r4", "tertiaire"] as const;
export const GAMMES = ["economique", "standard", "premium"] as const;
export const ZONES_ABC = ["Abis", "A", "B1", "B2", "C"] as const;
export const NIVEAUX_RENOVATION = ["rafraichissement", "partielle", "moyenne", "lourde", "complete"] as const;
export const POSTES_RENOVATION = [
  "cuisine", "salle_de_bains", "wc", "chauffage_pac", "cuve_fioul", "assainissement", "electricite",
  "plomberie", "sols", "peinture", "isolation_combles", "isolation_murs_iti", "toiture", "ravalement",
  "menuiseries", "piscine", "amenagements_ext",
] as const;

export type EntreeCouts =
  | {
    nature: "construction";
    typologie: typeof TYPOLOGIES_CONSTRUCTION[number];
    gamme: typeof GAMMES[number];
    surface_sdp_m2?: number;
    zone_abc?: typeof ZONES_ABC[number];
    code_insee?: string;
  }
  | {
    nature: "renovation";
    gamme: typeof GAMMES[number];
    surface_habitable_m2?: number;
    alea_pct?: number;
    restructuration?: boolean;
    niveau_global?: typeof NIVEAUX_RENOVATION[number];
    postes: Array<{ poste: typeof POSTES_RENOVATION[number]; quantite?: number; hypothese?: string }>;
  };

export function validerCouts(corps: Corps): Resultat<EntreeCouts> {
  const l = new LecteurCorps(corps);
  const nature = l.choix("nature", ["construction", "renovation"] as const, { requis: true });
  const gamme = l.choix("gamme", GAMMES) ?? "standard";
  if (nature === "construction") {
    const typologie = l.choix("typologie", TYPOLOGIES_CONSTRUCTION, { requis: true });
    const surface_sdp_m2 = l.nombre("surface_sdp_m2", { min: 1, max: 1_000_000 });
    const zone_abc = l.choix("zone_abc", ZONES_ABC);
    const code_insee = l.codeInsee("code_insee", false);
    return l.terminer({ nature, typologie: typologie!, gamme, surface_sdp_m2, zone_abc, code_insee });
  }
  if (nature === "renovation") {
    const surface_habitable_m2 = l.nombre("surface_habitable_m2", { min: 1, max: 100_000 });
    const alea_pct = l.nombre("alea_pct", { min: 0, max: 30 });
    const restructuration = l.booleen("restructuration");
    const niveau_global = l.choix("niveau_global", NIVEAUX_RENOVATION);
    const postes: Array<{ poste: typeof POSTES_RENOVATION[number]; quantite?: number; hypothese?: string }> = [];
    if (l.a("postes")) {
      const brut = corps.postes;
      if (!Array.isArray(brut)) l.erreur("postes", "doit être un tableau");
      else if (brut.length > 30) l.erreur("postes", "30 postes maximum");
      else {
        brut.forEach((p: unknown, i: number) => {
          if (!p || typeof p !== "object" || Array.isArray(p)) {
            l.erreur(`postes[${i}]`, "doit être un objet { poste, quantite?, hypothese? }");
            return;
          }
          const sl = new LecteurCorps(p as Corps);
          const poste = sl.choix("poste", POSTES_RENOVATION, { requis: true });
          const quantite = sl.nombre("quantite", { min: 0, max: 1_000_000 });
          const hypothese = sl.texte("hypothese", { max: 200 });
          const r = sl.terminer({ poste: poste!, quantite, hypothese });
          if (r.ok) postes.push(r.valeur);
          else r.erreurs.forEach((e) => l.erreur(`postes[${i}].${e.champ}`, e.message));
        });
      }
    }
    if (!l.erreurs.length && postes.length === 0 && !(niveau_global && surface_habitable_m2)) {
      l.erreur("postes", "fournir au moins un poste, ou niveau_global + surface_habitable_m2");
    }
    return l.terminer({ nature, gamme, surface_habitable_m2, alea_pct, restructuration, niveau_global, postes });
  }
  return l.terminer(undefined as unknown as EntreeCouts);
}

export const TYPES_BIEN_ESTIMATION = ["appartement", "maison", "immeuble", "terrain", "local_commercial", "autre"] as const;
export const PROFILS_ESTIMATION = ["investisseur", "rehabilitateur", "promoteur"] as const;

export interface EntreeEstimation {
  lat: number;
  lon: number;
  surface_m2: number;
  type_bien: typeof TYPES_BIEN_ESTIMATION[number];
  profil: typeof PROFILS_ESTIMATION[number];
  prix_demande?: number;
  surface_terrain_m2?: number;
  piscine?: boolean;
  budget_travaux?: number;
  prix_revente_cible?: number;
  adresse?: string;
  code_postal?: string;
  commune?: string;
  code_insee?: string;
}

export function validerEstimation(corps: Corps): Resultat<EntreeEstimation> {
  const l = new LecteurCorps(corps);
  const c = l.coordonnees(true);
  const surface_m2 = l.nombre("surface_m2", { min: 5, max: 100_000, requis: true });
  const type_bien = l.choix("type_bien", TYPES_BIEN_ESTIMATION, { requis: true });
  const profil = l.choix("profil", PROFILS_ESTIMATION) ?? "investisseur";
  const prix_demande = l.nombre("prix_demande", { min: 1, max: 1e9 });
  const surface_terrain_m2 = l.nombre("surface_terrain_m2", { min: 1, max: 10_000_000 });
  const piscine = l.booleen("piscine");
  const budget_travaux = l.nombre("budget_travaux", { min: 0, max: 1e9 });
  const prix_revente_cible = l.nombre("prix_revente_cible", { min: 1, max: 1e9 });
  const adresse = l.texte("adresse", { max: 200, min: 3 });
  const code_postal = l.codePostal();
  const commune = l.texte("commune", { max: 100, min: 2 });
  const code_insee = l.codeInsee("code_insee", false);
  return l.terminer({
    ...(c as { lat: number; lon: number }),
    surface_m2: surface_m2 as number,
    type_bien: type_bien!,
    profil,
    prix_demande,
    surface_terrain_m2,
    piscine,
    budget_travaux,
    prix_revente_cible,
    adresse,
    code_postal,
    commune,
    code_insee,
  });
}
