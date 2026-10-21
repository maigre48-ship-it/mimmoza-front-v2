import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOURNISSEUR, LIMITES, TARIFS_STUDIO, construireRequeteFournisseur, corpsMaxPour, enTetesCors, estActive,
  extraireReponse, interpreterDebit, modeleFixe, parseOriginesAutorisees, resoudreAction, suivreDebit, tarifPour,
  validerPlan, validerPlanImage,
} from './policy.ts';

const base64 = (octets: number[], longueur = 24) =>
  btoa(String.fromCharCode(...octets, ...new Array(Math.max(0, longueur - octets.length)).fill(0)));
const PNG = base64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = base64([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = base64([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

const erreur = (v: { ok: boolean; erreur?: string }) => (v.ok ? null : v.erreur);

test('activation : seule la valeur exacte « 1 » allume la fonction', () => {
  assert.equal(estActive('1'), true);
  for (const v of [undefined, null, '', '0', 'true', ' 1', '1 ']) assert.equal(estActive(v), false);
});

test('CORS : la liste ne retient que des origines exactes, sans joker', () => {
  assert.deepEqual(
    parseOriginesAutorisees('https://studio.mimmoza.fr, https://studio.mimmoza.fr/ http://localhost:5173'),
    ['https://studio.mimmoza.fr', 'http://localhost:5173'],
  );
  for (const invalide of [undefined, '', '*', 'https://*.mimmoza.fr', 'http://studio.mimmoza.fr', 'studio.mimmoza.fr',
    'https://studio.mimmoza.fr/app', 'null', 'https://STUDIO.mimmoza.fr']) {
    assert.deepEqual(parseOriginesAutorisees(invalide), [], String(invalide));
  }
});

test('CORS : fail-closed sur origine absente, inconnue ou approchante', () => {
  const autorisees = parseOriginesAutorisees('https://studio.mimmoza.fr');
  const entetes = enTetesCors('https://studio.mimmoza.fr', autorisees);
  assert.equal(entetes?.['Access-Control-Allow-Origin'], 'https://studio.mimmoza.fr');
  assert.equal(entetes?.Vary, 'Origin');
  assert.equal(entetes?.['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  assert.ok(!('Access-Control-Allow-Credentials' in entetes!));

  for (const origine of [null, undefined, '', 'null', '*', 'https://studio.mimmoza.fr.evil.example', 'https://evil.example',
    'http://studio.mimmoza.fr', 'https://studio.mimmoza.fr:8443', 'https://Studio.mimmoza.fr', 'https://studio.mimmoza.fr/']) {
    assert.equal(enTetesCors(origine, autorisees), null, String(origine));
  }
  // Liste vide (variable absente) : personne ne passe.
  assert.equal(enTetesCors('https://studio.mimmoza.fr', parseOriginesAutorisees(undefined)), null);
});

test("routage : l'action vient du chemin ou de ?action=, rien d'autre", () => {
  assert.equal(resoudreAction('https://x.supabase.co/functions/v1/studio-ai/plan'), 'plan');
  assert.equal(resoudreAction('https://x.supabase.co/functions/v1/studio-ai/plan-image/'), 'plan-image');
  assert.equal(resoudreAction('https://x.supabase.co/functions/v1/studio-ai?action=plan-image'), 'plan-image');
  assert.equal(resoudreAction('https://x.supabase.co/functions/v1/studio-ai'), null);
  assert.equal(resoudreAction('https://x.supabase.co/functions/v1/studio-ai/image'), null);
  assert.equal(resoudreAction('https://x.supabase.co/functions/v1/studio-ai?action=render'), null);
  assert.equal(resoudreAction('pas une url'), null);
});

test('tarification : coûts fixes côté serveur, 1 jeton le plan et 3 la lecture image', () => {
  assert.deepEqual(TARIFS_STUDIO, { plan: 1, 'plan-image': 3 });
  assert.deepEqual(tarifPour('plan'), { montant: 1, type: 'studio_ai_plan', description: 'Studio — génération de plan IA' });
  assert.equal(tarifPour('plan-image').montant, 3);
  assert.equal(tarifPour('plan-image').type, 'studio_ai_plan_image');
  assert.ok(corpsMaxPour('plan') < corpsMaxPour('plan-image'));
  assert.ok(corpsMaxPour('plan-image') > LIMITES.imageBase64Max);
});

test('image : borne à 10 Mo encodés, corps HTTP dimensionné autour', () => {
  // Limite du fournisseur sur son API directe : 10 Mo de base64 par image.
  assert.equal(LIMITES.imageBase64Max, 10_000_000);
  assert.equal(LIMITES.imageBase64Max % 4, 0);
  // Le corps laisse passer l'image maximale et une consigne pleine échappée en \uXXXX…
  assert.ok(corpsMaxPour('plan-image') >= LIMITES.imageBase64Max + LIMITES.texteMax * 6);
  // … sans rouvrir de marge au-delà de l'enveloppe.
  assert.ok(corpsMaxPour('plan-image') <= LIMITES.imageBase64Max + 512 * 1024);
});

test("débit : seul un retour sans erreur de la RPC vaut prélèvement", () => {
  assert.deepEqual(interpreterDebit(null, 3), { preleve: true });
  assert.deepEqual(interpreterDebit(undefined, 3), { preleve: true });

  assert.deepEqual(interpreterDebit({ message: 'no_tokens' }, 3),
    { preleve: false, code: 'NO_TOKENS', message: 'Solde insuffisant : 3 jetons requis.', statusCode: 402 });
  const sansCompte = interpreterDebit({ message: 'P0001: NO_ACCOUNT' }, 1);
  assert.equal(sansCompte.preleve, false);
  assert.deepEqual([sansCompte.preleve === false && sansCompte.code, sansCompte.preleve === false && sansCompte.statusCode], ['NO_ACCOUNT', 402]);

  // Erreur transitoire, garde service_role, erreur sans message : rien de prélevé, 500.
  for (const e of [{ message: 'fetch failed' }, { message: 'FORBIDDEN_CLIENT_CALL' }, { message: null }, {}]) {
    const issue = interpreterDebit(e, 1);
    assert.equal(issue.preleve, false, JSON.stringify(e));
    assert.equal(issue.preleve === false && issue.code, 'BILLING_UNAVAILABLE');
    assert.equal(issue.preleve === false && issue.statusCode, 500);
    // Le message brut de la base ne remonte jamais au client.
    assert.equal(issue.preleve === false && issue.message, 'Facturation indisponible.');
  }
});

test('remboursement : rien à rendre sans débit confirmé (administrateur, débit refusé)', async () => {
  const suivi = suivreDebit();
  let appels = 0;
  const rendre = async () => { appels++; return true; };
  assert.equal(await suivi.rembourserUneFois(rendre), 'non_preleve');
  assert.equal(await suivi.rembourserUneFois(rendre), 'non_preleve');
  assert.equal(appels, 0);
  assert.equal(suivi.etat, 'non_preleve');
});

test('remboursement : une seule fois après débit confirmé, même sur échecs en cascade', async () => {
  const suivi = suivreDebit();
  suivi.confirmer();
  assert.equal(suivi.etat, 'preleve');
  let appels = 0;
  const rendre = async () => { appels++; return true; };
  // Échec fournisseur, puis exception inattendue rattrapée plus haut.
  assert.equal(await suivi.rembourserUneFois(rendre), 'rembourse');
  assert.equal(await suivi.rembourserUneFois(rendre), 'rembourse');
  // Une confirmation tardive ne rouvre pas le remboursement.
  suivi.confirmer();
  assert.equal(await suivi.rembourserUneFois(rendre), 'rembourse');
  assert.equal(appels, 1);
});

test('remboursement : un échec (false, exception, valeur floue) est définitif, sans second essai', async () => {
  const echecs: Array<() => Promise<boolean>> = [
    async () => false,
    async () => { throw new Error('rpc'); },
    () => { throw new Error('synchrone'); },
    async () => 1 as unknown as boolean,
  ];
  for (const rendre of echecs) {
    const suivi = suivreDebit();
    suivi.confirmer();
    let appels = 0;
    const compte = () => { appels++; return rendre(); };
    assert.equal(await suivi.rembourserUneFois(compte), 'remboursement_echoue');
    assert.equal(await suivi.rembourserUneFois(async () => { appels++; return true; }), 'remboursement_echoue');
    assert.equal(appels, 1);
  }
});

test('remboursement : deux échecs simultanés ne déclenchent qu\'un seul appel', async () => {
  const suivi = suivreDebit();
  suivi.confirmer();
  let appels = 0;
  let liberer!: (v: boolean) => void;
  const rendre = () => { appels++; return new Promise<boolean>((r) => { liberer = r; }); };
  const premier = suivi.rembourserUneFois(rendre);
  // Pendant que le premier attend la RPC, le second ne doit rien relancer.
  assert.equal(await suivi.rembourserUneFois(rendre), 'remboursement_echoue');
  liberer(true);
  assert.equal(await premier, 'rembourse');
  assert.equal(appels, 1);
});

test('plan : contrat {system, messages} accepté', () => {
  const v = validerPlan({ system: 'Tu es architecte.', messages: [
    { role: 'user', content: 'Un T3 de 65 m².' }, { role: 'assistant', content: 'Voici.' }, { role: 'user', content: 'Ajoute un cellier.' },
  ] });
  assert.ok(v.ok);
  assert.equal(v.valeur.messages.length, 3);
  assert.ok(validerPlan({ messages: [{ role: 'user', content: 'Sans system.' }] }).ok);
});

test('plan : champs hors contrat, rôles et contenus non textuels refusés', () => {
  const messages = [{ role: 'user', content: 'Bonjour' }];
  for (const cle of ['model', 'max_tokens', 'tools', 'temperature', 'imageUrl', 'stream']) {
    assert.equal(erreur(validerPlan({ system: '', messages, [cle]: 1 })), 'CHAMP_INTERDIT', cle);
  }
  assert.equal(erreur(validerPlan(null)), 'CORPS_INVALIDE');
  assert.equal(erreur(validerPlan([])), 'CORPS_INVALIDE');
  assert.equal(erreur(validerPlan({ system: 42, messages })), 'SYSTEM_INVALIDE');
  for (const invalides of [undefined, [], 'texte', [{ role: 'system', content: 'x' }], [{ role: 'user', content: '   ' }],
    [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://evil.example/a.png' } }] }],
    [{ role: 'user', content: 'x', name: 'y' }], [{ role: 'assistant', content: 'x' }],
    [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'préremplissage' }]]) {
    assert.equal(erreur(validerPlan({ system: '', messages: invalides })), 'MESSAGES_INVALIDES', JSON.stringify(invalides));
  }
});

test('plan : bornes de 24 messages et 40 000 caractères cumulés', () => {
  const serie = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
  assert.ok(validerPlan({ system: '', messages: serie(23) }).ok);
  assert.equal(erreur(validerPlan({ system: '', messages: serie(25) })), 'TROP_DE_MESSAGES');

  const pile = { system: 'a'.repeat(20_000), messages: [{ role: 'user', content: 'b'.repeat(20_000) }] };
  assert.ok(validerPlan(pile).ok);
  assert.equal(erreur(validerPlan({ ...pile, system: 'a'.repeat(20_001) })), 'TEXTE_TROP_LONG');
});

test('plan-image : jpg, png et webp acceptés, type annoncé vérifié sur les octets', () => {
  assert.ok(validerPlanImage({ consigne: 'Relève les pièces.', imageBase64: PNG, mediaType: 'image/png' }).ok);
  assert.ok(validerPlanImage({ consigne: 'Relève les pièces.', imageBase64: WEBP, mediaType: 'image/webp' }).ok);
  const jpg = validerPlanImage({ consigne: 'Relève les pièces.', imageBase64: JPEG, mediaType: 'image/jpg' });
  assert.ok(jpg.ok);
  assert.equal(jpg.valeur.mediaType, 'image/jpeg');

  assert.equal(erreur(validerPlanImage({ consigne: 'x', imageBase64: PNG, mediaType: 'image/jpeg' })), 'IMAGE_INVALIDE');
  for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', '', undefined, 7]) {
    assert.equal(erreur(validerPlanImage({ consigne: 'x', imageBase64: PNG, mediaType: type })), 'TYPE_IMAGE_REFUSE', String(type));
  }
});

test('plan-image : ni URL, ni data URL, ni champ hors contrat, ni dépassement', () => {
  const ok = { consigne: 'Relève les pièces.', imageBase64: PNG, mediaType: 'image/png' };
  for (const image of ['https://evil.example/a.png', `data:image/png;base64,${PNG}`, `${PNG.slice(0, -4)} ===`, 'abc', '', 42, undefined]) {
    assert.equal(erreur(validerPlanImage({ ...ok, imageBase64: image })), 'IMAGE_INVALIDE', String(image));
  }
  for (const cle of ['imageUrl', 'model', 'max_tokens', 'system', 'messages']) {
    assert.equal(erreur(validerPlanImage({ ...ok, [cle]: 'x' })), 'CHAMP_INTERDIT', cle);
  }
  assert.equal(erreur(validerPlanImage({ ...ok, consigne: '  ' })), 'CONSIGNE_INVALIDE');
  assert.equal(erreur(validerPlanImage({ ...ok, consigne: 'c'.repeat(LIMITES.texteMax + 1) })), 'TEXTE_TROP_LONG');

  const reste = LIMITES.imageBase64Max - PNG.length;
  assert.ok(validerPlanImage({ ...ok, imageBase64: PNG + 'A'.repeat(reste) }).ok);
  assert.equal(erreur(validerPlanImage({ ...ok, imageBase64: PNG + 'A'.repeat(reste + 4) })), 'IMAGE_TROP_LOURDE');
});

test('fournisseur : modèle et max_tokens fixés par le serveur', () => {
  assert.equal(modeleFixe(undefined), FOURNISSEUR.modeleParDefaut);
  assert.equal(modeleFixe(''), FOURNISSEUR.modeleParDefaut);
  assert.equal(modeleFixe('gpt-4o'), FOURNISSEUR.modeleParDefaut);
  assert.equal(modeleFixe('claude-haiku-4-5'), 'claude-haiku-4-5');

  const plan = validerPlan({ system: 'S', messages: [{ role: 'user', content: 'Bonjour' }] });
  assert.ok(plan.ok);
  assert.deepEqual(construireRequeteFournisseur({ action: 'plan', valeur: plan.valeur }, 'claude-x'), {
    model: 'claude-x', max_tokens: FOURNISSEUR.maxTokens, system: 'S', messages: [{ role: 'user', content: 'Bonjour' }],
  });

  const image = validerPlanImage({ consigne: 'Lis', imageBase64: PNG, mediaType: 'image/png' });
  assert.ok(image.ok);
  const requete = construireRequeteFournisseur({ action: 'plan-image', valeur: image.valeur }, 'claude-x');
  assert.deepEqual(Object.keys(requete).sort(), ['max_tokens', 'messages', 'model']);
  assert.deepEqual(requete.messages, [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }, { type: 'text', text: 'Lis' },
  ] }]);
});

test('réponse : seuls le texte et le décompte de tokens sortent', () => {
  assert.deepEqual(
    extraireReponse({ id: 'msg_1', model: 'claude-x', content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: ' {"pieces":[]} ' }],
      stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 3 } }),
    { raw: '{"pieces":[]}', usage: { input_tokens: 12, output_tokens: 7 } },
  );
  assert.deepEqual(extraireReponse({ content: [{ type: 'text', text: 'ok' }] }), { raw: 'ok' });
  assert.equal(extraireReponse({ content: [] }), null);
  assert.equal(extraireReponse({ content: [{ type: 'text', text: '  ' }] }), null);
  assert.equal(extraireReponse({ content: [{ type: 'text', text: 'non' }], stop_reason: 'refusal' }), null);
  assert.equal(extraireReponse(null), null);
});
