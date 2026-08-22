type UnknownRecord = Record<string, unknown>;

const FORBIDDEN_FREEFORM_PHRASES = [
  'très probable', 'proximité immédiate', 'marché actif', 'demande soutenue',
  'risques élevés', 'avenue structurante', 'rendement', 'dispersion',
  'seul document opposable', 'seul moyen',
] as const;

function neutralizeForbidden(value: string): string {
  let safe = value;
  for (const phrase of FORBIDDEN_FREEFORM_PHRASES) {
    safe = safe.replace(new RegExp(phrase, 'giu'), 'information non restituée');
  }
  return safe;
}

const SECTION_BY_EVIDENCE_ID: Record<string, 1 | 2 | 3 | 4> = {
  surface_cadastrale: 1,
  servitudes: 2, monument_historique: 2, reglement_plu: 2, classement_sonore: 2,
  risque_inondation: 2, risque_argiles: 2, risque_sismique: 2, risque_radon: 2,
  risque_cavites: 2, risque_mouvements_terrain: 2, risque_icpe: 2,
  risque_seveso: 2, risque_sis: 2, risque_feux_foret: 2, risque_catnat: 2,
  risque_ppr: 2, score_securite: 2,
  altitude: 3, pente: 3, assainissement: 3, potentiel_solaire: 3,
  zonage_abc: 4, fiscalite_tfb: 4, loyers_reference: 4, dvf_prix_m2: 4,
};

const SECTION_TITLES: Record<1 | 2 | 3 | 4, string> = {
  1: '1. Identité et ancrage',
  2: '2. Contraintes réglementaires et risques',
  3: '3. Données physiques et réseaux',
  4: '4. Données économiques',
};

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const COMPOSITE_LABELS: Record<string, Record<string, string>> = {
  risque_inondation: { zone_inondable: 'signal communal d’inondation', ppri: 'PPRI déclaré par la source' },
  servitudes: { intersection_demontree: 'intersection démontrée', nb_intersectantes: 'nombre de servitudes intersectantes', nb_proches: 'servitudes signalées à proximité' },
  assainissement: { mode: 'mode', operateur: 'gestionnaire' },
  loyers_reference: { median_appartement: 'médiane appartement', median_maison: 'médiane maison', retenu: 'valeur retenue' },
  dvf_prix_m2: { prix_m2_median_source: 'prix médian observé', nb_comparables: 'mutations comparables', periode_mois: 'période observée (mois)' },
};

function scalar(value: unknown, evidenceId = ''): string {
  if (value === null || value === undefined) return 'non disponible';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return neutralizeForbidden(value);
  if (Array.isArray(value)) return value.map((item) => scalar(item, evidenceId)).join(', ');
  const obj = record(value);
  if (!obj) return String(value);
  // Ces indicateurs composites ne sont pas restitués dans une étude parcellaire :
  // ils nécessitent un contexte financier distinct et ont historiquement été
  // surinterprétés par la rédaction libre.
  const excludedKeys = /(?:rendement|dispersion|source_brute|raw|debug|technical)/i;
  const labels = COMPOSITE_LABELS[evidenceId] ?? {};
  const entries = Object.keys(obj)
    .filter((key) => !excludedKeys.test(key) && obj[key] !== null && obj[key] !== undefined)
    .sort()
    .map((key) => `${labels[key] ?? key.replaceAll('_', ' ')} : ${scalar(obj[key], evidenceId)}`);
  return entries.length ? entries.join(' ; ') : 'non disponible';
}

function line(label: string, value: unknown): string {
  return `- **${label}** : ${scalar(value)}`;
}

function renderEvidence(value: unknown): string | null {
  const evidence = record(value);
  if (!evidence) return null;
  const labelRaw = text(evidence.label), sourceRaw = text(evidence.source);
  const status = text(evidence.status), scope = text(evidence.scope);
  if (!labelRaw || !sourceRaw || !status || !scope) return null;
  const label = neutralizeForbidden(labelRaw), source = neutralizeForbidden(sourceRaw);
  const unit = text(evidence.unit);
  const evidenceId = text(evidence.id) ?? '';
  const unavailable = status === 'unavailable' || evidence.value === null || evidence.value === undefined;
  const renderedValue = unavailable ? 'non disponible' : scalar(evidence.value, evidenceId) + (unit ? ` ${unit}` : '');
  const sourceDate = text(evidence.sourceDate);
  const details = [
    `statut : ${status}`, `portée : ${scope}`, `source : ${source}`,
    sourceDate ? `date source : ${sourceDate}` : null,
    typeof evidence.confidence === 'number' ? `confiance : ${evidence.confidence}/100` : null,
  ].filter(Boolean).join(' ; ');
  const warningRaw = text(evidence.warning);
  const warning = warningRaw ? neutralizeForbidden(warningRaw) : null;
  return `- **${label}** : ${renderedValue}\n  - ${details}${warning ? `\n  - Avertissement : ${warning}` : ''}`;
}

function evidenceSection(evidence: UnknownRecord): 1 | 2 | 3 | 4 {
  const id = text(evidence.id) ?? '';
  if (SECTION_BY_EVIDENCE_ID[id]) return SECTION_BY_EVIDENCE_ID[id];
  return text(evidence.scope) === 'parcel' ? 1 : 3;
}

function hasUnavailablePlu(evidences: unknown[]): boolean {
  return evidences.some((raw) => {
    const ev = record(raw);
    return text(ev?.id) === 'reglement_plu' && text(ev?.status) === 'unavailable';
  });
}

/** Rend exclusivement le contrat qualifié d'etude-parcelle-v1. */
export function renderParcelStudyReport(toolOutput: unknown): string | null {
  const output = record(toolOutput);
  if (!output || !['ok', 'partial'].includes(text(output.status) ?? '')) return null;
  const data = record(output.data);
  const ancrage = record(data?.ancrage), parcelle = record(data?.parcelle);
  const verdict = record(data?.verdict);
  const evidences = Array.isArray(data?.evidences) ? data.evidences : null;
  if (!data || !ancrage || !parcelle || !verdict || !evidences?.length) return null;

  const rendered = evidences.map((raw) => {
    const ev = record(raw), markdown = renderEvidence(raw);
    return ev && markdown ? { section: evidenceSection(ev), markdown } : null;
  }).filter((item): item is { section: 1 | 2 | 3 | 4; markdown: string } => Boolean(item));
  if (!rendered.length) return null;

  const perimeter = [
    '## Périmètre de l’étude',
    line('Type d’ancrage', text(ancrage.anchor_type)),
    line('Parcelle cadastrale résolue', ancrage.cadastral_resolved === true),
    line('Identifiant cadastral', parcelle.idu), line('Commune', parcelle.commune),
    line('Code INSEE', parcelle.code_insee),
    line('Coordonnées', parcelle.lat != null && parcelle.lon != null ? `${scalar(parcelle.lat)}, ${scalar(parcelle.lon)}` : null),
  ].join('\n');
  const sections = ([1, 2, 3, 4] as const).map((section) => {
    const rows = rendered.filter((item) => item.section === section).map((item) => item.markdown);
    return `## ${SECTION_TITLES[section]}\n${rows.length ? rows.join('\n') : '- Aucune donnée qualifiée fournie.'}`;
  });

  const potentiel = record(verdict.potentiel), risque = record(verdict.risque);
  const fiabilite = record(verdict.fiabilite), recommandation = record(verdict.recommandation);
  const constructibilite = record(verdict.constructibilite);
  if (!potentiel || !risque || !fiabilite || !recommandation) return null;
  const actions = Array.isArray(data.plan_action) ? data.plan_action : [];
  const firstAction = actions.map(record).find(Boolean) ?? null;
  const unavailable = Array.isArray(data.sources_indisponibles)
    ? data.sources_indisponibles.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
  const warnings = Array.isArray(data.avertissements)
    ? data.avertissements.map(text).filter((item): item is string => Boolean(item)).map(neutralizeForbidden) : [];

  const unavailableEvidences = evidences.map(record).filter((evidence): evidence is UnknownRecord =>
    Boolean(evidence) && text(evidence?.status) === 'unavailable');

  const conclusion = [
    '## 5. Verdict, limites et première action',
    line('Potentiel — niveau attribué par le moteur', potentiel.niveau),
    line('Risque — niveau attribué par le moteur', risque.niveau),
    ...(text(risque.scope) ? [line('Portée du verdict de risque', risque.scope)] : []),
    ...(text(risque.niveau_decisionnel) ? [line('Niveau décisionnel du risque', risque.niveau_decisionnel)] : []),
    line('Fiabilité — score attribué par le moteur', typeof fiabilite.score === 'number' ? `${fiabilite.score}/100` : fiabilite.score),
    line('Recommandation attribuée par le moteur', recommandation.valeur),
    ...(text(recommandation.motif) ? [line('Motif du moteur', neutralizeForbidden(text(recommandation.motif)!))] : []),
    hasUnavailablePlu(evidences)
      ? line('Constructibilité', 'indéterminable — règlement PLU opposable absent des données de cette étude')
      : line('Constructibilité — statut attribué par le moteur', constructibilite?.statut),
    firstAction ? line('Première action du plan', firstAction.action) : line('Première action du plan', null),
    ...(firstAction && text(firstAction.motif) ? [line('Motif de la première action', neutralizeForbidden(text(firstAction.motif)!))] : []),
    '', '**Données ou preuves indisponibles**',
    ...(unavailableEvidences.length
      ? unavailableEvidences.map((evidence) => `- ${neutralizeForbidden(text(evidence.label) ?? text(evidence.id) ?? 'Donnée')} : ${neutralizeForbidden(text(evidence.warning) ?? 'valeur non fournie')}`)
      : ['- Toutes les preuves listées par le moteur ont une valeur exploitable.']),
    '', '**Services techniques indisponibles**',
    ...(unavailable.length
      ? unavailable.map((source) => `- ${neutralizeForbidden(text(source.cle) ?? 'service')} : ${neutralizeForbidden(text(source.motif) ?? 'motif non fourni')}`)
      : ['- Aucune défaillance technique signalée par le moteur (indépendamment des données absentes ci-dessus).']),
    '', '**Avertissements déclarés par le moteur**',
    ...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ['- Aucun avertissement fourni.']),
    '', 'À faire valider par un professionnel.',
  ].join('\n');
  const report = [perimeter, ...sections, conclusion].join('\n\n');
  return report;
}
