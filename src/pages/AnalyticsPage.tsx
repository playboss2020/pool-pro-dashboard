import { useMemo, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, TrendingUp } from "lucide-react";
import { useHistory } from "../hooks/useHistory";
import type { DeviceHistory, HistoryPeriod, PoolDevice } from "../lib/deviceApi";

type MetricKey = "current_temp" | "pump_watts" | "heater_watts" | "total_kwh";

type MetricConfig = {
  key: MetricKey;
  label: string;
  unit: string;
  color: string;
  decimals: number;
};

type HistoryRange = {
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
  startMs: number;
  endMs: number;
};

const metrics: MetricConfig[] = [
  { key: "current_temp", label: "Water temperature", unit: "F", color: "#93bdf3", decimals: 1 },
  { key: "pump_watts", label: "Pump watts", unit: "W", color: "#0a84bd", decimals: 0 },
  { key: "heater_watts", label: "Heater watts", unit: "W", color: "#e69a10", decimals: 0 },
  { key: "total_kwh", label: "Total energy", unit: "kWh", color: "#22a971", decimals: 2 },
];

const periodOptions: { id: HistoryPeriod; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

function metricValue(row: DeviceHistory, key: MetricKey) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatValue(value: number | null, metric: MetricConfig) {
  if (value === null) return "--";
  return `${value.toFixed(metric.decimals)} ${metric.unit}`;
}

function formatCurrency(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return value < 0.01 && value > 0 ? "<$0.01" : `$${value.toFixed(2)}`;
}

function axisTickDecimals(metric: MetricConfig, values: number[]) {
  const baseDecimals = metric.key === "current_temp" ? 1 : metric.key === "total_kwh" ? 2 : 0;
  const maxDecimals = Math.max(baseDecimals, 2);

  for (let decimals = baseDecimals; decimals <= maxDecimals; decimals += 1) {
    const labels = values.map((value) => value.toFixed(decimals));
    if (new Set(labels).size === labels.length) return decimals;
  }

  return maxDecimals;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function startOfPeriod(period: HistoryPeriod, value: Date) {
  if (period === "year") return new Date(value.getFullYear(), 0, 1);
  if (period === "month") return new Date(value.getFullYear(), value.getMonth(), 1);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addPeriod(period: HistoryPeriod, value: Date, amount: number) {
  if (period === "year") return new Date(value.getFullYear() + amount, 0, 1);
  if (period === "month") return new Date(value.getFullYear(), value.getMonth() + amount, 1);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount);
}

function getHistoryRange(period: HistoryPeriod, anchorDate: Date): HistoryRange {
  const start = startOfPeriod(period, anchorDate);
  const end = addPeriod(period, start, 1);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function formatPeriodLabel(period: HistoryPeriod, range: HistoryRange) {
  if (period === "year") return range.start.toLocaleDateString([], { year: "numeric" });
  if (period === "month") return range.start.toLocaleDateString([], { month: "long", year: "numeric" });
  return range.start.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function formatTooltipTime(period: HistoryPeriod, value: string) {
  const date = new Date(value);
  if (period === "year") return date.toLocaleDateString([], { month: "short", year: "numeric" });
  if (period === "month") return date.toLocaleDateString([], { month: "short", day: "numeric" });
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function axisLabels(period: HistoryPeriod, range: HistoryRange) {
  if (period === "year") {
    return [
      { label: "Jan", ratio: 0 },
      { label: "Jun", ratio: 5 / 12 },
      { label: "Dec", ratio: 11 / 12 },
    ];
  }

  if (period === "month") {
    const lastDay = new Date(range.end.getFullYear(), range.end.getMonth(), 0).getDate();
    return [
      { label: "1", ratio: 0 },
      { label: String(Math.ceil(lastDay / 2)), ratio: 0.5 },
      { label: String(lastDay), ratio: 1 },
    ];
  }

  return [
    { label: "12 AM", ratio: 0 },
    { label: "12 PM", ratio: 0.5 },
    { label: "11 PM", ratio: 23 / 24 },
  ];
}

function HistoryChart({ rows, metric, period, range, electricityRate }: {
  rows: DeviceHistory[];
  metric: MetricConfig;
  period: HistoryPeriod;
  range: HistoryRange;
  electricityRate: number;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const validRows = rows
    .map((row) => ({ row, value: metricValue(row, metric.key), timeMs: new Date(row.created_at).getTime() }))
    .filter((point): point is { row: DeviceHistory; value: number; timeMs: number } =>
      point.value !== null && Number.isFinite(point.timeMs),
    );
  const latest = validRows[validRows.length - 1]?.value ?? null;
  const min = validRows.length > 0 ? Math.min(...validRows.map((point) => point.value)) : null;
  const max = validRows.length > 0 ? Math.max(...validRows.map((point) => point.value)) : null;
  const baseMin = min ?? 0;
  const baseMax = max ?? 1;
  const rawSpread = Math.max(1, baseMax - baseMin);
  const paddedMin = baseMin - rawSpread * 0.12;
  const paddedMax = baseMax + rawSpread * 0.12;
  const spread = Math.max(1, paddedMax - paddedMin);
  const width = 320;
  const height = 190;
  const paddingLeft = 42;
  const paddingRight = 12;
  const paddingTop = 18;
  const paddingBottom = 34;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const rangeSpan = Math.max(1, range.endMs - range.startMs);
  const points = validRows.map((point) => {
    const xRatio = clamp((point.timeMs - range.startMs) / rangeSpan, 0, 1);
    const yRatio = clamp((point.value - paddedMin) / spread, 0, 1);
    const x = paddingLeft + xRatio * chartWidth;
    const y = paddingTop + chartHeight - yRatio * chartHeight;
    return {
      ...point,
      x,
      y,
      xRatio,
      yRatio,
    };
  });
  const pointString = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const activePoint = activeIndex === null ? null : points[activeIndex] ?? null;
  const average = validRows.length > 0 ? validRows.reduce((sum, point) => sum + point.value, 0) / validRows.length : null;
  const firstTotalKwh = metric.key === "total_kwh" ? points[0]?.value ?? null : null;
  const latestTotalKwh = metric.key === "total_kwh" ? points[points.length - 1]?.value ?? null : null;
  const rangeKwh = firstTotalKwh !== null && latestTotalKwh !== null ? Math.max(0, latestTotalKwh - firstTotalKwh) : null;
  const rangeCost = metric.key === "total_kwh" && rangeKwh !== null ? rangeKwh * electricityRate : null;
  const hourlyCost = (metric.key === "pump_watts" || metric.key === "heater_watts") && latest !== null
    ? (latest / 1000) * electricityRate
    : null;
  const activeCost = activePoint && (metric.key === "pump_watts" || metric.key === "heater_watts")
    ? (activePoint.value / 1000) * electricityRate
    : activePoint && metric.key === "total_kwh" && firstTotalKwh !== null
      ? Math.max(0, activePoint.value - firstTotalKwh) * electricityRate
      : null;
  const yTickValues = [paddedMax, paddedMin + spread / 2, paddedMin];
  const yTickDecimals = axisTickDecimals(metric, yTickValues);
  const yTicks = yTickValues.map((value) => {
    const y = paddingTop + chartHeight - ((value - paddedMin) / spread) * chartHeight;
    return { value, y };
  });
  const xTicks = axisLabels(period, range).map((tick) => ({
    ...tick,
    x: paddingLeft + tick.ratio * chartWidth,
  }));
  const totalSamples = rows.reduce((sum, row) => sum + row.sample_count, 0);

  function choosePoint(event: PointerEvent<HTMLDivElement>) {
    if (points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const targetTime = range.startMs + ratio * rangeSpan;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    points.forEach((point, index) => {
      const distance = Math.abs(point.timeMs - targetTime);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    setActiveIndex(nearestIndex);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    choosePoint(event);
  }

  return (
    <article className="chart-card">
      <div className="chart-topline">
        <div>
          <span className="eyebrow">{metric.label}</span>
          <strong className="chart-value">{formatValue(latest, metric)}</strong>
          {hourlyCost !== null ? <em className="chart-cost-line">At latest draw: {formatCurrency(hourlyCost)}/hr</em> : null}
          {rangeCost !== null ? <em className="chart-cost-line">This range: {formatCurrency(rangeCost)}</em> : null}
        </div>
        <span className="chart-icon" style={{ color: metric.color }}>
          <TrendingUp size={20} />
        </span>
      </div>

      {points.length > 0 ? (
        <div
          className="chart-plot"
          onPointerDown={handlePointerDown}
          onPointerMove={choosePoint}
          onPointerLeave={() => setActiveIndex(null)}
        >
          <svg className="history-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric.label} history chart`}>
            {yTicks.map((tick) => (
              <g className="chart-grid-line" key={tick.y}>
                <line x1={paddingLeft} x2={width - paddingRight} y1={tick.y} y2={tick.y} />
                <text x={paddingLeft - 8} y={tick.y + 4}>
                  {tick.value.toFixed(yTickDecimals)}
                </text>
              </g>
            ))}

            {xTicks.map((tick) => (
              <text className="chart-x-label" key={tick.label} x={tick.x} y={height - 6}>
                {tick.label}
              </text>
            ))}

            {points.length > 1 ? <polyline points={pointString} style={{ stroke: metric.color }} /> : null}
            {points.length === 1 ? <circle cx={points[0].x} cy={points[0].y} r="5" style={{ fill: metric.color }} /> : null}

            {activePoint ? (
              <g className="chart-active">
                <line x1={activePoint.x} x2={activePoint.x} y1={paddingTop} y2={height - paddingBottom} />
                <circle cx={activePoint.x} cy={activePoint.y} r="5.6" style={{ stroke: metric.color }} />
              </g>
            ) : null}
          </svg>

          {activePoint ? (
            <div
              className="chart-tooltip"
              style={{
                left: `${clamp((activePoint.x / width) * 100, 18, 82)}%`,
                top: `${clamp((activePoint.y / height) * 100 - 18, 4, 66)}%`,
              }}
            >
              <span>{formatTooltipTime(period, activePoint.row.created_at)}</span>
              <strong>{formatValue(activePoint.value, metric)}</strong>
              {activeCost !== null ? (
                <small>{metric.key === "total_kwh" ? `${formatCurrency(activeCost)} this period` : `${formatCurrency(activeCost)}/hr`}</small>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="chart-empty">Waiting for history</div>
      )}

      <div className="chart-stats">
        <span>Low {formatValue(min, metric)}</span>
        <span>
          {metric.key === "current_temp"
            ? `Avg ${formatValue(average, metric)}`
            : metric.key === "total_kwh"
              ? `${formatValue(rangeKwh, metric)} used`
              : `${totalSamples} samples`}
        </span>
        <span>High {formatValue(max, metric)}</span>
      </div>
    </article>
  );
}

export function AnalyticsPage({ device }: { device: PoolDevice | null }) {
  const [period, setPeriod] = useState<HistoryPeriod>("day");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const range = useMemo(() => getHistoryRange(period, anchorDate), [anchorDate, period]);
  const { history, loading, error, refresh } = useHistory(period, range.startIso, range.endIso);
  const currentPeriodStart = startOfPeriod(period, new Date()).getTime();
  const canGoForward = range.start.getTime() < currentPeriodStart;
  const electricityRate = typeof device?.electricity_rate_per_kwh === "number" ? device.electricity_rate_per_kwh : 0.18;

  function movePeriod(amount: number) {
    setAnchorDate((current) => addPeriod(period, startOfPeriod(period, current), amount));
  }

  function selectPeriod(nextPeriod: HistoryPeriod) {
    setPeriod(nextPeriod);
    setAnchorDate(new Date());
  }

  return (
    <div className="screen-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">History</span>
          <h2>Trends</h2>
        </div>
        <button className="icon-button" type="button" onClick={() => void refresh()} aria-label="Refresh history">
          <RefreshCw size={18} />
        </button>
      </section>

      <div className="history-segments" role="tablist" aria-label="History range">
        {periodOptions.map((option) => (
          <button
            type="button"
            role="tab"
            aria-selected={option.id === period}
            className={option.id === period ? "active" : ""}
            key={option.id}
            onClick={() => selectPeriod(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <section className="history-period-nav">
        <button type="button" onClick={() => movePeriod(-1)} aria-label={`Previous ${period}`}>
          <ChevronLeft size={21} />
        </button>
        <strong>{formatPeriodLabel(period, range)}</strong>
        <button type="button" onClick={() => movePeriod(1)} disabled={!canGoForward} aria-label={`Next ${period}`}>
          <ChevronRight size={21} />
        </button>
      </section>

      {loading ? <div className="loading-box">Loading history...</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      <div className="analytics-grid">
        {metrics.map((metric) => (
          <HistoryChart
            key={metric.key}
            rows={history}
            metric={metric}
            period={period}
            range={range}
            electricityRate={electricityRate}
          />
        ))}
      </div>
    </div>
  );
}
