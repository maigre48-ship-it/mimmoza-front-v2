import type { ActiveToolCall } from '../types/copilot.types';
import { record, number } from '../results/apiResultModel';
export type MapAnchor = { lat: number; lon: number; label: string; precision: string };
export const WMS_URL = 'https://georisques.gouv.fr/services';
export function legendUrl(layer: string) { return `${WMS_URL}?${new URLSearchParams({ service:'WMS', version:'1.3.0', request:'GetLegendGraphic', sld_version:'1.1.0', layer, format:'image/png', style:['CAVITE_LOCALISEE','MVT_LOCALISE'].includes(layer) ? 'inspire_common:DEFAULT' : 'default' })}`; }
export const THEMES = [
  { id: 'flood', label: 'Inondations', layers: [{ id: 'SUP_INOND', label: 'Périmètres des servitudes inondation' }, { id: 'REMNAPPE_FR', label: 'Remontées de nappes' }], note: 'Les servitudes et la sensibilité aux remontées de nappes ne constituent pas le zonage réglementaire détaillé rouge/bleu du PPRI. La couverture varie selon le territoire.' },
  { id: 'ground', label: 'Sols et mouvements', layers: [{ id: 'ALEARG', label: 'Exposition aux argiles' }, { id: 'CAVITE_LOCALISEE', label: 'Cavités localisées' }, { id: 'MVT_LOCALISE', label: 'Mouvements de terrain recensés' }], note: 'Les événements recensés et les cartes d’exposition ne remplacent pas une étude géotechnique. Les cavités sans localisation précise ne sont pas placées sur cette carte.' },
  { id: 'industry', label: 'Industrie et pollution', layers: [{ id: 'INSTALLATIONS_CLASSEES_SIMPLIFIE', label: 'Installations classées (ICPE)' }, { id: 'SSP_CLASSIFICATION_SIS', label: 'Secteurs d’information sur les sols' }, { id: 'SSP_ETABLISSEMENT', label: 'Anciens sites industriels (CASIAS)' }], note: 'Un site recensé n’établit pas une nuisance actuelle ni une pollution du terrain étudié. Les symboles et regroupements dépendent du zoom.' },
  { id: 'noise', label: 'Bruit', layers: [], note: 'Secteurs sonores repérés dans les annexes du GPU, sans mesure de décibels. Le classement n’est pas exhaustif ; vérifier les arrêtés préfectoraux et les cartes locales de bruit.' },
  { id: 'urbanism', label: 'Urbanisme', layers: [], note: 'Zones PLU, prescriptions et servitudes recoupant le périmètre de consultation. Leur affichage ne démontre pas la constructibilité et ne remplace pas le règlement écrit.' },
] as const;
export type ThemeId = typeof THEMES[number]['id'];
export function isGeoCall(call: ActiveToolCall) { return /^(get_(etude_parcelle|parcelle_depuis_adresse|parcel_summary|parcel_plu|zonage_plu|prescriptions_urbanisme|servitudes|risks_georisques|ppr_detail|classement_sonore|monuments_historiques|dvf_comparables|equipements_proches))$/.test(call.name); }
// Seules les coordonnées des résultats sont utilisées, jamais celles proposées par le modèle dans input.
export function mapAnchors(calls: ActiveToolCall[]): MapAnchor[] {
  const anchors: MapAnchor[] = [];
  for (const call of calls) {
    const out = record(call.output), d = record(out.data);
    if (!isGeoCall(call) || call.status !== 'success' || ['error', 'not_found', 'not_configured'].includes(String(out.status))) continue;
    for (const [raw, kind] of [[d.adresse, 'Point d’adresse'], [d.parcelle, 'Point de la parcelle'], [d.localisation, 'Point de recherche'], [d.meta, 'Point de recherche']] as const) {
      const p = record(raw), lat = number(p.lat), lon = number(p.lon ?? p.lng);
      if (lat == null || lon == null || lat < -85 || lat > 85 || lon < -180 || lon > 180) continue;
      const commune = ['centre_commune', 'municipality'].includes(String(p.precision)) || p.location_source === 'insee' || d.precision === 'centre_commune';
      const label = [p.libelle, p.label, p.idu, d.commune_nom].find(v => typeof v === 'string' && v.trim());
      if (!anchors.some(a => Math.abs(a.lat - lat) < 0.00001 && Math.abs(a.lon - lon) < 0.00001)) anchors.push({ lat, lon, label: String(label ?? kind), precision: commune ? 'Centre de commune · pas la parcelle' : p.precision === 'street' ? 'Voie localisée · numéro non confirmé' : kind });
    }
  }
  return anchors;
}
export function searchPolygon(point: MapAnchor, radiusM: number) {
  const dy = radiusM / 111000, dx = dy / Math.cos(point.lat * Math.PI / 180);
  return { type: 'Polygon', coordinates: [[[point.lon-dx, point.lat-dy], [point.lon+dx, point.lat-dy], [point.lon+dx, point.lat+dy], [point.lon-dx, point.lat+dy], [point.lon-dx, point.lat-dy]]] };
}
export function noiseProperties(value: unknown) {
  const p = record(value);
  return /(bruit|sonore|classement\s*sonore|nuisance)/i.test([p.libelle,p.typeref,p.nomsrctit,p.txt,p.destdomi,p.typeinfo,p.nomfic].filter(Boolean).join(' '));
}
export function featureLabel(value: unknown) { const p = record(value); return String([p.libelle,p.libelong,p.nomsuplitt,p.nomass,p.nom,p.typeref].find(v => typeof v === 'string' && v.trim()) ?? 'Élément cartographique'); }
export function validGeometry(value: unknown): boolean {
  const g = record(value);
  const depth = ({Point:0, MultiPoint:1, LineString:1, MultiLineString:2, Polygon:2, MultiPolygon:3} as Record<string,number>)[String(g.type)];
  const valid = (v: unknown, level: number): boolean => Array.isArray(v) && (level === 0 ? v.length >= 2 && number(v[0]) !== null && number(v[1]) !== null && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90 : v.length > 0 && v.every(x => valid(x,level-1)));
  return depth !== undefined && valid(g.coordinates,depth);
}
