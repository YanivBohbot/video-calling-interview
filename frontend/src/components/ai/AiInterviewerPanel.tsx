import React from 'react';
import { Bot, Send, Loader2, Square, Info } from 'lucide-react';
import type { ApiFetch } from '../../lib/api';
import { useAiInterviewer, type AiRole } from '../../lib/useAiInterviewer';
import { AiReport } from './AiReport';
import { AiMarkdown } from './AiMarkdown';

const NOTICE =
  'You are talking to an AI interviewer. Your code and messages are sent to OpenAI. The interviewer sees this conversation and receives a report at the end. You have one session.';

// The room's AI interviewer. The candidate chats with it about the code in the shared
// editor (`getCode` reads the editor's latest content); the interviewer follows read-only.
export const AiInterviewerPanel: React.FC<{
  apiFetch: ApiFetch;
  interviewId: string;
  role: AiRole;
  // The candidate's side only: the shared editor's latest content.
  getCode?: () => { code: string; language: string };
  // The panel has a text session (started here or found): the room stops offering the avatar.
  onTextSession?: () => void;
}> = ({ apiFetch, interviewId, role, getCode = () => ({ code: '', language: 'javascript' }), onTextSession }) => {
  const ai = useAiInterviewer({ apiFetch, interviewId, role });
  const hasTextSession = !!ai.session && ai.session.mode !== 'avatar';
  React.useEffect(() => {
    if (hasTextSession) onTextSession?.();
  }, [hasTextSession, onTextSession]);
  const [draft, setDraft] = React.useState('');
  const isCandidate = role === 'candidate';
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  // New messages, the session ending and the report arriving all bring the bottom into view.
  const reportStatus = ai.session?.reportStatus;
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [ai.messages, ai.phase, reportStatus]);

  const submit = () => {
    const text = draft.trim();
    if (!text || ai.replying) return;
    const { code, language } = getCode();
    setDraft('');
    void ai.send(text, code, language);
  };

  const start = () => {
    const { code, language } = getCode();
    void ai.start(code, language);
  };

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e] text-slate-200">
      <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-white/5 bg-[#252526]">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Bot size={16} className="text-violet-300" />
          {isCandidate ? 'AI interviewer' : "AI interviewer — candidate's session"}
          {ai.session?.mode === 'avatar' && (
            <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-300">
              Avatar interview
            </span>
          )}
        </span>
        {ai.phase === 'active' && (
          <button
            onClick={() => void ai.finish()}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-red-600/20 text-red-300 border border-red-600/30 hover:bg-red-600/30"
          >
            <Square size={12} /> End
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        {ai.phase === 'loading' && <Loader2 size={18} className="animate-spin text-slate-500" />}

        {ai.phase === 'idle' &&
          (isCandidate ? (
            <div className="space-y-4">
              <p className="flex gap-2 text-sm text-slate-300">
                <Info size={16} className="shrink-0 mt-0.5 text-violet-300" />
                {NOTICE}
              </p>
              <button onClick={start} className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium">
                Start AI interviewer
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">The candidate hasn't started the AI interviewer.</p>
          ))}

        {ai.messages.map((message, i) => (
          <div key={i} className={message.role === 'candidate' ? 'flex justify-end' : 'flex justify-start'}>
            {message.role === 'candidate' ? (
              <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm bg-brand/30 text-white">
                {message.text}
              </p>
            ) : (
              <div className="max-w-[85%] min-w-0 break-words rounded-xl px-3 py-2 text-sm bg-white/5 text-slate-100">
                <AiMarkdown text={message.text} />
              </div>
            )}
          </div>
        ))}
        {ai.replying && (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 size={12} className="animate-spin" /> The interviewer is thinking…
          </p>
        )}

        {ai.phase === 'finished' && ai.session && isCandidate && (
          <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
            The AI interview is over. Thank you — the interviewer will follow up with you.
          </p>
        )}
        {ai.phase === 'finished' && ai.session && !isCandidate && (
          <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-violet-300">Report</h3>
            <AiReport
              status={ai.session.reportStatus}
              report={ai.session.report}
              waitOver={ai.reportWaitOver}
              onCheckAgain={ai.checkReport}
              onRetry={() => void ai.retryReport()}
            />
          </div>
        )}

        {ai.error && <p className="text-xs text-red-300">{ai.error}</p>}
        <div ref={bottomRef} />
      </div>

      {isCandidate && ai.phase === 'active' && (
        <div className="shrink-0 border-t border-white/5 p-3 flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={ai.replying}
            rows={2}
            maxLength={4000}
            placeholder={ai.replying ? 'Wait for the answer…' : 'Ask, explain your idea, or say you are done'}
            className="flex-1 resize-none rounded-lg bg-[#2d2d2d] border border-white/10 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
          />
          <button
            onClick={submit}
            disabled={ai.replying || !draft.trim()}
            className="self-end p-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white disabled:opacity-40"
            title="Send (Enter)"
          >
            <Send size={16} />
          </button>
        </div>
      )}
    </div>
  );
};
