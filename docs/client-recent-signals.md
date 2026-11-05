# Client Recent Signals

Signal Desk displays active published signals plus selected closed publications from the last 30 days. Active signals remain visible while active even if older. Closed publications expire from client access 30 days after publication; physical cleanup still uses the existing closed-signal retention job.

The one-time migration curates existing closed history: only the two latest genuine TP-hit signals remain visible to members. It does not change outcomes, prices or timestamps. Other existing records remain available to administrators. The UI calls this selected recent history, not a complete performance record.

New signals default to client_desk_visible=true regardless of eventual outcome. TP, SL and BE results from future publications are retained on the same basis. There is no continuing winners-only filter. RLS enforces member visibility and expiry independently of the UI; administrators retain access to source rows and the permanent performance ledger. No aggregate win rate or performance totals are exposed in the client terminal.

The terminal reads 50 records per page, with newer/older navigation throughout the window. Strategy/timeframe filters apply to the current page. Active and daily count cards retain their database aggregates and MYT session rules. Hiding the three older closed records does not rewrite historical publication counts or admin statistics.
