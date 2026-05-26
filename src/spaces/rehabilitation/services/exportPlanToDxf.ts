// ─────────────────────────────────────────────────────────────────────────────
// exportPlanToDxf.ts
// Génération DXF R12 ASCII à partir des murs validés d'un plan de réhabilitation
// Aucune dépendance externe — générateur pur basé sur la spec DXF R12/R14
// ─────────────────────────────────────────────────────────────────────────────

import type { PlanTranscriptionResult } from '../plan-reader/planTranscription.types';
import type {
  ValidatedWallExport,
  WallUserValidationStatus,
} from '../plan-reader/planUserValidationEngine';

// ── Noms de calques DXF ───────────────────────────────────────────────────────

export const DXF_LAYERS = {
  MURS_PORTEURS:   'MURS_PORTEURS',
  MURS_CLOISONS:   'MURS_CLOISONS',
  MURS_EN_ATTENTE: 'MURS_EN_ATTENTE',
  MURS_REJETES:    'MURS_REJETES',
  PIECES:          'PIECES',
  OUVERTURES:      'OUVERTURES',
  ANNOTATIONS:     'ANNOTATIONS',
  COTATIONS:       'COTATIONS',
} as const;

export type DxfLayerName = (typeof DXF_LAYERS)[keyof typeof DXF_LAYERS];

// ── Codes couleur ACI (AutoCAD Color Index) ───────────────────────────────────

const ACI = {
  RED:     1,
  YELLOW:  2,
  GREEN:   3,
  CYAN:    4,
  BLUE:    5,
  MAGENTA: 6,
  WHITE:   7,
  GRAY:    8,
  ORANGE: 30,
} as const;

// ── Options d'export ──────────────────────────────────────────────────────────

export interface DxfExportOptions {
  /**
   * Largeur réelle du plan en centimètres.
   * Utilisée pour convertir les coordonnées normalisées (0–1) en unités CAO (cm).
   * Défaut : 1000 cm (= 10 m, hypothèse conservative).
   */
  readonly plan_width_cm: number;
  readonly plan_height_cm: number;

  /**
   * Inclure les murs en attente de validation dans l'export.
   * Défaut : false — seuls les murs décidés sont exportés.
   */
  readonly include_pending: boolean;

  /**
   * Inclure les murs rejetés sur un calque séparé (pour audit).
   */
  readonly include_rejected: boolean;

  /**
   * Inclure les pièces comme polylignes fermées.
   */
  readonly include_rooms: boolean;

  /**
   * Inclure les ouvertures comme entités POINT.
   */
  readonly include_openings: boolean;

  /**
   * Auteur inscrit dans le bloc $TITLE du header DXF.
   */
  readonly author: string;

  /**
   * Commentaires libres dans le header.
   */
  readonly comment: string;
}

export const DEFAULT_DXF_OPTIONS: DxfExportOptions = {
  plan_width_cm:    1000,
  plan_height_cm:   1000,
  include_pending:  false,
  include_rejected: false,
  include_rooms:    true,
  include_openings: true,
  author:           'Mimmoza Réhabilitation',
  comment:          '',
} as const;

// ── Résultat d'export ─────────────────────────────────────────────────────────

export interface DxfExportResult {
  readonly success: boolean;
  readonly dxf_content: string;
  readonly filename: string;
  readonly stats: DxfExportStats;
  readonly error: string | null;
}

export interface DxfExportStats {
  readonly nb_murs_porteurs:  number;
  readonly nb_murs_cloisons:  number;
  readonly nb_murs_en_attente: number;
  readonly nb_murs_rejetes:   number;
  readonly nb_pieces:         number;
  readonly nb_ouvertures:     number;
  readonly total_entities:    number;
}

// ── Coordonnées DXF (Y inversé par rapport au SVG) ───────────────────────────

interface DxfPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function normalizedToDxf(
  nx: number,
  ny: number,
  options: Pick<DxfExportOptions, 'plan_width_cm' | 'plan_height_cm'>
): DxfPoint {
  return {
    x: +(nx * options.plan_width_cm).toFixed(4),
    // Inversion Y : SVG est top-left, DXF est bottom-left
    y: +(( 1 - ny) * options.plan_height_cm).toFixed(4),
    z: 0,
  };
}

// ── Primitives DXF ────────────────────────────────────────────────────────────
// Chaque fonction retourne un bloc DXF ASCII (groupes code-valeur)

function dxfLine(layer: DxfLayerName, p1: DxfPoint, p2: DxfPoint, color?: number): string {
  const colorGroup = color !== undefined ? `62\n${color}\n` : '';
  return [
    '0', 'LINE',
    '8', layer,
    colorGroup.trim(),
    '10', p1.x.toString(),
    '20', p1.y.toString(),
    '30', '0.0',
    '11', p2.x.toString(),
    '21', p2.y.toString(),
    '31', '0.0',
  ].filter(Boolean).join('\n') + '\n';
}

function dxfText(
  layer: DxfLayerName,
  p: DxfPoint,
  text: string,
  height = 20,
  color?: number
): string {
  const colorGroup = color !== undefined ? `62\n${color}\n` : '';
  return [
    '0', 'TEXT',
    '8', layer,
    colorGroup.trim(),
    '10', p.x.toString(),
    '20', p.y.toString(),
    '30', '0.0',
    '40', height.toString(),
    '1', text,
    '72', '1',  // justification horizontale : centré
  ].filter(Boolean).join('\n') + '\n';
}

function dxfPoint(layer: DxfLayerName, p: DxfPoint, color?: number): string {
  const colorGroup = color !== undefined ? `62\n${color}\n` : '';
  return [
    '0', 'POINT',
    '8', layer,
    colorGroup.trim(),
    '10', p.x.toString(),
    '20', p.y.toString(),
    '30', '0.0',
  ].filter(Boolean).join('\n') + '\n';
}

function dxfLwPolyline(
  layer: DxfLayerName,
  vertices: ReadonlyArray<DxfPoint>,
  closed: boolean,
  color?: number
): string {
  if (vertices.length < 2) return '';

  const colorGroup = color !== undefined ? `62\n${color}` : '';
  const flag = closed ? '1' : '0';

  const vertexLines = vertices
    .map((v) => `10\n${v.x}\n20\n${v.y}`)
    .join('\n');

  return [
    '0', 'LWPOLYLINE',
    '8', layer,
    colorGroup,
    '90', vertices.length.toString(),
    '70', flag,
    vertexLines,
  ].filter(Boolean).join('\n') + '\n';
}

// ── Sections DXF ──────────────────────────────────────────────────────────────

function buildDxfHeader(options: DxfExportOptions): string {
  const now = new Date().toISOString();
  const extMax = `${Math.max(options.plan_width_cm, options.plan_height_cm)}`;

  return [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '9', '$INSUNITS', '70', '5',  // 5 = centimètres
    '9', '$EXTMIN',
      '10', '0.0', '20', '0.0', '30', '0.0',
    '9', '$EXTMAX',
      '10', extMax, '20', extMax, '30', '0.0',
    '9', '$LIMMIN',
      '10', '0.0', '20', '0.0',
    '9', '$LIMMAX',
      '10', options.plan_width_cm.toString(),
      '20', options.plan_height_cm.toString(),
    '9', '$MEASUREMENT', '70', '1',  // 1 = métrique
    '0', 'ENDSEC',
    // Commentaire libre via section CLASSES (fictif mais lisible)
    '999', `Généré par ${options.author}`,
    '999', `Date : ${now}`,
    options.comment ? `999\n${options.comment}` : '',
  ].filter(Boolean).join('\n') + '\n';
}

function buildDxfTablesSection(layerDefs: ReadonlyArray<{ name: DxfLayerName; color: number }>): string {
  const layerCount = layerDefs.length;

  const layerEntries = layerDefs.map(({ name, color }) => [
    '0', 'LAYER',
    '2', name,
    '70', '0',       // layer non gelé, non verrouillé
    '62', color.toString(),
    '6', 'CONTINUOUS',
  ].join('\n')).join('\n');

  return [
    '0', 'SECTION',
    '2', 'TABLES',
    '0', 'TABLE',
    '2', 'LTYPE',
    '70', '1',
    '0', 'LTYPE',
    '2', 'CONTINUOUS',
    '70', '0',
    '3', 'Solid line',
    '72', '65',
    '73', '0',
    '40', '0.0',
    '0', 'ENDTAB',
    '0', 'TABLE',
    '2', 'LAYER',
    '70', layerCount.toString(),
    layerEntries,
    '0', 'ENDTAB',
    '0', 'ENDSEC',
  ].join('\n') + '\n';
}

function buildEntitiesSection(entities: string): string {
  return [
    '0', 'SECTION',
    '2', 'ENTITIES',
    entities,
    '0', 'ENDSEC',
  ].join('\n') + '\n';
}

// ── Mapping statut → calque DXF ───────────────────────────────────────────────

function wallStatusToLayer(status: WallUserValidationStatus): DxfLayerName {
  switch (status) {
    case 'porteur_confirmé':  return DXF_LAYERS.MURS_PORTEURS;
    case 'cloison_confirmée': return DXF_LAYERS.MURS_CLOISONS;
    case 'corrigé':           return DXF_LAYERS.MURS_CLOISONS;
    case 'rejeté':            return DXF_LAYERS.MURS_REJETES;
    case 'en_attente':        return DXF_LAYERS.MURS_EN_ATTENTE;
  }
}

function wallStatusToACI(status: WallUserValidationStatus): number {
  switch (status) {
    case 'porteur_confirmé':  return ACI.RED;
    case 'cloison_confirmée': return ACI.BLUE;
    case 'corrigé':           return ACI.CYAN;
    case 'rejeté':            return ACI.GRAY;
    case 'en_attente':        return ACI.WHITE;
  }
}

// ── Générateur DXF principal ──────────────────────────────────────────────────

/**
 * Génère un fichier DXF R12 ASCII complet à partir du plan de réhabilitation.
 *
 * @param transcription  Résultat de transcription IA (pièces, ouvertures, annotations)
 * @param validatedWalls Murs validés (issus de exportValidatedWalls())
 * @param options        Options d'export (dimensions réelles, filtres de calques)
 */
export function generateDxf(
  transcription: PlanTranscriptionResult,
  validatedWalls: ReadonlyArray<ValidatedWallExport>,
  options: Partial<DxfExportOptions> = {}
): DxfExportResult {
  const opts: DxfExportOptions = { ...DEFAULT_DXF_OPTIONS, ...options };

  try {
    const entities: string[] = [];
    const stats: DxfExportStats = {
      nb_murs_porteurs:   0,
      nb_murs_cloisons:   0,
      nb_murs_en_attente: 0,
      nb_murs_rejetes:    0,
      nb_pieces:          0,
      nb_ouvertures:      0,
      get total_entities() {
        return (
          this.nb_murs_porteurs +
          this.nb_murs_cloisons +
          this.nb_murs_en_attente +
          this.nb_murs_rejetes +
          this.nb_pieces +
          this.nb_ouvertures
        );
      },
    };

    // ── Murs ────────────────────────────────────────────────────────────────

    const mutableStats = {
      nb_murs_porteurs:   0,
      nb_murs_cloisons:   0,
      nb_murs_en_attente: 0,
      nb_murs_rejetes:    0,
      nb_pieces:          0,
      nb_ouvertures:      0,
    };

    for (const wall of validatedWalls) {
      if (!opts.include_pending && wall.status === 'en_attente') continue;
      if (!opts.include_rejected && wall.status === 'rejeté') continue;

      const layer  = wallStatusToLayer(wall.status);
      const color  = wallStatusToACI(wall.status);
      const p1     = normalizedToDxf(wall.start.x, wall.start.y, opts);
      const p2     = normalizedToDxf(wall.end.x,   wall.end.y,   opts);

      entities.push(dxfLine(layer, p1, p2, color));

      // Annotation épaisseur au milieu du mur
      if (wall.epaisseur_cm !== null) {
        const mid = normalizedToDxf(
          (wall.start.x + wall.end.x) / 2,
          (wall.start.y + wall.end.y) / 2,
          opts
        );
        entities.push(dxfText(DXF_LAYERS.COTATIONS, mid, `${wall.epaisseur_cm}cm`, 8, ACI.GRAY));
      }

      switch (wall.status) {
        case 'porteur_confirmé':  mutableStats.nb_murs_porteurs++;   break;
        case 'cloison_confirmée':
        case 'corrigé':           mutableStats.nb_murs_cloisons++;   break;
        case 'en_attente':        mutableStats.nb_murs_en_attente++; break;
        case 'rejeté':            mutableStats.nb_murs_rejetes++;    break;
      }
    }

    // ── Pièces ───────────────────────────────────────────────────────────────

    if (opts.include_rooms) {
      for (const room of transcription.rooms) {
        const tl = normalizedToDxf(room.bounding_box.topLeft.x,     room.bounding_box.topLeft.y,     opts);
        const br = normalizedToDxf(room.bounding_box.bottomRight.x,  room.bounding_box.bottomRight.y, opts);
        const tr = { x: br.x, y: tl.y, z: 0 };
        const bl = { x: tl.x, y: br.y, z: 0 };

        // Polyligne fermée représentant la bounding box de la pièce
        entities.push(dxfLwPolyline(DXF_LAYERS.PIECES, [tl, tr, br, bl], true, ACI.YELLOW));

        // Label de la pièce au centre
        const cx = (tl.x + br.x) / 2;
        const cy = (tl.y + br.y) / 2;
        const label = room.surface_m2
          ? `${room.nom} ${room.surface_m2.toFixed(1)}m²`
          : room.nom;
        entities.push(dxfText(DXF_LAYERS.PIECES, { x: cx, y: cy, z: 0 }, label, 12, ACI.YELLOW));

        mutableStats.nb_pieces++;
      }
    }

    // ── Ouvertures ────────────────────────────────────────────────────────────

    if (opts.include_openings) {
      for (const opening of transcription.openings) {
        const p = normalizedToDxf(opening.position.x, opening.position.y, opts);
        entities.push(dxfPoint(DXF_LAYERS.OUVERTURES, p, ACI.GREEN));

        const label = opening.largeur_m
          ? `${opening.type} L=${opening.largeur_m.toFixed(2)}m`
          : opening.type;
        entities.push(dxfText(DXF_LAYERS.OUVERTURES, { x: p.x + 5, y: p.y + 5, z: 0 }, label, 8, ACI.GREEN));

        mutableStats.nb_ouvertures++;
      }
    }

    // ── Construction du document DXF ─────────────────────────────────────────

    const layerDefs: ReadonlyArray<{ name: DxfLayerName; color: number }> = [
      { name: DXF_LAYERS.MURS_PORTEURS,   color: ACI.RED     },
      { name: DXF_LAYERS.MURS_CLOISONS,   color: ACI.BLUE    },
      { name: DXF_LAYERS.MURS_EN_ATTENTE, color: ACI.WHITE   },
      { name: DXF_LAYERS.MURS_REJETES,    color: ACI.GRAY    },
      { name: DXF_LAYERS.PIECES,          color: ACI.YELLOW  },
      { name: DXF_LAYERS.OUVERTURES,      color: ACI.GREEN   },
      { name: DXF_LAYERS.ANNOTATIONS,     color: ACI.MAGENTA },
      { name: DXF_LAYERS.COTATIONS,       color: ACI.GRAY    },
    ];

    const header         = buildDxfHeader(opts);
    const tablesSection  = buildDxfTablesSection(layerDefs);
    const entitiesSection = buildEntitiesSection(entities.join(''));
    const eof            = '0\nEOF\n';

    const dxf_content = [header, tablesSection, entitiesSection, eof].join('');

    // Filename normalisé
    const safeTitle = transcription.source_file_name
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 60);
    const filename = `${safeTitle}_validated.dxf`;

    const finalStats: DxfExportStats = {
      ...mutableStats,
      total_entities: Object.values(mutableStats).reduce((a, b) => a + b, 0),
    };

    return { success: true, dxf_content, filename, stats: finalStats, error: null };
  } catch (err) {
    return {
      success: false,
      dxf_content: '',
      filename: '',
      stats: {
        nb_murs_porteurs: 0, nb_murs_cloisons: 0, nb_murs_en_attente: 0,
        nb_murs_rejetes: 0, nb_pieces: 0, nb_ouvertures: 0, total_entities: 0,
      },
      error: err instanceof Error ? err.message : 'Erreur inconnue lors de la génération DXF.',
    };
  }
}

// ── Déclenchement du téléchargement ──────────────────────────────────────────

/**
 * Déclenche le téléchargement du fichier DXF dans le navigateur.
 * Retourne false si le contenu est vide ou si le résultat est en erreur.
 */
export function downloadDxf(result: DxfExportResult): boolean {
  if (!result.success || !result.dxf_content) return false;

  const blob = new Blob([result.dxf_content], { type: 'application/dxf' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = result.filename;
  link.click();
  URL.revokeObjectURL(url);

  return true;
}

// ── Parse de l'échelle détectée ───────────────────────────────────────────────

/**
 * Extrait le facteur d'échelle depuis une chaîne comme "1:50" ou "1:100".
 * Retourne null si non parsable.
 *
 * Usage : si echelle = "1:50" et la largeur de la feuille est 420mm (A3),
 * la largeur réelle du plan est 420 × 50 = 21 000 mm = 2 100 cm.
 */
export function parseEchelle(echelle: string | null): number | null {
  if (!echelle) return null;
  const match = echelle.match(/^1\s*[:/]\s*(\d+)$/);
  if (!match || !match[1]) return null;
  const factor = parseInt(match[1], 10);
  return isNaN(factor) || factor <= 0 ? null : factor;
}

/**
 * Calcule les dimensions réelles du plan en cm à partir de l'échelle détectée
 * et des dimensions physiques de l'image en mm.
 */
export function computeRealPlanDimensions(
  echelle: string | null,
  imagePrintWidth_mm: number,
  imagePrintHeight_mm: number
): { width_cm: number; height_cm: number } {
  const factor = parseEchelle(echelle);
  if (!factor) {
    return { width_cm: DEFAULT_DXF_OPTIONS.plan_width_cm, height_cm: DEFAULT_DXF_OPTIONS.plan_height_cm };
  }
  return {
    width_cm:  (imagePrintWidth_mm  * factor) / 10,
    height_cm: (imagePrintHeight_mm * factor) / 10,
  };
}