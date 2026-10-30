"""Private read-only API plus an hourly scrape; Panther handles notification delivery."""
import os
import subprocess
import sys
import threading
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from local_api import build_context, _upcoming_events

context = build_context("/opt/forex-factory/config.yaml")
stopping = threading.Event()


def refresh():
    while not stopping.is_set():
        try:
            result = subprocess.run(
                [sys.executable, "-m", "ff_calendar_toolkit.cli", "scrape"],
                cwd="/opt/forex-factory",
                timeout=600,
                check=False,
            )
            if result.returncode:
                print("Calendar scrape failed; retained data keeps its original timestamps.", flush=True)
        except (OSError, subprocess.TimeoutExpired):
            print("Calendar scrape unavailable.", flush=True)
        stopping.wait(3600)


@asynccontextmanager
async def lifespan(app):
    thread = threading.Thread(target=refresh, daemon=True)
    thread.start()
    yield
    stopping.set()


app = FastAPI(title="Panther private calendar source", lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health():
    return {"status": "running", "note": "Not a source-freshness check"}


@app.get("/events")
def events(currency: str = "USD", limit: int = Query(default=5000, ge=1, le=5000)):
    if currency != "USD":
        raise HTTPException(status_code=400, detail="USD calendar only")
    try:
        rows = _upcoming_events(context["view_options"].output_dir, 5000)
        if not rows:
            raise HTTPException(status_code=503, detail="No scraped calendar available")
        return [row for row in rows if row.get("currency") == "USD"][:limit]
    except (OSError, ValueError):
        raise HTTPException(status_code=503, detail="Calendar refresh in progress or unavailable")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8765")))
