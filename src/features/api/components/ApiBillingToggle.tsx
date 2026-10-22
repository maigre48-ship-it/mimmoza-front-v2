// src/features/api/components/ApiBillingToggle.tsx
// Sélecteur mensuel / annuel des formules API (plus de « pay as you go »).

interface ApiBillingToggleProps {
  periodicite: 'mensuel' | 'annuel';
  onChange: (periodicite: 'mensuel' | 'annuel') => void;
  /** Économie maximale de l'annuel, en %. */
  remiseAnnuelle?: number;
}

export default function ApiBillingToggle({ periodicite, onChange, remiseAnnuelle }: ApiBillingToggleProps) {
  const bouton = (actif: boolean) =>
    `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
      actif ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
    }`;

  return (
    <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
      <button type="button" onClick={() => onChange('mensuel')} className={bouton(periodicite === 'mensuel')}>
        Mensuel
      </button>
      <button type="button" onClick={() => onChange('annuel')} className={bouton(periodicite === 'annuel')}>
        Annuel
        {remiseAnnuelle !== undefined && remiseAnnuelle > 0 && (
          <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
            jusqu'à −{remiseAnnuelle} %
          </span>
        )}
      </button>
    </div>
  );
}
