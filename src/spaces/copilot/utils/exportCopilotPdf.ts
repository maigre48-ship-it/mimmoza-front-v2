// src/spaces/copilot/utils/exportCopilotPdf.ts
// ─────────────────────────────────────────────────────────────────────────────
// Export PDF de la conversation "MimmozIA".
// Méthode : fenêtre d'impression (window.open + document.write + print()).
// Aucune dépendance externe.
//
// v2 : les réponses de MimmozIA sont en Markdown (## titres, **gras**,
//      listes, tableaux |a|b|). On les convertit en HTML propre avant impression,
//      sinon les marqueurs Markdown s'affichent bruts dans le PDF.
// ─────────────────────────────────────────────────────────────────────────────

import { graphiquesEnTableaux } from '../charts/copilotChart.types.ts';
import { decouperReponse, nettoyerSynthese, structurerRapportFactuel, titreDepuisQuestion } from './rapportAnalyse.ts';

const LOGO_URL = '/Logo/Logo_mimmoza_base_line_redecoupe.png';

export interface ExportableMessage {
  role: 'user' | 'assistant';
  text: string;
  createdAt?: string;
}

// ── Sécurité : échappe le HTML ───────────────────────────────────────────────
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Rendu inline : **gras**, *italique*, `code`, [texte](url) ────────────────
// Appliqué APRÈS échappement HTML. On ne réintroduit que des balises maîtrisées.
function renderInline(escaped: string): string {
  let s = escaped;
  // code inline `…`
  s = s.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;border-radius:4px;padding:1px 5px;font-size:0.9em;font-family:ui-monospace,Menlo,monospace;">$1</code>');
  // gras **…** ou __…__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // italique *…* (évite de manger les ** déjà traités)
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  // liens [texte](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#4f46e5;text-decoration:underline;">$1</a>');
  return s;
}

// ── Détection d'une ligne de tableau Markdown ───────────────────────────────
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.includes('|', 1);
}
function isTableSeparator(line: string): boolean {
  // | --- | :---: | ---: |
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

// ── Rendu Markdown bloc → HTML ───────────────────────────────────────────────
// Gère : titres #/##/###, listes -/*/1., tableaux, règles ---, paragraphes.
export function markdownToSafeHtml(raw: string): string {
  // Les blocs ```mimmoza-chart sont rendus par React dans le fil de
  // conversation, ce que l'export ne peut pas faire : il produit du HTML
  // statique. Sans cette conversion, leur JSON s'imprimerait tel quel au milieu
  // du rapport. On le remplace par le tableau des mêmes chiffres — dans un
  // document, ce sont les valeurs qui comptent, pas le dessin.
  const lines = escapeHtml(graphiquesEnTableaux(raw).replace(/\r\n/g, '\n')).split('\n');
  const out: string[] = [];
  let i = 0;

  const flushListBuffer = (buf: string[], ordered: boolean) => {
    if (buf.length === 0) return;
    const tag = ordered ? 'ol' : 'ul';
    out.push(
      `<${tag} style="margin:6px 0 6px 20px;padding:0;">` +
      buf.map((li) => `<li style="margin:2px 0;">${renderInline(li)}</li>`).join('') +
      `</${tag}>`,
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Ligne vide → saut
    if (trimmed === '') { i++; continue; }

    // Règle horizontale ---
    if (/^-{3,}$/.test(trimmed)) {
      out.push('<hr style="border:none;border-top:1px solid #e2e8f0;margin:14px 0;">');
      i++;
      continue;
    }

    // Titres ### / ## / #
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? 17 : level === 2 ? 15 : 13;
      const mt = level <= 2 ? 14 : 10;
      out.push(`<h${level} style="font-size:${size}px;font-weight:700;color:#0f172a;margin:${mt}px 0 6px 0;">${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Citation / avertissement Markdown.
    if (/^&gt;\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^&gt;\s?/, ''));
        i++;
      }
      out.push(`<blockquote style="margin:10px 0;padding:9px 12px;border-left:3px solid #7c3aed;background:#f5f3ff;color:#475569;">${renderInline(quote.join('<br>'))}</blockquote>`);
      continue;
    }

    // Tableau : au moins une ligne d'en-tête + séparateur
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2; // saute en-tête + séparateur
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead =
        '<tr>' +
        header.map((c) => `<th style="text-align:left;padding:7px 10px;background:#f1f5f9;font-size:11px;font-weight:700;color:#334155;border:1px solid #e2e8f0;">${renderInline(c)}</th>`).join('') +
        '</tr>';
      const tbody = rows
        .map(
          (r, ri) =>
            '<tr>' +
            r.map((c) => `<td style="padding:7px 10px;font-size:12px;color:#1e293b;border:1px solid #e2e8f0;background:${ri % 2 === 0 ? '#ffffff' : '#f8fafc'};">${renderInline(c)}</td>`).join('') +
            '</tr>',
        )
        .join('');
      out.push(`<div class="copilot-markdown-table-wrap" style="width:100%;overflow-x:auto;"><table style="border-collapse:collapse;width:100%;margin:8px 0;page-break-inside:avoid;">${thead}${tbody}</table></div>`);
      continue;
    }

    // Liste non ordonnée
    if (/^[-*]\s+/.test(trimmed)) {
      const buf: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      flushListBuffer(buf, false);
      continue;
    }

    // Liste ordonnée
    if (/^\d+\.\s+/.test(trimmed)) {
      const buf: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      flushListBuffer(buf, true);
      continue;
    }

    // Paragraphe : regroupe les lignes consécutives non-spéciales
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^-{3,}$/.test(lines[i].trim()) &&
      !/^#{1,6}\s+/.test(lines[i].trim()) &&
      !/^&gt;\s?/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) {
      out.push(`<p style="margin:0 0 8px 0;">${renderInline(para.join('<br>'))}</p>`);
    }
  }

  return out.join('');
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
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

export async function exportCopilotConversationToPdf(params: {
  messages: ExportableMessage[];
  contextLabel?: string | null;
}): Promise<void> {
  const { messages, contextLabel } = params;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Autorisez les popups pour générer le PDF.');
    return;
  }

  printWindow.document.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Mimmoza</title></head>' +
    '<body style="font-family:Arial,sans-serif;color:#64748b;padding:40px;">Préparation du rapport…</body></html>',
  );
  printWindow.document.close();

  const logo = await loadLogoBase64();

  const exchanges = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim())
    .map((m) => {
      const isUser = m.role === 'user';
      const who = isUser ? 'Vous' : 'Mimmo';
      const date = formatDate(m.createdAt);
      const nameColor = isUser ? '#6d28d9' : '#0f172a';

      // Question utilisateur : bulle simple (texte brut échappé, sans Markdown).
      // Réponse MimmozIA : rendu Markdown complet.
      const bodyHtml = isUser
        ? `<p style="margin:0;">${escapeHtml(m.text.trim()).replace(/\n/g, '<br>')}</p>`
        : markdownToSafeHtml(m.text);

      const bubbleStyle = isUser
        ? 'max-width:80%;background:#f5f3ff;border:1px solid #ddd6fe;'
        : 'width:100%;background:#ffffff;border:1px solid #e2e8f0;';

      return `
        <div style="display:flex;flex-direction:column;align-items:${isUser ? 'flex-end' : 'flex-start'};margin-bottom:18px;page-break-inside:avoid;">
          <div style="font-size:10px;font-weight:700;color:${nameColor};margin-bottom:5px;text-transform:uppercase;letter-spacing:0.05em;">
            ${who}${date ? ` <span style="color:#94a3b8;font-weight:400;text-transform:none;letter-spacing:0;">· ${date}</span>` : ''}
          </div>
          <div style="${bubbleStyle}border-radius:14px;padding:14px 18px;font-size:13px;line-height:1.65;color:#1e293b;box-shadow:0 1px 2px rgba(0,0,0,0.03);">
            ${bodyHtml}
          </div>
        </div>`;
    })
    .join('');

  const generatedAt = new Date().toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Mimmoza — Conversation</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI',Arial,sans-serif; background:#ffffff; color:#1e293b; padding:40px; line-height:1.6; }
    @media print { body { padding:24px; } @page { margin:14mm; } }
    strong { font-weight:700; color:#0f172a; }
    em { font-style:italic; }
    a { color:#4f46e5; }
    table { border-collapse:collapse; }
  </style>
</head>
<body>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:20px;border-bottom:2px solid #e2e8f0;margin-bottom:28px;">
    <div>
      ${logo
        ? `<img src="${logo}" alt="Mimmoza" style="height:44px;display:block;margin-bottom:8px;">`
        : `<div style="font-size:22px;font-weight:800;color:#4f46e5;margin-bottom:8px;">Mimmoza</div>`}
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Rapport Mimmoza</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#94a3b8;">
      <div>Généré le ${generatedAt}</div>
      ${contextLabel ? `<div style="margin-top:4px;color:#475569;font-weight:600;max-width:260px;">${escapeHtml(contextLabel)}</div>` : ''}
    </div>
  </div>

  ${exchanges || '<div style="color:#94a3b8;font-size:13px;">Aucun message dans cette conversation.</div>'}

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:10px;">
    <p>Mimmoza · Plateforme d'analyse immobilière intelligente</p>
    <p style="margin-top:2px;">Ce rapport reproduit une conversation avec l'assistant IA. À faire valider par un professionnel.</p>
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

export type ResponsePdfResult = 'opened' | 'popup_blocked';

interface ResponsePdfParams {
  response: ExportableMessage;
  question?: string | null;
  contextLabel?: string | null;
}

/** Feuille de style du rapport imprimé (A4, marges répétées à chaque page). */
const RAPPORT_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:'Segoe UI',Inter,Arial,sans-serif;color:#1e293b;line-height:1.5;font-size:10.5pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:0}
table.page{width:100%;border-collapse:collapse}
table.page>thead>tr>td,table.page>tfoot>tr>td,table.page>tbody>tr>td{padding:0 16mm}
.page-top{height:12mm}
.page-bottom{height:14mm;width:178mm;max-width:100%;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid #e2e8f0;font-size:7.5pt;color:#94a3b8}
.page-bottom span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
main{max-width:178mm;margin:0 auto}
h1,h2,h3,h4{break-after:avoid;page-break-after:avoid;color:#0f172a}
table.data,blockquote,li,dl.kv>div,.tile{break-inside:avoid;page-break-inside:avoid}
a{color:#1e293b;text-decoration:none}
strong{color:#0f172a}
.entete{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;padding-bottom:10px;border-bottom:3px solid #5b4bd6}
.entete .meta{text-align:right;font-size:8.5pt;color:#64748b}
.entete .meta .type{font-size:8pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#5b4bd6;margin-bottom:3px}
.titre{margin:20px 0 4px;font-size:21pt;line-height:1.2;font-weight:700;letter-spacing:-.01em}
.sous-titre{font-size:10pt;color:#64748b;margin:0 0 14px}
.demande{margin:0 0 16px;padding:9px 13px;border-left:3px solid #a99ff0;background:#f7f6fe;font-size:9.5pt;color:#334155}
.demande b{display:block;font-size:7.5pt;letter-spacing:.1em;text-transform:uppercase;color:#5b4bd6;margin-bottom:2px}
.cles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 20px}
.tile{border:1px solid #e5e7f0;border-radius:8px;padding:8px 10px;background:#fbfbfe}
.tile .k{font-size:7.5pt;letter-spacing:.06em;text-transform:uppercase;color:#64748b}
.tile .v{font-size:10.5pt;font-weight:700;color:#0f172a;margin-top:2px}
.tile.ok{border-color:#bfe5cf;background:#f3fbf6}.tile.ok .v{color:#17663d}
.tile.mid{border-color:#f6dcae;background:#fffaf0}.tile.mid .v{color:#8a5300}
.tile.low{border-color:#f5c2c2;background:#fff6f6}.tile.low .v{color:#9b1c1c}
.rubrique{font-size:8pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#5b4bd6;margin:18px 0 4px;padding-bottom:4px;border-bottom:1px solid #e5e7f0}
.synthese h1,.synthese h2{font-size:13pt!important;margin:16px 0 6px!important;color:#0f172a!important}
.synthese h3{font-size:11pt!important}
.synthese p,.synthese li{font-size:10.5pt}
.synthese hr{display:none}
.annexe{break-before:page;page-break-before:always}
.annexe h2{font-size:15pt;margin:0 0 4px}
.annexe .intro{font-size:9pt;color:#64748b;margin:0 0 10px}
.annexe h3{font-size:11pt;margin:18px 0 6px;padding-left:8px;border-left:3px solid #5b4bd6}
table.data{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.8pt;margin:4px 0}
table.data th{background:#f3f2fc;color:#3b2f7a;text-align:left;font-weight:700;padding:5px 7px;font-size:7.5pt;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid #d9d6f2}
table.data td{padding:6px 7px;border-bottom:1px solid #eceef3;vertical-align:top;overflow-wrap:anywhere}
table.data td.lbl{font-weight:600;color:#0f172a}
table.data td.src{color:#5b4bd6;font-weight:600;text-align:center}
table.data tr.na td{color:#94a3b8}
table.data tr.na td.lbl{color:#64748b}
.badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:7.5pt;font-weight:700;white-space:nowrap}
.badge-ok{background:#e7f6ee;color:#17663d}.badge-mid{background:#fff4e0;color:#8a5300}
.badge-low{background:#fdecec;color:#9b1c1c}.badge-na{background:#f1f5f9;color:#64748b}
.sub{font-size:7.5pt;color:#64748b;margin-top:2px}
sup.note{color:#5b4bd6;font-weight:700;margin-left:2px;font-size:7pt}
ol.notes{margin:4px 0 10px 16px;padding:0;font-size:8pt;color:#475569}
ol.notes li{margin:1px 0}
ol.sources{margin:4px 0 0 18px;padding:0;font-size:8.5pt;color:#334155}
dl.kv{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 18px;margin:6px 0 10px}
dl.kv dt{font-size:7.5pt;letter-spacing:.05em;text-transform:uppercase;color:#64748b}
dl.kv dd{margin:1px 0 0;font-weight:600;color:#0f172a;font-size:9.5pt}
.para{font-size:9.5pt;margin:4px 0 6px}
.report-end{position:static;break-inside:avoid;page-break-inside:avoid;margin-top:14mm;border-top:1px solid #e2e8f0;padding-top:4mm;font-size:8pt;color:#94a3b8;text-align:center}
@media screen{body{background:#eef0f4}table.page{max-width:210mm;margin:0 auto;background:#fff;box-shadow:0 2px 18px rgba(15,23,42,.08)}}
@media print{.copilot-markdown-table-wrap{overflow:visible!important}}
`;

/** Construction pure et testable du document imprimable d'une réponse. */
export function buildCopilotResponsePrintHtml(
  params: ResponsePdfParams,
  options: { logo?: string | null; generatedAt?: string } = {},
): string {
  const logo = options.logo ?? null;
  const generatedAt = options.generatedAt ?? new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const question = params.question?.trim();
  const decoupage = decouperReponse(params.response.text);
  const etude = decoupage ? structurerRapportFactuel(decoupage.factuel, markdownToSafeHtml) : null;
  const adresse = titreDepuisQuestion(question);
  const typeDoc = etude ? 'Rapport d’analyse foncière' : 'Note d’analyse';

  const commune = etude?.chiffresCles.find((c) => c.k === 'Commune')?.v;
  const parcelle = etude?.chiffresCles.find((c) => c.k === 'Parcelle')?.v;
  const sousTitre = [commune, parcelle ? `parcelle ${parcelle}` : null, `établi le ${generatedAt}`].filter(Boolean).join(' · ');

  const clesHtml = etude?.chiffresCles.length
    ? `<div class="cles">${etude.chiffresCles.map((c) =>
      `<div class="tile${c.ton ? ` ${c.ton}` : ''}"><div class="k">${escapeHtml(c.k)}</div><div class="v">${escapeHtml(c.v)}</div></div>`).join('')}</div>`
    : '';

  const corps = decoupage && etude
    ? `${clesHtml}
       <div class="rubrique">Synthèse</div>
       <section class="synthese">${markdownToSafeHtml(nettoyerSynthese(decoupage.synthese) || 'Synthèse non fournie.')}</section>
       <section class="annexe">
         <h2>Annexe — Données détaillées et sources</h2>
         <p class="intro">Données collectées automatiquement auprès des sources publiques citées. L’échelle indique à quoi la donnée s’applique (parcelle, abords, commune) ; la fiabilité reflète la qualité de la source et la précision de la correspondance avec le bien.</p>
         ${etude.annexeHtml}
       </section>`
    : `<section class="synthese">${markdownToSafeHtml(params.response.text)}</section>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport Mimmoza — Analyse immobilière</title><style>${RAPPORT_CSS}</style></head><body>
<table class="page">
  <thead><tr><td><div class="page-top"></div></td></tr></thead>
  <tfoot><tr><td><div class="page-bottom"><span>Mimmoza · ${escapeHtml(typeDoc)}${adresse ? ` · ${escapeHtml(adresse)}` : ''}</span><span>À faire valider par un professionnel</span></div></td></tr></tfoot>
  <tbody><tr><td><main>
    <header class="entete">
      <div>${logo ? `<img src="${logo}" alt="Mimmoza" style="height:40px;display:block;">` : '<div style="font-size:22px;font-weight:800;color:#5b4bd6;">Mimmoza</div>'}</div>
      <div class="meta"><div class="type">${escapeHtml(typeDoc)}</div>${escapeHtml(generatedAt)}${params.contextLabel ? `<br><strong>${escapeHtml(params.contextLabel)}</strong>` : ''}</div>
    </header>
    <h1 class="titre">${escapeHtml(adresse ?? 'Analyse Mimmoza')}</h1>
    <p class="sous-titre">${escapeHtml(sousTitre)}</p>
    ${question ? `<div class="demande"><b>Demande</b>${escapeHtml(question).replace(/\n/g, '<br>')}</div>` : ''}
    ${corps}
    <footer class="report-end">Mimmoza · Plateforme d’analyse immobilière<br>Rapport établi automatiquement à partir de sources publiques. Il ne remplace ni un certificat d’urbanisme, ni l’avis d’un professionnel.</footer>
  </main></td></tr></tbody>
</table>
</body></html>`;
}

/** Exporte une seule réponse assistant, indépendamment de la conversation. */
export async function exportCopilotResponseToPdf(params: ResponsePdfParams): Promise<ResponsePdfResult> {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return 'popup_blocked';

  printWindow.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport Mimmoza — Analyse immobilière</title></head><body style="font-family:Arial,sans-serif;color:#64748b;padding:40px;">Préparation du rapport…</body></html>');
  printWindow.document.close();

  const logo = await loadLogoBase64();
  const html = buildCopilotResponsePrintHtml(params, { logo });

  printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
  printWindow.onload = () => setTimeout(() => printWindow.print(), 300);
  return 'opened';
}
