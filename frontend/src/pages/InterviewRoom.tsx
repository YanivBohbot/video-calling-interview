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
import { Video, Code, PenTool } from 'lucide-react';
import '@stream-io/video-react-sdk/dist/css/styles.css';

const apiKey = import.meta.env.VITE_STREAM_API_KEY;

import CollaborativeEditor from '../components/CollaborativeEditor';
import Whiteboard from '../components/Whiteboard';

export const InterviewRoom: React.FC = () => {
  const { id } = useParams();
  const { user } = useUser();
  const navigate = useNavigate();
  const [client, setClient] = React.useState<StreamVideoClient | null>(null);
  const [call, setCall] = React.useState<any>(null);
  const [activeTab, setActiveTab] = React.useState<'code' | 'design'>('code');

  React.useEffect(() => {
    if (!id) return;

    // Use actual user or generate a mock one for Demo mode
    const currentUser = user || {
      id: `demo-user-${Math.floor(Math.random() * 10000)}`,
      fullName: 'Guest Developer',
      username: 'guest',
      imageUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=guest'
    };

    const initStream = async () => {
      try {
        const response = await fetch(`http://localhost:3000/api/stream/token?userId=${currentUser.id}`);
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

  if (!client || !call) {
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
                  onClick={() => navigate('/')}
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
                    <CollaborativeEditor roomId={id || 'default'} />
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
                   
                   {/* Controls Section Internal */}
                   <div className="h-20 bg-slate-800/80 backdrop-blur-md border-t border-white/10 flex items-center justify-center">
                      <CallControls onLeave={() => navigate('/')} />
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
