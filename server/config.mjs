import { fileURLToPath } from 'node:url';

export function readConfig(env = process.env) {
  const upstream = env.TESLAMATE_API_URL?.trim() || '';
  const appToken = env.APP_ACCESS_TOKEN || '';
  const authorization = env.UPSTREAM_AUTHORIZATION || '';
  const geocoderUrl = env.GEOCODER_URL?.trim() || '';
  const tencentMapKey = env.TENCENT_MAP_KEY?.trim() || '';
  const tencentMapSecret = env.TENCENT_MAP_SECRET?.trim() || '';
  const carId = Number(env.CAR_ID || '1');
  const port = Number(env.PORT || '8776');
  if (!Number.isSafeInteger(carId) || carId < 1) throw new Error('CAR_ID 必须为正整数');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效');
  if (/[\r\n]/.test(authorization)) throw new Error('UPSTREAM_AUTHORIZATION 无效');
  if (tencentMapKey && !/^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){5}$/.test(tencentMapKey)) throw new Error('TENCENT_MAP_KEY 格式无效');
  if (tencentMapKey && !/^[A-Za-z0-9]{32}$/.test(tencentMapSecret)) throw new Error('启用腾讯地图须配置有效的 TENCENT_MAP_SECRET（签名校验 SK）');
  if (geocoderUrl) {
    let url;
    try { url = new URL(geocoderUrl); } catch { throw new Error('GEOCODER_URL 无效'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('GEOCODER_URL 须为不含凭据和路径的 HTTPS 根地址');
    }
  }
  if (upstream) {
    let url;
    try { url = new URL(upstream); } catch { throw new Error('TESLAMATE_API_URL 无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('TESLAMATE_API_URL 须为不含凭据和路径的 HTTP(S) 根地址');
    }
    if (appToken.length < 32 || /[\r\n]/.test(appToken)) throw new Error('真实模式必须设置至少 32 位 APP_ACCESS_TOKEN');
  }
  return {
    upstream: upstream ? new URL(upstream).origin : '', appToken, authorization, carId, geocoderUrl, tencentMapKey, tencentMapSecret,
    host: env.HOST || '127.0.0.1', port,
    staticDir: fileURLToPath(new URL('../dist/build/h5/', import.meta.url))
  };
}
