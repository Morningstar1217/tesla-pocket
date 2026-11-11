import { common } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { HdsTabs, HdsTabsController } from '@kit.UIDesignKit';
import { Snapshot, Settings, Trip, Charge, CostEntry, emptySnapshot, defaultSettings, num, energy, money,
  dateTime, duration, progress, booleanLabel, openingSummary, stateLabel, shortAddress, inRange, sumKnown,
  costScope, costKey, parseCost, effectiveCost, peakIndex, ENERGY_HINT } from '../data/Model';
import { Repository } from '../data/Repository';
import { PowerChart } from '../components/PowerChart';
import { TripMap } from '../components/TripMap';

interface StatusItem { label: string; value: string }
interface LocationJob { trip: Trip; snapshot: Snapshot; connection: number; version: number }

@Entry
@Component
struct Index {
  @State tab: number = 0;
  @State snapshot: Snapshot = emptySnapshot();
  @State hasSnapshot: boolean = false;
  @State settings: Settings = defaultSettings();
  @State formMode: string = 'demo';
  @State formUrl: string = '';
  @State formToken: string = '';
  @State loading: boolean = false;
  @State refreshing: boolean = false;
  @State error: string = '';
  @State settingsError: string = '';
  @State settingsMessage: string = '';
  @State saving: boolean = false;
  @State range: number = 7;
  @State showAccess: boolean = false;
  @State showHelp: boolean = false;
  @State showEnergy: boolean = false;
  @State navHidden: boolean = false;
  @State keyboardVisible: boolean = false;
  @State detail: string = '';
  @State detailLoading: boolean = false;
  @State detailError: string = '';
  @State selectedTrip: Trip | undefined = undefined;
  @State selectedCharge: Charge | undefined = undefined;
  @State costs: Record<string, CostEntry> = {};
  @State costError: string = '';
  @State costMessage: string = '';
  @State editingCost: boolean = false;
  @State costMode: string = 'total';
  @State costInput: string = '';
  @State costSaving: boolean = false;
  @StorageLink('cheji.foreground') @Watch('foregroundChanged') foreground: boolean = true;
  private repository: Repository | undefined = undefined;
  private mainWindow: window.Window | undefined = undefined;
  private alive: boolean = false;
  private scroller: Scroller = new Scroller();
  private detailScroller: Scroller = new Scroller();
  private tabsController: HdsTabsController = new HdsTabsController();
  private loadSequence: number = 0;
  private detailSequence: number = 0;
  private connectionSequence: number = 0;
  private detailId: number = 0;
  private costReady: boolean = false;
  private connectionReady: boolean = false;
  private locationQueue: LocationJob[] = [];
  private locationWorkers: number = 0;
  private located: Set<number> = new Set();
  private firstBack: number = 0;
  private anchorTop: number = 0;
  private scrollGesture: boolean = false;
  private lastLoaded: number = 0;
  private keyboardListener = (height: number): void => { this.keyboardVisible = height > 0; };

  aboutToAppear(): void {
    this.alive = true;
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      this.repository = new Repository(context);
      this.settings = this.repository.settings();
      this.connectionReady = true;
    } catch (reason) { this.settingsError = this.message(reason); this.tab = 3; }
    this.syncForm();
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    // The window owns keyboard state; page contents never resize or move the floating tab bar.
    try {
      window.getLastWindow(context).then((win: window.Window) => {
        if (!this.alive) return;
        this.mainWindow = win; win.on('keyboardHeightChange', this.keyboardListener);
      }).catch(() => {});
    } catch { console.warn('[cheji] keyboard listener unavailable'); }
    if (!this.settingsError) this.refresh();
  }

  aboutToDisappear(): void {
    this.alive = false;
    ++this.loadSequence; ++this.detailSequence; ++this.connectionSequence;
    this.repository?.dispose();
    try { this.mainWindow?.off('keyboardHeightChange', this.keyboardListener); }
    catch { console.warn('[cheji] keyboard listener already removed'); }
  }

  foregroundChanged(): void {
    if (!this.foreground) { this.firstBack = 0; return; }
    if (this.connectionReady && this.repository && !this.loading && !this.saving && Date.now() - this.lastLoaded > 30000) this.refresh();
  }

  onBackPress(): boolean {
    if (this.editingCost) { this.editingCost = false; return true; }
    if (this.detail) { this.closeDetail(); return true; }
    const now = Date.now();
    if (!this.firstBack || now - this.firstBack >= 2000) {
      this.firstBack = now;
      this.getUIContext().getPromptAction().showToast({ message: '再按一次退出应用' });
    } else {
      this.firstBack = 0;
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      try { context.terminateSelf().catch(() => this.getUIContext().getPromptAction().showToast({ message: '退出失败，请重试' })); }
      catch { this.getUIContext().getPromptAction().showToast({ message: '退出失败，请重试' }); }
    }
    return true;
  }

  message(reason: Error): string { return reason?.message || '连接暂时不可用，请稍后重试。'; }
  syncForm(): void { this.formMode = this.settings.mode; this.formUrl = this.settings.baseUrl; this.formToken = this.settings.token; }
  isDemo(): boolean { return this.hasSnapshot ? this.snapshot.source === 'demo' : this.settings.mode === 'demo'; }
  charges(): Charge[] { return this.snapshot.charges.filter((c: Charge) => inRange(c.startedAt, this.snapshot.generatedAt, this.range)); }
  trips(): Trip[] { return this.snapshot.trips.filter((t: Trip) => inRange(t.startedAt, this.snapshot.generatedAt, this.range)); }
  scope(): string { return costScope(this.snapshot, this.settings); }
  cost(charge: Charge): number | null { return effectiveCost(charge, this.costs[costKey(charge)]); }
  selectedEntry(): CostEntry | undefined { return this.selectedCharge ? this.costs[costKey(this.selectedCharge)] : undefined; }
  costPreview(): number | null {
    if (!this.selectedCharge) return null;
    try { return effectiveCost(this.selectedCharge, parseCost(this.costInput, this.costMode)); } catch { return null; }
  }
  rangeLabel(): string { return this.range ? `近 ${this.range} 天` : this.isDemo() ? '全部演示记录' : '全部已加载记录'; }
  accessItems(): StatusItem[] {
    const o = this.snapshot.vehicle.openings;
    return [
      { label: '主驾车门', value: booleanLabel(o.driverFront, '已打开', '已关闭') },
      { label: '副驾车门', value: booleanLabel(o.passengerFront, '已打开', '已关闭') },
      { label: '主驾后门', value: booleanLabel(o.driverRear, '已打开', '已关闭') },
      { label: '副驾后门', value: booleanLabel(o.passengerRear, '已打开', '已关闭') },
      { label: '前备箱', value: booleanLabel(o.frunk, '已打开', '已关闭') },
      { label: '后备箱', value: booleanLabel(o.trunk, '已打开', '已关闭') }
    ];
  }
  accessLabel(): string {
    const o = this.snapshot.vehicle.openings;
    return openingSummary([o.driverFront, o.passengerFront, o.driverRear, o.passengerRear, o.frunk, o.trunk]);
  }

  async refresh(): Promise<boolean> {
    if (!this.repository || !this.connectionReady) { this.loading = false; this.refreshing = false; return false; }
    const sequence = ++this.loadSequence;
    const connection = this.connectionSequence;
    this.loading = true; this.error = '';
    try {
      const value = await this.repository.snapshot(this.settings);
      if (sequence !== this.loadSequence || connection !== this.connectionSequence) return false;
      this.snapshot = value; this.located.clear(); this.hasSnapshot = true; this.lastLoaded = Date.now();
      this.costReady = false; this.costs = {}; this.costError = '';
      try { this.costs = this.repository.costs(this.scope()); this.costReady = true; }
      catch { this.costError = '本地费用读取失败，未覆盖原数据。请重新打开应用后重试。'; }
      this.enrichLocations(value, connection);
      return true;
    } catch (reason) { if (sequence === this.loadSequence) this.error = this.message(reason); return false; }
    finally { if (sequence === this.loadSequence) { this.loading = false; this.refreshing = false; } }
  }

  enrichLocations(snapshot: Snapshot, connection: number): void {
    if (snapshot.source !== 'teslamate' || !this.repository) return;
    const targets = this.tab === 2 ? snapshot.trips : snapshot.trips.slice(0, 1);
    this.locationQueue = targets.filter((trip: Trip) => !this.located.has(trip.id)).map((trip: Trip): LocationJob => {
      return { trip, snapshot, connection, version: this.loadSequence };
    });
    while (this.locationWorkers < 2 && this.locationQueue.length) {
      ++this.locationWorkers;
      this.runLocations();
    }
  }
  async runLocations(): Promise<void> {
    try {
      while (this.locationQueue.length && this.repository) {
        const job = this.locationQueue.shift()!;
        if (job.connection !== this.connectionSequence || job.version !== this.loadSequence || this.located.has(job.trip.id)) continue;
        this.located.add(job.trip.id);
        try {
          const labels = await this.repository.locations(job.trip.id, this.settings);
          if (job.connection !== this.connectionSequence || job.version !== this.loadSequence) continue;
          job.trip.from = labels.from; job.trip.to = labels.to;
          this.snapshot.trips = job.snapshot.trips.slice();
          if (this.selectedTrip?.id === job.trip.id) { this.selectedTrip.from = labels.from; this.selectedTrip.to = labels.to; }
        } catch { /* Keep upstream labels when geocoding is unavailable. */ }
      }
    } finally { --this.locationWorkers; }
  }

  switchTab(index: number): void {
    if (this.tab === index || index < 0 || index > 3) return;
    this.tab = index;
    if (index === 2 && this.hasSnapshot) this.enrichLocations(this.snapshot, this.connectionSequence);
    this.navHidden = false; this.anchorTop = 0; this.scrollGesture = false; this.firstBack = 0;
    setTimeout((): void => { this.scroller.scrollTo({ xOffset: 0, yOffset: 0 }); }, 0);
  }
  scrollChanged(): void {
    if (!this.scrollGesture || this.detail || this.keyboardVisible) return;
    const top = Math.max(0, this.scroller.currentOffset().yOffset);
    if (top <= 8) { this.anchorTop = top; this.hideNavigation(false); return; }
    const delta = top - this.anchorTop;
    if (this.navHidden ? delta > 0 : delta < 0) this.anchorTop = top;
    else if (Math.abs(delta) >= 48) { this.anchorTop = top; this.hideNavigation(!this.navHidden); }
  }
  hideNavigation(hidden: boolean): void {
    if (this.navHidden === hidden) return;
    this.getUIContext().animateTo({ duration: 240, curve: Curve.Friction }, () => { this.navHidden = hidden; });
  }

  async openDetail(kind: string, id: number): Promise<void> {
    if (!this.repository) return;
    const sequence = ++this.detailSequence;
    this.firstBack = 0; this.scrollGesture = false; this.navHidden = false;
    this.detail = kind; this.detailId = id; this.detailLoading = true; this.detailError = '';
    this.selectedTrip = undefined; this.selectedCharge = undefined; this.editingCost = false; this.costMessage = '';
    setTimeout((): void => { this.detailScroller.scrollTo({ xOffset: 0, yOffset: 0 }); }, 0);
    try {
      if (kind === 'trip') {
        const value = await this.repository.trip(id, this.settings);
        if (sequence !== this.detailSequence) return;
        const listed = this.snapshot.trips.find((trip: Trip) => trip.id === id);
        if (listed) { value.from = listed.from; value.to = listed.to; }
        this.selectedTrip = value;
      } else {
        const value = await this.repository.charge(id, this.settings);
        if (sequence === this.detailSequence) this.selectedCharge = value;
      }
    } catch (reason) { if (sequence === this.detailSequence) this.detailError = this.message(reason); }
    finally { if (sequence === this.detailSequence) this.detailLoading = false; }
  }
  closeDetail(): void { ++this.detailSequence; this.detail = ''; this.selectedTrip = undefined; this.selectedCharge = undefined; this.editingCost = false; this.navHidden = false; this.scrollGesture = false; }

  async applySettings(test: boolean): Promise<void> {
    if (this.saving || !this.repository) return;
    this.saving = true; this.settingsError = ''; this.settingsMessage = '';
    try {
      const next: Settings = { mode: this.formMode, baseUrl: this.formUrl, token: this.formToken };
      const saved = await this.repository.saveSettings(next);
      ++this.connectionSequence; ++this.detailSequence; ++this.loadSequence; this.repository.dispose();
      this.settings = saved; this.connectionReady = true; this.syncForm(); this.hasSnapshot = false; this.snapshot = emptySnapshot(); this.costs = {}; this.costReady = false;
      const connected = await this.refresh();
      if (!connected) this.settingsError = `设置已保存，${this.error || '连接测试未完成。'}`;
      else this.settingsMessage = test ? '连接成功。' : '设置已保存，数据已更新。';
    } catch (reason) { this.settingsError = this.message(reason); }
    finally { this.saving = false; }
  }
  async restoreDemo(): Promise<void> {
    if (!this.repository || this.saving) return;
    this.saving = true; this.settingsError = ''; this.settingsMessage = '';
    try {
      await this.repository.resetConnection();
      ++this.connectionSequence; ++this.loadSequence; ++this.detailSequence; this.repository.dispose();
      this.settings = defaultSettings(); this.connectionReady = true; this.syncForm(); this.hasSnapshot = false; this.snapshot = emptySnapshot(); this.costs = {}; this.costReady = false;
      await this.refresh(); this.settingsMessage = '连接设置已清除，已恢复演示模式。';
    } catch (reason) { this.settingsError = this.message(reason); }
    finally { this.saving = false; }
  }
  editCost(): void {
    const entry = this.selectedEntry();
    this.costMode = entry?.mode || 'total'; this.costInput = entry ? String(entry.value) : '';
    if (this.costReady) this.costError = '';
    this.editingCost = true; this.costMessage = '';
  }
  async saveCost(restore: boolean): Promise<void> {
    if (!this.selectedCharge || !this.repository || this.costSaving) return;
    const connection = this.connectionSequence;
    this.costSaving = true; this.costMessage = '';
    try {
      if (!this.costReady) throw new Error('本地费用读取失败，请重新打开应用后重试。');
      const next: Record<string, CostEntry> = {};
      const key = costKey(this.selectedCharge);
      Object.keys(this.costs).forEach((existing: string) => { if (!restore || existing !== key) next[existing] = this.costs[existing]; });
      if (!restore) {
        const entry = parseCost(this.costInput, this.costMode);
        if (effectiveCost(this.selectedCharge, entry) === null) throw new Error('充入电量未知，请直接填写总费用。');
        next[key] = entry;
      }
      await this.repository.saveCosts(this.scope(), next);
      if (connection !== this.connectionSequence) return;
      this.costs = next; this.editingCost = false; this.costError = ''; this.costMessage = restore ? '已恢复采集费用。' : '费用已保存。';
      this.getUIContext().getFocusController().clearFocus();
    } catch (reason) { this.costError = this.message(reason); }
    finally { this.costSaving = false; }
  }

  @Builder
  hint(value: string) { Text(value).fontSize(12).fontColor('#9A9DA3').lineHeight(20).width('100%') }
  @Builder
  heading(value: string) { Text(value).fontSize(29).fontWeight(FontWeight.Medium).fontColor('#F4F4F4').width('100%').margin({ top: 10, bottom: 12 }) }
  @Builder
  section(value: string) { Text(value).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#F4F4F4').width('100%').margin({ top: 14, bottom: 4 }) }
  @Builder
  statusRow(label: string, value: string, note: string = '') {
    Row({ space: 12 }) {
      Column({ space: 5 }) {
        Text(label).fontSize(15).fontColor('#F4F4F4')
        if (note) { Text(note).fontSize(12).fontColor('#9A9DA3') }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Text(value).fontSize(15).fontColor(value === '已打开' || value === '未锁车' ? '#F4C077' : '#F4F4F4').textAlign(TextAlign.End).constraintSize({ maxWidth: '58%' })
    }.width('100%').constraintSize({ minHeight: 62 }).padding({ top: 12, bottom: 12 }).border({ width: { bottom: 0.5 }, color: '#393B3F' })
  }
  @Builder
  metric(label: string, value: string) {
    Column({ space: 10 }) {
      Text(label).fontSize(12).fontColor('#9A9DA3')
      Text(value).fontSize(24).fontColor('#F4F4F4').fontWeight(FontWeight.Medium)
    }.layoutWeight(1).alignItems(HorizontalAlign.Start).padding({ top: 16, bottom: 16 })
  }
  @Builder
  action(label: string, callback: () => void, enabled: boolean = true) {
    Button(label).width('100%').constraintSize({ minHeight: 48 }).borderRadius(10)
      .backgroundColor('#333539').fontColor('#F4F4F4').fontSize(15).enabled(enabled).onClick(callback)
  }
  @Builder
  loadingView(title: string, vehicle: boolean = false) {
    Column({ space: 20 }) {
      Row({ space: 12 }) { LoadingProgress().width(24).height(24).color('#00D68F'); Text(title).fontSize(14).fontColor('#9A9DA3') }.width('100%')
      if (vehicle) {
        Row().width('65%').height(24).backgroundColor('#333539').borderRadius(4)
        Image($rawfile('model-y.png')).height(205).width('100%').objectFit(ImageFit.Contain).accessibilityLevel('no')
        Row().width('100%').height(4).backgroundColor('#333539').borderRadius(2)
      }
      ForEach([0, 1, 2], () => {
        Column({ space: 16 }) {
          Row().width('55%').height(15).backgroundColor('#333539').borderRadius(4)
          Row().width('90%').height(24).backgroundColor('#333539').borderRadius(4)
          Row().width('75%').height(12).backgroundColor('#333539').borderRadius(4)
        }.width('100%').padding(20).backgroundColor('#222326').borderRadius(12).alignItems(HorizontalAlign.Start)
      })
    }.width('100%').padding({ top: 20 }).accessibilityText(title)
  }
  @Builder
  tripRow(trip: Trip) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 14 }) {
        Row() { Text(dateTime(trip.startedAt)).fontSize(12).fontColor('#9A9DA3'); Blank(); Text('›').fontSize(22).fontColor('#9A9DA3') }.width('100%')
        Text(`${shortAddress(trip.from) || '未知起点'}  →  ${shortAddress(trip.to) || '未知终点'}`).fontSize(17).fontColor('#F4F4F4').width('100%').textAlign(TextAlign.Start)
        Row({ space: 12 }) {
          Text(`${num(trip.distanceKm, 1)} km`).fontSize(15).fontColor('#F4F4F4')
          Blank()
          Text(duration(trip.durationMin)).fontSize(12).fontColor('#9A9DA3')
          Text(`${energy(trip.energyKwh)}${trip.energyKwh != null ? ' kWh' : ''}`).fontSize(12).fontColor('#9A9DA3')
        }.width('100%')
      }.width('100%').padding(18)
    }.width('100%').backgroundColor('#222326').borderRadius(12).onClick(() => this.openDetail('trip', trip.id))
      .accessibilityText(`${dateTime(trip.startedAt)}，${trip.from}到${trip.to}，查看行程详情`)
  }
  @Builder
  chargeRow(charge: Charge) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 14 }) {
        Row() {
          Text(charge.kind === 'DC' ? 'DC 快充' : charge.kind === 'AC' ? 'AC 慢充' : '充电').fontSize(12).fontColor('#00D68F')
          Blank(); Text(dateTime(charge.startedAt)).fontSize(12).fontColor('#9A9DA3'); Text(' ›').fontSize(22).fontColor('#9A9DA3')
        }.width('100%')
        Text(charge.location || '未知充电地点').fontSize(17).fontColor('#F4F4F4').width('100%').textAlign(TextAlign.Start)
        Row({ space: 10 }) {
          Text(`${num(charge.energyKwh, 1)} kWh`).fontSize(15).fontColor('#F4F4F4')
          Blank()
          Text(`${num(charge.startPct)}% → ${num(charge.endPct)}%`).fontSize(12).fontColor('#9A9DA3')
          Text(money(this.cost(charge))).fontSize(14).fontColor('#F4F4F4')
        }.width('100%')
      }.width('100%').padding(18)
    }.width('100%').backgroundColor('#222326').borderRadius(12).onClick(() => this.openDetail('charge', charge.id))
      .accessibilityText(`${dateTime(charge.startedAt)}，${charge.location}，查看充电详情`)
  }

  @Builder
  vehiclePage() {
    Row({ space: 12 }) {
      Column({ space: 6 }) {
        Text(this.snapshot.vehicle.name || '我的爱车').fontSize(28).fontWeight(FontWeight.Medium).fontColor('#F4F4F4')
        Text(this.snapshot.vehicle.model || 'TESLA').fontSize(13).fontColor('#9A9DA3')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Text(stateLabel(this.snapshot.vehicle.state)).fontSize(12).fontColor('#9A9DA3')
    }.width('100%').margin({ top: 14 })
    Row() {
      Column({ space: 4 }) {
        Text(`${num(this.snapshot.vehicle.batteryPct)}%`).fontSize(46).fontColor('#00D68F').fontWeight(FontWeight.Medium)
        Text('当前电量').fontSize(12).fontColor('#9A9DA3')
      }.alignItems(HorizontalAlign.Start)
      Image($rawfile('model-y.png')).layoutWeight(1).height(205).objectFit(ImageFit.Contain).accessibilityLevel('no')
    }.width('100%')
    Progress({ value: progress(this.snapshot.vehicle.batteryPct), total: 100, type: ProgressType.Linear })
      .color('#00D68F').backgroundColor('#393B3F').style({ strokeWidth: 4 }).width('100%')
    Row({ space: 24 }) {
      this.metric('预计续航', `${num(this.snapshot.vehicle.rangeKm)} km`)
      this.metric('累计里程', `${num(this.snapshot.vehicle.odometerKm)} km`)
    }.width('100%')
    this.hint(this.isDemo() ? '演示数据' : this.snapshot.vehicle.observedAt ? `采样于 ${dateTime(this.snapshot.vehicle.observedAt)}` : '最近采集 · 采样时间未知')
    Column({ space: 12 }) {
      this.statusRow(this.snapshot.vehicle.charging ? '正在充电' : '最近位置', this.snapshot.vehicle.locationName || '位置未知')
      if (this.snapshot.vehicle.charging) {
        this.statusRow('充电功率', `${num(this.snapshot.vehicle.charging.powerKw, 1)} kW`, `剩余 ${duration(this.snapshot.vehicle.charging.remainingMin)}`)
      }
    }.padding(16).width('100%').backgroundColor('#222326').borderRadius(12)
    this.section('车况细节')
    this.statusRow('门锁', booleanLabel(this.snapshot.vehicle.locked, '已锁车', '未锁车'), `哨兵模式 ${booleanLabel(this.snapshot.vehicle.sentry, '已开启', '已关闭')}`)
    this.statusRow('温度', `${num(this.snapshot.vehicle.insideTempC, 1)}° / ${num(this.snapshot.vehicle.outsideTempC, 1)}°`, '车内 / 车外 · °C')
    this.statusRow('车窗', booleanLabel(this.snapshot.vehicle.openings.windows, '有车窗开启', '全部关闭'))
    this.statusRow('空调', booleanLabel(this.snapshot.vehicle.climate.on, '已开启', '已关闭'), `预调节 ${booleanLabel(this.snapshot.vehicle.climate.preconditioning, '已开启', '已关闭')}`)
    Button({ type: ButtonType.Normal }) {
      Row() { Text('车门与行李箱').fontSize(15); Blank(); Text(`${this.accessLabel()}  ${this.showAccess ? '−' : '+'}`).fontSize(13) }.width('100%').padding({ top: 18, bottom: 18 })
    }.width('100%').backgroundColor(Color.Transparent).fontColor('#F4F4F4').onClick(() => { this.showAccess = !this.showAccess; })
      .accessibilityText(`车门与行李箱，${this.accessLabel()}，${this.showAccess ? '收起' : '展开'}`)
    if (this.showAccess) { ForEach(this.accessItems(), (item: StatusItem) => { this.statusRow(item.label, item.value) }) }
    this.section('胎压监测 · bar')
    Row() {
      Column({ space: 40 }) { this.tyre('左前', this.snapshot.vehicle.tyres.fl); this.tyre('左后', this.snapshot.vehicle.tyres.rl) }.layoutWeight(1)
      Image($rawfile('vehicle-top.svg')).height(190).width(100).objectFit(ImageFit.Contain).accessibilityLevel('no')
      Column({ space: 40 }) { this.tyre('右前', this.snapshot.vehicle.tyres.fr); this.tyre('右后', this.snapshot.vehicle.tyres.rr) }.layoutWeight(1)
    }.width('100%').padding({ top: 12, bottom: 12 })
    Row() {
      Text('最近一程').fontSize(17).fontColor('#F4F4F4'); Blank()
      Button('查看全部 ›').fontSize(13).fontColor('#F4F4F4').backgroundColor(Color.Transparent).onClick(() => this.switchTab(2))
    }.width('100%')
    if (this.snapshot.trips.length) { this.tripRow(this.snapshot.trips[0]) } else { this.hint('暂无行程') }
  }
  @Builder
  tyre(label: string, value: number | null) {
    Column({ space: 6 }) { Text(num(value, 1)).fontSize(24).fontColor('#F4F4F4'); Text(label).fontSize(12).fontColor('#9A9DA3') }
  }
  @Builder
  periodButton(label: string, value: number) {
    Button(label).layoutWeight(1).fontSize(13).height(40).borderRadius(20)
      .fontColor(this.range === value ? '#171819' : '#9A9DA3').backgroundColor(this.range === value ? '#F4F4F4' : '#222326')
      .onClick(() => { this.range = value; }).accessibilitySelected(this.range === value)
  }
  @Builder
  recordsPage() {
    this.heading(this.tab === 1 ? '充电' : '行程')
    Row({ space: 8 }) { this.periodButton('近 7 天', 7); this.periodButton('近 30 天', 30); this.periodButton('全部已加载', 0) }.width('100%')
    Row({ space: 12 }) {
      if (this.tab === 1) {
        this.metric('充入电量', `${num(sumKnown(this.charges().map((c: Charge) => c.energyKwh)), 1)} kWh`)
        this.metric('充电费用', money(sumKnown(this.charges().map((c: Charge) => this.cost(c)))))
      } else {
        this.metric('累计行驶', `${num(sumKnown(this.trips().map((t: Trip) => t.distanceKm)), 1)} km`)
        this.metric('估算能耗', this.trips().length ? energy(sumKnown(this.trips().map((t: Trip) => t.energyKwh))) + (sumKnown(this.trips().map((t: Trip) => t.energyKwh)) != null ? ' kWh' : '') : '--')
      }
    }.width('100%')
    this.hint(`${this.tab === 1 ? this.charges().length + ' 次充电' : this.trips().length + ' 次行程'} · ${this.rangeLabel()} · 仅合计有值记录`)
    this.section(this.tab === 1 ? '补能记录' : '行程记录')
    if (this.tab === 1) {
      ForEach(this.charges(), (charge: Charge) => { this.chargeRow(charge) }, (charge: Charge) => String(charge.id))
      if (!this.charges().length) { this.hint('暂无充电记录，可切换时间范围。') }
    } else {
      ForEach(this.trips(), (trip: Trip) => { this.tripRow(trip) }, (trip: Trip) => String(trip.id))
      if (!this.trips().length) { this.hint('暂无行程记录，可切换时间范围。') }
      if (!this.isDemo() && this.trips().some((t: Trip) => t.energyKwh == null)) { this.energyHelp() }
    }
    this.hint(this.isDemo() ? '演示记录' : '近 30 天 · 最多 100 条已加载记录')
    if (this.costError && this.tab === 1) { Text(this.costError).fontColor('#FFAAA1').fontSize(13).width('100%') }
  }
  @Builder
  energyHelp() {
    Button(`能耗待校准 · ${this.showEnergy ? '收起说明' : '查看原因'}`).fontColor('#F4F4F4').fontSize(12)
      .backgroundColor(Color.Transparent).onClick(() => { this.showEnergy = !this.showEnergy; })
    if (this.showEnergy) { this.hint(ENERGY_HINT) }
  }
  @Builder
  settingsPage() {
    this.heading('设置')
    Column({ space: 16 }) {
      this.section('数据连接')
      Row({ space: 12 }) {
        Button('演示数据').layoutWeight(1).fontColor('#F4F4F4').backgroundColor(this.formMode === 'demo' ? '#51545B' : '#333539')
          .onClick(() => { this.formMode = 'demo'; }).accessibilitySelected(this.formMode === 'demo')
        Button('连接实车').layoutWeight(1).fontColor('#F4F4F4').backgroundColor(this.formMode === 'live' ? '#51545B' : '#333539')
          .onClick(() => { this.formMode = 'live'; }).accessibilitySelected(this.formMode === 'live')
      }.width('100%')
      if (this.formMode === 'live') {
        this.hint('服务地址')
        TextInput({ text: this.formUrl, placeholder: 'HTTPS 地址或局域网 IP' }).maxLength(512).fontColor('#F4F4F4')
          .placeholderColor('#9A9DA3').backgroundColor('#333539').height(48).borderRadius(8).onChange((value: string) => { this.formUrl = value; }).accessibilityText('服务地址')
        this.hint('访问令牌')
        TextInput({ text: this.formToken, placeholder: '应用访问令牌' }).type(InputType.Password).maxLength(512)
          .fontColor('#F4F4F4').placeholderColor('#9A9DA3').backgroundColor('#333539').height(48).borderRadius(8)
          .onChange((value: string) => { this.formToken = value; }).accessibilityText('应用访问令牌')
        this.hint('勿填写 Tesla 密码或 Tesla 令牌。')
      }
      if (this.settingsError) { Text(this.settingsError).fontColor('#FFAAA1').fontSize(13).width('100%') }
      if (this.settingsMessage) { Text(this.settingsMessage).fontColor('#81E0B6').fontSize(13).width('100%') }
      if (this.saving) { LoadingProgress().width(24).height(24).color('#00D68F') }
      this.action('保存设置', () => this.applySettings(false), !this.saving)
      if (this.formMode === 'live') { this.action('测试连接', () => this.applySettings(true), !this.saving) }
    }.padding(18).width('100%').backgroundColor('#222326').borderRadius(12)
    this.section(`当前连接 · ${this.settings.mode === 'demo' ? '演示' : '实车'}`)
    this.statusRow('数据来源', this.hasSnapshot ? this.snapshot.source === 'demo' ? '示例数据' : 'TeslaMate' : '尚未获取')
    this.statusRow('采样时间', this.snapshot.vehicle.observedAt ? dateTime(this.snapshot.vehicle.observedAt) : '未知')
    this.statusRow('访问范围', '只读')
    this.action(`连接帮助与数据说明 ${this.showHelp ? '−' : '+'}`, () => { this.showHelp = !this.showHelp; })
    if (this.showHelp) {
      this.hint('手机与 Mac 连接同一 Wi-Fi，使用 Mac 的局域网 IP；127.0.0.1 仅限本机。局域网 HTTP 只用于可信网络调试，远程连接使用 HTTPS。')
      this.hint('访问令牌保存在当前设备。只连接你信任的服务；Tesla 凭证始终留在采集服务中。')
      this.hint('显示最近采集状态；休眠或离线时可能不会更新。采样时间未知不代表数据刚刚上报。')
      this.hint(ENERGY_HINT)
      ForEach(this.snapshot.notices, (notice: string) => { this.hint(notice) })
      this.hint('独立个人项目，与 Tesla 无关联。')
    }
    this.action('清除连接，恢复演示', () => this.restoreDemo(), !this.saving)
    this.hint('车迹 · 2.0.0 · 原生鸿蒙')
  }
  @Builder
  tripDetail(trip: Trip) {
    Column({ space: 16 }) {
      Text(`起  ${trip.from || '未知起点'}`).fontSize(17).fontColor('#F4F4F4').width('100%')
      Text(`终  ${trip.to || '未知终点'}`).fontSize(17).fontColor('#F4F4F4').width('100%')
      this.hint(`${dateTime(trip.startedAt)} → ${trip.endedAt ? dateTime(trip.endedAt) : '尚未结束'}`)
    }.padding(20).width('100%').backgroundColor('#222326').borderRadius(12)
    Row({ space: 16 }) { this.metric('行驶距离', `${num(trip.distanceKm, 1)} km`); this.metric('行驶时长', duration(trip.durationMin)) }.width('100%')
    Row({ space: 16 }) { this.metric('估算能耗', energy(trip.energyKwh) + (trip.energyKwh != null ? ' kWh' : '')); this.metric('平均能耗', energy(trip.efficiencyWhKm, 0) + (trip.efficiencyWhKm != null ? ' Wh/km' : '')) }.width('100%')
    this.section('行驶轨迹')
    if (this.repository) { TripMap({ trip, settings: this.settings, repository: this.repository }) }
    if (this.isDemo()) { this.hint('演示行程') }
    if (!this.isDemo() && trip.energyKwh == null) { this.energyHelp() }
  }
  @Builder
  chargeDetail(charge: Charge) {
    Column({ space: 14 }) {
      this.hint(`${charge.kind === 'DC' ? 'DC 快充' : charge.kind === 'AC' ? 'AC 慢充' : '充电'} · ${charge.endedAt ? '已完成' : '进行中'}`)
      Text(charge.location || '未知充电地点').fontSize(22).fontColor('#F4F4F4').width('100%')
      this.hint(`${dateTime(charge.startedAt)}${charge.endedAt ? ' → ' + dateTime(charge.endedAt) : ''}`)
      Text(`${num(charge.startPct)}%  →  ${num(charge.endPct)}%`).fontColor('#00D68F').fontSize(30).width('100%')
      Progress({ value: progress(charge.endPct), total: 100 }).color('#00D68F').backgroundColor('#393B3F').width('100%')
    }.padding(20).width('100%').backgroundColor('#222326').borderRadius(12)
    Row({ space: 16 }) { this.metric('充入电量', `${num(charge.energyKwh, 1)} kWh`); this.metric('充电时长', duration(charge.durationMin)) }.width('100%')
    Row({ space: 16 }) {
      this.metric('充电费用', money(this.cost(charge)))
      this.metric('峰值功率', `${charge.curve.length ? num(charge.curve[peakIndex(charge.curve)].powerKw, 1) : '--'} kW`)
    }.width('100%')
    if (this.selectedEntry()) { this.hint(this.selectedEntry()!.mode === 'total' ? '费用来源：手动填写' : '费用来源：按单价计算') }
    this.action(this.selectedEntry() ? '修改费用' : '填写费用', () => this.editCost(), !this.costSaving)
    if (this.editingCost) { this.costEditor(charge) }
    if (this.costError) { Text(this.costError).fontColor('#FFAAA1').fontSize(13).width('100%') }
    if (this.costMessage) { this.hint(this.costMessage) }
    PowerChart({ points: charge.curve })
    if (this.isDemo()) { this.hint('演示功率曲线') }
  }
  @Builder
  costEditor(charge: Charge) {
    Column({ space: 16 }) {
      this.section('本次充电费用')
      Row({ space: 8 }) {
        Button('填写总费用').layoutWeight(1).fontSize(13).fontColor('#F4F4F4').backgroundColor(this.costMode === 'total' ? '#51545B' : '#333539')
          .onClick(() => { if (this.costMode !== 'total') { this.costMode = 'total'; this.costInput = ''; } })
        Button('按单价计算').layoutWeight(1).fontSize(13).fontColor('#F4F4F4').backgroundColor(this.costMode === 'rate' ? '#51545B' : '#333539')
          .onClick(() => { if (this.costMode !== 'rate') { this.costMode = 'rate'; this.costInput = ''; } })
      }.width('100%')
      this.hint(this.costMode === 'total' ? '总费用（元）' : '充电单价（元/度）')
      TextInput({ text: this.costInput, placeholder: this.costMode === 'total' ? '例如 38.50' : '例如 1.20' })
        .type(InputType.NUMBER_DECIMAL).maxLength(12).fontColor('#F4F4F4').placeholderColor('#9A9DA3').backgroundColor('#333539').height(48)
        .onChange((value: string) => { this.costInput = value; }).accessibilityText(this.costMode === 'total' ? '总费用，元' : '充电单价，元每度')
      if (this.costMode === 'rate') { this.hint(`${num(charge.energyKwh, 3)} 度 × 单价，合计 ${money(this.costPreview())}`) }
      this.hint('人民币，仅保存在当前设备。')
      this.action('保存费用', () => this.saveCost(false), !this.costSaving)
      this.action('取消', () => { this.editingCost = false; }, !this.costSaving)
      if (this.selectedEntry()) { this.action('恢复采集费用', () => this.saveCost(true), !this.costSaving) }
    }.padding(18).backgroundColor('#222326').borderRadius(12).width('100%')
  }

  @Builder
  tabLabel(icon: Resource, label: string, index: number) {
    Column({ space: 4 }) {
      SymbolGlyph(icon).fontSize(23).fontColor([this.tab === index ? '#F4F4F4' : '#9A9DA3'])
      Text(label).fontSize(11).fontColor(this.tab === index ? '#F4F4F4' : '#9A9DA3')
    }.width('100%').height(52).justifyContent(FlexAlign.Center).accessibilityText(label).accessibilitySelected(this.tab === index)
  }
  @Builder
  navigation() {
    HdsTabs({ index: this.tab, controller: this.tabsController }) {
      TabContent() { Column() {} }.tabBar(this.tabLabel($r('sys.symbol.car'), '车况', 0))
      TabContent() { Column() {} }.tabBar(this.tabLabel($r('sys.symbol.battery_bolt'), '充电', 1))
      TabContent() { Column() {} }.tabBar(this.tabLabel($r('sys.symbol.location_north_up_right'), '行程', 2))
      TabContent() { Column() {} }.tabBar(this.tabLabel($r('sys.symbol.gearshape'), '设置', 3))
    }.width('78%').constraintSize({ maxWidth: 312 }).height(56).margin({ bottom: 10 })
      .backgroundColor('#F2222326').borderRadius(28).clip(true).barPosition(BarPosition.End).barOverlap(true)
      .barHeight(56).barBackgroundColor(Color.Transparent).barBackgroundStyle({ maskColor: Color.Transparent, maskHeight: 0 })
      .scrollable(false).animationDuration(180).onChange((index: number) => this.switchTab(index))
      .translate({ y: this.navHidden ? 88 : 0 }).opacity(this.navHidden ? 0 : 1)
      .hitTestBehavior(this.navHidden ? HitTestMode.None : HitTestMode.Default)
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Refresh({ refreshing: $$this.refreshing }) {
        Scroll(this.scroller) {
          Column({ space: 14 }) {
            if (this.isDemo() && this.tab !== 3) {
              Row() {
                Text('● 演示数据').fontSize(12).fontColor('#9A9DA3'); Blank()
                Button('连接实车 →').fontSize(12).fontColor('#F4F4F4').backgroundColor(Color.Transparent).onClick(() => this.switchTab(3))
              }.width('100%')
            }
            if (this.error && this.tab !== 3) {
              Text(this.error).fontSize(13).fontColor('#FFAAA1').width('100%')
              this.action('重试', () => this.refresh(), !this.loading)
            }
            if (this.tab === 3) { this.settingsPage() }
            else if (this.loading && !this.hasSnapshot) { this.loadingView(this.tab === 0 ? '正在读取车辆数据…' : this.tab === 1 ? '正在读取充电记录…' : '正在读取行程记录…', this.tab === 0) }
            else if (!this.hasSnapshot) { this.hint('暂时没有车辆数据，请检查连接设置，或切换到演示模式体验。'); this.action('前往设置', () => this.switchTab(3)) }
            else if (this.tab === 0) { this.vehiclePage() }
            else { this.recordsPage() }
          }.padding({ left: 22, right: 22, top: 16, bottom: 110 }).width('100%').constraintSize({ maxWidth: 720 }).alignItems(HorizontalAlign.Start)
        }.width('100%').height('100%').scrollBar(BarState.Off)
          .onTouch((event: TouchEvent) => { if (event.type === TouchType.Down) { this.scrollGesture = true; this.anchorTop = Math.max(0, this.scroller.currentOffset().yOffset); } })
          .onDidScroll(() => this.scrollChanged()).onScrollStop(() => { this.scrollGesture = false; })
      }.width('100%').height('100%').onRefreshing(() => this.refresh()).enabled(!this.saving)
        .visibility(this.detail ? Visibility.Hidden : Visibility.Visible)
      if (this.detail) {
        Scroll(this.detailScroller) {
          Column({ space: 14 }) {
            Button(`‹ 返回${this.tab === 0 ? '车况' : this.detail === 'trip' ? '行程' : '充电'}`)
              .backgroundColor(Color.Transparent).fontColor('#F4F4F4').fontSize(15).padding({ left: 0, right: 12 }).height(44)
              .onClick(() => this.closeDetail())
            this.heading(this.detail === 'trip' ? '行程详情' : '充电详情')
            if (this.detailLoading) { this.loadingView('正在读取详情…') }
            else if (this.detailError) {
              Text(this.detailError).fontColor('#FFAAA1').fontSize(14)
              this.action('重新加载', () => this.openDetail(this.detail, this.detailId))
            } else if (this.selectedTrip) { this.tripDetail(this.selectedTrip) }
            else if (this.selectedCharge) { this.chargeDetail(this.selectedCharge) }
          }.width('100%').constraintSize({ maxWidth: 720 }).padding({ left: 22, right: 22, top: 8, bottom: 40 }).alignItems(HorizontalAlign.Start)
        }.width('100%').height('100%').backgroundColor('#171819').scrollBar(BarState.Off)
      }
      if (!this.detail && !this.keyboardVisible) { this.navigation() }
    }.width('100%').height('100%').backgroundColor('#171819')
  }
}
