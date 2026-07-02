// src/spaces/copilot/CopilotRoot.tsx
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { CopilotDrawer } from './components/CopilotDrawer';
import { CopilotFloatingButton } from './components/CopilotFloatingButton';
import { useCopilotStore } from './store/copilotStore';
import { isLandingRoute } from './welcome/copilotWelcome';
import { userStorage } from "@/lib/storage/userScopedStorage";

// Routes ou le Copilot ne doit PAS apparaitre.
// NB : l'accueil (/dashboard) n'est PLUS masque -> il sert le bot scripte.
const HIDDEN_PREFIXES = [
  '/login', '/connexion', '/inscription',
  '/cgv', '/cgu', '/politique-confidentialite', '/mentions-legales',
  '/admin',
  '/compte', '/account', '/abonnement', '/jetons',
  '/opportunites',
  '/apporteur',
  '/marchand-de-bien/planning',   // Rendu travaux (investisseur)
];

// Routes cachees en correspondance EXACTE (evite qu'un prefixe '/' cache tout).
const HIDDEN_EXACT = [
  '/',   // page de connexion montee sur la racine (retire si ce n'est pas le cas)
];

function isHidden(pathname: string): boolean {
  if (HIDDEN_EXACT.includes(pathname)) return true;
  return HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));
}

const WELCOME_KEY = 'mimmoza_copilot_welcome_v1';

export function CopilotRoot() {
  const location = useLocation();
  const openCopilot = useCopilotStore((s) => s.openCopilot);
  const closeCopilot = useCopilotStore((s) => s.closeCopilot);

  useEffect(() => {
    const path = location.pathname;

    if (isLandingRoute(path)) {
      // Auto-ouverture une seule fois (le drawer affichera le bot scripte).
      let seen = true;
      try { seen = userStorage.getItem(WELCOME_KEY) === '1'; } catch { /* no-op */ }
      if (!seen) {
        openCopilot();
        try { userStorage.setItem(WELCOME_KEY, '1'); } catch { /* no-op */ }
      }
    } else {
      // Tout changement de route hors accueil ferme le Copilot.
      closeCopilot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (isHidden(location.pathname)) return null;

  return (
    <>
      <CopilotFloatingButton />
      <CopilotDrawer />
    </>
  );
}