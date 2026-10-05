/**
 * Area-path segment → solution name, for the monitor dashboard's "written"
 * list. Same names as DevOpsdocsWriter's product registry.
 */
const SOLUTIONS: ReadonlyMap<string, string> = new Map([
  ['Continia Banking', 'Continia Banking'],
  ['Document Capture', 'Continia Document Capture'],
  ['Expense Management', 'Continia Expense Management'],
  ['Payment Management', 'Continia Payment Management'],
  ['Collection Management', 'Continia Collection Management'],
  ['Document Output', 'Continia Document Output'],
  ['Continia Finance', 'Continia Finance'],
  ['OPplus', 'Continia OPplus'],
  ['Continia Sustainability', 'Continia Sustainability'],
  ['Continia eDocuments', 'Continia Delivery Network'],
]);

/**
 * Resolve an area path (e.g. `Continia Software\Continia Banking\Banking
 * Connectivity`) to a solution name. The first mapped segment wins; an unmapped
 * path falls back to its second segment (the area under the project root), or
 * null when there is none.
 */
export function solutionFromAreaPath(areaPath: string): string | null {
  const segments = areaPath.split('\\').map((s) => s.trim()).filter(Boolean);
  for (const segment of segments) {
    const solution = SOLUTIONS.get(segment);
    if (solution) return solution;
  }
  return segments[1] ?? null;
}
