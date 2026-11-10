// deno test supabase/functions/copilot-chat/agent/cartes-plu.test.ts
import * as na from 'node:assert/strict';
import { textesRepliZonageSeul } from './cartes-plu.ts';

/** Tournures qui s'adressent au modèle : aucune ne doit figurer dans un texte affiché. */
const TOURNURES_MODELE = [/utilisateur/i, /\binvente/i, /\bDis\b/, /\bconclus\b/i, /sous aucun prétexte/i, /[a-z]+_[a-z_]+/];

Deno.test('note_repli (affichée dans la carte) ne contient aucune consigne destinée au modèle', () => {
  for (const tentee of [true, false]) {
    const { note_repli } = textesRepliZonageSeul(tentee);
    for (const t of TOURNURES_MODELE) na.equal(t.test(note_repli), false, `« ${t} » trouvé dans : ${note_repli}`);
  }
});

Deno.test('note_repli garde le constat et la marche à suivre', () => {
  const { note_repli } = textesRepliZonageSeul(true);
  na.match(note_repli, /Aucun règlement de PLU n'a été importé sur la page Foncier/);
  na.match(note_repli, /n'a pas pu être lu automatiquement au Géoportail de l'urbanisme/);
  na.match(note_repli, /zonage opposable \(code de zone, type U\/AU\/A\/N\)/);
  na.match(note_repli, /hauteur maximale, emprise au sol, retraits, stationnement, OAP — ne sont pas disponibles ici\./);
  na.match(note_repli, /joindre le PDF du règlement au chat .*jusqu'à 50 Mo.* ou l'importer sur la page Foncier de Mimmoza\.$/);
  na.equal(/Géoportail/.test(textesRepliZonageSeul(false).note_repli), false);
});

Deno.test('la consigne reste transmise au modèle, dans un champ à part', () => {
  const avec = textesRepliZonageSeul(true), sans = textesRepliZonageSeul(false);
  for (const { consignes } of [avec, sans]) {
    na.match(consignes, /ne les invente sous aucun prétexte/);
    na.match(consignes, /Dis à l'utilisateur que pour les obtenir il peut joindre le PDF du règlement au chat/);
  }
  na.match(avec.consignes, /lecture_reglement_gpu/);
  na.equal(/lecture_reglement_gpu/.test(sans.consignes), false);
});
