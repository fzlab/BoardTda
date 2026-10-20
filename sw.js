const CACHE_NAME = 'fz-board-tda-v1.6.9'; // 

// Archivos esenciales del núcleo que se precargan al instalar
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json'
];

// Instalación del Service Worker y almacenamiento de archivos base
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
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

    // REGLA ESPECIAL PARA HTML / NAVEGACIÓN: Forzar red para evitar contenido atrapado
    if (event.request.mode === 'navigate' || event.request.headers.get('accept').includes('text/html')) {
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
                    // Si no hay red, recurrimos al caché local
                    return caches.match(event.request).then((cachedResponse) => {
                        return cachedResponse || caches.match('./index.html');
                    });
                })
        );
        return;
    }

    // Para el resto de recursos (CSS, JS, imágenes, etc.): Red primero con respaldo dinámico
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
                return caches.match(event.request);
            })
    );
});
