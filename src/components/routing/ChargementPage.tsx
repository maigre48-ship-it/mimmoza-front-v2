// src/components/routing/ChargementPage.tsx
// Écran affiché pendant le téléchargement d'une page (React.Suspense).
//
// • Occupe toute la hauteur de l'écran : le pied de page reste sous la ligne
//   de flottaison et ne « saute » pas quand la page arrive (CLS mesuré à
//   0,099 sur /tarifs avec une hauteur de 60vh, 0 avec 100vh).
// • L'indicateur n'apparaît qu'après un court délai (animation CSS) : sur une
//   connexion rapide, l'utilisateur ne voit jamais de « clignotement ».
// • Aucune dépendance (ni icône ni bibliothèque) : il fait partie du code
//   chargé sur toutes les pages, il doit rester minuscule.

const STYLE = `
@keyframes mz-chargement-apparition { from { opacity: 0 } to { opacity: 1 } }
@keyframes mz-chargement-rotation { to { transform: rotate(360deg) } }
.mz-chargement-page { opacity: 0; animation: mz-chargement-apparition 150ms ease-out 250ms forwards; }
.mz-chargement-page__roue { animation: mz-chargement-rotation 0.8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .mz-chargement-page__roue { animation: none; } }
`;

export function ChargementPage({ libelle = "Chargement…" }: { libelle?: string }) {
  return (
    <div
      className="flex min-h-screen w-full items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <style>{STYLE}</style>
      <div className="mz-chargement-page flex items-center gap-3 text-sm text-slate-500">
        <svg
          className="mz-chargement-page__roue h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        {libelle}
      </div>
    </div>
  );
}

export default ChargementPage;
