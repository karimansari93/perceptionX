import React from 'react';
import {
  Activity, Award, Briefcase, ClipboardList, Coffee, Crown, FileText, Heart,
  Lightbulb, Lock, MessageCircle, MessageSquare, Shield, Target, TrendingUp,
  UserCheck, Users,
} from 'lucide-react';
import { ATTRIBUTES } from './attributes';

type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

/** Attribute id → icon. Shared so every surface labels an attribute the same way. */
export const ATTRIBUTE_ICONS: Record<string, IconComponent> = {
  // v2 — Employee Experience
  'mission-purpose-impact': Heart,
  'compensation': Award,
  'company-culture': Users,
  'leadership': Crown,
  'job-security': Lock,
  'career-opportunities': TrendingUp,
  'wellbeing-balance': Coffee,
  'inclusion': Shield,
  'innovation': Lightbulb,
  // v2 — Candidate Experience
  'application-communication': MessageSquare,
  'candidate-feedback': MessageCircle,
  'interview-experience': ClipboardList,
  'onboarding-experience': UserCheck,
  // v1 legacy (existing clients still on the old set)
  'mission-purpose': Target,
  'rewards-recognition': Award,
  'social-impact': Heart,
  'security-perks': Lock,
  'application-process': FileText,
  'candidate-communication': MessageSquare,
  'overall-candidate-experience': Briefcase,
};

export const DEFAULT_ATTRIBUTE_ICON: IconComponent = Activity;

// Themes are stored on prompts as the attribute's display NAME, so surfaces
// that only have the name (rather than the id) can still resolve an icon.
const ICON_BY_NAME: Record<string, IconComponent> = (() => {
  const map: Record<string, IconComponent> = {};
  for (const attr of ATTRIBUTES) {
    const icon = ATTRIBUTE_ICONS[attr.id];
    if (icon) map[attr.name.toLowerCase()] = icon;
  }
  // Legacy display names that no longer appear in ATTRIBUTES but are still
  // stored on older prompts.
  const legacyNames: Record<string, string> = {
    'mission & purpose': 'mission-purpose',
    'rewards & recognition': 'rewards-recognition',
    'social impact': 'social-impact',
    'security & perks': 'security-perks',
    'application process': 'application-process',
    'candidate communication': 'candidate-communication',
    'overall candidate experience': 'overall-candidate-experience',
    'work-life balance': 'wellbeing-balance',
    'wellbeing & balance': 'wellbeing-balance',
    'career growth': 'career-opportunities',
    'culture & values': 'company-culture',
  };
  for (const [name, id] of Object.entries(legacyNames)) {
    const icon = ATTRIBUTE_ICONS[id];
    if (icon && !map[name]) map[name] = icon;
  }
  return map;
})();

/** Icon for an attribute display name (prompt_theme), with a neutral fallback. */
export const getAttributeIconByName = (name: string | undefined | null): IconComponent =>
  (name && ICON_BY_NAME[name.trim().toLowerCase()]) || DEFAULT_ATTRIBUTE_ICON;
