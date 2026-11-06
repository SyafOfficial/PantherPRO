# Head and Shoulders

HNS adds normal SELL and inverse BUY setups on M15, M30, H1 and H4. A completed setup candle must break the projected neckline, followed by a completed M5 retest and directional rejection. Wick-only breaks and reclaimed necklines do not qualify.

The detector uses five alternating, confirmed pivots: shoulder, neckline, head, neckline, shoulder. Each pivot needs two completed candles on both sides. Outside bars that qualify as both pivot types are discarded. Consecutive pivots of the same type retain the more extreme price. Horizontal and sloped necklines are supported.

Initial geometry conventions: adjacent pivots are at least three bars apart; the pattern spans at most 120 bars; the head rises at least 10% of its neckline height beyond both shoulders; shoulder height difference is at most 35% of that height; neckline tilt is at most 50%; left/right widths have ratio 0.4–2.5. The preceding approach must cover at least half the head height. These are deterministic starting parameters, not a demonstrated profitability claim.

Only the first neckline close crossing qualifies, with a two-point buffer. The breakout must be within the last 12 completed setup bars. M5 rejection must touch the projected neckline, have directional body of at least 25% of its range, close in the directional 35% of its range, and break the preceding M5 extreme. Its close must stay beyond the neckline. A reclaim after the breakout invalidates the setup. Confirmation must be the latest completed M5 candle, at most five minutes old. Existing feed freshness rules also apply.

Higher timeframe structure must align: M15→M30, M30→H1, H1→H4, H4→W1. Unknown, ranging and opposing structure are rejected.

Management is shared with existing structural signals: full M5 rejection zone, maximum 80 pips; SL 30 pips outside that zone, triggered by an exit-side M5 close; BE management at 50 pips; TP1–TP3 from the three nearest intact M30/H1/H4 levels. No measured-head-height target replaces existing TP rules. SELL needs actual ask M5 history. Entry requires the current quote inside the zone.

The existing snapshot cycle scans HNS without extra database polling or services. Pattern identity uses its five pivot timestamps, symbol, direction and timeframe, preventing repeated publication of the same pattern. When HNS and another structural method share a confirmation, timeframe and direction, HNS takes priority. Existing publication permissions, push delivery, monitoring and setup-win statistics remain shared.

The database independently recomputes pattern, break, rejection, alignment and stop evidence before publication. This feature produces hypothetical signals and does not execute broker orders.
