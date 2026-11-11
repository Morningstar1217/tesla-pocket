<template>
  <view class="app-shell" :class="{ 'harmony-shell': isHarmony }">
    <!-- #ifndef APP-HARMONY -->
    <view class="topbar">
      <view class="brand"><view class="brand-mark"><view /><view /><view /></view><view><text class="brand-name">车迹</text></view></view>
      <button hover-class="button-pressed" class="refresh-button" :disabled="loading" :aria-busy="loading" :aria-label="loading ? '正在刷新车辆数据' : '刷新车辆数据'" @click="refresh"><view v-if="loading" class="loading-dot" aria-hidden="true" /><image v-else class="control-glyph" src="/static/icons/tabler/refresh.svg" mode="aspectFit" aria-hidden="true" /></button>
    </view>

    <!-- #endif -->
    <!-- #ifdef APP-HARMONY -->
    <view class="harmony-status-bar" />
    <HarmonyMotion :context="tab + ':' + (detailKind || '')" @visibility="onNavigationVisibility" />
    <!-- #endif -->
    <view v-if="detailKind" class="page-body detail-page">
      <button hover-class="button-pressed" class="back-button" @click="closeDetail"><image class="control-chevron back-chevron" src="/static/icons/tabler/chevron-down.svg" mode="aspectFit" aria-hidden="true" /><text>返回{{ tab === 'vehicle' ? '车况' : detailKind === 'trip' ? '行程' : '充电' }}</text></button>
      <view class="page-heading"><text class="page-title">{{ detailKind === 'trip' ? '行程详情' : '充电详情' }}</text></view>
      <view v-if="detailLoading" class="detail-loading" aria-busy="true">
        <view class="loading-status" role="status" aria-live="polite"><view class="loading-dot" aria-hidden="true" /><text>正在读取详情…</text></view>
        <view class="loading-body" aria-hidden="true"><view class="card loading-detail-summary"><view class="skeleton sk-route" /><view class="skeleton sk-route" /><view class="skeleton sk-label" /></view><view class="loading-metrics"><view v-for="i in 4" :key="i"><view class="skeleton sk-label" /><view class="skeleton sk-value" /></view></view></view>
      </view>
      <view v-else-if="detailError" class="status-card error-card"><text class="status-title">详情读取失败</text><text>{{ detailError }}</text><button hover-class="button-pressed" class="primary-button" @click="openDetail(detailKind!, detailId!)">重新加载</button></view>
      <template v-else-if="selectedTrip">
        <view class="card detail-summary"><view class="route-place"><view class="place-dot origin" /><text>{{ selectedTrip.from || '未知起点' }}</text></view><view class="place-connector" /><view class="route-place"><view class="place-dot destination" /><text>{{ selectedTrip.to || '未知终点' }}</text></view><text class="muted detail-date">{{ dateTime(selectedTrip.startedAt) }} → {{ selectedTrip.endedAt ? dateTime(selectedTrip.endedAt) : '尚未结束' }}</text></view>
        <view class="metrics-grid"><view class="card metric"><text class="metric-label">行驶距离</text><text class="metric-value">{{ num(selectedTrip.distanceKm, 1) }}<text class="unit"> km</text></text></view><view class="card metric"><text class="metric-label">行驶时长</text><text class="metric-value metric-small">{{ duration(selectedTrip.durationMin) }}</text></view><view class="card metric"><text class="metric-label">估算能耗</text><text class="metric-value">{{ energyValue(selectedTrip.energyKwh) }}<text v-if="selectedTrip.energyKwh != null" class="unit"> kWh</text></text></view><view class="card metric"><text class="metric-label">平均能耗</text><text class="metric-value">{{ energyValue(selectedTrip.efficiencyWhKm, 0) }}<text v-if="selectedTrip.efficiencyWhKm != null" class="unit"> Wh/km</text></text></view></view>
        <view class="section-heading"><text>行驶轨迹</text></view><RouteView :points="selectedTrip.points" :trip-id="selectedTrip.id" :live="!isDemo" />
        <text v-if="isDemo" class="footnote">演示行程</text>
        <template v-if="!isDemo && selectedTrip.energyKwh == null"><button hover-class="button-pressed" class="help-toggle" :aria-expanded="showEnergyHelp" @click="showEnergyHelp = !showEnergyHelp">能耗待校准 · {{ showEnergyHelp ? '收起说明' : '查看原因' }}</button><text v-if="showEnergyHelp" class="footnote">{{ energyHint }}</text></template>
      </template>
      <template v-else-if="selectedCharge">
        <view class="card detail-summary"><view class="row-between"><view class="charge-kind" :class="selectedCharge.kind.toLowerCase()">{{ chargeKind(selectedCharge.kind) }}</view><text class="muted">{{ selectedCharge.endedAt ? '已完成' : '进行中' }}</text></view><text class="detail-location">{{ selectedCharge.location || '未知充电地点' }}</text><text class="muted">{{ dateTime(selectedCharge.startedAt) }}</text><view class="charge-percent"><text>{{ num(selectedCharge.startPct) }}%</text><view class="percent-bridge">→</view><text>{{ num(selectedCharge.endPct) }}%</text></view><view class="battery-track light-track"><view :style="{ width: progress(selectedCharge.endPct) + '%' }" /></view></view>
        <view class="metrics-grid"><view class="card metric"><text class="metric-label">充入电量</text><text class="metric-value">{{ num(selectedCharge.energyKwh, 1) }}<text class="unit"> kWh</text></text></view><view class="card metric"><text class="metric-label">充电时长</text><text class="metric-value metric-small">{{ duration(selectedCharge.durationMin) }}</text></view><view class="card metric"><text class="metric-label">充电费用</text><text class="metric-value">{{ money(effectiveChargeCost(selectedCharge)) }}</text><text v-if="selectedCostEntry" class="cost-source">{{ selectedCostEntry.mode === 'total' ? '手动填写' : '按单价计算' }}</text><button hover-class="button-pressed" class="cost-edit-button" :aria-expanded="editingCost" @click="editChargeCost">{{ selectedCostEntry ? '修改费用' : '填写费用' }}</button></view><view class="card metric"><text class="metric-label">峰值功率</text><text class="metric-value">{{ num(peakPower, 1) }}<text class="unit"> kW</text></text></view></view>
        <view v-if="editingCost" class="card cost-editor">
          <text class="card-title">本次充电费用</text>
          <view class="filter-row cost-modes"><button hover-class="button-pressed" :class="{ active: costForm.mode === 'total' }" @click="setCostMode('total')">填写总费用</button><button hover-class="button-pressed" :class="{ active: costForm.mode === 'rate' }" @click="setCostMode('rate')">按单价计算</button></view>
          <label class="field-label" for="charge-cost-input">{{ costForm.mode === 'total' ? '总费用（元）' : '充电单价（元/度）' }}</label>
          <input id="charge-cost-input" v-model="costForm.value" class="field-input" type="digit" :maxlength="12" :aria-label="costForm.mode === 'total' ? '总费用（元）' : '充电单价（元/度）'" :placeholder="costForm.mode === 'total' ? '例如 38.50' : '例如 1.20'" />
          <text v-if="costForm.mode === 'rate'" class="field-help">{{ num(selectedCharge.energyKwh, 3) }} 度 × 单价，合计 {{ money(costPreview) }}</text>
          <text class="field-help">人民币，仅保存在当前设备。</text>
          <view v-if="costError" class="form-error">{{ costError }}</view>
          <button hover-class="button-pressed" class="primary-button" @click="saveCost(false)">保存费用</button>
          <view class="cost-actions"><button hover-class="button-pressed" class="text-button" @click="editingCost = false">取消</button><button v-if="selectedCostEntry" hover-class="button-pressed" class="text-button" @click="saveCost(true)">恢复采集费用</button></view>
        </view>
        <text v-if="costMessage" class="field-help">{{ costMessage }}</text>
        <view class="card curve-card">
          <view class="section-heading"><text>充电功率</text><text class="section-note">峰值 {{ num(peakPower, 1) }} kW</text></view>
          <template v-if="selectedCharge.curve.length">
            <view class="curve-reading"><text>第 {{ num(selectedCurvePoint?.minute, 1) }} 分钟</text><text class="curve-power">{{ num(selectedCurvePoint?.powerKw, 1) }}<text class="unit"> kW</text></text></view>
            <view class="curve-layout">
              <view class="power-axis"><text>{{ curveMaximum }}</text><text>{{ curveMaximum / 2 }}</text><text>0</text></view>
              <view class="curve-chart" aria-label="充电功率曲线，点击查看采样数值">
                <view v-for="(point, i) in selectedCharge.curve" :key="i" class="curve-column" @click="selectedCurveIndex = i"><view class="curve-bar" :style="{ height: curveHeight(point.powerKw) + '%' }" /></view>
                <view class="curve-guide" :style="{ left: curveSelectionLeft + '%' }" />
                <view class="curve-point" :style="{ left: curveSelectionLeft + '%', bottom: curveHeight(selectedCurvePoint?.powerKw ?? 0) + '%' }" />
              </view>
            </view>
            <view class="chart-axis"><text>{{ num(selectedCharge.curve[0].minute) }} min</text><text>{{ num(selectedCharge.curve[selectedCharge.curve.length - 1].minute) }} min</text></view>
            <slider class="curve-slider" :value="selectedCurveIndex" :min="0" :max="Math.max(1, selectedCharge.curve.length - 1)" :step="1" :disabled="selectedCharge.curve.length < 2" :block-size="14" activeColor="#00d68f" backgroundColor="#51545b" block-color="#f4f4f4" aria-label="选择充电功率采样点" role="slider" tabindex="0" aria-valuemin="0" :aria-valuemax="selectedCharge.curve.length - 1" :aria-valuenow="selectedCurveIndex" :aria-valuetext="'第 ' + num(selectedCurvePoint?.minute, 1) + ' 分钟，' + num(selectedCurvePoint?.powerKw, 1) + ' kW'" @keydown.left.prevent="selectCurvePoint({ detail: { value: selectedCurveIndex - 1 } })" @keydown.right.prevent="selectCurvePoint({ detail: { value: selectedCurveIndex + 1 } })" @keydown.home.prevent="selectedCurveIndex = 0" @keydown.end.prevent="selectedCurveIndex = selectedCharge.curve.length - 1" @changing="selectCurvePoint" @change="selectCurvePoint" />
            <text class="curve-hint">点击曲线或拖动滑块查看数值</text>
            <text v-if="isDemo" class="footnote">演示功率曲线</text>
          </template>
          <view v-else class="compact-empty">这次充电没有可用的功率采样。</view>
        </view>
      </template>
    </view>

    <view v-else class="page-body">
      <view v-if="isDemo && tab !== 'settings'" class="source-strip demo-strip"><view class="source-dot" /><text>演示数据</text><button hover-class="button-pressed" @click="switchTab('settings')">连接实车 →</button></view>
      <view v-if="error && tab !== 'settings'" class="error-banner"><text>{{ error }}</text><button hover-class="button-pressed" :disabled="loading" @click="refresh">重试</button></view>
      <view v-if="loading && !snapshot && tab !== 'settings'" class="initial-loading" aria-busy="true">
        <view class="loading-body" aria-hidden="true">
          <template v-if="tab === 'vehicle'">
            <view class="loading-heading"><view class="skeleton sk-name" /><view class="skeleton sk-status" /></view>
            <view class="skeleton sk-model" />
            <view class="loading-battery"><view class="skeleton sk-number" /><view class="skeleton sk-label" /></view>
            <view class="car-scene loading-car"><image class="car-image" src="/static/model-y.png" mode="aspectFit" /></view>
            <view class="skeleton sk-track" />
            <view class="loading-metrics"><view v-for="i in 2" :key="i"><view class="skeleton sk-value" /><view class="skeleton sk-label" /></view></view>
          </template>
          <template v-else>
            <view class="page-heading"><text class="page-title">{{ tab === 'charges' ? '充电' : '行程' }}</text></view>
            <view class="loading-filters"><view v-for="i in 3" :key="i" class="skeleton" /></view>
            <view class="loading-metrics"><view v-for="i in 2" :key="i"><view class="skeleton sk-label" /><view class="skeleton sk-value" /></view></view>
          </template>
        </view>
        <view class="loading-status" role="status" aria-live="polite"><view class="loading-dot" aria-hidden="true" /><text>{{ tab === 'vehicle' ? '正在读取车辆数据…' : tab === 'charges' ? '正在读取充电记录…' : '正在读取行程记录…' }}</text></view>
        <view v-if="tab === 'vehicle'" class="loading-body loading-rows" aria-hidden="true"><view v-for="i in 3" :key="i" class="loading-row"><view class="loading-row-name"><view class="skeleton sk-icon" /><view class="skeleton sk-row-label" /></view><view class="skeleton sk-status" /></view></view>
        <view v-else class="loading-body loading-records" aria-hidden="true"><view v-for="i in 3" :key="i" class="loading-record"><view class="skeleton sk-label" /><view class="skeleton sk-route" /><view class="skeleton sk-status" /></view></view>
      </view>
      <view v-else-if="!snapshot && tab !== 'settings'" class="status-card"><text class="status-title">暂时没有车辆数据</text><text>请检查连接设置，或切换到演示模式体验。</text><button hover-class="button-pressed" class="primary-button" @click="switchTab('settings')">前往设置</button></view>

      <template v-else-if="snapshot && tab === 'vehicle'">

        <view class="vehicle-hero"><view class="hero-top"><view class="hero-identity"><text class="hero-name">{{ snapshot.vehicle.name || '我的爱车' }}</text><text class="hero-model">{{ snapshot.vehicle.model || 'TESLA' }}</text></view><view class="state-badge"><view class="state-dot" :class="snapshot.vehicle.state" /><text>{{ stateLabels[snapshot.vehicle.state] || '状态未知' }}</text></view></view><view class="hero-center"><view class="battery-reading"><text class="hero-battery">{{ num(snapshot.vehicle.batteryPct) }}<text class="hero-percent">%</text></text><text class="hero-caption">当前电量</text></view><view class="car-scene" aria-hidden="true"><image class="car-image" src="/static/model-y.png" mode="aspectFit" /></view></view><view class="battery-track"><view :style="{ width: progress(snapshot.vehicle.batteryPct) + '%' }" /></view><view class="hero-bottom"><view><text class="range-number">{{ num(snapshot.vehicle.rangeKm) }}<text class="range-unit"> km</text></text><text class="hero-caption">预计续航</text></view><view class="hero-divider" /><view><text class="odometer-number">{{ num(snapshot.vehicle.odometerKm) }}<text class="range-unit"> km</text></text><text class="hero-caption">累计里程</text></view></view><view class="hero-observed"><view class="tiny-dot" /><text>{{ isDemo ? '演示数据' : snapshot.vehicle.observedAt ? '采样于 ' + dateTime(snapshot.vehicle.observedAt) : '最近采集 · 采样时间未知' }}</text></view></view>

        <view class="card charging-card"><view v-if="snapshot.vehicle.charging" class="charge-icon"><image class="control-glyph" src="/static/icons/tabler/battery-charging.svg" mode="aspectFit" aria-hidden="true" /></view><view class="charging-copy"><text class="card-title">{{ snapshot.vehicle.charging ? '正在充电' : '最近位置' }}</text><text class="muted">{{ snapshot.vehicle.locationName || '位置未知' }}</text></view><view v-if="snapshot.vehicle.charging" class="charge-power"><text>{{ num(snapshot.vehicle.charging.powerKw, 1) }}<text class="unit"> kW</text></text><text class="muted">{{ snapshot.vehicle.charging?.remainingMin != null ? '剩余 ' + duration(snapshot.vehicle.charging.remainingMin) : '充电功率' }}</text></view></view>

        <view class="section-heading"><text>车况细节</text></view>
        <view class="vehicle-status">
          <view class="status-row">
            <image class="status-glyph" :src="snapshot.vehicle.locked === false ? '/static/icons/tabler/lock-open.svg' : '/static/icons/tabler/lock.svg'" mode="aspectFit" aria-hidden="true" />
            <view class="status-copy"><text class="status-name">门锁</text><view class="status-note"><image class="status-glyph" src="/static/icons/tabler/shield.svg" mode="aspectFit" aria-hidden="true" /><text>哨兵模式 {{ booleanLabel(snapshot.vehicle.sentry, '已开启', '已关闭') }}</text></view></view>
            <text class="status-reading" :class="{ 'status-alert': snapshot.vehicle.locked === false }">{{ booleanLabel(snapshot.vehicle.locked, '已锁车', '未锁车') }}</text>
          </view>
          <view class="status-row">
            <image class="status-glyph" src="/static/icons/tabler/temperature.svg" mode="aspectFit" aria-hidden="true" />
            <view class="status-copy"><text class="status-name">温度</text><text class="status-note">车内 / 车外 · °C</text></view>
            <text class="status-reading temperature-reading">{{ num(snapshot.vehicle.insideTempC, 1) }}°<text class="temp-divider"> / </text>{{ num(snapshot.vehicle.outsideTempC, 1) }}°</text>
          </view>
          <view class="status-row">
            <image class="status-glyph" src="/static/icons/tabler/car-door.svg" mode="aspectFit" aria-hidden="true" />
            <view class="status-copy"><text class="status-name">车窗</text></view>
            <text class="status-reading" :class="{ 'status-alert': snapshot.vehicle.openings?.windows === true }">{{ booleanLabel(snapshot.vehicle.openings?.windows, '有车窗开启', '全部关闭') }}</text>
          </view>
          <view class="status-row">
            <image class="status-glyph" src="/static/icons/tabler/car-fan.svg" mode="aspectFit" aria-hidden="true" />
            <view class="status-copy"><text class="status-name">空调</text><text class="status-note">预调节 {{ booleanLabel(snapshot.vehicle.climate?.preconditioning, '已开启', '已关闭') }}</text></view>
            <text class="status-reading">{{ booleanLabel(snapshot.vehicle.climate?.on, '已开启', '已关闭') }}</text>
          </view>
        </view>
        <view class="access-card"><button class="disclosure-button" hover-class="none" :aria-expanded="showAccess" @click="showAccess = !showAccess"><view class="access-title"><image class="status-glyph" src="/static/icons/tabler/car.svg" mode="aspectFit" aria-hidden="true" /><text class="status-name">车门与行李箱</text></view><view class="disclosure-end"><text class="access-summary" :class="{ attention: accessLabel !== '全部关闭' }">{{ accessLabel }}</text><image class="status-glyph disclosure-chevron" src="/static/icons/tabler/chevron-down.svg" mode="aspectFit" :class="{ expanded: showAccess }" aria-hidden="true" /></view></button><view v-if="showAccess" class="access-grid"><view v-for="point in accessPoints" :key="point.key" class="access-row"><text>{{ point.label }}</text><text :class="{ 'is-open': snapshot.vehicle.openings?.[point.key] === true }">{{ booleanLabel(snapshot.vehicle.openings?.[point.key], '已打开', '已关闭') }}</text></view></view></view>

        <view class="tyre-card"><view class="tyre-heading"><view class="access-title"><image class="status-glyph" src="/static/icons/tabler/gauge.svg" mode="aspectFit" aria-hidden="true" /><text class="status-name">胎压监测</text></view><text class="muted">bar</text></view><view class="tyre-layout"><view class="tyre-column"><view class="tyre-point"><text>{{ num(snapshot.vehicle.tyres.fl, 1) }}</text><text class="tyre-corner">左前</text></view><view class="tyre-point"><text>{{ num(snapshot.vehicle.tyres.rl, 1) }}</text><text class="tyre-corner">左后</text></view></view><image class="tyre-vehicle" src="/static/vehicle-top.svg" mode="aspectFit" aria-hidden="true" /><view class="tyre-column"><view class="tyre-point"><text>{{ num(snapshot.vehicle.tyres.fr, 1) }}</text><text class="tyre-corner">右前</text></view><view class="tyre-point"><text>{{ num(snapshot.vehicle.tyres.rr, 1) }}</text><text class="tyre-corner">右后</text></view></view></view></view>
        <view class="section-heading"><text>最近一程</text><button hover-class="button-pressed" class="text-button" @click="switchTab('trips')"><text>查看全部</text><image class="control-chevron" src="/static/icons/tabler/chevron-down.svg" mode="aspectFit" aria-hidden="true" /></button></view>
        <button hover-class="button-pressed" v-if="snapshot.trips.length" class="card trip-card record-button" @click="openDetail('trip', snapshot.trips[0].id)"><view class="record-top"><text class="record-date">{{ dateTime(snapshot.trips[0].startedAt) }}</text><image class="record-chevron" src="/static/icons/tabler/chevron-down.svg" mode="aspectFit" aria-hidden="true" /></view><view class="trip-locations"><text>{{ shortAddress(snapshot.trips[0].from) || '未知起点' }}</text><text class="trip-arrow">→</text><text>{{ shortAddress(snapshot.trips[0].to) || '未知终点' }}</text></view><view class="record-footer"><text><text class="record-number">{{ num(snapshot.trips[0].distanceKm, 1) }}</text> km</text><text>{{ duration(snapshot.trips[0].durationMin) }}</text><text>{{ energyValue(snapshot.trips[0].energyKwh) }}<text v-if="snapshot.trips[0].energyKwh != null"> kWh</text></text></view></button><view v-else class="card compact-empty">暂无行程</view>
      </template>

      <template v-else-if="snapshot && (tab === 'charges' || tab === 'trips')">
        <view class="page-heading"><text class="page-title">{{ tab === 'charges' ? '充电' : '行程' }}</text></view>
        <view class="filter-row"><button hover-class="button-pressed" v-for="period in periods" :key="period.value" :class="{ active: range === period.value }" @click="range = period.value">{{ period.label }}</button></view>
        <view v-if="tab === 'charges'" class="summary-panel"><view><text class="summary-label">充入电量</text><text class="summary-number">{{ num(totalEnergy(filteredCharges), 1) }}<text> kWh</text></text></view><view><text class="summary-label">充电费用</text><text class="summary-number smaller">{{ chargeTotalCost }}</text></view><view class="summary-bottom"><text>{{ filteredCharges.length }} 次充电</text><text>{{ rangeLabel }} · 仅合计有值记录</text></view></view>
        <view v-else class="summary-panel"><view><text class="summary-label">累计行驶</text><text class="summary-number">{{ num(sumKnown(filteredTrips.map(t => t.distanceKm)), 1) }}<text> km</text></text></view><view><text class="summary-label">估算能耗</text><text class="summary-number smaller">{{ filteredTrips.length ? energyValue(totalEnergy(filteredTrips)) : '--' }}<text v-if="totalEnergy(filteredTrips) != null"> kWh</text></text></view><view class="summary-bottom"><text>{{ filteredTrips.length }} 次行程</text><text>{{ rangeLabel }} · 仅合计有值记录</text></view></view>
        <view class="section-heading"><text>{{ tab === 'charges' ? '补能记录' : '行程记录' }}</text></view>
        <template v-if="tab === 'charges'"><button hover-class="button-pressed" v-for="charge in filteredCharges" :key="charge.id" class="card record-button charge-record" @click="openDetail('charge', charge.id)"><view class="record-top"><view class="charge-kind" :class="charge.kind.toLowerCase()">{{ chargeKind(charge.kind) }}</view><text class="record-date">{{ dateTime(charge.startedAt) }}</text><image class="record-chevron" src="/static/icons/tabler/chevron-down.svg" mode="aspectFit" aria-hidden="true" /></view><text class="record-location">{{ charge.location || '未知充电地点' }}</text><view class="record-footer"><text><text class="record-number">{{ num(charge.energyKwh, 1) }}</text> kWh</text><text>{{ num(charge.startPct) }}% → {{ num(charge.endPct) }}%</text><text class="record-cost">{{ money(effectiveChargeCost(charge)) }}</text></view></button><view v-if="!filteredCharges.length" class="card empty-records"><view class="empty-symbol"><image class="empty-glyph" src="/static/icons/tabler/battery-charging.svg" mode="aspectFit" aria-hidden="true" /></view><text class="status-title">暂无充电记录</text><text>可切换时间范围</text></view></template>
        <template v-else><button hover-class="button-pressed" v-for="trip in filteredTrips" :key="trip.id" class="card record-button trip-card" @click="openDetail('trip', trip.id)"><view class="record-top"><text class="record-date">{{ dateTime(trip.startedAt) }}</text><image class="record-chevron" src="/static/icons/tabler/chevron-down.svg" mode="aspectFit" aria-hidden="true" /></view><view class="trip-locations"><text>{{ shortAddress(trip.from) || '未知起点' }}</text><text class="trip-arrow">→</text><text>{{ shortAddress(trip.to) || '未知终点' }}</text></view><view class="record-footer"><text><text class="record-number">{{ num(trip.distanceKm, 1) }}</text> km</text><text>{{ duration(trip.durationMin) }}</text><text>{{ energyValue(trip.energyKwh) }}<text v-if="trip.energyKwh != null"> kWh</text></text></view></button><view v-if="!filteredTrips.length" class="card empty-records"><view class="empty-symbol"><image class="empty-glyph" src="/static/icons/tabler/route.svg" mode="aspectFit" aria-hidden="true" /></view><text class="status-title">暂无行程记录</text><text>可切换时间范围</text></view></template>
        <text class="scope-note">{{ isDemo ? '演示记录' : '近 30 天 · 最多 100 条已加载记录' }}</text>
      </template>

      <template v-else-if="tab === 'settings'">
        <view class="page-heading"><text class="page-title">设置</text></view>
        <view class="card settings-card"><text class="card-title">数据连接</text><view class="mode-options"><button hover-class="button-pressed" :class="{ selected: form.mode === 'demo' }" @click="form.mode = 'demo'"><view class="mode-heading"><text>演示数据</text><view class="radio-dot" /></view></button><button hover-class="button-pressed" :class="{ selected: form.mode === 'live' }" @click="form.mode = 'live'"><view class="mode-heading"><text>连接实车</text><view class="radio-dot" /></view></button></view>
          <template v-if="form.mode === 'live'"><view class="field"><text class="field-label">服务地址</text><input v-model="form.baseUrl" class="field-input" placeholder="HTTPS 地址或局域网 IP" :maxlength="512" aria-label="服务地址" /></view><view class="field"><text class="field-label">访问令牌</text><input v-model="form.token" class="field-input" password placeholder="应用访问令牌" :maxlength="512" aria-label="应用访问令牌" /><text class="field-help">勿填写 Tesla 密码或 Tesla 令牌。</text></view></template>
          <view v-if="settingsError" class="form-error">{{ settingsError }}</view><view v-if="settingsMessage" class="form-success">{{ settingsMessage }}</view><button hover-class="button-pressed" class="primary-button" :disabled="saving" :loading="saving" @click="applySettings(false)">保存设置</button><button hover-class="button-pressed" v-if="form.mode === 'live'" class="secondary-button" :disabled="saving" :loading="saving" @click="applySettings(true)">测试连接</button>
        </view>
        <view class="card settings-info"><view class="row-between"><text class="card-title">当前连接</text><view class="small-badge">{{ savedMode === 'demo' ? '演示' : '实车' }}</view></view><view class="info-row"><text>数据来源</text><text>{{ snapshot ? (snapshot.source === 'demo' ? '示例数据' : 'TeslaMate') : '尚未获取' }}</text></view><view class="info-row"><text>采样时间</text><text>{{ snapshot?.vehicle.observedAt ? dateTime(snapshot.vehicle.observedAt) : '未知' }}</text></view><view class="info-row"><text>访问范围</text><text>只读</text></view></view>
        <view class="card settings-info"><button class="disclosure-button" hover-class="none" :aria-expanded="showDataHelp" @click="showDataHelp = !showDataHelp"><text class="card-title">连接帮助与数据说明</text><text class="disclosure-arrow">{{ showDataHelp ? '−' : '+' }}</text></button><view v-if="showDataHelp" class="help-content"><text>手机与 Mac 连接同一 Wi-Fi，使用 Mac 的局域网 IP；127.0.0.1 仅限本机。局域网 HTTP 只用于可信网络调试，远程连接使用 HTTPS。</text>
<!-- #ifdef MP-WEIXIN -->
<text>如微信提示域名校验失败，请使用开发者工具的真机调试或在手机端打开调试。正式使用需配置 HTTPS 合法域名。</text>
<!-- #endif -->
<text>访问令牌保存在当前设备。只连接你信任的服务；Tesla 凭证始终留在采集服务中。</text><text>显示最近采集状态；休眠或离线时可能不会更新。采样时间未知不代表数据刚刚上报。</text><text>{{ energyHint }}</text><text v-for="(notice, i) in snapshot?.notices || []" :key="i">{{ notice }}</text><text>独立个人项目，与 Tesla 无关联。</text></view><button hover-class="button-pressed" class="reset-button" :disabled="saving" @click="restoreDemo">清除连接，恢复演示</button></view>
        <view class="about-note"><text>车迹 · 1.3.4</text></view>
      </template>

      <template v-if="!isDemo && snapshot && tab === 'trips' && filteredTrips.some(trip => trip.energyKwh == null)"><button hover-class="button-pressed" class="help-toggle" :aria-expanded="showEnergyHelp" @click="showEnergyHelp = !showEnergyHelp">能耗待校准 · {{ showEnergyHelp ? '收起说明' : '查看原因' }}</button><text v-if="showEnergyHelp" class="footnote">{{ energyHint }}</text></template>
    </view>

    <!-- #ifdef APP-HARMONY -->
    <view v-if="!detailKind && !keyboardVisible" class="harmony-nav-area" :class="{ 'nav-hidden': navigationHidden }">
      <embed tag="cheji-navigation" class="harmony-navigation" :options="nativeNavigationOptions" @tabchange="onNativeTabChange" />
    </view>
    <!-- #endif -->
    <!-- #ifndef APP-HARMONY -->
    <view v-if="!detailKind" class="bottom-nav"><button hover-class="button-pressed" v-for="item in tabs" :key="item.id" :class="{ active: tab === item.id }" :aria-label="item.label" @click="switchTab(item.id)"><image class="nav-glyph" :src="'/static/icons/tabler/' + ({ vehicle: 'car', charges: 'battery-charging', trips: 'route', settings: 'settings' }[item.id]) + '.svg'" mode="aspectFit" aria-hidden="true" /><text>{{ item.label }}</text></button></view>
    <!-- #endif -->
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { onBackPress, onLoad, onPullDownRefresh, onUnload } from '@dcloudio/uni-app'
import RouteView from '../../components/RouteView.vue'
import type { Snapshot, Trip, Charge } from '../../../shared/types'
import { getSettings, saveSettings, resetSettings, fetchSnapshot, fetchTrip, fetchCharge, fetchTripLocations } from '../../lib/client'
import { num, energyValue, dateTime, duration, shortAddress, stateLabels, openingSummary } from '../../lib/format'

import { chargeCost, chargeCostKey, parseChargeCost, loadChargeCosts, saveChargeCosts, type ChargeCosts } from '../../lib/charge-cost'

import { powerAxisMaximum, powerHeight } from '../../lib/charge-curve'

import { tabs, tabForNativeIndex, type Tab } from '../../lib/navigation'
let isHarmony = false
// #ifdef APP-HARMONY
import '../../styles/harmony.css'
import HarmonyMotion from '../../components/HarmonyMotion.vue'
isHarmony = true
// #endif
const keyboardVisible = ref(false)
const navigationHidden = ref(false)
function onNavigationVisibility(hidden: boolean) {
  if (typeof hidden === 'boolean' && !detailKind.value) navigationHidden.value = hidden
}
function revealNavigation() { navigationHidden.value = false }
const handleKeyboard = (event: { height: number }) => { keyboardVisible.value = event.height > 0 }

const energyHint = '能耗待校准：TeslaMate 需要至少两次超过 10 分钟、且电量低于 95% 的充电记录。校准后会自动估算历史行程；采样不足的行程仍可能暂无数据。'
const accessPoints = [{ key: 'driverFront', label: '主驾车门' }, { key: 'passengerFront', label: '副驾车门' }, { key: 'driverRear', label: '主驾后门' }, { key: 'passengerRear', label: '副驾后门' }, { key: 'frunk', label: '前备箱' }, { key: 'trunk', label: '后备箱' }] as const
const periods = [{ value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }, { value: 0, label: '全部已加载' }]
const tab = ref<Tab>('vehicle')
const nativeNavigationOptions = computed(() => ({ index: tabs.findIndex(item => item.id === tab.value), hidden: navigationHidden.value }))
function onNativeTabChange(event: { detail?: { index?: unknown } }) {
  const target = tabForNativeIndex(event?.detail?.index)
  if (target) switchTab(target)
}
const range = ref(7)
const showAccess = ref(false)
const showDataHelp = ref(false)
const showEnergyHelp = ref(false)
const snapshot = ref<Snapshot | null>(null)
const accessLabel = computed(() => openingSummary(accessPoints.map(point => snapshot.value?.vehicle.openings?.[point.key])))
const loading = ref(false)
const error = ref('')
const form = reactive({ ...getSettings() })
const savedMode = ref(form.mode)
const saving = ref(false)
const settingsError = ref('')
const settingsMessage = ref('')
const detailKind = ref<'trip' | 'charge' | null>(null)
const detailId = ref<number | null>(null)
const selectedTrip = ref<Trip | null>(null)
const selectedCharge = ref<Charge | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const locatedTrips = new WeakSet<Trip>()
let locationQueue: { trip: Trip; snapshot: Snapshot }[] = []
let locationWorkers = 0
function enrichLocations() {
  const current = snapshot.value
  locationQueue = current?.source === 'teslamate'
    ? (tab.value === 'trips' ? current.trips : current.trips.slice(0, 1)).map(trip => ({ trip, snapshot: current })) : []
  while (locationWorkers < 2 && locationQueue.length) {
    locationWorkers++
    void (async () => {
      try {
        while (locationQueue.length) {
          const job = locationQueue.shift()!
          if (snapshot.value !== job.snapshot || locatedTrips.has(job.trip)) continue
          locatedTrips.add(job.trip)
          try {
            const labels = await fetchTripLocations(job.trip.id)
            if (snapshot.value !== job.snapshot) continue
            Object.assign(job.trip, labels)
            if (selectedTrip.value?.id === job.trip.id) Object.assign(selectedTrip.value, labels)
          } catch { /* Retain upstream labels when address lookup is unavailable. */ }
        }
      } finally { locationWorkers-- }
    })()
  }
}
watch([snapshot, tab], enrichLocations)
let loadSequence = 0
let detailSequence = 0
const isDemo = computed(() => snapshot.value ? snapshot.value.source === 'demo' : savedMode.value === 'demo')
const rangeLabel = computed(() => range.value ? `近 ${range.value} 天` : isDemo.value ? '全部演示记录' : '全部已加载记录')
function inRange(startedAt: string) {
  if (!range.value) return true
  const reference = Date.parse(snapshot.value?.generatedAt || '')
  const started = Date.parse(startedAt)
  return Number.isFinite(started) && started >= (Number.isFinite(reference) ? reference : Date.now()) - range.value * 86400000
}
const filteredCharges = computed(() => (snapshot.value?.charges || []).filter(c => inRange(c.startedAt)))
const filteredTrips = computed(() => (snapshot.value?.trips || []).filter(t => inRange(t.startedAt)))
const chargeCosts = ref<ChargeCosts>({})
const chargeCostScope = computed(() => snapshot.value ? JSON.stringify([snapshot.value.source, snapshot.value.source === 'demo' ? '' : getSettings().baseUrl, snapshot.value.vehicle.id]) : '')
const editingCost = ref(false)
const costForm = reactive({ mode: 'total' as 'total' | 'rate', value: '' })
const costError = ref('')
const costMessage = ref('')
let costStorageReady = false
watch(chargeCostScope, scope => {
  chargeCosts.value = {}; costStorageReady = false
  if (!scope) return
  try { chargeCosts.value = loadChargeCosts(scope); costStorageReady = true }
  catch { costError.value = '本地费用读取失败，请重新打开应用后重试。' }
}, { immediate: true })
const selectedCostEntry = computed(() => selectedCharge.value ? chargeCosts.value[chargeCostKey(selectedCharge.value)] : undefined)
function effectiveChargeCost(charge: Charge) { return chargeCost(charge, chargeCosts.value[chargeCostKey(charge)]) }
const chargeTotalCost = computed(() => money(sumKnown(filteredCharges.value.map(effectiveChargeCost))))
const costPreview = computed(() => {
  if (!selectedCharge.value) return null
  try { return chargeCost(selectedCharge.value, parseChargeCost(costForm.value, costForm.mode)) } catch { return null }
})
function editChargeCost() {
  costForm.mode = selectedCostEntry.value?.mode || 'total'
  costForm.value = selectedCostEntry.value ? String(selectedCostEntry.value.value) : ''
  if (costStorageReady) costError.value = ''
  costMessage.value = ''; editingCost.value = true
}
function setCostMode(mode: 'total' | 'rate') {
  if (costForm.mode === mode) return
  costForm.mode = mode; costForm.value = ''; if (costStorageReady) costError.value = ''
}
function saveCost(restore: boolean) {
  if (!selectedCharge.value || !chargeCostScope.value) return
  costMessage.value = ''
  try {
    if (!costStorageReady) throw new Error('本地费用读取失败，请重新打开应用后重试。')
    const next = { ...chargeCosts.value }
    const key = chargeCostKey(selectedCharge.value)
    if (restore) delete next[key]
    else {
      const entry = parseChargeCost(costForm.value, costForm.mode)
      if (chargeCost(selectedCharge.value, entry) == null) throw new Error('充入电量未知，请直接填写总费用。')
      next[key] = entry
    }
    saveChargeCosts(chargeCostScope.value, next)
    chargeCosts.value = next; editingCost.value = false; costError.value = ''
    costMessage.value = restore ? '已恢复采集费用。' : '费用已保存。'
  } catch (reason) { costError.value = reason instanceof Error ? reason.message : '费用保存失败，请稍后重试。' }
}
const peakPower = computed(() => {
  const values = selectedCharge.value?.curve.map(c => c.powerKw).filter(Number.isFinite) || []
  return values.length ? Math.max(...values) : null
})
const curveMaximum = computed(() => powerAxisMaximum(peakPower.value))
const selectedCurveIndex = ref(0)
const selectedCurvePoint = computed(() => selectedCharge.value?.curve[selectedCurveIndex.value] ?? null)
const curveSelectionLeft = computed(() => (selectedCurveIndex.value + 0.5) / (selectedCharge.value?.curve.length || 1) * 100)
watch(selectedCharge, charge => {
  selectedCurveIndex.value = Math.max(0, charge?.curve.findIndex(point => point.powerKw === peakPower.value) ?? 0)
})
function selectCurvePoint(event: { detail: { value: number } }) {
  const value = event.detail.value
  if (Number.isFinite(value)) selectedCurveIndex.value = Math.max(0, Math.min((selectedCharge.value?.curve.length || 1) - 1, Math.round(value)))
}
function sumKnown(values: (number | null)[]) { const known = values.filter((v): v is number => v != null && Number.isFinite(v)); return known.length ? known.reduce((a, b) => a + b, 0) : null }
function totalEnergy(items: { energyKwh: number | null }[]) { return sumKnown(items.map(c => c.energyKwh)) }
function progress(value: number | null) { return value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value)) }
function money(value: number | null) { return value == null || !Number.isFinite(value) ? '--' : `¥${num(value, 2)}` }
function chargeKind(kind: Charge['kind']) { return kind === 'DC' ? 'DC 快充' : kind === 'AC' ? 'AC 慢充' : '充电' }
function booleanLabel(value: boolean | null | undefined, yes: string, no: string) { return value == null ? '未知' : value ? yes : no }
function curveHeight(value: number) { return powerHeight(value, curveMaximum.value) }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : '连接暂时不可用，请稍后重试。' }
async function refresh() {
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  try { const result = await fetchSnapshot(); if (sequence !== loadSequence) return false; snapshot.value = result; return true }
  catch (reason) { if (sequence === loadSequence) error.value = errorMessage(reason); return false }
  finally { if (sequence === loadSequence) loading.value = false }
}
async function scrollToTop() {
  revealNavigation()
  await nextTick()
  uni.pageScrollTo({ scrollTop: 0, duration: 0 })
}
let detailReturnScrollTop = 0
function switchTab(value: Tab) { ++detailSequence; tab.value = value; scrollToTop() }
async function openDetail(kind: 'trip' | 'charge', id: number) {
  const sequence = ++detailSequence
  if (!detailKind.value) {
    const top = await new Promise<number>(resolve => {
      uni.createSelectorQuery().selectViewport().scrollOffset(result => {
        const offset = Array.isArray(result) ? 0 : result.scrollTop
        resolve(typeof offset === 'number' && Number.isFinite(offset) ? Math.max(0, offset) : 0)
      }).exec()
    })
    if (sequence !== detailSequence) return
    detailReturnScrollTop = top
  }
  editingCost.value = false; costMessage.value = ''; costError.value = ''
  detailKind.value = kind; detailId.value = id; selectedTrip.value = null; selectedCharge.value = null; detailLoading.value = true; detailError.value = ''
  scrollToTop()
  try {
    if (kind === 'trip') {
      const result = await fetchTrip(id)
      if (sequence === detailSequence) {
        const listed = snapshot.value?.trips.find(trip => trip.id === id)
        selectedTrip.value = { ...result, from: listed?.from ?? result.from, to: listed?.to ?? result.to }
      }
    }
    else { const result = await fetchCharge(id); if (sequence === detailSequence) selectedCharge.value = result }
  } catch (reason) { if (sequence === detailSequence) detailError.value = errorMessage(reason) }
  finally { if (sequence === detailSequence) detailLoading.value = false }
}
async function closeDetail() {
  const sequence = ++detailSequence
  editingCost.value = false; costMessage.value = ''; revealNavigation()
  detailKind.value = null; detailId.value = null; selectedTrip.value = null; selectedCharge.value = null
  await nextTick()
  if (sequence === detailSequence) uni.pageScrollTo({ scrollTop: detailReturnScrollTop, duration: 0 })
}
async function applySettings(test: boolean) {
  if (saving.value) return
  settingsError.value = ''; settingsMessage.value = ''
  if (form.mode === 'live' && !form.baseUrl.trim()) { settingsError.value = '请填写 API 服务地址。'; return }
  if (form.mode === 'live' && !form.token.trim()) { settingsError.value = '请填写本项目服务的访问令牌。'; return }
  saving.value = true
  try {
    saveSettings({ mode: form.mode, baseUrl: form.baseUrl.trim(), token: form.token.trim() })
    Object.assign(form, getSettings()); savedMode.value = form.mode; snapshot.value = null
    const connected = await refresh()
    if (!connected) settingsError.value = `设置已保存，${error.value || '连接测试未完成。'}`
    else settingsMessage.value = test ? '连接成功。' : '设置已保存，数据已更新。'
  } catch (reason) { settingsError.value = errorMessage(reason) }
  finally { saving.value = false }
}
async function restoreDemo() {
  if (saving.value) return
  resetSettings(); Object.assign(form, getSettings()); savedMode.value = form.mode; settingsError.value = ''; settingsMessage.value = '连接设置已清除，已恢复演示模式。'; snapshot.value = null; await refresh()
}
onLoad(() => {
  // #ifdef APP-HARMONY
  uni.onKeyboardHeightChange(handleKeyboard)
  // #endif
  void refresh()
})
onUnload(() => {
  // #ifdef APP-HARMONY
  uni.offKeyboardHeightChange(handleKeyboard)
  // #endif
})
onPullDownRefresh(async () => { try { await refresh() } finally { uni.stopPullDownRefresh() } })
onBackPress(() => {
  if (detailKind.value) { closeDetail(); return true }
  // #ifdef APP-HARMONY
  ;(uni as typeof uni & { requestChejiExit: () => void }).requestChejiExit()
  return true
  // #endif
  // #ifndef APP-HARMONY
  return false
  // #endif
})
</script>

<style>
page{--background:#171819;--surface:#222326;--text:#f4f4f4;--muted:#aeb1b7;--line:#303236;--surface-raised:#303237;--radius:8px;--charge:#00d68f;--warning:#e4bc78;--nav-background:#222326;background:var(--background);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.5;font-variant-numeric:tabular-nums;color-scheme:dark}button{box-sizing:border-box;font:inherit;line-height:1.45;padding:0;margin:0;border-radius:0;background:none;color:inherit}button::after{border:none}button[disabled]{opacity:.55;background:transparent;color:inherit}button:focus-visible{outline:2px solid var(--charge);outline-offset:4px}input{box-sizing:border-box}view,text{box-sizing:border-box}.app-shell{max-width:520px;min-height:100vh;margin:auto;background:var(--background);padding-bottom:calc(100px + env(safe-area-inset-bottom))}.topbar{display:flex;align-items:center;justify-content:space-between;padding:calc(16px + env(safe-area-inset-top)) 24px 8px}.brand{display:flex;align-items:center;gap:10px}.brand-mark{display:none}.brand-mark view{width:6px;border-radius:3px;background:var(--background);height:25px}.brand-mark view:nth-child(2){height:32px}.brand-mark view:nth-child(3){height:20px}.brand-name{display:block;font-size:14px;line-height:1.3;letter-spacing:1px;font-weight:600;color:var(--muted)}.refresh-button{display:flex;width:44px;height:44px;align-items:center;justify-content:center;border:0;border-radius:4px;font-size:26px;color:var(--muted);background:none}.page-body{padding:0 24px}.source-strip{display:flex;align-items:center;gap:8px;min-height:36px;padding:0;margin-bottom:12px;border-radius:0;background:none;color:var(--muted);font-size:12px;line-height:1.5}.source-strip button{min-height:44px;display:flex;align-items:center;font-size:12px;white-space:nowrap;color:var(--muted);margin-left:auto}.source-dot,.tiny-dot{width:5px;height:5px;flex-shrink:0;background:var(--charge);border-radius:50%}.demo-strip{background:none;color:var(--muted)}.demo-strip .source-dot{background:var(--muted)}.demo-strip button{color:var(--muted)}.page-heading{display:flex;flex-direction:column;padding:12px 0 24px}.page-title{font-size:28px;line-height:1.35;font-weight:600;color:var(--text);letter-spacing:0}.row-between{display:flex;justify-content:space-between;align-items:center;gap:10px}.vehicle-hero{overflow:hidden;position:relative;background:none;color:var(--text);border-radius:0;padding:8px 0 0;box-shadow:none}.hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.hero-identity{min-width:0;flex:1}.hero-name{display:block;font-size:30px;font-weight:600;letter-spacing:.3px;overflow-wrap:anywhere}.hero-model{display:block;font-size:11px;color:var(--muted);margin-top:6px;letter-spacing:1.8px;text-transform:uppercase}.state-badge{display:flex;align-items:center;gap:7px;background:none;border:0;border-radius:0;padding:9px 0 7px 10px;font-size:12px;color:var(--muted);white-space:nowrap}.state-dot{width:5px;height:5px;border-radius:50%;background:var(--muted)}.state-dot.charging,.state-dot.online{background:var(--charge)}.state-dot.driving{background:var(--text)}.hero-center{display:flex;align-items:stretch;flex-direction:column;position:relative;min-height:0}.battery-reading{position:relative;z-index:2;display:flex;align-items:baseline;gap:10px;margin-top:14px;color:var(--charge)}.hero-battery{font-size:32px;letter-spacing:-.7px;line-height:1.2;font-weight:600}.hero-percent{font-size:16px;letter-spacing:0;margin-left:3px;color:var(--charge)}.hero-caption{display:block;font-size:12px;color:var(--muted);margin-top:6px;letter-spacing:.2px}.battery-track{height:3px;background:var(--line);border-radius:0;overflow:hidden}.battery-track>view{height:100%;border-radius:0;background:var(--charge)}.hero-bottom{display:grid;grid-template-columns:minmax(0,1fr) 1px minmax(0,1fr);align-items:center;gap:24px;margin:24px 0}.range-number{font-size:30px;line-height:1.2;letter-spacing:-.5px;font-weight:500}.range-unit{font-size:12px;color:var(--muted);font-weight:400;letter-spacing:0;margin-left:3px}.hero-divider{height:31px;width:1px;background:var(--line)}.odometer-number{font-size:30px;line-height:1.2;letter-spacing:-.5px;font-weight:500}.hero-observed{display:flex;align-items:center;gap:7px;border-top:0;padding:0 0 24px;font-size:12px;color:var(--muted)}.hero-observed .tiny-dot{background:var(--muted)}.car-scene{position:relative;right:auto;bottom:auto;width:100%;height:218px;transform:none;overflow:visible}.car-image{display:block;width:100%;height:100%;transform:scale(1.22);filter:drop-shadow(0 16px 12px #0005)}.card{background:var(--surface);border:0;border-radius:var(--radius);box-shadow:none}.charging-card{display:flex;align-items:center;gap:14px;padding:18px;margin-top:0}.charge-icon{display:flex;width:26px;height:34px;align-items:center;justify-content:center;flex-shrink:0;background:none;border-radius:0;color:var(--charge);font-size:30px}.charging-copy{min-width:0;flex:1}.card-title{font-size:14px;font-weight:600;line-height:1.5}.charging-copy .card-title{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}.muted{font-size:12px;color:var(--muted);line-height:1.6}.charge-power{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:16px;font-weight:600;flex-shrink:0}.unit{font-size:12px;color:var(--muted);font-weight:400}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:32px 0 16px;font-size:17px;font-weight:600;color:var(--text)}.section-note{font-size:12px;color:var(--muted);font-weight:400}.metrics-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1px;background:var(--line);border-radius:var(--radius);overflow:hidden}.temp-divider{color:var(--muted);font-size:15px}.access-card{padding:0;margin-top:0;border-bottom:1px solid var(--line)}.access-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;padding:4px 0 22px 42px}.access-row{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted)}.access-row>text:last-child{color:var(--text)}.access-row>text.is-open{color:var(--warning)}.tyre-card{display:block;margin-top:24px;padding:0}.tyre-layout{display:grid;grid-template-columns:minmax(0,1fr) 64px minmax(0,1fr);align-items:center;gap:24px;max-width:256px;margin:24px auto 0}.tyre-column{display:flex;flex-direction:column;gap:26px;font-size:23px;font-weight:500;color:var(--text)}.text-button{display:flex;align-items:center;gap:6px;min-height:44px;font-size:13px;color:var(--muted);font-weight:400}.record-button{display:block;width:100%;text-align:left;margin-bottom:0;padding:24px 0;border-radius:0;border-bottom:1px solid var(--line);background:transparent;transition:opacity .15s}.record-button:active{background:none;opacity:.65}.record-top{display:flex;align-items:center;gap:9px}.record-date{font-size:12px;color:var(--muted)}.record-chevron{display:block;width:18px;height:18px;margin-left:auto;flex-shrink:0;transform:rotate(-90deg);opacity:.8}.trip-locations{display:grid;grid-template-columns:minmax(0,1fr) 16px minmax(0,1fr);align-items:center;gap:10px;margin:17px 0;color:var(--text);font-size:15px;font-weight:500;line-height:1.6}.trip-locations>text:not(.trip-arrow){min-width:0;overflow-wrap:anywhere;white-space:normal}.trip-arrow{font-size:13px;color:var(--muted);font-weight:400}.record-footer{display:flex;align-items:baseline;flex-wrap:wrap;gap:10px 14px;color:var(--muted);font-size:12px}.record-number{font-size:25px;line-height:1.2;letter-spacing:-.6px;color:var(--text);font-weight:500}.record-footer>text:last-child{margin-left:auto}.record-cost{font-size:14px;color:var(--text)}.charge-kind{display:inline-block;width:fit-content;padding:4px 7px;border-radius:3px;background:#303237;color:var(--muted);font-size:11px;font-weight:500;line-height:1.4}.charge-kind.dc{background:#21372e;color:#56e5b5}.charge-kind.ac{background:#303237;color:var(--text)}.record-location{display:block;margin:12px 0 16px;font-size:17px;font-weight:500;color:var(--text)}.filter-row{display:flex;align-items:center;gap:4px;margin-bottom:24px;border:0;border-radius:var(--radius);padding:4px;background:var(--surface)}.filter-row button{flex:1;display:flex;align-items:center;justify-content:center;min-height:44px;padding:8px 3px;font-size:13px;border-radius:5px;color:var(--muted)}.filter-row button.active{background:var(--surface-raised);color:var(--text);box-shadow:none;font-weight:600}.summary-panel{display:flex;flex-wrap:wrap;background:transparent;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:4px 0 0;gap:24px;color:var(--text)}.summary-panel>view:not(.summary-bottom){flex:1;min-width:0}.summary-label{display:block;font-size:13px;color:var(--muted);margin-bottom:12px}.summary-number{display:block;font-size:34px;line-height:1.2;font-weight:500;letter-spacing:-.6px;white-space:normal;overflow-wrap:anywhere}.summary-number text{font-size:12px;font-weight:400;letter-spacing:0;color:var(--muted)}.summary-number.smaller{font-size:34px}.summary-bottom{display:flex;align-items:center;justify-content:space-between;flex:0 0 100%;gap:8px;border-top:0;margin-top:0;padding:2px 0 18px;color:var(--muted);font-size:12px}.summary-bottom>text:first-child{font-size:12px;color:var(--muted)}.footnote{display:block;color:var(--muted);font-size:12px;line-height:1.8;margin:10px 2px 16px}.empty-records{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:36px 20px;color:var(--muted);font-size:11px;line-height:1.8}.empty-symbol{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:0;background:none;font-size:29px;color:var(--muted)}.status-title{display:block;font-size:15px;font-weight:600;color:var(--text)}.compact-empty{padding:28px 16px;text-align:center;color:var(--muted);font-size:11px;line-height:1.8}.bottom-nav{display:flex;position:fixed;z-index:10;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);width:calc(100% - 40px);max-width:360px;border:1px solid var(--line);border-radius:28px;padding:6px 12px;background:var(--nav-background);box-shadow:none}.bottom-nav>button{display:flex;position:relative;align-items:center;justify-content:center;flex-direction:column;flex:1;min-height:48px;gap:4px;padding:4px 0;color:var(--muted);font-size:11px}.bottom-nav>button.active{color:var(--text);font-weight:600}.status-card{display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;padding:46px 20px;color:var(--muted);font-size:12px;line-height:1.8}.error-banner{display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px;margin-top:13px;color:var(--warning);font-size:11px;line-height:1.8}.error-banner>text{flex:1;min-width:0;word-break:break-word}.error-banner button{flex-shrink:0;color:var(--warning);text-decoration:underline}.primary-button,.secondary-button{display:block;width:100%;min-height:48px;border-radius:var(--radius);padding:13px 14px;font-size:14px;font-weight:600;text-align:center}.primary-button{background:var(--text);color:#171819;margin-top:22px}.primary-button[disabled]{background:var(--text);color:#171819}.secondary-button{border:1px solid #72757d;color:var(--text);margin-top:12px}.status-card .primary-button{max-width:220px}.initial-loading{padding-top:8px;color:var(--muted);font-size:12px}.skeleton{background:#2b2d31;border-radius:4px}.settings-card{padding:24px 20px}.mode-options{display:flex;gap:10px;margin:16px 0 8px}.mode-options>button{flex:1;text-align:left;border:1px solid var(--line);border-radius:var(--radius);padding:16px 12px;background:none}.mode-options>button.selected{background:var(--surface-raised);border-color:#9fa2a7}.mode-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--text);font-size:14px;font-weight:600}.radio-dot{width:12px;height:12px;border:1px solid var(--line);border-radius:50%;flex-shrink:0}.selected .radio-dot{border:4px solid var(--text);background:var(--surface)}.field{margin-top:22px}.field-label{display:block;margin-bottom:10px;font-size:13px;color:var(--text);font-weight:600}.field-input{width:100%;height:48px;padding:0 12px;border:1px solid #6b6e75;border-radius:var(--radius);background:#1c1d1f;color:var(--text);font-size:16px}.field-help{display:block;color:var(--muted);font-size:12px;line-height:1.7;margin-top:8px}.form-error,.form-success{margin-top:15px;padding:12px;border-radius:4px;font-size:12px;line-height:1.7;word-break:break-word}.form-error{color:#ffaaa1;background:#382522}.form-success{color:#81e0b6;background:#20352b}.settings-info{padding:20px;margin-top:16px}.small-badge{background:var(--surface);color:var(--muted);padding:4px 7px;border-radius:4px;font-size:11px;flex-shrink:0}.info-row{display:flex;align-items:center;justify-content:space-between;gap:14px;font-size:12px;color:var(--muted);padding-top:16px}.info-row>text:last-child{color:var(--text);text-align:right;overflow-wrap:anywhere}.reset-button{display:block;width:100%;min-height:48px;padding:16px 0;margin-top:14px;border-top:1px solid var(--line);text-align:left;color:var(--muted);font-size:12px}.about-note{display:flex;justify-content:center;margin:24px 0;color:var(--muted);font-size:12px}.back-button{display:flex;align-items:center;justify-content:flex-start;gap:6px;text-align:left;margin:0;width:auto;min-height:44px;padding:8px 0;color:var(--text);font-size:14px}.detail-page .page-heading{padding-top:14px}.detail-summary{padding:22px 18px}.route-place{display:flex;align-items:center;gap:11px;font-size:14px;color:var(--text);line-height:1.7}.place-dot{height:8px;width:8px;border:2px solid var(--text);border-radius:50%;flex-shrink:0}.destination{background:var(--text);border-color:var(--text)}.place-connector{height:17px;border-left:1px dashed var(--line);margin:1px 0 1px 3px}.detail-date{display:block;margin-top:19px;font-size:12px}.detail-page .metrics-grid{margin-top:13px}.metric{padding:21px 16px;min-width:0;border-radius:0}.metric-label{display:block;font-size:12px;color:var(--muted);margin-bottom:10px}.metric-value{display:block;font-size:28px;line-height:1.25;letter-spacing:-.5px;font-weight:500;color:var(--text);overflow-wrap:anywhere}.metric-small{font-size:22px}.detail-location{display:block;font-size:21px;color:var(--text);font-weight:600;margin:19px 0 6px}.charge-percent{display:flex;align-items:center;gap:16px;color:var(--charge);font-size:30px;font-weight:500;margin:24px 0 16px}.percent-bridge{font-size:21px;color:var(--muted)}.light-track{background:var(--line)}.light-track>view{background:var(--charge)}.curve-card{padding:18px;margin-top:22px}.curve-card .section-heading{margin:0 0 22px}.curve-chart{position:relative;height:160px;display:flex;align-items:flex-end;gap:0;border-bottom:1px solid var(--line);background:linear-gradient(var(--line),var(--line)) top/100% 1px no-repeat,linear-gradient(var(--line),var(--line)) center/100% 1px no-repeat}.curve-column{display:flex;align-items:flex-end;flex:1 1 0;height:100%;min-width:0}.curve-bar{width:100%;min-width:0;background:var(--charge);border-radius:1px 1px 0 0}.chart-axis{margin-left:44px;display:flex;justify-content:space-between;padding-top:8px;font-size:12px;color:var(--muted)}.curve-card .footnote{margin-bottom:0}.detail-page{padding-bottom:30px}.loading-dot{width:13px;height:13px;border:2px solid var(--line);border-top-color:var(--charge);border-radius:50%}

.button-pressed{opacity:.7}
.disclosure-button:active{opacity:.7}.disclosure-button{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:56px;text-align:left}.disclosure-end{display:flex;align-items:center;gap:12px}.disclosure-arrow{font-size:20px;color:var(--muted)}.access-summary{font-size:12px;color:var(--text)}.attention{color:var(--warning)}.help-toggle{display:flex;align-items:center;min-height:44px;font-size:12px;color:var(--text);text-align:left}.help-content{display:flex;flex-direction:column;gap:12px;margin-top:12px;font-size:12px;line-height:1.8;color:var(--muted)}.scope-note{display:block;margin:16px 0 0;color:var(--muted);font-size:12px}.charging-copy>.muted{display:block;font-size:14px;color:var(--text);overflow-wrap:anywhere}button{touch-action:manipulation}
@media (min-width:500px){.page-body{padding-left:30px;padding-right:30px}.topbar{padding-left:30px;padding-right:30px}.car-scene{height:252px}.hero-name{font-size:32px}}

@media (max-width:350px){.page-body{padding-left:18px;padding-right:18px}.topbar{padding-left:18px;padding-right:18px}.car-scene{height:180px}.hero-name{font-size:26px}.state-badge{font-size:11px}.hero-bottom{gap:18px}.range-number,.odometer-number{font-size:25px}.charging-card{gap:8px;padding:16px 12px}.charge-power{font-size:14px}.summary-number{font-size:32px}.summary-number.smaller{font-size:25px}}

.trip-locations>text:not(.trip-arrow){display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
@media(prefers-reduced-motion:reduce){.record-button{transition:none}}

.vehicle-status{border-top:1px solid var(--line)}
.status-row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;align-items:center;gap:16px;min-height:72px;padding:15px 0}
.status-row+.status-row{border-top:1px solid #2b2d30}
.status-copy{min-width:0}
.status-name{display:block;font-size:15px;font-weight:500;line-height:1.5;color:var(--text)}
.status-note{display:flex;align-items:center;gap:5px;margin-top:4px;color:var(--muted);font-size:12px;line-height:1.6}
.status-reading{font-size:15px;font-weight:500;line-height:1.5;color:var(--text);text-align:right}
.temperature-reading{font-size:18px;letter-spacing:-.3px}
.status-alert{color:var(--warning)}
.status-glyph{display:block;width:26px;height:26px;flex-shrink:0}
.status-note .status-glyph{width:13px;height:13px}
.access-title{display:flex;align-items:center;gap:16px;min-width:0}
.access-card .disclosure-button{min-height:72px}
.access-card .disclosure-end{gap:12px}
.disclosure-chevron{width:18px;height:18px;transform:rotate(-90deg)}
.disclosure-chevron.expanded{transform:none}
.tyre-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}
.tyre-vehicle{display:block;width:64px;height:136px}
.tyre-column:first-child{text-align:right;align-items:flex-end}
.tyre-point{display:flex;flex-direction:column;gap:4px;line-height:1.2}
.tyre-corner{font-size:12px;font-weight:400;color:var(--muted)}
@media(max-width:350px){.status-row{gap:12px}.status-name{font-size:14px}.status-reading{font-size:13px}.temperature-reading{font-size:16px}.access-title{gap:12px}.access-grid{padding-left:38px;gap:16px}.access-summary{font-size:11px}.access-card .disclosure-end{gap:8px}}
.cost-source{display:block;color:var(--muted);font-size:11px;margin-top:6px}
.cost-edit-button{display:flex;align-items:center;min-height:44px;font-size:13px;color:var(--text);text-decoration:underline;text-underline-offset:4px}
.cost-editor{padding:24px 20px;margin-top:16px}
.cost-modes{margin:16px 0;background:var(--background)}
.cost-actions{display:flex;justify-content:space-between;gap:16px;margin-top:8px}
.empty-glyph{display:block;width:32px;height:32px}
.control-glyph{display:block;width:22px;height:22px}
.control-chevron{display:block;width:16px;height:16px;flex-shrink:0;transform:rotate(-90deg)}
.back-chevron{transform:rotate(90deg)}
.nav-glyph{display:block;width:24px;height:24px;opacity:.85}
.bottom-nav>button.active .nav-glyph{opacity:1;filter:brightness(1.48)}
.field-input{caret-color:var(--charge)}
.field-input:focus-within{border-color:var(--text);outline:1px solid var(--text);outline-offset:1px}
::selection{background:#446354;color:#fff}
@media(hover:hover){.record-button:hover,.text-button:hover,.refresh-button:hover{opacity:.75}.filter-row button:not(.active):hover{background:#2b2d31}}
@media(max-width:350px){.summary-number,.summary-number.smaller{font-size:28px}.metric-value{font-size:24px}.metric-small{font-size:22px}.summary-bottom{align-items:flex-start;gap:12px}.summary-bottom>text:last-child{text-align:right}.cost-editor,.settings-card{padding:20px 16px}}
.curve-reading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:16px;color:var(--muted);font-size:12px}
.curve-power{font-size:26px;line-height:1.2;font-weight:500;color:var(--text)}
.curve-layout{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px}
.power-axis{display:flex;flex-direction:column;justify-content:space-between;text-align:right;color:var(--muted);font-size:12px;line-height:1}
.curve-guide{position:absolute;top:0;bottom:0;border-left:1px solid #ffffff70;pointer-events:none}
.curve-point{position:absolute;width:6px;height:6px;border-radius:50%;background:var(--text);transform:translate(-50%,50%);pointer-events:none}
.curve-slider{margin:12px 0 0 44px}
.curve-slider:focus-visible{outline:2px solid var(--text);outline-offset:4px;border-radius:2px}
.curve-hint{display:block;margin:4px 0 0 44px;color:var(--muted);font-size:12px}
.curve-column{cursor:crosshair}
.power-axis>text:first-child{transform:translateY(-50%)}
.power-axis>text:last-child{transform:translateY(50%)}
.topbar .refresh-button[disabled]{background:transparent;opacity:1}
.refresh-button .loading-dot{width:20px;height:20px;border-color:#51545b;border-top-color:var(--text)}
.loading-dot{flex-shrink:0;animation:loading-spin .85s linear infinite}
.loading-body{animation:loading-pulse 1.8s ease-in-out infinite}
.loading-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:42px}
.sk-name{width:140px;height:28px}
.sk-status{width:64px;height:12px;flex-shrink:0}
.sk-model{width:32px;height:10px;margin-top:6px}
.loading-battery{display:flex;align-items:baseline;gap:12px;margin-top:20px}
.sk-number{width:72px;height:34px}
.sk-label{width:64px;max-width:100%;height:12px}
.loading-car{opacity:.45;overflow:hidden}
.loading-car .car-image{filter:none}
.sk-track{height:3px;width:100%;border-radius:0}
.loading-metrics{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;margin:24px 0}
.loading-metrics>view{display:flex;flex-direction:column;gap:12px;min-width:0}
.sk-value{height:30px;width:112px;max-width:100%}
.loading-status{display:flex;align-items:center;gap:10px;min-height:32px;margin:0 0 24px;color:var(--muted);font-size:12px;line-height:1.6}
.loading-rows{border-top:1px solid var(--line)}
.loading-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:72px;border-bottom:1px solid var(--line)}
.loading-row-name{display:flex;align-items:center;gap:16px;min-width:0}
.sk-icon{width:26px;height:26px;flex-shrink:0}
.sk-row-label{width:88px;height:14px}
.loading-filters{display:flex;gap:8px;margin-bottom:28px}
.loading-filters>view{height:44px;flex:1}
.loading-record{display:flex;flex-direction:column;gap:24px;padding:24px 0;border-bottom:1px solid var(--line)}
.sk-route{width:80%;height:16px}
.loading-detail-summary{display:flex;flex-direction:column;gap:22px;padding:24px 18px}
@keyframes loading-spin{to{transform:rotate(360deg)}}
@keyframes loading-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@media(prefers-reduced-motion:reduce){.loading-body,.loading-dot{animation:none}}
</style>
