// Service worker Mimmoza — volontairement minimal.
//
// Son seul role : rendre l'application installable et afficher une page de
// secours quand une navigation echoue faute de reseau.
//
// Ce qu'il ne fait PAS, par conception :
//   - aucune mise en cache des reponses reseau (ni pages, ni API, ni Supabase,
//     ni assets) : le seul contenu stocke est /offline.html, statique et sans
//     donnee utilisateur, pose a l'installation ;
//   - aucune interception hors navigations de meme origine : les appels API,
//     Supabase et toute requete portant un jeton passent directement par le
//     navigateur, sans passer par ce fichier.

const OFFLINE_CACHE = "mimmoza-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("mimmoza-") && key !== OFFLINE_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Tout ce qui n'est pas une navigation GET de meme origine est laisse au
  // navigateur : pas de respondWith, donc ni interception ni cache.
  if (request.mode !== "navigate" || request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Une requete emise depuis un service worker ne peut pas afficher
        // l'invite d'authentification HTTP (previews protegees par Basic
        // Auth). On se desinscrit pour que la navigation suivante reparte
        // directement du navigateur, qui saura la presenter.
        if (response.status === 401 && response.headers.has("WWW-Authenticate")) {
          self.registration.unregister();
        }
        // Reponse reseau rendue telle quelle, jamais stockee — erreurs HTTP
        // comprises : un 4xx/5xx n'est pas une absence de reseau.
        return response;
      })
      .catch(async () => {
        // fetch() ne rejette que si le reseau est injoignable.
        const cache = await caches.open(OFFLINE_CACHE);
        const offline = await cache.match(OFFLINE_URL);
        return offline ?? Response.error();
      })
  );
});
