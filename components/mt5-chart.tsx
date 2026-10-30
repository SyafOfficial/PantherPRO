"use client";
import React from "react";
import type { MT5Display } from "@/lib/engine/display";
export default function MT5Chart({
  data,
  fresh,
}: {
  data: MT5Display;
  fresh: boolean;
}) {
  const bars = data.bars;
  if (!bars.length)
    return (
      <div className="chart-empty">
        No completed candles received for this timeframe.
      </div>
    );
  const min = Math.min(...bars.map((b) => b.low), data.quote.bid),
    max = Math.max(...bars.map((b) => b.high), data.quote.bid),
    pad = Math.max((max - min) * 0.08, 0.05),
    bottom = min - pad,
    top = max + pad;
  const y = (v: number) => 240 - ((v - bottom) / (top - bottom)) * 220;
  const step = 660 / bars.length,
    width = Math.max(1, Math.min(8, step * 0.65)),
    bidY = y(data.quote.bid);
  return (
    <div className="chart mt5-chart">
      <svg
        viewBox="0 0 760 300"
        role="img"
        aria-label={`Actual Vestrado XAUUSD.V ${data.timeframe} completed candlestick chart. Broker candle times. ${fresh ? "Latest received bid." : "Last received bid is stale."}`}
      >
        {Array.from({ length: 5 }, (_, i) => {
          const value = top - ((top - bottom) * i) / 4;
          return (
            <g key={i}>
              <line
                x1="8"
                y1={y(value)}
                x2="680"
                y2={y(value)}
                stroke="#232630"
                strokeDasharray="3 5"
              />
              <text x="688" y={y(value) + 4} fill="#8a8f9b" fontSize="10">
                {value.toFixed(2)}
              </text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const x = 12 + i * step,
            up = b.close >= b.open,
            color = up ? "#67b6a2" : "#d7737a";
          return (
            <g key={b.opened_at_server_raw} stroke={color}>
              <title>{`Broker ${new Date(b.opened_at_server_raw * 1000).toISOString().slice(0, 16).replace("T", " ")} · O ${b.open} H ${b.high} L ${b.low} C ${b.close}`}</title>
              <line
                x1={x + width / 2}
                y1={y(b.high)}
                x2={x + width / 2}
                y2={y(b.low)}
              />
              <rect
                x={x}
                y={Math.min(y(b.open), y(b.close))}
                width={width}
                height={Math.max(1, Math.abs(y(b.open) - y(b.close)))}
                fill={color}
              />
            </g>
          );
        })}
        <line
          x1="8"
          y1={bidY}
          x2="680"
          y2={bidY}
          stroke={fresh ? "#d9b66f" : "#727684"}
          strokeDasharray="4 4"
        />
        <rect
          x="682"
          y={bidY - 10}
          width="77"
          height="20"
          rx="3"
          fill={fresh ? "#d9b66f" : "#727684"}
        />
        <text x="687" y={bidY + 4} fill="#121318" fontSize="10">
          {data.quote.bid.toFixed(2)}
        </text>
        {[0, Math.floor((bars.length - 1) / 2), bars.length - 1].map(
          (index, i) => (
            <text
              key={i}
              x={12 + index * step}
              y="268"
              textAnchor={i === 2 ? "end" : "start"}
              fill="#8a8f9b"
              fontSize="10"
            >
              {new Date(bars[index].opened_at_server_raw * 1000)
                .toISOString()
                .slice(5, 16)
                .replace("T", " ")}
            </text>
          ),
        )}
        <text x="12" y="290" fill="#8a8f9b" fontSize="10">
          Broker candle time · completed bars ·{" "}
          {fresh ? "observed bid" : "stale bid"} · MT5 snapshots ~10s
        </text>
      </svg>
    </div>
  );
}
