export type PositionLabel =
  | "Leading peer set"
  | "Above peer benchmark"
  | "In line with peers"
  | "Below peer benchmark"
  | "Trailing peer benchmark";

export function getPositionLabel(gap: number): PositionLabel {
  if (gap >= 5) return "Leading peer set";
  if (gap >= 1) return "Above peer benchmark";
  if (gap > -1) return "In line with peers";
  if (gap > -5) return "Below peer benchmark";
  return "Trailing peer benchmark";
}

export function isStrongPosition(label: PositionLabel): boolean {
  return label === "Leading peer set" || label === "Above peer benchmark";
}

export function isWeakPosition(label: PositionLabel): boolean {
  return label === "Below peer benchmark" || label === "Trailing peer benchmark";
}
