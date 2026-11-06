import { z } from "zod";
import { STRATEGIES, TIMEFRAMES, TIMEFRAME_MINUTES } from "./strategy";
export const signalSchema = z
  .object({
    instrument: z.literal("XAUUSD"),
    strategy: z.enum(STRATEGIES).nullable().optional(),
    timeframe: z.enum(TIMEFRAMES).nullable().optional(),
    higher_timeframe: z.enum(TIMEFRAMES).nullable().optional(),
    direction: z.enum(["BUY", "SELL"]),
    entry: z.number().positive(),
    stop_loss: z.number().positive(),
    tp1: z.number().positive(),
    tp2: z.number().positive(),
    tp3: z.number().positive(),
    reasoning: z.string().trim().min(20).max(2000),
    access: z.literal("public"),
  })
  .superRefine((s, ctx) => {
    if (
      s.strategy === "HNS" &&
      !["M15", "M30", "H1", "H4"].includes(s.timeframe ?? "")
    )
      ctx.addIssue({
        code: "custom",
        message: "HNS setup timeframes are M15, M30, H1 and H4.",
      });
    if (
      Boolean(s.strategy) !== Boolean(s.timeframe) ||
      (!s.timeframe && s.higher_timeframe) ||
      (s.timeframe &&
        s.higher_timeframe &&
        TIMEFRAME_MINUTES[s.higher_timeframe] <= TIMEFRAME_MINUTES[s.timeframe])
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Choose a strategy and setup timeframe together; context must be strictly higher, up to Weekly.",
      });
    const valid =
      s.direction === "BUY"
        ? s.stop_loss < s.entry &&
          s.entry < s.tp1 &&
          s.tp1 < s.tp2 &&
          s.tp2 < s.tp3
        : s.stop_loss > s.entry &&
          s.entry > s.tp1 &&
          s.tp1 > s.tp2 &&
          s.tp2 > s.tp3;
    if (!valid)
      ctx.addIssue({
        code: "custom",
        message:
          "Stop loss and ordered targets must match the signal direction.",
      });
  });
export type Role = "public" | "admin";
export function canTransition(from: string, to: string) {
  return (
    (
      {
        draft: ["pending"],
        pending: ["active", "closed"],
        active: ["closed"],
        closed: [],
      } as Record<string, string[]>
    )[from]?.includes(to) ?? false
  );
}
