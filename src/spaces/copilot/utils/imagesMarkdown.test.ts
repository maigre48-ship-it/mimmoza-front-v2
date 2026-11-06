// LOT E1-suivi — Images Markdown dans les réponses du chat.
// Constat du 05/11/2026 : « ![Vue 3/4 gauche](https://…/sign/studio-rendus/…) » s'affichait
// « !Vue 3/4 gauche » (le rendu ne connaissait que les liens). URL SYNTHÉTIQUES.
import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownToSafeHtml } from './exportCopilotPdf.ts';
import { htmlLisible } from './lisibilite.ts';
import { urlImageAutorisee } from './imagesMarkdown.ts';

const SIGNEE = 'https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/sign/studio-rendus/u1/j1/vue_trois_quarts_gauche.jpg?token=eyJhbGciOi__x.y__z';

test('urlImageAutorisee : seulement le stockage https du projet (objet signé ou public)', () => {
  assert.equal(urlImageAutorisee(SIGNEE), true);
  assert.equal(urlImageAutorisee('https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/public/visites/abc12345/pano-1.jpg'), true);
  for (const refusee of [
    'http://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/sign/studio-rendus/a.jpg?token=t',
    'https://fwvrqngbafqdaekbdfnm.supabase.co.evil.fr/storage/v1/object/sign/studio-rendus/a.jpg',
    'https://evil.fr/storage/v1/object/sign/studio-rendus/a.jpg',
    'https://x.supabase.co/storage/v1/object/sign/studio-rendus/a.jpg',
    'https://user:mdp@fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/sign/studio-rendus/a.jpg',
    'https://fwvrqngbafqdaekbdfnm.supabase.co:8443/storage/v1/object/sign/studio-rendus/a.jpg',
    'https://fwvrqngbafqdaekbdfnm.supabase.co/rest/v1/studio_jobs',
    'https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/sign/',
    'https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/sign/%2e%2e/auth',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/sign/a.jpg" onerror="alert(1)',
  ]) assert.equal(urlImageAutorisee(refusee), false, refusee);
});

test('image Markdown du stockage du projet → <img> affichée, plus de « ! » seul, URL intacte (jeton avec « __ »)', () => {
  const html = markdownToSafeHtml(`Voici vos images :\n\n![Vue 3/4 gauche](${SIGNEE})`);
  assert.match(html, /<img src="https:\/\/fwvrqngbafqdaekbdfnm\.supabase\.co\/storage\/v1\/object\/sign\/studio-rendus\/u1\/j1\/vue_trois_quarts_gauche\.jpg\?token=eyJhbGciOi__x\.y__z" alt="Vue 3\/4 gauche"/);
  assert.doesNotMatch(html, /!<a|!Vue/);
  assert.doesNotMatch(html, /<strong>/, 'les « __ » du jeton ne deviennent plus du gras');
});

test('image d’un autre domaine → simple lien portant le texte alternatif (aucune <img>)', () => {
  const html = markdownToSafeHtml('![Plan](https://exemple.fr/plan.png)');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<a href="https:\/\/exemple\.fr\/plan\.png"[^>]*>Plan<\/a>/);
  assert.doesNotMatch(html, />!|^<p[^>]*>!/);
});

test('image : texte alternatif et URL échappés (aucune injection)', () => {
  const html = markdownToSafeHtml(`![Vue "x" <script>alert(1)</script>](${SIGNEE})`);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /alt="Vue &quot;x&quot; &lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  const piege = markdownToSafeHtml('![x](https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/sign/a.jpg"onerror="alert(1))');
  assert.doesNotMatch(piege, /<img/);
  assert.doesNotMatch(piege, /\sonerror=/);
});

test('les liens restent inchangés (gras dans le texte du lien, jeton avec « __ » intact)', () => {
  assert.equal(
    markdownToSafeHtml('Voir [la **fiche**](https://exemple.fr/a) et **ceci**.'),
    '<p style="margin:0 0 8px 0;">Voir <a href="https://exemple.fr/a" target="_blank" rel="noopener noreferrer" style="color:#4f46e5;text-decoration:underline;">la <strong>fiche</strong></a> et <strong>ceci</strong>.</p>',
  );
  assert.match(markdownToSafeHtml(`[Le film](${SIGNEE})`), /href="[^"]*token=eyJhbGciOi__x\.y__z"/);
});

test('rendu du chat complet (mettreEnForme + Markdown) : trois vues en liste → trois images', () => {
  const md = [
    'Votre rendu est prêt.',
    '',
    `- ![Vue 3/4 gauche](${SIGNEE})`,
    `- ![Vue 3/4 droite](${SIGNEE.replace('gauche', 'droite')})`,
    `- ![Face](${SIGNEE.replace('trois_quarts_gauche', 'face')})`,
  ].join('\n');
  const html = htmlLisible(md, markdownToSafeHtml, { reponseDabord: true });
  assert.equal((html.match(/<img /g) ?? []).length, 3);
  assert.doesNotMatch(html, /!</);
});
