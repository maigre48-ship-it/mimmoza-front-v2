import type { DossierParcel, ParcelDossier } from './parcelDossier';
import { evidenceScopeLabel, evidenceStatusLabel } from './parcelDossier';
import { decisionStatus, selectedArea, taxScenarios } from './dossierCalculations';

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] ?? char));
const euro = (value: number) => `${Math.round(value).toLocaleString('fr-FR')} €`;

export function buildParcelDossierHtml(input: {
  dossier: ParcelDossier;
  selected: DossierParcel[];
  builtSurfaceM2: number | null;
  cadastralRentPerM2: number;
}): string {
  const { dossier, selected, builtSurfaceM2, cadastralRentPerM2 } = input;
  const status = decisionStatus(dossier, selected);
  const area = selectedArea(selected);
  const scenarios = taxScenarios(builtSurfaceM2, cadastralRentPerM2, dossier.taxRate);
  const rows = dossier.evidences.map((evidence) => `<tr><td>${escapeHtml(evidence.label)}</td><td>${escapeHtml(evidence.value === null ? 'Non disponible' : typeof evidence.value === 'object' ? JSON.stringify(evidence.value) : evidence.value)}</td><td>${escapeHtml(evidenceScopeLabel(evidence.scope))}</td><td>${evidence.url ? `<a href="${escapeHtml(evidence.url)}">${escapeHtml(evidence.source)}</a>` : escapeHtml(evidence.source)}${evidence.sourceDate ? ` · ${escapeHtml(evidence.sourceDate)}` : ''}</td><td>${escapeHtml(evidenceStatusLabel(evidence.status))}</td></tr>`).join('');
  const taxes = scenarios.length ? `<table><thead><tr><th>Surface hypothétique</th><th>Valeur locative supposée</th><th>Base supposée</th><th>Taxe bâtie illustrative</th></tr></thead><tbody>${scenarios.map((scenario) => `<tr><td>${scenario.surfaceM2} m²</td><td>${euro(scenario.cadastralRent)}</td><td>${euro(scenario.taxableBase)}</td><td>${euro(scenario.builtTax)}/an</td></tr>`).join('')}</tbody></table>` : '<p>Taux fiscal indisponible : aucun montant calculé.</p>';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Dossier parcellaire Mimmoza</title><style>
    @page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172033;line-height:1.5;font-size:11px}h1{font-size:23px}h2{font-size:16px;margin-top:26px;border-bottom:1px solid #cbd5e1;padding-bottom:5px}table{border-collapse:collapse;width:100%;font-size:10px;margin:12px 0}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:top}th{background:#eef2ff}tr{break-inside:avoid}.callout{padding:12px;background:#fef3c7;border-left:4px solid #d97706}.muted{color:#64748b}a{color:#4338ca}footer{margin-top:30px;border-top:1px solid #cbd5e1;padding-top:10px;color:#64748b}
  </style></head><body>
  <header><strong>MIMMOZA</strong><span style="float:right">Dossier créé le ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</span></header>
  <h1>Dossier de décision parcellaire</h1><p><strong>${escapeHtml(dossier.address ?? 'Adresse non renseignée')}</strong></p>
  <div class="callout"><strong>${escapeHtml(status.label)}</strong><p>${escapeHtml(status.detail)}</p></div>
  <h2>Périmètre retenu</h2>
  <p>Parcelle repérée sous l’adresse : ${escapeHtml(dossier.detectedParcel?.id ?? 'inconnue')}. Parcelles confirmées par l’utilisateur : ${selected.length ? selected.map((p) => escapeHtml(p.id)).join(', ') : 'aucune'}.</p>
  <p>Surface cadastrale cumulée des parcelles sélectionnées : ${area === null ? 'non déterminable' : `${area.toLocaleString('fr-FR')} m²`}. Cette somme ne garantit ni la propriété juridique commune ni une emprise constructible.</p>
  <h2>Contraintes relevées</h2><p>Zone au point d’adresse : <strong>${escapeHtml(dossier.zone ?? 'indisponible')}</strong>. Prescriptions : ${escapeHtml(dossier.prescriptions.join(' ; ') || 'aucune donnée relevée')}. Servitudes au point : ${escapeHtml(dossier.servitudes.join(' ; ') || 'aucune donnée relevée')}.</p>
  <p>Le règlement écrit et les plans détaillés doivent être lus pour chaque parcelle avant de conclure sur un projet.</p>
  <h2>Scénarios fiscaux</h2><p>Hypothèse de calcul : valeur locative cadastrale annuelle de ${escapeHtml(cadastralRentPerM2)} €/m², surface pondérée supposée égale à la surface du bâtiment, base bâtie prise à 50 % ; taux ${escapeHtml(dossier.taxRate ?? 'non disponible')} %${dossier.taxYear ? ` (${escapeHtml(dossier.taxYear)})` : ''}. TEOM et exonérations exclues.</p>${taxes}
  <p class="muted">Ces chiffres illustrent la sensibilité à la surface et à la valeur locative supposée. Ils ne sont pas une estimation de l’avis fiscal du bien.</p>
  <h2>Preuves et portée</h2><table><thead><tr><th>Donnée</th><th>Valeur</th><th>Portée</th><th>Source et date</th><th>Statut</th></tr></thead><tbody>${rows}</tbody></table>
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
