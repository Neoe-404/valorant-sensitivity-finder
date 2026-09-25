"use client";

interface ScoreCardProps {
  label: string;
  value: number;
  sub?: string;
  tone?: "accent" | "good" | "warn" | "default";
}

const TONES: Record<string, string> = {
  accent: "text-accent border-accent/40",
  good: "text-good border-good/40",
  warn: "text-warn border-warn/40",
  default: "text-fg border-line",
};

export function ScoreCard({ label, value, sub, tone = "default" }: ScoreCardProps) {
  const color = TONES[tone];
  return (
    <div className={`panel relative overflow-hidden p-4`}>
      <div
        className={`absolute inset-x-0 top-0 h-0.5 ${tone === "good" ? "bg-good/60" : tone === "warn" ? "bg-warn/60" : "bg-accent/60"}`}
      />
      <div className="text-[11px] uppercase tracking-widest text-dim">{label}</div>
      <div className={`mt-2 font-mono text-3xl font-bold ${tone === "default" ? "text-fg" : color.split(" ")[0]}`}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-dim">{sub}</div> : null}
    </div>
  );
}
