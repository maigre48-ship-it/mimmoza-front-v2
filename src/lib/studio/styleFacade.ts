// src/lib/studio/styleFacade.ts
// =============================================================================
// VIS-71 (27/11/2026) — STYLE DE FAÇADE (kit VIS-65 du Studio) côté site et chat Mimmoza. Module PUR (site + Edge, Deno).
//
// PORTAGE (pas une copie octet pour octet) de mimmozia-studio › src/core/kitFacade/langage.ts (`styleDepuisTexte`,
// `commandeStyleFacade`) et de la liste des 7 styles de src/core/kitFacade/styles.ts : mêmes identifiants, mêmes motifs,
// mêmes libellés. Le Studio reste la référence : un style ajouté là-bas doit l'être ici (test vis71StyleFacade.test.ts).
//
// Transport : `fiche.habillage_batiments.details.style_facade` (identifiant du kit), lu par le worker du Studio
// (worker/etapes/scene.mts › styleFacadeDuBrief). Deux sources, la plus RÉCENTE l'emporte :
//   · la carte « Habiller le projet », thème Matières (trace copilot_action_runs, champ `style_facade`) ;
//   · une phrase du chat (« passe la façade en contemporain bois et zinc »), relue dans les messages de l'utilisateur.
// « Laisser Mimmo choisir » n'écrit AUCUN style : le Studio garde alors le style du dessin, sinon « contemporain sobre ».
// =============================================================================

export interface StyleFacadeKit {
  readonly id: string;
  readonly libelle: string;
  /** Une phrase pour la carte et la réponse de Mimmo. */
  readonly description: string;
  /** Matières encore incomplètes au Studio : proposé, mais marqué « aperçu ». */
  readonly apercu?: true;
}

/** Les 7 styles du kit (ordre d'affichage). Descriptions reprises de styles.ts (Studio). */
export const STYLES_FACADE_KIT: readonly StyleFacadeKit[] = [
  { id: 'contemporain_sobre', libelle: 'contemporain sobre',
    description: 'Matières du dessin gardées ; menuiseries aluminium profondes, bavettes, couvertines, nez de dalle et garde-corps détaillés.' },
  { id: 'contemporain_bois_zinc', libelle: 'contemporain bois et zinc',
    description: 'Bardage bois vertical à couvre-joints, volumes secondaires et dernier niveau en zinc à joints debout, menuiseries aluminium noir profondes, garde-corps verre, sous-faces bois.' },
  { id: 'neo_basque', libelle: 'néo-basque',
    description: 'Enduit blanc, soubassement de pierre, encadrements de pierre, menuiseries bois peint à petits-bois, appuis de pierre, garde-corps bois.' },
  { id: 'haussmannien_moderne', libelle: 'haussmannien moderne',
    description: 'Pierre de taille, bandeaux à chaque niveau et corniche, menuiseries bois peint blanc, appuis de pierre, garde-corps en ferronnerie.' },
  { id: 'mediterraneen', libelle: 'méditerranéen',
    description: 'Enduit clair, génoise sous les égouts, menuiseries bois, appuis de pierre, garde-corps en ferronnerie fine, soubassement de pierre.' },
  { id: 'beton_brut', libelle: 'béton brut', apercu: true,
    description: 'Béton banché à joints de banche, menuiseries aluminium noir très profondes à cadre de béton saillant, casquettes, nez de dalle épais, garde-corps en tôle.' },
  { id: 'traditionnel_sobre', libelle: 'traditionnel sobre',
    description: 'Matières du dessin gardées ; menuiseries bois peint, appuis de pierre, garde-corps en barreaudage.' },
];

/** Style gardé par « Laisser Mimmo choisir » (aucun style écrit : défaut du Studio). */
export const STYLE_FACADE_DEFAUT = 'contemporain_sobre';
/** Mention provisoire du style dont les matières sont incomplètes au Studio. */
export const MENTION_APERCU_STYLE = '(aperçu, matières incomplètes)';

export const IDS_STYLES_FACADE: ReadonlySet<string> = new Set(STYLES_FACADE_KIT.map((s) => s.id));
export const estStyleFacade = (v: unknown): v is string => typeof v === 'string' && IDS_STYLES_FACADE.has(v);
export function styleFacadeKit(id: string): StyleFacadeKit | null { return STYLES_FACADE_KIT.find((s) => s.id === id) ?? null; }

/** « contemporain bois et zinc », « béton brut (aperçu, matières incomplètes) ». */
export function libelleStyleFacade(id: string): string {
  const s = styleFacadeKit(id);
  if (!s) return id;
  return s.apercu ? `${s.libelle} ${MENTION_APERCU_STYLE}` : s.libelle;
}

const sansAccents = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’]/g, "'");

/** « Façade telle que dessinée » : le kit ne pose rien (jamais transmis par le chat). */
export const STYLE_TEL_QUE_DESSINE = 'tel_que_dessine';

/** Motifs du Studio (langage.ts), dans le même ordre : le premier qui correspond l'emporte. */
const MOTIFS: readonly [RegExp, string][] = [
  [/\b(sans kit|tel(le)? que dessine(e)?|sans habillage)\b/, STYLE_TEL_QUE_DESSINE],
  [/\b(beton brut|brutalis\w*|beton banche|beton apparent)\b/, 'beton_brut'],
  [/\b(haussmann\w*|pierre de taille|parisien)\b/, 'haussmannien_moderne'],
  [/\b(neo[- ]?basque|basque|labourdin)\b/, 'neo_basque'],
  [/\b(mediterran\w*|provencal\w*|proven[cs]e|genoise|sud)\b/, 'mediterraneen'],
  [/\b(bois (et|&) zinc|zinc (et|&) bois|bardage bois|ossature bois|bois et metal|metal patine|corten)\b/, 'contemporain_bois_zinc'],
  [/\b(contemporain|moderne)\b.*\b(bois|zinc)\b|\b(bois|zinc)\b.*\b(contemporain|moderne)\b/, 'contemporain_bois_zinc'],
  [/\b(traditionnel|classique|regional)\b/, 'traditionnel_sobre'],
  [/\b(sobre|epure|minimal\w*|contemporain|moderne)\b/, 'contemporain_sobre'],
];

/** Texte libre → identifiant de style du kit (ou STYLE_TEL_QUE_DESSINE), null si rien ne correspond. Pur. */
export function styleDepuisTexte(texte: string | null | undefined): string | null {
  if (!texte) return null;
  const t = sansAccents(String(texte)).replace(/[_-]+/g, ' ');
  const direct = STYLES_FACADE_KIT.find((s) => t.trim() === s.id.replace(/_/g, ' ') || t.trim() === sansAccents(s.libelle).replace(/[_-]+/g, ' '));
  if (direct) return direct.id;
  for (const [re, id] of MOTIFS) if (re.test(t)) return id;
  return null;
}

/** Commande de chat (motif du Studio) : « style de façade : béton brut », « passe la façade en néo-basque », « /style … ». */
const COMMANDE = /(?:^\s*\/style\b|\bstyle\s+(?:de\s+)?(?:la\s+)?fa[cç]ade\b|\bfa[cç]ade\s+(?:en|style|fa[cç]on)\b|\bhabill\w*\s+(?:la\s+)?fa[cç]ade\b|\bpasse[rz]?\s+(?:la\s+)?fa[cç]ade\b)/i;

export interface CommandeStyleFacade {
  readonly style: StyleFacadeKit;
  /** Phrase de confirmation (Mimmo la reprend). */
  readonly reponse: string;
}

/** Message du chat → style de façade demandé, ou null. Pur. Les blocs de code (cartes) sont ignorés. */
export function commandeStyleFacade(message: string | null | undefined): CommandeStyleFacade | null {
  if (!message) return null;
  const texte = message.replace(/```[\s\S]*?```/g, ' ');
  if (!COMMANDE.test(texte)) return null;
  const id = styleDepuisTexte(texte.replace(/^\s*\/style\b/i, ''));
  if (!id || id === STYLE_TEL_QUE_DESSINE) return null;
  const style = styleFacadeKit(id);
  if (!style) return null;
  return {
    style,
    reponse: `Façade en style « ${libelleStyleFacade(style.id)} » : ${style.description} Les volumes et les ouvertures du projet ne bougent pas ; appliqué au prochain rendu.`,
  };
}

export interface StyleDate { readonly id: string; readonly le: string; readonly source: 'carte' | 'chat' }

/** Dernière demande de style dans les messages de l'utilisateur (plus récents d'abord ou non : trié ici). Pur. */
export function styleDuChat(messages: readonly { texte: string; cree_le: string }[]): StyleDate | null {
  const tries = [...messages].filter((m) => Number.isFinite(Date.parse(m.cree_le))).sort((a, b) => Date.parse(b.cree_le) - Date.parse(a.cree_le));
  for (const m of tries) {
    const c = commandeStyleFacade(m.texte);
    if (c) return { id: c.style.id, le: new Date(Date.parse(m.cree_le)).toISOString(), source: 'chat' };
  }
  return null;
}

/** Style retenu : le plus récent de la carte et du chat ; null si aucun (le Studio garde son défaut). Pur. */
export function styleFacadeRetenu(carte: { id: string; le: string } | null | undefined, chat: StyleDate | null | undefined): StyleDate | null {
  const c = carte && estStyleFacade(carte.id) && Number.isFinite(Date.parse(carte.le)) ? { id: carte.id, le: carte.le, source: 'carte' as const } : null;
  const m = chat && estStyleFacade(chat.id) ? chat : null;
  if (!c) return m;
  if (!m) return c;
  return Date.parse(m.le) > Date.parse(c.le) ? m : c;
}

/**
 * Fiche du travail avec le style (liste blanche) : `habillage_batiments.details.style_facade`, sans rien retirer de
 * l'habillage existant (clauses, balcons, détails du brief). Style inconnu : fiche inchangée. Pur.
 */
export function ficheAvecStyleFacade<F extends Record<string, unknown>>(fiche: F, id: string | null | undefined): F {
  if (!estStyleFacade(id)) return fiche;
  const h = fiche.habillage_batiments;
  const base = h && typeof h === 'object' && !Array.isArray(h) ? h as Record<string, unknown> : { clauses: [], balcons: null };
  const d = base.details && typeof base.details === 'object' && !Array.isArray(base.details) ? base.details as Record<string, unknown> : {};
  return { ...fiche, habillage_batiments: { ...base, details: { ...d, style_facade: id } } };
}
