// src/spaces/copilot/agent/ReglageVeilleProactive.tsx
// Réglage « Veille proactive » du panneau Paramètres du menu MimmozIA :
// marche/arrêt + budget mensuel en jetons (0 à 20 000), enregistré par la
// RPC agent_preferences_proactif. Styles : menu latéral (thème sombre).
import { useEffect, useState } from 'react';
import { Radar } from 'lucide-react';
import { JETON_VALEUR_EUR } from '@/lib/billing/grille';
import { enregistrerPreferencesProactif, lirePreferencesProactif } from './agentApi';
import { BUDGET_PROACTIF_MAX, bornerBudget, formatEuros, formatJetons } from './agentLogique';
import type { PreferencesProactif } from './agent.types';
import './agentSidebar.css';

export function ReglageVeilleProactive() {
  const [prefs, setPrefs] = useState<PreferencesProactif | null>(null);
  const [actif, setActif] = useState(false);
  const [budget, setBudget] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [indisponible, setIndisponible] = useState(false);

  useEffect(() => {
    let vivant = true;
    void (async () => {
      try {
        const p = await lirePreferencesProactif();
        if (!vivant) return;
        setPrefs(p); setActif(p.proactif_actif); setBudget(p.budget_proactif_mensuel);
      } catch {
        // Colonnes pas encore installées ou lecture refusée : on n'affiche pas un réglage inopérant.
        if (vivant) setIndisponible(true);
      }
    })();
    return () => { vivant = false; };
  }, []);

  if (indisponible) {
    return (
      <div className="mzag-veille">
        <div className="mzia-settings__row"><span>Veille proactive<small>Bientôt disponible.</small></span></div>
      </div>
    );
  }
  if (!prefs) return null;

  const modifie = actif !== prefs.proactif_actif || budget !== prefs.budget_proactif_mensuel;

  const enregistrer = async () => {
    setOccupe(true); setMsg(null);
    try {
      const p = await enregistrerPreferencesProactif(actif, budget);
      setPrefs(p); setActif(p.proactif_actif); setBudget(p.budget_proactif_mensuel);
      setMsg('Réglage enregistré.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Enregistrement impossible.');
    } finally { setOccupe(false); }
  };

  return (
    <div className="mzag-veille">
      <div className="mzia-settings__row">
        <span>
          <span style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}><Radar size={13} aria-hidden /> Veille proactive</span>
          <small>Chaque nuit, Mimmo regarde ce que vos veilles ont repéré et vous prépare un résumé.</small>
        </span>
        <button type="button" className={`mzia-toggle ${actif ? 'is-on' : ''}`} onClick={() => setActif((a) => !a)}
          role="switch" aria-checked={actif} aria-label="Veille proactive">
          <span className="mzia-toggle__knob" />
        </button>
      </div>

      <div className="mzag-veille__budget">
        <label htmlFor="mzag-budget-veille" className="mzag-veille__valeur">
          <span>Budget par mois</span>
          <strong>{formatJetons(budget)} · {formatEuros(budget, JETON_VALEUR_EUR)}</strong>
        </label>
        <input id="mzag-budget-veille" type="range" min={0} max={BUDGET_PROACTIF_MAX} step={500} value={budget}
          onChange={(e) => setBudget(bornerBudget(Number(e.target.value)))} disabled={!actif}
          aria-valuetext={`${budget} jetons par mois`} />
      </div>
      <p className="mzag-veille__note">
        La veille consomme des jetons pour analyser ce qu’elle trouve, sans jamais dépasser ce budget.
        Avec un budget à 0, vous recevez seulement un résumé simple, sans analyse.
        {prefs.proactif_actif && ` Utilisés ce mois-ci : ${formatJetons(prefs.proactif_consomme_mois)}.`}
      </p>
      {actif && !prefs.learning_enabled && (
        <p className="mzag-veille__note" style={{ color: '#fbbf24' }}>
          La veille a besoin de l’apprentissage des habitudes (réglage ci-dessus) pour fonctionner.
        </p>
      )}
      {modifie && (
        <button type="button" className="mzag-veille__btn" disabled={occupe} onClick={() => void enregistrer()}>
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      )}
      {msg && <p className="mzia-settings__msg">{msg}</p>}
    </div>
  );
}
