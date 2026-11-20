import React from 'react';
import { Loader2, Save, Sparkles, ExternalLink, CheckCircle2 } from 'lucide-react';
import type { Question } from '../lib/questions';
import { useApi } from '../lib/api';

// `questions` state lives in InterviewRoom so it survives tab switches (this panel
// unmounts when another tab is active) and reflects the latest saved list.
const QuestionsPanel: React.FC<{
  interviewId: string;
  questions: Question[];
  setQuestions: React.Dispatch<React.SetStateAction<Question[]>>;
  // Set while an AI draft is paused on the backend awaiting approval; null when the
  // panel is just editing already-saved questions. Owned by InterviewRoom so a tab
  // switch (which unmounts this panel) can't silently drop the pending approval.
  jobId: string | null;
  setJobId: (jobId: string | null) => void;
  savedQuestions: Question[];
  onSaved: (saved: Question[]) => void;
}> = ({ interviewId, questions, setQuestions, jobId, setJobId, savedQuestions, onSaved }) => {
  const { apiFetch } = useApi();
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Without this, a successful save only flipped the button label and looked like nothing happened.
  const [savedCount, setSavedCount] = React.useState<number | null>(null);
  // While an AI draft is pending, the interviewer picks which proposals to keep (by index).
  // Kept proposals are added to the questions already saved for this interview.
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const isDraft = jobId !== null;
  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const allSelected = questions.length > 0 && selected.size === questions.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(questions.map((_, i) => i)));

  const generate = async () => {
    setLoading(true);
    setError(null);
    setSavedCount(null);
    try {
      const r = await apiFetch(`/api/interviews/${interviewId}/questions/generate`, { method: 'POST' });
      const body = await r.json();
      if (!r.ok) {
        setError(
          r.status === 429
            ? `Slow down — try again in ${body.retryAfter}s`
            : body?.message || 'Failed to generate questions',
        );
        return;
      }
      setJobId(body.jobId);
      setQuestions(body.draftQuestions);
      setSelected(new Set());
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (i: number, patch: Partial<Question>) => {
    setSavedCount(null);
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  };

  const deleteRow = (i: number) => {
    setSavedCount(null);
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));
    // Keep the selection on the same questions once the later ones shift up.
    setSelected((prev) => new Set([...prev].filter((k) => k !== i).map((k) => (k > i ? k - 1 : k))));
  };

  // A pending AI draft is approved/rejected through the paused graph; with no draft
  // pending, Save is a plain edit of the already-saved list.
  const resolve = async (approved: boolean) => {
    // Approving a draft saves the already-saved questions plus the picked proposals.
    const toSave = isDraft ? [...savedQuestions, ...questions.filter((_, i) => selected.has(i))] : questions;
    setSaving(true);
    setError(null);
    try {
      const r = jobId
        ? await apiFetch(`/api/interviews/${interviewId}/questions/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId, approved, questions: approved ? toSave : undefined }),
          })
        : await apiFetch(`/api/interviews/${interviewId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questions }),
          });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        if (r.status === 404 && jobId) {
          setJobId(null);
          setQuestions(savedQuestions);
          setError('This draft expired — generate a new one.');
        } else {
          setError(body?.message || 'Failed to save questions');
        }
        return;
      }
      setJobId(null);
      setSelected(new Set());
      if (approved) {
        setQuestions(toSave);
        onSaved(toSave);
        setSavedCount(toSave.length);
      } else {
        setQuestions(savedQuestions);
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-900/60 rounded-2xl border border-white/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-brand" />
          <h3 className="text-white font-semibold">Interview questions</h3>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          {questions.length ? 'Regenerate' : 'Generate questions'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-200 text-sm rounded-lg p-3 mb-3">
          {error}
        </div>
      )}

      {savedCount !== null && (
        <div
          role="status"
          className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm rounded-lg p-3 mb-3 flex items-center gap-2"
        >
          <CheckCircle2 size={16} />
          Saved {savedCount} question{savedCount === 1 ? '' : 's'} — they'll appear in the interview room's Code Editor.
        </div>
      )}

      {isDraft && questions.length > 0 && (
        <div className="flex items-center justify-between mb-3 text-sm">
          <p className="text-slate-300">Pick the questions to keep{savedQuestions.length ? ` (added to the ${savedQuestions.length} already saved)` : ''}.</p>
          <button onClick={toggleAll} className="text-brand hover:text-white text-xs font-semibold">
            {allSelected ? 'Clear selection' : 'Select all'}
          </button>
        </div>
      )}

      {questions.length === 0 && !loading && (
        <p className="text-slate-400 text-sm">No questions yet — click "Generate questions".</p>
      )}

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div
            key={i}
            className={`bg-slate-800/60 border rounded-xl p-3 flex flex-col gap-2 ${
              isDraft && selected.has(i) ? 'border-emerald-500/60' : 'border-white/5'
            }`}
          >
            {isDraft && (
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => toggle(i)}
                  className="accent-emerald-500 w-4 h-4"
                />
                Keep this question
              </label>
            )}
            {q.source && (
              <a
                href={q.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20"
              >
                <ExternalLink size={11} />
                LeetCode · {q.source.title} · {q.source.difficulty}
              </a>
            )}
            <textarea
              value={q.text}
              onChange={(e) => updateRow(i, { text: e.target.value })}
              rows={2}
              className="w-full bg-transparent text-slate-100 text-sm resize-none focus:outline-none"
            />
            <div className="flex items-center gap-2 text-xs">
              <select
                value={q.category}
                onChange={(e) => updateRow(i, { category: e.target.value as Question['category'] })}
                className="bg-slate-800 border border-white/10 rounded px-2 py-1 text-slate-200"
              >
                <option value="technical">technical</option>
                <option value="behavioral">behavioral</option>
                <option value="system-design">system-design</option>
              </select>
              <select
                value={q.difficulty}
                onChange={(e) => updateRow(i, { difficulty: e.target.value as Question['difficulty'] })}
                className="bg-slate-800 border border-white/10 rounded px-2 py-1 text-slate-200"
              >
                <option value="easy">easy</option>
                <option value="medium">medium</option>
                <option value="hard">hard</option>
              </select>
              <button onClick={() => deleteRow(i)} className="ml-auto text-slate-500 hover:text-red-400">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {questions.length > 0 && (
        <div className="mt-4 flex justify-end gap-2">
          {jobId && (
            <button
              onClick={() => resolve(false)}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-semibold disabled:opacity-50"
            >
              Discard draft
            </button>
          )}
          <button
            onClick={() => resolve(true)}
            disabled={saving || (isDraft && selected.size === 0)}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isDraft ? `Save ${selected.size} selected` : 'Save questions'}
          </button>
        </div>
      )}
    </div>
  );
};

export default QuestionsPanel;
