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
import { Video, Code, PenTool, FileText, Loader2, Save, UserPlus, Check, Copy } from 'lucide-react';
import { useApi } from '../lib/api';
import '@stream-io/video-react-sdk/dist/css/styles.css';

const apiKey = import.meta.env.VITE_STREAM_API_KEY;

import CollaborativeEditor from '../components/CollaborativeEditor';
import Whiteboard from '../components/Whiteboard';
import type { Question } from '../lib/questions';


const ReportModal: React.FC<{
  interviewId: string;
  onDone: () => void;
}> = ({ interviewId, onDone }) => {
  const { apiFetch } = useApi();
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/interviews/${interviewId}`, {
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
  const { apiFetch, socketAuth } = useApi();
  const [client, setClient] = React.useState<StreamVideoClient | null>(null);
  const [call, setCall] = React.useState<any>(null);
  const [activeTab, setActiveTab] = React.useState<'code' | 'design'>('code');
  const [showReport, setShowReport] = React.useState(false);
  const [interviewData, setInterviewData] = React.useState<{
    codeSnapshot?: string | null;
    codeLanguage?: string | null;
    questions?: Question[] | null;
    interviewerId?: { clerkID?: string } | null;
  } | null>(null);

  // The backend only returns this interview to its owner, so once it has loaded the
  // viewer is the interviewer. (Candidates use the separate /room page.)
  const isInterviewer = interviewData !== null;

  // Candidate invite: created on demand; creating a new one disables the previous link.
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = React.useState(false);
  const createInvite = async () => {
    const res = await apiFetch(`/api/interviews/${id}/invite`, { method: 'POST' });
    if (!res.ok) return console.error('Invite failed:', res.status);
    const { url } = await res.json();
    setInviteLink(url);
    await navigator.clipboard.writeText(url).catch(() => {});
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  React.useEffect(() => {
    if (!id) return;

    const initStream = async () => {
      try {
        // The backend picks the Stream user id from our verified identity.
        const response = await apiFetch('/api/stream/token');
        if (!response.ok) throw new Error(`Stream token refused: ${response.status}`);
        const { token, userId } = await response.json();

        const videoClient = new StreamVideoClient({
          apiKey,
          user: {
            id: userId,
            name: user?.fullName || user?.username || 'Guest Developer',
            image: user?.imageUrl || 'https://api.dicebear.com/7.x/avataaars/svg?seed=guest',
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
  }, [user, id, apiFetch]);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;

    apiFetch(`/api/interviews/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Interview fetch failed: ${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setInterviewData(data);
      })
      .catch((err) => console.error('Failed to fetch interview data:', err));

    return () => {
      cancelled = true;
    };
  }, [id, apiFetch]);

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
                {isInterviewer && (
                  <div className="flex items-center gap-2">
                    {inviteLink && (
                      <span className="max-w-[18rem] truncate text-xs text-slate-400 font-mono" title={inviteLink}>
                        {inviteLink}
                      </span>
                    )}
                    <button
                      onClick={createInvite}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-brand/20 hover:bg-brand/30 text-violet-200 border border-brand/30 rounded-lg transition-colors text-sm font-medium"
                      title={inviteLink ? 'Create a new link (the previous one stops working)' : 'Create and copy the candidate link'}
                    >
                      {inviteCopied ? <Check size={14} /> : inviteLink ? <Copy size={14} /> : <UserPlus size={14} />}
                      {inviteCopied ? 'Copied!' : inviteLink ? 'Regenerate link' : 'Invite candidate'}
                    </button>
                  </div>
                )}
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
                      askableQuestions={isInterviewer ? interviewData?.questions ?? [] : undefined}
                      socketAuth={socketAuth}
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
