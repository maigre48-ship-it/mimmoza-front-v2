// src/spaces/copilot/utils/exportCopilotPdf.ts
// ─────────────────────────────────────────────────────────────────────────────
// Export PDF de la conversation "Analyste Mimmoza".
// Méthode : fenêtre d'impression (window.open + document.write + print()).
// Aucune dépendance externe.
//
// v2 : les réponses de l'Analyste sont en Markdown (## titres, **gras**,
//      listes, tableaux |a|b|). On les convertit en HTML propre avant impression,
//      sinon les marqueurs Markdown s'affichent bruts dans le PDF.
// ─────────────────────────────────────────────────────────────────────────────

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
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#4f46e5;text-decoration:underline;">$1</a>');
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
function markdownToHtml(raw: string): string {
  const lines = escapeHtml(raw.replace(/\r\n/g, '\n')).split('\n');
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
      out.push(
        `<div style="font-size:${size}px;font-weight:700;color:#0f172a;margin:${mt}px 0 6px 0;">${renderInline(h[2])}</div>`,
      );
      i++;
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
      out.push(
        `<table style="border-collapse:collapse;width:100%;margin:8px 0;page-break-inside:avoid;">${thead}${tbody}</table>`,
      );
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
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Analyste Mimmoza</title></head>' +
    '<body style="font-family:Arial,sans-serif;color:#64748b;padding:40px;">Préparation du rapport…</body></html>',
  );
  printWindow.document.close();

  const logo = await loadLogoBase64();

  const exchanges = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim())
    .map((m) => {
      const isUser = m.role === 'user';
      const who = isUser ? 'Vous' : 'Analyste Mimmoza';
      const date = formatDate(m.createdAt);
      const nameColor = isUser ? '#6d28d9' : '#0f172a';

      // Question utilisateur : bulle simple (texte brut échappé, sans Markdown).
      // Réponse Analyste : rendu Markdown complet.
      const bodyHtml = isUser
        ? `<p style="margin:0;">${escapeHtml(m.text.trim()).replace(/\n/g, '<br>')}</p>`
        : markdownToHtml(m.text);

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
  <title>Analyste Mimmoza — Conversation</title>
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
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Rapport de l'Analyste Mimmoza</div>
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