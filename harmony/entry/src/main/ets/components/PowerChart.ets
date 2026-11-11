import { PowerPoint, num, peakIndex, powerMaximum, progress } from '../data/Model';

@Component
export struct PowerChart {
  @Prop @Watch('resetSelection') points: PowerPoint[] = [];
  @State selected: number = 0;
  private canvas: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private plotWidth: number = 1;

  aboutToAppear(): void { this.resetSelection(); }
  resetSelection(): void { this.selected = peakIndex(this.points); this.draw(); }
  maximum(): number { return powerMaximum(this.points.length ? this.points[peakIndex(this.points)].powerKw : 0); }
  select(index: number): void {
    this.selected = Math.max(0, Math.min(this.points.length - 1, Math.round(index)));
    this.draw();
  }
  draw(): void {
    const ctx = this.canvas;
    const w = this.plotWidth;
    ctx.clearRect(0, 0, w, 160);
    ctx.strokeStyle = '#44464B'; ctx.lineWidth = 1;
    for (let y = 0; y <= 160; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    if (!this.points.length) return;
    const maximum = this.maximum();
    const step = w / this.points.length;
    ctx.fillStyle = '#00D68F';
    this.points.forEach((point: PowerPoint, i: number) => {
      const height = progress(point.powerKw / maximum * 100) * 1.6;
      ctx.fillRect(i * step, 160 - height, Math.max(1, step), height);
    });
    const x = (this.selected + 0.5) * step;
    const y = 160 - progress(this.points[this.selected].powerKw / maximum * 100) * 1.6;
    ctx.strokeStyle = '#F4F4F4'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 160); ctx.stroke();
    ctx.fillStyle = '#F4F4F4'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }
  build() {
    Column({ space: 16 }) {
      Row() {
        Text('充电功率').fontSize(17).fontWeight(FontWeight.Medium).fontColor('#F4F4F4')
        Blank()
        Text(`峰值 ${this.points.length ? num(this.points[peakIndex(this.points)].powerKw, 1) : '--'} kW`).fontSize(12).fontColor('#9A9DA3')
      }.width('100%')
      if (this.points.length) {
        Row() {
          Text(`第 ${num(this.points[this.selected]?.minute, 1)} 分钟`).fontColor('#9A9DA3').fontSize(13)
          Blank()
          Text(`${num(this.points[this.selected]?.powerKw, 1)} kW`).fontColor('#F4F4F4').fontSize(24)
        }.width('100%')
        Row({ space: 10 }) {
          Column() {
            Text(String(this.maximum())).fontSize(11).fontColor('#9A9DA3')
            Blank()
            Text(String(this.maximum() / 2)).fontSize(11).fontColor('#9A9DA3')
            Blank()
            Text('0').fontSize(11).fontColor('#9A9DA3')
          }.width(34).height(160).alignItems(HorizontalAlign.End)
          Canvas(this.canvas)
            .height(160).layoutWeight(1)
            .onReady(() => this.draw())
            .onAreaChange((_old: Area, area: Area) => { this.plotWidth = Number(area.width); this.draw(); })
            .onClick((event: ClickEvent) => this.select(event.x / this.plotWidth * this.points.length))
            .accessibilityText('充电功率曲线，使用下方滑块选择采样点')
        }.width('100%')
        Row() {
          Text(`${num(this.points[0].minute)} min`).fontSize(12).fontColor('#9A9DA3')
          Blank()
          Text(`${num(this.points[this.points.length - 1].minute)} min`).fontSize(12).fontColor('#9A9DA3')
        }.width('100%').padding({ left: 44 })
        Slider({ value: this.selected, min: 0, max: Math.max(1, this.points.length - 1), step: 1 })
          .selectedColor('#00D68F').trackColor('#51545B').blockColor('#F4F4F4')
          .enabled(this.points.length > 1)
          .onChange((value: number) => this.select(value))
          .accessibilityText(`选择功率采样点，第 ${num(this.points[this.selected]?.minute, 1)} 分钟，${num(this.points[this.selected]?.powerKw, 1)} 千瓦`)
        Text('点击曲线或拖动滑块查看数值').fontSize(12).fontColor('#9A9DA3')
      } else {
        Text('这次充电没有可用的功率采样。').fontSize(14).fontColor('#9A9DA3').padding(24)
      }
    }.padding(18).width('100%').backgroundColor('#222326').borderRadius(12)
  }
}
