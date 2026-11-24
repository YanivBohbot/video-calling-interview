import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { Question } from '../lib/questions';

// The LeetCode problem a generated question is based on (interviewer only).
export const LeetCodeBadge: React.FC<{ source: NonNullable<Question['source']> }> = ({ source }) => (
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
