// ─────────────────────────────────────────────────────────────────────────────
// WallEditorPanel.tsx
// Panneau d'édition des propriétés physiques d'un mur
// Matériau, épaisseur, notes — slide-in depuis la droite
// La décision structurelle (porteur/cloison) reste dans WallConfirmationToolbar
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectedWall, WallMaterial } from '../plan-reader/planTranscription.types';
import type { WallValidationRecord } from '../plan-reader/planUserValidationEngine';
import { correctWall } from '../plan-reader/planUserValidationEngine';
import type { WallCorrection } from '../shared/planValidation.types';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface WallEditorPanelProps {
  readonly wall: DetectedWall;
  readonly record: WallValidationRecord | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved?: (wallId: string, correction: WallCorrection, notes: string) => void;
}

// ── Formulaire interne ────────────────────────────────────────────────────────

interface WallEditorFormState {
  materiau: WallMaterial;
  epaisseur_cm: string;  // string pour gérer le champ contrôlé + validation
  notes: string;
}

// ── Options matériaux ─────────────────────────────────────────────────────────

const MATERIAUX: ReadonlyArray<{ value: WallMaterial; label: string; sublabel: string }> = [
  { value: 'béton',      label: 'Béton',      sublabel: 'BA — voile béton armé'          },
  { value: 'maçonnerie', label: 'Maçonnerie',  sublabel: 'Parpaings, briques agglomérées' },
  { value: 'pierre',     label: 'Pierre',      sublabel: 'Pierre de taille, moellon'      },
  { value: 'brique',     label: 'Brique',      sublabel: 'Brique pleine ou creuse'        },
  { value: 'bois',       label: 'Bois',        sublabel: 'Ossature bois, colombage'       },
  { value: 'métal',      label: 'Métal',       sublabel: 'Ossature acier'                 },
  { value: 'plâtre',     label: 'Plâtre',      sublabel: 'Cloison plâtre / carreaux'      },
  { value: 'inconnu',    label: 'Inconnu',     sublabel: 'Matériau non identifié'         },
];

// ── Épaisseurs courantes par matériau (suggestions) ──────────────────────────

const SUGGESTED_THICKNESSES: Partial<Record<WallMaterial, ReadonlyArray<number>>> = {
  béton:      [15, 20, 25, 30],
  maçonnerie: [10, 15, 20, 25],
  pierre:     [30, 40, 50, 60],
  brique:     [10, 11, 22, 33],
  bois:       [10, 14, 15, 20],
  métal:      [7, 10, 12, 15],
  plâtre:     [5, 7, 10, 13],
};

// ── Validation du formulaire ──────────────────────────────────────────────────

interface FormErrors {
  epaisseur_cm?: string;
}

function validateForm(form: WallEditorFormState): FormErrors {
  const errors: FormErrors = {};

  if (form.epaisseur_cm !== '') {
    const n = parseFloat(form.epaisseur_cm);
    if (isNaN(n)) {
      errors.epaisseur_cm = 'Valeur numérique requise';
    } else if (n <= 0) {
      errors.epaisseur_cm = 'L\'épaisseur doit être positive';
    } else if (n > 300) {
      errors.epaisseur_cm = 'Valeur improbable (> 300 cm)';
    }
  }

  return errors;
}

function hasErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0;
}

// ── Initialisation du formulaire depuis le mur + record ──────────────────────

function initFormState(wall: DetectedWall, record: WallValidationRecord | null): WallEditorFormState {
  const correction = record?.correction;
  return {
    materiau:    (correction?.materiau as WallMaterial | undefined) ?? wall.materiau,
    epaisseur_cm: correction?.epaisseur_cm !== undefined && correction.epaisseur_cm !== null
      ? correction.epaisseur_cm.toString()
      : wall.epaisseur_cm !== null
        ? wall.epaisseur_cm.toString()
        : '',
    notes: record?.notes ?? '',
  };
}

// ── Palette ───────────────────────────────────────────────────────────────────

const ORANGE       = '#F97316';
const PANEL_BG     = '#0C0C14';
const SURFACE_BG   = 'rgba(255,255,255,0.04)';
const BORDER       = 'rgba(255,255,255,0.08)';
const BORDER_FOCUS = ORANGE;
const TEXT_PRIMARY = '#F1F5F9';
const TEXT_MUTED   = '#64748B';
const TEXT_LABEL   = '#94A3B8';
const ERROR_COLOR  = '#FCA5A5';

// ── Styles communs de formulaire ──────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 11px',
  borderRadius: 7,
  border: `1px solid ${BORDER}`,
  background: SURFACE_BG,
  color: TEXT_PRIMARY,
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
  transition: 'border-color 0.15s',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  color: TEXT_LABEL,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 6,
};

// ── Composant principal ───────────────────────────────────────────────────────

export const WallEditorPanel: React.FC<WallEditorPanelProps> = ({
  wall,
  record,
  isOpen,
  onClose,
  onSaved,
}) => {
  const [form, setForm]             = useState<WallEditorFormState>(() => initFormState(wall, record));
  const [errors, setErrors]         = useState<FormErrors>({});
  const [isDirty, setIsDirty]       = useState(false);
  const [isSaving, setIsSaving]     = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const firstInputRef               = useRef<HTMLSelectElement>(null);

  // Reset du formulaire à chaque ouverture / changement de mur
  useEffect(() => {
    if (isOpen) {
      setForm(initFormState(wall, record));
      setErrors({});
      setIsDirty(false);
      setSaveSuccess(false);
      // Focus auto sur le premier champ
      setTimeout(() => firstInputRef.current?.focus(), 150);
    }
  }, [isOpen, wall.id, record]);

  const handleChange = useCallback(<K extends keyof WallEditorFormState>(
    key: K,
    value: WallEditorFormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
    setSaveSuccess(false);
    // Validation à la volée seulement pour les champs numériques
    if (key === 'epaisseur_cm') {
      const newForm = { form, epaisseur_cm: value as string };
      setErrors(validateForm({ ...form, epaisseur_cm: value as string }));
    }
  }, [form]);

  const handleSave = useCallback(() => {
    const validationErrors = validateForm(form);
    if (hasErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }

    setIsSaving(true);

    const correction: WallCorrection = {
      materiau: form.materiau,
      epaisseur_cm: form.epaisseur_cm !== '' ? parseFloat(form.epaisseur_cm) : undefined,
    };

    try {
      correctWall(wall.id, correction, form.notes);
      setSaveSuccess(true);
      setIsDirty(false);
      onSaved?.(wall.id, correction, form.notes);

      // Fermeture auto après succès
      setTimeout(onClose, 700);
    } finally {
      setIsSaving(false);
    }
  }, [form, wall.id, onSaved, onClose]);

  const handleClose = useCallback(() => {
    setRejectConfirmClose(false);
    onClose();
  }, [onClose]);

  const [rejectConfirmClose, setRejectConfirmClose] = useState(false);

  const handleCloseRequest = useCallback(() => {
    if (isDirty) {
      setRejectConfirmClose(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const suggestions = form.materiau !== 'inconnu'
    ? SUGGESTED_THICKNESSES[form.materiau] ?? []
    : [];

  const panelWidth = 320;

  return (
    <>
      {/* Overlay de fond (désélection) */}
      {isOpen && (
        <div
          onClick={handleCloseRequest}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 40,
            backdropFilter: 'blur(1px)',
          }}
        />
      )}

      {/* Panneau slide-in */}
      <div
        role="dialog"
        aria-label="Modifier le mur"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: panelWidth,
          background: PANEL_BG,
          borderLeft: `1px solid ${BORDER}`,
          borderTop: `2px solid ${ORANGE}`,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
          transform: isOpen ? 'translateX(0)' : `translateX(${panelWidth}px)`,
          transition: 'transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          boxShadow: isOpen ? '-8px 0 32px rgba(0,0,0,0.5)' : 'none',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px 12px',
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}>
          <div>
            <p style={{ color: ORANGE, fontSize: 10, fontWeight: 700, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Modifier le mur
            </p>
            <p style={{ color: TEXT_PRIMARY, fontSize: 13, fontWeight: 600, margin: 0 }}>
              {wall.id.slice(0, 20)}
            </p>
          </div>
          <button
            onClick={handleCloseRequest}
            style={{
              background: 'none',
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              width: 28,
              height: 28,
              cursor: 'pointer',
              color: TEXT_MUTED,
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Métadonnées IA (lecture seule) */}
        <div style={{
          margin: 12,
          padding: '10px 12px',
          borderRadius: 8,
          background: 'rgba(249,115,22,0.06)',
          border: `1px solid rgba(249,115,22,0.15)`,
          flexShrink: 0,
        }}>
          <p style={{ fontSize: 9, color: ORANGE, fontWeight: 700, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Données détectées par IA
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
            {[
              { label: 'Matériau IA',  value: wall.materiau },
              { label: 'Épaisseur IA', value: wall.epaisseur_cm !== null ? `${wall.epaisseur_cm} cm` : '—' },
              { label: 'Longueur IA',  value: wall.longueur_m !== null ? `${wall.longueur_m.toFixed(2)} m` : '—' },
              { label: 'Porteur IA',   value: wall.porteur === null ? '—' : wall.porteur ? 'Oui' : 'Non' },
              { label: 'Fiabilité',    value: `${Math.round(wall.confidence * 100)}%` },
            ].map(({ label, value }) => (
              <div key={label}>
                <p style={{ fontSize: 9, color: TEXT_MUTED, margin: '0 0 1px' }}>{label}</p>
                <p style={{ fontSize: 11, color: TEXT_PRIMARY, margin: 0, fontWeight: 500 }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Formulaire */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
          <p style={{ fontSize: 10, color: TEXT_LABEL, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>
            Correction manuelle
          </p>

          {/* Matériau */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Matériau</label>
            <select
              ref={firstInputRef}
              value={form.materiau}
              onChange={(e) => handleChange('materiau', e.target.value as WallMaterial)}
              style={{ ...inputStyle, appearance: 'none' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = BORDER_FOCUS)}
              onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
            >
              {MATERIAUX.map(({ value, label, sublabel }) => (
                <option key={value} value={value}>
                  {label} — {sublabel}
                </option>
              ))}
            </select>
          </div>

          {/* Épaisseur */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>
              Épaisseur (cm)
            </label>
            <input
              type="number"
              min={1}
              max={300}
              step={0.5}
              value={form.epaisseur_cm}
              onChange={(e) => handleChange('epaisseur_cm', e.target.value)}
              placeholder={wall.epaisseur_cm !== null ? `${wall.epaisseur_cm}` : 'ex. 20'}
              style={{
                ...inputStyle,
                borderColor: errors.epaisseur_cm ? '#EF4444' : BORDER,
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = errors.epaisseur_cm ? '#EF4444' : BORDER_FOCUS)}
              onBlur={(e) => (e.currentTarget.style.borderColor = errors.epaisseur_cm ? '#EF4444' : BORDER)}
            />
            {errors.epaisseur_cm && (
              <p style={{ fontSize: 9, color: ERROR_COLOR, margin: '4px 0 0' }}>{errors.epaisseur_cm}</p>
            )}

            {/* Suggestions d'épaisseur */}
            {suggestions.length > 0 && (
              <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                {suggestions.map((ep) => (
                  <button
                    key={ep}
                    onClick={() => handleChange('epaisseur_cm', ep.toString())}
                    style={{
                      padding: '2px 8px',
                      borderRadius: 8,
                      border: `1px solid ${form.epaisseur_cm === ep.toString() ? ORANGE : BORDER}`,
                      background: form.epaisseur_cm === ep.toString() ? 'rgba(249,115,22,0.15)' : 'transparent',
                      color: form.epaisseur_cm === ep.toString() ? ORANGE : TEXT_MUTED,
                      fontSize: 10,
                      cursor: 'pointer',
                    }}
                  >
                    {ep} cm
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Notes (optionnel)</label>
            <textarea
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              rows={3}
              placeholder="Observations, doutes, à vérifier sur site..."
              style={{
                ...inputStyle,
                resize: 'vertical',
                minHeight: 70,
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = BORDER_FOCUS)}
              onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
            />
          </div>

          {/* Avertissement porteur */}
          <div style={{
            padding: '8px 10px',
            borderRadius: 6,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
            marginBottom: 12,
          }}>
            <p style={{ fontSize: 9, color: '#FCA5A5', margin: 0, lineHeight: 1.5 }}>
              ⚠ La qualification porteur / cloison se fait via les boutons de confirmation structurelle, pas ici.
            </p>
          </div>
        </div>

        {/* Barre de boutons */}
        <div style={{
          padding: '10px 12px 14px',
          borderTop: `1px solid ${BORDER}`,
          display: 'flex',
          gap: 8,
          flexShrink: 0,
        }}>
          <button
            onClick={handleCloseRequest}
            style={{
              flex: 1,
              padding: '9px',
              borderRadius: 7,
              border: `1px solid ${BORDER}`,
              background: 'transparent',
              color: TEXT_MUTED,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || hasErrors(errors) || (!isDirty && !saveSuccess)}
            style={{
              flex: 2,
              padding: '9px',
              borderRadius: 7,
              border: `1px solid ${saveSuccess ? '#10B981' : ORANGE}`,
              background: saveSuccess
                ? 'rgba(16,185,129,0.15)'
                : hasErrors(errors) || (!isDirty && !saveSuccess)
                  ? 'rgba(255,255,255,0.03)'
                  : 'rgba(249,115,22,0.15)',
              color: saveSuccess ? '#10B981' : hasErrors(errors) ? TEXT_MUTED : ORANGE,
              fontSize: 11,
              fontWeight: 700,
              cursor: isSaving || hasErrors(errors) ? 'not-allowed' : 'pointer',
              opacity: !isDirty && !saveSuccess ? 0.5 : 1,
              transition: 'all 0.15s',
            }}
          >
            {isSaving ? 'Enregistrement…' : saveSuccess ? '✓ Enregistré' : 'Enregistrer'}
          </button>
        </div>

        {/* Modal de confirmation fermeture avec changements non sauvegardés */}
        {rejectConfirmClose && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(12,12,20,0.94)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            padding: 24,
            zIndex: 60,
          }}>
            <p style={{ color: '#F59E0B', fontSize: 13, fontWeight: 700, textAlign: 'center', margin: 0 }}>
              Modifications non sauvegardées
            </p>
            <p style={{ color: TEXT_MUTED, fontSize: 11, textAlign: 'center', margin: 0 }}>
              Fermer sans sauvegarder ?
            </p>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <button
                onClick={() => setRejectConfirmClose(false)}
                style={{
                  flex: 1, padding: '8px', borderRadius: 7,
                  border: `1px solid ${BORDER}`, background: 'transparent',
                  color: TEXT_MUTED, fontSize: 11, cursor: 'pointer',
                }}
              >
                Continuer
              </button>
              <button
                onClick={handleClose}
                style={{
                  flex: 1, padding: '8px', borderRadius: 7,
                  border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.12)',
                  color: '#FCA5A5', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Fermer quand même
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default WallEditorPanel;