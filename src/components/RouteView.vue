<template>
  <view class="route-frame">
    <template v-if="streetMap">
      <image class="street-map" :src="streetMap.image" mode="widthFix" aria-label="腾讯街道地图，标注行程起终点及采集轨迹，点击放大" @click="previewMap" />
      <view class="route-caption"><text>腾讯地图 · 起 → 终</text><button hover-class="none" @click="previewMap">放大查看</button></view>
      <text v-if="streetMap.sampled" class="map-note">按采集轨迹抽样绘制，弯道及缺失采样处可能存在偏差。</text>
    </template>
    <template v-else-if="validPoints.length > 1">
      <canvas :id="canvasId" :canvas-id="canvasId" class="route-canvas" aria-label="行程轨迹示意" />
      <view class="route-caption"><text>轨迹示意</text><text>非街道地图</text></view>
      <view v-if="live" class="map-status"><text>{{ mapLoading ? '正在加载街道地图…' : '街道地图暂不可用，请检查服务配置或稍后重试。' }}</text><button v-if="!mapLoading" hover-class="none" @click="loadMap">重试</button></view>
    </template>
    <view v-else class="route-empty"><text class="empty-title">暂无轨迹坐标</text><text></text></view>
  </view>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { onResize } from '@dcloudio/uni-app'
import { fetchTripMap } from '../lib/client'

const props = defineProps<{ points: { latitude: number; longitude: number }[]; tripId?: number; live?: boolean }>()
const instance = getCurrentInstance()
const canvasId = `trip-route-${instance?.uid ?? 0}`
const validPoints = computed(() => props.points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && (p.latitude !== 0 || p.longitude !== 0)))
const streetMap = ref<{ image: string; sampled: boolean } | null>(null)
const mapLoading = ref(false)
let mapSequence = 0
async function loadMap() {
  const sequence = ++mapSequence
  streetMap.value = null
  mapLoading.value = false
  if (!props.live || !props.tripId || validPoints.value.length < 2) { void draw(); return }
  mapLoading.value = true
  try {
    const value = await fetchTripMap(props.tripId)
    if (sequence === mapSequence) streetMap.value = value
  } catch { if (sequence === mapSequence) void draw() }
  finally { if (sequence === mapSequence) mapLoading.value = false }
}
function previewMap() { if (streetMap.value) uni.previewImage({ urls: [streetMap.value.image] }) }

async function draw() {
  await nextTick()
  if (streetMap.value || validPoints.value.length < 2) return
  uni.createSelectorQuery().in(instance?.proxy).select(`#${canvasId}`).boundingClientRect((rect: any) => {
    if (!rect?.width) return
    const width = rect.width
    const height = 190
    const ctx = uni.createCanvasContext(canvasId, instance?.proxy)
    ctx.setFillStyle('#222326')
    ctx.fillRect(0, 0, width, height)
    ctx.setStrokeStyle('#303237')
    ctx.setLineWidth(1)
    for (let x = 0; x < width; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke() }
    for (let y = 0; y < height; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
    const latitudes = validPoints.value.map(p => p.latitude)
    const longitudes = validPoints.value.map(p => p.longitude)
    const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes)
    const minLng = Math.min(...longitudes), maxLng = Math.max(...longitudes)
    const correction = Math.max(0.01, Math.cos((minLat + maxLat) / 2 * Math.PI / 180))
    const spanX = (maxLng - minLng) * correction, spanY = maxLat - minLat
    const scale = Math.min((width - 64) / (spanX || 1e-8), (height - 56) / (spanY || 1e-8))
    const points = validPoints.value.map(p => ({ x: (width - spanX * scale) / 2 + (p.longitude - minLng) * correction * scale, y: (height - spanY * scale) / 2 + (maxLat - p.latitude) * scale }))
    ctx.setStrokeStyle('#7197e5')
    ctx.setLineWidth(4)
    ctx.setLineCap('round')
    ctx.setLineJoin('round')
    ctx.beginPath()
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
    ctx.stroke()
    const first = points[0], last = points[points.length - 1]
    ;[[first, '#7197e5', '起'], [last, '#71757d', '终']].forEach(([point, color, label]) => {
      const p = point as { x: number; y: number }
      ctx.setFillStyle(color as string)
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill()
      ctx.setFillStyle('#ffffff'); ctx.setFontSize(10); ctx.setTextAlign('center'); ctx.fillText(label as string, p.x, p.y + 3)
    })
    ctx.draw()
  }).exec()
}

onMounted(draw)
onResize(draw)
watch(() => props.points, draw, { deep: true })
watch([() => props.tripId, () => props.live, () => props.points], loadMap, { immediate: true })
onBeforeUnmount(() => { ++mapSequence })
</script>

<style scoped>
.route-frame{overflow:hidden;border-radius:var(--radius,8px);background:var(--surface)}.route-canvas{display:block;width:100%;height:190px}.route-caption{display:flex;justify-content:space-between;gap:10px;padding:8px 16px;color:var(--muted);font-size:12px}.route-caption text:first-child{color:var(--text);font-weight:600}.route-empty{display:flex;min-height:160px;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:20px;color:var(--muted);font-size:12px;text-align:center}.empty-title{color:var(--text);font-weight:600;font-size:15px}

.street-map{display:block;width:100%}.route-caption button,.map-status button{display:flex;align-items:center;justify-content:center;width:auto;min-height:44px;margin:0;padding:0 10px;border:0;border-radius:4px;background:transparent;color:var(--text);font-size:13px;line-height:1.5}.route-caption button::after,.map-status button::after{border:none}.route-caption button:active,.map-status button:active{opacity:.7}.route-caption button:focus-visible,.map-status button:focus-visible{outline:2px solid var(--charge);outline-offset:2px}.route-caption{align-items:center}.map-note{display:block;padding:0 16px 16px;font-size:12px;line-height:1.6;color:var(--muted)}.map-status{display:flex;align-items:center;gap:10px;padding:0 16px 16px;font-size:12px;line-height:1.6;color:var(--muted)}.map-status text{flex:1}.map-status button{flex-shrink:0}
</style>
