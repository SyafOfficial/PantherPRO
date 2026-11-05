"""Dedicated Windows MT5 read-only observer. Never use the signal-feed terminal."""
import argparse
import datetime as dt
import getpass
import json
import os
import re
import time
import urllib.request
from pathlib import Path

BASE = "https://pantherpro.onrender.com/api/bridge/clients"

def instant(milliseconds):
    return dt.datetime.fromtimestamp(milliseconds / 1000, dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def classify(deal, mapping):
    kind, amount = int(deal.type), float(deal.profit)
    if kind in (0, 1):  # Filled BUY/SELL deals; pending orders are not trades.
        return "trade", amount + float(deal.commission) + float(deal.swap) + float(getattr(deal, "fee", 0))
    if kind == 7:  # DEAL_TYPE_CREDIT, not cash deposits.
        return "bonus", amount
    if kind == 6:  # DEAL_TYPE_BALANCE: broker comments MUST be validated first.
        comment = str(deal.comment)
        if amount > 0 and re.fullmatch(mapping["deposit"], comment, re.IGNORECASE):
            return "deposit", amount
        if amount < 0 and re.fullmatch(mapping["withdrawal"], comment, re.IGNORECASE):
            return "withdrawal", amount
        if re.fullmatch(mapping["bonus"], comment, re.IGNORECASE):
            return "bonus", amount
    # Corrections, transfers, standalone commissions and other operations need review.
    return "unknown", amount

def post(token, payload):
    req = urllib.request.Request(BASE, data=json.dumps(payload, allow_nan=False).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)

def inspect(mt5, account, terminal, mapping):
    if not mt5.initialize(str(terminal), login=int(account["mt5_login"]),
            server=account["server"], password=account["investor_password"], timeout=30000, portable=True):
        raise RuntimeError("Account connection unavailable")
    info = mt5.account_info()
    if info is None or str(info.login) != account["mt5_login"] or info.server.lower() != account["server"].lower():
        raise RuntimeError("Account mismatch")
    if info.currency != "USD" or info.trade_mode != mt5.ACCOUNT_TRADE_MODE_REAL or info.trade_allowed:
        raise RuntimeError("Only live USD accounts with read-only access are accepted")
    if "vestrado" not in str(info.company).lower():
        raise RuntimeError("Broker mismatch")
    start = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    before = dt.datetime.now(dt.timezone.utc)
    deals = mt5.history_deals_get(start, before)
    total = mt5.history_deals_total(start, before)
    if deals is None or total is None or len(deals) != total or len(deals) > 50000:
        raise RuntimeError("Incomplete history")
    # History calls may succeed with an empty/truncated server archive. Reconcile all
    # balance-affecting cash and trade P/L to the observed balance. Unknown entries
    # block approvals; they are never silently interpreted as deposits.
    history = []
    for d in deals:
        kind, amount = classify(d, mapping)
        history.append({"ticket": str(d.ticket), "at": instant(d.time_msc), "kind": kind, "amount": amount})
    after = mt5.account_info()
    if after is None or after.login != info.login or abs(after.balance - info.balance) > .01:
        raise RuntimeError("Account changed while reading history; retry")
    reconciled = sum(d["amount"] for d in history if d["kind"] not in ("bonus",))
    # Credit is separate from balance in MT5; balance-type bonus requires explicit
    # handling and cannot be reconciled here, so those accounts require review.
    if abs(reconciled - float(after.balance)) > .02:
        raise RuntimeError("History balance does not reconcile; manual review required")
    return {"application_id": account["user_id"], "revision": account["revision"],
        "observed_at": instant(time.time() * 1000), "currency": "USD", "login": str(info.login),
        "server": info.server, "live": True, "read_only": True, "history_complete": True,
        "balance": float(after.balance), "equity": float(after.equity), "credit": float(after.credit), "deals": history}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--terminal", required=True, help="Dedicated portable MT5 terminal64.exe")
    parser.add_argument("--mapping", required=True, help="Validated per-server transaction classification JSON")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    terminal = Path(args.terminal).resolve()
    # Operator must explicitly designate a separately installed terminal.
    if "panther-client-monitor" not in str(terminal.parent).lower():
        raise SystemExit("Install a separate terminal under a Panther-Client-Monitor directory first.")
    mapping = json.loads(Path(args.mapping).read_text(encoding="utf-8"))
    if mapping.get("broker_validated") is not True or not mapping.get("servers"):
        raise SystemExit("Validate Vestrado deposit/withdrawal/bonus records before enabling monitoring.")
    token = os.environ.get("CLIENT_MONITOR_SECRET") or getpass.getpass("Client monitor secret (hidden): ")
    import MetaTrader5 as mt5
    print("Read-only client monitoring started. Keep the separate signal bridge running.", flush=True)
    while True:
        try:
            accounts = post(token, {"operation": "poll"})["accounts"]
            for a in accounts:
                try:
                    server_map = mapping["servers"].get(a["server"].lower())
                    if not server_map:
                        raise RuntimeError("Server mapping not validated")
                    for key in ("deposit", "withdrawal", "bonus"):
                        if not server_map.get(key):
                            raise RuntimeError("Missing transaction mapping")
                    observation = inspect(mt5, a, terminal, server_map)
                    result = post(token, observation)
                    print("Account check recorded" if result.get("accepted") else "Check superseded", flush=True)
                except Exception:
                    # Never log credentials, account details or HTTP response bodies.
                    print("Account check unavailable; existing decision retained. Review monitor health.", flush=True)
                finally:
                    mt5.shutdown()
                    a.pop("investor_password", None)
        except Exception:
            print("Monitor service unavailable; retrying. No automatic access decision.", flush=True)
        if args.once:
            return
        time.sleep(60)

if __name__ == "__main__":
    main()
