import { assertEquals, assert } from 'jsr:@std/assert@1';
import { APP_ROUTES, findRoute, isKnownRoute, routeCatalogue, routeLabel } from './routes.ts';

Deno.test('/mimmozia est une route connue de l’espace commun', () => {
  assert(isKnownRoute('/mimmozia'));
  assert(isKnownRoute('/mimmozia/'));
  const route = findRoute('/mimmozia');
  assertEquals(route?.space, 'commun');
  assertEquals(routeLabel('/mimmozia'), 'MimmozIA');
  assert(route?.hint.includes('assistant'));
  assert(!route?.requiresStudy);
});

Deno.test('le catalogue propose /mimmozia avec son hint', () => {
  const catalogue = routeCatalogue();
  const line = catalogue.split('\n').find((l) => l.trim().startsWith('/mimmozia '));
  assert(line, 'ligne /mimmozia absente du catalogue');
  assert(line.includes('MimmozIA'));
  assert(!line.includes('[exige une étude active]'));
});

Deno.test('le catalogue liste chaque route une seule fois', () => {
  const paths = APP_ROUTES.map((r) => r.path);
  assertEquals(new Set(paths).size, paths.length);
  const catalogue = routeCatalogue();
  for (const path of paths) assert(catalogue.includes(`  ${path} — `), path);
});

Deno.test('une route inventée reste refusée', () => {
  assert(!isKnownRoute('/mimmozia/studio'));
  assertEquals(findRoute('/studio'), null);
});
