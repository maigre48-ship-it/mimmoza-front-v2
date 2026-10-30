// src/spaces/copilot/agent/rapport/rapportTexte.ts
// Petites mises en forme partagées par l'écran et les exports.
import type { TerrainModele } from './rapportModele.ts';

export const LIBELLE_QUALITE_CONTACT: Record<string, string> = {
  mairie: 'Mairie', proprietaire: 'Propriétaire', notaire: 'Notaire', agence: 'Agence', autre: 'Contact',
};

/** « ADYAL PROPERTY MANAGEMENT (SAS, SIREN 123456789) » ou « Non identifié ». */
export function proprietaireTexte(t: Pick<TerrainModele, 'proprietaire'>): string {
  const p = t.proprietaire;
  if (!p) return 'Non identifié';
  const details = [p.forme, p.siren ? `SIREN ${p.siren}` : null].filter(Boolean).join(', ');
  return details && !p.nom.includes(details) ? `${p.nom} (${details})` : p.nom;
}

/** Texte compatible avec la police standard des PDF (jeu WinAnsi) : remplace ce qu'elle ne sait pas dessiner. */
const REMPLACEMENTS: Record<string, string> = {
  ' ': ' ', ' ': ' ', ' ': ' ', '≈': '~', '−': '-', '→': '->', '←': '<-', '↓': 'v', '≥': '>=', '≤': '<=',
  '✓': 'v', '‑': '-', '‒': '-',
};
const WIN_ANSI_EN_PLUS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));
export function textePdf(s: string): string {
  let r = '';
  for (const ch of s) {
    const rem = REMPLACEMENTS[ch];
    if (rem !== undefined) { r += rem; continue; }
    const code = ch.codePointAt(0)!;
    if (code < 256 || WIN_ANSI_EN_PLUS.has(ch)) r += ch;
    else if (code >= 0x1f000) continue; // pictogrammes
    else r += ch.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\xff]/g, '');
  }
  return r;
}
