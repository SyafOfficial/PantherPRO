export const OFFICIAL_FEEDS = [
  {
    id: "fed",
    name: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_monetary.xml",
    hosts: ["www.federalreserve.gov", "federalreserve.gov"],
  },
  {
    id: "nfp",
    name: "BLS · Employment",
    url: "https://www.bls.gov/feed/news_release/empsit.rss",
    hosts: ["www.bls.gov", "bls.gov"],
  },
  {
    id: "cpi",
    name: "BLS · CPI",
    url: "https://www.bls.gov/feed/news_release/cpi.rss",
    hosts: ["www.bls.gov", "bls.gov"],
  },
  {
    id: "ppi",
    name: "BLS · PPI",
    url: "https://www.bls.gov/feed/news_release/ppi.rss",
    hosts: ["www.bls.gov", "bls.gov"],
  },
] as const;
export type OfficialHeadline = {
  id: string;
  title: string;
  url: string;
  published_at: string;
  source: string;
};
function plain(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(amp|lt|gt|quot|apos);/g,
      (_, name) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name as "amp"],
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
      const cp =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return cp > 31 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
        ? String.fromCodePoint(cp)
        : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}
export function parseOfficialFeed(
  xml: string,
  feed: (typeof OFFICIAL_FEEDS)[number],
  now: number,
) {
  if (
    xml.length > 262144 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !/<rss[\s>]/i.test(xml)
  )
    throw new Error("Unsupported or unsafe RSS");
  const result: OfficialHeadline[] = [];
  for (const [index, match] of [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi),
  ]
    .slice(0, 100)
    .entries()) {
    const field = (name: string) =>
      plain(
        new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, "i").exec(
          match[1],
        )?.[1] ?? "",
      );
    const title = field("title"),
      link = field("link"),
      published = Date.parse(field("pubDate"));
    try {
      const url = new URL(link);
      if (
        !title ||
        title.length > 500 ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !feed.hosts.some((h) => h === url.hostname) ||
        !Number.isFinite(published) ||
        published > now + 300000
      )
        continue;
      result.push({
        id: `${feed.id}:${published}:${index}`,
        title,
        url: url.href,
        published_at: new Date(published).toISOString(),
        source: feed.name,
      });
    } catch {
      /* Invalid source items never become attributed headlines. */
    }
  }
  return result;
}
export async function officialNews(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  const reports = await Promise.all(
    OFFICIAL_FEEDS.map(async (feed) => {
      try {
        const response = await fetcher(feed.url, {
          redirect: "error",
          signal: AbortSignal.timeout(6000),
          next: { revalidate: 60 },
        });
        if (!response.ok) throw new Error("Feed unavailable");
        if (Number(response.headers.get("content-length") ?? 0) > 262144)
          throw new Error("Feed too large");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty feed");
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.length;
            if (bytes > 262144) throw new Error("Feed too large");
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const items = parseOfficialFeed(
          new TextDecoder().decode(Buffer.concat(chunks)),
          feed,
          now,
        );
        return { source: feed.name, status: "available" as const, items };
      } catch {
        return {
          source: feed.name,
          status: "unavailable" as const,
          items: [] as OfficialHeadline[],
        };
      }
    }),
  );
  const seen = new Set<string>();
  const headlines = reports
    .flatMap((r) => r.items)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .filter((h) => {
      if (seen.has(h.url)) return false;
      seen.add(h.url);
      return true;
    })
    .slice(0, 20);
  return {
    kind: "official_releases" as const,
    fetched_at: new Date(now).toISOString(),
    refresh_seconds: 60,
    headlines,
    sources: reports.map(({ source, status }) => ({ source, status })),
    economic_calendar: "not_connected" as const,
  };
}
export type OfficialNews = Awaited<ReturnType<typeof officialNews>>;
