// Use a relative path here (not the Vite '@/...' alias) so this file
// can also be imported by Supabase edge functions, which run on Deno
// and don't resolve the alias.
import { Attribute } from '../types/attributes.ts';

export const ATTRIBUTES: Attribute[] = [
  {
    id: 'mission-purpose',
    name: 'Mission & Purpose',
    description: 'Company mission, values, and sense of purpose',
    keywords: ['mission', 'purpose', 'values', 'vision', 'meaningful', 'impact', 'change the world', 'make a difference'],
    promptTemplate: 'What is {companyName}\'s mission and purpose? How meaningful is their work?',
    category: 'Purpose'
  },
  {
    id: 'rewards-recognition',
    name: 'Rewards & Recognition',
    description: 'Compensation, benefits, and employee recognition',
    keywords: ['salary', 'compensation', 'benefits', 'bonus', 'recognition', 'rewards', 'incentives', 'perks'],
    promptTemplate: 'How does {companyName} handle rewards and recognition for employees?',
    category: 'Compensation'
  },
  {
    id: 'company-culture',
    name: 'Company Culture',
    description: 'Workplace culture, values, and environment',
    keywords: ['culture', 'workplace', 'environment', 'atmosphere', 'values', 'team', 'collaboration', 'fun'],
    promptTemplate: 'What is the company culture like at {companyName}?',
    category: 'Culture'
  },
  {
    id: 'social-impact',
    name: 'Social Impact',
    description: 'Social responsibility and community impact',
    keywords: ['social impact', 'community', 'charity', 'volunteering', 'sustainability', 'environmental', 'giving back'],
    promptTemplate: 'What social impact initiatives does {companyName} have?',
    category: 'Impact'
  },
  {
    id: 'inclusion',
    name: 'Inclusion',
    description: 'Diversity, equity, and inclusion practices',
    keywords: ['diversity', 'inclusion', 'equity', 'DEI', 'minority', 'women', 'LGBTQ', 'accessible'],
    promptTemplate: 'How does {companyName} promote diversity and inclusion?',
    category: 'Inclusion'
  },
  {
    id: 'innovation',
    name: 'Innovation',
    description: 'Innovation culture and cutting-edge technology',
    keywords: ['innovation', 'innovative', 'technology', 'cutting-edge', 'research', 'development', 'breakthrough'],
    promptTemplate: 'How innovative is {companyName} in their industry?',
    category: 'Innovation'
  },
  {
    id: 'wellbeing-balance',
    name: 'Wellbeing & Balance',
    description: 'Work-life balance and employee wellbeing',
    keywords: ['work-life balance', 'wellbeing', 'wellness', 'flexible', 'remote', 'mental health', 'stress'],
    promptTemplate: 'How does {companyName} support employee wellbeing and work-life balance?',
    category: 'Wellbeing'
  },
  {
    id: 'leadership',
    name: 'Leadership',
    description: 'Leadership quality and management style',
    keywords: ['leadership', 'management', 'executives', 'CEO', 'directors', 'managers', 'decision-making'],
    promptTemplate: 'What is the leadership like at {companyName}?',
    category: 'Leadership'
  },
  {
    id: 'security-perks',
    name: 'Security & Perks',
    description: 'Job security and additional perks',
    keywords: ['job security', 'stability', 'perks', 'amenities', 'office', 'food', 'gym', 'transportation'],
    promptTemplate: 'What job security and perks does {companyName} offer?',
    category: 'Security'
  },
  {
    id: 'career-opportunities',
    name: 'Career Opportunities',
    description: 'Career growth and development opportunities',
    keywords: ['career', 'growth', 'development', 'advancement', 'promotion', 'learning', 'training', 'mentorship'],
    promptTemplate: 'What career opportunities does {companyName} offer?',
    category: 'Career'
  },
  {
    id: 'application-process',
    name: 'Application Process',
    description: 'Candidate experience during the application process',
    keywords: ['application', 'apply', 'job application', 'application process', 'hiring process', 'recruitment', 'applying'],
    promptTemplate: 'How is the application process at {companyName}?',
    category: 'Candidate Experience'
  },
  {
    id: 'candidate-communication',
    name: 'Communication',
    description: 'Recruiter and candidate communication quality',
    keywords: ['communication', 'recruiter', 'updates', 'candidate communication', 'recruiter communication', 'feedback', 'response'],
    promptTemplate: 'How do candidates feel about receiving updates from {companyName}?',
    category: 'Candidate Experience'
  },
  {
    id: 'interview-experience',
    name: 'Interview',
    description: 'Candidate interview experience and process',
    keywords: ['interview', 'interviewing', 'interview process', 'interview experience', 'interviewer', 'interview questions'],
    promptTemplate: 'How do candidates describe their interview experience at {companyName}?',
    category: 'Candidate Experience'
  },
  {
    id: 'candidate-feedback',
    name: 'Feedback',
    description: 'Feedback provided to candidates after interviews or applications',
    keywords: ['feedback', 'candidate feedback', 'interview feedback', 'application feedback', 'response', 'notification'],
    promptTemplate: 'How do candidates rate the feedback from {companyName} after interviews or applications?',
    category: 'Candidate Experience'
  },
  {
    id: 'onboarding-experience',
    name: 'Onboarding',
    description: 'New hire onboarding experience',
    keywords: ['onboarding', 'new hire', 'orientation', 'onboarding process', 'first day', 'new employee', 'training'],
    promptTemplate: 'How do new hires feel about onboarding at {companyName}?',
    category: 'Candidate Experience'
  },
  {
    id: 'overall-candidate-experience',
    name: 'Overall Experience',
    description: 'Overall candidate journey and reputation',
    keywords: ['candidate experience', 'candidate journey', 'recruitment experience', 'hiring experience', 'overall experience', 'candidate reputation'],
    promptTemplate: 'How do candidates perceive the overall journey at {companyName}?',
    category: 'Candidate Experience'
  }
];

// Attribute prompt templates (64 prompts: 16 attributes x 4 types)
// Types: informational, experience, competitive, discovery
export const ATTRIBUTE_PROMPT_TEMPLATES = [
  // Mission & Purpose (4 prompts)
  { attributeId: 'mission-purpose', type: 'informational', prompt: 'What does {companyName} communicate about its mission and purpose?' },
  { attributeId: 'mission-purpose', type: 'experience', prompt: 'How well does {companyName} communicate its mission and purpose to employees, and how does this resonate with their personal values?' },
  { attributeId: 'mission-purpose', type: 'competitive', prompt: 'How do {companyName}\'s mission and purpose compare to other companies in {industry}?' },
  { attributeId: 'mission-purpose', type: 'discovery', prompt: 'What companies in {industry} are known for having a strong, purpose-driven employer brand?' },

  // Rewards & Recognition (4 prompts)
  { attributeId: 'rewards-recognition', type: 'informational', prompt: 'What are the compensation, benefits, and recognition details at {companyName}?' },
  { attributeId: 'rewards-recognition', type: 'experience', prompt: 'How satisfied are employees at {companyName} with the rewards and recognition programs, and what specific aspects drive positive or negative sentiment?' },
  { attributeId: 'rewards-recognition', type: 'competitive', prompt: 'How do rewards and recognition programs at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'rewards-recognition', type: 'discovery', prompt: 'What companies in {industry} are known for having exceptional rewards and recognition for employees?' },

  // Company Culture (4 prompts)
  { attributeId: 'company-culture', type: 'informational', prompt: 'What does {companyName} communicate about its culture and values?' },
  { attributeId: 'company-culture', type: 'experience', prompt: 'How do employees at {companyName} describe the actual company culture versus the promoted culture?' },
  { attributeId: 'company-culture', type: 'competitive', prompt: 'How does {companyName}\'s company culture compare to other companies in {industry}?' },
  { attributeId: 'company-culture', type: 'discovery', prompt: 'What companies in {industry} are known for outstanding workplace culture?' },

  // Social Impact (4 prompts)
  { attributeId: 'social-impact', type: 'informational', prompt: 'What social impact programs and commitments does {companyName} offer?' },
  { attributeId: 'social-impact', type: 'experience', prompt: 'How do employees at {companyName} perceive the company\'s commitment to social impact and community responsibility?' },
  { attributeId: 'social-impact', type: 'competitive', prompt: 'How does {companyName}\'s social impact compare to other companies in {industry}?' },
  { attributeId: 'social-impact', type: 'discovery', prompt: 'What companies in {industry} are recognized for meaningful social impact and community engagement?' },

  // Inclusion (4 prompts)
  { attributeId: 'inclusion', type: 'informational', prompt: 'What diversity, equity, and inclusion programs does {companyName} offer?' },
  { attributeId: 'inclusion', type: 'experience', prompt: 'How do employees from diverse backgrounds at {companyName} rate the inclusivity of the workplace culture and practices?' },
  { attributeId: 'inclusion', type: 'competitive', prompt: 'How do {companyName}\'s inclusion and diversity efforts compare to other companies in {industry}?' },
  { attributeId: 'inclusion', type: 'discovery', prompt: 'What companies in {industry} are most recognized for diversity, equity, and inclusion?' },

  // Innovation (4 prompts)
  { attributeId: 'innovation', type: 'informational', prompt: 'What does {companyName} offer in terms of innovation and technology?' },
  { attributeId: 'innovation', type: 'experience', prompt: 'How do employees at {companyName} perceive the company\'s commitment to innovation and opportunities for creative work?' },
  { attributeId: 'innovation', type: 'competitive', prompt: 'How does {companyName}\'s innovation culture compare to other companies in {industry}?' },
  { attributeId: 'innovation', type: 'discovery', prompt: 'What companies in {industry} are known for fostering innovation and creative thinking?' },

  // Wellbeing & Balance (4 prompts)
  { attributeId: 'wellbeing-balance', type: 'informational', prompt: 'What are the work-life balance, flexibility, and wellbeing offerings at {companyName}?' },
  { attributeId: 'wellbeing-balance', type: 'experience', prompt: 'How do employees at {companyName} rate work-life balance and the overall wellbeing support provided by the company?' },
  { attributeId: 'wellbeing-balance', type: 'competitive', prompt: 'How do {companyName}\'s wellbeing and work-life balance offerings compare to other companies in {industry}?' },
  { attributeId: 'wellbeing-balance', type: 'discovery', prompt: 'What companies in {industry} are recognized for exceptional employee wellbeing and work-life balance?' },

  // Leadership (4 prompts)
  { attributeId: 'leadership', type: 'informational', prompt: 'What does {companyName} communicate about its leadership and structure?' },
  { attributeId: 'leadership', type: 'experience', prompt: 'How do employees at {companyName} rate the quality and effectiveness of leadership within the organization?' },
  { attributeId: 'leadership', type: 'competitive', prompt: 'How does {companyName}\'s leadership quality compare to other companies in {industry}?' },
  { attributeId: 'leadership', type: 'discovery', prompt: 'What companies in {industry} are respected for outstanding leadership and management?' },

  // Security & Perks (4 prompts)
  { attributeId: 'security-perks', type: 'informational', prompt: 'What are the job security, benefits, and perks at {companyName}?' },
  { attributeId: 'security-perks', type: 'experience', prompt: 'How do employees at {companyName} perceive job security, benefits, and additional perks provided by the company?' },
  { attributeId: 'security-perks', type: 'competitive', prompt: 'How do {companyName}\'s security, benefits, and perks compare to other companies in {industry}?' },
  { attributeId: 'security-perks', type: 'discovery', prompt: 'What companies in {industry} are known for providing comprehensive benefits and job security?' },

  // Career Opportunities (4 prompts)
  { attributeId: 'career-opportunities', type: 'informational', prompt: 'What career development and growth opportunities does {companyName} offer?' },
  { attributeId: 'career-opportunities', type: 'experience', prompt: 'How do employees at {companyName} rate career development opportunities and long-term growth potential?' },
  { attributeId: 'career-opportunities', type: 'competitive', prompt: 'How do career progression opportunities at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'career-opportunities', type: 'discovery', prompt: 'What companies in {industry} are most recognized for exceptional career development and progression opportunities?' },

  // Application Process (4 prompts) - Candidate Experience
  { attributeId: 'application-process', type: 'informational', prompt: 'What is the application process at {companyName}?' },
  { attributeId: 'application-process', type: 'experience', prompt: 'How is the application process at {companyName}?' },
  { attributeId: 'application-process', type: 'competitive', prompt: 'How does the application process at {companyName} compare to other employers in {industry}?' },
  { attributeId: 'application-process', type: 'discovery', prompt: 'What companies in {industry} have the best application process?' },

  // Communication (4 prompts) - Candidate Experience
  { attributeId: 'candidate-communication', type: 'informational', prompt: 'What can candidates expect in terms of communication from {companyName}?' },
  { attributeId: 'candidate-communication', type: 'experience', prompt: 'How do candidates feel about receiving updates from {companyName}?' },
  { attributeId: 'candidate-communication', type: 'competitive', prompt: 'How does recruiter communication at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'candidate-communication', type: 'discovery', prompt: 'What companies in {industry} are recognized for strong candidate communication?' },

  // Interview (4 prompts) - Candidate Experience
  { attributeId: 'interview-experience', type: 'informational', prompt: 'What is the interview process at {companyName}?' },
  { attributeId: 'interview-experience', type: 'experience', prompt: 'How do candidates describe their interview experience at {companyName}?' },
  { attributeId: 'interview-experience', type: 'competitive', prompt: 'How does the interview process at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'interview-experience', type: 'discovery', prompt: 'What companies in {industry} have the best interview experience?' },

  // Feedback (4 prompts) - Candidate Experience
  { attributeId: 'candidate-feedback', type: 'informational', prompt: 'What feedback do candidates receive from {companyName}?' },
  { attributeId: 'candidate-feedback', type: 'experience', prompt: 'How do candidates rate the feedback from {companyName} after interviews or applications?' },
  { attributeId: 'candidate-feedback', type: 'competitive', prompt: 'How does candidate feedback at {companyName} compare to other employers in {industry}?' },
  { attributeId: 'candidate-feedback', type: 'discovery', prompt: 'What companies in {industry} are known for providing valuable candidate feedback?' },

  // Onboarding (4 prompts) - Candidate Experience
  { attributeId: 'onboarding-experience', type: 'informational', prompt: 'What does onboarding look like at {companyName}?' },
  { attributeId: 'onboarding-experience', type: 'experience', prompt: 'How do new hires feel about onboarding at {companyName}?' },
  { attributeId: 'onboarding-experience', type: 'competitive', prompt: 'How does onboarding at {companyName} compare to other organizations in {industry}?' },
  { attributeId: 'onboarding-experience', type: 'discovery', prompt: 'What companies in {industry} have the best onboarding experience?' },

  // Overall Experience (4 prompts) - Candidate Experience
  { attributeId: 'overall-candidate-experience', type: 'informational', prompt: 'What can candidates expect from the hiring experience at {companyName}?' },
  { attributeId: 'overall-candidate-experience', type: 'experience', prompt: 'How do candidates perceive the overall journey at {companyName}?' },
  { attributeId: 'overall-candidate-experience', type: 'competitive', prompt: 'Does {companyName} stand out for candidate experience in {industry}?' },
  { attributeId: 'overall-candidate-experience', type: 'discovery', prompt: 'What companies in {industry} have the best overall candidate reputation?' }
];

export const getAttributeById = (id: string): Attribute | undefined => {
  return ATTRIBUTES.find(attr => attr.id === id);
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
