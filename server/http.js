// =====================================================================
//  Мини-фреймворк поверх встроенного node:http:
//  маршруты с параметрами (/api/movies/:id), JSON, cookie, статика.
// =====================================================================
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

export class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

export class Router {
    routes = [];
    add(method, path, ...handlers) {
        const keys = [];
        const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
        this.routes.push({ method, re, keys, handlers });
    }
    get(p, ...h) { this.add('GET', p, ...h); }
    post(p, ...h) { this.add('POST', p, ...h); }
    put(p, ...h) { this.add('PUT', p, ...h); }
    delete(p, ...h) { this.add('DELETE', p, ...h); }

    match(method, pathname) {
        for (const r of this.routes) {
            if (r.method !== method) continue;
            const m = pathname.match(r.re);
            if (m) return { handlers: r.handlers, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
        }
        return null;
    }
}

function parseCookies(header = '') {
    return Object.fromEntries(header.split(';').map(c => c.trim().split('=')).filter(p => p[0])
        .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
        size += c.length;
        if (size > 1_000_000) throw new HttpError(413, 'Слишком большой запрос');
        chunks.push(c);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(400, 'Некорректный JSON'); }
}

// Расширяем ответ удобными методами
function decorate(res) {
    res.json = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(data));
    };
    res.send = (body, type = 'text/plain; charset=utf-8', status = 200) => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(body);
    };
    res.cookies = [];
    res.setCookie = (name, value, { maxAge, httpOnly = true } = {}) => {
        let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
        if (httpOnly) c += '; HttpOnly';
        if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
        res.cookies.push(c);
        res.setHeader('Set-Cookie', res.cookies);
    };
}

function serveStatic(root, pathname, res) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep) && file !== root) return false;   // защита от ../
    let st;
    try { st = statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
    });
    createReadStream(file).pipe(res);
    return true;
}

export function createHandler(router, publicDir) {
    return async (req, res) => {
        decorate(res);
        const url = new URL(req.url, 'http://localhost');
        req.query = Object.fromEntries(url.searchParams);
        req.cookies = parseCookies(req.headers.cookie);
        try {
            if (url.pathname.startsWith('/api/')) {
                const route = router.match(req.method, url.pathname);
                if (!route) throw new HttpError(404, 'Метод API не найден');
                req.params = route.params;
                req.body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
                for (const h of route.handlers) {
                    await h(req, res);
                    if (res.writableEnded) return;
                }
                return;
            }
            if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
            if (serveStatic(publicDir, url.pathname, res)) return;
            if (!extname(url.pathname) && serveStatic(publicDir, url.pathname + '.html', res)) return;
            res.writeHead(404, { 'Content-Type': MIME['.html'] });
            createReadStream(join(publicDir, '404.html')).on('error', () => res.end('404')).pipe(res);
        } catch (err) {
            const status = err.status || (String(err.message).includes('UNIQUE') ? 409 : 500);
            if (status === 500) console.error(err);
            if (!res.headersSent) res.json({ error: status === 500 ? 'Внутренняя ошибка сервера' : err.message }, status);
            else res.end();
        }
    };
}
