/**
 * VIS-67 — CARTE « GRILLE DE VENTE » du chat Mimmoza (sous la réponse de Mimmo, à côté de la carte de suivi de la
 * commande Studio). Lisible dans `.jarvis-dossier` (où `* { color: inherit !important }`) : chaque texte porte sa couleur
 * sur un élément qui la DÉFINIT lui-même (fond clair + encre sombre), pas par héritage d'une classe.
 * Un bouton par action : « Ouvrir la grille dans le Studio » (rappelle `onOuvrir`, branché sur l'envoi de la commande).
 */
import type { JSX } from 'react';
import { textesCarteGrilleVente, type CarteGrilleVente as Carte } from './carteGrilleVente.ts';

const ENCRE = '#0f172a';
const DOUX = '#334155';

export function CarteGrilleVente({ carte, onOuvrir, ouverte }: { carte: Carte; onOuvrir?: () => void; ouverte?: boolean }): JSX.Element {
  const t = textesCarteGrilleVente(carte);
  return (
    <div data-carte="grille-vente" style={{ border: '1px solid #cbd5e1', borderRadius: 10, background: '#ffffff', color: ENCRE, padding: '10px 12px', margin: '8px 0', maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ color: ENCRE, fontSize: 14 }}>{t.titre}</strong>
        <span style={{ color: DOUX, fontSize: 12.5 }}>{t.sousTitre}</span>
      </div>
      {t.pastilles.length > 0 && (
        <div style={{ display: 'flex', gap: 6, margin: '6px 0', flexWrap: 'wrap' }}>
          {t.pastilles.map((p) => <span key={p.statut} style={{ background: p.fond, color: p.encre, borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 600 }}>{p.libelle} {p.nombre}</span>)}
        </div>
      )}
      {t.lignes.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, color: ENCRE }}>
          <tbody>
            {t.lignes.map((l) => (
              <tr key={l.lot} style={{ borderTop: '1px solid #eef2f7' }}>
                <td style={{ padding: '4px 6px 4px 0', color: ENCRE, fontWeight: 700 }}>{l.lot}</td>
                <td style={{ padding: '4px 6px', color: DOUX }}>{l.detail}</td>
                <td style={{ padding: '4px 6px', color: ENCRE, textAlign: 'right', whiteSpace: 'nowrap' }}>{l.prix}</td>
                <td style={{ padding: '4px 0 4px 6px' }}><span style={{ background: l.fond, color: l.encre, borderRadius: 999, padding: '1px 7px', fontSize: 11.5 }}>{l.statut === 'optionne' ? 'Optionné' : l.statut === 'reserve' ? 'Réservé' : l.statut === 'vendu' ? 'Vendu' : 'Libre'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ color: DOUX, fontSize: 12.5, margin: '6px 0' }}>Les lots s’allument dans la grille de vente du Studio ; le compte rendu du Studio s’affiche ci-dessous.</p>
      )}
      {onOuvrir && (
        <button type="button" onClick={onOuvrir} aria-pressed={ouverte === true}
          style={{ marginTop: 8, background: ouverte ? '#dbeafe' : '#ffffff', color: ouverte ? '#1e3a8a' : ENCRE, border: `1px solid ${ouverte ? '#93c5fd' : '#cbd5e1'}`, borderRadius: 6, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer', fontWeight: ouverte ? 600 : 400 }}>
          {ouverte ? 'Grille ouverte dans le Studio' : 'Ouvrir la grille dans le Studio'}
        </button>
      )}
    </div>
  );
}
