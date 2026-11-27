// src/lib/studio/vis71StyleFacade.test.ts — VIS-71 : style de façade (portage du kit VIS-65), trace « Habiller le projet »,
// fiche du rendu ; grille de vente transmise au Studio par la carte de commande du chat (outil Edge grille_vente).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  commandeStyleFacade, estStyleFacade, ficheAvecStyleFacade, libelleStyleFacade, STYLES_FACADE_KIT, styleDepuisTexte, styleDuChat, styleFacadeRetenu,
} from './styleFacade.ts';
import { habillageDesTraces, paramsTraceHabillage, rappelHabillage } from './habillageProjet.ts';
import { lireCarteCommande } from '../../spaces/copilot/studio3d/pontCommandesSite.ts';
import { lireCarteGrilleVente } from '../vente/carteGrilleVente.ts';
import { executerOutilGrilleVente } from '../../../supabase/functions/copilot-chat/agent/grille-vente.ts';

describe('VIS-71 — les 7 styles du kit', () => {
  it('identifiants et libellés du Studio, béton brut marqué « aperçu »', () => {
    assert.deepEqual(STYLES_FACADE_KIT.map((s) => s.id), ['contemporain_sobre', 'contemporain_bois_zinc', 'neo_basque', 'haussmannien_moderne', 'mediterraneen', 'beton_brut', 'traditionnel_sobre']);
    assert.equal(libelleStyleFacade('beton_brut'), 'béton brut (aperçu, matières incomplètes)');
    assert.equal(libelleStyleFacade('neo_basque'), 'néo-basque');
    assert.equal(STYLES_FACADE_KIT.filter((s) => s.apercu).length, 1);
  });
  it('langage : mêmes réponses que langage.ts du Studio', () => {
    const cas: [string, string | null][] = [
      ['contemporain bois et zinc', 'contemporain_bois_zinc'], ['néo-basque', 'neo_basque'], ['maison basque', 'neo_basque'],
      ['haussmannien', 'haussmannien_moderne'], ['provençal', 'mediterraneen'], ['béton brut', 'beton_brut'],
      ['traditionnel', 'traditionnel_sobre'], ['moderne épuré', 'contemporain_sobre'], ['telle que dessinée', 'tel_que_dessine'], ['rose bonbon', null],
    ];
    for (const [t, id] of cas) assert.equal(styleDepuisTexte(t), id, t);
  });
  it('commande du chat : « passe la façade en contemporain bois et zinc »', () => {
    assert.equal(commandeStyleFacade('passe la façade en contemporain bois et zinc')?.style.id, 'contemporain_bois_zinc');
    assert.equal(commandeStyleFacade('Style de façade : haussmannien')?.style.id, 'haussmannien_moderne');
    assert.equal(commandeStyleFacade('/style néo-basque')?.style.id, 'neo_basque');
    assert.equal(commandeStyleFacade('la façade telle que dessinée'), null, 'jamais « tel que dessiné » par le chat');
    assert.equal(commandeStyleFacade('un immeuble contemporain bois'), null, 'sans geste sur la façade : pas une commande');
    assert.equal(commandeStyleFacade('```mimmoza-brief\nfaçade en béton brut\n```'), null, 'blocs de carte ignorés');
  });
});

describe('VIS-71 — transport du style', () => {
  const le = (m: number) => new Date(Date.UTC(2026, 10, 27, 10, m)).toISOString();
  it('trace du thème Matières : liste blanche ; délégation = aucun style', () => {
    assert.equal(paramsTraceHabillage('matieres', 'choisi', { le: le(1), styleFacade: 'gothique' }).style_facade, undefined);
    assert.equal(paramsTraceHabillage('deco', 'choisi', { le: le(1), styleFacade: 'neo_basque' }).style_facade, undefined);
    const h = habillageDesTraces([paramsTraceHabillage('matieres', 'choisi', { le: le(1), styleFacade: 'neo_basque', resume: 'style de façade « néo-basque »' })]);
    assert.deepEqual(h.styleFacade, { id: 'neo_basque', le: le(1) });
    assert.match(rappelHabillage(h)[0]!, /néo-basque/);
    const d = habillageDesTraces([paramsTraceHabillage('matieres', 'choisi', { le: le(1), styleFacade: 'neo_basque' }), paramsTraceHabillage('matieres', 'delegue', { le: le(2) })]);
    assert.equal(d.styleFacade, null);
    assert.match(rappelHabillage(d)[0]!, /style sobre/);
  });
  it('le plus récent l’emporte (carte / chat)', () => {
    const chat = styleDuChat([{ texte: 'passe la façade en béton brut', cree_le: le(5) }, { texte: 'bonjour', cree_le: le(6) }]);
    assert.equal(chat?.id, 'beton_brut');
    assert.equal(styleFacadeRetenu({ id: 'neo_basque', le: le(4) }, chat)?.id, 'beton_brut');
    assert.equal(styleFacadeRetenu({ id: 'neo_basque', le: le(9) }, chat)?.id, 'neo_basque');
    assert.equal(styleFacadeRetenu(null, null), null);
  });
  it('fiche : details.style_facade ajouté sans rien retirer', () => {
    const f = ficheAvecStyleFacade({ v: 1, habillage_batiments: { clauses: ['façade en brique'], balcons: 'individual', details: { gardeCorps: 'glass' } } }, 'mediterraneen');
    assert.deepEqual(f.habillage_batiments, { clauses: ['façade en brique'], balcons: 'individual', details: { gardeCorps: 'glass', style_facade: 'mediterraneen' } });
    assert.deepEqual(ficheAvecStyleFacade<Record<string, unknown>>({ v: 1 }, 'neo_basque').habillage_batiments, { clauses: [], balcons: null, details: { style_facade: 'neo_basque' } });
    assert.deepEqual(ficheAvecStyleFacade({ v: 1 }, 'inconnu'), { v: 1 });
    assert.equal(estStyleFacade('beton_brut'), true);
  });
});

describe('VIS-71 — grille de vente : sortie de l’outil Edge → cartes du chat', () => {
  it('la carte de commande la transmet au Studio (commande grille-vente) et la carte de synthèse se lit', async () => {
    const r = await executerOutilGrilleVente({ demande: 'montre-moi les T3 libres au-dessus du 2e étage orientés sud' }, { texteRecu: '', conversationId: 'c1', maintenant: () => 1_000 });
    assert.equal(r.status, 'ok', r.message);
    const tc = { id: 'appel-1', name: 'grille_vente', status: 'done', output: r };
    const cmd = lireCarteCommande(tc);
    assert.equal(cmd?.commande?.id, 'grille-vente');
    const carte = lireCarteGrilleVente(r.data);
    assert.ok(carte && /T3/.test(carte.resume), carte?.resume);
    assert.equal(lireCarteCommande({ ...tc, name: 'autre_outil' }), null);
  });
});
