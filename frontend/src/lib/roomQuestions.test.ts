import { describe, it, expect } from 'vitest';
import { tabForQuestion, hasUnseenQuestions } from './roomQuestions';

describe('tabForQuestion', () => {
  it('opens the tab the question needs: code for technical, the whiteboard for system design', () => {
    expect(tabForQuestion('technical')).toBe('code');
    expect(tabForQuestion('system-design')).toBe('design');
  });

  it('leaves the tab alone for a behavioral question (it is just talked through)', () => {
    expect(tabForQuestion('behavioral')).toBeNull();
  });
});

describe('hasUnseenQuestions', () => {
  it('is true when questions were asked since the candidate last opened the list', () => {
    expect(hasUnseenQuestions(0, 0)).toBe(false);
    expect(hasUnseenQuestions(2, 1)).toBe(true);
    expect(hasUnseenQuestions(2, 2)).toBe(false);
  });
});
