// File and folder names from titles: readable in every language, and always openable on Windows.

import { describe, expect, it } from 'vitest';
import { slugify } from '../src/shared/ids';

describe('slugify', () => {
  it('keeps English titles as before, and simplifies Latin accents', () => {
    expect(slugify('Example: Learn Git fundamentals')).toBe('example-learn-git-fundamentals');
    expect(slugify('Café & Crème brûlée: français')).toBe('cafe-creme-brulee-francais');
    expect(slugify('🚀 Rocket science 🚀')).toBe('rocket-science');
  });

  it('keeps the letters of every script, so non-English roadmaps get readable names', () => {
    expect(slugify('मशीन लर्निंग की शुरुआत')).toBe('मशीन-लर्निंग-की-शुरुआत');
    expect(slugify('ಯಂತ್ರ ಕಲಿಕೆ')).toBe('ಯಂತ್ರ-ಕಲಿಕೆ');
    expect(slugify('机器学习入门')).toBe('机器学习入门');
    expect(slugify('تعلم الآلة')).toBe('تعلم-الآلة');
  });

  it('never gives a name Windows reserves for devices', () => {
    expect(slugify('Con')).toBe('con-1');
    expect(slugify('NUL')).toBe('nul-1');
    expect(slugify('COM1')).toBe('com1-1');
    expect(slugify('console')).toBe('console');
  });

  it('falls back when nothing is left, and cuts long titles without breaking a character', () => {
    expect(slugify('🚀', 'roadmap')).toBe('roadmap');
    expect(slugify('', 'roadmap')).toBe('roadmap');
    const long = slugify('𠀀'.repeat(70));
    expect([...long]).toHaveLength(60);
    expect(long.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')).not.toMatch(/[\uD800-\uDFFF]/);
    expect(slugify('word '.repeat(30))).not.toMatch(/-$/);
  });
});
