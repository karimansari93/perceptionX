// What the floating Ask PerceptionX bubble says, given where the user is.
// `section` is the dashboard tab, `area` the card they clicked in (its
// data-tour id) and `subject` the thing they clicked (data-ask-subject:
// a competitor, a source domain or a theme).

export interface AskAiNudge {
  /** The bubble's opening line, e.g. "Got a question about your competitors?" */
  prompt: string;
  /** Ready-made questions shown as chips; each one sends straight to /chat. */
  suggestions: string[];
  /** Input placeholder. */
  placeholder: string;
}

interface NudgeInput {
  section: string;
  area?: string | null;
  subject?: string | null;
  companyName?: string | null;
}

export function nudgeFor({ section, area, subject, companyName }: NudgeInput): AskAiNudge {
  const us = companyName?.trim() || 'us';
  const topic = area?.split('-')[0] || section;

  if (topic === 'competitors') {
    if (subject) {
      return {
        prompt: `Got a question about ${subject}?`,
        suggestions: [
          `Why does AI recommend ${subject} to candidates?`,
          `How does ${us} compare with ${subject}?`,
          `What would help ${us} win candidates from ${subject}?`,
        ],
        placeholder: `Ask anything about ${subject}…`,
      };
    }
    return {
      prompt: 'Got a question about your competitors?',
      suggestions: [
        `Which employers does AI recommend instead of ${us}?`,
        `Where do competitors beat ${us}, and why?`,
        'Which competitor is gaining ground fastest?',
      ],
      placeholder: 'Ask anything about your competitors…',
    };
  }

  if (topic === 'sources') {
    if (subject) {
      return {
        prompt: `Want to know more about ${subject}?`,
        suggestions: [
          `What does ${subject} say about ${us}?`,
          `Why do AI models lean on ${subject}?`,
          `How can ${us} show up better on ${subject}?`,
        ],
        placeholder: `Ask anything about ${subject}…`,
      };
    }
    return {
      prompt: 'Got a question about your sources?',
      suggestions: [
        `Which sources shape how AI describes ${us}?`,
        `Which sources should ${us} focus on first?`,
        'Which sources are rising or falling, and why?',
      ],
      placeholder: 'Ask anything about your sources…',
    };
  }

  if (topic === 'themes' || topic === 'thematic') {
    if (subject) {
      return {
        prompt: `Got a question about ${subject}?`,
        suggestions: [
          `What does AI say about ${us} on ${subject}?`,
          `What's driving the sentiment on ${subject}?`,
          `How could ${us} improve how AI talks about ${subject}?`,
        ],
        placeholder: `Ask anything about ${subject}…`,
      };
    }
    return {
      prompt: 'Got a question about your themes?',
      suggestions: [
        `What are ${us}'s biggest strengths according to AI?`,
        'Which themes are hurting our reputation most?',
        'Where should we focus to improve sentiment?',
      ],
      placeholder: 'Ask anything about your themes…',
    };
  }

  if (topic === 'prompts') {
    return {
      prompt: 'Got a question about the questions candidates ask?',
      suggestions: [
        `Which candidate questions does ${us} answer worst?`,
        `Where is ${us} missing from AI answers?`,
        'Which AI model describes us best?',
      ],
      placeholder: 'Ask anything about your prompts…',
    };
  }

  if (topic === 'eps' || topic === 'score' || topic === 'summary') {
    return {
      prompt: 'Want help reading your scores?',
      suggestions: [
        `What's driving ${us}'s score this period?`,
        'What changed since last period, and why?',
        'What should we do first to improve our score?',
      ],
      placeholder: 'Ask anything about your scores…',
    };
  }

  return {
    prompt: 'Got a question about your data?',
    suggestions: [
      `How do AI models describe ${us} to candidates?`,
      'What changed since last period?',
      'What should we do first?',
    ],
    placeholder: 'Ask anything about your data…',
  };
}
