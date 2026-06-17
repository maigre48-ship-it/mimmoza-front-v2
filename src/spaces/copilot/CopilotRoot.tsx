// src/spaces/copilot/CopilotRoot.tsx
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { CopilotFloatingButton } from './components/CopilotFloatingButton';
import { CopilotDrawer } from './components/CopilotDrawer';
import { useCopilotStore } from './store/copilotStore';

// Routes où le Copilot ne doit PAS apparaître :
//  - pages publiques / avant connexion
//  - espace compte (compte, abonnement, jetons)
//  - admin
//  - opportunités (transversal, sans contexte métier parcelle/deal)
const HIDDEN_PREFIXES = [
  '/', '/login', '/connexion', '/inscription',
  '/cgv', '/cgu', '/politique-confidentialite', '/mentions-legales',
  '/admin',
  '/compte', '/account', '/abonnement', '/jetons',
  '/opportunites',
];

function isHidden(pathname: string): boolean {
  if (pathname === '/') return true;
  return HIDDEN_PREFIXES.some((p) => p !== '/' && pathname.startsWith(p));
}

export function CopilotRoot() {
  const location = useLocation();
  const closeCopilot = useCopilotStore((s) => s.closeCopilot);

  useEffect(() => {
    closeCopilot();
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