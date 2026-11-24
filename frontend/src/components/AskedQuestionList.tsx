import React from 'react';
import type { AskedQuestion } from '../lib/questions';

// The candidate's view of the questions: only the ones the interviewer has asked so far,
// in order, the one on screen highlighted.
export const AskedQuestionList: React.FC<{ asked: AskedQuestion[]; current: AskedQuestion | null }> = ({ asked, current }) => (
  <div className="h-full overflow-y-auto p-2 space-y-2">
    {asked.length === 0 && <p className="p-2 text-xs text-slate-500">The interviewer hasn't asked a question yet.</p>}
    {asked.map((q, i) => {
      const onScreen = current?.index === q.index && current.text === q.text;
      return (
        <div
          key={`${q.index}-${i}`}
          className={`rounded-lg border p-2 text-xs ${onScreen ? 'border-brand/60 bg-brand/10' : 'border-white/5 bg-white/[0.03]'}`}
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-slate-500">
            <span>
              {i + 1}. {q.category} · {q.difficulty}
            </span>
            {onScreen && <span className="font-semibold text-brand">On screen</span>}
          </div>
          <p className="text-slate-300 whitespace-pre-wrap">{q.text}</p>
        </div>
      );
    })}
  </div>
);
