import React from 'react';
import Markdown, { type Components } from 'react-markdown';

// Tailwind's preflight strips list bullets, margins and code styles: give them back here.
// react-markdown never renders raw HTML from the text, so the model's output stays inert.
const components: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5 space-y-0.5">{children}</ol>,
  h1: ({ children }) => <p className="my-1.5 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="my-1.5 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="my-1.5 font-semibold">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-violet-300 underline underline-offset-2 hover:text-white">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-black/40 p-2.5 text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children }) => <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
};

// An AI interviewer message, written in markdown (problem statements, examples, code).
export const AiMarkdown: React.FC<{ text: string }> = ({ text }) => <Markdown components={components}>{text}</Markdown>;
