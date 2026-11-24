import type { AskedQuestion } from './questions';

export type RoomTab = 'code' | 'design';

// The tab a question needs, so both rooms switch to it when the interviewer asks it.
// A behavioral question needs none: it is talked through, wherever the room is.
export const tabForQuestion = (category: AskedQuestion['category']): RoomTab | null => {
  if (category === 'technical') return 'code';
  if (category === 'system-design') return 'design';
  return null;
};

// The candidate's Questions button blinks while questions were asked they haven't looked at.
export const hasUnseenQuestions = (askedCount: number, seenCount: number) => askedCount > seenCount;
