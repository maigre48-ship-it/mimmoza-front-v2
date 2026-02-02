/**
 * SourcingForm - Formulaire de saisie d'opportunité
 * Transversal: utilisable par MDB, Promoteur, Particulier
 * NOTE: Ce composant ne contient QUE le formulaire. Le Résumé et SmartScore sont gérés par SourcingHomePage.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type {
  ProfileTarget,
  PropertyType,
  SourcingInput,
  SourcingItemDraft,
  Ternary,
  ProximiteTransport,
  NuisanceLevel,
  Exposition,
  StandingImmeuble,
  StationnementMaison,
  EtatGeneral,
  PenteTerrain,
  AccesTerrain,
} from '../types/sourcing.types';
import { PROFILE_LABELS } from '../types/sourcing.types';
import {
  validateDraft,
  normalizeDraft,
  parseFloor,
} from '../utils/validators';
import {
  getPropertyTypeOptions,
  getTernaryOptions,
  getFloorOptions,
  getProximiteTransportOptions,
  getDistanceTransportOptions,
  getNuisanceOptions,
  getExpositionOptions,
  getStandingOptions,
  getBooleanOptions,
  getStationnementMaisonOptions,
  getEtatGeneralOptions,
  getPenteOptions,
  getAccesOptions,
} from '../selectors/propertySelectors';

// ============================================
// STYLES
// ============================================

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  } as React.CSSProperties,
  header: {
    marginBottom: '24px',
  } as React.CSSProperties,
  title: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#1a1a2e',
    margin: '0 0 4px 0',
  } as React.CSSProperties,
  subtitle: {
    fontSize: '0.875rem',
    color: '#666',
    margin: 0,
  } as React.CSSProperties,
  section: {
    background: '#fff',
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '16px',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 16px 0',
    paddingBottom: '8px',
    borderBottom: '1px solid #eee',
  } as React.CSSProperties,
  fieldRow: {
    display: 'flex',
    gap: '16px',
    marginBottom: '16px',
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  field: {
    flex: '1 1 200px',
    minWidth: '150px',
  } as React.CSSProperties,
  fieldSmall: {
    flex: '0 1 120px',
    minWidth: '100px',
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#444',
    marginBottom: '6px',
  } as React.CSSProperties,
  required: {
    color: '#e74c3c',
    marginLeft: '2px',
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '0.9375rem',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  inputError: {
    borderColor: '#e74c3c',
    background: '#fff5f5',
  } as React.CSSProperties,
  select: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '0.9375rem',
    background: '#fff',
    cursor: 'pointer',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  textarea: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '0.9375rem',
    minHeight: '80px',
    resize: 'vertical' as const,
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  errorText: {
    color: '#e74c3c',
    fontSize: '0.75rem',
    marginTop: '4px',
  } as React.CSSProperties,
  buttonRow: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
  } as React.CSSProperties,
  buttonPrimary: {
    flex: 1,
    padding: '12px 24px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '1rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background 0.2s',
  } as React.CSSProperties,
  buttonSecondary: {
    padding: '12px 24px',
    background: '#f5f5f5',
    color: '#333',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '1rem',
    cursor: 'pointer',
    transition: 'background 0.2s',
  } as React.CSSProperties,
  conditionalSection: {
    background: '#fafbfc',
    border: '1px dashed #d0d7de',
    borderRadius: '6px',
    padding: '16px',
    marginTop: '12px',
  } as React.CSSProperties,
};

// ============================================
// FORM STATE (exporté pour le parent)
// ============================================

export interface FormState {
  codePostal: string;
  rueProche: string;
  ville: string;
  arrondissement: string;
  quartier: string;
  propertyType: PropertyType | '';
  price: string;
  surface: string;
  floor: string;
  proximiteTransport: ProximiteTransport | '';
  distanceTransport: string;
  proximiteCommerces: string;
  nuisances: NuisanceLevel | '';
  exposition: Exposition | '';
  ruePassante: string;
  standingImmeuble: StandingImmeuble | '';
  commentaire: string;
  jardin: Ternary | '';
  terrasse: Ternary | '';
  piscine: Ternary | '';
  stationnement: StationnementMaison | '';
  ascenseurAppart: Ternary | '';
  balcon: Ternary | '';
  cave: Ternary | '';
  parkingAppart: Ternary | '';
  nbLots: string;
  ascenseurImmeuble: Ternary | '';
  etatGeneral: EtatGeneral | '';
  revenusLocatifsConnus: string;
  montantMensuel: string;
  surfaceParcelle: string;
  pente: PenteTerrain | '';
  acces: AccesTerrain | '';
  viabilise: Ternary | '';
}

export const initialFormState: FormState = {
  codePostal: '',
  rueProche: '',
  ville: '',
  arrondissement: '',
  quartier: '',
  propertyType: '',
  price: '',
  surface: '',
  floor: '',
  proximiteTransport: '',
  distanceTransport: '',
  proximiteCommerces: '',
  nuisances: '',
  exposition: '',
  ruePassante: '',
  standingImmeuble: '',
  commentaire: '',
  jardin: '',
  terrasse: '',
  piscine: '',
  stationnement: '',
  ascenseurAppart: '',
  balcon: '',
  cave: '',
  parkingAppart: '',
  nbLots: '',
  ascenseurImmeuble: '',
  etatGeneral: '',
  revenusLocatifsConnus: '',
  montantMensuel: '',
  surfaceParcelle: '',
  pente: '',
  acces: '',
  viabilise: '',
};

// ============================================
// PROPS
// ============================================

interface SourcingFormProps {
  profileTarget: ProfileTarget;
  onSubmit: (draft: SourcingItemDraft) => void;
  onFormChange?: (form: FormState) => void;
  initialData?: Partial<SourcingInput>;
}

// ============================================
// COMPONENT
// ============================================

export const SourcingForm: React.FC<SourcingFormProps> = ({
  profileTarget,
  onSubmit,
  onFormChange,
  initialData,
}) => {
  const [form, setForm] = useState<FormState>({ ...initialFormState });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    onFormChange?.(form);
  }, [form, onFormChange]);

  const updateField = useCallback(<K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setTouched(prev => ({ ...prev, [field]: true }));
    setErrors(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const buildDraft = useCallback((): Partial<SourcingInput> => {
    const draft: Partial<SourcingInput> = {
      location: {
        codePostal: form.codePostal,
        rueProche: form.rueProche,
        ville: form.ville || undefined,
        arrondissement: form.arrondissement || undefined,
        quartier: form.quartier || undefined,
      },
      propertyType: form.propertyType as PropertyType || undefined,
      price: form.price ? parseFloat(form.price) : undefined,
      surface: form.surface ? parseFloat(form.surface) : undefined,
      floor: parseFloor(form.floor) ?? undefined,
    };

    if (form.proximiteTransport || form.nuisances || form.exposition || 
        form.standingImmeuble || form.commentaire || form.proximiteCommerces || form.ruePassante) {
      draft.quartier = {
        proximiteTransport: form.proximiteTransport as ProximiteTransport || undefined,
        distanceTransport: form.distanceTransport ? parseInt(form.distanceTransport) : undefined,
        proximiteCommerces: form.proximiteCommerces === 'true' ? true : form.proximiteCommerces === 'false' ? false : undefined,
        nuisances: form.nuisances as NuisanceLevel || undefined,
        exposition: form.exposition as Exposition || undefined,
        ruePassante: form.ruePassante === 'true' ? true : form.ruePassante === 'false' ? false : undefined,
        standingImmeuble: form.standingImmeuble as StandingImmeuble || undefined,
        commentaire: form.commentaire || undefined,
      };
    }

    if (form.propertyType === 'house') {
      draft.houseOptions = {
        jardin: form.jardin as Ternary || undefined,
        terrasse: form.terrasse as Ternary || undefined,
        piscine: form.piscine as Ternary || undefined,
        stationnement: form.stationnement as StationnementMaison || undefined,
      };
    } else if (form.propertyType === 'apartment') {
      draft.apartmentOptions = {
        ascenseur: form.ascenseurAppart as Ternary || undefined,
        balcon: form.balcon as Ternary || undefined,
        cave: form.cave as Ternary || undefined,
        parking: form.parkingAppart as Ternary || undefined,
      };
    } else if (form.propertyType === 'building') {
      draft.buildingOptions = {
        nbLots: form.nbLots ? parseInt(form.nbLots) : undefined,
        ascenseur: form.ascenseurImmeuble as Ternary || undefined,
        etatGeneral: form.etatGeneral as EtatGeneral || undefined,
        revenusLocatifsConnus: form.revenusLocatifsConnus === 'true',
        montantMensuel: form.montantMensuel ? parseFloat(form.montantMensuel) : undefined,
      };
    } else if (form.propertyType === 'land') {
      draft.landOptions = {
        surfaceParcelle: form.surfaceParcelle ? parseFloat(form.surfaceParcelle) : undefined,
        pente: form.pente as PenteTerrain || undefined,
        acces: form.acces as AccesTerrain || undefined,
        viabilise: form.viabilise as Ternary || undefined,
      };
    }

    return draft;
  }, [form]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const draft = buildDraft();
    const validation = validateDraft(draft);
    
    if (!validation.ok) {
      setErrors(validation.errors);
      const touchedFields: Record<string, boolean> = {};
      Object.keys(validation.errors).forEach(key => {
        const field = key.replace('location.', '') as keyof FormState;
        touchedFields[field] = true;
      });
      setTouched(prev => ({ ...prev, ...touchedFields }));
      return;
    }

    const normalized = normalizeDraft(draft as SourcingInput);
    const finalDraft: SourcingItemDraft = {
      ...normalized,
      profileTarget,
      createdAt: new Date(),
    };

    onSubmit(finalDraft);
  }, [buildDraft, profileTarget, onSubmit]);

  const handleReset = useCallback(() => {
    setForm({ ...initialFormState });
    setErrors({});
    setTouched({});
  }, []);

  const getError = (field: string): string | undefined => {
    const locationField = `location.${field}`;
    return errors[field] || errors[locationField];
  };

  const hasError = (field: string): boolean => {
    return !!(touched[field] && getError(field));
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Nouvelle opportunité</h1>
        <p style={styles.subtitle}>Profil: {PROFILE_LABELS[profileTarget]}</p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Section A: Localisation */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>📍 Localisation</h2>
          
          <div style={styles.fieldRow}>
            <div style={styles.fieldSmall}>
              <label style={styles.label}>
                Code postal <span style={styles.required}>*</span>
              </label>
              <input
                type="text"
                value={form.codePostal}
                onChange={e => updateField('codePostal', e.target.value)}
                placeholder="75001"
                maxLength={5}
                style={{ ...styles.input, ...(hasError('codePostal') ? styles.inputError : {}) }}
              />
              {hasError('codePostal') && <div style={styles.errorText}>{getError('codePostal')}</div>}
            </div>
            
            <div style={styles.field}>
              <label style={styles.label}>
                Rue proche / Repère <span style={styles.required}>*</span>
              </label>
              <input
                type="text"
                value={form.rueProche}
                onChange={e => updateField('rueProche', e.target.value)}
                placeholder="Rue de Rivoli, Place Vendôme..."
                style={{ ...styles.input, ...(hasError('rueProche') ? styles.inputError : {}) }}
              />
              {hasError('rueProche') && <div style={styles.errorText}>{getError('rueProche')}</div>}
            </div>
          </div>

          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Ville</label>
              <input
                type="text"
                value={form.ville}
                onChange={e => updateField('ville', e.target.value)}
                placeholder="Paris"
                style={styles.input}
              />
            </div>
            
            <div style={styles.fieldSmall}>
              <label style={styles.label}>Arrondissement</label>
              <input
                type="text"
                value={form.arrondissement}
                onChange={e => updateField('arrondissement', e.target.value)}
                placeholder="1er"
                style={styles.input}
              />
            </div>
            
            <div style={styles.field}>
              <label style={styles.label}>Quartier</label>
              <input
                type="text"
                value={form.quartier}
                onChange={e => updateField('quartier', e.target.value)}
                placeholder="Les Halles"
                style={styles.input}
              />
            </div>
          </div>
        </div>

        {/* Section B: Bien */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>🏠 Caractéristiques du bien</h2>
          
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>
                Type de bien <span style={styles.required}>*</span>
              </label>
              <select
                value={form.propertyType}
                onChange={e => updateField('propertyType', e.target.value as PropertyType)}
                style={{ ...styles.select, ...(hasError('propertyType') ? styles.inputError : {}) }}
              >
                <option value="">Sélectionner...</option>
                {getPropertyTypeOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {hasError('propertyType') && <div style={styles.errorText}>{getError('propertyType')}</div>}
            </div>

            <div style={styles.fieldSmall}>
              <label style={styles.label}>
                Étage <span style={styles.required}>*</span>
              </label>
              <select
                value={form.floor}
                onChange={e => updateField('floor', e.target.value)}
                style={{ ...styles.select, ...(hasError('floor') ? styles.inputError : {}) }}
              >
                <option value="">Sélectionner...</option>
                {getFloorOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {hasError('floor') && <div style={styles.errorText}>{getError('floor')}</div>}
            </div>
          </div>

          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>
                Prix affiché (€) <span style={styles.required}>*</span>
              </label>
              <input
                type="number"
                value={form.price}
                onChange={e => updateField('price', e.target.value)}
                placeholder="350000"
                min="0"
                step="1000"
                style={{ ...styles.input, ...(hasError('price') ? styles.inputError : {}) }}
              />
              {hasError('price') && <div style={styles.errorText}>{getError('price')}</div>}
            </div>

            <div style={styles.field}>
              <label style={styles.label}>
                Surface (m²) <span style={styles.required}>*</span>
              </label>
              <input
                type="number"
                value={form.surface}
                onChange={e => updateField('surface', e.target.value)}
                placeholder="65"
                min="0"
                step="1"
                style={{ ...styles.input, ...(hasError('surface') ? styles.inputError : {}) }}
              />
              {hasError('surface') && <div style={styles.errorText}>{getError('surface')}</div>}
            </div>
          </div>
        </div>

        {/* Section C: Quartier (optionnel) */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>🏘️ Informations quartier (optionnel)</h2>
          
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Proximité transport</label>
              <select
                value={form.proximiteTransport}
                onChange={e => updateField('proximiteTransport', e.target.value as ProximiteTransport)}
                style={styles.select}
              >
                <option value="">Non renseigné</option>
                {getProximiteTransportOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {form.proximiteTransport && form.proximiteTransport !== 'aucun' && (
              <div style={styles.fieldSmall}>
                <label style={styles.label}>Distance</label>
                <select
                  value={form.distanceTransport}
                  onChange={e => updateField('distanceTransport', e.target.value)}
                  style={styles.select}
                >
                  <option value="">Non renseigné</option>
                  {getDistanceTransportOptions().map(opt => (
                    <option key={opt.value} value={String(opt.value)}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={styles.fieldSmall}>
              <label style={styles.label}>Commerces</label>
              <select
                value={form.proximiteCommerces}
                onChange={e => updateField('proximiteCommerces', e.target.value)}
                style={styles.select}
              >
                <option value="">Non renseigné</option>
                {getBooleanOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={styles.fieldRow}>
            <div style={styles.fieldSmall}>
              <label style={styles.label}>Nuisances</label>
              <select
                value={form.nuisances}
                onChange={e => updateField('nuisances', e.target.value as NuisanceLevel)}
                style={styles.select}
              >
                <option value="">Non renseigné</option>
                {getNuisanceOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div style={styles.fieldSmall}>
              <label style={styles.label}>Exposition</label>
              <select
                value={form.exposition}
                onChange={e => updateField('exposition', e.target.value as Exposition)}
                style={styles.select}
              >
                <option value="">Non renseigné</option>
                {getExpositionOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div style={styles.fieldSmall}>
              <label style={styles.label}>Rue passante</label>
              <select
                value={form.ruePassante}
                onChange={e => updateField('ruePassante', e.target.value)}
                style={styles.select}
              >
                <option value="">Non renseigné</option>
                {getBooleanOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Standing immeuble</label>
              <select
                value={form.standingImmeuble}
                onChange={e => updateField('standingImmeuble', e.target.value as StandingImmeuble)}
                style={styles.select}
              >
                <option value="">Non renseigné</option>
                {getStandingOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={styles.fieldRow}>
            <div style={{ ...styles.field, flex: '1 1 100%' }}>
              <label style={styles.label}>Commentaire libre</label>
              <textarea
                value={form.commentaire}
                onChange={e => updateField('commentaire', e.target.value)}
                placeholder="Notes sur le quartier, l'environnement, points d'attention..."
                style={styles.textarea}
              />
            </div>
          </div>
        </div>

        {/* Section D: Options spécifiques selon type */}
        {form.propertyType === 'house' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>🏡 Options Maison</h2>
            <div style={styles.conditionalSection}>
              <div style={styles.fieldRow}>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Jardin</label>
                  <select value={form.jardin} onChange={e => updateField('jardin', e.target.value as Ternary)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getTernaryOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Terrasse</label>
                  <select value={form.terrasse} onChange={e => updateField('terrasse', e.target.value as Ternary)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getTernaryOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Piscine</label>
                  <select value={form.piscine} onChange={e => updateField('piscine', e.target.value as Ternary)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getTernaryOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Stationnement</label>
                  <select value={form.stationnement} onChange={e => updateField('stationnement', e.target.value as StationnementMaison)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getStationnementMaisonOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {form.propertyType === 'apartment' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>🏢 Options Appartement</h2>
            <div style={styles.conditionalSection}>
              <div style={styles.fieldRow}>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Ascenseur</label>
                  <select value={form.ascenseurAppart} onChange={e => updateField('ascenseurAppart', e.target.value as Ternary)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getTernaryOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Balcon</label>
                  <select value={form.balcon} onChange={e => updateField('balcon', e.target.value as Ternary)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getTernaryOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Cave</label>
                  <select value={form.cave} onChange={e => updateField('cave', e.target.value as Ternary)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getTernaryOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Parking</label>
                  <select value={form.parkingAppart} onChange={e => updateField('parkingAppart', e.target.value as Ternary)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getTernaryOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {form.propertyType === 'building' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>🏛️ Options Immeuble</h2>
            <div style={styles.conditionalSection}>
              <div style={styles.fieldRow}>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Nb de lots</label>
                  <input type="number" value={form.nbLots} onChange={e => updateField('nbLots', e.target.value)} placeholder="6" min="1" style={styles.input} />
                </div>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Ascenseur</label>
                  <select value={form.ascenseurImmeuble} onChange={e => updateField('ascenseurImmeuble', e.target.value as Ternary)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getTernaryOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>État général</label>
                  <select value={form.etatGeneral} onChange={e => updateField('etatGeneral', e.target.value as EtatGeneral)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getEtatGeneralOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={styles.fieldRow}>
                <div style={styles.field}>
                  <label style={styles.label}>Revenus locatifs connus</label>
                  <select value={form.revenusLocatifsConnus} onChange={e => updateField('revenusLocatifsConnus', e.target.value)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getBooleanOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                {form.revenusLocatifsConnus === 'true' && (
                  <div style={styles.field}>
                    <label style={styles.label}>Montant mensuel (€)</label>
                    <input type="number" value={form.montantMensuel} onChange={e => updateField('montantMensuel', e.target.value)} placeholder="2500" min="0" step="100" style={styles.input} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {form.propertyType === 'land' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>🌳 Options Terrain</h2>
            <div style={styles.conditionalSection}>
              <div style={styles.fieldRow}>
                <div style={styles.field}>
                  <label style={styles.label}>Surface parcelle (m²)</label>
                  <input type="number" value={form.surfaceParcelle} onChange={e => updateField('surfaceParcelle', e.target.value)} placeholder="800" min="0" style={styles.input} />
                </div>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Pente</label>
                  <select value={form.pente} onChange={e => updateField('pente', e.target.value as PenteTerrain)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getPenteOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Accès</label>
                  <select value={form.acces} onChange={e => updateField('acces', e.target.value as AccesTerrain)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getAccesOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div style={styles.fieldSmall}>
                  <label style={styles.label}>Viabilisé</label>
                  <select value={form.viabilise} onChange={e => updateField('viabilise', e.target.value as Ternary)} style={styles.select}>
                    <option value="">Non renseigné</option>
                    {getTernaryOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div style={styles.buttonRow}>
          <button type="submit" style={styles.buttonPrimary}>✓ Analyser</button>
          <button type="button" onClick={handleReset} style={styles.buttonSecondary}>↺ Réinitialiser</button>
        </div>
      </form>
    </div>
  );
};

export default SourcingForm;