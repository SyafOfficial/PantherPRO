"""Read-only serial account observer for a dedicated portable Windows terminal."""
import argparse
import datetime as dt
import getpass
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://pantherpro.onrender.com/api/bridge/clients"

def instant(milliseconds):
    return dt.datetime.fromtimestamp(milliseconds / 1000, dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def deal_amount(deal):
    amount = sum(float(getattr(deal, field, 0)) for field in ("profit", "commission", "swap", "fee"))
    if not math.isfinite(amount):
        raise RuntimeError("Invalid amount")
    return amount

def classify(deal, mapping, mt5, login=None):
    kind, amount = int(deal.type), deal_amount(deal)
    comment = str(deal.comment).strip()
    if kind in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
        if float(getattr(deal, "volume", 0)) <= 0:
            return "unknown", amount
        return "trade", amount
    if kind in (mt5.DEAL_TYPE_CREDIT, mt5.DEAL_TYPE_BONUS):
        return "bonus", amount
    if kind in (mt5.DEAL_TYPE_BALANCE, mt5.DEAL_TYPE_CORRECTION):
        # Exact comments reviewed for this login only; never generalise every IT
        # transfer, or every account using the same comment, into cash or bonus.
        reviewed_bonus = mapping.get("reviewed_bonus_comments", [])
        if comment in reviewed_bonus:
            return "bonus", amount
        if re.fullmatch(mapping.get("adjustment", r"(?!)"), comment, re.IGNORECASE):
            return "adjustment", amount
        if re.fullmatch(mapping["bonus"], comment, re.IGNORECASE):
            return "bonus", amount
        if kind == mt5.DEAL_TYPE_BALANCE:
            if amount > 0 and re.fullmatch(mapping["deposit"], comment, re.IGNORECASE):
                return "deposit", amount
            if amount < 0 and re.fullmatch(mapping["withdrawal"], comment, re.IGNORECASE):
                return "withdrawal", amount
    return "unknown", amount

def post(token, payload):
    req = urllib.request.Request(BASE, data=json.dumps(payload, allow_nan=False).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
    # The fixed first-party HTTPS endpoint must never redirect credentials or secrets.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    with urllib.request.build_opener(NoRedirect).open(req, timeout=45) as response:
        return json.load(response)

def inspect(mt5, account, terminal, mapping):
    terminal = Path(terminal).resolve()
    # Bind without client credentials FIRST, then verify the dedicated data path.
    # Only the dedicated terminal may ever receive a client's login/password.
    if not mt5.initialize(str(terminal), timeout=30000, portable=True):
        raise RuntimeError("Terminal connection unavailable")
    terminal_info = mt5.terminal_info()
    expected = os.path.normcase(str(terminal.parent))
    if terminal_info is None or os.path.normcase(str(Path(terminal_info.data_path).resolve())) != expected:
        raise RuntimeError("Dedicated terminal unavailable or path mismatch")
    if os.path.normcase(str(Path(terminal_info.path).resolve())) != expected:
        raise RuntimeError("Terminal install path mismatch")
    if not mt5.login(int(account["mt5_login"]), server=account["server"], password=account["investor_password"], timeout=30000):
        raise RuntimeError("Read-only login unavailable")
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
    account_mapping = dict(mapping)
    account_mapping["reviewed_bonus_comments"] = account.get("reviewed_bonus_comments", [])
    history = []
    for d in deals:
        kind, amount = classify(d, account_mapping, mt5, info.login)
        history.append({"ticket": str(d.ticket), "at": instant(d.time_msc), "kind": kind, "amount": amount})
    after = mt5.account_info()
    if after is None or after.login != info.login or abs(after.balance - info.balance) > .01 or abs(after.credit - info.credit) > .01:
        raise RuntimeError("Account changed while reading history; retry")
    # Raw balance reconciliation includes balance-type bonuses and corrections;
    # credit is separate. Eligibility excludes bonus funds on the server.
    balance_ledger = sum(deal_amount(d) for d in deals if d.type != mt5.DEAL_TYPE_CREDIT)
    credit_ledger = sum(deal_amount(d) for d in deals if d.type == mt5.DEAL_TYPE_CREDIT)
    if abs(balance_ledger - float(after.balance)) > .02 or abs(credit_ledger - float(after.credit)) > .02:
        raise RuntimeError("History does not reconcile; review required")
    return {"application_id": account["user_id"], "revision": account["revision"],
        "observed_at": instant(time.time() * 1000), "currency": "USD", "login": str(info.login),
        "server": info.server, "live": True, "read_only": True, "history_complete": True,
        "balance": float(after.balance), "equity": float(after.equity), "credit": float(after.credit), "deals": history}

def acquire_lock(folder):
    import msvcrt
    lock = open(folder / "client-observer.lock", "a+b")
    lock.seek(0); lock.write(b"0"); lock.flush(); lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        lock.close()
        raise SystemExit("A client observer is already running in this folder.")
    return lock

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--terminal", required=True)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    terminal = Path(args.terminal).resolve()
    if terminal.parent.name.lower() != "panther-client-monitor":
        raise SystemExit("Use the separate Panther-Client-Monitor installation.")
    mapping = json.loads(Path(args.mapping).read_text(encoding="utf-8"))
    if mapping.get("broker_validated") is not True or not mapping.get("servers"):
        raise SystemExit("Transaction mapping has not been validated.")
    lock = acquire_lock(terminal.parent)
    token = os.environ.get("CLIENT_MONITOR_SECRET") or getpass.getpass("Client monitor secret (hidden): ")
    if len(token) < 32:
        raise SystemExit("Invalid monitor secret")
    import MetaTrader5 as mt5
    print("Client observer started. Only the dedicated terminal is used. Ctrl+C stops this observer.", flush=True)
    cursor = None
    while True:
        try:
            batch = post(token, {"operation": "poll", "cursor": cursor})
            accounts = batch["accounts"]
            cursor = batch.get("next_cursor")
            if not accounts:
                print("Observer online: no accounts due for verification.", flush=True)
            for a in accounts:
                reference = str(a["mt5_login"])[-4:]
                try:
                    server_map = mapping["servers"].get(a["server"].lower())
                    if not server_map:
                        raise RuntimeError("Server mapping not validated")
                    observation = inspect(mt5, a, terminal, server_map)
                    result = post(token, observation)
                    message = (result.get("status", "recorded") + " / " + result.get("reason", "checked")) if result.get("accepted") else "superseded; retry on next poll"
                    print("Account ending " + reference + ": " + message, flush=True)
                except Exception:
                    print("Account ending " + reference + ": check unavailable; correct server/password or review history. Existing decision retained.", flush=True)
                finally:
                    mt5.shutdown()
                    a.pop("investor_password", None)
        except KeyboardInterrupt:
            break
        except Exception:
            print("Monitor API unavailable; retrying. No new access decision.", flush=True)
        if args.once:
            break
        try:
            time.sleep(60)
        except KeyboardInterrupt:
            break
    lock.close()

if __name__ == "__main__":
    main()
