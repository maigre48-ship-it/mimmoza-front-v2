// node --test src/spaces/copilot/studio3d/reglesParBande.test.ts
// Les options ci-dessous sont celles RÉELLEMENT enregistrées par la mission du 10/11/2026 (Montreuil,
// parcelle 93048000AS0249, PLUi Est Ensemble, indices J et b2), libellés tronqués compris.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estConditionBande, mentionBandes, optionBandePrincipale, optionBandeSecondaire, profondeurBandePrincipaleM, valeurParBande } from './reglesParBande.ts';
import { controlerVolume, lireRegles, reglesVolume } from './controlesVolume.ts';

const HAUTEUR = [{ libelle: 'Bande principale (pr…', valeur: 19.5 }, { libelle: 'Bande secondaire', valeur: 13.5 }];
const NIVEAUX = [{ libelle: 'Bande principale (pr…', valeur: 6 }, { libelle: 'Bande secondaire', valeur: 4 }];
const EMPRISE = [
  { libelle: 'Bande principale (pr…', valeur: 80 }, { libelle: 'Bande secondaire', valeur: 20 },
  { libelle: 'Bande principale (te…', valeur: 80 }, { libelle: 'Bande secondaire – c…', valeur: 30 },
];
const PLEINE_TERRE = [{ libelle: 'Bande principale (pr…', valeur: 15 }, { libelle: 'Bande secondaire', valeur: 50 }];

test('options réelles du 10/11 : ce sont des bandes, et la bande principale est retenue', () => {
  for (const o of [HAUTEUR, NIVEAUX, EMPRISE, PLEINE_TERRE]) assert.ok(estConditionBande(o));
  assert.equal(optionBandePrincipale(HAUTEUR)?.valeur, 19.5);
  assert.equal(optionBandeSecondaire(HAUTEUR)?.valeur, 13.5);
  assert.deepEqual(valeurParBande(HAUTEUR, 'min'), { valeur: 19.5, bandePrincipale: true, mesure: 'selon la bande : valeur de la bande principale (sur voie) retenue (19,5) ; bande secondaire : 13,5' });
  assert.equal(valeurParBande(NIVEAUX, 'min').valeur, 6);
  assert.equal(valeurParBande(EMPRISE, 'min').valeur, 80);        // et non 20
  assert.equal(valeurParBande(PLEINE_TERRE, 'max').valeur, 15);   // et non 50
});

test('un choix du constructeur ou une condition de façade ne sont pas des bandes', () => {
  assert.ok(!estConditionBande([{ libelle: 'alignement', valeur: 0 }, { libelle: 'recul minimum', valeur: 4 }]));
  assert.ok(!estConditionBande([{ libelle: 'façade avec baie', valeur: 8 }, { libelle: 'façade sans baie', valeur: 3 }]));
  assert.ok(!estConditionBande([{ libelle: 'Bande principale', valeur: 80 }]));   // une seule option
  assert.ok(!estConditionBande(null));
  assert.equal(optionBandePrincipale([{ libelle: 'alignement', valeur: 0 }, { libelle: 'recul minimum', valeur: 4 }]), null);
});

test('bande principale non identifiable : on ne devine pas, la plus contraignante est gardée', () => {
  const flou = [{ libelle: 'première bande', valeur: 80 }, { libelle: 'seconde bande', valeur: 20 }];
  assert.ok(estConditionBande(flou));
  assert.deepEqual(valeurParBande(flou, 'min'), { valeur: 20, bandePrincipale: false, mesure: 'selon la bande : bande principale non identifiée, valeur la plus contraignante retenue' });
  assert.equal(valeurParBande(flou, 'max').valeur, 80);
});

test('profondeur de la bande : lue seulement si elle est écrite comme une profondeur', () => {
  assert.equal(profondeurBandePrincipaleM([{ libelle: 'bande principale (18 m)', valeur: 80 }, { libelle: 'bande secondaire', valeur: 20 }]), 18);
  assert.equal(profondeurBandePrincipaleM(EMPRISE, 'Dans la bande principale d’une profondeur de 18 mètres, l’emprise au sol des constructions est limitée à 80%'), 18);
  assert.equal(profondeurBandePrincipaleM(EMPRISE), null);                                    // libellés tronqués : rien d'écrit
  assert.equal(profondeurBandePrincipaleM(HAUTEUR, 'Dans la bande principale, la hauteur est limitée à 19,5 mètres'), null);   // une hauteur n'est pas une profondeur
  assert.equal(profondeurBandePrincipaleM([{ libelle: 'bande principale (80 m)', valeur: 80 }, { libelle: 'bande secondaire', valeur: 20 }]), null);   // hors bornes
  assert.equal(mentionBandes(EMPRISE, '%'), 'règle par bande — bande principale (profondeur non lue) : 80 % ; bande secondaire : 20 %');
  assert.equal(mentionBandes([{ libelle: 'bande principale (18 m)', valeur: 19.5 }, { libelle: 'bande secondaire', valeur: 13.5 }], 'm'),
    'règle par bande — bande principale de 18 m depuis la voie : 19,5 m ; bande secondaire : 13,5 m');
});

// Règles telles que stockées le 10/11 (valeur = celle du FOND, « au choix du constructeur »).
const STOCKEES = [
  { cle: 'hauteur_max_m', valeur: 13.5, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice b2, p. 263', nature: 'chiffree', alternatives: HAUTEUR },
  { cle: 'niveaux_max', valeur: 4, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice b2, p. 263', nature: 'chiffree', alternatives: NIVEAUX },
  { cle: 'emprise_sol_max_pct', valeur: 20, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice J, p. 237', nature: 'chiffree', alternatives: EMPRISE },
  { cle: 'pleine_terre_min_pct', valeur: 50, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice J, p. 237', nature: 'chiffree', alternatives: PLEINE_TERRE },
  { cle: 'recul_limites_m', valeur: 3, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice 1, p. 214' },
];

test('lireRegles : une règle déjà stockée avec la valeur du fond est relue avec la bande principale', () => {
  const r = Object.fromEntries(lireRegles(STOCKEES).map((x) => [x.cle, x]));
  assert.equal(r.hauteur_max_m.valeur, 19.5);
  assert.equal(r.niveaux_max.valeur, 6);
  assert.equal(r.emprise_sol_max_pct.valeur, 80);
  assert.equal(r.pleine_terre_min_pct.valeur, 15);
  assert.equal(r.recul_limites_m.valeur, 3);                       // règle sans bande : inchangée
  assert.equal(r.recul_limites_m.regle_relative, null);
  assert.match(r.hauteur_max_m.regle_relative ?? '', /règle par bande — bande principale \(profondeur non lue\) : 19,5 m ; bande secondaire : 13,5 m ; côté voie non identifié/);
});

// Lot C10 (défaut D) : sans côté voie, un bâtiment peut être en bande secondaire → hauteur, niveaux et pleine
// terre les plus contraignants des bandes (avant : 19,5 m, 6 niveaux et 15 %, valeurs de la bande principale).
test('reglesVolume, côté voie non situé : hauteur, niveaux, emprise et pleine terre les plus contraignants des bandes, et c’est dit', () => {
  const v = reglesVolume(lireRegles(STOCKEES), null);
  const val = (cle: string) => v.regles.find((x) => x.cle === cle)?.valeur;
  assert.equal(val('hauteur_max_m'), 13.5);
  assert.equal(val('niveaux_max'), 4);
  assert.equal(val('emprise_max_ratio'), 0.2);                     // côté voie inconnu : on ne suppose pas 80 % de la parcelle
  assert.equal(val('pleine_terre_min_ratio'), 0.5);
  assert.match(v.nonAppliquees.join(' | '), /Règle par bande, hauteur \(bande principale \(profondeur non lue\) : 19,5 m ; bande secondaire : 13,5 m\) — le volume d’étude n’est pas situé dans la bande principale : 13,5 m appliqué, et non 19,5 m/);
  // L'appelant qui GARANTIT l'implantation dans la bande principale garde les valeurs de cette bande.
  const dansBande = reglesVolume(lireRegles(STOCKEES), null, null, { implantationDansBande: true });
  assert.equal(dansBande.regles.find((x) => x.cle === 'hauteur_max_m')?.valeur, 19.5);
  assert.equal(dansBande.regles.find((x) => x.cle === 'niveaux_max')?.valeur, 6);
  assert.equal(dansBande.regles.find((x) => x.cle === 'pleine_terre_min_ratio')?.valeur, 0.15);
  assert.equal(val('epaisseur_max_m'), undefined);
  const note = v.nonAppliquees.find((l) => l.startsWith('Emprise par bande')) ?? '';
  assert.match(note, /80 % dans la bande principale, 20 % dans la bande secondaire/);
  assert.match(note, /SOUS-ESTIME/);
});

test('controlerVolume : une règle par bande n’est jamais « dans la limite » sans vérification', () => {
  const regles = lireRegles(STOCKEES);
  const volume = { surfaceParcelleM2: 804, emprise: { surfaceM2: 150 }, niveaux: 6, hauteurM: 18, reculM: 3, kpi: null, batiments: [] } as never;
  const c = Object.fromEntries(controlerVolume(volume, regles, null).map((x) => [x.cle, x]));
  assert.equal(c.hauteur_max_m.verdict, 'a_verifier');
  assert.match(c.hauteur_max_m.explication, /règle par bande/);
  assert.equal(c.emprise_sol_max_pct.verdict, 'a_verifier');
  assert.equal(c.recul_limites_m.verdict, 'dans_la_limite');       // règle sans bande, citée : inchangé
});
