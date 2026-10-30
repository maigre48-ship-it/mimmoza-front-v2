// src/spaces/copilot/agent/conception/SuiteConception.tsx
// Carte « Et maintenant ? Concevoir le projet » sous un rapport de prospection
// (rapport.suite_proposee) : on choisit un terrain retenu et MimmozIA propose,
// dans le chat, une mission de conception avec son devis (pas de lancement
// sans validation du devis).
import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { lireSuiteProposee } from '@/spaces/promoteur/shared/echangeStudio/conception';
import { useCopilot } from '../../hooks/useCopilot';
import { useCopilotStore } from '../../store/copilotStore';
import type { Mission } from '../agent.types';
import { useAgentUi } from '../agentUi.store';
import type { ModeleRapport } from '../rapport/rapportModele';
import { messageLancerConception } from './conceptionLogique';
import { conceptionDisponible } from './conceptionApi';
import './conception.css';

export function SuiteConception({ mission, modele }: { mission: Mission; modele: ModeleRapport }) {
  const suite = lireSuiteProposee((mission.rapport_brut as { suite_proposee?: unknown } | null)?.suite_proposee);
  const { sendMessage } = useCopilot();
  const [choix, setChoix] = useState<string | null>(suite?.terrains[0]?.idu ?? null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Ordre de déploiement : tant que la conception n'est pas installée en base, la carte n'apparaît pas.
  const [disponible, setDisponible] = useState(false);
  useEffect(() => {
    let vivant = true;
    void conceptionDisponible().then((ok) => { if (vivant) setDisponible(ok); });
    return () => { vivant = false; };
  }, []);
  if (!suite || !disponible) return null;

  const lancer = async () => {
    const t = suite.terrains.find((x) => x.idu === choix);
    if (!t || envoi) return;
    setEnvoi(true); setErreur(null);
    try {
      const fiche = modele.terrains.find((x) => x.idu === t.idu);
      const st = useCopilotStore.getState();
      // La proposition se fait dans la conversation de la prospection quand elle existe.
      if (mission.conversation_id && st.currentConversationId !== mission.conversation_id) await st.selectConversation(mission.conversation_id);
      useAgentUi.getState().fermer();
      await sendMessage(messageLancerConception({ idu: t.idu, adresse: fiche?.adresse, commune: fiche?.commune, raison: t.raison }, mission.id), { vertical: 'promoteur' });
    } catch {
      setErreur('Le message n’a pas pu être envoyé à MimmozIA. Réessayez.');
    } finally { setEnvoi(false); }
  };

  return (
    <section className="mzcp-suite" aria-label="Et maintenant ?">
      <span className="mzag-sur"><Building2 size={14} aria-hidden /> Et maintenant ? Concevoir le projet</span>
      <p className="mzag-rapport__para" style={{ marginTop: 6 }}>{suite.texte}</p>
      <div className="mzcp-suite__terrains" role="radiogroup" aria-label="Terrain à concevoir">
        {suite.terrains.map((t) => (
          <label key={t.idu} className={`mzcp-suite__terrain${choix === t.idu ? ' is-choisi' : ''}`}>
            <input type="radio" name={`suite-${mission.id}`} checked={choix === t.idu} onChange={() => setChoix(t.idu)} />
            <span><strong>#{t.rang} · {t.idu.slice(-6)}</strong>{t.raison && <span className="mzag-petit"> — {t.raison}</span>}</span>
          </label>
        ))}
      </div>
      {erreur && <p className="mzag-alerte" role="alert">{erreur}</p>}
      <div className="mzag-actions" style={{ marginTop: 8 }}>
        <button type="button" className="mzag-btn mzag-btn--plein mzag-btn--petit" disabled={!choix || envoi} onClick={() => void lancer()}>
          {envoi ? 'Envoi…' : 'Concevoir ce terrain'}
        </button>
        <span className="mzag-petit">MimmozIA vous proposera d’abord un devis.</span>
      </div>
    </section>
  );
}
