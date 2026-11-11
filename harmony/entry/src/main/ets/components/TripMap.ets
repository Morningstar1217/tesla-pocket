import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import { Point, Settings, Trip, validPoints, defaultSettings } from '../data/Model';
import { Repository } from '../data/Repository';

@CustomDialog
struct MapPreview {
  controller: CustomDialogController;
  pixels: image.PixelMap | undefined = undefined;
  @State zoom: number = 1;
  @State x: number = 0;
  @State y: number = 0;
  private lastScale: number = 1;
  private lastX: number = 0;
  private lastY: number = 0;
  build() {
    Column({ space: 16 }) {
      Row() {
        Text('腾讯街道地图').fontColor('#F4F4F4').fontSize(18)
        Blank()
        Button('关闭').onClick(() => this.controller.close()).backgroundColor('#333539').fontColor('#F4F4F4')
      }.width('100%')
      Stack() {
        Image(this.pixels).objectFit(ImageFit.Contain).width('100%').height('100%')
          .scale({ x: this.zoom, y: this.zoom }).translate({ x: this.x, y: this.y })
          .gesture(GestureGroup(GestureMode.Parallel,
            PinchGesture().onActionUpdate((event: GestureEvent) => { this.zoom = Math.max(1, Math.min(6, this.lastScale * event.scale)); })
              .onActionEnd(() => { this.lastScale = this.zoom; }),
            PanGesture().onActionUpdate((event: GestureEvent) => { this.x = this.lastX + event.offsetX; this.y = this.lastY + event.offsetY; })
              .onActionEnd(() => { this.lastX = this.x; this.lastY = this.y; })
          ))
          .accessibilityText('街道地图，可双指缩放和拖动')
      }.layoutWeight(1).width('100%').clip(true)
      Button('重置缩放').onClick(() => { this.zoom = 1; this.lastScale = 1; this.x = 0; this.y = 0; this.lastX = 0; this.lastY = 0; })
        .fontColor('#F4F4F4').backgroundColor('#333539')
    }.width('100%').height('90%').padding(20).backgroundColor('#171819').borderRadius(16)
  }
}

@Component
export struct TripMap {
  @Prop trip: Trip;
  settings: Settings = defaultSettings();
  repository: Repository | undefined = undefined;
  @State pixels: image.PixelMap | undefined = undefined;
  @State loading: boolean = false;
  @State sampled: boolean = false;
  @State failed: boolean = false;
  private sequence: number = 0;
  private plotWidth: number = 1;
  private canvas: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private dialog: CustomDialogController = new CustomDialogController({
    builder: MapPreview({ pixels: this.pixels }), customStyle: true, autoCancel: true
  });

  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { ++this.sequence; this.dialog.close(); this.pixels?.release(); }

  async load(): Promise<void> {
    const sequence = ++this.sequence;
    if (!this.repository || this.settings.mode !== 'live' || validPoints(this.trip.points).length < 2) return;
    this.loading = true; this.failed = false;
    try {
      const value = await this.repository.streetMap(this.trip.id, this.settings);
      const bytes = new util.Base64Helper().decodeSync(value.image.substring(value.image.indexOf(',') + 1));
      const source = image.createImageSource(bytes.buffer as ArrayBuffer);
      let pixels: image.PixelMap;
      try { pixels = await source.createPixelMap(); } finally { source.release(); }
      if (sequence !== this.sequence) { pixels.release(); return; }
      this.pixels = pixels; this.sampled = value.sampled === true;
    } catch { if (sequence === this.sequence) this.failed = true; }
    finally { if (sequence === this.sequence) this.loading = false; }
  }

  draw(): void {
    const points = validPoints(this.trip.points);
    const ctx = this.canvas;
    const w = this.plotWidth;
    ctx.fillStyle = '#222326'; ctx.fillRect(0, 0, w, 190);
    ctx.strokeStyle = '#303237'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 190); ctx.stroke(); }
    for (let y = 0; y < 190; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    if (points.length < 2) return;
    let minLat = points[0].latitude; let maxLat = minLat; let minLng = points[0].longitude; let maxLng = minLng;
    points.forEach((p: Point) => { minLat = Math.min(minLat, p.latitude); maxLat = Math.max(maxLat, p.latitude); minLng = Math.min(minLng, p.longitude); maxLng = Math.max(maxLng, p.longitude); });
    const correction = Math.max(0.01, Math.cos((minLat + maxLat) / 2 * Math.PI / 180));
    const spanX = (maxLng - minLng) * correction; const spanY = maxLat - minLat;
    const scale = Math.min(Math.max(1, w - 64) / (spanX || 1e-8), 134 / (spanY || 1e-8));
    ctx.strokeStyle = '#7197E5'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    points.forEach((p: Point, i: number) => {
      const x = (w - spanX * scale) / 2 + (p.longitude - minLng) * correction * scale;
      const y = (190 - spanY * scale) / 2 + (maxLat - p.latitude) * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    [points[0], points[points.length - 1]].forEach((p: Point, i: number) => {
      const x = (w - spanX * scale) / 2 + (p.longitude - minLng) * correction * scale;
      const y = (190 - spanY * scale) / 2 + (maxLat - p.latitude) * scale;
      ctx.fillStyle = i ? '#71757D' : '#7197E5'; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFFFFF'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(i ? '终' : '起', x, y + 3);
    });
  }

  build() {
    Column({ space: 12 }) {
      if (this.pixels) {
        Image(this.pixels).width('100%').aspectRatio(1.5).objectFit(ImageFit.Contain)
          .onClick(() => this.dialog.open()).accessibilityText('腾讯街道地图，点击放大')
        Row() {
          Text('腾讯地图 · 起 → 终').fontColor('#F4F4F4').fontSize(12)
          Blank()
          Button('放大查看').backgroundColor(Color.Transparent).fontColor('#F4F4F4').onClick(() => this.dialog.open())
        }.width('100%')
        if (this.sampled) { Text('按采集轨迹抽样绘制，弯道及缺失采样处可能存在偏差。').fontColor('#9A9DA3').fontSize(12) }
      } else if (validPoints(this.trip.points).length > 1) {
        Canvas(this.canvas).width('100%').height(190)
          .onReady(() => this.draw()).onAreaChange((_old: Area, area: Area) => { this.plotWidth = Number(area.width); this.draw(); })
          .accessibilityText('行程轨迹示意，非街道地图')
        Text('轨迹示意 · 非街道地图').fontColor('#9A9DA3').fontSize(12)
        if (this.loading) { LoadingProgress().width(24).height(24).color('#00D68F') }
        if (this.failed) {
          Text('街道地图暂不可用，请检查服务配置或稍后重试。').fontSize(12).fontColor('#9A9DA3')
          Button('重试').backgroundColor('#333539').fontColor('#F4F4F4').onClick(() => this.load())
        }
      } else { Text('暂无轨迹坐标').fontColor('#9A9DA3').padding(40) }
    }.padding(12).width('100%').backgroundColor('#222326').borderRadius(12)
  }
}
