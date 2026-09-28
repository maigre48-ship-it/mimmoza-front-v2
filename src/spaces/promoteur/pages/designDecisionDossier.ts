import { DESIGN_CRITERIA, type DesignBrief, type DesignCriterion, type DesignDirection, type DesignSource, type StyleFamily } from './designDirections.ts';

export const CRITERION_LABELS: Record<DesignCriterion, string> = {
  cible: 'Adéquation à la cible', reglement: 'Site et règlement', confort: 'Confort et usages',
  entretien: 'Entretien et coût', evolution: 'Évolution dans le temps',
};
export const FAMILY_LABELS: Record<StyleFamily, string> = { durable: 'Durable', contemporain: 'Contemporain', expressif: 'Expressif' };
export const VERDICT_LABELS = { a_documenter: 'À documenter', favorable: 'Favorable selon pièce', defavorable: 'Défavorable selon pièce' } as const;

export function criterionReading(brief: DesignBrief, direction: DesignDirection, criterion: DesignCriterion): { proposal: string; toVerify: string } {
  switch (criterion) {
    case 'cible': return { proposal: direction.audienceFit || `Hypothèse pour ${brief.target} : ${direction.intent}`,
      toVerify: 'Faire réagir des utilisateurs représentatifs ; les statistiques de marché ne mesurent pas leurs goûts.' };
    case 'reglement': return { proposal: direction.architecture[0] || direction.intent,
      toVerify: `Vérifier le règlement écrit, le plan et les contraintes de la parcelle${brief.strategy?.pluZone ? ` en zone ${brief.strategy.pluZone}` : ''}.` };
    case 'confort': return { proposal: [direction.interiors[0], direction.architecture[0]].filter(Boolean).join(' '),
      toVerify: 'Tester lumière, acoustique, accessibilité et parcours avec les usagers et l’exploitant.' };
    case 'entretien': {
      const estimate = brief.review?.maintenance?.[direction.family];
      return { proposal: `${direction.materials.slice(0, 2).join(' · ')}. ${estimate?.annualEur && estimate.source ? `Hypothèse saisie : ${estimate.annualEur} €/an (${estimate.source}).` : 'Coût annuel non chiffré.'}`,
        toVerify: 'Faire chiffrer nettoyage, réparations et renouvellement sur le cycle de vie.' };
    }
    case 'evolution': return { proposal: direction.adaptable.join(' '),
      toVerify: `Vérifier que les éléments durables restent pertinents sur ${brief.horizonYears} ans et que le décor se renouvelle sans travaux lourds.` };
  }
}

export function documentedCriteria(brief: DesignBrief): number {
  const family = brief.selectedFamily;
  if (!family) return 0;
  return DESIGN_CRITERIA.filter((criterion) => {
    const review = brief.review?.criteria?.[family]?.[criterion];
    return review && review.verdict !== 'a_documenter' && review.evidence.trim().length >= 8;
  }).length;
}

export type StudioHandoff = { version: 1; studyId: string | null; createdAt: string; programme: string; location: string;
  direction: string; family: StyleFamily; palette: { name: string; hex: string }[]; prompt: string };
export const studioHandoffKey = (studyId: string | null) => `mimmoza.promoteur.design-handoff.${studyId ?? 'hors-etude'}`;

export function buildStudioHandoff(brief: DesignBrief, studyId: string | null): StudioHandoff | null {
  const direction = brief.directions.find((item) => item.family === brief.selectedFamily);
  if (!direction) return null;
  const prompt = [
    `Brief esthétique provisoire pour un projet de ${brief.programme} à ${brief.location}.`,
    `Direction ${direction.title}. ${direction.intent}`,
    `Cible à tester : ${brief.target}.`,
    `Palette : ${direction.palette.map((item) => `${item.name} ${item.hex} pour ${item.use}`).join(' ; ')}.`,
    `Façade et architecture : ${direction.architecture.join(' ')}`,
    `Matériaux à illustrer : ${direction.materials.join(' ; ')}.`,
    brief.review?.architectNotes ? `Consignes de l'architecte : ${brief.review.architectNotes}.` : '',
    brief.adjustments ? `Ajustements du porteur : ${brief.adjustments}.` : '',
    'Conserver strictement le gabarit, les niveaux et la géométrie de la maquette de référence. Ce brief ne valide ni le PLU ni la faisabilité.',
  ].filter(Boolean).join(' ').slice(0, 1800);
  return { version: 1, studyId, createdAt: new Date().toISOString(), programme: brief.programme, location: brief.location,
    direction: direction.title, family: direction.family, palette: direction.palette.map(({ name, hex }) => ({ name, hex })), prompt };
}

export function parseStudioHandoff(raw: string | null, studyId: string | null): StudioHandoff | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StudioHandoff>;
    const age = typeof value.createdAt === 'string' ? Date.now() - Date.parse(value.createdAt) : Number.NaN;
    return value.version === 1 && value.studyId === studyId && typeof value.prompt === 'string' && value.prompt.length >= 100 && value.prompt.length <= 1800
      && typeof value.direction === 'string' && Number.isFinite(age) && age >= 0 && age < 7 * 86400000 ? value as StudioHandoff : null;
  } catch { return null; }
}

const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const link = (value: string): string => { try { return new URL(value).protocol === 'https:' ? value : ''; } catch { return ''; } };
const paragraph = (value: string | null | undefined) => value ? `<p>${escape(value)}</p>` : '';
const list = (items: string[]) => `<ul>${items.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>`;

/** Fichier autonome à imprimer en PDF ou à annoter avec l'équipe projet. */
export function designDossierHtml(brief: DesignBrief, sources: DesignSource[]): string {
  const selected = brief.directions.find((direction) => direction.family === brief.selectedFamily);
  const review = brief.review;
  const comparison = `<table><thead><tr><th>Critère</th>${brief.directions.map((direction) => `<th>${escape(direction.title)}</th>`).join('')}</tr></thead><tbody>${DESIGN_CRITERIA.map((criterion) => `<tr><th>${escape(CRITERION_LABELS[criterion])}</th>${brief.directions.map((direction) => {
    const item = criterionReading(brief, direction, criterion);
    return `<td>${escape(item.proposal)}<small>À vérifier : ${escape(item.toVerify)}</small></td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
  const assessments = selected ? DESIGN_CRITERIA.map((criterion) => {
    const item = review?.criteria?.[selected.family]?.[criterion];
    return `<tr><th>${escape(CRITERION_LABELS[criterion])}</th><td>${escape(item ? VERDICT_LABELS[item.verdict] : 'À documenter')}</td><td>${escape(item?.evidence || 'Pièce ou avis à obtenir')}</td></tr>`;
  }).join('') : '';
  const references = sources.filter((source) => selected?.sourceIds.includes(source.id));
  const studio = buildStudioHandoff(brief, null);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dossier de conception · ${escape(brief.programme)}</title><style>
    @page{size:A4;margin:16mm}body{font:14px/1.5 Arial,sans-serif;color:#1e293b;margin:0 auto;max-width:1020px;padding:30px}h1{font-size:30px;color:#312e81;margin:6px 0}h2{font-size:20px;color:#312e81;border-bottom:2px solid #c7d2fe;padding-bottom:5px;margin-top:30px}h3{font-size:16px}p{margin:8px 0}.eyebrow{text-transform:uppercase;letter-spacing:.15em;color:#6366f1;font-size:11px;font-weight:bold}.meta{color:#475569}.notice{background:#fff7ed;border-left:4px solid #f59e0b;padding:12px;margin:20px 0}.card{border:1px solid #cbd5e1;border-radius:10px;padding:15px;margin:15px 0;break-inside:avoid}.palette{display:flex;gap:8px}.swatch{width:130px;height:50px;border:1px solid #cbd5e1;border-radius:6px}table{width:100%;border-collapse:collapse;margin:14px 0;font-size:12px}th,td{border:1px solid #cbd5e1;padding:9px;vertical-align:top;text-align:left}th{background:#eef2ff}small{display:block;color:#64748b;margin-top:6px}a{color:#3730a3;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f1f5f9;padding:12px;font:11px/1.4 Arial,sans-serif}@media print{body{padding:0}.card,table tr{break-inside:avoid}}
  </style></head><body><div class="eyebrow">Mimmoza · Promoteur · dossier de conception</div><h1>${escape(brief.programme)} · ${escape(brief.location)}</h1>
  <p class="meta">Cible à tester : ${escape(brief.target)} · Horizon : ${escape(brief.horizonYears)} ans · Établi le ${escape(new Date(brief.generatedAt).toLocaleDateString('fr-FR'))}</p>
  <div class="notice">Document de travail. Les palettes et croquis sont des hypothèses ; aucun droit à construire, coût, niveau de demande ou intérêt d'exploitant n'est validé par ce dossier.</div>
  <h2>1. Cadrage et réponses</h2>${paragraph(brief.strategy?.programmeDetail ? `Programme déclaré : ${brief.strategy.programmeDetail}` : '')}
  ${brief.questionnaire?.length ? list(brief.questionnaire.map((item) => `${item.question} — ${item.answer}`)) : '<p>Questionnaire non renseigné.</p>'}
  <h2>2. Trois directions comparées</h2>${brief.directions.map((direction) => `<div class="card"><h3>${escape(direction.title)} · ${escape(FAMILY_LABELS[direction.family])}</h3>${paragraph(direction.intent)}${paragraph(direction.audienceFit)}<div class="palette">${direction.palette.map((item) => `<div><div class="swatch" style="background:${/^#[0-9a-fA-F]{6}$/.test(item.hex) ? item.hex : '#ddd'}"></div><small>${escape(item.name)} · ${escape(item.use)}</small></div>`).join('')}</div><p><b>Architecture :</b> ${escape(direction.architecture.join(' '))}</p><p><b>Intérieurs :</b> ${escape(direction.interiors.join(' '))}</p><p><b>Matériaux :</b> ${escape(direction.materials.join(' ; '))}</p><p><b>Vigilance :</b> ${escape(direction.vigilance)}</p></div>`).join('')}
  <h2>3. Arbitrage par critères</h2>${comparison}<p>Les coûts annuels sont indiqués seulement lorsqu'une hypothèse et sa source ont été saisies. Aucun score global n'est calculé.</p>
  <h2>4. Piste retenue et validation</h2><p><b>Direction :</b> ${escape(selected?.title || 'Aucune direction encore choisie')}</p><p><b>Motif du choix :</b> ${escape(review?.selectionReason || 'À préciser')}</p>
  ${selected ? `<table><thead><tr><th>Critère</th><th>Avis déclaré</th><th>Pièce ou constat</th></tr></thead><tbody>${assessments}</tbody></table>` : ''}
  ${selected ? `<p><b>Entretien annuel :</b> ${review?.maintenance?.[selected.family]?.annualEur && review?.maintenance?.[selected.family]?.source ? `${escape(review.maintenance[selected.family]!.annualEur)} €/an · Source : ${escape(review.maintenance[selected.family]!.source)}` : 'Non chiffré — estimation et source à obtenir'}</p>` : ''}
  <h2>5. Instructions par destinataire</h2><h3>Architecte</h3>${paragraph(review?.architectNotes || 'Vérifier implantation, règlement opposable, structure, enveloppe, confort et matérialité avant de figer le projet.')}
  <h3>Exploitant et utilisateurs</h3>${paragraph(review?.operatorNotes || 'Tester les parcours, l’entretien, les services et le renouvellement des espaces avec un exploitant et des usagers représentatifs.')}
  <h3>Test auprès de la cible</h3>${paragraph(review?.userTestNotes || 'Comparer les trois ambiances avec des personnes représentatives de la cible ; enregistrer leurs objections et préférences.')}
  <h3>Visuels / Mimmoza Studio</h3><pre>${escape(studio?.prompt || 'Choisir une direction pour préparer le brief visuel.')}</pre>
  <h2>6. Pièces et sources à conserver</h2>${brief.strategy?.facts.length ? list(brief.strategy.facts.map((fact) => `${fact.label} : ${fact.value} · ${fact.scope} · ${fact.source} · ${fact.url}`)) : '<p>Aucune mesure locale sourcée dans ce scénario.</p>'}
  ${brief.strategy?.pluZone ? paragraph(`Zone relevée : ${brief.strategy.pluZone}. Le règlement écrit et les servitudes restent à vérifier. ${brief.strategy.pluSource || ''}`) : ''}
  <p><b>Références d'inspiration de la piste retenue :</b></p>${references.length ? `<ul>${references.map((source) => `<li>${escape(source.title)} · ${escape(source.scope)} · ${link(source.url) ? `<a href="${escape(source.url)}">${escape(source.url)}</a>` : 'lien non vérifié'}</li>`).join('')}</ul>` : '<p>Aucune référence propre à une piste retenue.</p>'}
  ${brief.checks?.length ? `<p><b>Vérifications proposées par l'IA :</b></p>${list(brief.checks)}` : ''}
  <p class="meta">Ce dossier est une synthèse d'hypothèses. Faire valider les données, le PLU, le budget et la demande propre au projet par les professionnels compétents.</p></body></html>`;
}
