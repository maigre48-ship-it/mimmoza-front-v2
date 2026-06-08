// ─────────────────────────────────────────────────────────────────────────────
// CreationPlanPage.tsx — v4 "Integrated"
// Intègre le pipeline de transcription vectorielle (usePlanTranscription),
// la vue vectorielle (PlanLayerViewer) et le moteur de validation (planUserValidationEngine).
// Le canvas de dessin manuel est conservé comme mode complémentaire.
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileText,
  Info,
  Layers,
  PenSquare,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';

// ── Stores Mimmoza ────────────────────────────────────────────────────────────
import {
  useRehabilitationProject,
  type RehabilitationPlanSource,
} from '../shared/rehabilitationProject.store';

// ── Pipeline transcription (batch 1) ─────────────────────────────────────────
import {
  usePlanTranscription,
} from '../hooks/usePlanTranscription';
import type { PlanTranscriptionResult } from '../plan-reader/planTranscription.types';
import type { RoomUsage } from '../plan-reader/planTranscription.types';

// ── Viewer vectoriel (batch 2) ────────────────────────────────────────────────
import { PlanLayerViewer } from '../components/PlanLayerViewer';
import { isWetZone } from '../plan-reader/planVectorGeometry';

// ── Calibration d'échelle (OBLIGATOIRE pour surfaces fiables) ─────────────────
import {
  useScaleCalibrator,
  computeSurface_m2,
  startCalibration,
  formatCalibrationLabel,
  assessCalibrationQuality,
  assessSurfaceMismatch,
} from '../plan-reader/planScaleCalibrator';

// ── Validation engine (batch 3) ───────────────────────────────────────────────
import {
  initValidationForPlan,
  getValidationProgress,
  exportValidatedWalls,
} from '../plan-reader/planUserValidationEngine';

// ── Export DXF (batch 3) ──────────────────────────────────────────────────────
import {
  generateDxf,
  downloadDxf,
  computeRealPlanDimensions,
} from '../services/exportPlanToDxf';

// ─── Thème ────────────────────────────────────────────────────────────────────

const ACCENT       = '#f97316' as const;
const ACCENT_LIGHT = '#fff7ed' as const;
const ACCENT_DARK  = '#c2410c' as const;
const GRAD         = 'linear-gradient(135deg, #ea580c 0%, #fb923c 100%)' as const;

// ─── Types locaux ─────────────────────────────────────────────────────────────

type RoomType =
  | 'salon' | 'cuisine' | 'chambre' | 'sdb' | 'wc' | 'bureau'
  | 'couloir' | 'entree' | 'commun' | 'therapie' | 'soins'
  | 'accueil' | 'vestiaire' | 'stockage' | 'restauration';

interface RoomShape {
  id:        string;
  name:      string;
  type:      RoomType;
  surface:   number;
  /** Coordonnées normalisées [0–1] sur la zone plan */
  x: number; y: number; width: number; height: number;
  isWetZone: boolean;
  isNew:     boolean;
}

interface DrawRect { x: number; y: number; w: number; h: number }

type EditorMode = 'draw' | 'select';
type ViewMode   = 'canvas' | 'vector';

/** Payload typé pour updatePlan — évite le cast `as any` */
interface CreationPlanResultPayload {
  zoning:                string;
  commentary:            string;
  budgetMin:             number;
  budgetMax:             number;
  constraintsRespected:  string[];
  pointsToCheck:         string[];
  generatedAt:           string;
  lockedWalls:           string[];
  source:                'analysis' | 'manual';
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const ROOM_COLORS: Record<RoomType, string> = {
  salon:        '#FFF3E0', cuisine:      '#FFF8E1', chambre:      '#E8F5E9',
  sdb:          '#E3F2FD', wc:           '#EFF6FF', bureau:       '#F3E5F5',
  couloir:      '#F5F5F5', entree:       '#FFF9C4', commun:       '#F1F5F9',
  therapie:     '#E8F5E9', soins:        '#FCE4EC', accueil:      '#FFFDE7',
  vestiaire:    '#E8EAF6', stockage:     '#ECEFF1', restauration: '#FFF8E1',
};

const ROOM_TYPE_OPTIONS: ReadonlyArray<{ value: RoomType; label: string }> = [
  { value: 'accueil',      label: 'Accueil / Hall'          },
  { value: 'salon',        label: 'Salon / Séjour'          },
  { value: 'cuisine',      label: 'Cuisine'                 },
  { value: 'restauration', label: 'Restauration collective'  },
  { value: 'chambre',      label: 'Chambre'                 },
  { value: 'bureau',       label: 'Bureau'                  },
  { value: 'therapie',     label: 'Thérapie / Kiné'         },
  { value: 'soins',        label: 'Soins / Médical'         },
  { value: 'sdb',          label: 'Salle de bain'           },
  { value: 'wc',           label: 'WC'                      },
  { value: 'vestiaire',    label: 'Vestiaire'               },
  { value: 'couloir',      label: 'Couloir / Circulation'   },
  { value: 'entree',       label: 'Entrée / Sas'            },
  { value: 'stockage',     label: 'Stockage / Technique'    },
  { value: 'commun',       label: 'Espace commun'           },
];

const VALID_ROOM_TYPES = new Set<RoomType>(ROOM_TYPE_OPTIONS.map((o) => o.value));
const WET_TYPES        = new Set<RoomType>(['sdb', 'wc', 'vestiaire']);

// ─── Mapping RoomUsage (transcription) → RoomType (canvas) ───────────────────

const USAGE_TO_ROOM_TYPE: Record<RoomUsage, RoomType> = {
  chambre:       'chambre',
  salon:         'salon',
  séjour:        'salon',
  cuisine:       'cuisine',
  salle_de_bain: 'sdb',
  wc:            'wc',
  couloir:       'couloir',
  entrée:        'entree',
  dégagement:    'couloir',
  rangement:     'stockage',
  bureau:        'bureau',
  cave:          'stockage',
  garage:        'stockage',
  terrasse:      'commun',
  balcon:        'commun',
  loggia:        'commun',
  combles:       'stockage',
  inconnu:       'commun',
};

function detectedRoomToRoomShape(
  dr: PlanTranscriptionResult['rooms'][number],
  index: number,
  calibration: import('../plan-reader/planScaleCalibrator').ScaleCalibration | null = null,
): RoomShape {
  const width  = dr.bounding_box.bottomRight.x - dr.bounding_box.topLeft.x;
  const height = dr.bounding_box.bottomRight.y - dr.bounding_box.topLeft.y;
  const type   = USAGE_TO_ROOM_TYPE[dr.usage] ?? 'commun';

  // Surface : uniquement depuis la calibration utilisateur — jamais depuis l'IA
  const calibratedSurface = computeSurface_m2(
    dr.bounding_box.topLeft,
    dr.bounding_box.bottomRight,
    calibration,
  );

  return {
    id:        `trans-${dr.id}-${index}`,
    name:      dr.nom,
    type,
    surface:   calibratedSurface ?? 0, // 0 si pas de calibration
    x:         Math.max(0, dr.bounding_box.topLeft.x),
    y:         Math.max(0, dr.bounding_box.topLeft.y),
    width:     Math.max(0.02, width),
    height:    Math.max(0.02, height),
    isWetZone: isWetZone(dr.usage),
    isNew:     false,
  };
}

// ─── Utilitaire : DataURL → File ──────────────────────────────────────────────

function dataUrlToFile(dataUrl: string, filename: string): File | null {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match || !match[1] || !match[2]) return null;

  const mime  = match[1] as 'image/png' | 'image/jpeg' | 'image/webp';
  const bstr  = atob(match[2]);
  let n       = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

// ─── IA : validation du layout (appel direct allégé) ─────────────────────────
// Feedback qualitatif sur la répartition programmatique — ne remplace pas
// la transcription structurelle (supabase/functions/transcribe-rehab-plan).

async function validateLayoutWithAI(
  rooms: RoomShape[],
  totalSurface: number,
): Promise<string> {
  if (rooms.length === 0) return '';

  const summary = rooms
    .map((r) => `• ${r.name || '(sans nom)'} — ${r.type}, ${r.surface} m²${r.isWetZone ? ' 💧' : ''}`)
    .join('\n');
  const drawn = rooms.reduce((s, r) => s + r.surface, 0);

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'anthropic-version': '2023-06-01',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages:   [{
          role:    'user',
          content: `Tu es un architecte expert en réhabilitation française. Analyse ce layout (3-4 lignes max) :

Bâtiment : ${totalSurface} m² | Surface dessinée : ${drawn} m²
${summary}

Donne un feedback court sur :
1. Cohérence surface totale vs surface dessinée
2. Zones humides correctement typées (jamais dans commun/bureau)
3. Une suggestion concrète d'amélioration

Format : texte direct, sans titres ni listes.`,
        }],
      }),
    });

    const data = await response.json() as { content: Array<{ type: string; text?: string }> };
    return data.content?.map((b) => b.text ?? '').join('') ?? '';
  } catch {
    return 'Impossible de contacter l\'assistant. Vérifiez votre connexion.';
  }
}

// ─── RoomModal ────────────────────────────────────────────────────────────────

const RoomModal: React.FC<{
  room:      RoomShape;
  onSave:    (r: RoomShape) => void;
  onDelete?: () => void;
  onClose:   () => void;
}> = ({ room, onSave, onDelete, onClose }) => {
  const [data, setData] = useState<RoomShape>({ ...room });

  const upd = <K extends keyof RoomShape>(k: K, v: RoomShape[K]) =>
    setData((d) => ({ ...d, [k]: v }));

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 9,
    border: '1.5px solid #E5E7EB', fontSize: 13, outline: 'none',
    fontFamily: 'system-ui', color: '#1C1C1C', boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  const canSave = data.name.trim().length > 0 || data.surface > 0;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 18, padding: '24px',
          width: 360, boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
          fontFamily: 'system-ui',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 14, height: 14, borderRadius: 3,
              background: ROOM_COLORS[data.type] ?? '#F9FAFB',
              border: '1.5px solid #D1D5DB',
            }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1C1C1C' }}>
              {room.name ? 'Modifier la pièce' : 'Nouvelle pièce'}
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 4 }}
          >
            <X size={17} color="#9CA3AF" />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {/* Nom */}
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
              Nom de la pièce
            </label>
            <input
              style={inp}
              value={data.name}
              autoFocus
              placeholder="Ex : Chambre 1, Salle de soins…"
              onChange={(e) => upd('name', e.target.value)}
              onFocus={(e)  => (e.target.style.borderColor = ACCENT)}
              onBlur={(e)   => (e.target.style.borderColor = '#E5E7EB')}
            />
          </div>

          {/* Type */}
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
              Type
            </label>
            <select
              style={{ ...inp, cursor: 'pointer', background: '#FAFAFA' }}
              value={data.type}
              onChange={(e) => {
                const t = e.target.value as RoomType;
                upd('type', t);
                upd('isWetZone', WET_TYPES.has(t));
              }}
            >
              {ROOM_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Surface */}
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
              Surface (m²)
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                style={{ ...inp, flex: 1, textAlign: 'right', fontWeight: 700, fontSize: 16, color: ACCENT_DARK }}
                type="number"
                min={0}
                value={data.surface || ''}
                placeholder="0"
                onChange={(e) => upd('surface', Math.max(0, Number(e.target.value)))}
                onFocus={(e) => (e.target.style.borderColor = ACCENT)}
                onBlur={(e)  => (e.target.style.borderColor = '#E5E7EB')}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#9CA3AF', flexShrink: 0 }}>m²</span>
            </div>
          </div>

          {/* Zone humide */}
          <div
            onClick={() => upd('isWetZone', !data.isWetZone)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
              padding: '9px 12px', borderRadius: 9,
              background: data.isWetZone ? '#EFF6FF' : '#F9FAFB',
              border: `1.5px solid ${data.isWetZone ? '#93C5FD' : '#E5E7EB'}`,
              transition: 'all 0.15s',
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: 4, flexShrink: 0,
              border: `2px solid ${data.isWetZone ? '#3B82F6' : '#D1D5DB'}`,
              background: data.isWetZone ? '#3B82F6' : 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}>
              {data.isWetZone && <Check size={11} color="white" strokeWidth={3} />}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Zone humide</div>
              <div style={{ fontSize: 10, color: '#9CA3AF' }}>SdB, WC, douche, cuisine collective</div>
            </div>
            {data.isWetZone && <span style={{ marginLeft: 'auto', fontSize: 16 }}>💧</span>}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          {onDelete && (
            <button
              onClick={onDelete}
              style={{
                padding: '10px 12px', borderRadius: 9,
                border: '1px solid #FCA5A5', background: '#FEF2F2',
                color: '#DC2626', cursor: 'pointer', display: 'flex', alignItems: 'center',
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px', borderRadius: 9,
              border: '1px solid #E5E7EB', background: 'white',
              color: '#6B7280', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'system-ui',
            }}
          >
            Annuler
          </button>
          <button
            onClick={() => { if (canSave) { onSave(data); onClose(); } }}
            disabled={!canSave}
            style={{
              flex: 2, padding: '10px', borderRadius: 9, border: 'none',
              background: canSave ? GRAD : '#E5E7EB',
              color: canSave ? 'white' : '#9CA3AF',
              fontSize: 13, fontWeight: 700,
              cursor: canSave ? 'pointer' : 'not-allowed',
              fontFamily: 'system-ui',
            }}
          >
            Valider
          </button>
        </div>

        {!canSave && (
          <p style={{ margin: '6px 0 0', fontSize: 10, color: '#9CA3AF', textAlign: 'center', fontFamily: 'system-ui' }}>
            Saisissez au moins un nom ou une surface
          </p>
        )}
      </div>
    </div>
  );
};

// ─── PlanCanvas ───────────────────────────────────────────────────────────────

const PlanCanvas: React.FC<{
  imageUrl:     string;
  rooms:        RoomShape[];
  mode:         EditorMode;
  selectedId:   string | null;
  onAddRoom:    (rect: DrawRect) => void;
  onSelectRoom: (id: string) => void;
}> = ({ imageUrl, rooms, mode, selectedId, onAddRoom, onSelectRoom }) => {
  const containerRef               = useRef<HTMLDivElement>(null);
  const [drawStart,   setDrawStart]   = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<DrawRect | null>(null);
  const [imgLoaded,   setImgLoaded]   = useState(false);

  const toRel = (e: React.MouseEvent): { x: number; y: number } => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left)  / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top)   / r.height)),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (mode !== 'draw') return;
    e.preventDefault();
    const p = toRel(e);
    setDrawStart(p);
    setCurrentRect({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawStart || mode !== 'draw') return;
    const p = toRel(e);
    setCurrentRect({
      x: Math.min(drawStart.x, p.x),
      y: Math.min(drawStart.y, p.y),
      w: Math.abs(p.x - drawStart.x),
      h: Math.abs(p.y - drawStart.y),
    });
  };

  const onMouseUp = () => {
    if (!drawStart || !currentRect || mode !== 'draw') return;
    if (currentRect.w > 0.015 && currentRect.h > 0.015) {
      onAddRoom(currentRect);
    }
    setDrawStart(null);
    setCurrentRect(null);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative', width: '100%',
        cursor:     mode === 'draw' ? 'crosshair' : 'default',
        userSelect: 'none',
        borderRadius: 10, overflow: 'hidden',
        border: `2px solid ${mode === 'draw' ? ACCENT : '#E5E7EB'}`,
        boxShadow: mode === 'draw' ? `0 0 0 3px ${ACCENT}22` : 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { setDrawStart(null); setCurrentRect(null); }}
    >
      {/* Plan source */}
      <img
        src={imageUrl}
        alt="Plan source"
        draggable={false}
        onLoad={() => setImgLoaded(true)}
        style={{ width: '100%', display: 'block', pointerEvents: 'none' }}
      />

      {/* Overlay SVG des pièces */}
      {imgLoaded && (
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id="cp-wet-hatch"
              patternUnits="userSpaceOnUse"
              width="7" height="7"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="7" stroke="#3B82F6" strokeWidth="1.2" opacity="0.45" />
            </pattern>
          </defs>

          {rooms.map((room) => {
            const isSelected = room.id === selectedId;
            const bg   = ROOM_COLORS[room.type] ?? '#F9FAFB';
            const sw   = isSelected ? 2.5 : 1.5;
            const sc   = isSelected ? ACCENT : '#6B7280';
            const pct  = (v: number) => `${v * 100}%`;
            const cx   = (room.x + room.width  / 2) * 100;
            const cy   = (room.y + room.height / 2) * 100;

            // Font size proportionnel à la largeur réelle de la boîte (% de la largeur du SVG)
            // room.width est en [0–1] → width en % = room.width * 100
            // On divise par la longueur du nom pour adapter au contenu
            const nameFontSz = Math.max(
              7,
              Math.min(12, (room.width * 100) / Math.max(room.name.length, 6) * 1.6),
            );

            return (
              <g
                key={room.id}
                style={{ cursor: mode === 'select' ? 'pointer' : 'crosshair' }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (mode === 'select') onSelectRoom(room.id);
                }}
              >
                {/* Fond de pièce */}
                <rect
                  x={pct(room.x)} y={pct(room.y)}
                  width={pct(room.width)} height={pct(room.height)}
                  fill={bg} stroke={sc} strokeWidth={sw}
                  strokeDasharray={room.isNew ? '5 3' : undefined}
                  opacity={0.80}
                />

                {/* Hachures zones humides */}
                {room.isWetZone && (
                  <rect
                    x={pct(room.x)} y={pct(room.y)}
                    width={pct(room.width)} height={pct(room.height)}
                    fill="url(#cp-wet-hatch)" opacity={0.55}
                  />
                )}

                {/* Nom */}
                <text
                  x={`${cx}%`} y={`${cy - 1}%`}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={`${nameFontSz}%`}
                  fontWeight="600" fill="#1C1C1C"
                  style={{ fontFamily: 'system-ui, sans-serif', pointerEvents: 'none' }}
                >
                  {room.name}
                </text>

                {/* Surface */}
                {room.surface > 0 && (
                  <text
                    x={`${cx}%`} y={`${cy + 1.8}%`}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={`${Math.max(0.6, nameFontSz * 0.75)}%`}
                    fill="#6B7280"
                    style={{ fontFamily: 'system-ui, sans-serif', pointerEvents: 'none' }}
                  >
                    {room.surface} m²
                  </text>
                )}

                {/* Badge CRÉÉ pour pièces ajoutées manuellement */}
                {room.isNew && (
                  <text
                    x={`${cx}%`} y={`${cy + 3.8}%`}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="0.7%" fill={ACCENT}
                    style={{ fontFamily: 'system-ui, sans-serif', pointerEvents: 'none' }}
                  >
                    CRÉÉ
                  </text>
                )}
              </g>
            );
          })}

          {/* Rectangle de dessin en cours */}
          {currentRect && currentRect.w > 0 && (
            <rect
              x={`${currentRect.x * 100}%`} y={`${currentRect.y * 100}%`}
              width={`${currentRect.w * 100}%`} height={`${currentRect.h * 100}%`}
              fill={ACCENT_LIGHT} fillOpacity={0.45}
              stroke={ACCENT} strokeWidth={2}
              strokeDasharray="7 3"
            />
          )}
        </svg>
      )}
    </div>
  );
};

// ─── Page principale ──────────────────────────────────────────────────────────

const CreationPlanPage: React.FC = () => {
  const { plan: storePlan, updatePlan } = useRehabilitationProject();
  const typedStore = (storePlan ?? {}) as RehabilitationPlanSource;

  // ── Pipeline transcription ─────────────────────────────────────────────────
  const {
    activeEntry,
    isProcessing:    isTranscribing,
    lastError:       transcriptionError,
    transcribe,
  } = usePlanTranscription();

  const transcriptionResult: PlanTranscriptionResult | null =
    activeEntry?.status === 'completed' ? (activeEntry.result ?? null) : null;

  // ── Calibration d'échelle (obligatoire pour surfaces fiables) ─────────────
  const planId = transcriptionResult?.plan_id ?? typedStore.planId ?? 'default';
  const calib  = useScaleCalibrator(planId);
  const { calibratorState } = calib;
  const hasCalibration = calibratorState.status === 'calibrated' && !!calibratorState.calibration;

  // Compteur de déclenchement du mode "tracé du contour" dans PlanLayerViewer
  const [outlineTrigger, setOutlineTrigger] = useState(0);

  // ── Surface de référence (saisie manuelle obligatoire) ───────────────────
  const [surfaceTotale, setSurfaceTotale] = useState<number>(
    typedStore.detectedSurface ?? 0,
  );
  // On ne copie plus la valeur IA automatiquement — l'utilisateur doit valider
  // useEffect(() => { ... }) supprimé intentionnellement

  // ── État canvas ───────────────────────────────────────────────────────────
  const [rooms,       setRooms]       = useState<RoomShape[]>([]);
  const [editorMode,  setEditorMode]  = useState<EditorMode>('draw');
  const [viewMode,    setViewMode]    = useState<ViewMode>('canvas');
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [editingRoom, setEditingRoom] = useState<RoomShape | null>(null);

  // ── État UI ───────────────────────────────────────────────────────────────
  const [aiValidating, setAiValidating] = useState(false);
  const [aiFeedback,   setAiFeedback]   = useState<{
    type: 'ok' | 'error' | 'info';
    text: string;
  } | null>(null);

  // ── Import des pièces à la complétion de transcription ────────────────────
  const lastImportedPlanId = useRef<string | null>(null);

  useEffect(() => {
    if (
      transcriptionResult !== null &&
      transcriptionResult.plan_id !== lastImportedPlanId.current &&
      transcriptionResult.rooms.length > 0
    ) {
      const mapped = transcriptionResult.rooms.map((r, i) =>
        detectedRoomToRoomShape(r, i, calibratorState.calibration),
      );
      setRooms(mapped);
      lastImportedPlanId.current = transcriptionResult.plan_id;
      setAiFeedback({
        type: hasCalibration ? 'ok' : 'info',
        text: hasCalibration
          ? `✓ ${mapped.length} pièces importées avec surfaces calibrées.`
          : `${mapped.length} pièces détectées — calibrez l'échelle pour obtenir les surfaces réelles.`,
      });

      if (transcriptionResult.walls.length > 0) {
        initValidationForPlan(transcriptionResult.plan_id, transcriptionResult.walls);
      }
      setViewMode('vector');
    }
  }, [transcriptionResult, hasCalibration, calibratorState.calibration]);

  // ── Recalcul des surfaces si la calibration change ────────────────────────
  useEffect(() => {
    if (!hasCalibration || rooms.length === 0) return;
    setRooms((prev) =>
      prev.map((room) => {
        const m2 = computeSurface_m2(
          { x: room.x, y: room.y },
          { x: room.x + room.width, y: room.y + room.height },
          calibratorState.calibration,
        );
        return m2 !== null ? { ...room, surface: m2 } : room;
      }),
    );
  }, [hasCalibration, calibratorState.calibration]);

  // ── Totaux ─────────────────────────────────────────────────────────────────
  const totalDrawn = useMemo(
    () => rooms.reduce((s, r) => s + r.surface, 0),
    [rooms],
  );
  const surfaceGap = totalDrawn - surfaceTotale;
  const surfaceOk  = Math.abs(surfaceGap) / Math.max(surfaceTotale, 1) < 0.12;

  // ── Qualité de calibration + détection d'écart de surface ─────────────────
  const calibrationAssessment = useMemo(
    () => hasCalibration && calibratorState.calibration
      ? assessCalibrationQuality(calibratorState.calibration)
      : null,
    [hasCalibration, calibratorState.calibration],
  );

  const surfaceMismatch = useMemo(
    () => hasCalibration && calibratorState.calibration
        && totalDrawn > 0 && surfaceTotale > 0
      ? assessSurfaceMismatch({
          calculatedM2: totalDrawn,
          referenceM2:  surfaceTotale,
          calibration:  calibratorState.calibration,
        })
      : null,
    [hasCalibration, calibratorState.calibration, totalDrawn, surfaceTotale],
  );

  // ── Surface totale calculée depuis la transcription + calibration ──────────
  // Disponible dès que la calibration est faite, même sans import dans le canvas.
  // = somme des surfaces des pièces détectées par l'IA, recalculées géométriquement.
  // N'inclut pas l'épaisseur des murs (légèrement sous-estimée vs surface brute).
  const totalTranscriptionSurface = useMemo<number | null>(() => {
    if (!hasCalibration || !calibratorState.calibration || !transcriptionResult) return null;
    let total = 0;
    for (const room of transcriptionResult.rooms) {
      const s = computeSurface_m2(
        room.bounding_box.topLeft,
        room.bounding_box.bottomRight,
        calibratorState.calibration,
      );
      if (s !== null && s > 0) total += s;
    }
    return total > 0 ? Math.round(total * 10) / 10 : null;
  }, [hasCalibration, calibratorState.calibration, transcriptionResult]);

  const hasImage = !!typedStore.imageDataUrl;

  // ── Ajout d'une pièce par dessin ──────────────────────────────────────────
  const handleAddRoom = useCallback((rect: DrawRect) => {
    // Surface uniquement si calibration disponible — jamais d'estimation arbitraire
    const calibratedSurface = computeSurface_m2(
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      calibratorState.calibration,
    );

    const newRoom: RoomShape = {
      id:        `r-${Date.now()}`,
      name:      '',
      type:      'commun',
      surface:   calibratedSurface ?? 0,
      x: rect.x, y: rect.y, width: rect.w, height: rect.h,
      isWetZone: false,
      isNew:     true,
    };
    setEditingRoom(newRoom);
    setAiFeedback(null);
  }, [calibratorState.calibration]);

  // ── Sélection d'une pièce (mode select) ───────────────────────────────────
  const handleSelectRoom = useCallback((id: string) => {
    const room = rooms.find((r) => r.id === id);
    if (room) { setSelectedId(id); setEditingRoom(room); }
  }, [rooms]);

  // ── Sauvegarde depuis modal ───────────────────────────────────────────────
  const handleSaveRoom = useCallback((room: RoomShape) => {
    setRooms((prev) => {
      const idx = prev.findIndex((r) => r.id === room.id);
      return idx >= 0
        ? prev.map((r, i) => (i === idx ? room : r))
        : [...prev, room];
    });
    setSelectedId(null);
    setAiFeedback(null);
  }, []);

  // ── Suppression ───────────────────────────────────────────────────────────
  const handleDeleteRoom = useCallback((id: string) => {
    setRooms((prev) => prev.filter((r) => r.id !== id));
    setEditingRoom(null);
    setSelectedId(null);
  }, []);

  // ── IA : lire le plan via le pipeline de transcription ────────────────────
  const handleAIRead = useCallback(async () => {
    if (!typedStore.imageDataUrl || isTranscribing) return;

    const file = dataUrlToFile(
      typedStore.imageDataUrl,
      typedStore.fileName ?? 'plan.jpg',
    );
    if (!file) {
      setAiFeedback({ type: 'error', text: 'Format d\'image non supporté (JPEG, PNG, WebP requis).' });
      return;
    }

    setAiFeedback(null);
    await transcribe(file, {
      detect_walls:       true,
      detect_openings:    true,
      detect_annotations: true,
      expected_surface_m2: surfaceTotale,
      langue_annotations:  'fr',
    });
  }, [typedStore.imageDataUrl, typedStore.fileName, isTranscribing, transcribe, surfaceTotale]);

  // ── IA : valider le layout programmatique ─────────────────────────────────
  const handleAIValidate = useCallback(async () => {
    if (rooms.length === 0 || aiValidating) return;
    setAiValidating(true);
    setAiFeedback(null);
    try {
      const feedback = await validateLayoutWithAI(rooms, surfaceTotale);
      setAiFeedback({ type: 'ok', text: feedback });
    } catch {
      setAiFeedback({ type: 'error', text: 'Impossible de contacter l\'assistant IA.' });
    } finally {
      setAiValidating(false);
    }
  }, [rooms, surfaceTotale, aiValidating]);

  // ── Export DXF ────────────────────────────────────────────────────────────
  const handleExportDxf = useCallback(() => {
    if (!transcriptionResult) return;

    const progress = getValidationProgress();
    const validatedWalls = exportValidatedWalls(
      transcriptionResult.walls as Parameters<typeof exportValidatedWalls>[0],
      { includeRejected: false, includePending: progress.nb_pending === 0 },
    );

    const { width_cm, height_cm } = computeRealPlanDimensions(
      transcriptionResult.echelle_detectee,
      297,  // hypothèse A3 paysage (mm)
      210,
    );

    const result = generateDxf(transcriptionResult, validatedWalls, {
      plan_width_cm:   width_cm,
      plan_height_cm:  height_cm,
      include_rooms:   true,
      include_openings: true,
    });

    downloadDxf(result);
  }, [transcriptionResult]);

  // ── Persistance dans le store Mimmoza ─────────────────────────────────────
  const stableUpdatePlan = useRef(updatePlan);
  stableUpdatePlan.current = updatePlan;

  useEffect(() => {
    if (rooms.length === 0) return;
    const payload: CreationPlanResultPayload = {
      zoning:               `${rooms.length} pièces — ${totalDrawn} m² / ${surfaceTotale} m²`,
      commentary:           rooms.map((r) => `${r.name} (${r.type}, ${r.surface} m²)`).join(' · '),
      budgetMin:            0,
      budgetMax:            0,
      constraintsRespected: [],
      pointsToCheck:        [],
      generatedAt:          new Date().toISOString(),
      lockedWalls:          [],
      source:               'analysis',
    };
    stableUpdatePlan.current({ creationPlanResult: payload as never });
  }, [rooms, totalDrawn, surfaceTotale]);

  // ── Styles communs ────────────────────────────────────────────────────────
  const btnStyle = (
    active: boolean,
    variant: 'primary' | 'secondary' | 'ghost' = 'primary',
  ): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '9px 14px', borderRadius: 9, fontFamily: 'system-ui',
    border: variant === 'ghost' ? `1.5px solid ${active ? ACCENT : '#E5E7EB'}` : 'none',
    background:
      variant === 'primary'   ? (active ? GRAD : '#F3F4F6')
      : variant === 'secondary' ? (active ? ACCENT_LIGHT : 'white')
      : 'transparent',
    color:
      variant === 'primary' ? (active ? 'white' : '#9CA3AF')
      : variant === 'ghost' ? (active ? ACCENT_DARK : '#6B7280')
      : ACCENT_DARK,
    fontSize: 12, fontWeight: 700,
    cursor:     active ? 'pointer' : 'not-allowed',
    transition: 'all 0.15s',
    boxShadow:  variant === 'primary' && active ? '0 2px 8px rgba(249,115,22,0.28)' : 'none',
  });

  const isAiLoading = isTranscribing || aiValidating;
  const canExportDxf = transcriptionResult !== null && transcriptionResult.walls.length > 0;
  const validationProgress = canExportDxf ? getValidationProgress() : null;

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>

      {/* Modal édition pièce */}
      {editingRoom && (
        <RoomModal
          room={editingRoom}
          onSave={handleSaveRoom}
          onDelete={
            editingRoom.id.startsWith('r-') || editingRoom.id.startsWith('ai-') || editingRoom.id.startsWith('trans-')
              ? () => handleDeleteRoom(editingRoom.id)
              : undefined
          }
          onClose={() => { setEditingRoom(null); setSelectedId(null); }}
        />
      )}

      {/* ── Bannière ──────────────────────────────────────────────────────── */}
      <div style={{
        background: GRAD, borderRadius: 24, padding: '32px 36px', marginBottom: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 20,
        boxShadow: '0 8px 32px rgba(234,88,12,0.22)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>

            Réhabilitation · Assistant plan
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 600, color: '#fff', marginBottom: 10, lineHeight: 1.1, letterSpacing: '-0.025em' }}>

            Assistant plan
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', maxWidth: 460, lineHeight: 1.55, margin: 0 }}>
            Dessin · Transcription IA · Vue vectorielle
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Chip info */}
          <div style={{
            display: 'flex', gap: 10, alignItems: 'center',
            padding: '6px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.25)',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'white' }}>
              {rooms.length} pièce{rooms.length !== 1 ? 's' : ''}
            </span>
            <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.3)' }} />
            {/* Surface canvas (si pièces importées) */}
            {totalDrawn > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: surfaceOk ? '#86efac' : '#fca5a5' }}>
                {totalDrawn.toFixed(1)} / {surfaceTotale > 0 ? surfaceTotale : '—'} m²
              </span>
            )}
            {/* Surface transcription calibrée (si pas de pièces canvas) */}
            {totalDrawn === 0 && totalTranscriptionSurface !== null && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#86efac' }}>
                ≈ {totalTranscriptionSurface} m²
              </span>
            )}
            {totalDrawn === 0 && totalTranscriptionSurface === null && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>— m²</span>
            )}
            {/* État transcription */}
            {isTranscribing && (
              <>
                <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.3)' }} />
                <span style={{ fontSize: 10, color: '#FCD34D', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} />
                  Analyse IA…
                </span>
              </>
            )}
            {transcriptionResult && !isTranscribing && (
              <>
                <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.3)' }} />
                <span style={{ fontSize: 10, color: '#86efac' }}>
                  ✓ {Math.round(transcriptionResult.score_confiance_global * 100)}% fiabilité
                </span>
              </>
            )}
          </div>

          {/* Export DXF */}
          {canExportDxf && (
            <button
              onClick={handleExportDxf}
              title={validationProgress ? `${validationProgress.nb_porteur + validationProgress.nb_cloison} murs validés` : 'Exporter DXF'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                color: 'white', fontSize: 11, fontWeight: 600,
              }}
            >
              <Download size={12} /> DXF
            </button>
          )}

          {rooms.length > 0 && (
            <button
              onClick={() => { setRooms([]); setAiFeedback(null); }}
              style={{
                ...btnStyle(true, 'ghost'),
                background: 'rgba(255,255,255,0.12)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.3)',
              }}
            >
              <Trash2 size={12} /> Tout effacer
            </button>
          )}
        </div>
      </div>

      {/* ── Layout principal ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '272px 1fr', gap: 16 }}>

        {/* ── PANNEAU GAUCHE ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* ── Calibration d'échelle (workflow obligatoire) ──────────── */}
          <div style={{
            background: hasCalibration ? 'white' : '#FFFBEB',
            borderRadius: 12, padding: '14px 16px',
            border: `1px solid ${
              !hasCalibration ? '#FDE68A'
              : calibrationAssessment?.quality === 'faible' ? '#FDE68A'
              : '#86EFAC'
            }`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              📐 Calibration d'échelle
            </div>

            {/* ── Étapes du workflow surface ─────────────────────────── */}
            <div style={{
              display: 'flex', gap: 4, marginBottom: 10, alignItems: 'center',
              fontSize: 9, color: '#9CA3AF',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 3,
                padding: '2px 7px', borderRadius: 8,
                background: hasCalibration ? '#F0FDF4' : ACCENT_LIGHT,
                border: `1px solid ${hasCalibration ? '#86EFAC' : ACCENT}`,
                color: hasCalibration ? '#166534' : ACCENT_DARK, fontWeight: 700,
              }}>
                {hasCalibration ? '✓' : '①'} Calibrer
              </div>
              <span style={{ color: '#D1D5DB' }}>→</span>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 3,
                padding: '2px 7px', borderRadius: 8,
                background: '#F9FAFB', border: '1px solid #E5E7EB',
                color: hasCalibration ? '#374151' : '#D1D5DB', fontWeight: 700,
              }}>
                ② Contour
              </div>
              <span style={{ color: '#D1D5DB' }}>→</span>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 3,
                padding: '2px 7px', borderRadius: 8,
                background: '#F9FAFB', border: '1px solid #E5E7EB',
                color: '#D1D5DB', fontWeight: 700,
              }}>
                ③ Surface
              </div>
            </div>

            {hasCalibration && calibratorState.calibration ? (
              <>
                {/* Étiquette de l'échelle */}
                <div style={{
                  padding: '7px 10px', borderRadius: 7, marginBottom: 6,
                  background: calibrationAssessment?.quality === 'faible' ? '#FFFBEB' : '#F0FDF4',
                  border: `1px solid ${calibrationAssessment?.quality === 'faible' ? '#FDE68A' : '#86EFAC'}`,
                  fontSize: 10, fontWeight: 600,
                  color: calibrationAssessment?.quality === 'faible' ? '#92400E' : '#166534',
                }}>
                  ✓ {formatCalibrationLabel(calibratorState.calibration)}
                </div>

                {/* Qualité */}
                {calibrationAssessment && (
                  <div style={{
                    padding: '6px 9px', borderRadius: 6, marginBottom: 8,
                    background: calibrationAssessment.quality === 'bonne' ? '#F0FDF4'
                      : calibrationAssessment.quality === 'acceptable' ? '#FFFBEB' : '#FEF2F2',
                    border: `1px solid ${calibrationAssessment.quality === 'bonne' ? '#86EFAC'
                      : calibrationAssessment.quality === 'acceptable' ? '#FDE68A' : '#FCA5A5'}`,
                    fontSize: 9,
                    color: calibrationAssessment.quality === 'bonne' ? '#166534'
                      : calibrationAssessment.quality === 'acceptable' ? '#92400E' : '#991B1B',
                  }}>
                    {calibrationAssessment.quality === 'bonne' ? '✓' : '⚠'}{' '}
                    Précision {calibrationAssessment.quality} — {calibrationAssessment.message}
                  </div>
                )}

                {/* Conseils si précision insuffisante */}
                {calibrationAssessment && calibrationAssessment.tips.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {calibrationAssessment.tips.map((tip, i) => (
                      <div key={i} style={{
                        fontSize: 9, color: '#92400E', marginBottom: 3,
                        paddingLeft: 8, borderLeft: '2px solid #FDE68A',
                      }}>
                        {tip}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── ÉTAPE 2 : Tracer le contour ───────────────────── */}
                <div style={{
                  padding: '10px 12px', borderRadius: 8, marginBottom: 6,
                  background: 'linear-gradient(135deg,#fff7ed,#fef3c7)',
                  border: `1.5px solid ${ACCENT}`,
                }}>
                  <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color: ACCENT_DARK }}>
                    ② Tracer le contour du bâtiment
                  </p>
                  <p style={{ margin: '0 0 8px', fontSize: 9, color: '#92400E', lineHeight: 1.5 }}>
                    Cliquez sur chaque sommet (angle) du bâtiment dans l'ordre, puis "Terminer".
                    La surface sera calculée automatiquement.
                  </p>
                  <button
                    onClick={() => {
                      setViewMode('vector');
                      setOutlineTrigger((t) => t + 1);
                    }}
                    disabled={!hasImage}
                    style={{
                      width: '100%', padding: '9px', borderRadius: 7, border: 'none',
                      background: hasImage ? 'linear-gradient(90deg,#f97316,#ef4444)' : '#E5E7EB',
                      color: hasImage ? 'white' : '#9CA3AF',
                      fontSize: 11, fontWeight: 700,
                      cursor: hasImage ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    ⬡ Tracer le contour du bâtiment
                  </button>
                </div>

                <button
                  onClick={() => { startCalibration(); setViewMode('vector'); }}
                  style={{ ...btnStyle(true, 'ghost'), width: '100%', fontSize: 10 }}
                >
                  ↺ Recalibrer l'échelle (étape 1)
                </button>
              </>
            ) : (
              <>
                <div style={{
                  padding: '7px 9px', borderRadius: 7, marginBottom: 8,
                  background: '#FFFBEB', border: '1px solid #FDE68A',
                  fontSize: 10, color: '#92400E', lineHeight: 1.5,
                }}>
                  ⚠ Commencez par calibrer l'échelle : cliquez 2 points sur le plan
                  correspondant à une distance connue (ex. : "6,00" sur une cote).
                </div>
                <button
                  onClick={() => { startCalibration(); setViewMode('vector'); }}
                  disabled={!hasImage}
                  style={{ ...btnStyle(hasImage, 'primary'), width: '100%' }}
                >
                  ① Calibrer l'échelle
                </button>
              </>
            )}
          </div>

          {/* ── Surface de référence (saisie manuelle) ─────────────────── */}
          <div style={{ background: 'white', borderRadius: 12, padding: '14px 16px', border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              Surface de référence (m²)
            </div>
            <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 8, lineHeight: 1.5 }}>
              Surface connue du bâtiment (permis de construire, état des lieux…).
              N'est pas calculée par l'IA.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <input
                type="number" min={1} value={surfaceTotale || ''}
                placeholder="ex. 320"
                onChange={(e) => setSurfaceTotale(Math.max(0, Number(e.target.value)))}
                style={{
                  flex: 1, minWidth: 0, width: 0,
                  padding: '7px 10px', borderRadius: 8,
                  border: `1.5px solid ${surfaceTotale > 0 ? ACCENT : '#E5E7EB'}`,
                  fontSize: 20, fontWeight: 800, color: ACCENT_DARK,
                  outline: 'none', textAlign: 'right',
                  fontFamily: 'system-ui', boxSizing: 'border-box',
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#9CA3AF', flexShrink: 0 }}>m²</span>
            </div>

            {/* ── Surface calculée depuis la transcription + calibration ── */}
            {/* Affiché dès que calibration OK + transcription disponible,     */}
            {/* même si aucune pièce n'a encore été importée dans le canvas.   */}
            {hasCalibration && totalTranscriptionSurface !== null && (
              <div style={{
                marginTop: 8, padding: '10px 12px', borderRadius: 8,
                background: 'linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)',
                border: `1px solid ${ACCENT}55`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Surface IA recalibrée
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 900, color: ACCENT_DARK }}>
                    {totalTranscriptionSurface} m²
                  </span>
                </div>
                <p style={{ margin: '0 0 7px', fontSize: 9, color: '#B45309', lineHeight: 1.5 }}>
                  Somme des {transcriptionResult?.rooms.length ?? 0} pièces détectées par l'IA,
                  recalculée avec votre calibration ({Math.round(calibratorState.calibration?.pixelsPerMeter ?? 0)} px/m).
                  Les épaisseurs de murs ne sont pas incluses (surface légèrement sous-estimée).
                </p>

                {/* Proposition d'adopter comme référence */}
                {(surfaceTotale === 0 || Math.abs(totalTranscriptionSurface - surfaceTotale) / Math.max(surfaceTotale, 1) > 0.05) && (
                  <button
                    onClick={() => setSurfaceTotale(Math.round(totalTranscriptionSurface))}
                    style={{
                      width: '100%', padding: '6px', borderRadius: 7,
                      border: `1px solid ${ACCENT}`,
                      background: ACCENT_LIGHT, color: ACCENT_DARK,
                      fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    ✓ Utiliser {Math.round(totalTranscriptionSurface)} m² comme référence
                  </button>
                )}
              </div>
            )}

            {/* Inviter à transcrire si calibration OK mais pas encore de transcription */}
            {hasCalibration && !transcriptionResult && totalDrawn === 0 && (
              <div style={{
                marginTop: 8, padding: '8px 10px', borderRadius: 7,
                background: ACCENT_LIGHT, border: `1px solid ${ACCENT}44`,
                fontSize: 9, color: ACCENT_DARK, lineHeight: 1.5,
              }}>
                💡 Calibration effectuée. Lancez <strong>Transcrire le plan (IA)</strong> pour calculer automatiquement la surface totale.
              </div>
            )}

            {/* Écart surface calibrée vs référence */}
            {hasCalibration && totalDrawn > 0 && surfaceTotale > 0 && (
              <div style={{
                marginTop: 8, padding: '5px 9px', borderRadius: 7,
                background: surfaceOk ? '#F0FDF4' : Math.abs(surfaceGap) / surfaceTotale < 0.25 ? '#FFFBEB' : '#FEF2F2',
                border: `1px solid ${surfaceOk ? '#86EFAC' : Math.abs(surfaceGap) / surfaceTotale < 0.25 ? '#FDE68A' : '#FCA5A5'}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: surfaceOk ? '#166534' : '#92400E' }}>
                  Calculé : {totalDrawn.toFixed(1)} m²
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, color: surfaceOk ? '#16a34a' : surfaceGap > 0 ? '#DC2626' : '#D97706' }}>
                  {surfaceGap > 0 ? '+' : ''}{surfaceGap.toFixed(1)} m²
                </span>
              </div>
            )}

            {/* Warning écart significatif + conseils */}
            {surfaceMismatch && (
              <div style={{
                marginTop: 8, padding: '10px 12px', borderRadius: 8,
                background: surfaceMismatch.isCritical ? '#FEF2F2' : '#FFFBEB',
                border: `1px solid ${surfaceMismatch.isCritical ? '#FCA5A5' : '#FDE68A'}`,
              }}>
                <p style={{
                  margin: '0 0 7px', fontSize: 10, fontWeight: 700,
                  color: surfaceMismatch.isCritical ? '#991B1B' : '#92400E',
                }}>
                  {surfaceMismatch.isCritical ? '⚠ Écart critique' : '⚠ Écart important'} ({Math.round(surfaceMismatch.ecartPct * 100)}%) —
                  surface calculée {surfaceMismatch.ecartM2 > 0 ? 'trop grande' : 'trop petite'}.
                </p>
                <p style={{ margin: '0 0 5px', fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Pour corriger :
                </p>
                {surfaceMismatch.tips.map((tip, i) => (
                  <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 3, fontSize: 9, color: surfaceMismatch.isCritical ? '#991B1B' : '#92400E' }}>
                    <span style={{ flexShrink: 0, fontWeight: 700 }}>→</span>
                    <span>{tip}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                  <button
                    onClick={() => { startCalibration(); setViewMode('vector'); }}
                    disabled={!hasImage}
                    style={{
                      padding: '7px', borderRadius: 7, border: 'none',
                      background: 'linear-gradient(90deg,#f97316,#ef4444)',
                      color: 'white', fontSize: 10, fontWeight: 700,
                      cursor: hasImage ? 'pointer' : 'not-allowed',
                    }}
                  >
                    📐 Recalibrer l'échelle
                  </button>
                  <button
                    onClick={() => setSurfaceTotale(Math.round(totalDrawn))}
                    style={{
                      padding: '6px', borderRadius: 7,
                      border: `1px solid ${ACCENT}`,
                      background: ACCENT_LIGHT, color: ACCENT_DARK,
                      fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Utiliser {totalDrawn.toFixed(0)} m² comme référence
                  </button>
                </div>
              </div>
            )}

            {!hasCalibration && (
              <div style={{ marginTop: 8, fontSize: 9, color: '#D97706', fontStyle: 'italic' }}>
                Les surfaces seront calculées après calibration de l'échelle.
              </div>
            )}
          </div>

          {/* Outils IA */}
          <div style={{ background: 'white', borderRadius: 12, padding: '14px 16px', border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
              Assistant IA
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {/* Transcription vectorielle */}
              <button
                onClick={handleAIRead}
                disabled={!hasImage || isAiLoading}
                style={{ ...btnStyle(hasImage && !isAiLoading, 'primary'), width: '100%' }}
              >
                {isTranscribing
                  ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Analyse en cours…</>
                  : <><Wand2 size={13} /> Transcrire le plan (IA)</>
                }
              </button>

              {/* Valider le layout — bloqué sans calibration */}
              <button
                onClick={handleAIValidate}
                disabled={rooms.length === 0 || isAiLoading || !hasCalibration}
                title={!hasCalibration ? 'Calibrez l\'échelle avant de valider le layout' : undefined}
                style={{ ...btnStyle(rooms.length > 0 && !isAiLoading && hasCalibration, 'ghost'), width: '100%' }}
              >
                {aiValidating
                  ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Validation…</>
                  : <><Sparkles size={12} /> Valider le layout</>
                }
              </button>

              {/* Ré-importer depuis transcription */}
              {transcriptionResult && transcriptionResult.rooms.length > 0 && (
                <button
                  onClick={() => {
                    const mapped = transcriptionResult.rooms.map((r, i) => detectedRoomToRoomShape(r, i));
                    setRooms(mapped);
                    lastImportedPlanId.current = transcriptionResult.plan_id;
                    setAiFeedback({ type: 'info', text: `${mapped.length} pièces rechargées depuis la transcription.` });
                  }}
                  style={{ ...btnStyle(true, 'ghost'), width: '100%', fontSize: 10 }}
                >
                  ↺ Recharger {transcriptionResult.rooms.length} pièces IA
                </button>
              )}
            </div>

            {/* Alertes */}
            {!hasImage && (
              <div style={{
                marginTop: 9, display: 'flex', gap: 7, alignItems: 'flex-start',
                padding: '7px 9px', borderRadius: 7,
                background: '#FEF2F2', border: '1px solid #FCA5A5',
                fontSize: 10, color: '#991B1B',
              }}>
                <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                Aucune image disponible. Analysez d'abord un plan dans "Analyse du plan".
              </div>
            )}

            {transcriptionError && (
              <div style={{
                marginTop: 9, padding: '7px 9px', borderRadius: 7,
                background: '#FEF2F2', border: '1px solid #FCA5A5',
                fontSize: 10, color: '#991B1B',
              }}>
                ⚠ {transcriptionError.message}
                {transcriptionError.retryable && (
                  <button onClick={handleAIRead} style={{ background: 'none', border: 'none', color: ACCENT_DARK, cursor: 'pointer', fontSize: 10, marginLeft: 6 }}>
                    Réessayer
                  </button>
                )}
              </div>
            )}

            {aiFeedback && (
              <div style={{
                marginTop: 9, padding: '9px 10px', borderRadius: 8,
                fontSize: 11, lineHeight: 1.5,
                background:
                  aiFeedback.type === 'error' ? '#FEF2F2'
                  : aiFeedback.type === 'info' ? ACCENT_LIGHT : '#F0FDF4',
                border: `1px solid ${aiFeedback.type === 'error' ? '#FCA5A5' : aiFeedback.type === 'info' ? '#FED7AA' : '#86EFAC'}`,
                color:
                  aiFeedback.type === 'error' ? '#991B1B'
                  : aiFeedback.type === 'info' ? ACCENT_DARK : '#166534',
              }}>
                {aiFeedback.text}
              </div>
            )}

            {/* Progression validation murs */}
            {validationProgress && validationProgress.total > 0 && (
              <div style={{ marginTop: 9, padding: '7px 9px', borderRadius: 7, background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                <div style={{ fontSize: 9, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
                  Validation murs
                </div>
                <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: '#E5E7EB', gap: 0 }}>
                  <div style={{ width: `${(validationProgress.nb_porteur / validationProgress.total) * 100}%`, background: '#EF4444' }} />
                  <div style={{ width: `${(validationProgress.nb_cloison / validationProgress.total) * 100}%`, background: '#3B82F6' }} />
                  <div style={{ width: `${(validationProgress.nb_rejete  / validationProgress.total) * 100}%`, background: '#6B7280' }} />
                </div>
                <div style={{ fontSize: 9, color: '#6B7280', marginTop: 4 }}>
                  {validationProgress.completion_pct}% validés — {validationProgress.nb_pending} en attente
                </div>
              </div>
            )}
          </div>

          {/* Liste des pièces */}
          <div style={{
            background: 'white', borderRadius: 12, padding: '14px 16px',
            border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            flex: 1, overflowY: 'auto', maxHeight: 360,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
              Pièces ({rooms.length})
            </div>

            {rooms.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>🖊</div>
                <p style={{ margin: 0, fontSize: 11, color: '#9CA3AF', lineHeight: 1.5 }}>
                  {hasImage
                    ? 'Cliquez "Transcrire le plan" ou dessinez des pièces sur le plan'
                    : 'Chargez un plan dans "Analyse du plan"'}
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {rooms.map((room) => {
                  const showSurface = room.surface > 0 && hasCalibration;
                  const surfaceLabel = showSurface
                    ? `${room.surface} m²`
                    : '— m²';
                  return (
                  <div
                    key={room.id}
                    onClick={() => { setSelectedId(room.id); setEditingRoom(room); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '6px 9px', borderRadius: 7, cursor: 'pointer',
                      background: selectedId === room.id ? ACCENT_LIGHT : '#F9FAFB',
                      border: `1px solid ${selectedId === room.id ? ACCENT : '#F3F4F6'}`,
                      transition: 'all 0.1s',
                    }}
                  >
                    <div style={{
                      width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                      background: ROOM_COLORS[room.type] ?? '#F9FAFB',
                      border: '1px solid #D1D5DB',
                    }} />
                    <span style={{
                      fontSize: 12, fontWeight: 500, color: '#374151',
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {room.name || <em style={{ color: '#9CA3AF' }}>Sans nom</em>}
                    </span>
                    {room.isWetZone && <span style={{ fontSize: 10 }}>💧</span>}
                    <span style={{
                      fontSize: 10, fontWeight: 600, flexShrink: 0,
                      color: showSurface ? '#6B7280' : '#FCA5A5',
                      fontStyle: showSurface ? 'normal' : 'italic',
                    }}>
                      {surfaceLabel}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room.id); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#D1D5DB', display: 'flex', flexShrink: 0 }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── PANNEAU DROIT — VUE PRINCIPALE ───────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Barre d'outils supérieure */}
          {hasImage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>

              {/* Toggle vue */}
              <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: '#F3F4F6' }}>
                {([
                  { v: 'canvas' as ViewMode, icon: <PenSquare size={12} />, label: 'Dessin'    },
                  { v: 'vector' as ViewMode, icon: <Layers    size={12} />, label: 'Vectoriel' },
                ] as const).map(({ v, icon, label }) => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '7px 12px', borderRadius: 7, border: 'none',
                      background: viewMode === v ? ACCENT : 'transparent',
                      color: viewMode === v ? 'white' : '#6B7280',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      fontFamily: 'system-ui',
                      boxShadow: viewMode === v ? '0 1px 4px rgba(249,115,22,0.3)' : 'none',
                      transition: 'all 0.15s',
                    }}
                  >
                    {icon} {label}
                    {v === 'vector' && transcriptionResult && (
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, background: 'rgba(255,255,255,0.25)' }}>
                        {transcriptionResult.rooms.length}p · {transcriptionResult.walls.length}m
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Mode éditeur — affiché uniquement en vue canvas */}
              {viewMode === 'canvas' && (
                <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: '#F3F4F6' }}>
                  {([
                    { m: 'draw'   as EditorMode, label: '✏️ Dessiner'    },
                    { m: 'select' as EditorMode, label: '↖ Sélectionner' },
                  ] as const).map(({ m, label }) => (
                    <button
                      key={m}
                      onClick={() => setEditorMode(m)}
                      style={{
                        padding: '7px 13px', borderRadius: 7, border: 'none',
                        background: editorMode === m ? ACCENT : 'transparent',
                        color: editorMode === m ? 'white' : '#6B7280',
                        fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'system-ui',
                        boxShadow: editorMode === m ? '0 1px 4px rgba(249,115,22,0.3)' : 'none',
                        transition: 'all 0.15s',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Instruction contextuelle */}
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 7,
                padding: '6px 12px', borderRadius: 8, fontSize: 11,
                background: viewMode === 'vector' ? '#EFF6FF'
                  : editorMode === 'draw' ? ACCENT_LIGHT : '#EFF6FF',
                border: `1px solid ${viewMode === 'vector' ? '#BFDBFE'
                  : editorMode === 'draw' ? '#FED7AA' : '#BFDBFE'}`,
                color: viewMode === 'vector' ? '#1D4ED8'
                  : editorMode === 'draw' ? ACCENT_DARK : '#1D4ED8',
              }}>
                <Info size={12} style={{ flexShrink: 0 }} />
                {viewMode === 'vector'
                  ? 'Vue vectorielle — cliquez sur un mur pour le valider (porteur / cloison).'
                  : editorMode === 'draw'
                    ? 'Cliquez et glissez pour tracer une pièce. Relâchez pour la configurer.'
                    : 'Cliquez sur un rectangle coloré pour modifier ou supprimer la pièce.'}
              </div>
            </div>
          )}

          {/* Vue canvas — dessin manuel */}
          {hasImage && viewMode === 'canvas' && (
            <PlanCanvas
              imageUrl={typedStore.imageDataUrl!}
              rooms={rooms}
              mode={editorMode}
              selectedId={selectedId}
              onAddRoom={handleAddRoom}
              onSelectRoom={handleSelectRoom}
            />
          )}

          {/* Vue vectorielle — PlanLayerViewer */}
          {hasImage && viewMode === 'vector' && transcriptionResult && (
            <div style={{ borderRadius: 12, overflow: 'hidden', minHeight: 480 }}>
              <PlanLayerViewer
                transcription={transcriptionResult}
                imageUrl={typedStore.imageDataUrl ?? undefined}
                planId={planId}
                triggerOutline={outlineTrigger}
                onBuildingAreaMeasured={(areaM2) => {
                  setSurfaceTotale(Math.round(areaM2));
                  setAiFeedback({ type: 'ok', text: `✓ Surface du bâtiment mesurée : ${areaM2} m² — utilisée comme référence.` });
                }}
              />
            </div>
          )}

          {/* Vue vectorielle sans transcription — calibration + mesure de surface */}
          {hasImage && viewMode === 'vector' && !transcriptionResult && (
            <div style={{ borderRadius: 12, overflow: 'hidden', minHeight: 480 }}>
              <PlanLayerViewer
                imageUrl={typedStore.imageDataUrl ?? undefined}
                planId={planId}
                triggerOutline={outlineTrigger}
                onBuildingAreaMeasured={(areaM2) => {
                  setSurfaceTotale(Math.round(areaM2));
                  setAiFeedback({ type: 'ok', text: `✓ Surface du bâtiment mesurée : ${areaM2} m² — utilisée comme référence.` });
                }}
              />
            </div>
          )}

          {/* Placeholder sans image */}
          {!hasImage && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', minHeight: 480, gap: 14,
              border: '2px dashed #E5E7EB', borderRadius: 12, background: 'white',
            }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: ACCENT_LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileText size={28} color={ACCENT} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: '#92400E' }}>
                  Aucun plan disponible
                </p>
                <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF', lineHeight: 1.6, maxWidth: 320 }}>
                  Rendez-vous dans <strong style={{ color: ACCENT }}>Analyse du plan</strong> pour charger un plan. L'image sera disponible comme fond de canevas.
                </p>
              </div>
            </div>
          )}

          {/* Légende — visible en mode canvas */}
          {rooms.length > 0 && viewMode === 'canvas' && (
            <div style={{
              display: 'flex', gap: 16, flexWrap: 'wrap', padding: '8px 12px',
              borderRadius: 8, background: 'white', border: '1px solid #F3F4F6',
              fontSize: 10, color: '#6B7280',
            }}>
              {[
                { color: '#E8F5E9', label: 'Chambre / Soins', border: '#9CA3AF', dash: false },
                { color: '#E3F2FD', label: 'Zone humide',     border: '#9CA3AF', dash: false },
                { color: ACCENT_LIGHT, label: 'Pièce créée',  border: ACCENT,    dash: true  },
              ].map(({ color, label, border, dash }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{
                    width: 18, height: 12, background: color,
                    border: `1.5px ${dash ? 'dashed' : 'solid'} ${border}`,
                    borderRadius: 2,
                  }} />
                  <span>{label}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>💧</span><span>Zone humide (hachures)</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default CreationPlanPage;