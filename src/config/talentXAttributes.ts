import { TalentXAttribute } from '@/types/talentX';

export const TALENTX_ATTRIBUTES: TalentXAttribute[] = [
  {
    id: 'mission-purpose',
    name: 'Mission & Purpose',
    description: 'Company mission, values, and sense of purpose',
    keywords: ['mission', 'purpose', 'values', 'vision', 'meaningful', 'impact', 'change the world', 'make a difference'],
    promptTemplate: 'What is {companyName}\'s mission and purpose? How meaningful is their work?',
    category: 'Purpose',
    isProOnly: true
  },
  {
    id: 'rewards-recognition',
    name: 'Rewards & Recognition',
    description: 'Compensation, benefits, and employee recognition',
    keywords: ['salary', 'compensation', 'benefits', 'bonus', 'recognition', 'rewards', 'incentives', 'perks'],
    promptTemplate: 'How does {companyName} handle rewards and recognition for employees?',
    category: 'Compensation',
    isProOnly: true
  },
  {
    id: 'company-culture',
    name: 'Company Culture',
    description: 'Workplace culture, values, and environment',
    keywords: ['culture', 'workplace', 'environment', 'atmosphere', 'values', 'team', 'collaboration', 'fun'],
    promptTemplate: 'What is the company culture like at {companyName}?',
    category: 'Culture',
    isProOnly: true
  },
  {
    id: 'social-impact',
    name: 'Social Impact',
    description: 'Social responsibility and community impact',
    keywords: ['social impact', 'community', 'charity', 'volunteering', 'sustainability', 'environmental', 'giving back'],
    promptTemplate: 'What social impact initiatives does {companyName} have?',
    category: 'Impact',
    isProOnly: true
  },
  {
    id: 'inclusion',
    name: 'Inclusion',
    description: 'Diversity, equity, and inclusion practices',
    keywords: ['diversity', 'inclusion', 'equity', 'DEI', 'minority', 'women', 'LGBTQ', 'accessible'],
    promptTemplate: 'How does {companyName} promote diversity and inclusion?',
    category: 'Inclusion',
    isProOnly: true
  },
  {
    id: 'innovation',
    name: 'Innovation',
    description: 'Innovation culture and cutting-edge technology',
    keywords: ['innovation', 'innovative', 'technology', 'cutting-edge', 'research', 'development', 'breakthrough'],
    promptTemplate: 'How innovative is {companyName} in their industry?',
    category: 'Innovation',
    isProOnly: true
  },
  {
    id: 'wellbeing-balance',
    name: 'Wellbeing & Balance',
    description: 'Work-life balance and employee wellbeing',
    keywords: ['work-life balance', 'wellbeing', 'wellness', 'flexible', 'remote', 'mental health', 'stress'],
    promptTemplate: 'How does {companyName} support employee wellbeing and work-life balance?',
    category: 'Wellbeing',
    isProOnly: true
  },
  {
    id: 'leadership',
    name: 'Leadership',
    description: 'Leadership quality and management style',
    keywords: ['leadership', 'management', 'executives', 'CEO', 'directors', 'managers', 'decision-making'],
    promptTemplate: 'What is the leadership like at {companyName}?',
    category: 'Leadership',
    isProOnly: true
  },
  {
    id: 'security-perks',
    name: 'Security & Perks',
    description: 'Job security and additional perks',
    keywords: ['job security', 'stability', 'perks', 'amenities', 'office', 'food', 'gym', 'transportation'],
    promptTemplate: 'What job security and perks does {companyName} offer?',
    category: 'Security',
    isProOnly: true
  },
  {
    id: 'career-opportunities',
    name: 'Career Opportunities',
    description: 'Career growth and development opportunities',
    keywords: ['career', 'growth', 'development', 'advancement', 'promotion', 'learning', 'training', 'mentorship'],
    promptTemplate: 'What career opportunities does {companyName} offer?',
    category: 'Career',
    isProOnly: false // This is available in free plan
  },
  {
    id: 'application-process',
    name: 'Application Process',
    description: 'Candidate experience during the application process',
    keywords: ['application', 'apply', 'job application', 'application process', 'hiring process', 'recruitment', 'applying'],
    promptTemplate: 'How is the application process at {companyName}?',
    category: 'Candidate Experience',
    isProOnly: true
  },
  {
    id: 'candidate-communication',
    name: 'Communication',
    description: 'Recruiter and candidate communication quality',
    keywords: ['communication', 'recruiter', 'updates', 'candidate communication', 'recruiter communication', 'feedback', 'response'],
    promptTemplate: 'How do candidates feel about receiving updates from {companyName}?',
    category: 'Candidate Experience',
    isProOnly: true
  },
  {
    id: 'interview-experience',
    name: 'Interview',
    description: 'Candidate interview experience and process',
    keywords: ['interview', 'interviewing', 'interview process', 'interview experience', 'interviewer', 'interview questions'],
    promptTemplate: 'How do candidates describe their interview experience at {companyName}?',
    category: 'Candidate Experience',
    isProOnly: true
  },
  {
    id: 'candidate-feedback',
    name: 'Feedback',
    description: 'Feedback provided to candidates after interviews or applications',
    keywords: ['feedback', 'candidate feedback', 'interview feedback', 'application feedback', 'response', 'notification'],
    promptTemplate: 'How do candidates rate the feedback from {companyName} after interviews or applications?',
    category: 'Candidate Experience',
    isProOnly: true
  },
  {
    id: 'onboarding-experience',
    name: 'Onboarding',
    description: 'New hire onboarding experience',
    keywords: ['onboarding', 'new hire', 'orientation', 'onboarding process', 'first day', 'new employee', 'training'],
    promptTemplate: 'How do new hires feel about onboarding at {companyName}?',
    category: 'Candidate Experience',
    isProOnly: true
  },
  {
    id: 'overall-candidate-experience',
    name: 'Overall Experience',
    description: 'Overall candidate journey and reputation',
    keywords: ['candidate experience', 'candidate journey', 'recruitment experience', 'hiring experience', 'overall experience', 'candidate reputation'],
    promptTemplate: 'How do candidates perceive the overall journey at {companyName}?',
    category: 'Candidate Experience',
    isProOnly: true
  }
];

// TalentX Prompt Templates for Pro Users (48 prompts total: 30 original + 18 Candidate Experience)
export const TALENTX_PROMPT_TEMPLATES = [
  // Mission & Purpose (3 prompts)
  {
    attributeId: 'mission-purpose',
    type: 'sentiment',
    prompt: 'How well does {companyName} communicate its mission and purpose to employees, and how does this resonate with their personal values?'
  },
  {
    attributeId: 'mission-purpose',
    type: 'competitive',
    prompt: 'How do {companyName}\'s mission and purpose compare to other companies in {industry}?'
  },
  {
    attributeId: 'mission-purpose',
    type: 'visibility',
    prompt: 'What companies in {industry} are known for having a strong, purpose-driven employer brand?'
  },

  // Rewards & Recognition (3 prompts)
  {
    attributeId: 'rewards-recognition',
    type: 'sentiment',
    prompt: 'How satisfied are employees at {companyName} with the rewards and recognition programs, and what specific aspects drive positive or negative sentiment?'
  },
  {
    attributeId: 'rewards-recognition',
    type: 'competitive',
    prompt: 'How do rewards and recognition programs at {companyName} compare to other companies in {industry}?'
  },
  {
    attributeId: 'rewards-recognition',
    type: 'visibility',
    prompt: 'What companies in {industry} are known for having exceptional rewards and recognition for employees?'
  },

  // Company Culture (3 prompts)
  {
    attributeId: 'company-culture',
    type: 'sentiment',
    prompt: 'How do employees at {companyName} describe the actual company culture versus the promoted culture?'
  },
  {
    attributeId: 'company-culture',
    type: 'competitive',
    prompt: 'How does {companyName}\'s company culture compare to other companies in {industry}?'
  },
  {
    attributeId: 'company-culture',
    type: 'visibility',
    prompt: 'What companies in {industry} are known for outstanding workplace culture?'
  },

  // Social Impact (3 prompts)
  {
    attributeId: 'social-impact',
    type: 'sentiment',
    prompt: 'How do employees at {companyName} perceive the company\'s commitment to social impact and community responsibility?'
  },
  {
    attributeId: 'social-impact',
    type: 'competitive',
    prompt: 'How does {companyName}\'s social impact compare to other companies in {industry}?'
  },
  {
    attributeId: 'social-impact',
    type: 'visibility',
    prompt: 'What companies in {industry} are recognized for meaningful social impact and community engagement?'
  },

  // Inclusion (3 prompts)
  {
    attributeId: 'inclusion',
    type: 'sentiment',
    prompt: 'How do employees from diverse backgrounds at {companyName} rate the inclusivity of the workplace culture and practices?'
  },
  {
    attributeId: 'inclusion',
    type: 'competitive',
    prompt: 'How do {companyName}\'s inclusion and diversity efforts compare to other companies in {industry}?'
  },
  {
    attributeId: 'inclusion',
    type: 'visibility',
    prompt: 'What companies in {industry} are most recognized for diversity, equity, and inclusion?'
  },

  // Innovation (3 prompts)
  {
    attributeId: 'innovation',
    type: 'sentiment',
    prompt: 'How do employees at {companyName} perceive the company\'s commitment to innovation and opportunities for creative work?'
  },
  {
    attributeId: 'innovation',
    type: 'competitive',
    prompt: 'How does {companyName}\'s innovation culture compare to other companies in {industry}?'
  },
  {
    attributeId: 'innovation',
    type: 'visibility',
    prompt: 'What companies in {industry} are known for fostering innovation and creative thinking?'
  },

  // Wellbeing & Balance (3 prompts)
  {
    attributeId: 'wellbeing-balance',
    type: 'sentiment',
    prompt: 'How do employees at {companyName} rate work-life balance and the overall wellbeing support provided by the company?'
  },
  {
    attributeId: 'wellbeing-balance',
    type: 'competitive',
    prompt: 'How do {companyName}\'s wellbeing and work-life balance offerings compare to other companies in {industry}?'
  },
  {
    attributeId: 'wellbeing-balance',
    type: 'visibility',
    prompt: 'What companies in {industry} are recognized for exceptional employee wellbeing and work-life balance?'
  },

  // Leadership (3 prompts)
  {
    attributeId: 'leadership',
    type: 'sentiment',
    prompt: 'How do employees at {companyName} rate the quality and effectiveness of leadership within the organization?'
  },
  {
    attributeId: 'leadership',
    type: 'competitive',
    prompt: 'How does {companyName}\'s leadership quality compare to other companies in {industry}?'
  },
  {
    attributeId: 'leadership',
    type: 'visibility',
    prompt: 'What companies in {industry} are respected for outstanding leadership and management?'
  },

  // Security & Perks (3 prompts)
  {
    attributeId: 'security-perks',
    type: 'sentiment',
    prompt: 'How do employees at {companyName} perceive job security, benefits, and additional perks provided by the company?'
  },
  {
    attributeId: 'security-perks',
    type: 'competitive',
    prompt: 'How do {companyName}\'s security, benefits, and perks compare to other companies in {industry}?'
  },
  {
    attributeId: 'security-perks',
    type: 'visibility',
    prompt: 'What companies in {industry} are known for providing comprehensive benefits and job security?'
  },

  // Career Opportunities (3 prompts)
  {
    attributeId: 'career-opportunities',
    type: 'sentiment',
    prompt: 'How do employees at {companyName} rate career development opportunities and long-term growth potential?'
  },
  {
    attributeId: 'career-opportunities',
    type: 'competitive',
    prompt: 'How do career progression opportunities at {companyName} compare to other companies in {industry}?'
  },
  {
    attributeId: 'career-opportunities',
    type: 'visibility',
    prompt: 'What companies in {industry} are most recognized for exceptional career development and progression opportunities?'
  },

  // Application Process (3 prompts)
  {
    attributeId: 'application-process',
    type: 'sentiment',
    prompt: 'How is the application process at {companyName}?'
  },
  {
    attributeId: 'application-process',
    type: 'competitive',
    prompt: 'How does the application process at {companyName} compare to other employers in {industry}?'
  },
  {
    attributeId: 'application-process',
    type: 'visibility',
    prompt: 'What companies in {industry} have the best application process?'
  },

  // Communication (3 prompts)
  {
    attributeId: 'candidate-communication',
    type: 'sentiment',
    prompt: 'How do candidates feel about receiving updates from {companyName}?'
  },
  {
    attributeId: 'candidate-communication',
    type: 'competitive',
    prompt: 'How does recruiter communication at {companyName} compare to other companies in {industry}?'
  },
  {
    attributeId: 'candidate-communication',
    type: 'visibility',
    prompt: 'What companies in {industry} are recognized for strong candidate communication?'
  },

  // Interview (3 prompts)
  {
    attributeId: 'interview-experience',
    type: 'sentiment',
    prompt: 'How do candidates describe their interview experience at {companyName}?'
  },
  {
    attributeId: 'interview-experience',
    type: 'competitive',
    prompt: 'How does the interview process at {companyName} compare to other companies in {industry}?'
  },
  {
    attributeId: 'interview-experience',
    type: 'visibility',
    prompt: 'What companies in {industry} have the best interview experience?'
  },

  // Feedback (3 prompts)
  {
    attributeId: 'candidate-feedback',
    type: 'sentiment',
    prompt: 'How do candidates rate the feedback from {companyName} after interviews or applications?'
  },
  {
    attributeId: 'candidate-feedback',
    type: 'competitive',
    prompt: 'How does candidate feedback at {companyName} compare to other employers in {industry}?'
  },
  {
    attributeId: 'candidate-feedback',
    type: 'visibility',
    prompt: 'What companies in {industry} are known for providing valuable candidate feedback?'
  },

  // Onboarding (3 prompts)
  {
    attributeId: 'onboarding-experience',
    type: 'sentiment',
    prompt: 'How do new hires feel about onboarding at {companyName}?'
  },
  {
    attributeId: 'onboarding-experience',
    type: 'competitive',
    prompt: 'How does onboarding at {companyName} compare to other organizations in {industry}?'
  },
  {
    attributeId: 'onboarding-experience',
    type: 'visibility',
    prompt: 'What companies in {industry} have the best onboarding experience?'
  },

  // Overall Experience (3 prompts)
  {
    attributeId: 'overall-candidate-experience',
    type: 'sentiment',
    prompt: 'How do candidates perceive the overall journey at {companyName}?'
  },
  {
    attributeId: 'overall-candidate-experience',
    type: 'competitive',
    prompt: 'Does {companyName} stand out for candidate experience in {industry}?'
  },
  {
    attributeId: 'overall-candidate-experience',
    type: 'visibility',
    prompt: 'What companies in {industry} have the best overall candidate reputation?'
  }
];

export const getTalentXAttributeById = (id: string): TalentXAttribute | undefined => {
  return TALENTX_ATTRIBUTES.find(attr => attr.id === id);
};

export const getProOnlyAttributes = (): TalentXAttribute[] => {
  return TALENTX_ATTRIBUTES.filter(attr => attr.isProOnly);
};

export const getFreeAttributes = (): TalentXAttribute[] => {
  return TALENTX_ATTRIBUTES.filter(attr => !attr.isProOnly);
};

export const getAllAttributes = (): TalentXAttribute[] => {
  return TALENTX_ATTRIBUTES;
};

// Generate TalentX prompts for a company
export const generateTalentXPrompts = (companyName: string, industry: string) => {
  return TALENTX_PROMPT_TEMPLATES.map(template => ({
    ...template,
    prompt: template.prompt
      .replace(/{companyName}/g, companyName)
      .replace(/{industry}/g, industry),
    attribute: getTalentXAttributeById(template.attributeId)
  }));
};

// Get prompts by attribute
export const getPromptsByAttribute = (companyName: string, industry: string, attributeId?: string) => {
  const allPrompts = generateTalentXPrompts(companyName, industry);
  if (!attributeId) return allPrompts;
  return allPrompts.filter(prompt => prompt.attributeId === attributeId);
};

// Get prompts by type
export const getPromptsByType = (companyName: string, industry: string, type?: 'sentiment' | 'competitive' | 'visibility') => {
  const allPrompts = generateTalentXPrompts(companyName, industry);
  if (!type) return allPrompts;
  return allPrompts.filter(prompt => prompt.type === type);
};

// Placeholder data generation for demonstration
export const generatePlaceholderTalentXData = (companyName: string = 'TechCorp') => {
  const sampleData = [
    {
      attributeId: 'company-culture',
      attributeName: 'Company Culture',
      perceptionScore: 87,
      avgPerceptionScore: 87,
      avgSentimentScore: 0.7,
      totalResponses: 23,
      sentimentAnalyses: [],
      competitiveAnalyses: [{ competitive_score: 85, perception_score: 85 }],
      visibilityAnalyses: [{ visibility_score: 78, perception_score: 78 }],
      totalMentions: 23,
      context: [
        `${companyName} has an excellent company culture that promotes collaboration and innovation. Employees frequently mention the positive work environment and supportive team atmosphere.`,
        `The workplace culture at ${companyName} is known for being inclusive and fostering creativity. Many employees appreciate the flexible work arrangements and emphasis on work-life balance.`
      ]
    },
    {
      attributeId: 'career-opportunities',
      attributeName: 'Career Opportunities',
      perceptionScore: 82,
      avgPerceptionScore: 82,
      avgSentimentScore: 0.6,
      totalResponses: 19,
      sentimentAnalyses: [],
      competitiveAnalyses: [],
      visibilityAnalyses: [],
      totalMentions: 19,
      context: [
        `${companyName} offers excellent career growth opportunities with clear advancement paths and comprehensive training programs.`,
        `Employees at ${companyName} have access to mentorship programs and continuous learning opportunities that help them advance in their careers.`
      ]
    },
    {
      attributeId: 'innovation',
      attributeName: 'Innovation',
      perceptionScore: 89,
      avgPerceptionScore: 89,
      avgSentimentScore: 0.8,
      totalResponses: 15,
      sentimentAnalyses: [],
      competitiveAnalyses: [],
      visibilityAnalyses: [],
      totalMentions: 15,
      context: [
        `${companyName} is recognized as a leader in innovation, constantly pushing boundaries with cutting-edge technology and creative solutions.`,
        `The company's innovative approach to problem-solving and commitment to research and development makes it an exciting place to work.`
      ]
    },
    {
      attributeId: 'rewards-recognition',
      attributeName: 'Rewards & Recognition',
      perceptionScore: 71,
      avgPerceptionScore: 71,
      avgSentimentScore: 0.4,
      totalResponses: 12,
      sentimentAnalyses: [],
      competitiveAnalyses: [],
      visibilityAnalyses: [],
      totalMentions: 12,
      context: [
        `${companyName} provides competitive compensation packages with good benefits, though some employees mention room for improvement in recognition programs.`,
        `The company offers solid salary packages and benefits, including health insurance and retirement plans.`
      ]
    },
    {
      attributeId: 'wellbeing-balance',
      attributeName: 'Wellbeing & Balance',
      perceptionScore: 73,
      avgPerceptionScore: 73,
      avgSentimentScore: 0.5,
      totalResponses: 11,
      sentimentAnalyses: [],
      competitiveAnalyses: [],
      visibilityAnalyses: [],
      totalMentions: 11,
      context: [
        `${companyName} supports employee wellbeing through flexible work arrangements and wellness programs.`,
        `The company promotes work-life balance with remote work options and mental health support initiatives.`
      ]
    },
    {
      attributeId: 'mission-purpose',
      attributeName: 'Mission & Purpose',
      perceptionScore: 64,
      avgPerceptionScore: 64,
      avgSentimentScore: 0.3,
      totalResponses: 8,
      sentimentAnalyses: [],
      competitiveAnalyses: [],
      visibilityAnalyses: [],
      totalMentions: 8,
      context: [
        `${companyName}'s mission focuses on making a positive impact through technology, though some employees would like clearer communication about company values.`,
        `The company's purpose-driven approach resonates with many employees who want to work on meaningful projects.`
      ]
    },
    {
      attributeId: 'leadership',
      attributeName: 'Leadership',
      perceptionScore: 58,
      avgPerceptionScore: 58,
      avgSentimentScore: 0.2,
      totalResponses: 7,
      sentimentAnalyses: [],
      competitiveAnalyses: [],
      visibilityAnalyses: [],
      totalMentions: 7,
      context: [
        `Leadership at ${companyName} is generally supportive, though some employees mention areas for improvement in communication and decision-making transparency.`,
        `The management team is approachable and open to feedback from employees.`
      ]
    },
    {
      attributeId: 'inclusion',
      attributeName: 'Inclusion',
      perceptionScore: 51,
      avgPerceptionScore: 51,
      avgSentimentScore: 0.1,
      totalResponses: 6,
      sentimentAnalyses: [],
      competitiveAnalyses: [],
      visibilityAnalyses: [],
      totalMentions: 6,
      context: [
        `${companyName} has made efforts to promote diversity and inclusion, though there's still work to be done in creating a more representative workforce.`,
        `The company has implemented DEI initiatives and training programs to foster an inclusive environment.`
      ]
    },
    {
      attributeId: 'social-impact',
      attributeName: 'Social Impact',
      perceptionScore: 42,
      avgPerceptionScore: 42,
      avgSentimentScore: -0.1,
      totalResponses: 4,
      sentimentAnalyses: [],
      competitiveAnalyses: [],
      visibilityAnalyses: [],
      totalMentions: 4,
      context: [
        `${companyName} participates in some community initiatives, but employees would like to see more robust social impact programs.`,
        `The company has opportunities to expand its social responsibility efforts and community engagement.`
      ]
    },
    {
      attributeId: 'security-perks',
      attributeName: 'Security & Perks',
      perceptionScore: 48,
      avgPerceptionScore: 48,
      avgSentimentScore: 0.0,
      totalResponses: 5,
      sentimentAnalyses: [],
      competitiveAnalyses: [],
      visibilityAnalyses: [],
      totalMentions: 5,
      context: [
        `${companyName} offers standard job security and workplace perks, though some employees mention wanting more unique benefits.`,
        `The company provides basic amenities and job stability, with room for enhancement in the perks department.`
      ]
    }
  ];

  return sampleData.sort((a, b) => (b.perceptionScore || 0) - (a.perceptionScore || 0));
}; 