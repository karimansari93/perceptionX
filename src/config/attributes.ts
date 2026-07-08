// Use a relative path here (not the Vite '@/...' alias) so this file
// can also be imported by Supabase edge functions, which run on Deno
// and don't resolve the alias.
import { Attribute } from '../types/attributes.ts';

// -----------------------------------------------------------------------------
// Methodology v2 (July 2026) — 13 attributes, candidate-voice prompts.
// See docs/methodology-v2-prompt-taxonomy.md for the full rationale.
// `category` is the two-level prompt category ('Employee Experience' |
// 'Candidate Experience'); `name` is the client-facing display name and is
// what we store as prompt_theme.
// -----------------------------------------------------------------------------

export const ATTRIBUTES: Attribute[] = [
  {
    id: 'mission-purpose-impact',
    name: 'Mission, Purpose & Impact',
    description: 'Company mission, sense of purpose, and social/ESG impact',
    keywords: ['mission', 'purpose', 'values', 'vision', 'meaningful', 'social impact', 'community', 'sustainability', 'change the world', 'make a difference'],
    promptTemplate: 'What should I know about {companyName}\'s mission, purpose, and social impact before applying?',
    category: 'Employee Experience'
  },
  {
    id: 'compensation',
    name: 'Compensation',
    description: 'Pay, benefits, and perks',
    keywords: ['salary', 'compensation', 'pay', 'benefits', 'bonus', 'perks', 'incentives', 'negotiate'],
    promptTemplate: 'How good is the pay at {companyName}, and how should I negotiate salary and benefits there?',
    category: 'Employee Experience'
  },
  {
    id: 'company-culture',
    name: 'Company Culture',
    description: 'Workplace culture, environment, and whether employees feel valued and recognized',
    keywords: ['culture', 'workplace', 'environment', 'atmosphere', 'values', 'team', 'collaboration', 'recognition', 'valued'],
    promptTemplate: 'What is the company culture really like at {companyName}?',
    category: 'Employee Experience'
  },
  {
    id: 'leadership',
    name: 'Leadership',
    description: 'Leadership quality and management style',
    keywords: ['leadership', 'management', 'executives', 'CEO', 'directors', 'managers', 'decision-making'],
    promptTemplate: 'What should I know about the leadership and management at {companyName} before joining?',
    category: 'Employee Experience'
  },
  {
    id: 'job-security',
    name: 'Job Security',
    description: 'Employment stability, tenure, and layoff risk',
    keywords: ['job security', 'stability', 'stable', 'layoffs', 'redundancy', 'tenure', 'secure'],
    promptTemplate: 'How stable and secure is a job at {companyName}?',
    category: 'Employee Experience'
  },
  {
    id: 'career-opportunities',
    name: 'Career Opportunities',
    description: 'Career growth, development, and progression opportunities',
    keywords: ['career', 'growth', 'development', 'advancement', 'promotion', 'learning', 'training', 'mentorship'],
    promptTemplate: 'What career growth and progression can I expect at {companyName}?',
    category: 'Employee Experience'
  },
  {
    id: 'wellbeing-balance',
    name: 'Wellbeing & Balance',
    description: 'Work-life balance, flexibility, remote work, and employee wellbeing',
    keywords: ['work-life balance', 'wellbeing', 'wellness', 'flexible', 'flexibility', 'remote', 'hybrid', 'mental health', 'stress'],
    promptTemplate: 'What are the work-life balance, flexibility, and remote work options really like at {companyName}?',
    category: 'Employee Experience'
  },
  {
    id: 'inclusion',
    name: 'Inclusion',
    description: 'Diversity, equity, and inclusion practices',
    keywords: ['diversity', 'inclusion', 'equity', 'DEI', 'minority', 'women', 'LGBTQ', 'accessible', 'belonging'],
    promptTemplate: 'How inclusive and diverse is the workplace at {companyName}?',
    category: 'Employee Experience'
  },
  {
    id: 'innovation',
    name: 'Innovation',
    description: 'Innovation culture and access to cutting-edge technology',
    keywords: ['innovation', 'innovative', 'technology', 'cutting-edge', 'research', 'development', 'breakthrough'],
    promptTemplate: 'How innovative is {companyName}, and what would I get to work on there?',
    category: 'Employee Experience'
  },
  {
    id: 'application-communication',
    name: 'Application & Communication',
    description: 'Application process and recruiter/candidate communication',
    keywords: ['application', 'apply', 'application process', 'hiring process', 'recruitment', 'communication', 'recruiter', 'updates', 'response'],
    promptTemplate: 'What should I expect from the application process and recruiter communication at {companyName}?',
    category: 'Candidate Experience'
  },
  {
    id: 'candidate-feedback',
    name: 'Candidate Feedback',
    description: 'Feedback provided to candidates after interviews or applications',
    keywords: ['feedback', 'candidate feedback', 'interview feedback', 'application feedback', 'response', 'notification'],
    promptTemplate: 'Will I get useful feedback after applying or interviewing at {companyName}?',
    category: 'Candidate Experience'
  },
  {
    id: 'interview-experience',
    name: 'Interview Experience',
    description: 'Candidate interview process and how to prepare',
    keywords: ['interview', 'interviewing', 'interview process', 'interview experience', 'interviewer', 'interview questions', 'prepare'],
    promptTemplate: 'How should I prepare for a job interview at {companyName}?',
    category: 'Candidate Experience'
  },
  {
    id: 'onboarding-experience',
    name: 'Onboarding',
    description: 'New hire onboarding experience and first months',
    keywords: ['onboarding', 'new hire', 'orientation', 'onboarding process', 'first day', 'new employee', 'training'],
    promptTemplate: 'What should I expect when I first start working at {companyName}?',
    category: 'Candidate Experience'
  }
];

// Map from retired/renamed v1 attribute ids to their v2 equivalent (null =
// retired with no successor). Kept for materialized-view filters, display
// continuity, and the deferred existing-client migration decision.
export const LEGACY_ATTRIBUTE_MAP: Record<string, string | null> = {
  'mission-purpose': 'mission-purpose-impact',
  'social-impact': 'mission-purpose-impact',
  'rewards-recognition': 'compensation',
  'security-perks': 'job-security',
  'application-process': 'application-communication',
  'candidate-communication': 'application-communication',
  'overall-candidate-experience': null, // retired
};

// Attribute prompt templates (52 prompts: 13 attributes x 4 types)
// Types: informational, experience, competitive, discovery.
// Voice: informational = candidate preparation/validation; experience =
// experiential/reputation; competitive = per-attribute comparison (competitor
// radar); discovery = per-attribute open-field visibility (GEO signal).
export const ATTRIBUTE_PROMPT_TEMPLATES = [
  // Mission, Purpose & Impact
  { attributeId: 'mission-purpose-impact', type: 'informational', prompt: 'What should I know about {companyName}\'s mission, purpose, and social impact before applying?' },
  { attributeId: 'mission-purpose-impact', type: 'experience', prompt: 'What do employees say about the sense of purpose and impact of working at {companyName}?' },
  { attributeId: 'mission-purpose-impact', type: 'competitive', prompt: 'How does {companyName}\'s mission and impact compare to other companies in {industry}?' },
  { attributeId: 'mission-purpose-impact', type: 'discovery', prompt: 'Which companies in {industry} are known for a strong sense of purpose and positive impact?' },

  // Compensation (tactical informational)
  { attributeId: 'compensation', type: 'informational', prompt: 'How good is the pay at {companyName}, and how should I negotiate salary and benefits there?' },
  { attributeId: 'compensation', type: 'experience', prompt: 'What do employees say about pay, benefits, and perks at {companyName}?' },
  { attributeId: 'compensation', type: 'competitive', prompt: 'Does {companyName} pay better than other companies in {industry}?' },
  { attributeId: 'compensation', type: 'discovery', prompt: 'Which companies in {industry} pay the best and offer the best benefits and perks?' },

  // Company Culture
  { attributeId: 'company-culture', type: 'informational', prompt: 'What is the company culture really like at {companyName}?' },
  { attributeId: 'company-culture', type: 'experience', prompt: 'How do employees describe the culture at {companyName} — and do they feel valued and recognized?' },
  { attributeId: 'company-culture', type: 'competitive', prompt: 'How does the culture at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'company-culture', type: 'discovery', prompt: 'Which companies in {industry} have the best workplace culture?' },

  // Leadership
  { attributeId: 'leadership', type: 'informational', prompt: 'What should I know about the leadership and management at {companyName} before joining?' },
  { attributeId: 'leadership', type: 'experience', prompt: 'What do employees say about managers and senior leadership at {companyName}?' },
  { attributeId: 'leadership', type: 'competitive', prompt: 'How does the quality of leadership at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'leadership', type: 'discovery', prompt: 'Which companies in {industry} are known for great leadership and management?' },

  // Job Security (neutral informational)
  { attributeId: 'job-security', type: 'informational', prompt: 'How stable and secure is a job at {companyName}?' },
  { attributeId: 'job-security', type: 'experience', prompt: 'How do employees feel about job security and stability at {companyName}?' },
  { attributeId: 'job-security', type: 'competitive', prompt: 'Is a job at {companyName} more secure than at other companies in {industry}?' },
  { attributeId: 'job-security', type: 'discovery', prompt: 'Which companies in {industry} offer the most stable and secure jobs?' },

  // Career Opportunities
  { attributeId: 'career-opportunities', type: 'informational', prompt: 'What career growth and progression can I expect at {companyName}?' },
  { attributeId: 'career-opportunities', type: 'experience', prompt: 'What do employees say about career development, learning, and promotions at {companyName}?' },
  { attributeId: 'career-opportunities', type: 'competitive', prompt: 'Will my career grow faster at {companyName} or at other companies in {industry}?' },
  { attributeId: 'career-opportunities', type: 'discovery', prompt: 'Which companies in {industry} are best for career growth and learning?' },

  // Wellbeing & Balance
  { attributeId: 'wellbeing-balance', type: 'informational', prompt: 'What are the work-life balance, flexibility, and remote work options really like at {companyName}?' },
  { attributeId: 'wellbeing-balance', type: 'experience', prompt: 'How do employees rate work-life balance, flexibility, and wellbeing support at {companyName}?' },
  { attributeId: 'wellbeing-balance', type: 'competitive', prompt: 'Is work-life balance at {companyName} better than at other companies in {industry}?' },
  { attributeId: 'wellbeing-balance', type: 'discovery', prompt: 'Which companies in {industry} are best for work-life balance and flexible or remote work?' },

  // Inclusion
  { attributeId: 'inclusion', type: 'informational', prompt: 'How inclusive and diverse is the workplace at {companyName}?' },
  { attributeId: 'inclusion', type: 'experience', prompt: 'What do employees from diverse backgrounds say about working at {companyName}?' },
  { attributeId: 'inclusion', type: 'competitive', prompt: 'How does {companyName} compare to other companies in {industry} on diversity and inclusion?' },
  { attributeId: 'inclusion', type: 'discovery', prompt: 'Which companies in {industry} are most recognized for diversity, equity, and inclusion?' },

  // Innovation
  { attributeId: 'innovation', type: 'informational', prompt: 'How innovative is {companyName}, and what would I get to work on there?' },
  { attributeId: 'innovation', type: 'experience', prompt: 'What do employees say about innovation and access to new technology at {companyName}?' },
  { attributeId: 'innovation', type: 'competitive', prompt: 'Is {companyName} a more innovative place to work than other companies in {industry}?' },
  { attributeId: 'innovation', type: 'discovery', prompt: 'Which companies in {industry} are the most innovative to work for?' },

  // Application & Communication
  { attributeId: 'application-communication', type: 'informational', prompt: 'What should I expect from the application process and recruiter communication at {companyName}?' },
  { attributeId: 'application-communication', type: 'experience', prompt: 'How do candidates describe applying to {companyName} — the process, updates, and communication?' },
  { attributeId: 'application-communication', type: 'competitive', prompt: 'Is applying to {companyName} a better experience than applying to other employers in {industry}?' },
  { attributeId: 'application-communication', type: 'discovery', prompt: 'Which companies in {industry} have the best application process and candidate communication?' },

  // Candidate Feedback
  { attributeId: 'candidate-feedback', type: 'informational', prompt: 'Will I get useful feedback after applying or interviewing at {companyName}?' },
  { attributeId: 'candidate-feedback', type: 'experience', prompt: 'What do candidates say about the feedback they get from {companyName} after interviews and applications?' },
  { attributeId: 'candidate-feedback', type: 'competitive', prompt: 'How does {companyName} compare to other employers in {industry} at giving candidates feedback?' },
  { attributeId: 'candidate-feedback', type: 'discovery', prompt: 'Which companies in {industry} are known for giving candidates valuable feedback?' },

  // Interview Experience (the 70% flagship)
  { attributeId: 'interview-experience', type: 'informational', prompt: 'How should I prepare for a job interview at {companyName}?' },
  { attributeId: 'interview-experience', type: 'experience', prompt: 'How do candidates describe the interview experience at {companyName}?' },
  { attributeId: 'interview-experience', type: 'competitive', prompt: 'How does the interview process at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'interview-experience', type: 'discovery', prompt: 'Which companies in {industry} have the best interview experience?' },

  // Onboarding
  { attributeId: 'onboarding-experience', type: 'informational', prompt: 'What should I expect when I first start working at {companyName}?' },
  { attributeId: 'onboarding-experience', type: 'experience', prompt: 'How do new hires describe their onboarding and first months at {companyName}?' },
  { attributeId: 'onboarding-experience', type: 'competitive', prompt: 'How does onboarding at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'onboarding-experience', type: 'discovery', prompt: 'Which companies in {industry} have the best onboarding for new hires?' }
];

export const getAttributeById = (id: string): Attribute | undefined => {
  return ATTRIBUTES.find(attr => attr.id === id);
};

/**
 * Resolve any attribute id (v2 or legacy v1) to its live v2 id.
 * Returns null for retired ids with no successor (overall-candidate-experience)
 * and for unknown ids. This is the single read-time mechanism that keeps
 * existing clients' v1-tagged themes rendering under the v2 taxonomy —
 * display continuity without touching stored data.
 */
export const normalizeAttributeId = (id: string | null | undefined): string | null => {
  if (!id) return null;
  if (ATTRIBUTES.some(attr => attr.id === id)) return id;
  if (id in LEGACY_ATTRIBUTE_MAP) return LEGACY_ATTRIBUTE_MAP[id];
  return null;
};

export const getAllAttributes = (): Attribute[] => {
  return ATTRIBUTES;
};

// Generate attribute prompts for a company
export const generateAttributePrompts = (companyName: string, industry: string) => {
  return ATTRIBUTE_PROMPT_TEMPLATES.map(template => ({
    ...template,
    prompt: template.prompt
      .replace(/{companyName}/g, companyName)
      .replace(/{industry}/g, industry),
    attribute: getAttributeById(template.attributeId)
  }));
};

// Get prompts by attribute
export const getPromptsByAttribute = (companyName: string, industry: string, attributeId?: string) => {
  const allPrompts = generateAttributePrompts(companyName, industry);
  if (!attributeId) return allPrompts;
  return allPrompts.filter(prompt => prompt.attributeId === attributeId);
};

// Get prompts by type (four intents: informational, experience, competitive, discovery)
export const getPromptsByType = (companyName: string, industry: string, type?: 'informational' | 'experience' | 'competitive' | 'discovery') => {
  const allPrompts = generateAttributePrompts(companyName, industry);
  if (!type) return allPrompts;
  return allPrompts.filter(prompt => prompt.type === type);
};
