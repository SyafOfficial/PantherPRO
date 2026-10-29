export type FedRate = {
  kind: "scalar" | "range";
  lower: number;
  upper: number;
};
export function parseFedRate(value: string | null): FedRate | null {
  if (value === null) return null;
  const s = value.trim();
  const range = /^(\d+(?:\.\d+)?)\s*%?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*%$/.exec(s);
  if (range) {
    const lower = Number(range[1]),
      upper = Number(range[2]);
    return lower <= upper && upper <= 100
      ? { kind: "range", lower, upper }
      : null;
  }
  const scalar = /^(\d+(?:\.\d+)?)\s*%$/.exec(s);
  if (!scalar) return null;
  const rate = Number(scalar[1]);
  return rate <= 100 ? { kind: "scalar", lower: rate, upper: rate } : null;
}
export function compareFedRates(actual: FedRate, reference: FedRate) {
  if (actual.kind !== reference.kind) return null;
  const lower_bps = Number(((actual.lower - reference.lower) * 100).toFixed(6));
  const upper_bps = Number(((actual.upper - reference.upper) * 100).toFixed(6));
  return {
    comparison:
      lower_bps === 0 && upper_bps === 0
        ? "in_line"
        : lower_bps >= 0 && upper_bps >= 0
          ? "above"
          : lower_bps <= 0 && upper_bps <= 0
            ? "below"
            : "mixed_range",
    lower_bps,
    upper_bps,
  };
}
