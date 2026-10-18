const CACHE_NAME = 'fz-board-tda-v1';

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
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.claim();
});

// Estrategia de intercepción: Red primero, respaldo en caché y guardado dinámico
self.addEventListener('fetch', (event) => {
    // Solo manejamos peticiones GET
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Si la respuesta es válida, clonamos y guardamos en caché dinámicamente
                // (Esto atrapará las subwebs, scripts, iconos o estilos nuevos conforme los visites)
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // Si no hay conexión a internet, buscamos en el caché local
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Opcional: Podrías retornar una página offline genérica si el recurso no está cacheado
                });
            })
    );
});
