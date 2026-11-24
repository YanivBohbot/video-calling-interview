import React from 'react';
import type { AskedQuestion, Question } from '../lib/questions';
import { LeetCodeBadge } from './LeetCodeBadge';

// The question on screen, above the room's workspace (code or whiteboard alike).
// `source`: the interviewer's view only; `hint`: shown while nothing is asked.
export const QuestionBanner: React.FC<{
  current: AskedQuestion | null;
  source?: Question['source'];
  hint?: string;
}> = ({ current, source, hint }) => {
  if (!current && !hint) return null;
  return (
    <div className="shrink-0 rounded-xl border border-white/5 bg-[#1b2433] px-4 py-3">
      {current ? (
        <>
          <div className="flex items-center gap-2 mb-1 text-[10px] font-bold uppercase tracking-widest text-sky-300">
            Current question
            <span className="font-medium normal-case tracking-normal text-slate-400">
              {current.category} · {current.difficulty}
            </span>
            {source && <LeetCodeBadge source={source} />}
          </div>
          <p className="text-sm text-slate-100 whitespace-pre-wrap max-h-28 overflow-y-auto">{current.text}</p>
        </>
      ) : (
        <p className="text-xs text-slate-500">{hint}</p>
      )}
    </div>
  );
};
