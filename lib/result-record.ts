import type { CandidateScore, HistoryRecord, SessionSnapshot } from "@/types";

export function bestMeasuredCandidate(candidates: CandidateScore[]): CandidateScore | null {
  let best: CandidateScore | null = null;
  for (const candidate of candidates) {
    if (!candidate.finished || candidate.overallScore === null) continue;
    if (best === null || candidate.overallScore > (best.overallScore ?? 0)) best = candidate;
  }
  return best;
}

export function formatMeasuredScore(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function historyRecordFromSnapshot(snapshot: SessionSnapshot, best: CandidateScore): HistoryRecord {
  const { id, createdAt, rounds, recommendation, settings } = snapshot;
  return {
    id,
    date: new Date(createdAt).toISOString(),
    dpi: settings.dpi,
    baseSensitivity: settings.baseSensitivity,
    recommendedSensitivity: recommendation.sensitivity,
    rangeMin: recommendation.rangeMin,
    rangeMax: recommendation.rangeMax,
    eDpi: recommendation.eDpi,
    flick: Math.round(best.flickScore ?? 0),
    tracking: Math.round(best.trackingScore ?? 0),
    micro: Math.round(best.microScore ?? 0),
    overall: Math.round(best.overallScore ?? 0),
    confidence: recommendation.confidence,
    confidenceLabel: recommendation.confidenceLabel,
    rounds,
    snapshot,
  };
}
