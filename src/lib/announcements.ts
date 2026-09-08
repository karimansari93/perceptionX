// What's-new announcements. Bump ANNOUNCEMENT_VERSION to ship the next one:
// the modal re-opens once for every user who has not dismissed that version
// (announcement_seen keeps one row per user per version).
export const ANNOUNCEMENT_VERSION = 'ask-ai-and-integrations-2026-09';

// Accounts created after the announcement shipped are not "returning users":
// they meet Ask AI on their first login and never see the announcement.
export const ANNOUNCEMENT_RELEASED_AT = '2026-09-08T00:00:00Z';

export type AnnouncementStep = 'intro' | 'form' | 'done';

export interface AssistantMark {
  key: string;
  name: string;
  domain: string;
}

// The four assistants named in the intro card, in order.
export const INTRO_ASSISTANTS: AssistantMark[] = [
  { key: 'chatgpt', name: 'ChatGPT', domain: 'chatgpt.com' },
  { key: 'copilot', name: 'Microsoft Copilot', domain: 'copilot.microsoft.com' },
  { key: 'claude', name: 'Claude', domain: 'claude.ai' },
  { key: 'gemini', name: 'Gemini', domain: 'gemini.google.com' },
];

// The request form's chips: the four above plus Perplexity and Slack.
export const FORM_TOOLS: AssistantMark[] = [
  ...INTRO_ASSISTANTS,
  { key: 'perplexity', name: 'Perplexity', domain: 'perplexity.ai' },
  { key: 'slack', name: 'Slack', domain: 'slack.com' },
];
