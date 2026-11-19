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
import { Video, Code, PenTool, Link2Off, LogOut } from 'lucide-react';
import '@stream-io/video-react-sdk/dist/css/styles.css';
import CollaborativeEditor from '../components/CollaborativeEditor';
import Whiteboard from '../components/Whiteboard';
import { useApi } from '../lib/api';
import { readInvite, storeInvite } from '../lib/storage';

const apiKey = import.meta.env.VITE_STREAM_API_KEY;

type CandidateRoomData = {
  _id: string;
  candidateName: string;
  role: string;
  codeSnapshot?: string | null;
  codeLanguage?: string | null;
};

// The secret arrives in the URL fragment (#invite=…), which browsers never send to a
// server. Keep it for this tab and remove it from the address bar right away.
const takeInviteFromUrl = (interviewId: string): string | null => {
  const match = window.location.hash.match(/(?:^#|&)invite=([A-Za-z0-9_-]+)/);
  if (match) {
    storeInvite(interviewId, match[1]);
    window.history.replaceState(null, '', window.location.pathname);
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

// The invited candidate's view of an interview: video, code editor and whiteboard.
// No question list, no AI, no report — the backend never sends them to a candidate.
export const CandidateRoom: React.FC = () => {
  const { id = '' } = useParams();
  const [invite] = React.useState(() => takeInviteFromUrl(id));
  const { apiFetch, socketAuth } = useApi({ invite });

  const [room, setRoom] = React.useState<CandidateRoomData | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'invalid' | 'left'>(invite ? 'loading' : 'invalid');
  const [client, setClient] = React.useState<StreamVideoClient | null>(null);
  const [call, setCall] = React.useState<Call | null>(null);
  const [activeTab, setActiveTab] = React.useState<'code' | 'design'>('code');

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
                </div>
                <div className="flex-1 rounded-2xl overflow-hidden border border-white/5 shadow-inner">
                  {activeTab === 'code' ? (
                    <CollaborativeEditor
                      roomId={id}
                      initialCode={room.codeSnapshot ?? undefined}
                      initialLanguage={room.codeLanguage ?? undefined}
                      socketAuth={socketAuth}
                    />
                  ) : (
                    <Whiteboard />
                  )}
                </div>
              </div>

              <div className="w-1/3 h-full flex flex-col p-2 overflow-hidden">
                <div className="flex-1 bg-slate-900 rounded-2xl overflow-hidden border border-white/5 shadow-inner flex flex-col">
                  <div className="flex-1 min-h-0">
                    <SpeakerLayout />
                  </div>
                  <div className="h-20 bg-slate-800/80 backdrop-blur-md border-t border-white/10 flex items-center justify-center">
                    <CallControls onLeave={leave} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </StreamTheme>
      </StreamCall>
    </StreamVideo>
  );
};

export default CandidateRoom;
