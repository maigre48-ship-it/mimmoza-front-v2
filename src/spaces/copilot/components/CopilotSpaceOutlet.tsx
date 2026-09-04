// =============================================================================
// CopilotSpaceOutlet — déclare l'espace courant au copilote
// =============================================================================
//
// `useCopilotPageSync` renseigne la verticale et le `pageContext` (espace /
// mode / onglet) du copilote à chaque changement de route. Il n'était monté que
// dans deux layouts sur six : marchand de bien et réhabilitation. Les espaces
// promoteur, particulier, assurance et apporteur sont déclarés dans App.tsx
// avec un simple `<Outlet />`, sans composant de layout où accrocher le hook —
// ils n'avaient donc aucun `pageContext`, et leur verticale n'était devinée
// qu'à partir du préfixe de route.
//
// Ce composant est cet endroit manquant : il appelle le hook puis rend
// l'`<Outlet />` attendu, sans ajouter de balise ni de style.
//
//   <Route path="/promoteur" element={<CopilotSpaceOutlet vertical="promoteur" />}>
//
// =============================================================================

import { Outlet, useLocation } from 'react-router-dom';

import type { ActiveCopilotSnapshot } from '../store/activeCopilotContext.store';
import { useCopilotPageSync } from '../hooks/useCopilotPageSync';

type CopilotVertical = NonNullable<ActiveCopilotSnapshot['vertical']>;

export function CopilotSpaceOutlet({ vertical }: { vertical: CopilotVertical }) {
  const { pathname } = useLocation();
  useCopilotPageSync(pathname, vertical);
  return <Outlet />;
}

export default CopilotSpaceOutlet;
