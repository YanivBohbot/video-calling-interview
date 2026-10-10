export type QuestionSource = {
  type: 'leetcode';
  title: string;
  slug: string;
  difficulty: string;
  url: string;
};

export type Question = {
  text: string;
  category: 'technical' | 'behavioral' | 'system-design';
  difficulty: 'easy' | 'medium' | 'hard';
  source?: QuestionSource;
};

// What the server broadcasts when the interviewer asks a question — never the source.
export type AskedQuestion = {
  index: number;
  text: string;
  category: Question['category'];
  difficulty: Question['difficulty'];
};
