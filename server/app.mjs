import { timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createDemoSnapshot } from '../shared/demo.mjs';
import { loadSnapshot, loadDetail } from './teslamate.mjs';
import { createGeocoder } from './geocode.mjs';
import { createTencentMaps } from './tencent-maps.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function allowed(header, token) {
  const actual = Buffer.from(typeof header === 'string' ? header : '');
  const expected = Buffer.from(`Bearer ${token}`);
  return token.length >= 32 && actual.length === expected.length && timingSafeEqual(actual, expected);
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

export function createHandler(config, { fetch: fetcher = globalThis.fetch } = {}) {
  if (config.upstream && (!config.appToken || config.appToken.length < 32)) throw new Error('真实模式必须配置 APP_ACCESS_TOKEN');
  const geocode = config.geocoderUrl ? createGeocoder(config.geocoderUrl, fetcher) : undefined;
  const tencentMaps = config.tencentMapKey ? createTencentMaps(config.tencentMapKey, config.tencentMapSecret, fetcher) : null;
  const tripCache = new Map();
  async function readTrip(id) {
    const saved = tripCache.get(id);
    if (saved?.expiresAt > Date.now()) return saved.promise;
    const entry = { expiresAt: Date.now() + 300000, promise: loadDetail(config, 'trips', id, fetcher) };
    tripCache.delete(id);
    tripCache.set(id, entry);
    if (tripCache.size > 32) tripCache.delete(tripCache.keys().next().value);
    try { return await entry.promise; }
    catch (error) { if (tripCache.get(id) === entry) tripCache.delete(id); throw error; }
  }
  return async (req, res) => {
    try {
      const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
      if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) {
        return json(res, 400, { error: '无效路径' });
      }
      if (pathname.startsWith('/api/')) {
        if (req.method !== 'GET') return json(res, 405, { error: '仅支持只读 GET 请求' });
        if (config.upstream && !allowed(req.headers?.authorization, config.appToken)) return json(res, 401, { error: '访问口令无效' });
        if (pathname === '/api/dashboard') return json(res, 200, config.upstream ? await loadSnapshot(config, fetcher, new Date(), geocode) : createDemoSnapshot());
        const tripResource = pathname.match(/^\/api\/trips\/([1-9]\d{0,14})\/(locations|map)$/);
        if (tripResource) {
          if (!tencentMaps || !config.upstream) return json(res, 503, { error: '尚未配置腾讯地图服务' });
          const value = await readTrip(Number(tripResource[1]));
          return json(res, 200, await tencentMaps[tripResource[2]](value));
        }
        const detail = pathname.match(/^\/api\/(trips|charges)\/([1-9]\d{0,14})$/);
        if (detail) {
          const [, kind, rawId] = detail, id = Number(rawId);
          const value = config.upstream ? kind === 'trips' ? await readTrip(id) : await loadDetail(config, kind, id, fetcher) : createDemoSnapshot()[kind].find(row => row.id === id);
          return value ? json(res, 200, value) : json(res, 404, { error: '记录不存在' });
        }
        return json(res, 404, { error: '接口不存在' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '仅支持读取' });
      const root = await realpath(config.staticDir);
      const requested = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      const file = await realpath(requested);
      if (!file.startsWith(`${root}${path.sep}`)) return json(res, 403, { error: '禁止访问' });
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const status = error instanceof URIError ? 400 : ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) || error.status === 404 ? 404 : error.status === 502 ? 502 : 500;
      const message = status === 502 ? error.message : status === 404 ? error.status === 404 ? '记录不存在或超出最近 30 天' : '页面尚未构建或文件不存在' : status === 400 ? '无效路径' : '服务暂不可用';
      json(res, status, { error: message });
    }
  };
}
