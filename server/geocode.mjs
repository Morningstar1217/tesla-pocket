const text = value => typeof value === 'string' ? value.trim() : '';

export function createGeocoder(url, fetcher = globalThis.fetch, now = Date.now) {
  const cache = new Map();
  let pending = null;
  let nextRequestAt = 0;
  return async (latitude, longitude) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return null;
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const saved = cache.get(key);
    if (saved?.expiresAt > now()) return saved.label;
    if (pending) return pending.key === key ? pending.promise : null;
    if (now() < nextRequestAt) return null;
    nextRequestAt = now() + 10000;
    const lookup = async () => {
      let label = null;
      try {
        const endpoint = new URL('/reverse', url);
        endpoint.search = new URLSearchParams({ lat: String(latitude), lon: String(longitude), radius: '0.2', limit: '1' }).toString();
        const response = await fetcher(endpoint, {
          method: 'GET', redirect: 'error', signal: AbortSignal.timeout(3500),
          headers: { Accept: 'application/json', 'User-Agent': 'TeslaPocket/1.0 (personal vehicle dashboard)' }
        });
        if (response.ok) {
          const result = await response.json();
          const p = result?.features?.[0]?.properties;
          if (p && typeof p === 'object' && !Array.isArray(p)) {
            const parts = [p.state, p.city || p.county, p.district, p.street, p.housenumber, p.name].map(text).filter(Boolean);
            if (parts.length) label = `${[...new Set(parts)].join(' ')} 附近`.slice(0, 180);
          }
        }
      } catch { /* 地址服务故障不能中断车辆数据读取。 */ }
      cache.set(key, { label, expiresAt: now() + (label ? 86400000 : 60000) });
      if (cache.size > 128) cache.delete(cache.keys().next().value);
      return label;
    };
    pending = { key, promise: lookup() };
    try { return await pending.promise; }
    finally { pending = null; }
  };
}
