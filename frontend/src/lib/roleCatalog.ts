// Same 6 domains × 3 seniorities as the practice feature's catalog; the composed
// title is what gets stored in Interview.role (still a plain string).
export const ROLE_DOMAINS = [
  { key: 'backend', label: 'Backend Engineer' },
  { key: 'frontend', label: 'Frontend Engineer' },
  { key: 'fullstack', label: 'Full-Stack Engineer' },
  { key: 'data-ml', label: 'Data/ML Engineer' },
  { key: 'product', label: 'Product Manager' },
  { key: 'devops', label: 'DevOps Engineer' },
] as const;

export const SENIORITIES = [
  { key: 'junior', label: 'Junior' },
  { key: 'mid', label: 'Mid-level' },
  { key: 'senior', label: 'Senior' },
] as const;

export const CUSTOM_ROLE = 'custom';

export const composeRole = (seniorityLabel: string, domainLabel: string) => `${seniorityLabel} ${domainLabel}`;
