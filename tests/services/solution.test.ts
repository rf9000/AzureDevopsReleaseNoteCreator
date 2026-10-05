import { describe, test, expect } from 'bun:test';
import { solutionFromAreaPath } from '../../src/services/solution.ts';

describe('solutionFromAreaPath', () => {
  test('maps a product area segment to the solution name', () => {
    expect(solutionFromAreaPath('Continia Software\\Continia Banking\\Connectivity')).toBe('Continia Banking');
    expect(solutionFromAreaPath('Continia Software\\Document Capture')).toBe('Continia Document Capture');
    expect(solutionFromAreaPath('Continia Online\\Continia eDocuments')).toBe('Continia Delivery Network');
  });

  test('falls back to the area under the project root', () => {
    expect(solutionFromAreaPath('Continia Software\\InHouse\\Tools')).toBe('InHouse');
  });

  test('returns null for the project root or an empty path', () => {
    expect(solutionFromAreaPath('Continia Software')).toBeNull();
    expect(solutionFromAreaPath('')).toBeNull();
  });
});
