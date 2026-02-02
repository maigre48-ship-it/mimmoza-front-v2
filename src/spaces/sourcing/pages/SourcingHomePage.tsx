/**
 * SourcingHomePage - Page d'accueil du module Sourcing
 * Avec SmartScore EN PREMIER puis Résumé EN DESSOUS
 */

import React, { useState, useCallback, useEffect } from 'react';
import { SourcingForm } from '../forms/SourcingForm';
import { SmartScorePanel } from '../../../components/sourcing';
import { useSmartScore } from '../../../hooks/useSmartScore';
import type { SourcingItemDraft, ProfileTarget, PropertyType } from '../types/sourcing.types';
import {
  formatFloor,
  formatPrice,
  formatSurface,
  calculatePricePerSqm,
  parseFloor,
} from '../utils/validators';
import { getPropertyTypeLabel } from '../selectors/propertySelectors';

// ============================================
// FORM STATE (défini localement pour éviter les problèmes d'import)
// ============================================

interface FormState {
  codePostal: string;
  rueProche: string;
  ville: string;
  arrondissement: string;
  quartier: string;
  propertyType: string;
  price: string;
  surface: string;
  floor: string;
  [key: string]: string; // Pour les autres champs
}

const initialFormState: FormState = {
  codePostal: '',
  rueProche: '',
  ville: '',
  arrondissement: '',
  quartier: '',
  propertyType: '',
  price: '',
  surface: '',
  floor: '',
};

// ============================================
// STYLES
// ============================================

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f5f7fa',
  } as React.CSSProperties,
  container: {
    display: 'flex',
    gap: '24px',
    padding: '24px',
    maxWidth: '1600px',
    margin: '0 auto',
  } as React.CSSProperties,
  formSection: {
    flex: '1 1 55%',
    minWidth: 0,
  } as React.CSSProperties,
  // Colonne de droite: SmartScore + Résumé empilés
  rightSection: {
    flex: '1 1 45%',
    minWidth: '320px',
    maxWidth: '450px',
    position: 'sticky' as const,
    top: '24px',
    alignSelf: 'flex-start',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  } as React.CSSProperties,
  // SmartScore Card (en haut)
  smartScoreCard: {
    background: '#fff',
    borderRadius: '16px',
    padding: '32px 24px',
    textAlign: 'center' as const,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    border: '1px solid #e2e8f0',
  } as React.CSSProperties,
  smartScoreIcon: {
    width: '72px',
    height: '72px',
    margin: '0 auto 16px',
    background: 'linear-gradient(135deg, #e8f5e9 0%, #fff3e0 50%, #e3f2fd 100%)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,
  smartScoreTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: '8px',
  } as React.CSSProperties,
  smartScoreText: {
    fontSize: '0.875rem',
    color: '#64748b',
    lineHeight: 1.6,
    maxWidth: '280px',
    margin: '0 auto',
  } as React.CSSProperties,
  // Résumé Card (en bas)
  summaryCard: {
    background: '#fff',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    border: '1px solid #e2e8f0',
  } as React.CSSProperties,
  summaryTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1e293b',
    margin: '0 0 16px 0',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  } as React.CSSProperties,
  summarySection: {
    marginBottom: '16px',
  } as React.CSSProperties,
  summarySectionTitle: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '8px',
  } as React.CSSProperties,
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    fontSize: '0.875rem',
    borderBottom: '1px solid #f1f5f9',
  } as React.CSSProperties,
  summaryLabel: {
    color: '#64748b',
  } as React.CSSProperties,
  summaryValue: {
    color: '#1e293b',
    fontWeight: '500',
  } as React.CSSProperties,
  summaryValueEmpty: {
    color: '#cbd5e1',
  } as React.CSSProperties,
  summaryHighlight: {
    background: '#e0f2fe',
    padding: '12px',
    borderRadius: '8px',
    textAlign: 'center' as const,
    marginTop: '12px',
  } as React.CSSProperties,
  summaryPricePerSqm: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#0369a1',
  } as React.CSSProperties,
  summaryPriceLabel: {
    fontSize: '0.75rem',
    color: '#64748b',
    marginTop: '2px',
  } as React.CSSProperties,
  validationBox: {
    marginTop: '16px',
    padding: '12px',
    background: '#fffbeb',
    borderRadius: '8px',
    border: '1px solid #fbbf24',
  } as React.CSSProperties,
  validationBoxSuccess: {
    background: '#ecfdf5',
    border: '1px solid #10b981',
  } as React.CSSProperties,
  validationTitle: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#92400e',
    textTransform: 'uppercase' as const,
    marginBottom: '4px',
  } as React.CSSProperties,
  validationText: {
    fontSize: '0.875rem',
    color: '#b45309',
    margin: 0,
  } as React.CSSProperties,
  // Loading
  loadingContainer: {
    background: '#fff',
    borderRadius: '16px',
    padding: '48px 24px',
    textAlign: 'center' as const,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  } as React.CSSProperties,
  spinner: {
    width: '48px',
    height: '48px',
    border: '4px solid #e2e8f0',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto 16px',
  } as React.CSSProperties,
  loadingTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: '4px',
  } as React.CSSProperties,
  loadingText: {
    fontSize: '0.875rem',
    color: '#64748b',
  } as React.CSSProperties,
  // Toast
  toast: {
    position: 'fixed' as const,
    bottom: '24px',
    right: '24px',
    background: '#10b981',
    color: '#fff',
    padding: '16px 24px',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    zIndex: 1000,
    animation: 'slideIn 0.3s ease-out',
    maxWidth: '400px',
  } as React.CSSProperties,
  toastError: {
    background: '#ef4444',
  } as React.CSSProperties,
  toastIcon: {
    fontSize: '1.5rem',
    flexShrink: 0,
  } as React.CSSProperties,
  toastContent: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,
  toastTitle: {
    fontWeight: '600',
    fontSize: '0.9375rem',
  } as React.CSSProperties,
  toastMessage: {
    fontSize: '0.8125rem',
    opacity: 0.9,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as React.CSSProperties,
  toastClose: {
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    opacity: 0.8,
    fontSize: '1.125rem',
    lineHeight: 1,
    flexShrink: 0,
    transition: 'opacity 0.2s',
  } as React.CSSProperties,
};

const injectStyles = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('sourcing-toast-styles')) return;
  const style = document.createElement('style');
  style.id = 'sourcing-toast-styles';
  style.textContent = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
};

interface ToastProps {
  type: 'success' | 'error';
  title: string;
  message?: string;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ type, title, message, onClose }) => {
  useEffect(() => { injectStyles(); }, []);
  return (
    <div style={{ ...styles.toast, ...(type === 'error' ? styles.toastError : {}) }}>
      <span style={styles.toastIcon}>{type === 'success' ? '✓' : '✕'}</span>
      <div style={styles.toastContent}>
        <span style={styles.toastTitle}>{title}</span>
        {message && <span style={styles.toastMessage}>{message}</span>}
      </div>
      <button style={styles.toastClose} onClick={onClose} aria-label="Fermer">×</button>
    </div>
  );
};

// ============================================
// COMPOSANT: Résumé
// ============================================

interface SummaryPanelProps {
  form: FormState;
}

const SummaryPanel: React.FC<SummaryPanelProps> = ({ form }) => {
  const price = form.price ? parseFloat(form.price) : 0;
  const surface = form.surface ? parseFloat(form.surface) : 0;
  const pricePerSqm = calculatePricePerSqm(price, surface);
  const hasLocation = !!(form.codePostal && form.rueProche);
  const hasBasicInfo = !!(form.propertyType && form.price && form.surface);
  const isValid = hasLocation && hasBasicInfo;

  return (
    <div style={styles.summaryCard}>
      <h3 style={styles.summaryTitle}>📋 Résumé</h3>

      {/* Localisation */}
      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>LOCALISATION</div>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>Code postal</span>
          <span style={form.codePostal ? styles.summaryValue : styles.summaryValueEmpty}>
            {form.codePostal || '-'}
          </span>
        </div>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>Rue proche</span>
          <span style={form.rueProche ? styles.summaryValue : styles.summaryValueEmpty}>
            {form.rueProche || '-'}
          </span>
        </div>
        {form.ville && (
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>Ville</span>
            <span style={styles.summaryValue}>{form.ville}</span>
          </div>
        )}
      </div>

      {/* Bien */}
      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>BIEN</div>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>Type</span>
          <span style={form.propertyType ? styles.summaryValue : styles.summaryValueEmpty}>
            {form.propertyType ? getPropertyTypeLabel(form.propertyType as PropertyType) : '-'}
          </span>
        </div>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>Prix</span>
          <span style={price > 0 ? styles.summaryValue : styles.summaryValueEmpty}>
            {price > 0 ? formatPrice(price) : '-'}
          </span>
        </div>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>Surface</span>
          <span style={surface > 0 ? styles.summaryValue : styles.summaryValueEmpty}>
            {surface > 0 ? formatSurface(surface) : '-'}
          </span>
        </div>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>Étage</span>
          <span style={form.floor ? styles.summaryValue : styles.summaryValueEmpty}>
            {form.floor ? formatFloor(parseFloor(form.floor)) : '-'}
          </span>
        </div>
      </div>

      {/* Prix au m² */}
      {pricePerSqm && (
        <div style={styles.summaryHighlight}>
          <div style={styles.summaryPricePerSqm}>{formatPrice(pricePerSqm)}</div>
          <div style={styles.summaryPriceLabel}>prix au m²</div>
        </div>
      )}

      {/* Validation */}
      <div style={{
        ...styles.validationBox,
        ...(isValid ? styles.validationBoxSuccess : {}),
      }}>
        <div style={{
          ...styles.validationTitle,
          color: isValid ? '#065f46' : '#92400e',
        }}>
          VALIDATION
        </div>
        <p style={{
          ...styles.validationText,
          color: isValid ? '#047857' : '#b45309',
          margin: 0,
        }}>
          {isValid ? '✓ Prêt à analyser' : 'Remplir les champs obligatoires'}
        </p>
      </div>
    </div>
  );
};

// ============================================
// COMPOSANT: SmartScore Placeholder
// ============================================

const SmartScorePlaceholder: React.FC = () => (
  <div style={styles.smartScoreCard}>
    <div style={styles.smartScoreIcon}>
      <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
        <rect x="6" y="14" width="6" height="12" rx="1" fill="#22c55e" />
        <rect x="13" y="8" width="6" height="18" rx="1" fill="#f59e0b" />
        <rect x="20" y="4" width="6" height="22" rx="1" fill="#3b82f6" />
      </svg>
    </div>
    <div style={styles.smartScoreTitle}>SmartScore</div>
    <p style={styles.smartScoreText}>
      Remplissez le formulaire et cliquez sur "Enregistrer" pour calculer le score.
    </p>
  </div>
);

// ============================================
// COMPOSANT PRINCIPAL
// ============================================

interface SourcingHomePageProps {
  profileTarget?: ProfileTarget;
}

export const SourcingHomePage: React.FC<SourcingHomePageProps> = ({ profileTarget = 'mdb' }) => {
  const [toast, setToast] = useState<{ show: boolean; type: 'success' | 'error'; title: string; message?: string } | null>(null);
  const [formState, setFormState] = useState<FormState>(initialFormState);
  const { isLoading, score, hints, errors, analyzeAndComputeScore } = useSmartScore();

  useEffect(() => { injectStyles(); }, []);
  
  useEffect(() => {
    if (toast?.show) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  
  useEffect(() => {
    if (errors.length > 0) {
      setToast({ show: true, type: 'error', title: 'Erreur de scoring', message: errors[0] });
    }
  }, [errors]);

  const handleFormChange = useCallback((form: FormState) => {
    setFormState(form);
  }, []);

  const handleSubmit = useCallback(async (draft: SourcingItemDraft) => {
    console.log('=== SOURCING DRAFT SUBMITTED ===', draft);
    const apiDraft = {
      profileTarget: draft.profileTarget,
      location: {
        codePostal: draft.location?.codePostal || '',
        rueProche: draft.location?.rueProche || '',
        ville: draft.location?.ville || '',
      },
      input: {
        price: draft.price || 0,
        surface: draft.surface || 0,
        propertyType: draft.propertyType || 'appartement',
        floor: draft.floor || '1',
        nbPieces: draft.nbPieces,
        etatGeneral: draft.etatGeneral,
        dpe: draft.dpe,
        ascenseur: draft.ascenseur,
        balcon: draft.balcon,
        terrasse: draft.terrasse,
        cave: draft.cave,
        parking: draft.parking,
        jardin: draft.jardin,
        garage: draft.garage,
      },
      quartier: draft.quartier || {},
    };
    const result = await analyzeAndComputeScore(apiDraft as any, false);
    if (result) {
      setToast({ show: true, type: 'success', title: `SmartScore: ${result.globalScore}/100`, message: result.globalRationale });
    }
  }, [analyzeAndComputeScore]);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Colonne gauche: Formulaire */}
        <div style={styles.formSection}>
          <SourcingForm 
            profileTarget={profileTarget} 
            onSubmit={handleSubmit} 
            onFormChange={handleFormChange}
          />
        </div>

        {/* Colonne droite: SmartScore EN PREMIER + Résumé EN DESSOUS */}
        <div style={styles.rightSection}>
          {/* 1. SMARTSCORE (en haut) */}
          {isLoading ? (
            <div style={styles.loadingContainer}>
              <div style={styles.spinner}></div>
              <div style={styles.loadingTitle}>Analyse en cours...</div>
              <div style={styles.loadingText}>Géocodage et calcul du SmartScore</div>
            </div>
          ) : score ? (
            <SmartScorePanel score={score} hints={hints} compact />
          ) : (
            <SmartScorePlaceholder />
          )}

          {/* 2. RÉSUMÉ (en dessous) */}
          <SummaryPanel form={formState} />
        </div>
      </div>

      {toast?.show && (
        <Toast 
          type={toast.type} 
          title={toast.title} 
          message={toast.message} 
          onClose={() => setToast(null)} 
        />
      )}
    </div>
  );
};

export default SourcingHomePage;