import React from 'react';
import {
  StreamVideo,
  StreamVideoClient,
  StreamCall,
  SpeakerLayout,
  CallControls,
  StreamTheme,
  type Call,
} from '@stream-io/video-react-sdk';
import { useParams } from 'react-router-dom';
import { Video, Code, PenTool, Link2Off, LogOut, Bot, ListChecks, ChevronDown } from 'lucide-react';
import '@stream-io/video-react-sdk/dist/css/styles.css';
import CollaborativeEditor from '../components/CollaborativeEditor';
import Whiteboard from '../components/Whiteboard';
import { AiInterviewerPanel } from '../components/ai/AiInterviewerPanel';
import { AvatarInterviewer, AvatarStartCard } from '../components/ai/AvatarInterviewer';
import { QuestionBanner } from '../components/QuestionBanner';
import { AskedQuestionList } from '../components/AskedQuestionList';
import { tabForQuestion, hasUnseenQuestions } from '../lib/roomQuestions';
import type { AskedQuestion } from '../lib/questions';
import { useAvatarInterviewer } from '../lib/useAvatarInterviewer';
import { useApi } from '../lib/api';
import { readInvite, storeInvite } from '../lib/storage';

const apiKey = import.meta.env.VITE_STREAM_API_KEY;

type CandidateRoomData = {
  _id: string;
  candidateName: string;
  role: string;
  codeSnapshot?: string | null;
  codeLanguage?: string | null;
  company?: string;
  interviewLanguage?: 'en' | 'he';
  // The interviewer allowed the AI interviewer (avatar) to run the interview in their absence.
  aiInterviewerEnabled?: boolean;
  questionCount?: number;
};

// The secret arrives in the URL fragment (#invite=…), which browsers never send to a
// server. Keep it for this tab and remove it from the address bar right away.
const takeInviteFromUrl = (interviewId: string): string | null => {
  const match = window.location.hash.match(/(?:^#|&)invite=([A-Za-z0-9_-]+)/);
  if (match) {
    // Stored for refreshes; returned directly so a browser that blocks sessionStorage
    // still gets in on this load.
    storeInvite(interviewId, match[1]);
    window.history.replaceState(null, '', window.location.pathname);
    return match[1];
  }
  return readInvite(interviewId);
};

const FullScreenMessage: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
  <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-white">
    <div className="max-w-md text-center space-y-4">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-white/10 flex items-center justify-center">{icon}</div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-slate-400">{text}</p>
    </div>
  </div>
);

// The invited candidate's view of an interview: video, code editor, whiteboard and the AI
// interviewer (a text chat, or — when the interview allows it and the interviewer is absent —
// a talking avatar that runs the interview in place of the video call). No question list, no
// report: the backend never sends them to a candidate.
export const CandidateRoom: React.FC = () => {
  const { id = '' } = useParams();
  const [invite] = React.useState(() => takeInviteFromUrl(id));
  const { apiFetch, socketAuth } = useApi({ invite });

  const [room, setRoom] = React.useState<CandidateRoomData | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'invalid' | 'left'>(invite ? 'loading' : 'invalid');
  const [client, setClient] = React.useState<StreamVideoClient | null>(null);
  const [call, setCall] = React.useState<Call | null>(null);
  const [activeTab, setActiveTab] = React.useState<'code' | 'design'>('code');
  const [showAi, setShowAi] = React.useState(false);
  // Mounted on first open, then kept (hiding it must not cut an answer being written).
  const [aiOpened, setAiOpened] = React.useState(false);
  // The shared editor's latest content, read by the AI panel when the candidate writes.
  const codeRef = React.useRef({ code: '', language: 'javascript' });
  const onCodeChange = React.useCallback((code: string, language: string) => {
    codeRef.current = { code, language };
  }, []);
  const getCode = React.useCallback(() => codeRef.current, []);
  // The interviewer's questions: the one on screen (banner; the room opens the tab it
  // needs) and the ones asked so far (Questions menu, which blinks while some are unseen).
  const [current, setCurrent] = React.useState<AskedQuestion | null>(null);
  const [asked, setAsked] = React.useState<AskedQuestion[]>([]);
  const [seenCount, setSeenCount] = React.useState(0);
  const [questionMenu, setQuestionMenu] = React.useState(false);
  const onQuestionUpdate = React.useCallback((q: AskedQuestion) => {
    setCurrent(q);
    const tab = tabForQuestion(q.category);
    if (tab) setActiveTab(tab);
  }, []);
  const toggleQuestionMenu = () => {
    setQuestionMenu((open) => !open);
    setSeenCount(asked.length);
  };
  // Whether the interviewer is in the room: unknown (null) until the editor's socket joins.
  const [interviewerPresent, setInterviewerPresent] = React.useState<boolean | null>(null);
  // The avatar replaces the video call: the candidate leaves the call when it starts.
  const callRef = React.useRef<Call | null>(null);
  const [leftCall, setLeftCall] = React.useState(false);
  const leaveCall = React.useCallback(() => {
    setLeftCall(true);
    callRef.current?.leave().catch(() => {});
  }, []);
  const avatar = useAvatarInterviewer({
    apiFetch,
    interviewId: id,
    enabled: status === 'ready',
    getCode,
    onQuestion: onQuestionUpdate,
    onAvatarStart: leaveCall,
  });
  const avatarAllowed =
    !!room?.aiInterviewerEnabled && (room.questionCount ?? 0) > 0 && interviewerPresent === false && avatar.status === 'none';
  const avatarView =
    avatar.status === 'connecting' || avatar.status === 'live' || avatar.status === 'dropped' || (avatar.status === 'finished' && leftCall);
  // The interview's session is an avatar one: the text panel stays out of it.
  const avatarSession = avatar.status !== 'loading' && avatar.status !== 'none' && avatar.status !== 'text';
  // A text session already exists (the room was reloaded): show it without a click.
  React.useEffect(() => {
    if (avatar.status !== 'text') return;
    setAiOpened(true);
    setShowAi(true);
  }, [avatar.status]);
  const startAvatar = () => {
    setShowAi(false);
    void avatar.start();
  };

  React.useEffect(() => {
    if (!invite) return;
    let cancelled = false;
    let videoClient: StreamVideoClient | null = null;
    let joined: Call | null = null;

    const start = async () => {
      const roomRes = await apiFetch(`/api/interviews/${encodeURIComponent(id)}/room`);
      if (!roomRes.ok) {
        if (!cancelled) setStatus('invalid');
        return;
      }
      const data: CandidateRoomData = await roomRes.json();
      if (cancelled) return;
      setRoom(data);

      const tokenRes = await apiFetch('/api/stream/token');
      if (!tokenRes.ok) throw new Error(`Stream token refused: ${tokenRes.status}`);
      const { token, userId } = await tokenRes.json();
      videoClient = new StreamVideoClient({
        apiKey,
        user: { id: userId, name: data.candidateName || 'Candidate' },
        token,
      });
      joined = videoClient.call('default', id);
      await joined.join({ create: true });
      if (cancelled) return;
      setClient(videoClient);
      callRef.current = joined;
      setCall(joined);
      setStatus('ready');
    };

    start().catch((err) => {
      console.error('Error joining the interview room:', err);
      if (!cancelled) setStatus('invalid');
    });

    return () => {
      cancelled = true;
      joined?.leave().catch(() => {});
      videoClient?.disconnectUser().catch(() => {});
    };
  }, [id, invite, apiFetch]);

  const leave = async () => {
    avatar.stop();
    await call?.leave().catch(() => {});
    await client?.disconnectUser().catch(() => {});
    setCall(null);
    setClient(null);
    setStatus('left');
  };

  if (status === 'invalid') {
    return (
      <FullScreenMessage
        icon={<Link2Off size={26} />}
        title="This link is invalid or expired"
        text="Ask your interviewer to send you a new link to the interview room."
      />
    );
  }
  if (status === 'left') {
    return (
      <FullScreenMessage
        icon={<LogOut size={26} />}
        title="You left the interview"
        text="Thanks for your time. To rejoin, open the link from your invitation again."
      />
    );
  }
  if (!client || !call || !room) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="text-slate-400">Joining your interview room...</p>
        </div>
      </div>
    );
  }

  return (
    <StreamVideo client={client}>
      <StreamCall call={call}>
        <StreamTheme>
          <div className="h-screen bg-slate-950 text-white flex flex-col overflow-hidden">
            <div className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-brand rounded flex items-center justify-center text-white shadow-lg">
                  <Video size={18} />
                </div>
                <span className="font-bold text-slate-200">TalentIQ Interview</span>
                <span className="text-xs text-slate-400">{room.role}</span>
              </div>
              <button
                onClick={leave}
                className="px-4 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 rounded-lg transition-colors text-sm font-medium"
              >
                Leave
              </button>
            </div>

            <div className="flex-1 flex overflow-hidden">
              <div className="w-2/3 h-full p-2 flex flex-col gap-2">
                <div className="bg-slate-900 rounded-xl p-1 flex gap-1 w-fit border border-white/5">
                  <div className="relative">
                    <button
                      onClick={toggleQuestionMenu}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        questionMenu
                          ? 'bg-white/10 text-white'
                          : hasUnseenQuestions(asked.length, seenCount)
                            ? 'bg-brand/20 text-violet-100 ring-2 ring-brand animate-pulse'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      <ListChecks size={16} />
                      Questions ({asked.length})
                      <ChevronDown size={14} />
                    </button>
                    {questionMenu && (
                      <>
                        <button aria-label="Close questions" className="fixed inset-0 z-40 cursor-default" onClick={() => setQuestionMenu(false)} />
                        <div className="absolute left-0 top-full mt-2 z-50 w-[28rem] max-h-[min(32rem,70vh)] rounded-xl border border-white/10 bg-[#1e1e1e] shadow-2xl overflow-hidden">
                          <AskedQuestionList asked={asked} current={current} />
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setActiveTab('code')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'code' ? 'bg-brand text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <Code size={16} />
                    Code Editor
                  </button>
                  <button
                    onClick={() => setActiveTab('design')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'design' ? 'bg-brand text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <PenTool size={16} />
                    System Design
                  </button>
                  {!avatarSession && (
                    <button
                      onClick={() => {
                        // The interview allows the avatar and the interviewer is away: run it.
                        if (avatarAllowed) return startAvatar();
                        setShowAi((open) => !open);
                        setAiOpened(true);
                      }}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        showAi
                          ? 'bg-violet-500/20 text-violet-200'
                          : !aiOpened
                            ? 'bg-brand/20 text-violet-100 ring-2 ring-brand animate-pulse'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                      }`}
                      title={showAi ? 'Hide the AI interviewer' : 'Show the AI interviewer'}
                    >
                      <Bot size={16} />
                      AI interviewer
                    </button>
                  )}
                </div>
                <QuestionBanner current={current} />
                {/* The editor stays mounted on every tab: it holds the live connection. */}
                <div className="flex-1 min-h-0 rounded-2xl overflow-hidden border border-white/5 shadow-inner flex">
                  <div className="flex-1 min-w-0">
                    <div className={activeTab === 'code' ? 'h-full' : 'hidden'}>
                      <CollaborativeEditor
                        roomId={id}
                        initialCode={room.codeSnapshot ?? undefined}
                        initialLanguage={room.codeLanguage ?? undefined}
                        socketAuth={socketAuth}
                        apiFetch={apiFetch}
                        onCodeChange={onCodeChange}
                        onQuestionUpdate={onQuestionUpdate}
                        onQuestionsAsked={setAsked}
                        onInterviewerPresence={setInterviewerPresent}
                      />
                    </div>
                    {activeTab === 'design' && <Whiteboard />}
                  </div>
                  {aiOpened && !avatarSession && (
                    <div className={showAi ? 'w-[24rem] shrink-0 border-l border-white/5' : 'hidden'}>
                      <AiInterviewerPanel apiFetch={apiFetch} interviewId={id} role="candidate" getCode={getCode} />
                    </div>
                  )}
                </div>
              </div>

              <div className="w-1/3 h-full flex flex-col gap-2 p-2 overflow-hidden">
                {avatarView ? (
                  <AvatarInterviewer avatar={avatar} />
                ) : (
                  <>
                    {avatarAllowed && <AvatarStartCard onStart={startAvatar} error={avatar.error} />}
                    <div className="flex-1 bg-slate-900 rounded-2xl overflow-hidden border border-white/5 shadow-inner flex flex-col">
                      <div className="flex-1 min-h-0">
                        <SpeakerLayout />
                      </div>
                      <div className="h-20 bg-slate-800/80 backdrop-blur-md border-t border-white/10 flex items-center justify-center">
                        <CallControls onLeave={leave} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </StreamTheme>
      </StreamCall>
    </StreamVideo>
  );
};

export default CandidateRoom;
