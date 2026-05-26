// ─────────────────────────────────────────────────────────────────────────────
// WallConfirmationToolbar.tsx
// Actions de validation structurelle sur un mur sélectionné
// Porteur / Cloison / Rejeter / Réinitialiser — verrouillage du plan
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import type { DetectedWall } from '../plan-reader/planTranscription.types';
import {
  confirmWallAsPorteur,
  confirmWallAsCloison,
  rejectWall,
  resetWallValidation,
  lockPlan,
  unlockPlan,
} from '../plan-reader/planUserValidationEngine';
import type {
  WallValidationRecord,
  WallUserValidationStatus,
  ValidationProgress,
} from '../plan-reader/planUserValidationEngine';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface WallConfirmationToolbarProps {
  readonly wall: DetectedWall;
  readonly record: WallValidationRecord | null;
  readonly progress: ValidationProgress;
  readonly isPlanLocked: boolean;
  readonly onEditRequest: () => void;
  readonly onActionDone?: (wallId: string, status: WallUserValidationStatus) => void;
}

// ── Palette de statut ─────────────────────────────────────────────────────────

const STATUS_META: Record<
  WallUserValidationStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  en_attente:        { label: 'En attente',    color: '#6B7280', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.3)'  },
  porteur_confirmé:  { label: 'Porteur',       color: '#EF4444', bg: 'rgba(239,68,68,0.14)',   border: 'rgba(239,68,68,0.4)'   },
  cloison_confirmée: { label: 'Cloison',       color: '#3B82F6', bg: 'rgba(59,130,246,0.14)',  border: 'rgba(59,130,246,0.4)'  },
  rejeté:            { label: 'Rejeté',        color: '#374151', bg: 'rgba(55,65,81,0.14)',    border: 'rgba(55,65,81,0.4)'    },
  corrigé:           { label: 'Corrigé',       color: '#F59E0B', bg: 'rgba(245,158,11,0.14)',  border: 'rgba(245,158,11,0.4)'  },
};

// ── Constantes visuelles ──────────────────────────────────────────────────────

const ORANGE       = '#F97316';
const PANEL_BG     = 'rgba(12,12,18,0.97)';
const BORDER       = 'rgba(255,255,255,0.07)';
const TEXT_PRIMARY = '#F1F5F9';
const TEXT_MUTED   = '#64748B';

// ── Sous-composant : badge de statut ─────────────────────────────────────────

const StatusBadge: React.FC<{ status: WallUserValidationStatus }> = ({ status }) => {
  const meta = STATUS_META[status];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 9px',
      borderRadius: 10,
      background: meta.bg,
      border: `1px solid ${meta.border}`,
      fontSize: 10,
      fontWeight: 700,
      color: meta.color,
      letterSpacing: '0.03em',
      textTransform: 'uppercase',
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%', background: meta.color, flexShrink: 0,
      }} />
      {meta.label}
    </span>
  );
};

// ── Sous-composant : bouton d'action primaire ─────────────────────────────────

interface ActionButtonProps {
  readonly label: string;
  readonly sublabel: string;
  readonly color: string;
  readonly bg: string;
  readonly border: string;
  readonly isActive: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly icon: React.ReactNode;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  label, sublabel, color, bg, border, isActive, disabled, onClick, icon,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
      padding: '10px 14px',
      borderRadius: 8,
      border: `1.5px solid ${isActive ? color : border}`,
      background: isActive ? bg : 'rgba(255,255,255,0.03)',
      color: isActive ? color : TEXT_MUTED,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: 'all 0.15s',
      minWidth: 72,
      flex: 1,
    }}
    onMouseEnter={(e) => {
      if (!disabled && !isActive) {
        e.currentTarget.style.background = bg;
        e.currentTarget.style.borderColor = color;
        e.currentTarget.style.color = color;
      }
    }}
    onMouseLeave={(e) => {
      if (!disabled && !isActive) {
        e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
        e.currentTarget.style.borderColor = border;
        e.currentTarget.style.color = TEXT_MUTED;
      }
    }}
  >
    <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
    <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1 }}>{label}</span>
    <span style={{ fontSize: 9, opacity: 0.7, lineHeight: 1 }}>{sublabel}</span>
  </button>
);

// ── Sous-composant : barre de progression ─────────────────────────────────────

const ProgressBar: React.FC<{ progress: ValidationProgress }> = ({ progress }) => {
  const porteurPct = progress.total > 0 ? (progress.nb_porteur  / progress.total) * 100 : 0;
  const cloisonPct = progress.total > 0 ? (progress.nb_cloison  / progress.total) * 100 : 0;
  const corrigePct = progress.total > 0 ? (progress.nb_corrige  / progress.total) * 100 : 0;
  const rejetePct  = progress.total > 0 ? (progress.nb_rejete   / progress.total) * 100 : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 9, color: TEXT_MUTED, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Avancement validation
        </span>
        <span style={{ fontSize: 10, color: TEXT_PRIMARY, fontWeight: 700 }}>
          {progress.completion_pct}%
          <span style={{ color: TEXT_MUTED, fontWeight: 400, marginLeft: 4 }}>
            ({progress.total - progress.nb_pending}/{progress.total})
          </span>
        </span>
      </div>

      {/* Barre composite */}
      <div style={{
        height: 5,
        borderRadius: 3,
        background: 'rgba(255,255,255,0.06)',
        overflow: 'hidden',
        display: 'flex',
      }}>
        <div style={{ width: `${porteurPct}%`, background: '#EF4444', transition: 'width 0.3s' }} />
        <div style={{ width: `${cloisonPct}%`, background: '#3B82F6', transition: 'width 0.3s' }} />
        <div style={{ width: `${corrigePct}%`, background: '#F59E0B', transition: 'width 0.3s' }} />
        <div style={{ width: `${rejetePct}%`,  background: '#374151', transition: 'width 0.3s' }} />
      </div>

      {/* Légende */}
      <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
        {[
          { color: '#EF4444', label: 'Porteurs',  count: progress.nb_porteur  },
          { color: '#3B82F6', label: 'Cloisons',  count: progress.nb_cloison  },
          { color: '#F59E0B', label: 'Corrigés',  count: progress.nb_corrige  },
          { color: '#374151', label: 'Rejetés',   count: progress.nb_rejete   },
          { color: '#6B7280', label: 'En attente',count: progress.nb_pending  },
        ].filter((l) => l.count > 0).map(({ color, label, count }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: TEXT_MUTED }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
            {label} ({count})
          </span>
        ))}
      </div>
    </div>
  );
};

// ── Sous-composant : bouton de verrouillage ───────────────────────────────────

const LockButton: React.FC<{
  progress: ValidationProgress;
  isPlanLocked: boolean;
  onLock: () => void;
  onUnlock: () => void;
}> = ({ progress, isPlanLocked, onLock, onUnlock }) => {
  if (isPlanLocked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>🔒</span>
          <span style={{ fontSize: 11, color: ORANGE, fontWeight: 700 }}>Plan verrouillé</span>
        </div>
        <button
          onClick={onUnlock}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: `1px solid ${BORDER}`,
            background: 'transparent',
            color: TEXT_MUTED,
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          Déverrouiller
        </button>
      </div>
    );
  }

  if (!progress.can_lock) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 10px',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${BORDER}`,
      }}>
        <span style={{ fontSize: 12 }}>🔓</span>
        <span style={{ fontSize: 10, color: TEXT_MUTED }}>
          {progress.nb_pending} mur{progress.nb_pending > 1 ? 's' : ''} en attente — validation incomplète
        </span>
      </div>
    );
  }

  return (
    <button
      onClick={onLock}
      style={{
        width: '100%',
        padding: '9px 14px',
        borderRadius: 7,
        border: `1.5px solid ${ORANGE}`,
        background: 'rgba(249,115,22,0.12)',
        color: ORANGE,
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        transition: 'all 0.15s',
        letterSpacing: '0.02em',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(249,115,22,0.22)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(249,115,22,0.12)')}
    >
      <span style={{ fontSize: 13 }}>🔒</span>
      Verrouiller le plan validé
    </button>
  );
};

// ── Composant principal ───────────────────────────────────────────────────────

export const WallConfirmationToolbar: React.FC<WallConfirmationToolbarProps> = ({
  wall,
  record,
  progress,
  isPlanLocked,
  onEditRequest,
  onActionDone,
}) => {
  const [lockError, setLockError] = useState<string | null>(null);
  const [rejectConfirm, setRejectConfirm] = useState(false);

  const currentStatus = record?.status ?? 'en_attente';
  const isLocked      = isPlanLocked;

  const handleConfirmPorteur = useCallback(() => {
    confirmWallAsPorteur(wall.id);
    onActionDone?.(wall.id, 'porteur_confirmé');
    setRejectConfirm(false);
  }, [wall.id, onActionDone]);

  const handleConfirmCloison = useCallback(() => {
    confirmWallAsCloison(wall.id);
    onActionDone?.(wall.id, 'cloison_confirmée');
    setRejectConfirm(false);
  }, [wall.id, onActionDone]);

  const handleReject = useCallback(() => {
    if (!rejectConfirm) {
      setRejectConfirm(true);
      return;
    }
    rejectWall(wall.id);
    onActionDone?.(wall.id, 'rejeté');
    setRejectConfirm(false);
  }, [wall.id, rejectConfirm, onActionDone]);

  const handleReset = useCallback(() => {
    resetWallValidation(wall.id);
    onActionDone?.(wall.id, 'en_attente');
    setRejectConfirm(false);
  }, [wall.id, onActionDone]);

  const handleLock = useCallback(() => {
    try {
      setLockError(null);
      lockPlan('Validation structurelle complète');
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Erreur de verrouillage.');
    }
  }, []);

  const handleUnlock = useCallback(() => {
    unlockPlan();
  }, []);

  const isAlreadyPorteur  = currentStatus === 'porteur_confirmé';
  const isAlreadyCloison  = currentStatus === 'cloison_confirmée';
  const isRejected        = currentStatus === 'rejeté';

  return (
    <div style={{
      background: PANEL_BG,
      border: `1px solid ${BORDER}`,
      borderTop: `2px solid ${
        isAlreadyPorteur ? '#EF4444' :
        isAlreadyCloison ? '#3B82F6' :
        isRejected       ? '#374151' : ORANGE
      }`,
      borderRadius: '0 0 10px 10px',
      overflow: 'hidden',
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    }}>

      {/* Header statut */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px 8px',
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 500 }}>Décision structurelle</span>
          <StatusBadge status={currentStatus} />
        </div>

        {/* Réinitialiser si déjà statué */}
        {currentStatus !== 'en_attente' && !isLocked && (
          <button
            onClick={handleReset}
            title="Réinitialiser la décision"
            style={{
              background: 'none',
              border: `1px solid ${BORDER}`,
              borderRadius: 5,
              padding: '3px 8px',
              fontSize: 9,
              color: TEXT_MUTED,
              cursor: 'pointer',
              letterSpacing: '0.03em',
            }}
          >
            ↺ Réinitialiser
          </button>
        )}
      </div>

      {/* Boutons d'action */}
      <div style={{ padding: '12px 14px', display: 'flex', gap: 8 }}>
        <ActionButton
          label="Porteur"
          sublabel="Structurel"
          color="#EF4444"
          bg="rgba(239,68,68,0.15)"
          border="rgba(239,68,68,0.25)"
          isActive={isAlreadyPorteur}
          disabled={isLocked}
          onClick={handleConfirmPorteur}
          icon="⬛"
        />
        <ActionButton
          label="Cloison"
          sublabel="Distribution"
          color="#3B82F6"
          bg="rgba(59,130,246,0.15)"
          border="rgba(59,130,246,0.25)"
          isActive={isAlreadyCloison}
          disabled={isLocked}
          onClick={handleConfirmCloison}
          icon="⬜"
        />
        <ActionButton
          label={rejectConfirm ? 'Confirmer ?' : 'Rejeter'}
          sublabel={rejectConfirm ? 'Cliquer pour valider' : 'Faux positif IA'}
          color={rejectConfirm ? '#F59E0B' : '#6B7280'}
          bg={rejectConfirm ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.1)'}
          border={rejectConfirm ? 'rgba(245,158,11,0.4)' : 'rgba(107,114,128,0.2)'}
          isActive={isRejected}
          disabled={isLocked}
          onClick={handleReject}
          icon="✕"
        />
      </div>

      {/* Annuler rejet en attente de confirmation */}
      {rejectConfirm && (
        <div style={{ padding: '0 14px 8px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setRejectConfirm(false)}
            style={{
              background: 'none', border: 'none',
              color: TEXT_MUTED, fontSize: 10, cursor: 'pointer',
            }}
          >
            Annuler
          </button>
        </div>
      )}

      {/* Bouton modifier */}
      {!isLocked && (
        <div style={{ padding: '0 14px 10px' }}>
          <button
            onClick={onEditRequest}
            style={{
              width: '100%',
              padding: '6px',
              borderRadius: 6,
              border: `1px solid ${BORDER}`,
              background: 'rgba(255,255,255,0.03)',
              color: TEXT_MUTED,
              fontSize: 10,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = ORANGE)}
            onMouseLeave={(e) => (e.currentTarget.style.color = TEXT_MUTED)}
          >
            ✏ Modifier les propriétés du mur
          </button>
        </div>
      )}

      {/* Séparateur + progression */}
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER}` }}>
        <ProgressBar progress={progress} />
      </div>

      {/* Verrouillage */}
      <div style={{ padding: '8px 14px 12px', borderTop: `1px solid ${BORDER}` }}>
        <LockButton
          progress={progress}
          isPlanLocked={isPlanLocked}
          onLock={handleLock}
          onUnlock={handleUnlock}
        />
        {lockError !== null && (
          <p style={{ fontSize: 10, color: '#FCA5A5', margin: '6px 0 0', textAlign: 'center' }}>
            {lockError}
          </p>
        )}
      </div>
    </div>
  );
};

export default WallConfirmationToolbar;