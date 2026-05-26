// src/spaces/copilot/components/CopilotEmptyState.tsx
import { Sparkles } from 'lucide-react';
import type { Vertical, CopilotMode } from '../types/copilot.types';
import { COPILOT_THEME as T } from './copilotTheme';

const SUGGESTIONS_QUICK: Record<Vertical, string[]> = {
  promoteur:    ['Quelle est la zone PLU ?', 'Quels sont les reculs obligatoires ?', 'Quelle hauteur max autorisée ?', 'Combien de places de parking par logement ?', 'Y a-t-il une OAP applicable ?'],
  investisseur: ['Ce bien est-il bien pricé ?', 'Est-ce une opportunité de décote ?', 'Le marché est-il liquide ici ?', 'Quel est l\'écart au prix marché ?'],
  marchand:     ['Ce bien est-il décoté ?', 'Quel est l\'écart au prix marché ?', 'Le marché est-il liquide ?', 'Est-ce une bonne opportunité ?'],
  apporteur:    ['Résume la parcelle', 'Quelle est la zone PLU ?', 'Quels acteurs contacter ?', 'Évalue le potentiel'],
  particulier:  ['Quelle est la zone PLU ?', 'Le quartier est-il bien ?', 'Résume ce bien', 'Quels sont les reculs ?'],
  generique:    ['Quelle est la zone PLU ?', 'Résume la parcelle', 'Quels sont les reculs ?', 'Quelle hauteur max ?'],
};

const SUGGESTIONS_ADVANCED: Record<Vertical, string[]> = {
  promoteur:    ['Analyse le potentiel de cette parcelle', 'Quelle est la constructibilité ?', 'Compare au marché local', 'Synthétise l\'étude de marché', 'Quels sont les risques ?'],
  investisseur: ['Calcule le SmartScore de ce bien', 'Analyse la décote par rapport au marché', 'Quels sont les risques Géorisques ?', 'Compare au marché local', 'Estime le prix de revente'],
  marchand:     ['Quelle marge possible ?', 'Analyse la décote par rapport au marché', 'Quels sont les risques ?', 'Compare au marché local', 'Estime le prix de revente'],
  apporteur:    ['Qualifie cette opportunité', 'Quels acteurs contacter ?', 'Évalue le potentiel', 'Résume la parcelle'],
  particulier:  ['Analyse ce bien', 'Le quartier est-il bien ?', 'Quels sont les risques ?', 'Compare au marché'],
  generique:    ['Analyse cette parcelle', 'Calcule le SmartScore', 'Quels sont les risques ?', 'Compare au marché local'],
};

const SUBTITLE_QUICK: Record<Vertical, string> = {
  promoteur:    'Mode rapide : questions simples sur le PLU et la parcelle.',
  investisseur: 'Mode rapide : prix, décote, liquidité et opportunités sur une annonce.',
  marchand:     'Mode rapide : prix, décote et opportunités sur une annonce.',
  apporteur:    'Mode rapide : qualification rapide d\'une opportunité.',
  particulier:  'Mode rapide : questions simples sur votre bien.',
  generique:    'Mode rapide : questions simples sur la parcelle.',
};

const SUBTITLE_ADVANCED: Record<Vertical, string> = {
  promoteur:    'Votre couche d\'intelligence immobilière. Posez une question ou choisissez une suggestion.',
  investisseur: 'Analyse marché, décote, rentabilité, risques et comparables pour vos investissements.',
  marchand:     'Analyse marché, décote, marge et revente pour vos opérations de marchand de biens.',
  apporteur:    'Qualification et mise en relation pour vos apports d\'affaires.',
  particulier:  'Votre assistant immobilier personnel.',
  generique:    'Votre couche d\'intelligence immobilière. Posez une question ou choisissez une suggestion.',
};

export function CopilotEmptyState({
  vertical,
  onPick,
  mode,
}: {
  vertical: Vertical;
  onPick: (s: string) => void;
  mode?: CopilotMode;
}) {
  const isQuick = mode === 'quick';
  const suggestions = isQuick ? SUGGESTIONS_QUICK[vertical] : SUGGESTIONS_ADVANCED[vertical];
  const subtitle = isQuick ? SUBTITLE_QUICK[vertical] : SUBTITLE_ADVANCED[vertical];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, textAlign: 'center' }}>
      <div style={{
        height: 52, width: 52, borderRadius: 16, marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(135deg, ${T.accent}, rgb(79 70 229))`,
        boxShadow: `0 8px 28px ${T.accentGlow}`,
      }}>
        <Sparkles size={24} color="white" />
      </div>
      <div style={{ color: T.text, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Mimmoza Copilot</div>
      <div style={{ color: T.textMuted, fontSize: 13, marginBottom: 22, maxWidth: 280 }}>
        {subtitle}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320 }}>
        {suggestions.map((s) => (
          <button key={s} onClick={() => onPick(s)} style={{
            padding: '10px 14px', borderRadius: 11, textAlign: 'left',
            background: 'rgb(255 255 255 / 0.04)', border: `1px solid ${T.borderSoft}`,
            color: T.text, fontSize: 13, cursor: 'pointer', transition: 'all .15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = T.accentSoft; e.currentTarget.style.borderColor = T.border; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgb(255 255 255 / 0.04)'; e.currentTarget.style.borderColor = T.borderSoft; }}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}