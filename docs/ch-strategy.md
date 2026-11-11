# Cup and Handle

CH produces normal BUY and inverse SELL setups on M15, M30, H1 and H4. Entry requires a completed setup candle to close beyond the full cup rim, then a completed M5 retest/rejection of that rim. A handle trendline break below the full rim does not qualify on its own. Both continuation and reversal formations can qualify when existing higher timeframe structure agrees.

Four anchors identify the left rim, cup base, right rim and shallow handle. Each needs a strict two-sided pivot with two completed bars on each side, confirmed before the breakout. Ambiguous outside-bar pivots are discarded. Intermediate cup swings are allowed; the selected base must be the cup's actual extreme.

Initial deterministic geometry conventions:

- Cup width 12–120 setup bars; base position 25–75% through the cup.
- Rim height difference at most 20% of cup depth; the rim may slope.
- At least three bars and 15% of cup bars lie within the deepest quarter of the cup. At quarter and three-quarter width, close depth is at least 60% of full cup depth. This screens out sharp V formations.
- Handle depth 10–50% of cup depth; width at least three bars and at most half the cup width. The full handle must remain shallow.
- First rim close crossing only, with two-point buffer, within the latest 12 completed setup bars. No prior cup/handle close beyond the rim and no reclaimed rim after the breakout.
- M5 rejection touches the projected rim, has at least 25% directional body, closes in the directional 35% of its range beyond the rim, and breaks the preceding M5 extreme. It must be the latest completed M5 candle and no more than five minutes old; shared feed freshness rules also apply.

These geometry thresholds are starting conventions, not demonstrated profitability. The same rules mirror for inverse SELL. Volume is not an additional mandatory filter.

Higher timeframe alignment remains M15→M30, M30→H1, H1→H4, H4→W1. Unknown, ranging or opposing context is rejected.

Management is shared with structural signals: full M5 rejection candle zone, maximum 80 pips; SL 30 pips beyond that zone, triggered by exit-side M5 close; BE management after 50 pips; TP1–TP3 at the nearest three intact M30/H1/H4 levels. Measured cup-depth targets do not replace these TP levels. Entry requires a fresh quote inside the zone. SELL requires actual ask M5 history.

CH runs inside the existing snapshot cycle without new database polls or services. Pattern identity uses symbol, timeframe, direction and four anchor timestamps. Shared confirmation deduplication keeps one method per timeframe/direction/confirmation, preserving HNS priority, then CH before legacy structural methods. The database independently validates cup, handle, break, rejection, context and stop evidence before publication. Existing push, SL/BE/TP monitoring and setup-win statistics apply unchanged. No broker orders are executed.
