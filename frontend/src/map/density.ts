/** Density classes (sites per 1,000 km2) for the district choropleth and its legend. */
export const DENSITY_STEPS = [0, 1, 3, 6, 12] as const;
export const DENSITY_COLORS = ['#f7ecd0', '#ecc98a', '#d9974f', '#b8602f', '#7f2f1d'] as const;

export function densityColor(d: number | null): string {
  if (d === null) return '#e5e0d6';
  let i = 0;
  for (let k = 0; k < DENSITY_STEPS.length; k++) if (d >= DENSITY_STEPS[k]!) i = k;
  return DENSITY_COLORS[i]!;
}
