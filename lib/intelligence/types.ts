import type { CalendarEvent, LicensedQuote } from "../market-data";
export type Bias = "bullish" | "bearish" | "neutral" | "insufficient_data";
export type Evidence = {
  id: string;
  provider_id: string;
  source: string;
  timestamp: string;
  reference: string;
};
export type Analysis = {
  mode: "technical" | "pre_news" | "post_news";
  bias: Bias;
  title: string;
  summary: string;
  generated_at: string;
  evidence: Evidence[];
  limitations: string[];
  explanations: string[];
  metrics: Record<string, number | string | null>;
  scenarios: { condition: string; interpretation: string }[];
  event_id?: string;
  source_latest_at: string | null;
  valid_until: string | null;
  engine: "panther-rules-v1";
  model_status: "disconnected";
};
export type IntelligenceInputs = {
  quotes: LicensedQuote[];
  events: CalendarEvent[];
  as_of: string;
};
export type IntelligenceBundle = {
  technical: Analysis;
  pre_news: Analysis[];
  post_news: Analysis[];
  error: boolean;
};
