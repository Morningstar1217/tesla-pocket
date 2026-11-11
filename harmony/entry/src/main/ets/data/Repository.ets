import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { Snapshot, Settings, Trip, Charge, CostEntry, Locations, StreetMap, CONNECTION_KEY, COST_PREFIX,
  defaultSettings, validateSettings, validateSnapshot, validateTrip, validateCharge, parseCost } from './Model';

interface StoredSettings { type: string; data: Settings }
interface StoredCosts { type: string; data: Record<string, CostEntry> }

export class Repository {
  private store: preferences.Preferences;
  private demo: Snapshot | undefined = undefined;
  private context: common.UIAbilityContext;
  private requests: Set<http.HttpRequest> = new Set();

  constructor(context: common.UIAbilityContext) {
    this.context = context;
    // Same Preferences file and JSON envelope as the installed uni-app version; never clear it.
    this.store = preferences.getPreferencesSync(context, { name: 'storage.HBuilder' });
  }

  settings(): Settings {
    const raw = this.store.getSync(CONNECTION_KEY, '') as string;
    if (!raw) return defaultSettings();
    try {
      const saved = (JSON.parse(raw) as StoredSettings).data;
      if (!saved || typeof saved.baseUrl !== 'string' || typeof saved.token !== 'string') throw new Error('invalid');
      return validateSettings(saved);
    } catch { throw new Error('原有连接设置读取失败，未覆盖原数据。请检查连接后重新保存。'); }
  }

  private async write(key: string, value: string | null): Promise<void> {
    const old = this.store.getSync(key, '') as string;
    try {
      if (value === null) this.store.deleteSync(key);
      else this.store.putSync(key, value);
      await this.store.flush();
    } catch {
      if (old) this.store.putSync(key, old);
      else this.store.deleteSync(key);
      throw new Error('保存失败，请检查设备存储空间后重试。');
    }
  }

  async saveSettings(input: Settings): Promise<Settings> {
    const data = validateSettings(input);
    const stored: StoredSettings = { type: 'object', data };
    await this.write(CONNECTION_KEY, JSON.stringify(stored));
    return data;
  }

  async resetConnection(): Promise<void> { await this.write(CONNECTION_KEY, null); }

  costs(scope: string): Record<string, CostEntry> {
    const raw = this.store.getSync(COST_PREFIX + scope, '') as string;
    if (!raw) return {};
    const saved = (JSON.parse(raw) as StoredCosts).data;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('本地费用读取失败，未覆盖原数据。');
    const result: Record<string, CostEntry> = {};
    Object.keys(saved).forEach((key: string) => {
      const entry = saved[key];
      if (!entry || typeof entry.value !== 'number') return;
      try { result[key] = parseCost(String(entry.value), entry.mode); } catch { /* Ignore malformed entries as in v1.3.4. */ }
    });
    return result;
  }

  async saveCosts(scope: string, data: Record<string, CostEntry>): Promise<void> {
    const stored: StoredCosts = { type: 'object', data };
    await this.write(COST_PREFIX + scope, JSON.stringify(stored));
  }

  async request(path: string, input: Settings): Promise<string> {
    const settings = validateSettings(input);
    if (settings.mode !== 'live') throw new Error('请先连接实车');
    const task = http.createHttp();
    this.requests.add(task);
    let response: http.HttpResponse;
    try {
      response = await task.request(settings.baseUrl + path, {
        method: http.RequestMethod.GET,
        header: { Authorization: `Bearer ${settings.token}`, Accept: 'application/json' },
        expectDataType: http.HttpDataType.STRING, usingCache: false, maxRedirects: 0,
        connectTimeout: 15000, readTimeout: path.endsWith('/map') ? 25000 : 15000
      });
    } catch {
      throw new Error('连接失败，请检查网络、服务地址及 HTTPS 证书；局域网连接需处于同一 Wi-Fi');
    } finally { this.requests.delete(task); task.destroy(); }
    if (response.responseCode === 401 || response.responseCode === 403) throw new Error('连接未授权，请检查访问令牌');
    if (response.responseCode !== 200) throw new Error('服务暂不可用，请检查后端配置后重试');
    if (typeof response.result !== 'string') throw new Error('服务返回的数据格式不正确');
    return response.result;
  }

  private async demoSnapshot(): Promise<Snapshot> {
    const bytes = await this.context.resourceManager.getRawFileContent('demo.json');
    const value = validateSnapshot(JSON.parse(util.TextDecoder.create('utf-8').decodeToString(bytes)) as Snapshot, false);
    const delta = Date.now() - Date.parse(value.generatedAt);
    value.generatedAt = new Date().toISOString();
    if (value.vehicle.observedAt) value.vehicle.observedAt = new Date(Date.parse(value.vehicle.observedAt) + delta).toISOString();
    value.trips.forEach((trip: Trip) => {
      trip.startedAt = new Date(Date.parse(trip.startedAt) + delta).toISOString();
      if (trip.endedAt) trip.endedAt = new Date(Date.parse(trip.endedAt) + delta).toISOString();
    });
    value.charges.forEach((charge: Charge) => {
      charge.startedAt = new Date(Date.parse(charge.startedAt) + delta).toISOString();
      if (charge.endedAt) charge.endedAt = new Date(Date.parse(charge.endedAt) + delta).toISOString();
    });
    return value;
  }

  async snapshot(settings: Settings): Promise<Snapshot> {
    if (settings.mode === 'demo') {
      this.demo = await this.demoSnapshot();
      return this.demo;
    }
    return validateSnapshot(JSON.parse(await this.request('/api/dashboard', settings)) as Snapshot, true);
  }

  async trip(id: number, settings: Settings): Promise<Trip> {
    if (settings.mode === 'demo') {
      if (!this.demo) this.demo = await this.demoSnapshot();
      const value = this.demo.trips.find((trip: Trip) => trip.id === id);
      if (!value) throw new Error('未找到该行程');
      return value;
    }
    const value = validateTrip(JSON.parse(await this.request(`/api/trips/${id}`, settings)) as Trip);
    if (value.id !== id) throw new Error('行程编号不匹配');
    return value;
  }

  async charge(id: number, settings: Settings): Promise<Charge> {
    if (settings.mode === 'demo') {
      if (!this.demo) this.demo = await this.demoSnapshot();
      const value = this.demo.charges.find((charge: Charge) => charge.id === id);
      if (!value) throw new Error('未找到该充电记录');
      return value;
    }
    const value = validateCharge(JSON.parse(await this.request(`/api/charges/${id}`, settings)) as Charge);
    if (value.id !== id) throw new Error('充电编号不匹配');
    return value;
  }

  async locations(id: number, settings: Settings): Promise<Locations> {
    const value = JSON.parse(await this.request(`/api/trips/${id}/locations`, settings)) as Locations;
    if (!value || typeof value.from !== 'string' || typeof value.to !== 'string') throw new Error('行程地址格式不正确');
    return value;
  }

  async streetMap(id: number, settings: Settings): Promise<StreetMap> {
    const value = JSON.parse(await this.request(`/api/trips/${id}/map`, settings)) as StreetMap;
    if (!value || typeof value.image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.image)) throw new Error('街道地图格式不正确');
    return value;
  }

  dispose(): void { this.requests.forEach((task: http.HttpRequest) => task.destroy()); this.requests.clear(); }
}
