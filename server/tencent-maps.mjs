const validPoint = point => point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
  Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180 && (point.latitude !== 0 || point.longitude !== 0);
const coordinate = point => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
const text = value => typeof value === 'string' ? value.trim() : '';
const unavailable = () => Object.assign(new Error('腾讯地图暂不可用，请检查服务配置、额度和网络。'), { status: 502 });

// Preserve bends before reducing the route to fit bounded coordinate-conversion requests.
export function simplifyRoute(points) {
  const limit = 120;
  const route = points.filter(validPoint);
  if (route.length <= limit) return route;
  let tolerance = 0.00002, result;
  do {
    const keep = new Set([0, route.length - 1]), segments = [[0, route.length - 1]];
    while (segments.length) {
      const [first, last] = segments.pop(), a = route[first], b = route[last];
      const dx = b.longitude - a.longitude, dy = b.latitude - a.latitude, length = dx * dx + dy * dy;
      let furthest = -1, distance = tolerance * tolerance;
      for (let i = first + 1; i < last; i++) {
        const p = route[i];
        const t = length ? Math.max(0, Math.min(1, ((p.longitude - a.longitude) * dx + (p.latitude - a.latitude) * dy) / length)) : 0;
        const squared = (p.longitude - a.longitude - t * dx) ** 2 + (p.latitude - a.latitude - t * dy) ** 2;
        if (squared > distance) { furthest = i; distance = squared; }
      }
      if (furthest !== -1) { keep.add(furthest); segments.push([first, furthest], [furthest, last]); }
    }
    result = [...keep].sort((a, b) => a - b).map(index => route[index]);
    tolerance *= 2;
  } while (result.length > limit);
  return result;
}

export function createTencentMaps(key, secret, fetcher = globalThis.fetch, now = Date.now) {
  const cache = new Map();
  let nextRequestAt = 0;
  async function memo(id, load) {
    const saved = cache.get(id);
    if (saved?.expiresAt > now()) return saved.promise;
    const entry = { promise: Promise.resolve().then(load), expiresAt: now() + 86400000 };
    cache.delete(id);
    cache.set(id, entry);
    if (cache.size > 128) cache.delete(cache.keys().next().value);
    try { return await entry.promise; }
    catch (error) { if (cache.get(id) === entry) cache.delete(id); throw error; }
  }
  async function get(path, params) {
    const delay = Math.max(0, nextRequestAt - now());
    nextRequestAt = Math.max(nextRequestAt, now()) + 250;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const url = new URL(path, 'https://apis.map.qq.com');
    const search = new URLSearchParams({ key });
    for (const [name, values] of Object.entries(params)) {
      for (const value of Array.isArray(values) ? values : [values]) search.append(name, value);
    }
    search.sort();
    const rawQuery = [...search].map(([name, value]) => `${name}=${value}`).join('&');
    search.set('sig', createHash('md5').update(`${path}?${rawQuery}${secret}`).digest('hex'));
    url.search = search.toString();
    try {
      const response = await fetcher(url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json', 'x-legacy-url-decode': 'no' },
      });
      if (!response.ok) throw unavailable();
      return response;
    } catch { throw unavailable(); }
  }
  async function json(path, params) {
    try {
      const value = await (await get(path, params)).json();
      if (value?.status !== 0) throw unavailable();
      return value;
    } catch { throw unavailable(); }
  }
  async function convert(points) {
    const result = [];
    for (let start = 0; start < points.length; start += 40) {
      const batch = points.slice(start, start + 40);
      const value = await json('/ws/coord/v1/translate', { locations: batch.map(coordinate).join(';'), type: '1' });
      const converted = Array.isArray(value.locations) ? value.locations.map(point => ({ longitude: point.lng, latitude: point.lat })) : [];
      if (converted.length !== batch.length || !converted.every(validPoint)) throw unavailable();
      result.push(...converted);
    }
    return result;
  }
  async function reverse(point) {
    return memo(`address:${coordinate(point)}`, async () => {
      const value = await json('/ws/geocoder/v1/', { location: coordinate(point), get_poi: '1', poi_options: 'radius=100;policy=1;orderby=_distance' });
      const address = value.result;
      const label = text(address?.address);
      if (!label) return null;
      const recommendation = text(address.formatted_addresses?.recommend);
      if (recommendation && !label.includes(recommendation)) return `${label} · ${recommendation}`;
      const nearby = (Array.isArray(address.pois) ? address.pois : [])
        .filter(poi => text(poi.title) && ['number', 'string'].includes(typeof poi._distance) && String(poi._distance).trim() && Number.isFinite(Number(poi._distance)) && Number(poi._distance) >= 0 && Number(poi._distance) <= 100)
        .sort((a, b) => Number(a._distance) - Number(b._distance))[0];
      return nearby && !label.includes(nearby.title) ? `${label} · ${nearby.title}附近` : label;
    });
  }
  async function locations(trip) {
    const points = trip.points.filter(validPoint);
    if (!points.length) return { from: trip.from, to: trip.to };
    try {
      return await memo(`trip:${trip.id}:${trip.startedAt}:${coordinate(points[0])}:${coordinate(points.at(-1))}`, async () => {
        const endpoints = await convert([points[0], points.at(-1)]);
        const labels = await Promise.all(endpoints.map(reverse));
        const combine = (original, label) => {
          if (!label) return original;
          const name = original.split(/[,，]/)[0].trim();
          return !name || label.includes(name) || /[省市区县镇乡]$/.test(name) ? label : `${name} · ${label}`;
        };
        return { from: combine(trip.from, labels[0]), to: combine(trip.to, labels[1]) };
      });
    } catch { return { from: trip.from, to: trip.to }; }
  }
  async function map(trip) {
    const points = simplifyRoute(trip.points);
    if (points.length < 2) throw Object.assign(new Error('暂无足够的轨迹坐标'), { status: 404 });
    return memo(`map:${trip.id}:${trip.startedAt}`, async () => {
      const converted = await convert(points);
      const response = await get('/ws/staticmap/v2/', {
        size: '750*480', scale: '2', format: 'png',
        markers: `size:mid|color:blue|${coordinate(converted[0])}|${coordinate(converted.at(-1))}`,
        labels: `size:18|color:0xffffff|bgcolor:0x168b75|anchor:3|offset:0_-26|起点|${coordinate(converted[0])}|终点|${coordinate(converted.at(-1))}`,
        path: `color:0x168B7500|weight:5|${converted.map(coordinate).join('|')}`,
      });
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) throw unavailable();
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 4 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw unavailable();
      return { image: `data:image/png;base64,${bytes.toString('base64')}`, sampled: points.length < trip.points.length };
    });
  }
  return { locations, map };
}
import { createHash } from 'node:crypto';
