// npx tsx --test src/spaces/copilot/studio3d/vis32MatieresExactes.test.ts
// VIS-32 (24/11/2026) — la matière EXACTE choisie dans « Toutes les matières » (étape 4) part dans le brief :
//   - références transmises (av-, pm-, rg-) = liste blanche du serveur (matieresParPartie.ts, module partagé) ;
//   - carte et message : « rendue telle quelle » ; valeur fermée gardée en REPLI ; qm- toujours traduites ;
//   - le bloc est accepté par le serveur RÉEL (briefDuMessage) avec `brief.matieres` ;
//   - réouverture de la carte : la matière choisie est relue (bloc du message ou devis `brief_actuel`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE_EXTERIEUR } from './catalogueExterieur.ts';
import {
  CHOIX_DEFAUT, PARTIES_MATIERE, briefAEnvoyer, briefCourant, briefDuBloc, choisirMatiereCatalogue, demandeFiche, etatInitial, lireDemandeBrief,
  messageBrief, phraseMatieresCatalogue, type EtatBrief, type LimitesBrief,
} from './briefCreatif.ts';
import { matiereChoisie, matiereDepuisRef, matieresDeLaPartie, traduireMatiere } from './matieresCatalogue.ts';
import { LISTE_BLANCHE_MATIERES, referenceTransmissible } from './matieresParPartie.ts';
import { briefDuMessage, encoderBrief, briefDuJeton } from '../../../../supabase/functions/copilot-chat/agent/studio.ts';

const entree = (ref: string) => { const e = CATALOGUE_EXTERIEUR.find((x) => x.refStudio === ref); assert.ok(e, ref); return e; };
const LIMITES: LimitesBrief = { balcons: true, ailes: false, batiments: 1 } as LimitesBrief;
const D = { ambiances: ['jour', 'fin_de_journee'] as const, limites: LIMITES } as unknown as Parameters<typeof choisirMatiereCatalogue>[4];

function choisirRef(e0: EtatBrief, partie: (typeof PARTIES_MATIERE)[number], ref: string): EtatBrief {
  const e = entree(ref);
  const r = choisirMatiereCatalogue(e0, partie, matiereChoisie(partie, e), traduireMatiere(partie, e).champs, D);
  assert.equal(r.refus, null);
  return r.etat;
}

test('parité site ↔ serveur : chaque matière proposée et transmissible est dans la liste blanche du serveur, et seulement elles', () => {
  for (const p of PARTIES_MATIERE) {
    const proposees = matieresDeLaPartie(p).filter((e) => referenceTransmissible(e.refStudio)).map((e) => e.refStudio).sort();
    assert.deepEqual([...LISTE_BLANCHE_MATIERES[p].keys()].sort(), proposees, p);
  }
  assert.ok(matieresDeLaPartie('facade').some((e) => e.refStudio === 'qm-pierre-gres') && !LISTE_BLANCHE_MATIERES.facade.has('qm-pierre-gres'));
});

test('choix : la référence transmissible est « rendue telle quelle » et part dans le bloc ; qm- reste approchée ; repli fermé gardé', () => {
  let e = choisirRef({ choix: { ...CHOIX_DEFAUT }, touches: [] }, 'facade', 'av-pierre-de-taille');
  e = choisirRef(e, 'soubassement', 'qm-pierre-moellon');
  e = choisirRef(e, 'menuiseries', 'av-bois-peint-blanc');
  assert.equal(e.matieres?.facade?.transmise, true);
  assert.equal(e.matieres?.soubassement?.transmise, undefined);
  assert.equal(e.choix.facade, 'pierre', 'valeur fermée la plus proche gardée en repli');
  const phrase = phraseMatieresCatalogue(e) ?? '';
  assert.match(phrase, /façade « Pierre de taille » \(rendue telle quelle, avec réserve\)/);
  assert.match(phrase, /soubassement « Moellons de pierre » \(rendue pour l’instant comme « Soubassement en pierre », avec réserve\)/);
  assert.deepEqual(briefAEnvoyer(e).matieres, { facade: 'av-pierre-de-taille', menuiseries: 'av-bois-peint-blanc' });
  const msg = messageBrief(e, { type: 'film', limites: LIMITES } as never);
  const lu = briefDuMessage(msg);
  assert.ok(lu?.ok, JSON.stringify(lu));
  assert.deepEqual(lu.ok && lu.valeur.brief?.matieres, { facade: 'av-pierre-de-taille', menuiseries: 'av-bois-peint-blanc' });
  assert.equal(lu.ok && lu.valeur.brief?.matieresIgnorees, undefined, 'rien d’ignoré');
  // Jeton du devis : forme « 3: », relue à l'identique.
  assert.ok(lu.ok && lu.valeur.brief);
  const j = encoderBrief(lu.valeur.brief!);
  assert.match(j, /^3:/);
  assert.deepEqual(briefDuJeton(j)?.matieres, { facade: 'av-pierre-de-taille', menuiseries: 'av-bois-peint-blanc' });
});

test('réouverture : la matière choisie est relue depuis le bloc du message et depuis le devis (brief_actuel)', () => {
  const e = choisirRef({ choix: { ...CHOIX_DEFAUT }, touches: [] }, 'toiture', 'pm-zinc');
  const msg = messageBrief(e, { type: null, limites: LIMITES } as never);
  const bloc = briefDuBloc(msg);
  assert.deepEqual(bloc?.matieres, { toiture: 'pm-zinc' });
  const courant = briefCourant([{ role: 'user', text: msg }]);
  const etat = etatInitial(demandeFiche(courant, null, LIMITES));
  assert.equal(etat.matieres?.toiture?.ref, 'pm-zinc');
  assert.equal(etat.matieres?.toiture?.aResoudre, true);
  // La carte complète le nom et le statut (catalogue chargé à la demande).
  const complete = matiereDepuisRef('toiture', 'pm-zinc');
  assert.equal(complete?.nom, entree('pm-zinc').nom);
  assert.equal(complete?.transmise, true);
  assert.equal(matiereDepuisRef('facade', 'pm-zinc'), null, 'une couverture n’habille pas une façade');
  // Devis : brief_actuel porte les références (serveur VIS-32).
  const sortie = { name: 'studio_lancer_rendu', status: 'success', output: { status: 'confirmation_requise', data: { type: 'image', brief_actuel: {
    style: 'contemporain', facade: 'pierre', ouvertures: 'fenetres_verticales', balcons: 'balcons', attique: false, rdc: 'logements', ambiance: 'jour',
    toiture: 'terrasse', teinte: 'naturelle', garde_corps: 'metal', menuiseries: 'gris', soubassement: 'aucun', defauts: [],
    matieres: { facade: 'av-pierre-de-taille', toiture: 'qm-inconnue' } } } } };
  const d = lireDemandeBrief(sortie);
  assert.deepEqual(d?.actuel?.matieres, { facade: 'av-pierre-de-taille' }, 'seules les références transmissibles sont relues');
  assert.equal(etatInitial(d!).matieres?.facade?.ref, 'av-pierre-de-taille');
  // Sans matière : état initial inchangé (pas de clé « matieres »).
  assert.ok(!('matieres' in etatInitial({ actuel: null, ambiances: ['jour'] })));
});
