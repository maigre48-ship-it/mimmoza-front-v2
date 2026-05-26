// ─────────────────────────────────────────────────────────────────────────────
// SelectedElementPanel.tsx
// Panel unifié pour tout élément sélectionné (mur, pièce, ouverture, annotation)
// Pour les murs : intègre WallConfirmationToolbar + WallEditorPanel
// Pour les autres : affichage lecture seule des propriétés détectées
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import type { PlanTranscriptionResult } from '../plan-reader/planTranscription.types';
import type { SelectedElementDetail } from '../plan-reader/planOverlay.types';
import { useValidationEngine } from '../plan-reader/planUserValidationEngine';
import type {
  WallValidationRecord,
  WallUserValidationStatus,
} from '../plan-reader/planUserValidationEngine';
import type { WallCorrection } from '../shared/planValidation.types';
import { WallConfirmationToolbar } from './WallConfirmationToolbar';
import { WallEditorPanel } from './WallEditorPanel';
import { confidenceToColor } from '../plan-reader/planVectorGeometry';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SelectedElementPanelProps {
  /**
   * Détail de l'élément sélectionné — null = rien de sélectionné (panel fermé).
   */
  readonly elementDetail: SelectedElementDetail | null;
  /**
   * Plan complet (nécessaire pour retrouver le DetectedWall par id).
   */
  readonly transcription: PlanTranscriptionResult;
  /**
   * Callback de fermeture (désélection).
   */
  readonly onClose: () => void;
  /**
   * Position du panel : 'right' (sidebar) ou 'bottom' (panneau bas).
   * Défaut : 'right'.
   */
  readonly position?: 'right' | 'bottom';
}

// ── Constantes visuelles ──────────────────────────────────────────────────────

const ORANGE       = '#F97316';
const PANEL_BG     = 'rgba(10,10,16,0.98)';
const SURFACE      = 'rgba(255,255,255,0.04)';
const BORDER       = 'rgba(255,255,255,0.07)';
const TEXT_PRIMARY = '#F1F5F9';
const TEXT_MUTED   = '#64748B';
const TEXT_LABEL   = '#94A3B8';

// ── Type → couleur d'accent du panel ─────────────────────────────────────────

const ELEMENT_TYPE_ACCENT: Record<SelectedElementDetail['elementType'], string> = {
  wall:       '#EF4444',
  room:       '#F59E0B',
  opening:    '#3B82F6',
  annotation: ORANGE,
};

const ELEMENT_TYPE_ICON: Record<SelectedElementDetail['elementType'], string> = {
  wall:       '━',
  room:       '▪',
  opening:    '⌐',
  annotation: '◎',
};

const ELEMENT_TYPE_LABEL: Record<SelectedElementDetail['elementType'], string> = {
  wall:       'Mur',
  room:       'Pièce',
  opening:    'Ouverture',
  annotation: 'Annotation',
};

// ── Sous-composant : indicateur de confiance IA ───────────────────────────────

const ConfidenceIndicator: React.FC<{ confidence: number }> = ({ confidence }) => {
  const pct   = Math.round(confidence * 100);
  const color = confidenceToColor(confidence);
  const label = pct >= 80 ? 'Haute' : pct >= 50 ? 'Moyenne' : 'Faible';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 9, color, fontWeight: 700, minWidth: 24 }}>{pct}%</span>
      <span style={{ fontSize: 9, color: TEXT_MUTED }}>{label}</span>
    </div>
  );
};

// ── Sous-composant : grille de champs ─────────────────────────────────────────

const FieldGrid: React.FC<{ fields: SelectedElementDetail['fields'] }> = ({ fields }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
    {fields.map((field) => (
      <div key={field.label}>
        <p style={{
          fontSize: 9,
          color: TEXT_MUTED,
          margin: '0 0 3px',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {field.label}
        </p>
        <p style={{
          fontSize: 12,
          color: field.highlight ? ORANGE : TEXT_PRIMARY,
          fontWeight: field.highlight ? 700 : 500,
          margin: 0,
        }}>
          {field.value}
          {field.unit && (
            <span style={{ color: TEXT_MUTED, fontSize: 10, marginLeft: 3 }}>{field.unit}</span>
          )}
        </p>
      </div>
    ))}
  </div>
);

// ── Sous-composant : historique de validation ─────────────────────────────────

const ValidationHistory: React.FC<{ record: WallValidationRecord }> = ({ record }) => {
  const STATUS_LABELS: Record<WallUserValidationStatus, string> = {
    en_attente:        'Remis en attente',
    porteur_confirmé:  'Confirmé porteur',
    cloison_confirmée: 'Confirmée cloison',
    rejeté:            'Rejeté',
    corrigé:           'Propriétés modifiées',
  };

  const STATUS_COLORS: Record<WallUserValidationStatus, string> = {
    en_attente:        '#6B7280',
    porteur_confirmé:  '#EF4444',
    cloison_confirmée: '#3B82F6',
    rejeté:            '#374151',
    corrigé:           '#F59E0B',
  };

  if (record.history.length === 0) return null;

  return (
    <div>
      <p style={{
        fontSize: 9,
        color: TEXT_MUTED,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        margin: '0 0 8px',
      }}>
        Historique des décisions
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {[...record.history].reverse().slice(0, 5).map((entry, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 8px',
              borderRadius: 5,
              background: SURFACE,
              border: `1px solid ${BORDER}`,
            }}
          >
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: STATUS_COLORS[entry.action],
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 10, color: TEXT_PRIMARY, flex: 1 }}>
              {STATUS_LABELS[entry.action]}
            </span>
            <span style={{ fontSize: 9, color: TEXT_MUTED }}>
              {new Date(entry.at).toLocaleDateString('fr-FR', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Sous-composant : vue non-mur (lecture seule) ──────────────────────────────

const ReadOnlyElementView: React.FC<{
  detail: SelectedElementDetail;
  accent: string;
}> = ({ detail, accent }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {/* Confiance IA */}
    <div>
      <p style={{ fontSize: 9, color: TEXT_MUTED, fontWeight: 600, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Fiabilité détection IA
      </p>
      <ConfidenceIndicator confidence={detail.confidence} />
    </div>

    {/* Champs */}
    <FieldGrid fields={detail.fields} />

    {/* Notice lecture seule */}
    <div style={{
      padding: '8px 10px',
      borderRadius: 6,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${BORDER}`,
    }}>
      <p style={{ fontSize: 9, color: TEXT_MUTED, margin: 0 }}>
        La validation manuelle des {ELEMENT_TYPE_LABEL[detail.elementType].toLowerCase()}s sera disponible dans une prochaine étape.
      </p>
    </div>
  </div>
);

// ── Composant principal ───────────────────────────────────────────────────────

export const SelectedElementPanel: React.FC<SelectedElementPanelProps> = ({
  elementDetail,
  transcription,
  onClose,
  position = 'right',
}) => {
  const engine = useValidationEngine();
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // ── Retrouver le DetectedWall si l'élément est un mur ──────────────────────

  const selectedWall = useMemo(() => {
    if (!elementDetail || elementDetail.elementType !== 'wall') return null;
    return transcription.walls.find((w) => w.id === elementDetail.elementId) ?? null;
  }, [elementDetail, transcription.walls]);

  const wallRecord: WallValidationRecord | null = useMemo(() => {
    if (!elementDetail || elementDetail.elementType !== 'wall') return null;
    return engine.getRecord(elementDetail.elementId);
  }, [elementDetail, engine]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleActionDone = useCallback(
    (_wallId: string, _status: WallUserValidationStatus) => {
      // fermeture de l'éditeur si ouvert après une action de confirmation
      setIsEditorOpen(false);
    },
    []
  );

  const handleEditorSaved = useCallback(
    (_wallId: string, _correction: WallCorrection, _notes: string) => {
      setIsEditorOpen(false);
    },
    []
  );

  // ── Visibilité et dimensions ────────────────────────────────────────────────

  const isOpen    = elementDetail !== null;
  const accent    = elementDetail ? ELEMENT_TYPE_ACCENT[elementDetail.elementType] : ORANGE;
  const isWall    = elementDetail?.elementType === 'wall';

  // ── Styles positionnels ────────────────────────────────────────────────────

  const positionStyle: React.CSSProperties = position === 'right'
    ? {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 300,
        transform: isOpen ? 'translateX(0)' : 'translateX(300px)',
        transition: 'transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        flexDirection: 'column',
      }
    : {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: isWall ? 580 : 320,
        transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        flexDirection: 'column',
      };

  if (!elementDetail) {
    // Panel fermé — rendu du conteneur pour maintenir la transition CSS
    return (
      <div style={{
        ...positionStyle,
        display: 'flex',
        background: PANEL_BG,
        border: `1px solid ${BORDER}`,
        borderTop: `2px solid ${ORANGE}`,
        zIndex: 35,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
        pointerEvents: 'none',
      }} />
    );
  }

  return (
    <>
      <div
        role="complementary"
        aria-label={`Détail : ${elementDetail.title}`}
        style={{
          ...positionStyle,
          display: 'flex',
          background: PANEL_BG,
          border: `1px solid ${BORDER}`,
          borderTop: `2px solid ${accent}`,
          zIndex: 35,
          boxShadow: position === 'right'
            ? '-4px 0 24px rgba(0,0,0,0.4)'
            : '0 -4px 24px rgba(0,0,0,0.4)',
          fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
          overflow: 'hidden',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '13px 14px 11px',
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}>
          {/* Icône type */}
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: `${accent}22`,
            border: `1px solid ${accent}44`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            color: accent,
            flexShrink: 0,
          }}>
            {ELEMENT_TYPE_ICON[elementDetail.elementType]}
          </div>

          {/* Titre + sous-titre */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 9, color: accent, fontWeight: 700, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {ELEMENT_TYPE_LABEL[elementDetail.elementType]}
            </p>
            <p style={{
              fontSize: 13,
              fontWeight: 700,
              color: TEXT_PRIMARY,
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {elementDetail.title}
            </p>
            {elementDetail.subtitle && (
              <p style={{ fontSize: 10, color: TEXT_MUTED, margin: '2px 0 0' }}>
                {elementDetail.subtitle}
              </p>
            )}
          </div>

          {/* Bouton fermer */}
          <button
            onClick={onClose}
            aria-label="Fermer le panel"
            style={{
              background: 'none',
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              width: 26,
              height: 26,
              cursor: 'pointer',
              color: TEXT_MUTED,
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Contenu scrollable ─────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Confiance IA — section commune */}
          <div style={{ padding: '12px 14px 0' }}>
            <p style={{ fontSize: 9, color: TEXT_MUTED, fontWeight: 600, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Fiabilité détection IA
            </p>
            <ConfidenceIndicator confidence={elementDetail.confidence} />
          </div>

          {/* Champs communs */}
          <div style={{ padding: '12px 14px' }}>
            <FieldGrid fields={elementDetail.fields} />
          </div>

          {/* ── Section spécifique mur ──────────────────────────────────── */}
          {isWall && selectedWall && (
            <>
              {/* Divider */}
              <div style={{ height: 1, background: BORDER, margin: '0 14px' }} />

              {/* Historique */}
              {wallRecord && wallRecord.history.length > 0 && (
                <div style={{ padding: '12px 14px 0' }}>
                  <ValidationHistory record={wallRecord} />
                </div>
              )}

              {/* Notes enregistrées */}
              {wallRecord?.notes && (
                <div style={{ padding: '10px 14px 0' }}>
                  <p style={{ fontSize: 9, color: TEXT_MUTED, fontWeight: 600, margin: '0 0 5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Notes
                  </p>
                  <p style={{
                    fontSize: 11,
                    color: TEXT_PRIMARY,
                    margin: 0,
                    lineHeight: 1.5,
                    padding: '7px 9px',
                    background: SURFACE,
                    borderRadius: 6,
                    border: `1px solid ${BORDER}`,
                  }}>
                    {wallRecord.notes}
                  </p>
                </div>
              )}

              {/* Toolbar de confirmation structurelle */}
              <div style={{ marginTop: 12 }}>
                <WallConfirmationToolbar
                  wall={selectedWall}
                  record={wallRecord}
                  progress={engine.progress}
                  isPlanLocked={engine.isPlanLocked}
                  onEditRequest={() => setIsEditorOpen(true)}
                  onActionDone={handleActionDone}
                />
              </div>
            </>
          )}

          {/* ── Section non-mur ────────────────────────────────────────── */}
          {!isWall && (
            <div style={{ padding: '0 14px 14px' }}>
              <div style={{ height: 1, background: BORDER, margin: '0 0 14px' }} />
              <ReadOnlyElementView detail={elementDetail} accent={accent} />
            </div>
          )}
        </div>
      </div>

      {/* ── WallEditorPanel en overlay ─────────────────────────────────── */}
      {isWall && selectedWall && (
        <WallEditorPanel
          wall={selectedWall}
          record={wallRecord}
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          onSaved={handleEditorSaved}
        />
      )}
    </>
  );
};

export default SelectedElementPanel;