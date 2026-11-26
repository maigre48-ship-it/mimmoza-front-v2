/**
 * VIS-60 — DOSSIER CLIENT (« Dossier de présentation ») : logique PURE, partagée par le site et par copilot-chat
 * (Deno : aucun import du site, aucun accès réseau). Testée par dossierClient.test.ts (site) et
 * vis60-dossier-client.test.ts (Edge).
 *
 * À partir des travaux TERMINÉS d'une conversation (studio_jobs.resultat) :
 *   - choisit la perspective de couverture, les planches d'images (une par vue, la plus récente, qualité finale),
 *     le film (le plus récent, qualité finale de préférence), la visite 360° (lien public permanent /visite/<id>)
 *     et les plans (PDF, DXF, IFC — chemins `*_path` réellement envoyés) ;
 *   - dit si le dossier est prêt (au moins une image ou un film, et plus aucun rendu en attente ou en cours) ;
 *   - fixe l'arborescence du ZIP et le texte de la notice.
 * Règles commerciales :
 *   - AUCUNE mention de fournisseur d'assets tiers (BlenderKit, Poly Haven… : modèles « RF rendu seulement »), ni des
 *     avertissements techniques du worker : le client reçoit une seule mention neutre, « Images non contractuelles » ;
 *   - rien n'est inventé : une surface absente est dite « à confirmer », jamais estimée.
 */

export const MENTION_DOSSIER = 'Images non contractuelles';
export const TITRE_DOSSIER = 'Dossier de présentation';
export const BUCKET_RENDUS_DOSSIER = 'studio-rendus';

export type GenreFichier = 'film' | 'affiche' | 'image' | 'plan_pdf' | 'plan_dxf' | 'plan_ifc' | 'plan_apercu';

export interface FichierDossier {
  readonly bucket: string;
  readonly chemin: string;
  readonly genre: GenreFichier;
  readonly libelle: string;
  /** Nom du fichier dans le ZIP (dossier compris). */
  readonly nomZip: string;
  /** Version allégée pour le PDF (images : déclinaison web 16:9 si livrée), sinon le fichier lui-même. */
  readonly cheminApercu?: string;
  readonly famille?: 'exterieur' | 'interieur';
}

export interface TravailDossier {
  readonly id: string;
  readonly type: string;
  readonly statut: string;
  readonly resultat?: unknown;
  readonly cree_le: string;
  readonly termine_le?: string | null;
}

export interface ProgrammeDossier {
  readonly titre?: string | null;
  readonly adresse?: string | null;
  readonly sdp_m2?: number | null;
  readonly shab_m2?: number | null;
  readonly logements?: number | null;
  readonly gabarit?: string | null;
  readonly batiments?: number | null;
  readonly emprise_m2?: number | null;
  readonly surface_parcelle_m2?: number | null;
}

export interface ManifesteDossier {
  readonly perspective: FichierDossier | null;
  readonly images: readonly FichierDossier[];
  readonly film: { readonly fichier: FichierDossier; readonly affiche: FichierDossier | null; readonly dureeS: number | null; readonly apercu: boolean } | null;
  readonly visite: { readonly visiteId: string; readonly apercu: boolean } | null;
  readonly plans: readonly FichierDossier[];
  /** Travaux utilisés (traçabilité, jamais montrés au client). */
  readonly travaux: readonly string[];
}

export interface EtatDossier {
  /** Un dossier peut être préparé (au moins une image ou un film). */
  readonly preparable: boolean;
  /** Tous les livrables commandés sont terminés (rien en attente / en cours) ET le dossier est préparable. */
  readonly pret: boolean;
  readonly presents: readonly string[];
  /** Livrables absents (non commandés ou en échec) — dits, jamais masqués. */
  readonly absents: readonly string[];
  /** Rendus encore en attente ou en cours. */
  readonly enCours: number;
  readonly phrase: string;
}

type Obj = Record<string, unknown>;
const estObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const texte = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);
const nombre = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Fournisseurs tiers qui ne doivent JAMAIS apparaître dans un livrable client. */
export const MOTIFS_TIERS: readonly RegExp[] = [/blender\s*-?\s*kit/i, /poly\s*-?\s*haven/i, /ambient\s*cg/i, /\bcc0\b/i, /sketchfab/i, /quixel|megascans|fab\.com/i];

export function mentionneTiers(s: string): boolean {
  return MOTIFS_TIERS.some((m) => m.test(s));
}

/** Texte client : nul s'il nomme un fournisseur tiers (on retire, on ne réécrit pas). */
export function texteClient(s: string | null | undefined): string | null {
  const v = texte(s);
  return v && !mentionneTiers(v) ? v : null;
}

/** Nom de fichier sûr (ASCII, sans accent ni séparateur), borné. */
export function nomFichierSur(s: string, max = 60): string {
  const base = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, '-').replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, max);
  return base || 'fichier';
}

const ext = (chemin: string): string => (chemin.split('.').pop() ?? '').toLowerCase();
const parDateDesc = (a: TravailDossier, b: TravailDossier): number => Date.parse(b.termine_le ?? b.cree_le) - Date.parse(a.termine_le ?? a.cree_le);
const deux = (n: number): string => String(n).padStart(2, '0');

const VUES_COUVERTURE = ['trois_quarts_gauche', 'trois_quarts_droite', 'aerien', 'face', 'rue'];

function apercuWeb(r: Obj, vue: string): string | null {
  const lc = r['livraison_commerciale'];
  if (!estObj(lc) || !Array.isArray(lc['vues'])) return null;
  const v = (lc['vues'] as unknown[]).find((x) => estObj(x) && x['vue'] === vue);
  if (!estObj(v) || !Array.isArray(v['formats'])) return null;
  const f = (v['formats'] as unknown[]).find((x) => estObj(x) && x['format'] === 'web_16_9');
  return estObj(f) ? texte(f['chemin']) : null;
}

function originalHd(r: Obj, vue: string): string | null {
  const lc = r['livraison_commerciale'];
  if (!estObj(lc) || !Array.isArray(lc['vues'])) return null;
  const v = (lc['vues'] as unknown[]).find((x) => estObj(x) && x['vue'] === vue);
  if (!estObj(v) || !Array.isArray(v['formats'])) return null;
  // L'original « avec mention » est celui livré au client (la version sans mention reste dans le ZIP de livraison du travail).
  const f = (v['formats'] as unknown[]).find((x) => estObj(x) && x['format'] === 'original');
  return estObj(f) ? texte(f['chemin']) : null;
}

/** Chemins `*_path` (récursif, profondeur bornée) d'un résultat, pour les plans. */
function cheminsPlans(r: unknown, profondeur = 0, acc: { cle: string; chemin: string }[] = []): { cle: string; chemin: string }[] {
  if (profondeur > 4 || !estObj(r)) return acc;
  for (const [k, v] of Object.entries(r)) {
    if (k === 'rapport_assets' || k === 'avertissements') continue;
    if (typeof v === 'string' && /_path$/.test(k)) acc.push({ cle: k, chemin: v });
    else if (estObj(v)) cheminsPlans(v, profondeur + 1, acc);
  }
  return acc;
}

function genrePlan(cle: string, chemin: string): GenreFichier | null {
  const e = ext(chemin);
  if (e === 'ifc') return 'plan_ifc';
  if (e === 'dxf' || (e === 'zip' && /dxf/i.test(cle + chemin))) return 'plan_dxf';
  if (e === 'pdf') return 'plan_pdf';
  if (e === 'png' && (/plan|apercu/i.test(cle) || /plan/i.test(chemin))) return 'plan_apercu';
  return null;
}

/** Choix des livrables. Les travaux non terminés, en échec ou sans résultat sont ignorés. */
export function collecterLivrables(travaux: readonly TravailDossier[]): ManifesteDossier {
  const termines = travaux.filter((t) => t.statut === 'termine' && estObj(t.resultat)).slice().sort(parDateDesc);
  const utilises = new Set<string>();

  // Images : une par vue, la plus récente ; qualité finale d'abord ; jamais une « photo requise » ni un aperçu s'il
  // existe mieux. Les vues extérieures d'abord (ordre du catalogue), puis les intérieures.
  type Cand = { vue: string; libelle: string; chemin: string; apercu: string | null; famille: 'exterieur' | 'interieur'; qualiteFinale: boolean; job: string };
  const parVue = new Map<string, Cand>();
  for (const t of termines.filter((x) => x.type === 'image')) {
    const r = t.resultat as Obj;
    if (r['photo_requise'] === true) continue;
    const finale = r['qualite'] !== 'apercu';
    const imgs = Array.isArray(r['images']) ? (r['images'] as unknown[]).filter(estObj) : [];
    for (const im of imgs) {
      const vue = texte(im['vue']);
      const chemin = (vue && originalHd(r, vue)) ?? texte(im['jpeg_path']) ?? texte(im['png_path']);
      if (!vue || !chemin) continue;
      const deja = parVue.get(vue);
      if (deja && (deja.qualiteFinale || !finale)) continue;
      parVue.set(vue, {
        vue, libelle: texteClient(texte(im['libelle'])) ?? vue.replace(/_/g, ' '), chemin, apercu: apercuWeb(r, vue) ?? texte(im['jpeg_path']),
        famille: im['famille'] === 'interieur' ? 'interieur' : 'exterieur', qualiteFinale: finale, job: t.id,
      });
    }
  }
  const cands = [...parVue.values()].sort((a, b) => (a.famille === b.famille ? 0 : a.famille === 'exterieur' ? -1 : 1));
  const images: FichierDossier[] = cands.map((c, i) => {
    utilises.add(c.job);
    return {
      bucket: BUCKET_RENDUS_DOSSIER, chemin: c.chemin, genre: 'image', libelle: c.libelle, famille: c.famille,
      nomZip: `02-Images-HD/${deux(i + 1)}-${nomFichierSur(c.libelle)}.${ext(c.chemin) || 'jpg'}`,
      ...(c.apercu ? { cheminApercu: c.apercu } : {}),
    };
  });
  const exterieures = images.filter((i) => i.famille !== 'interieur');
  const perspective = VUES_COUVERTURE.map((v) => images.find((i) => cands[images.indexOf(i)]?.vue === v)).find(Boolean)
    ?? exterieures[0] ?? null;

  // Film : le plus récent en qualité finale, sinon le plus récent (signalé « aperçu »).
  const films = termines.filter((t) => t.type === 'film' && texte((t.resultat as Obj)['video_path']));
  const filmT = films.find((t) => (t.resultat as Obj)['qualite'] !== 'apercu') ?? films[0] ?? null;
  let film: ManifesteDossier['film'] = null;
  if (filmT) {
    const r = filmT.resultat as Obj;
    utilises.add(filmT.id);
    const affiche = texte(r['poster_path']);
    film = {
      fichier: { bucket: BUCKET_RENDUS_DOSSIER, chemin: texte(r['video_path'])!, genre: 'film', libelle: 'Film du projet', nomZip: '01-Film/film-du-projet.mp4' },
      affiche: affiche ? { bucket: BUCKET_RENDUS_DOSSIER, chemin: affiche, genre: 'affiche', libelle: 'Affiche du film', nomZip: '01-Film/affiche-du-film.jpg' } : null,
      dureeS: nombre(r['duree_s']), apercu: r['qualite'] === 'apercu',
    };
  }

  // Visite 360° : lien public permanent.
  const visites = termines.filter((t) => t.type === 'visite360' && texte((t.resultat as Obj)['visite_id']));
  const visiteT = visites.find((t) => (t.resultat as Obj)['qualite'] !== 'apercu') ?? visites[0] ?? null;
  const visite = visiteT ? { visiteId: texte((visiteT.resultat as Obj)['visite_id'])!, apercu: (visiteT.resultat as Obj)['qualite'] === 'apercu' } : null;
  if (visiteT) utilises.add(visiteT.id);

  // Plans : tous les `*_path` PDF / DXF / IFC / aperçus de plan, dédoublonnés, du plus récent au plus ancien.
  const vus = new Set<string>();
  const plans: FichierDossier[] = [];
  for (const t of termines) {
    for (const { cle, chemin } of cheminsPlans(t.resultat)) {
      const g = genrePlan(cle, chemin);
      if (!g || vus.has(chemin) || mentionneTiers(chemin)) continue;
      if (g === 'plan_apercu' && t.type === 'image' && /^image-/.test(chemin.split('/').pop() ?? '')) continue;
      vus.add(chemin);
      utilises.add(t.id);
      const nom = nomFichierSur((chemin.split('/').pop() ?? 'plan').replace(/\.[^.]+$/, ''));
      const libelle = g === 'plan_ifc' ? 'Maquette IFC' : g === 'plan_dxf' ? 'Plans DXF (CAO)' : g === 'plan_apercu' ? 'Aperçu de plan' : 'Plans PDF';
      plans.push({ bucket: BUCKET_RENDUS_DOSSIER, chemin, genre: g, libelle, nomZip: `03-Plans/${deux(plans.length + 1)}-${nom}.${ext(chemin)}` });
    }
  }
  return { perspective, images, film, visite, plans, travaux: [...utilises] };
}

/** Le dossier est-il prêt ? (pur ; utilisé par le bouton du site et par l'outil de Mimmo). */
export function etatDossier(travaux: readonly TravailDossier[], m: ManifesteDossier = collecterLivrables(travaux)): EtatDossier {
  const enCours = travaux.filter((t) => t.statut === 'en_attente' || t.statut === 'en_cours').length;
  const presents: string[] = [];
  const absents: string[] = [];
  (m.images.length ? presents : absents).push(m.images.length ? `${m.images.length} image${m.images.length > 1 ? 's' : ''} HD` : 'images');
  (m.film ? presents : absents).push(m.film ? `film${m.film.dureeS ? ` (${Math.round(m.film.dureeS)} s)` : ''}` : 'film');
  (m.visite ? presents : absents).push('visite 360°');
  (m.plans.length ? presents : absents).push('plans');
  const preparable = m.images.length > 0 || m.film !== null;
  const pret = preparable && enCours === 0;
  const phrase = !preparable
    ? 'Aucun livrable terminé : le dossier client sera disponible après le premier film ou la première image.'
    : enCours > 0
      ? `${enCours} rendu${enCours > 1 ? 's' : ''} encore en cours : le dossier peut déjà être préparé, mais il sera plus complet ensuite.`
      : `Dossier prêt : ${presents.join(', ')}${absents.length ? ` (non inclus : ${absents.join(', ')})` : ''}.`;
  return { preparable, pret, presents, absents, enCours, phrase };
}

const m2 = (v: number): string => `${Math.round(v).toLocaleString('fr-FR').replace(/ | /g, ' ')} m²`;

/** Lignes « Programme » (libellé, valeur). Une surface absente est « à confirmer », jamais estimée. */
export function lignesProgramme(p: ProgrammeDossier): [string, string][] {
  const l: [string, string][] = [];
  l.push(['Surface de plancher (SDP)', p.sdp_m2 ? m2(p.sdp_m2) : 'à confirmer']);
  l.push(['Surface habitable (SHAB)', p.shab_m2 ? m2(p.shab_m2) : 'à confirmer']);
  if (p.logements) l.push(['Logements', String(p.logements)]);
  if (p.gabarit) l.push(['Gabarit', p.gabarit]);
  if (p.batiments) l.push(['Bâtiments', String(p.batiments)]);
  if (p.emprise_m2) l.push(['Emprise bâtie', m2(p.emprise_m2)]);
  if (p.surface_parcelle_m2) l.push(['Surface du terrain', m2(p.surface_parcelle_m2)]);
  return l;
}

/** Programme lu dans `studio_preparations.resume` (dernière préparation de la conversation). */
export function programmeDepuisResume(resume: unknown, extra: Partial<ProgrammeDossier> = {}): ProgrammeDossier {
  const r = estObj(resume) ? resume : {};
  return {
    sdp_m2: nombre(r['sdp_estimee_m2']) ?? nombre(r['sdp_m2']),
    shab_m2: nombre(r['shab_m2']) ?? nombre(r['surface_habitable_m2']),
    logements: nombre(r['logements_places']) ?? nombre(r['logements_vises']),
    gabarit: texte(r['gabarit']),
    batiments: nombre(r['batiments']),
    emprise_m2: nombre(r['emprise_batie_m2']),
    surface_parcelle_m2: nombre(r['surface_parcelle_m2']),
    ...extra,
  };
}

/** Notice du ZIP (LISEZMOI.txt). Aucun nom de fournisseur tiers ; mention neutre unique. */
export function noticeDossier(o: { titre: string; date: string; m: ManifesteDossier; lienFilm?: string | null; lienVisite?: string | null; nomPdf: string }): string {
  const L: string[] = [];
  L.push(`${TITRE_DOSSIER} — ${o.titre}`, `Préparé par Mimmoza le ${o.date}.`, '');
  L.push('CONTENU', `- ${o.nomPdf} : présentation du projet (perspective, programme, planches, plans, liens).`);
  if (o.m.film) L.push(`- ${o.m.film.fichier.nomZip} : film du projet (MP4, lisible sur ordinateur, téléphone et téléviseur).`);
  if (o.m.film?.affiche) L.push(`- ${o.m.film.affiche.nomZip} : image d’affiche du film.`);
  if (o.m.images.length) L.push(`- 02-Images-HD/ : ${o.m.images.length} image${o.m.images.length > 1 ? 's' : ''} en haute définition (JPEG).`);
  if (o.m.plans.length) L.push(`- 03-Plans/ : ${o.m.plans.map((p) => p.libelle).filter((v, i, t) => t.indexOf(v) === i).join(', ')}.`);
  if (o.m.visite) L.push('- 04-Visite-360/ : lien de la visite 360° (à ouvrir dans un navigateur, sur ordinateur ou téléphone).');
  L.push('');
  if (o.lienVisite) L.push(`Visite 360° : ${o.lienVisite}`);
  if (o.lienFilm) L.push(`Film en ligne (lien temporaire) : ${o.lienFilm}`);
  if (o.lienVisite || o.lienFilm) L.push('');
  L.push('UTILISATION', '- Les images et le film peuvent être utilisés pour la commercialisation du programme (plaquette, site, réseaux, panneau).',
    '- Les plans DXF s’ouvrent dans un logiciel de CAO ; la maquette IFC dans une visionneuse BIM.', '');
  L.push(`${MENTION_DOSSIER}. Perspectives et film d’ambiance : aspect, matériaux, végétation et mobilier donnés à titre indicatif ;`,
    'seuls les plans et la notice descriptive du programme ont une valeur contractuelle.');
  return L.join('\r\n') + '\r\n';
}

/** Raccourci Internet Windows (.url) vers la visite. */
export function raccourciUrl(lien: string): string {
  return `[InternetShortcut]\r\nURL=${lien}\r\n`;
}
