import React from 'react';
import {
  StreamVideo,
  StreamVideoClient,
  StreamCall,
  SpeakerLayout,
  CallControls,
  StreamTheme,
} from '@stream-io/video-react-sdk';
import { useUser } from '@clerk/clerk-react';
import { useParams, useNavigate } from 'react-router-dom';
import { Video, Code, PenTool, FileText, Loader2, Save } from 'lucide-react';
import '@stream-io/video-react-sdk/dist/css/styles.css';

const apiKey = import.meta.env.VITE_STREAM_API_KEY;

import CollaborativeEditor from '../components/CollaborativeEditor';
import Whiteboard from '../components/Whiteboard';

const ReportModal: React.FC<{
  interviewId: string;
  onDone: () => void;
}> = ({ interviewId, onDone }) => {
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`http://localhost:3001/api/interviews/${interviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, status: 'completed' }),
      });
    } catch (err) {
      console.error('Failed to save report:', err);
    } finally {
      setSaving(false);
      onDone();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
      <div className="bg-slate-800 rounded-2xl shadow-2xl border border-white/10 w-full max-w-lg">
        <div className="p-6 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 bg-brand/20 rounded-xl flex items-center justify-center">
            <FileText size={20} className="text-brand" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Interview Report</h2>
            <p className="text-slate-400 text-sm">Write your notes while they're still fresh</p>
          </div>
        </div>

        <div className="p-6">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Candidate strengths, areas for improvement, decision, questions asked..."
            rows={10}
            className="w-full bg-slate-900 border border-white/10 rounded-xl p-4 text-sm text-slate-200 placeholder:text-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/40 transition-all"
          />
          <p className="text-xs text-slate-500 mt-2 text-right">{notes.length} characters</p>
        </div>

        <div className="p-6 pt-0 flex gap-3">
          <button
            onClick={onDone}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 font-semibold text-sm transition-all"
          >
            Skip & leave
          </button>
          <button
            onClick={handleSave}
            disabled={saving || notes.trim().length === 0}
            className="flex-1 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            {saving ? 'Saving…' : 'Save & leave'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const InterviewRoom: React.FC = () => {
  const { id } = useParams();
  const { user } = useUser();
  const navigate = useNavigate();
  const [client, setClient] = React.useState<StreamVideoClient | null>(null);
  const [call, setCall] = React.useState<any>(null);
  const [activeTab, setActiveTab] = React.useState<'code' | 'design'>('code');
  const [showReport, setShowReport] = React.useState(false);
  const [interviewData, setInterviewData] = React.useState<{
    codeSnapshot?: string | null;
    codeLanguage?: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!id) return;

    const currentUser = user || {
      id: `demo-user-${Math.floor(Math.random() * 10000)}`,
      fullName: 'Guest Developer',
      username: 'guest',
      imageUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=guest'
    };

    const initStream = async () => {
      try {
        const response = await fetch(`http://localhost:3001/api/stream/token?userId=${currentUser.id}`);
        const { token } = await response.json();

        const videoClient = new StreamVideoClient({
          apiKey,
          user: {
            id: currentUser.id,
            name: currentUser.fullName || currentUser.username || currentUser.id,
            image: currentUser.imageUrl,
          },
          token,
        });

        const interviewCall = videoClient.call('default', id);
        await interviewCall.join({ create: true });

        setClient(videoClient);
        setCall(interviewCall);
      } catch (error) {
        console.error('Error joining interview room:', error);
      }
    };

    initStream();

    return () => {
      if (call) call.leave();
      if (client) client.disconnectUser();
    };
  }, [user, id]);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;

    fetch(`http://localhost:3001/api/interviews/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setInterviewData(data);
      })
      .catch((err) => console.error('Failed to fetch interview data:', err));

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleEndSession = async () => {
    if (call) { await call.leave(); setCall(null); }
    if (client) { await client.disconnectUser(); setClient(null); }
    setShowReport(true);
  };

  if (!client || !call) {
    if (showReport) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <ReportModal interviewId={id!} onDone={() => navigate('/interviews')} />
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="text-slate-400">Initializing secure interview room...</p>
        </div>
      </div>
    );
  }

  return (
    <StreamVideo client={client}>
      <StreamCall call={call}>
        <StreamTheme>
          <div className="h-screen bg-slate-950 text-white flex flex-col overflow-hidden">
            {showReport && (
              <ReportModal interviewId={id!} onDone={() => navigate('/interviews')} />
            )}

            {/* Header */}
            <div className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-md z-1">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-brand rounded flex items-center justify-center text-white shadow-lg">
                    <Video size={18} />
                  </div>
                  <span className="font-bold text-slate-200">TalentIQ Room</span>
                </div>
                <div className="h-6 w-px bg-white/10 mx-2" />
                <div className="flex items-center gap-4">
                  <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse">
                    Live
                  </span>
                  <h1 className="text-xs font-medium text-slate-400">ID: {id}</h1>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={handleEndSession}
                  className="px-4 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 rounded-lg transition-colors text-sm font-medium"
                >
                  End Session
                </button>
              </div>
            </div>

            {/* Main Workspace: Split Screen */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: Workspace */}
              <div className="w-2/3 h-full p-2 flex flex-col gap-2">
                {/* Tab Selector */}
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

                {/* Active Workspace */}
                <div className="flex-1 rounded-2xl overflow-hidden border border-white/5 shadow-inner">
                  {activeTab === 'code' ? (
                    <CollaborativeEditor
                      roomId={id || 'default'}
                      initialCode={interviewData?.codeSnapshot ?? undefined}
                      initialLanguage={interviewData?.codeLanguage ?? undefined}
                    />
                  ) : (
                    <Whiteboard />
                  )}
                </div>
              </div>

              {/* Right Column: Video & Controls */}
              <div className="w-1/3 h-full flex flex-col p-2 overflow-hidden relative">
                <div className="flex-1 bg-slate-900 rounded-2xl overflow-hidden border border-white/5 relative shadow-inner flex flex-col">
                  <div className="flex-1 min-h-0">
                    <SpeakerLayout />
                  </div>
                  <div className="h-20 bg-slate-800/80 backdrop-blur-md border-t border-white/10 flex items-center justify-center">
                    <CallControls onLeave={handleEndSession} />
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
