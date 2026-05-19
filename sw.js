/* =====================================================
   Service Worker — نظام إدارة الصيانة
   استراتيجية: Cache Shell + Network First للبيانات
   ===================================================== */

const CACHE_NAME     = 'maintenance-app-v1';
const OFFLINE_URL    = './index.html';

// الملفات التي تُخزَّن فور التثبيت (App Shell)
const SHELL_URLS = [
    './index.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

// المصادر الخارجية التي تُخزَّن عند أول طلب
const CDN_PATTERNS = [
    'cdn.tailwindcss.com',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
    'unpkg.com',
];

// ─── تثبيت: خزّن الـ Shell ───────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_URLS))
            .then(() => self.skipWaiting())
    );
});

// ─── تفعيل: احذف الكاشات القديمة ────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// ─── الطلبات: استراتيجية مختلطة ──────────────────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Supabase API → Network Only (البيانات يجب أن تكون حية)
    if (url.hostname.includes('supabase.co')) {
        event.respondWith(fetch(event.request).catch(() =>
            new Response(JSON.stringify({ error: 'لا يوجد اتصال بالإنترنت' }),
                { headers: { 'Content-Type': 'application/json' } })
        ));
        return;
    }

    // CDN (Tailwind, FontAwesome, ...) → Cache First
    if (CDN_PATTERNS.some(p => url.hostname.includes(p))) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                    }
                    return response;
                }).catch(() => cached || new Response('', { status: 503 }));
            })
        );
        return;
    }

    // الملفات المحلية → Cache First مع Fallback للصفحة الرئيسية
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                }
                return response;
            }).catch(() =>
                // إذا كانت صفحة HTML → اعرض الصفحة الرئيسية المخزنة
                event.request.destination === 'document'
                    ? caches.match(OFFLINE_URL)
                    : new Response('', { status: 503 })
            );
        })
    );
});

// ─── رسائل من الصفحة ─────────────────────────────────
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
    if (event.data === 'CLEAR_CACHE') {
        caches.delete(CACHE_NAME).then(() =>
            console.log('[SW] Cache cleared')
        );
    }
});

// ─── النقر على إشعار المتصفح ──────────────────────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                // إذا كان التطبيق مفتوحاً في تاب — ركّز عليه
                for (const client of clientList) {
                    if ('focus' in client) return client.focus();
                }
                // وإلا افتح نافذة جديدة
                return clients.openWindow(event.notification.data?.url || './');
            })
    );
});
