import type { DossierParcel, ParcelDossier } from './parcelDossier';
import { evidenceScopeLabel, evidenceStatusLabel } from './parcelDossier';
import { decisionStatus, selectedArea, taxScenarios } from './dossierCalculations';
import type { CadastreFeature } from './DossierParcelMap';

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] ?? char));
const euro = (value: number) => `${Math.round(value).toLocaleString('fr-FR')} €`;

function polygonRings(feature: CadastreFeature): number[][][] {
  const geom = feature.geometry as { type?: string; coordinates?: unknown } | null;
  if (!geom || !Array.isArray(geom.coordinates)) return [];
  if (geom.type === 'Polygon') return geom.coordinates as number[][][];
  if (geom.type === 'MultiPolygon') return (geom.coordinates as number[][][][]).flat();
  return [];
}

/** Croquis vectoriel cadastral, centré sur le point ; aucune couche de risque n'est inventée. */
function parcelSketch(features: CadastreFeature[], point: ParcelDossier['point'], detectedId: string | null, selectedIds: Set<string>): string {
  if (!point || !features.length) return '<p class="muted">Plan cadastral interactif disponible dans le dossier en ligne.</p>';
  const cos = Math.cos(point.lat * Math.PI / 180);
  const paths = features.slice(0, 400).flatMap((feature) => {
    const rings = polygonRings(feature);
    const segments = rings.map((ring) => {
      const points = ring.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(([lon, lat]) => [Math.round((lon - point.lon) * 111_000 * cos * 10) / 10, Math.round((point.lat - lat) * 111_000 * 10) / 10]);
      if (points.length < 3) return '';
      return `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
    }).filter(Boolean).join(' ');
    if (!segments) return [];
    const id = feature.properties?.idu ?? '';
    const selected = selectedIds.has(id);
    const detected = id === detectedId;
    const fill = selected ? '#10b981' : detected ? '#f59e0b' : '#eef2f7';
    const stroke = selected ? '#047857' : detected ? '#b45309' : '#94a3b8';
    return [`<path d="${segments}" fill="${fill}" fill-opacity="${selected || detected ? '0.45' : '0.55'}" stroke="${stroke}" stroke-width="${selected || detected ? '2' : '0.8'}"/>`];
  }).join('');
  return `<svg class="parcel-sketch" viewBox="-120 -120 240 240" role="img" aria-label="Croquis cadastral autour du point d'adresse"><rect x="-120" y="-120" width="240" height="240" fill="#f8fafc"/>${paths}<circle cx="0" cy="0" r="4" fill="#dc2626" stroke="white" stroke-width="1.5"/><text x="88" y="-102" font-size="10" fill="#475569">N ↑</text><line x1="-105" y1="103" x2="-55" y2="103" stroke="#334155" stroke-width="2"/><text x="-105" y="97" font-size="8" fill="#475569">≈ 50 m</text></svg><p class="muted">Croquis issu des géométries cadastrales chargées autour du point d'adresse. Orange : parcelle repérée ; vert : parcelles choisies ; rouge : point d'adresse. Sans fond de plan ni valeur de délimitation juridique.</p>`;
}

export function buildParcelDossierHtml(input: {
  dossier: ParcelDossier;
  selected: DossierParcel[];
  builtSurfaceM2: number | null;
  cadastralRentPerM2: number;
  mapFeatures?: CadastreFeature[];
}): string {
  const { dossier, selected, builtSurfaceM2, cadastralRentPerM2 } = input;
  const status = decisionStatus(dossier, selected);
  const area = selectedArea(selected);
  const scenarios = taxScenarios(builtSurfaceM2, cadastralRentPerM2, dossier.taxRate);
  const map = parcelSketch(input.mapFeatures ?? [], dossier.point, dossier.detectedParcel?.id ?? null, new Set(selected.map((parcel) => parcel.id)));
  const evidenceCounts = dossier.evidences.reduce((counts, item) => {
    if (item.status === 'confirmed') counts.confirmed++;
    else if (item.status === 'estimated') counts.estimated++;
    else counts.unavailable++;
    return counts;
  }, { confirmed: 0, estimated: 0, unavailable: 0 });
  const maxTax = Math.max(1, ...scenarios.map((scenario) => scenario.builtTax));
  const taxBars = scenarios.map((scenario) => `<div class="bar-row"><span>${scenario.surfaceM2} m²</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(scenario.builtTax / maxTax * 100)}%"></div></div><strong>${euro(scenario.builtTax)}/an</strong></div>`).join('');
  const rows = dossier.evidences.map((evidence) => `<tr><td>${escapeHtml(evidence.label)}</td><td>${escapeHtml(evidence.value === null ? 'Non disponible' : typeof evidence.value === 'object' ? JSON.stringify(evidence.value) : evidence.value)}</td><td>${escapeHtml(evidenceScopeLabel(evidence.scope))}</td><td>${evidence.url ? `<a href="${escapeHtml(evidence.url)}">${escapeHtml(evidence.source)}</a>` : escapeHtml(evidence.source)}${evidence.sourceDate ? ` · ${escapeHtml(evidence.sourceDate)}` : ''}</td><td>${escapeHtml(evidenceStatusLabel(evidence.status))}</td></tr>`).join('');
  const taxes = scenarios.length ? `<table><thead><tr><th>Surface hypothétique</th><th>Valeur locative supposée</th><th>Base supposée</th><th>Taxe bâtie illustrative</th></tr></thead><tbody>${scenarios.map((scenario) => `<tr><td>${scenario.surfaceM2} m²</td><td>${euro(scenario.cadastralRent)}</td><td>${euro(scenario.taxableBase)}</td><td>${euro(scenario.builtTax)}/an</td></tr>`).join('')}</tbody></table>` : '<p>Taux fiscal indisponible : aucun montant calculé.</p>';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Dossier parcellaire Mimmoza</title><style>
    @page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172033;line-height:1.5;font-size:11px}h1{font-size:23px}h2{font-size:16px;margin-top:26px;border-bottom:1px solid #cbd5e1;padding-bottom:5px}table{border-collapse:collapse;width:100%;font-size:10px;margin:12px 0}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:top}th{background:#eef2ff}tr{break-inside:avoid}.callout{padding:12px;background:#fef3c7;border-left:4px solid #d97706}.muted{color:#64748b}a{color:#4338ca}.parcel-sketch{display:block;width:100%;max-width:320px;height:auto;margin:12px auto;border:1px solid #cbd5e1;border-radius:8px}.bar-row{display:flex;align-items:center;gap:8px;margin:7px 0}.bar-row>span{width:42px}.bar-row>strong{width:95px;text-align:right}.bar-track{flex:1;background:#e2e8f0;height:14px;border-radius:8px;overflow:hidden}.bar-fill{height:100%;background:#6366f1}.evidence-key{display:flex;gap:15px;margin:10px 0}.evidence-key b{color:#047857}.evidence-key em{color:#a16207}.evidence-key i{color:#b91c1c}footer{margin-top:30px;border-top:1px solid #cbd5e1;padding-top:10px;color:#64748b}
  </style></head><body>
  <header><strong>MIMMOZA</strong><span style="float:right">Dossier créé le ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</span></header>
  <h1>Dossier de décision parcellaire</h1><p><strong>${escapeHtml(dossier.address ?? 'Adresse non renseignée')}</strong></p>
  <div class="callout"><strong>${escapeHtml(status.label)}</strong><p>${escapeHtml(status.detail)}</p></div>
  <h2>Plan cadastral et périmètre retenu</h2>${map}
  <p>Parcelle repérée sous l’adresse : ${escapeHtml(dossier.detectedParcel?.id ?? 'inconnue')}. Parcelles confirmées par l’utilisateur : ${selected.length ? selected.map((p) => escapeHtml(p.id)).join(', ') : 'aucune'}.</p>
  <p>Surface cadastrale cumulée des parcelles sélectionnées : ${area === null ? 'non déterminable' : `${area.toLocaleString('fr-FR')} m²`}. Cette somme ne garantit ni la propriété juridique commune ni une emprise constructible.</p>
  <h2>Contraintes relevées</h2><p>Zone au point d’adresse : <strong>${escapeHtml(dossier.zone ?? 'indisponible')}</strong>. Prescriptions : ${escapeHtml(dossier.prescriptions.join(' ; ') || 'aucune donnée relevée')}. Servitudes au point : ${escapeHtml(dossier.servitudes.join(' ; ') || 'aucune donnée relevée')}.</p>
  <p>Le règlement écrit et les plans détaillés doivent être lus pour chaque parcelle avant de conclure sur un projet.</p>
  <h2>Scénarios fiscaux</h2><p>Hypothèse de calcul : valeur locative cadastrale annuelle de ${escapeHtml(cadastralRentPerM2)} €/m², surface pondérée supposée égale à la surface du bâtiment, base bâtie prise à 50 % ; taux ${escapeHtml(dossier.taxRate ?? 'non disponible')} %${dossier.taxYear ? ` (${escapeHtml(dossier.taxYear)})` : ''}. TEOM et exonérations exclues.</p>${taxBars}${taxes}
  <p class="muted">Ces chiffres illustrent la sensibilité à la surface et à la valeur locative supposée. Ils ne sont pas une estimation de l’avis fiscal du bien.</p>
  <h2>Disponibilité et portée des données</h2><p class="evidence-key"><b>${evidenceCounts.confirmed} confirmées</b><em>${evidenceCounts.estimated} estimées</em><i>${evidenceCounts.unavailable} indisponibles</i></p><p class="muted">Ce décompte ne mesure pas la faisabilité juridique. La portée de chaque donnée figure ci-dessous.</p><table><thead><tr><th>Donnée</th><th>Valeur</th><th>Portée</th><th>Source et date</th><th>Statut</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Points à lever</h2><ul>${dossier.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}${dossier.action ? `<li>${escapeHtml(dossier.action)}</li>` : ''}</ul>
  <footer>Source des données : sorties d’outils Mimmoza conservées avec la réponse du ${escapeHtml(new Date(dossier.sourceDate).toLocaleDateString('fr-FR'))}. À faire valider par un professionnel.</footer>
  </body></html>`;
}

export function printParcelDossier(input: Parameters<typeof buildParcelDossierHtml>[0]): boolean {
  const popup = window.open('', '_blank');
  if (!popup) return false;
  popup.document.open(); popup.document.write(buildParcelDossierHtml(input)); popup.document.close();
  popup.onload = () => setTimeout(() => popup.print(), 300);
  return true;
}
