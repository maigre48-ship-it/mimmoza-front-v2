import type { ActiveToolCall } from '../types/copilot.types';

export interface DossierEvidence {
  id: string;
  label: string;
  value: unknown;
  status: string;
  scope: string;
  source: string;
  sourceDate: string | null;
  confidence: number | null;
  warning: string | null;
  url: string | null;
}

export interface DossierParcel {
  id: string;
  areaM2: number | null;
}

export interface ParcelDossier {
  address: string | null;
  point: { lat: number; lon: number } | null;
  insee: string | null;
  detectedParcel: DossierParcel | null;
  zone: string | null;
  prescriptions: string[];
  servitudes: string[];
  taxRate: number | null;
  taxYear: string | null;
  evidences: DossierEvidence[];
  warnings: string[];
  action: string | null;
  sourceDate: string;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const asText = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function sourceUrl(id: string, insee: string | null, point: ParcelDossier['point']): string | null {
  if (id === 'reglement_plu' || id === 'servitudes') return 'https://www.geoportail-urbanisme.gouv.fr/';
  if (id.startsWith('risque_') || id === 'score_securite') {
    return point
      ? `https://georisques.gouv.fr/api/v1/rapport_pdf?latlon=${encodeURIComponent(`${point.lon},${point.lat}`)}`
      : 'https://www.georisques.gouv.fr/';
  }
  if (id === 'fiscalite_tfb') {
    const base = 'https://data.economie.gouv.fr/explore/dataset/fiscalite-locale-des-particuliers/';
    return insee ? `${base}?refine.insee_com=${encodeURIComponent(insee)}` : base;
  }
  if (id === 'surface_cadastrale') return 'https://cadastre.data.gouv.fr/';
  if (id === 'dvf_prix_m2') return 'https://explore.data.gouv.fr/fr/immobilier';
  return null;
}

function layerValues(urbanisme: Record<string, unknown> | null, layer: string): string[] {
  const couches = Array.isArray(urbanisme?.couches) ? urbanisme.couches : [];
  const item = couches.map(asRecord).find((v) => v?.couche === layer);
  if (item?.statut !== 'interrogee' || !Array.isArray(item.elements)) return [];
  return item.elements.map(asRecord).map((v) => asText(v?.libelle) ?? asText(v?.nom) ?? asText(v?.libelle_long)).filter((v): v is string => Boolean(v));
}

/** Utilise exclusivement les sorties d'outils conservées avec la réponse. */
export function buildParcelDossier(calls: ActiveToolCall[], sourceDate: string): ParcelDossier | null {
  const study = [...calls].reverse().find((call) => call.name === 'get_etude_parcelle' && call.status === 'success');
  const output = asRecord(study?.output);
  const data = asRecord(output?.data);
  if (!data || !Array.isArray(data.evidences)) return null;

  const resolution = [...calls].reverse().find((call) => call.name === 'get_parcelle_depuis_adresse' && call.status === 'success');
  const resolvedData = asRecord(asRecord(resolution?.output)?.data);
  const address = asRecord(resolvedData?.adresse);
  const parcel = asRecord(resolvedData?.parcelle) ?? asRecord(data.parcelle);
  const studyParcel = asRecord(data.parcelle);
  const insee = asText(parcel?.code_insee) ?? asText(studyParcel?.code_insee);
  const lat = asNumber(address?.lat) ?? asNumber(studyParcel?.lat);
  const lon = asNumber(address?.lon) ?? asNumber(studyParcel?.lon);
  const point = lat !== null && lon !== null ? { lat, lon } : null;
  const id = asText(parcel?.idu) ?? asText(studyParcel?.idu);
  const areaM2 = asNumber(parcel?.contenance_m2) ?? asNumber(studyParcel?.surface_m2);
  const urbanisme = asRecord(data.urbanisme_point);
  const zone = layerValues(urbanisme, 'zone-urba')[0] ?? null;
  const prescriptions = layerValues(urbanisme, 'prescription-surf');
  const servitudes = layerValues(urbanisme, 'assiette-sup-s');

  const evidences: DossierEvidence[] = data.evidences.map(asRecord).filter((v): v is Record<string, unknown> => Boolean(v)).map((ev) => ({
    id: asText(ev.id) ?? '', label: asText(ev.label) ?? asText(ev.id) ?? 'Donnée',
    value: ev.value ?? null, status: asText(ev.status) ?? 'unavailable',
    scope: asText(ev.scope) ?? 'unknown', source: asText(ev.source) ?? 'Source non précisée',
    sourceDate: asText(ev.sourceDate), confidence: asNumber(ev.confidence),
    warning: asText(ev.warning), url: asText(ev.sourceUrl) ?? sourceUrl(asText(ev.id) ?? '', insee, point),
  }));
  const tax = evidences.find((ev) => ev.id === 'fiscalite_tfb');
  const taxRate = tax?.status === 'confirmed' ? asNumber(tax.value) : null;
  const warnings = Array.isArray(data.avertissements) ? data.avertissements.map(asText).filter((v): v is string => Boolean(v)) : [];
  if (id) warnings.unshift('La parcelle détectée sous le point d’adresse ne prouve pas le périmètre de toute la propriété.');
  if (servitudes.some((v) => /PPRI|inond/i.test(v)) && evidences.some((v) => v.id === 'risque_ppr' && v.value === 0)) {
    warnings.unshift('Sources à confronter : le relevé communal PPR indique 0, mais une servitude PPRI recouvre le point d’adresse.');
  }
  const actions = Array.isArray(data.plan_action) ? data.plan_action.map(asRecord) : [];
  return {
    address: asText(address?.libelle), point, insee,
    detectedParcel: id ? { id, areaM2 } : null,
    zone, prescriptions, servitudes, taxRate, taxYear: tax?.sourceDate ?? null,
    evidences, warnings, action: actions.map((v) => asText(v?.action)).find(Boolean) ?? null,
    sourceDate,
  };
}

const statusLabels: Record<string, string> = {
  confirmed: 'confirmée', estimated: 'estimée', unavailable: 'indisponible',
  partial: 'partielle', unknown: 'inconnue',
};
const scopeLabels: Record<string, string> = {
  point: 'Point d’adresse', parcel: 'Parcelle', municipality: 'Commune',
  nearby: 'Voisinage', unknown: 'Portée inconnue',
};
export const evidenceStatusLabel = (status: string) => statusLabels[status] ?? status;
export const evidenceScopeLabel = (scope: string) => scopeLabels[scope] ?? scope;

export function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return 'Non disponible';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'number') return value.toLocaleString('fr-FR');
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(formatEvidenceValue).join(' · ');
  if (typeof value === 'object') return Object.entries(value).map(([key, v]) => `${key} : ${formatEvidenceValue(v)}`).join(' · ');
  return String(value);
}
