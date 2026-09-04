// src/spaces/copilot/components/MimmozIAModelPicker.tsx
// Selecteur de niveau d'analyse — libelles commerciaux (Standard / Approfondi /
// Expert), le fournisseur du modele n'est jamais expose a l'utilisateur.
//
// ⚠️ SECURITE : ce composant est un CONFORT. copilot-chat lit le plan en base
// (users_profiles.plan) et applique resolveTier : un tier hors plan est
// silencieusement ramene au tier par defaut du plan. Ne jamais considerer
// l'etat de ce menu comme une autorisation.
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Lock, Zap } from 'lucide-react';
import type { ModelTier } from '../types/copilot.types';

export type Plan = 'basic' | 'advanced' | 'pro';
export type { ModelTier };

interface TierDef {
  tier: ModelTier;
  label: string;
  pitch: string;
  /** Ordre de grandeur du debit, jamais une promesse chiffree. */
  cout: string;
  /** Libelle de l'offre a mettre en avant quand le niveau est verrouille. */
  offre: string;
}

const TIERS: TierDef[] = [
  {
    tier: 'haiku',
    label: 'Standard',
    pitch: 'Rapide — questions directes, vérifications, recherches simples.',
    cout: 'consommation minimale',
    offre: 'Basique',
  },
  {
    tier: 'sonnet',
    label: 'Approfondi',
    pitch: 'Analyses structurées, rapports et raisonnement multi-sources.',
    cout: '≈ 3× le niveau Standard',
    offre: 'Avancé',
  },
  {
    tier: 'opus',
    label: 'Expert',
    pitch: 'Le plus fin sur les arbitrages complexes et les cas ambigus.',
    cout: '≈ 4× le niveau Standard',
    offre: 'Pro',
  },
];

/**
 * Recopie EXACTE de PLAN_POLICY (supabase/functions/copilot-chat/index.ts).
 * ⚠️ Ce n'est pas une hierarchie : un compte Pro n'a PAS acces a Standard,
 * ses niveaux sont ['sonnet','opus']. Toute divergence ici ferait proposer un
 * choix que le serveur refuserait sans le dire.
 */
const PLAN_TIERS: Record<Plan, ModelTier[]> = {
  basic: ['haiku'],
  advanced: ['sonnet'],
  pro: ['sonnet', 'opus'],
};

interface Props {
  plan: Plan;
  value: ModelTier;
  onChange: (t: ModelTier) => void;
  /** Verrouille pendant un streaming : changer de modele en cours n'a pas de sens. */
  disabled?: boolean;
}

export function MimmozIAModelPicker({ plan, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);

  const autorises = useMemo(
    () => TIERS.filter((t) => PLAN_TIERS[plan].includes(t.tier)),
    [plan],
  );

  // Le tier du store peut ne pas etre autorise (changement de plan, valeur par
  // defaut 'sonnet' sur un compte basic) : on affiche alors le niveau reellement
  // applique par le serveur, pas celui stocke.
  const effectif = autorises.some((t) => t.tier === value) ? value : autorises[0]?.tier;
  const courant = TIERS.find((t) => t.tier === effectif) ?? TIERS[0];

  // Un menu deroulant a une seule option frustre plus qu'il n'informe :
  // en Basique et en Avance, on affiche le niveau en lecture seule.
  if (autorises.length <= 1) {
    return (
      <div
        className="mzia-model mzia-model--locked"
        title="Passez à l'offre Pro pour choisir le niveau d'analyse"
      >
        <Zap size={13} />
        <span>{courant.label}</span>
        <Lock size={12} className="mzia-model__lock" />
      </div>
    );
  }

  return (
    <div className="mzia-model">
      <button
        type="button"
        className="mzia-model__trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Niveau d'analyse"
      >
        <Zap size={13} />
        <span>{courant.label}</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <>
          <div className="mzia-model__scrim" onClick={() => setOpen(false)} />
          <div className="mzia-model__menu">
            <ul role="listbox" aria-label="Niveau d'analyse">
              {TIERS.map((t) => {
                const verrouille = !PLAN_TIERS[plan].includes(t.tier);
                const actif = t.tier === effectif;
                return (
                  <li key={t.tier}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={actif}
                      className={[
                        'mzia-model__opt',
                        verrouille ? 'is-locked' : '',
                        actif ? 'is-active' : '',
                      ].filter(Boolean).join(' ')}
                      disabled={verrouille}
                      onClick={() => { onChange(t.tier); setOpen(false); }}
                    >
                      <span className="mzia-model__optHead">
                        {t.label}
                        {actif && <Check size={13} />}
                        {verrouille && <Lock size={12} />}
                      </span>
                      <span className="mzia-model__optPitch">{t.pitch}</span>
                      <span className="mzia-model__optCost">
                        {verrouille ? `Inclus dans l'offre ${t.offre}` : t.cout}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mzia-model__note">
              Ordres de grandeur : la consommation réelle dépend de la longueur
              de l'échange.
            </p>
          </div>
        </>
      )}
    </div>
  );
}