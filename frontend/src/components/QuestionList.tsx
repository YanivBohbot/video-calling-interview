import React from 'react';
import { Sparkles } from 'lucide-react';
import type { Question } from '../lib/questions';
import { LeetCodeBadge } from './LeetCodeBadge';

// The interview's approved questions, each askable (interviewer only). Asking goes through
// the editor's live connection, so it needs the Code tab open (`canAsk`).
export const QuestionList: React.FC<{
  questions: Question[];
  currentIndex: number | null;
  canAsk: boolean;
  onAsk: (index: number) => void;
  onManage: () => void;
}> = ({ questions, currentIndex, canAsk, onAsk, onManage }) => (
  <div className="h-full flex flex-col min-h-0">
    <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5">
      <p className="text-xs text-slate-500">
        {canAsk ? 'Ask shows a question above the code.' : 'Open the Code Editor tab to ask a question.'}
      </p>
      {questions.length > 0 && (
        <button onClick={onManage} className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-brand hover:text-white">
          <Sparkles size={11} /> Edit / regenerate
        </button>
      )}
    </div>
    <div className="flex-1 overflow-y-auto p-2 space-y-2">
      {questions.length === 0 && (
        <div className="p-2 space-y-2">
          <p className="text-xs text-slate-500">No questions for this interview yet.</p>
          <button
            onClick={onManage}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-brand hover:bg-brand-hover px-3 py-2 text-xs font-semibold text-white"
          >
            <Sparkles size={13} /> Generate with AI
          </button>
        </div>
      )}
      {questions.map((q, i) => (
        <div
          key={i}
          className={`rounded-lg border p-2 text-xs ${currentIndex === i ? 'border-brand/60 bg-brand/10' : 'border-white/5 bg-white/[0.03]'}`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-slate-500">
              {i + 1}. {q.category} · {q.difficulty}
            </span>
            <button
              onClick={() => onAsk(i)}
              disabled={!canAsk}
              className="rounded-md bg-brand hover:bg-brand-hover px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              {currentIndex === i ? 'Asked' : 'Ask'}
            </button>
          </div>
          <p className="text-slate-300 line-clamp-3">{q.text}</p>
          {q.source && (
            <div className="mt-1">
              <LeetCodeBadge source={q.source} />
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
);
