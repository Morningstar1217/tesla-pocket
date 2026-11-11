export type VehicleState = 'asleep' | 'online' | 'charging' | 'driving' | 'offline' | 'unknown'
export interface Trip {
  id: number; startedAt: string; endedAt: string | null; from: string; to: string;
  distanceKm: number | null; durationMin: number | null; energyKwh: number | null;
  efficiencyWhKm: number | null; points: { latitude: number; longitude: number }[];
}
export interface Charge {
  id: number; startedAt: string; endedAt: string | null; location: string;
  energyKwh: number | null; cost: number | null; currency: string;
  startPct: number | null; endPct: number | null; kind: 'AC' | 'DC' | 'unknown';
  durationMin: number | null; curve: { minute: number; powerKw: number }[];
}
export interface Snapshot {
  source: 'demo' | 'teslamate'; generatedAt: string; notices: string[];
  vehicle: {
    id: number; name: string; model: string; state: VehicleState; observedAt: string | null;
    batteryPct: number | null; rangeKm: number | null; odometerKm: number | null;
    locked: boolean | null; sentry: boolean | null; insideTempC: number | null;
    outsideTempC: number | null; locationName: string | null;
    openings: { windows: boolean | null; driverFront: boolean | null; driverRear: boolean | null;
      passengerFront: boolean | null; passengerRear: boolean | null; trunk: boolean | null; frunk: boolean | null };
    climate: { on: boolean | null; preconditioning: boolean | null };
    tyres: { fl: number | null; fr: number | null; rl: number | null; rr: number | null };
    charging: { powerKw: number | null; voltage: number | null; currentA: number | null;
      remainingMin: number | null; limitPct: number | null } | null;
  };
  trips: Trip[]; charges: Charge[];
}
