import React, { useEffect, useState, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import { Code, Play, Copy, ExternalLink, ListChecks, Sparkles } from 'lucide-react';
import type { Question, AskedQuestion } from '../lib/questions';
import { API_URL } from '../lib/config';
import type { ApiFetch } from '../lib/api';

type SocketAuth = (cb: (data: Record<string, string>) => void) => void;

interface CodeEditorProps {
  roomId: string;
  initialCode?: string;
  initialLanguage?: string;
  // Set for the interviewer only: their approved questions, each askable. The candidate
  // never receives this list, and the server strips the LeetCode source from asks.
  askableQuestions?: Question[];
  // Sends a fresh credential on every (re)connection (see useApi().socketAuth).
  socketAuth: SocketAuth;
  // Runs code through the backend (POST /api/code/run) with this page's credential.
  apiFetch: ApiFetch;
  // Interviewer only: opens the AI question generator (InterviewRoom owns it).
  onManageQuestions?: () => void;
  // Sees the editor's content whenever it changes (local edit, remote update, language).
  onCodeChange?: (code: string, language: string) => void;
}

const LeetCodeBadge: React.FC<{ source: NonNullable<Question['source']> }> = ({ source }) => (
  <a
    href={source.url}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-amber-500/20"
  >
    <ExternalLink size={10} />
    LeetCode · {source.title}
  </a>
);

const CollaborativeEditor: React.FC<CodeEditorProps> = ({ roomId, initialCode, initialLanguage, askableQuestions, socketAuth, apiFetch, onManageQuestions, onCodeChange }) => {
  const [code, setCode] = useState<string>(
    initialCode ?? '// Welcome to the Interview Code Editor\n\nfunction solution() {\n  console.log("Hello, TalentIQ!");\n}\n\nsolution();',
  );
  const [language, setLanguage] = useState<string>(initialLanguage ?? 'javascript');
  const [output, setOutput] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [current, setCurrent] = useState<AskedQuestion | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'refused'>('connecting');
  const socketRef = useRef<Socket | null>(null);
  const isInterviewer = askableQuestions !== undefined;
  const currentSource = current ? askableQuestions?.[current.index]?.source : undefined;

  useEffect(() => {
    const socket = io(API_URL, { auth: socketAuth });
    socketRef.current = socket;
    // Join on every (re)connection: a reconnect is a fresh socket server-side.
    socket.on('connect', () => {
      setConnection('live');
      socket.emit('join-room', roomId);
    });
    socket.on('connect_error', () => setConnection('refused'));
    socket.on('error-message', () => setConnection('refused'));

    socketRef.current.on('code-update', (newCode: string) => setCode(newCode));
    socketRef.current.on('language-update', (newLang: string) => setLanguage(newLang));
    socketRef.current.on('execution-result', (result: string) => {
      setOutput(result);
      setIsConsoleOpen(true);
    });
    socketRef.current.on('question-update', (q: AskedQuestion) => setCurrent(q));

    return () => {
      socketRef.current?.disconnect();
    };
  }, [roomId, socketAuth]);

  useEffect(() => {
    onCodeChange?.(code, language);
  }, [code, language, onCodeChange]);

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setCode(value);
      socketRef.current?.emit('code-change', { roomId, code: value });
    }
  };

  // No local setCurrent: the server echoes the sanitized question to everyone,
  // the asker included, so all participants render the same thing.
  const ask = (index: number) => {
    const q = askableQuestions?.[index];
    if (!q) return;
    socketRef.current?.emit('question-change', {
      roomId,
      question: { index, text: q.text, category: q.category, difficulty: q.difficulty },
    });
  };

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    socketRef.current?.emit('language-change', { roomId, language: newLang });
  };

  const runCode = async () => {
    setIsExecuting(true);
    setIsConsoleOpen(true);
    setOutput('Running code...');

    try {
      const response = await apiFetch('/api/code/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, code }),
      });
      const data = await response.json().catch(() => ({}));
      let result: string;
      if (response.status === 429) result = `Too many runs — try again in ${data.retryAfter}s`;
      else if (response.status === 502) result = 'The code runner is unavailable right now.';
      else if (!response.ok) result = data?.message || 'Error executing code. Please try again.';
      else result = (data.timedOut ? 'Execution timed out.\n' : '') + (data.output || 'No output.');
      setOutput(result);

      // Sync execution result to others in the room
      socketRef.current?.emit('code-execution', { roomId, result });

    } catch (error) {
      setOutput('Error executing code. Please try again.');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] rounded-2xl overflow-hidden border border-white/10 shadow-2xl relative">
      {/* Editor Toolbar */}
      <div className="h-14 bg-[#252526] border-b border-white/5 flex items-center justify-between px-4 z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-slate-300">
            <Code size={18} className="text-brand" />
            <span className="text-sm font-medium">Collaborative Editor</span>
          </div>
          <select 
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="bg-[#333333] text-slate-300 text-xs px-3 py-1.5 rounded-md border border-white/10 focus:outline-none focus:ring-1 focus:ring-brand cursor-pointer"
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors" title="Copy Code">
            <Copy size={18} />
          </button>
          <div className="w-px h-6 bg-white/5 mx-1" />
          <button 
            onClick={runCode}
            disabled={isExecuting}
            className={`flex items-center gap-2 ${isExecuting ? 'bg-emerald-800' : 'bg-emerald-600 hover:bg-emerald-700'} text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition-all shadow-lg shadow-emerald-900/20 disabled:opacity-50`}
          >
            {isExecuting ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
            Run
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
      {isInterviewer && (
        <aside className="w-60 shrink-0 bg-[#252526] border-r border-white/5 flex flex-col min-h-0">
          <div className="h-9 flex items-center gap-2 px-3 border-b border-white/5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            <ListChecks size={13} className="text-brand" />
            Questions
            {onManageQuestions && askableQuestions!.length > 0 && (
              <button
                onClick={onManageQuestions}
                className="ml-auto flex items-center gap-1 normal-case tracking-normal font-semibold text-[11px] text-brand hover:text-white"
              >
                <Sparkles size={11} /> Edit / regenerate
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {askableQuestions!.length === 0 && (
              <div className="p-2 space-y-2">
                <p className="text-xs text-slate-500">No questions for this interview yet.</p>
                {onManageQuestions && (
                  <button
                    onClick={onManageQuestions}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-brand hover:bg-brand-hover px-3 py-2 text-xs font-semibold text-white"
                  >
                    <Sparkles size={13} /> Generate with AI
                  </button>
                )}
              </div>
            )}
            {askableQuestions!.map((q, i) => (
              <div
                key={i}
                className={`rounded-lg border p-2 text-xs ${current?.index === i ? 'border-brand/60 bg-brand/10' : 'border-white/5 bg-white/[0.03]'}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-slate-500">
                    {i + 1}. {q.category} · {q.difficulty}
                  </span>
                  <button
                    onClick={() => ask(i)}
                    className="rounded-md bg-brand hover:bg-brand-hover px-2 py-0.5 text-[11px] font-semibold text-white"
                  >
                    {current?.index === i ? 'Asked' : 'Ask'}
                  </button>
                </div>
                <p className="text-slate-300 line-clamp-2">{q.text}</p>
                {q.source && (
                  <div className="mt-1">
                    <LeetCodeBadge source={q.source} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* Editor & Console Split */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        {(current || isInterviewer) && (
          <div className="shrink-0 border-b border-white/5 bg-[#1b2433] px-4 py-3">
            {current ? (
              <>
                <div className="flex items-center gap-2 mb-1 text-[10px] font-bold uppercase tracking-widest text-sky-300">
                  Current question
                  <span className="font-medium normal-case tracking-normal text-slate-400">
                    {current.category} · {current.difficulty}
                  </span>
                  {currentSource && <LeetCodeBadge source={currentSource} />}
                </div>
                <p className="text-sm text-slate-100 whitespace-pre-wrap">{current.text}</p>
              </>
            ) : (
              <p className="text-xs text-slate-500">Click Ask on a question to show it to the candidate.</p>
            )}
          </div>
        )}
        <div className={`flex-1 transition-all duration-300 ${isConsoleOpen ? 'h-2/3' : 'h-full'}`}>
          <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            value={code}
            onChange={handleEditorChange}
            options={{
              fontSize: 14,
              minimap: { enabled: false },
              automaticLayout: true,
              scrollbar: { vertical: 'visible', horizontal: 'visible' },
              padding: { top: 20 },
              fontFamily: "'Fira Code', 'Courier New', monospace",
            }}
          />
        </div>

        {/* Output Console */}
        {isConsoleOpen && (
          <div className="h-1/3 bg-[#1e1e1e] border-t border-white/10 flex flex-col animate-in slide-in-from-bottom duration-300">
            <div className="h-8 bg-[#252526] flex items-center justify-between px-4 border-b border-white/5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Console Output</span>
              <button 
                onClick={() => setIsConsoleOpen(false)}
                className="text-slate-500 hover:text-white text-[10px] font-medium"
              >
                Close
              </button>
            </div>
            <pre className="flex-1 p-4 font-mono text-sm text-slate-300 overflow-auto whitespace-pre-wrap selection:bg-brand/30">
              {output || 'Output will appear here after running code...'}
            </pre>
          </div>
        )}
      </div>
      </div>

      {/* Editor Footer */}
      <div className="h-8 bg-[#007acc] flex items-center justify-between px-4 text-[11px] text-white z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${isExecuting ? 'bg-amber-400 animate-bounce' : 'bg-green-400'} animate-pulse`} />
            <span>{isExecuting ? 'Executing...' : connection === 'live' ? 'Connected & Live' : connection === 'refused' ? 'Not connected (access refused)' : 'Connecting…'}</span>
          </div>
          <button onClick={() => setIsConsoleOpen(!isConsoleOpen)} className="hover:underline">
            {isConsoleOpen ? 'Hide Console' : 'Show Console'}
          </button>
        </div>
        <div className="flex items-center gap-4">
          <span>UTF-8</span>
          <span className="font-semibold uppercase">{language}</span>
        </div>
      </div>
    </div>
  );
};

export default CollaborativeEditor;
