const PUBLIC_EXACT = new Set([
  '/index.html',
  '/sw.js',
  '/manifest.json',
  '/icon.svg',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
  '/Sync-Apple-Health.shortcut',
]);

function applySecurityHeaders(headers, pathname) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  if (
    pathname === '/index.html' ||
    pathname === '/sw.js' ||
    pathname === '/manifest.json' ||
    pathname.endsWith('.shortcut')
  ) {
    headers.set('Cache-Control', 'no-cache');
  }
  if (pathname === '/Sync-Apple-Health.shortcut') {
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Disposition', 'attachment; filename="Sync-Apple-Health.shortcut"');
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const url = new URL(request.url);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!PUBLIC_EXACT.has(pathname)) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
      });
    }
    const targetUrl = new URL(pathname, url.origin);
    const assetReq = new Request(targetUrl.toString(), {
      method: request.method,
      headers: request.headers,
    });
    const assetRes = await env.ASSETS.fetch(assetReq);
    if (!assetRes || assetRes.status === 404) {
      return new Response('Not Found', { status: 404 });
    }
    const headers = new Headers(assetRes.headers);
    applySecurityHeaders(headers, pathname);
    return new Response(assetRes.body, {
      status: assetRes.status,
      statusText: assetRes.statusText,
      headers,
    });
  },
};
