FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium chromium-driver git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/forex-factory
RUN git init . \
    && git remote add origin https://github.com/fizahkhalid/forex_factory_calendar_news_scraper.git \
    && git fetch --depth 1 origin acc3aad102304724f0935ba5f116fa08aaca194d \
    && git checkout --detach FETCH_HEAD \
    && pip install --no-cache-dir -r requirements.txt
COPY config.yaml /opt/forex-factory/config.yaml
COPY serve.py /opt/forex-factory/panther_serve.py
ENV FF_CHROME_BIN=/usr/bin/chromium FF_CHROMEDRIVER_PATH=/usr/bin/chromedriver PYTHONUNBUFFERED=1
EXPOSE 8765
CMD ["python", "panther_serve.py"]
