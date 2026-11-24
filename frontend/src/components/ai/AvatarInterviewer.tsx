import React from 'react';
import { Bot, Loader2, Mic, RefreshCw, Send, Square, Info } from 'lucide-react';
import type { AvatarInterviewer as AvatarState } from '../../lib/useAvatarInterviewer';
import { canTypeToAvatar } from '../../lib/avatarTurns';

const NOTICE =
  'An AI interviewer with a talking avatar runs the interview: it asks the questions out loud and listens through your microphone. What you say and your code are sent to OpenAI and HeyGen. Your interviewer reads the conversation and receives a report.';

// Shown in the candidate room when the interview allows it and the interviewer is absent.
export const AvatarStartCard: React.FC<{ onStart: () => void; error: string | null }> = ({ onStart, error }) => (
  <div className="shrink-0 rounded-2xl border border-brand/30 bg-brand/10 p-4 space-y-3">
    <p className="flex items-center gap-2 text-sm font-semibold text-violet-100">
      <Bot size={16} className="text-violet-300" />
      Your interviewer isn't here.
    </p>
    <p className="flex gap-2 text-xs text-slate-300">
      <Info size={14} className="shrink-0 mt-0.5 text-violet-300" />
      {NOTICE}
    </p>
    <button
      onClick={onStart}
      className="w-full px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium"
    >
      Start the interview with the AI interviewer
    </button>
    {error && <p className="text-xs text-red-300">{error}</p>}
  </div>
);

// The avatar interview, in place of the room's video call: the avatar, captions (what it said,
// what it understood), a "Type instead" input and End.
export const AvatarInterviewer: React.FC<{ avatar: AvatarState }> = ({ avatar }) => {
  const [draft, setDraft] = React.useState('');
  const active = avatar.status === 'connecting' || avatar.status === 'live' || avatar.status === 'dropped';
  const canType = canTypeToAvatar(avatar.status, avatar.busy);
  const dir = avatar.captionLanguage === 'he' ? 'rtl' : 'ltr';

  const submit = () => {
    const text = draft.trim();
    if (!text || !canType) return;
    setDraft('');
    avatar.sendTyped(text);
  };

  return (
    <div className="flex-1 min-h-0 bg-slate-900 rounded-2xl overflow-hidden border border-white/5 shadow-inner flex flex-col">
      <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-white/5 bg-slate-800/60">
        <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <Bot size={16} className="text-violet-300" />
          AI interviewer
        </span>
        {active && (
          <button
            onClick={() => void avatar.end()}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-red-600/20 text-red-300 border border-red-600/30 hover:bg-red-600/30"
          >
            <Square size={12} /> End
          </button>
        )}
      </div>

      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center">
        {/* Never muted: the avatar's voice comes through this element. */}
        <video ref={avatar.videoRef} autoPlay playsInline className={`w-full h-full object-cover ${avatar.status === 'live' ? '' : 'opacity-30'}`} />
        {avatar.status === 'connecting' && (
          <p className="absolute flex items-center gap-2 text-sm text-slate-300">
            <Loader2 size={16} className="animate-spin" /> Connecting to the AI interviewer…
          </p>
        )}
        {avatar.status === 'dropped' && (
          <div className="absolute text-center space-y-3 px-6">
            <p className="text-sm text-slate-300">The avatar is disconnected. Your interview is still on.</p>
            <button
              onClick={() => void avatar.reconnect()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium"
            >
              <RefreshCw size={14} /> Reconnect
            </button>
          </div>
        )}
        {avatar.status === 'finished' && (
          <p className="absolute px-6 text-center text-sm text-slate-300">
            {avatar.endedBy === 'interviewer'
              ? 'The interviewer ended the session.'
              : 'The AI interview is over. Thank you — the interviewer will follow up with you.'}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-white/5 px-4 py-3 space-y-2 text-sm">
        {avatar.avatarLine && (
          <p dir={dir} className="text-slate-100 max-h-24 overflow-y-auto">
            <span className="text-[10px] font-bold uppercase tracking-widest text-violet-300 me-2">Interviewer</span>
            {avatar.avatarLine}
          </p>
        )}
        {avatar.heardLine && (
          <p dir={dir} className="text-slate-400 max-h-16 overflow-y-auto">
            <span className="text-[10px] font-bold uppercase tracking-widest text-sky-300 me-2">You</span>
            {avatar.heardLine}
          </p>
        )}
        {(avatar.status === 'live' || (avatar.status === 'dropped' && avatar.thinking)) && (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            {avatar.thinking ? (
              <>
                <Loader2 size={12} className="animate-spin" /> The interviewer is thinking…
              </>
            ) : avatar.busy ? (
              'The interviewer is speaking…'
            ) : (
              <>
                <Mic size={12} className="text-emerald-400" /> Listening — answer out loud
              </>
            )}
          </p>
        )}
        {avatar.error && <p className="text-xs text-red-300">{avatar.error}</p>}
      </div>

      {(avatar.status === 'live' || avatar.status === 'dropped') && (
        <div className="shrink-0 border-t border-white/5 p-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            disabled={!canType}
            maxLength={4000}
            placeholder={canType ? 'Type instead' : 'Wait for the interviewer…'}
            className="flex-1 rounded-lg bg-[#2d2d2d] border border-white/10 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
          />
          <button
            onClick={submit}
            disabled={!canType || !draft.trim()}
            className="p-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white disabled:opacity-40"
            title="Send (Enter)"
          >
            <Send size={16} />
          </button>
        </div>
      )}
    </div>
  );
};
