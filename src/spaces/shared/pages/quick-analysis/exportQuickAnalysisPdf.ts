// src/spaces/shared/pages/quick-analysis/exportQuickAnalysisPdf.ts
// ─────────────────────────────────────────────────────────────────────────────
// Export PDF structuré du résultat d'une Analyse rapide Mimmoza.
// Méthode : fenêtre d'impression (window.open + print()). Aucune dépendance.
// Le logo est chargé depuis /public et embarqué en base64.
// ─────────────────────────────────────────────────────────────────────────────

const LOGO_URL = '/Logo/Logo_mimmoza_base_line_redecoupe.png';

// ── Types d'entrée (sous-ensemble minimal utilisé par l'export) ──────────────
export interface QuickAnalysisForm {
  address?: string;
  city?: string;
  postalCode?: string;
  surface?: string;
  askingPrice?: string;
  propertyType?: string;
}

export interface QuickAnalysisComparable {
  saleDate: string;
  surface: number;
  price: number;
  priceM2: number;
  weight: number;
  outOfMarket?: boolean;
  distanceMeters?: number;
}

export interface QuickAnalysisResult {
  estimatedValue: number;
  minEstimatedValue?: number | null;
  maxEstimatedValue?: number | null;
  marketPriceM2?: number | null;
  marketPosition?: string;
  opportunityScore: number;
  securityScore: number;
  confidenceScore: number;
  locationScore?: number | null;
  locationAvailable?: boolean;
  locationBreakdown?: {
    transport?: number | null;
    commerces?: number | null;
    ecoles?: number | null;
    marche_local?: number | null;
  };
  estimatedRent?: number | null;
  grossYield?: number | null;
  netYield?: number | null;
  recommendation?: string;
  strengths?: string[];
  warnings?: string[];
  weaknesses?: string[];
  comparables?: QuickAnalysisComparable[];
  valuationBasis?: string;
  meta?: { engineVersion?: string; comparablesUsed?: number };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function fmtEur(n: number | null | undefined, suffix = '€'): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + '\u202f' + suffix;
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toFixed(1) + '\u202f%';
}
function positionLabel(pos?: string): string {
  if (pos === 'underpriced') return 'Décote détectée';
  if (pos === 'overpriced') return 'Prix supérieur au marché';
  return 'Prix cohérent avec le marché';
}
function scoreColor(v: number): string {
  if (v >= 75) return '#166534';
  if (v >= 50) return '#854d0e';
  return '#991b1b';
}

async function loadLogoBase64(): Promise<string | null> {
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Bloc "carte score" réutilisable.
function scoreCard(label: string, value: number, sub: string): string {
  const c = scoreColor(value);
  return `
    <div style="flex:1;min-width:150px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;text-align:center;">
      <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(label)}</div>
      <div style="font-size:26px;font-weight:800;color:${c};margin-top:4px;">${value}<span style="font-size:13px;color:#94a3b8;">/100</span></div>
      <div style="font-size:11px;color:${c};font-weight:600;margin-top:2px;">${escapeHtml(sub)}</div>
    </div>`;
}

function kvRow(label: string, value: string, color = '#111827'): string {
  return `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;">
      <span style="font-size:12px;color:#64748b;">${escapeHtml(label)}</span>
      <span style="font-size:13px;font-weight:700;color:${color};">${escapeHtml(value)}</span>
    </div>`;
}

export async function exportQuickAnalysisToPdf(params: {
  form: QuickAnalysisForm;
  result: QuickAnalysisResult;
}): Promise<void> {
  const { form, result } = params;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Autorisez les popups pour générer le PDF.');
    return;
  }
  printWindow.document.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Analyse rapide Mimmoza</title></head>' +
    '<body style="font-family:Arial,sans-serif;color:#64748b;padding:40px;">Préparation du rapport…</body></html>',
  );
  printWindow.document.close();

  const logo = await loadLogoBase64();

  const bien = [form.address, form.postalCode, form.city]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' · ');

  const askingPrice = form.askingPrice ? Number(form.askingPrice) : undefined;
  const ecart =
    askingPrice != null && result.estimatedValue > 0
      ? askingPrice - result.estimatedValue
      : undefined;
  const ecartPct =
    ecart != null && result.estimatedValue > 0
      ? (ecart / result.estimatedValue) * 100
      : undefined;

  const oppSub =
    result.opportunityScore >= 71 ? 'Bonne opportunité'
    : result.opportunityScore >= 51 ? 'Opportunité correcte'
    : result.opportunityScore >= 31 ? 'Opportunité faible'
    : 'Mauvaise opportunité';
  const secSub =
    result.securityScore >= 75 ? 'Secteur sûr'
    : result.securityScore >= 50 ? 'Risque modéré'
    : 'Risque élevé';
  const confSub =
    result.confidenceScore >= 65 ? 'Fiabilité forte'
    : result.confidenceScore >= 45 ? 'Fiabilité moyenne'
    : 'Fiabilité faible';

  // ── Bloc emplacement ──
  const lb = result.locationBreakdown ?? {};
  const locRows = [
    ['Transports', lb.transport],
    ['Commerces', lb.commerces],
    ['Écoles', lb.ecoles],
    ['Marché local', lb.marche_local],
  ].filter(([, v]) => v != null && isFinite(v as number)) as [string, number][];
  const locationBlock =
    result.locationAvailable && locRows.length
      ? `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;page-break-inside:avoid;">
      <div style="font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Emplacement</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;">
        ${locRows.map(([l, v]) => `
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:12px;color:#475569;">${escapeHtml(l)}</span>
            <span style="font-size:12px;font-weight:800;color:${scoreColor(Math.round(v))};">${Math.round(v)}/100</span>
          </div>`).join('')}
      </div>
      ${result.locationScore != null ? `<div style="margin-top:10px;font-size:11px;color:#94a3b8;">Score localisation global : <b style="color:${scoreColor(result.locationScore)};">${result.locationScore}/100</b></div>` : ''}
    </div>`
      : '';

  // ── Bloc locatif ──
  const locatifBlock =
    result.estimatedRent || result.grossYield
      ? `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;page-break-inside:avoid;">
      <div style="font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Potentiel locatif</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
        <div style="text-align:center;background:#f8fafc;border-radius:10px;padding:10px 6px;"><div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Loyer estimé</div><div style="font-size:15px;font-weight:800;color:#4338ca;margin-top:4px;">${fmtEur(result.estimatedRent, '€/mois')}</div></div>
        <div style="text-align:center;background:#f8fafc;border-radius:10px;padding:10px 6px;"><div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Rendement brut</div><div style="font-size:15px;font-weight:800;color:#4338ca;margin-top:4px;">${fmtPct(result.grossYield)}</div></div>
        <div style="text-align:center;background:#f8fafc;border-radius:10px;padding:10px 6px;"><div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Rendement net</div><div style="font-size:15px;font-weight:800;color:#4338ca;margin-top:4px;">${fmtPct(result.netYield)}</div></div>
      </div>
    </div>`
      : '';

  // ── Comparables ──
  const comps = (result.comparables ?? []).slice().sort((a, b) => b.weight - a.weight).slice(0, 15);
  const hasDistance = comps.some((c) => (c.distanceMeters ?? 0) > 0);
  const compsBlock = comps.length
    ? `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;page-break-inside:avoid;">
      <div style="font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Biens similaires vendus (DVF)</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr>
            ${['Date', 'Surface', 'Prix', '€/m²', ...(hasDistance ? ['Distance'] : [])].map((h) => `<th style="text-align:left;padding:6px 8px;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0;">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${comps.map((c, i) => `
            <tr style="background:${c.outOfMarket ? '#fff5f5' : i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
              <td style="padding:6px 8px;color:#64748b;border-bottom:1px solid #f1f5f9;">${escapeHtml(new Date(c.saleDate).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }))}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${c.surface} m²</td>
              <td style="padding:6px 8px;font-weight:700;color:#111827;border-bottom:1px solid #f1f5f9;">${fmtEur(c.price)}</td>
              <td style="padding:6px 8px;font-weight:700;color:${c.outOfMarket ? '#991b1b' : '#6366f1'};border-bottom:1px solid #f1f5f9;">${fmtEur(c.priceM2, '€/m²')}</td>
              ${hasDistance ? `<td style="padding:6px 8px;color:#94a3b8;border-bottom:1px solid #f1f5f9;">${c.distanceMeters ?? 0} m</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`
    : `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;">
      <div style="font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Biens similaires vendus (DVF)</div>
      <div style="font-size:12px;color:#94a3b8;">Aucun comparable DVF suffisamment pertinent — estimation issue de la moyenne du secteur.</div>
    </div>`;

  // ── Recommandation ──
  const strengths = (result.strengths ?? []).map((s) => `<div style="font-size:12px;color:#166534;margin-bottom:3px;">✓ ${escapeHtml(s)}</div>`).join('');
  const warnings = (result.warnings ?? []).filter((w) => !w.toLowerCase().includes('plu')).map((w) => `<div style="font-size:12px;color:#854d0e;margin-bottom:3px;">⚠ ${escapeHtml(w)}</div>`).join('');
  const weaknesses = (result.weaknesses ?? []).map((w) => `<div style="font-size:12px;color:#991b1b;margin-bottom:3px;">✗ ${escapeHtml(w)}</div>`).join('');
  const recoBlock = `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;page-break-inside:avoid;">
      <div style="font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Recommandation Mimmoza</div>
      ${result.recommendation ? `<p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 10px 0;">${escapeHtml(result.recommendation)}</p>` : ''}
      ${strengths}${warnings}${weaknesses}
    </div>`;

  const generatedAt = new Date().toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Analyse rapide Mimmoza${bien ? ' — ' + escapeHtml(bien) : ''}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI',Arial,sans-serif; background:#ffffff; color:#1e293b; padding:40px; line-height:1.6; }
    @media print { body { padding:24px; } @page { margin:14mm; } }
    table { border-collapse:collapse; }
  </style>
</head>
<body>
  <!-- En-tête -->
  <div style="display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:20px;border-bottom:2px solid #e2e8f0;margin-bottom:24px;">
    <div>
      ${logo
        ? `<img src="${logo}" alt="Mimmoza" style="height:44px;display:block;margin-bottom:8px;">`
        : `<div style="font-size:22px;font-weight:800;color:#4f46e5;margin-bottom:8px;">Mimmoza</div>`}
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Analyse rapide</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#94a3b8;">
      <div>Généré le ${generatedAt}</div>
      ${bien ? `<div style="margin-top:4px;color:#475569;font-weight:600;max-width:280px;">${escapeHtml(bien)}</div>` : ''}
      ${form.surface ? `<div style="margin-top:2px;">${escapeHtml(form.surface)} m²${form.propertyType ? ` · ${escapeHtml(form.propertyType)}` : ''}</div>` : ''}
    </div>
  </div>

  <!-- Valeur estimée -->
  <div style="background:linear-gradient(135deg,#eef2ff,#f5f3ff);border:1px solid #e0e7ff;border-radius:14px;padding:18px 22px;margin-bottom:14px;">
    <div style="font-size:10px;font-weight:700;color:#818cf8;text-transform:uppercase;letter-spacing:0.09em;">Valeur estimée — moteur Mimmoza</div>
    <div style="font-size:30px;font-weight:800;color:#4338ca;letter-spacing:-0.02em;margin-top:2px;">${result.estimatedValue > 0 ? fmtEur(result.estimatedValue) : 'Non calculable'}</div>
    ${result.estimatedValue > 0 ? `<div style="font-size:12px;color:#6366f1;margin-top:3px;">${fmtEur(result.minEstimatedValue)} → ${fmtEur(result.maxEstimatedValue)}${result.marketPriceM2 ? ` · Marché : ${fmtEur(result.marketPriceM2, '€/m²')}` : ''}</div>` : ''}
  </div>

  <!-- Scores -->
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
    ${scoreCard('Score opportunité', result.opportunityScore, oppSub)}
    ${scoreCard('Sécurité du projet', result.securityScore, secSub)}
    ${scoreCard('Fiabilité', result.confidenceScore, confSub)}
  </div>

  <!-- Positionnement -->
  <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;page-break-inside:avoid;">
    <div style="font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Positionnement marché</div>
    ${kvRow('Prix demandé', askingPrice != null ? fmtEur(askingPrice) : 'Non renseigné')}
    ${kvRow('Estimé Mimmoza', fmtEur(result.estimatedValue), '#4338ca')}
    ${result.marketPriceM2 ? kvRow('Marché local', fmtEur(result.marketPriceM2, '€/m²'), '#6366f1') : ''}
    ${ecart != null ? kvRow('Écart prix / estimation', `${ecart > 0 ? '+' : ''}${fmtEur(ecart)} (${ecart > 0 ? '+' : ''}${(ecartPct ?? 0).toFixed(1)} %)`, ecart > 0 ? '#991b1b' : '#166534') : ''}
    ${kvRow('Position', positionLabel(result.marketPosition), result.marketPosition === 'overpriced' ? '#991b1b' : '#166534')}
  </div>

  ${locationBlock}
  ${locatifBlock}
  ${compsBlock}
  ${recoBlock}

  <!-- Pied de page -->
  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:10px;">
    <p>Mimmoza · Plateforme d'analyse immobilière intelligente${result.meta?.engineVersion ? ` · Moteur ${escapeHtml(result.meta.engineVersion)}` : ''}${result.meta?.comparablesUsed != null ? ` · ${result.meta.comparablesUsed} comparables` : ''}</p>
    <p style="margin-top:2px;">Estimation indicative fondée sur des données publiques. À faire valider par un professionnel.</p>
  </div>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = () => {
    setTimeout(() => { printWindow.print(); }, 300);
  };
}