// deno test --no-check supabase/functions/copilot-chat/agent/conception-bandes.test.ts
// Lot C6 : règles « par bande » (mission du 10/11/2026, Montreuil, PLUi Est Ensemble, indices J et b2).
import * as na from 'node:assert/strict';
import { CONSIGNE_LECTURE_REGLEMENT, decrireRegle, normaliserRegle, reglesDepuisLecture, valeurAlternative } from './conception.ts';

const HAUTEUR = [{ libelle: 'bande principale (18 m)', valeur: 19.5 }, { libelle: 'bande secondaire', valeur: 13.5 }];

Deno.test('valeurAlternative : par bande → bande principale, pour une règle « maximum » comme pour une « minimum »', () => {
  na.equal(valeurAlternative('hauteur_max_m', HAUTEUR).valeur, 19.5);
  na.match(valeurAlternative('hauteur_max_m', HAUTEUR).mesure, /^selon la bande : valeur de la bande principale/);
  na.equal(valeurAlternative('emprise_sol_max_pct', [{ libelle: 'Bande principale (pr…', valeur: 80 }, { libelle: 'Bande secondaire', valeur: 20 }]).valeur, 80);
  na.equal(valeurAlternative('pleine_terre_min_pct', [{ libelle: 'Bande principale (pr…', valeur: 15 }, { libelle: 'Bande secondaire', valeur: 50 }]).valeur, 15);
});

Deno.test('valeurAlternative : choix du constructeur et condition de façade inchangés', () => {
  na.equal(valeurAlternative('recul_voie_m', [{ libelle: 'alignement', valeur: 0 }, { libelle: 'recul minimum', valeur: 4 }]).valeur, 0);
  na.equal(valeurAlternative('recul_limites_m', [{ libelle: 'façade avec baie', valeur: 8 }, { libelle: 'façade sans baie', valeur: 3 }]).valeur, 8);
  na.equal(valeurAlternative('emprise_sol_max_pct', [{ libelle: 'cas A', valeur: 60 }, { libelle: 'cas B', valeur: 40 }]).valeur, 40);
});

Deno.test('lecture du règlement : la règle par bande est enregistrée avec la valeur sur voie et la bonne étiquette', () => {
  const regles = reglesDepuisLecture({ regles: [
    { cle: 'hauteur_max_m', nature: 'alternative', alternatives: HAUTEUR, article: 'indice b2, p. 263', texte: 'Dans la bande principale d’une profondeur de 18 mètres : la hauteur est limitée à 19,5 mètres maximum' },
    { cle: 'niveaux_max', nature: 'alternative', alternatives: [{ libelle: 'bande principale (18 m)', valeur: 6 }, { libelle: 'bande secondaire', valeur: 4 }], article: 'indice b2, p. 263', texte: 'R+5 maximum' },
  ] }, 'gpu', 'Règlement GPU — PLUi Est Ensemble');
  const h = regles.find((r) => r.cle === 'hauteur_max_m')!;
  na.equal(h.valeur, 19.5);
  na.equal(h.statut, 'confirme');
  na.equal(h.alternatives?.length, 2);
  na.ok(h.texte?.includes('selon la bande (condition de profondeur, pas un choix libre)'));
  na.ok(!h.texte?.includes('au choix du constructeur'));
  na.equal(regles.find((r) => r.cle === 'niveaux_max')!.valeur, 6);
  na.ok(decrireRegle(h).includes('selon la bande'));
});

Deno.test('une règle déjà normalisée avec ses bandes garde la bande principale quand elle est relue', () => {
  const n = normaliserRegle({ cle: 'emprise_sol_max_pct', valeur: 20, statut: 'confirme', source: 'Règlement GPU', article: 'indice J, p. 237',
    alternatives: [{ libelle: 'Bande principale (pr…', valeur: 80 }, { libelle: 'Bande secondaire', valeur: 20 }] }, 'base');
  na.equal(n?.valeur, 80);
});

Deno.test('consigne de lecture : le cas des bandes et le compte des niveaux sont écrits', () => {
  const c = CONSIGNE_LECTURE_REGLEMENT('UC', 'gpu');
  for (const mot of ['DÉPEND DE LA BANDE', '« bande principale (18 m) »', '« bande secondaire »', 'NI un choix du constructeur NI un secteur du plan', 'R+5 = 6 niveaux']) {
    na.ok(c.includes(mot), mot);
  }
});
