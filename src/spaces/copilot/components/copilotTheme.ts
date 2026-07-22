// src/spaces/copilot/components/copilotTheme.ts
// Tokens de design Copilot — thème CLAIR aligné sur MimmozIAPage
// (blanc dominant, encre slate, violet d'accent). Point de bascule unique :
// tous les composants du drawer lisent ces valeurs, donc changer ce fichier
// repeint tout le tiroir d'un coup.
export const COPILOT_THEME = {
  bg: 'rgb(252 252 254)',              // fond du panneau (quasi blanc, cf. MimmozIAPage)
  surface: 'rgb(255 255 255 / 0.72)',  // surfaces vitrées
  surfaceSolid: 'rgb(255 255 255)',
  border: 'rgb(109 93 252 / 0.22)',    // liseré violet léger (#6d5dfc)
  borderSoft: 'rgb(15 23 42 / 0.08)',  // séparateurs discrets sur clair
  accent: 'rgb(109 93 252)',           // violet MimmozIA (#6d5dfc)
  accentSoft: 'rgb(109 93 252 / 0.10)',
  accentGlow: 'rgb(109 93 252 / 0.28)',
  text: 'rgb(15 23 42)',               // encre slate (#0f172a)
  textMuted: 'rgb(91 95 120)',         // gris-violet (#5b5f78)
  userBubble: 'rgb(99 102 241 / 0.10)',
} as const;