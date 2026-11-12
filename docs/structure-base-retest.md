# BOS and CHOCH origin-base retests

Owner instruction, 12 November 2026: a structure break alone is not an entry. Identify the original one- or two-candle base before displacement on the setup timeframe, wait for the setup candle to close through structure, then require price to revisit that base and print a completed M5 rejection. SL is at the full base wick extreme, with no added 30-pip buffer.

Entry uses the combined candle bodies of the origin base. The outer wick of the entire base defines invalidation: highest wick for SELL, lowest wick for BUY. The latest M5 candle confirms rejection; it no longer defines the BOS/CHOCH entry zone. Entry remains subject to a fresh quote inside the origin-body range. A rejection that has already moved outside the range does not authorize chasing price.

Initial deterministic base conventions:

- Search backward through at most six displacement candles from the confirmed break. Select the nearest preceding cluster of one or two opposite-direction candles.
- Each base candle's body is at most 50% of its full range. Multiple base candles must overlap, and the body range must remain on the origin side of the broken structural level.
- The first departure candle must have a directional body at least 60% of its range and close beyond the base body range. The displacement leg must not close back through the origin range.
- Existing two-sided confirmed pivots establish the first structure crossing and distinguish BOS from CHOCH. The setup candle must have closed before the M5 confirmation opens. Higher structure must align; unknown/ranging context is rejected. Setup timeframes remain M15, M30, H1, H4, W1 and MN1, with calendar-aware month ends.
- M5 must touch the original body range, have directional body at least 25% of range, close in the directional 35% of its range, and close beyond the origin range by two points. A completed close through the base wick invalidates the setup.
- Only the latest completed M5 candle qualifies, at most five minutes old, with existing quote freshness and real ask-side evidence for SELL. Entry width remains at most 80 pips.

These numerical conventions make the illustrated rule reproducible; they are not a guarantee of profitable or risk-free entry. No future candle may select a base or confirm a break.

The stop price changes specifically for new automated BOS/CHOCH setups. Shared exit-side M5-close stop monitoring, 50-pip BE management, three nearest intact M30/H1/H4 TP levels, access control and push processing remain in use. Existing published signals and performance history are not rewritten.

The database independently recomputes the original base, pivot/structure crossing, BOS/CHOCH classification, directional rejection, context and exact wick stop. During rollout, legacy BOS/CHOCH proposals without base evidence are ignored while existing signal monitoring continues. Stable identity prevents repeated publication of the same structure/base.

The bounded Nov 12 M30/M5 regression fixture reconstructs the owner's example from the relevant completed broker candles: origin body 3980.42–3982.78, highest wick 3984.99. The old 3970.85–3977.74 M5 range does not touch that origin body and is rejected. This establishes correct zone selection; it does not claim a hypothetical new trade would have filled or won.
