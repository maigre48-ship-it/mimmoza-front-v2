// =============================================================================
// Graphiques du copilot — contrat de données
// -----------------------------------------------------------------------------
// Le modèle ne dessine pas : il DÉCRIT. Il émet un bloc de code balisé
// ```mimmoza-chart contenant le JSON décrit ici, et le front le rend avec
// recharts. Deux raisons à ce choix :
//
//   · le rendu reste sous notre contrôle — thème, accessibilité, responsive,
//     comportement à l'impression — au lieu de dépendre de ce que le modèle
//     aurait bricolé en SVG ;
//   · les valeurs restent des DONNÉES, donc vérifiables. Un graphique dont les
//     chiffres ne se retrouvent pas dans le texte serait invisible à la
//     relecture ; ici on peut les comparer, et l'export PDF les restitue en
//     tableau.
// =============================================================================

export type CopilotChartType = 'bar' | 'line' | 'pie' | 'donut';

export interface CopilotChartPoint {
  /** Abscisse (barres, courbe) ou libellé de part (camembert). */
  label: string;
  value: number;
  /**
   * Séries additionnelles pour un graphique multi-séries, par exemple
   * `{ "2024": 6200, "2025": 6672 }`. Ignoré pour un camembert.
   */
  [serie: string]: string | number;
}

export interface CopilotChartSpec {
  type: CopilotChartType;
  title?: string;
  /** Unité affichée sur l'axe et dans l'infobulle : « €/m² », « %», « logements »… */
  unit?: string;
  /**
   * Provenance des chiffres, reprise telle quelle du texte. Obligatoire en
   * pratique : un graphique sans source contredirait la règle 2 du prompt
   * système, qui impose de sourcer toute affirmation factuelle.
   */
  source?: string;
  /** Noms des séries à tracer. Par défaut : `['value']`. */
  series?: string[];
  data: CopilotChartPoint[];
}

/** Segment de message : du texte à rendre en markdown, ou un graphique. */
export type CopilotSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'chart'; spec: CopilotChartSpec };

const TYPES_VALIDES: CopilotChartType[] = ['bar', 'line', 'pie', 'donut'];

/**
 * Valide un JSON de graphique. Retourne null si quoi que ce soit cloche.
 *
 * Volontairement strict et silencieux : le contenu vient d'un modèle de langage,
 * donc d'une source faillible. Un bloc malformé doit disparaître proprement, pas
 * faire planter le fil de conversation ni s'afficher en JSON brut.
 */
export function parseChartSpec(json: string): CopilotChartSpec | null {
  let brut: unknown;
  try {
    brut = JSON.parse(json);
  } catch {
    return null;
  }
  if (!brut || typeof brut !== 'object') return null;

  const o = brut as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== 'string' || !TYPES_VALIDES.includes(type as CopilotChartType)) return null;

  if (!Array.isArray(o.data)) return null;

  const data: CopilotChartPoint[] = [];
  for (const brutPoint of o.data) {
    if (!brutPoint || typeof brutPoint !== 'object') continue;
    const p = brutPoint as Record<string, unknown>;
    const label = typeof p.label === 'string' ? p.label : null;
    if (!label) continue;

    // `value` n'est PAS pré-initialisée : l'écrire d'office créait une série
    // fantôme à zéro quand le point n'en portait pas. Sur un multi-séries, une
    // courbe plate « Valeur » s'ajoutait ; sur un camembert, toutes les parts
    // tombaient à 0 et le graphique s'affichait vide.
    const point = { label } as CopilotChartPoint;
    let auMoinsUnNombre = false;
    for (const [cle, valeur] of Object.entries(p)) {
      if (cle === 'label') continue;
      // Les nombres transitent parfois en chaîne (« 6 672 », « 6672.5 »).
      const nombre = typeof valeur === 'number'
        ? valeur
        : typeof valeur === 'string'
          ? Number(valeur.replace(/\s/g, '').replace(',', '.'))
          : NaN;
      if (Number.isFinite(nombre)) {
        point[cle] = nombre;
        auMoinsUnNombre = true;
      }
    }
    if (auMoinsUnNombre) data.push(point);
  }
  // Plancher de lisibilité, appliqué en dernier recours.
  //
  // Le prompt demande déjà au modèle de s'abstenir sur des séries trop courtes,
  // mais il l'a fait — un graphique à barres avec UN point pour une pente de
  // 5,3 %, là où la phrase suffisait. Un garde-fou côté rendu vaut mieux qu'une
  // consigne : deux points minimum pour comparer, trois parts minimum pour
  // qu'un camembert dise autre chose qu'un pourcentage.
  const minimum = type === 'pie' || type === 'donut' ? 3 : 2;
  if (data.length < minimum) return null;

  // Séries : celles annoncées si elles existent réellement dans les points,
  // sinon toutes les clés numériques rencontrées, `value` en tête.
  const clesNumeriques = Array.from(
    new Set(data.flatMap((p) => Object.keys(p).filter((k) => k !== 'label'))),
  );
  const seriesAnnoncees = Array.isArray(o.series)
    ? o.series.filter((s): s is string => typeof s === 'string' && clesNumeriques.includes(s))
    : [];
  const series = seriesAnnoncees.length > 0
    ? seriesAnnoncees
    : clesNumeriques.sort((a, b) => (a === 'value' ? -1 : b === 'value' ? 1 : 0));

  return {
    type: type as CopilotChartType,
    title: typeof o.title === 'string' ? o.title : undefined,
    unit: typeof o.unit === 'string' ? o.unit : undefined,
    source: typeof o.source === 'string' ? o.source : undefined,
    series,
    data,
  };
}

/** Bloc ```mimmoza-chart … ``` — fermé uniquement. */
const BLOC_GRAPHIQUE = /```mimmoza-chart\s*\n([\s\S]*?)```/g;

/**
 * Découpe un message en segments texte / graphique.
 *
 * Un bloc OUVERT mais jamais refermé est coupé : son JSON est tronqué, donc
 * invalide, et le laisser défiler afficherait du JSON brut. Cela vaut pendant le
 * streaming — le bloc apparaîtra dès qu'il se refermera — comme sur un message
 * terminé, où l'ouverture béante signale une génération interrompue.
 *
 */
export function decouperSegments(texte: string): CopilotSegment[] {
  const segments: CopilotSegment[] = [];
  let curseur = 0;

  BLOC_GRAPHIQUE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOC_GRAPHIQUE.exec(texte)) !== null) {
    const avant = texte.slice(curseur, m.index);
    if (avant.trim()) segments.push({ kind: 'markdown', text: avant });

    const spec = parseChartSpec(m[1]);
    if (spec) segments.push({ kind: 'chart', spec });
    // Un bloc invalide est simplement omis : ni graphique, ni JSON à l'écran.

    curseur = m.index + m[0].length;
  }

  let reste = texte.slice(curseur);

  // Une ouverture jamais refermée est TOUJOURS coupée, pas seulement pendant le
  // streaming : une génération interrompue (max_tokens, coupure réseau) laisse
  // un bloc béant sur un message pourtant marqué « complete ». Le fence et son
  // JSON tronqué partiraient alors dans le rendu markdown — qui ne gère pas les
  // blocs de code — et s'afficheraient tels quels, à l'écran comme au PDF.
  const ouvertureInachevee = reste.indexOf('```mimmoza-chart');
  if (ouvertureInachevee !== -1) reste = reste.slice(0, ouvertureInachevee);

  if (reste.trim()) segments.push({ kind: 'markdown', text: reste });
  return segments;
}

/**
 * Remplace les blocs graphiques par un tableau markdown équivalent.
 *
 * Sert à l'export PDF, qui rend du markdown en HTML statique et n'exécute pas
 * React : sans cela, le JSON du graphique s'imprimerait tel quel au milieu du
 * rapport. Les chiffres sont conservés — c'est ce qui compte dans un document.
 */
export function graphiquesEnTableaux(texte: string): string {
  BLOC_GRAPHIQUE.lastIndex = 0;
  return texte.replace(BLOC_GRAPHIQUE, (_bloc, json: string) => {
    const spec = parseChartSpec(json);
    if (!spec) return '';

    const series = spec.series ?? ['value'];
    // Mêmes intitulés qu'à l'écran : « Valeur » plutôt que la clé brute `value`.
    const nomSerie = (s: string) => (s === 'value' ? 'Valeur' : s);
    const suffixeUnite = spec.unit ? ` (${spec.unit})` : '';
    const enTete = ['', ...series.map((s) => `${nomSerie(s)}${suffixeUnite}`)];

    // Un `|` dans un libellé ajouterait une colonne et décalerait la ligne.
    const cellule = (v: string) => v.replace(/\|/g, '\\|');

    const lignes = [
      spec.title ? `**${spec.title}**` : '',
      `| ${enTete.join(' | ')} |`,
      `| ${enTete.map(() => '---').join(' | ')} |`,
      ...spec.data.map((p) => {
        const cellules = series.map((s) => {
          const v = p[s];
          return typeof v === 'number' ? v.toLocaleString('fr-FR') : '—';
        });
        return `| ${cellule(p.label)} | ${cellules.join(' | ')} |`;
      }),
      // `**…**` et non `_…_` : le rendu markdown de l'export ne gère pas
      // l'italique par tiret bas, les underscores s'imprimeraient littéralement.
      spec.source ? `**Source :** ${cellule(spec.source)}` : '',
    ];
    return `\n\n${lignes.filter(Boolean).join('\n')}\n\n`;
  });
}
