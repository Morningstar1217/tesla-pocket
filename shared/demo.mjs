export function createDemoSnapshot(now = new Date()) {
  const time = new Date(now).getTime();
  if (!Number.isFinite(time)) throw new TypeError('Invalid demo date');
  const at = (days, minutes = 0) => new Date(time - days * 86400000 - minutes * 60000).toISOString();
  const route = [
    [31.2211, 121.5448], [31.2252, 121.5404], [31.2305, 121.5372],
    [31.2367, 121.5345], [31.2412, 121.5288], [31.2461, 121.5219],
    [31.2516, 121.5147], [31.2562, 121.5098], [31.2621, 121.5043]
  ];
  const trips = [
    ['世纪公园', '陆家嘴', 12.8, 28, 1.79],
    ['陆家嘴', '世纪公园', 13.4, 32, 1.99],
    ['世纪公园', '前滩太古里', 18.6, 35, 2.64],
    ['前滩太古里', '世纪公园', 17.9, 31, 2.43],
    ['世纪公园', '上海迪士尼', 32.7, 48, 4.91],
    ['上海迪士尼', '世纪公园', 33.1, 46, 4.67]
  ].map(([from, to, distanceKm, durationMin, energyKwh], index) => ({
    id: 1001 + index, startedAt: at(index + 0.08, durationMin), endedAt: at(index + 0.08),
    from, to, distanceKm, durationMin, energyKwh,
    efficiencyWhKm: Math.round(energyKwh / distanceKm * 1000),
    points: (index % 2 ? [...route].reverse() : route).map(([latitude, longitude]) => ({ latitude, longitude }))
  }));
  const charges = [
    ['世纪公园 · 家充', 24.6, 13.53, 39, 80, 'AC', 224],
    ['浦东嘉里城 · 超充', 37.8, 64.26, 18, 81, 'DC', 31],
    ['世纪公园 · 家充', 18.9, 10.4, 48, 80, 'AC', 172],
    ['前滩太古里 · 超充', 31.2, 53.04, 27, 79, 'DC', 28],
    ['世纪公园 · 家充', 22.1, 12.16, 43, 80, 'AC', 201]
  ].map(([location, energyKwh, cost, startPct, endPct, kind, durationMin], index) => ({
    id: 2001 + index, startedAt: at(index * 3 + 0.5, durationMin), endedAt: at(index * 3 + 0.5),
    location, energyKwh, cost, currency: 'CNY', startPct, endPct, kind, durationMin,
    curve: (kind === 'DC' ? [68, 126, 143, 119, 91, 65, 42, 24] : [0, 7.1, 7.2, 7.2, 7.1, 7.2, 7, 0])
      .map((powerKw, i, values) => ({ minute: Math.round(durationMin * i / (values.length - 1)), powerKw }))
  }));
  return {
    source: 'demo', generatedAt: at(0),
    notices: ['所有车辆状态、充电、行程和地图坐标均为演示数据，未连接真实车辆。'],
    vehicle: {
      id: 1, name: '我的 Model Y', model: 'Model Y', state: 'charging', observedAt: at(0, 1),
      batteryPct: 72, rangeKm: 326, odometerKm: 18642, locked: true, sentry: false,
      insideTempC: 24, outsideTempC: 21, locationName: '世纪公园 · 家充',
      openings: { windows: false, driverFront: false, driverRear: false, passengerFront: false, passengerRear: false, trunk: false, frunk: false },
      climate: { on: true, preconditioning: false },
      tyres: { fl: 2.9, fr: 2.9, rl: 3, rr: 3 },
      charging: { powerKw: 7.1, voltage: 222, currentA: 32, remainingMin: 42, limitPct: 80 }
    }, trips, charges
  };
}
