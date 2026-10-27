// Service worker minimal : rend la télécommande installable (HTTPS requis). Aucune donnée n'est mise en cache :
// l'état de la soirée et les commandes passent toujours par le réseau.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
