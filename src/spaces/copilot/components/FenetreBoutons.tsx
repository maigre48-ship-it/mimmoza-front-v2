// src/spaces/copilot/components/FenetreBoutons.tsx
//
// Boutons de fenêtre façon Windows 11 (réduire, agrandir / restaurer, fermer)
// pour les barres de titre de la conversation Mimmo et de l'espace 3D.
// Glyphes dessinés en SVG fin (1 px), comme ceux du système, plutôt que des
// icônes génériques : c'est ce qui fait « fenêtre » au premier coup d'œil.

import type { ReactNode } from 'react';

const glyphe = (enfants: ReactNode) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" strokeWidth="1" shapeRendering="crispEdges">{enfants}</svg>
);

export const GlypheReduire = () => glyphe(<path d="M0 5.5h10" />);
export const GlypheAgrandir = () => glyphe(<rect x="0.5" y="0.5" width="9" height="9" />);
export const GlypheRestaurer = () => glyphe(<><rect x="0.5" y="2.5" width="7" height="7" /><path d="M2.5 2.5V0.5h7v7h-2" /></>);
export const GlypheFermer = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" strokeWidth="1.05"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
);

export function BoutonFenetre({ libelle, onClick, fermer = false, children, pressed }: {
  libelle: string;
  onClick: () => void;
  fermer?: boolean;
  children: ReactNode;
  pressed?: boolean;
}) {
  return (
    <button type="button" className={`mzia-fen__btn${fermer ? ' mzia-fen__btn--fermer' : ''}`}
      onClick={onClick} title={libelle} aria-label={libelle}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}>
      {children}
    </button>
  );
}
