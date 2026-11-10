// interior-architect-v1/resume.ts
// Textes de la réponse (PURS). Règle de lisibilité de Mimmo : la réponse
// d'abord, des retours à la ligne, des tirets ; jamais une suite de numéros
// dans un paragraphe. Rien n'est inventé : chaque phrase reprend une donnée du
// moteur (rapport, feuille de style, points d'eau) ou dit qu'elle manque.

import type { InteriorBrief, PlanInput, Verdict } from './moteur/types.ts';
import type { ResultatVariantes, Variante } from './pipeline.ts';

export const LIBELLE_VERDICT: Record<Verdict, string> = {
  favorable: 'favorable',
  reserve: 'favorable avec réserves',
  defavorable: 'défavorable',
};

const pct = (x: number) => `${Math.round(x * 100)} %`;
const nomPiece = (plan: PlanInput, id: string) => plan.rooms.find((r) => r.id === id)?.name ?? id;
const uniq = (xs: string[]) => [...new Set(xs)];
/** Nombre à la française (virgule décimale). */
export const fr = (x: number) => String(x).replace('.', ',');
const PREFIXE_MATERIAU = 'Matériau absent de la bibliothèque : ';

export interface Choix { titre: string; choix: string; justification: string }

/** Les trois choix principaux de la variante, chacun avec la justification que porte le moteur. */
export function choixPrincipaux(v: Variante): Choix[] {
  const f = v.feuilleDeStyle;
  const p = f.palette;
  const hypStyle = f.assumptions.find((a) => a.startsWith('Style')) ?? 'choix de direction artistique du moteur (hypothèse Mimmoza 2026)';
  const hypSol = f.assumptions.find((a) => a.startsWith('Sol continu'))
    ?? 'revêtements attribués par type de pièce (sec / humide) par le moteur de style';
  const solSec = f.rooms.find((r) => r.typeSol === 'sec')?.sol.label ?? null;
  const solHumide = f.rooms.find((r) => r.typeSol === 'humide')?.sol.label ?? null;
  const sols = [
    solSec ? `pièces sèches : ${solSec}` : null,
    solHumide ? `pièces humides : ${solHumide}` : null,
  ].filter((x): x is string => x !== null);
  return [
    {
      titre: 'Direction artistique',
      choix: `${f.nom}, gamme ${f.gamme} — palette ${p.dominante.nom} ${pct(p.dominante.part)}, ${p.secondaire.nom} ${pct(p.secondaire.part)}, ${p.accent.nom} ${pct(p.accent.part)}`,
      justification: hypStyle,
    },
    {
      titre: 'Sols',
      choix: sols.length ? sols.join(' ; ') : 'aucun revêtement de sol attribué (donnée absente de la feuille de style)',
      justification: hypSol,
    },
    {
      titre: 'Bois, métal et lumière',
      choix: `bois ${f.qualiteBois} (essence ${f.essencePrincipale}), métal ${f.metal.nom}, lumière ${f.lumiereK} K`,
      justification: 'une seule essence de bois pour tout le mobilier du logement et une température de lumière unique (règles de cohérence du moteur de style)',
    },
  ];
}

export interface VerdictPiece { pieceId: string; piece: string; verdict: Verdict; bloquantes: string[] }

export function verdictsParPiece(plan: PlanInput, v: Variante): VerdictPiece[] {
  return v.rapport.rooms.map((r) => ({
    pieceId: r.roomId,
    piece: nomPiece(plan, r.roomId),
    verdict: r.verdict,
    bloquantes: v.rapport.violations.filter((x) => x.roomId === r.roomId && x.severity === 'bloquante').map((x) => `[${x.ruleId}] ${x.message}`),
  }));
}

/** Violations bloquantes qui ne sont rattachées à aucune pièce évaluée (logement entier : circulations, PMR…). */
export function bloquantesLogement(v: Variante): string[] {
  const pieces = new Set(v.rapport.rooms.map((r) => r.roomId));
  return uniq(v.rapport.violations
    .filter((x) => x.severity === 'bloquante' && (x.roomId === null || !pieces.has(x.roomId)))
    .map((x) => `[${x.ruleId}] ${x.message}`));
}

/** Manques de la variante : données absentes, éléments non placés, matériaux de repli, règles non vérifiables. */
export function manquesVariante(plan: PlanInput, v: Variante): string[] {
  return uniq([
    ...v.rapport.missing,
    ...v.layout.unplaced.map((u) => `${nomPiece(plan, u.roomId)} : « ${u.specId} » non placé — ${u.reason}`),
    ...v.rapport.rulesSkipped.map((s) => `Règle ${s.ruleId} non vérifiée : ${s.reason}`),
    ...v.feuilleDeStyle.manques.map((m) => `${PREFIXE_MATERIAU}${m}`),
  ]);
}

const liste = (xs: string[], max: number) => {
  const l = xs.slice(0, max).map((x) => `- ${x}`);
  if (xs.length > max) l.push(`- … et ${xs.length - max} autre(s), détail dans la réponse complète`);
  return l;
};

/** Résumé texte de la réponse (affichable tel quel, ou transmis au LLM). */
export function resumeTexte(plan: PlanInput, brief: InteriorBrief, r: ResultatVariantes): string {
  const best = r.variantes[0];
  if (!best) return 'Aucune variante n\'a pu être calculée.';
  const l: string[] = [];
  l.push(`${best.libelle} recommandée : verdict ${LIBELLE_VERDICT[best.verdict]} (score de tri ${fr(best.score)}/100), sur ${r.variantes.length} variante(s) calculée(s) pour « ${plan.label} » (${plan.typology}, ${plan.kind} ${plan.construction}).`);
  l.push('');
  l.push('Verdict par pièce :');
  for (const p of verdictsParPiece(plan, best)) {
    l.push(`- ${p.piece} : ${LIBELLE_VERDICT[p.verdict]}${p.bloquantes.length ? ` — ${p.bloquantes.join(' ; ')}` : ''}`);
  }
  const bl = bloquantesLogement(best);
  if (bl.length) {
    l.push('');
    l.push('Points bloquants du logement :');
    l.push(...liste(bl, 6));
  }
  l.push('');
  l.push('Choix principaux :');
  for (const c of choixPrincipaux(best)) l.push(`- ${c.titre} : ${c.choix}. Pourquoi : ${c.justification}`);
  if (best.pointsEauSupposes.length) {
    l.push('');
    l.push('Points d\'eau supposés (à confirmer) :');
    for (const p of best.pointsEauSupposes) l.push(`- ${p.piece} : ${p.raison}`);
  }
  const tous = manquesVariante(plan, best);
  const materiaux = tous.filter((m) => m.startsWith(PREFIXE_MATERIAU));
  const manques = [
    ...tous.filter((m) => !m.startsWith(PREFIXE_MATERIAU)),
    ...(materiaux.length ? [`${materiaux.length} matériau(x) absent(s) de la bibliothèque du Studio, remplacé(s) par un matériau voisin (liste dans la réponse complète)`] : []),
  ];
  if (manques.length) {
    l.push('');
    l.push('Manques et limites :');
    l.push(...liste(manques, 8));
  }
  if (r.variantes.length > 1) {
    l.push('');
    l.push('Autres variantes :');
    for (const v of r.variantes.slice(1)) l.push(`- ${v.libelle} (graine ${v.seed}) : ${LIBELLE_VERDICT[v.verdict]}, score ${fr(v.score)}/100`);
  }
  if (r.ecartees.length) {
    l.push('');
    l.push('Variantes non retenues :');
    for (const e of r.ecartees) l.push(`- graine ${e.seed} : ${e.motif}`);
  }
  l.push('');
  l.push(`Brief appliqué : ${brief.target}, ${brief.occupants.adults} adulte(s) et ${brief.occupants.children} enfant(s), style ${brief.style}, gamme ${brief.gamme}${brief.constraints.teletravail ? ', télétravail' : ''}${brief.constraints.pmr ? ', PMR' : ''}.`);
  l.push('Aucune cloison n\'est déplacée : seuls le mobilier, les matériaux et les luminaires sont proposés.');
  return l.join('\n');
}

// ── Description seule : on comprend, on n'invente pas ─────────

export interface DescriptionComprise { typologie: string | null; surface_m2: number | null }

export function lireDescription(d: string): DescriptionComprise {
  const t = /\b(studio|[TF]\s?[1-9])\b/i.exec(d);
  const s = /(\d{1,4}(?:[.,]\d{1,2})?)\s*m(?:²|2|ètres?\s+carrés?)/i.exec(d);
  const typologie = t ? (t[1]!.toLowerCase() === 'studio' ? 'studio' : `T${t[1]!.replace(/\s/g, '').slice(1)}`) : null;
  const surface = s ? Number(s[1]!.replace(',', '.')) : null;
  return { typologie, surface_m2: surface !== null && Number.isFinite(surface) && surface > 0 ? surface : null };
}

export const COMMENT_OBTENIR_UN_PLAN = [
  'Ouvrir MimmozIA Studio et générer le plan du logement, ou y faire lire un plan existant : le Studio produit les pièces, les cloisons et les ouvertures dont l\'architecte d\'intérieur a besoin.',
  'Ou fournir directement un plan structuré au format PlanInput (pièces en polygones, murs, portes et fenêtres, en mètres).',
  'Une image de plan seule ne suffit pas encore depuis le chat : sa lecture en plan structuré se fait dans le Studio.',
];

export function texteRefusDescription(c: DescriptionComprise): string {
  const compris = [c.typologie, c.surface_m2 !== null ? `${String(c.surface_m2).replace('.', ',')} m²` : null].filter(Boolean).join(', ');
  return [
    `Je ne peux pas aménager ce logement sans son plan${compris ? ` (compris : ${compris})` : ''}.`,
    '',
    'Pourquoi :',
    '- une typologie et une surface ne disent ni la forme des pièces, ni la place des portes et des fenêtres, ni celle des murs ;',
    '- un plan deviné donnerait un aménagement faux, présenté comme vrai : Mimmoza n\'en invente pas.',
    '',
    'Comment obtenir le plan :',
    ...COMMENT_OBTENIR_UN_PLAN.map((x) => `- ${x}`),
  ].join('\n');
}

export function texteRefusRoomPlan(): string {
  return [
    'Ce plan est au format interne du Studio (roomPlan) : cette fonction ne le convertit pas elle-même.',
    '',
    '- La conversion vers le plan du moteur (PlanInput) vit dans MimmozIA Studio (adaptateur INT-09a) ;',
    '- il faut envoyer ici le plan déjà converti (champ « plan »), ou lancer l\'aménagement depuis le Studio.',
  ].join('\n');
}
