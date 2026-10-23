const CACHE_NAME = 'fz-board-tda-v1.7.4.5'; // Versión actualizada

// Todos los archivos esenciales y subwebs de la PWA que se precargan al instalar
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './corte/',
    './existencias/',
    './fases/',
    './tickets/',
    './ventas/'
];

// Instalación robusta del Service Worker (evita que un fallo de ruta tumbe toda la caché)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.allSettled(
                STATIC_ASSETS.map(asset => 
                    cache.add(asset).catch(err => console.warn(`[SW] No se pudo cachear: ${asset}`, err))
                )
            );
        })
    );
    self.skipWaiting();
});

// Activación y limpieza de cachés antiguos obsoletos
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[SW] Borrando caché antiguo:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Estrategia de intercepción mejorada
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    // REGLA ESPECIAL PARA HTML / NAVEGACIÓN: Forzar red con respaldo a caché local
    const acceptHeader = event.request.headers.get('accept') || '';
    if (event.request.mode === 'navigate' || acceptHeader.includes('text/html')) {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Si no hay red, recurrimos al caché local o al index principal
                    return caches.match(event.request).then((cachedResponse) => {
                        return cachedResponse || caches.match('./index.html') || caches.match('./');
                    });
                })
        );
        return;
    }

    // Para el resto de recursos (CDNs, CSS, JS, imágenes): Caché primero, con respaldo de red y guardado dinámico
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Si falla la red, devolvemos el caché si existía
                return cachedResponse;
            });

            return cachedResponse || fetchPromise;
        })
    );
});
