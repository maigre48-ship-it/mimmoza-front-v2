// LOT X3b (14/11/2026) — secteur protégé dans la carte « Extension de maison » : la vue est lue dans la sortie du serveur,
// calculée ici par le même code (parcours réel P0646, réponses simulées des services au format de leur code déployé).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { avancerParcours, ETAT_INITIAL, type ContexteParcours, type EtatParcours, type SortieParcours } from '../../../../supabase/functions/_shared/extension/parcours.ts';
import { evaluerSecteurProtege } from '../../../../supabase/functions/_shared/extension/secteurProtege.ts';
import { reglesDeLaConception, resultatParcours } from '../../../../supabase/functions/copilot-chat/agent/extension.ts';
import { facadesVoieDeLaParcelle } from '../../../../supabase/functions/copilot-chat/agent/voisines-parcelle.ts';
import { derniereVueExtension, lireSecteur, lireVueExtension } from './extensionMaison.ts';

const FX = JSON.parse(readFileSync(new URL('./__fixtures__/extension-x3-reel.json', import.meta.url), 'utf8'));
const C = FX.conceptionP0646;
const S = FX.bdtopo.sites.find((s: { idu: string }) => s.idu === '930470000P0646');
const fac = facadesVoieDeLaParcelle(C.parcelle);
const ctx = (secteur: ContexteParcours['secteur']): ContexteParcours => ({
  idu: S.idu, commune: 'Montfermeil', contourWgs84: S.contourWgs84, surfaceParcelleM2: 750, batiments: S.batiments, raisonBdTopo: null,
  dateBdTopo: '2026-11-14', bdnb: null, noteBdnb: null, zoneU: { valeur: true, source: 'zone UC du PLU (test)' }, regles: reglesDeLaConception(C.regles_plu),
  facadesVoie: fac.facades.map((f) => ({ debut: f.debut, fin: f.fin })), raisonFacades: fac.raison, secteur,
});
function jouer(c: ContexteParcours, messages: string[]): SortieParcours[] {
  const out: SortieParcours[] = [];
  let etat: EtatParcours = ETAT_INITIAL;
  let att: readonly string[] = [];
  for (const m of messages) { const s = avancerParcours(etat, m, att, c); out.push(s); etat = s.etat; att = s.attendues; }
  return out;
}
const sortieOutil = (s: SortieParcours) => JSON.parse(JSON.stringify(resultatParcours(s)));
const sup = (items: object[]) => ({ ok: true as const, data: { status: items.length ? 'ok' : 'no_data', summary: '…', stats: { couches_interrogees: 3, couches_totales: 3, geometrie_utilisee: 'parcelle' }, items } });
const SPR = sup([{ categorie: null, nom: 'Site patrimonial remarquable de Bayonne', type_assiette: 'Périmètre du site patrimonial remarquable', idgen: 'AC4-172014607-2019-1', idass: 'AC4-172014607-2019-1-1', partition: '172014607_SUP_64_AC4' }]);
const MH_AUCUN = { ok: true as const, data: { status: 'no_data', summary: 'Aucun monument historique dans un rayon de 500 m.', stats: null, items: [] } };
const MH_PANNE = { ok: true as const, data: { status: 'error', summary: "Erreur interrogation Mérimée : Unexpected token '<'", stats: null, items: [] } };
const INTERNES = /\b(?:get_[a-z_]+|servitudes-gpu-v1|patrimoine-merimee-v1|COPILOT_FN_[A-Z_]+)\b/;

test('X3b-F1 : pastille « Secteur protégé : oui » dès l’étape 1, avec source, date, avis ABF, délai et sources officielles', () => {
  const t = jouer(ctx(evaluerSecteurProtege(S.idu, '2026-11-14', SPR, MH_AUCUN)), ['Je voudrais agrandir ma maison']);
  const v = lireVueExtension(sortieOutil(t[0]!))!;
  assert.equal(v.etape, 'conserver');
  assert.ok(v.secteur);
  assert.equal(v.secteur!.pastille, 'Secteur protégé : oui');
  assert.equal(v.secteur!.date, '14/11/2026');
  assert.equal(v.secteur!.etat, 'oui');
  assert.match(v.secteur!.protections[0]!, /Site patrimonial remarquable « Site patrimonial remarquable de Bayonne »/);
  assert.ok(v.secteur!.lignes.some((l) => /ACCORD requis/.test(l)));
  assert.ok(v.secteur!.lignes.some((l) => /2 mois au lieu de 1/.test(l)));
  assert.deepEqual(v.secteur!.consultations.map((c) => c.split(' : ').pop()), ['consulté', 'consulté']);
  assert.ok(v.secteur!.sources.every((s) => /^https:\/\/www\.(service-public|culture)\.gouv\.fr\//.test(s.url)));
  assert.doesNotMatch(JSON.stringify(v), INTERNES);
});

test('X3b-F2 : panne → « Secteur protégé : non vérifié » (jamais « non trouvé ») ; non trouvé ; synthèse dans le Dossier 3D', () => {
  const panne = lireVueExtension(sortieOutil(jouer(ctx(evaluerSecteurProtege(S.idu, '2026-11-14', sup([]), MH_PANNE)), ['agrandir ma maison'])[0]!))!;
  assert.equal(panne.secteur!.pastille, 'Secteur protégé : non vérifié');
  assert.ok(panne.secteur!.consultations.some((c) => /base Mérimée.*non consulté \(panne\)/.test(c)));
  assert.doesNotMatch(JSON.stringify(panne), /Unexpected token/);
  const t = jouer(ctx(evaluerSecteurProtege(S.idu, '2026-11-14', sup([]), MH_AUCUN)), [
    'Je voudrais agrandir ma maison', 'Maison existante : Conserver la maison',
    'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
    'Dimensions (largeur × profondeur) : 6 × 5 m · Hauteur de l’extension : Plain-pied',
    'Surface de plancher existante : Je l’indique · 90 m² · Demandeur : Particulier',
  ]);
  const messages = t.map((s) => ({ toolCalls: [{ name: 'extension_maison', status: 'success', output: sortieOutil(s) }] }));
  const v = derniereVueExtension(messages)!;
  assert.equal(v.etape, 'termine');
  assert.equal(v.secteur!.pastille, 'Secteur protégé : non trouvé');
  assert.ok(v.regime!.lignes.some((l) => /le seuil serait de 20 m² : PC/.test(l)));
  // Sortie sans secteur (lot X3) : pas de pastille ; état inconnu jamais lu comme « non trouvé ».
  assert.equal(lireSecteur(undefined), null);
  assert.equal(lireSecteur({ etat: 'hors', date: '2026-11-14' }), null);
  assert.equal(lireSecteur({ etat: 'non_verifie', date: 'x', sources: [{ titre: 't', url: 'https://exemple.com/' }] })!.sources.length, 0);
});
