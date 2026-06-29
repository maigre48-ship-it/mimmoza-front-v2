// src/spaces/copilot/components/CopilotEmptyState.tsx
// V1.4 — questions spécifiques pour /analyse-rapide + mode Avancé masqué sur cette page

import { MapPin, Sparkles } from 'lucide-react';
import { useActiveCopilotContext } from '../store/activeCopilotContext.store';
import type { CopilotMode, Vertical } from '../types/copilot.types';
import {
  getCopilotContextLabel,
  getCopilotQuickQuestions,
} from '../utils/quickQuestions';
import { COPILOT_THEME as T } from './copilotTheme';

const SUGGESTIONS_QUICK: Record<Vertical, string[]> = {
  promoteur:    ['Quelle est la zone PLU ?', 'Quels sont les reculs obligatoires ?', 'Quelle hauteur max autorisée ?', 'Combien de places de parking par logement ?', "Y a-t-il une OAP applicable ?"],
  investisseur: ["Ce bien est-il une bonne affaire ?", "Quel loyer puis-je espérer ?", "Quels sont les risques du secteur ?", "Faut-il négocier le prix ?"],
  marchand:     ["Ce bien est-il décoté ?", "Quel est l'écart au prix marché ?", "Le marché est-il liquide ?", "Est-ce une bonne opportunité ?"],
  apporteur:    ['Résume la parcelle', 'Quelle est la zone PLU ?', 'Quels acteurs contacter ?', 'Évalue le potentiel'],
  particulier:  ['Quelle est la zone PLU ?', 'Le quartier est-il bien ?', 'Résume ce bien', 'Quels sont les reculs ?'],
  generique:    ['Quelle est la zone PLU ?', 'Résume la parcelle', 'Quels sont les reculs ?', 'Quelle hauteur max ?'],
};

const SUGGESTIONS_ADVANCED: Record<Vertical, string[]> = {
  promoteur:    ["Analyse le potentiel de cette parcelle", "Quelle est la constructibilité ?", 'Compare au marché local', "Synthétise l'étude de marché", 'Quels sont les risques ?'],
  investisseur: ['Calcule le SmartScore de ce bien', 'Analyse la décote par rapport au marché', 'Quels sont les risques Géorisques ?', 'Compare au marché local', 'Estime le prix de revente'],
  marchand:     ["Quelle marge possible ?", 'Analyse la décote par rapport au marché', 'Quels sont les risques ?', 'Compare au marché local', 'Estime le prix de revente'],
  apporteur:    ["Qualifie cette opportunité", 'Quels acteurs contacter ?', 'Évalue le potentiel', 'Résume la parcelle'],
  particulier:  ['Analyse ce bien', 'Le quartier est-il bien ?', 'Quels sont les risques ?', 'Compare au marché'],
  generique:    ['Analyse cette parcelle', 'Calcule le SmartScore', 'Quels sont les risques ?', 'Compare au marché local'],
};

const SUBTITLE_QUICK: Record<Vertical, string> = {
  promoteur:    'Mode rapide : questions simples sur le PLU et la parcelle.',
  investisseur: 'Mode rapide : questions simples sur la parcelle.',
  marchand:     "Mode rapide : prix, décote et opportunités.",
  apporteur:    "Mode rapide : qualification rapide d'une opportunité.",
  particulier:  'Mode rapide : questions simples sur votre bien.',
  generique:    'Mode rapide : questions simples sur la parcelle.',
};

const SUBTITLE_ADVANCED: Record<Vertical, string> = {
  promoteur:    "Votre couche d'intelligence immobilière.",
  investisseur: 'Analyse marché, décote, rentabilité, risques et comparables.',
  marchand:     'Analyse marché, décote, marge et revente pour vos opérations.',
  apporteur:    "Qualification et mise en relation pour vos apports.",
  particulier:  'Votre assistant immobilier personnel.',
  generique:    "Votre couche d'intelligence immobilière.",
};

// Questions spécifiques à la page Analyse rapide
const ANALYSE_RAPIDE_QUESTIONS: Array<{ label: string; prompt: string }> = [
  {
    label: "Ce bien est-il une bonne affaire ?",
    prompt: "En regardant l'estimation Mimmoza, le prix demandé et les comparables DVF, est-ce que ce bien est une bonne affaire ? Donne un verdict en 3 lignes max.",
  },
  {
    label: "Quel loyer puis-je espérer ?",
    prompt: "Quel loyer mensuel peut-on espérer pour ce bien selon le marché local ? Donne une fourchette réaliste et le rendement brut associé.",
  },
  {
    label: "Quels sont les risques du secteur ?",
    prompt: "Quels sont les principaux risques naturels ou environnementaux dans ce secteur ? Résume en 2-3 points clés.",
  },
  {
    label: "Faut-il négocier le prix ?",
    prompt: "Selon l'écart entre le prix demandé et l'estimation Mimmoza, faut-il négocier ? De combien et pourquoi ? Réponse directe en 3 lignes.",
  },
];

function buildEffectivePathname(): string {
  if (typeof window === 'undefined') return '/';
  const pathname = window.location.pathname;
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab ? `${pathname}/${tab}` : pathname;
}

function ContextBadge({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 8,
      background: 'rgb(255 255 255 / 0.05)',
      border: `1px solid ${T.borderSoft}`,
      marginBottom: 18, maxWidth: 300,
    }}>
      <MapPin size={11} color={T.accent} style={{ flexShrink: 0 }} />
      <span style={{
        color: T.textMuted, fontSize: 11, lineHeight: 1.3,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    </div>
  );
}

function NoDealMessage() {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 11, marginBottom: 16,
      background: 'rgb(251 191 36 / 0.08)',
      border: '1px solid rgb(251 191 36 / 0.25)',
      color: 'rgb(251 191 36 / 0.9)',
      fontSize: 12, lineHeight: 1.5, maxWidth: 300,
    }}>
      ⚠️ Aucun deal sélectionné. Retourne dans le pipeline pour choisir un deal actif.
    </div>
  );
}

export function CopilotEmptyState({
  vertical,
  onPick,
  mode,
}: {
  vertical: Vertical;
  onPick: (s: string) => void;
  mode?: CopilotMode;
}) {
  const activeDeal = useActiveCopilotContext(s => s.activeDeal);

  const pathname = buildEffectivePathname();
  const isAnalyseRapide = pathname.startsWith('/analyse-rapide');

  const resolvedMode: 'quick' | 'advanced' = mode === 'advanced' || mode === 'report' ? 'advanced' : 'quick';

  const dynamicQuestions = getCopilotQuickQuestions({
    pathname,
    mode: resolvedMode,
    activeDeal,
  });

  const contextLabel    = getCopilotContextLabel({ pathname, activeDeal });
  const isMarchandRoute = window.location.pathname.startsWith('/marchand-de-bien');
  const showNoDealWarn  = isMarchandRoute && !activeDeal;

  const isQuick           = resolvedMode === 'quick';
  const staticSuggestions = isQuick ? SUGGESTIONS_QUICK[vertical] : SUGGESTIONS_ADVANCED[vertical];
  const subtitle          = isQuick ? SUBTITLE_QUICK[vertical] : SUBTITLE_ADVANCED[vertical];

  const isStaticFallback = dynamicQuestions === null;
  const questionsToShow  = dynamicQuestions ?? staticSuggestions;

  // Page Analyse rapide : questions dédiées, on ignore le mode
  if (isAnalyseRapide) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%',
        padding: 24, textAlign: 'center',
      }}>
        <div style={{
          height: 52, width: 52, borderRadius: 16, marginBottom: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `linear-gradient(135deg, ${T.accent}, rgb(79 70 229))`,
          boxShadow: `0 8px 28px ${T.accentGlow}`,
        }}>
          <Sparkles size={24} color="white" />
        </div>
        <div style={{ color: T.text, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
          Mimmoza Copilot
        </div>
        <div style={{ color: T.textMuted, fontSize: 13, marginBottom: 16, maxWidth: 280 }}>
          Mode rapide : questions simples sur la parcelle.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320 }}>
          {ANALYSE_RAPIDE_QUESTIONS.map((q) => (
            <button key={q.label} onClick={() => onPick(q.prompt)}
              style={btnStyle()} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
              {q.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%',
      padding: 24, textAlign: 'center',
    }}>
      <div style={{
        height: 52, width: 52, borderRadius: 16, marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(135deg, ${T.accent}, rgb(79 70 229))`,
        boxShadow: `0 8px 28px ${T.accentGlow}`,
      }}>
        <Sparkles size={24} color="white" />
      </div>

      <div style={{ color: T.text, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
        Mimmoza Copilot
      </div>

      <div style={{ color: T.textMuted, fontSize: 13, marginBottom: 16, maxWidth: 280 }}>
        {isStaticFallback
          ? subtitle
          : isQuick
            ? 'Questions adaptées à cette page. Réponse rapide, 3 crédits.'
            : 'Analyses approfondies pour cette page. 15 crédits.'}
      </div>

      {contextLabel && <ContextBadge label={`Contexte : ${contextLabel}`} />}
      {showNoDealWarn && <NoDealMessage />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320 }}>
        {isStaticFallback
          ? (questionsToShow as string[]).map((s) => (
              <button key={s} onClick={() => onPick(s)}
                style={btnStyle()} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                {s}
              </button>
            ))
          : (questionsToShow as Array<{ label: string; prompt: string }>).map((q) => (
              <button key={q.label} onClick={() => onPick(q.prompt)}
                style={btnStyle()} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                {q.label}
              </button>
            ))
        }
      </div>
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    padding: '10px 14px', borderRadius: 11, textAlign: 'left',
    background: 'rgb(255 255 255 / 0.04)', border: `1px solid ${T.borderSoft}`,
    color: T.text, fontSize: 13, cursor: 'pointer', transition: 'all .15s',
  };
}

function hoverOn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = T.accentSoft;
  e.currentTarget.style.borderColor = T.border;
}

function hoverOff(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'rgb(255 255 255 / 0.04)';
  e.currentTarget.style.borderColor = T.borderSoft;
}