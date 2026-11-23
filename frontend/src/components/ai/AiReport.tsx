import React from 'react';
import { Check, X, Loader2, RefreshCw } from 'lucide-react';
import type { AiReport as Report, ReportStatus } from '../../lib/aiInterviewer';

const List: React.FC<{ title: string; items: string[] }> = ({ title, items }) =>
  items.length === 0 ? null : (
    <div>
      <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">{title}</h4>
      <ul className="list-disc pl-5 space-y-1 text-sm text-slate-200">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );

// The coach's report at the end of a session. Its tests are only ones that really ran.
export const AiReport: React.FC<{
  status: ReportStatus;
  report: Report | null;
  waitOver: boolean;
  onCheckAgain: () => void;
  onRetry: () => void;
}> = ({ status, report, waitOver, onCheckAgain, onRetry }) => {
  if (status === 'ready' && report) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-100">{report.summary}</p>
        <List title="Strengths" items={report.strengths} />
        <List title="To improve" items={report.improvements} />
        {report.testsRun.length > 0 && (
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Tests run on the final code</h4>
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-xs font-mono">
                <thead className="bg-white/5 text-slate-400">
                  <tr>
                    <th className="px-2 py-1 text-left">Input</th>
                    <th className="px-2 py-1 text-left">Expected</th>
                    <th className="px-2 py-1 text-left">Got</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {report.testsRun.map((test) => (
                    <tr key={test.runId} className="border-t border-white/5 align-top">
                      <td className="px-2 py-1 whitespace-pre-wrap">{test.input}</td>
                      <td className="px-2 py-1 whitespace-pre-wrap">{test.expected}</td>
                      <td className="px-2 py-1 whitespace-pre-wrap">{test.actual}</td>
                      <td className="px-2 py-1">
                        {test.passed ? <Check size={14} className="text-emerald-400" /> : <X size={14} className="text-red-400" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Complexity</h4>
          <p className="text-sm text-slate-200">
            Time <span className="font-mono">{report.complexity.time}</span> · Space{' '}
            <span className="font-mono">{report.complexity.space}</span>
          </p>
          <p className="text-sm text-slate-400">{report.complexity.comment}</p>
        </div>
        <List title="Next steps" items={report.nextSteps} />
      </div>
    );
  }

  if (status === 'pending' && !waitOver) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin" /> The coach is reviewing the session…
      </p>
    );
  }

  return (
    <div className="space-y-2 text-sm text-slate-400">
      <p>{status === 'failed' ? 'The report could not be written this time.' : 'The report is taking longer than expected.'}</p>
      <button onClick={status === 'failed' ? onRetry : onCheckAgain} className="flex items-center gap-1.5 text-violet-300 hover:text-white">
        <RefreshCw size={14} /> {status === 'failed' ? 'Try again' : 'Check again'}
      </button>
    </div>
  );
};
