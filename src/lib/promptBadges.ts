// Shared badge styling for prompt Type and Theme pills so every value gets a
// distinct icon + color (clients flagged that only "Comparison" stood out).
// Icons intentionally match ATTRIBUTE_ICONS in ThematicAnalysisTab so a theme
// looks the same everywhere it appears.
import {
  Award,
  BookOpen,
  Briefcase,
  ClipboardList,
  Coffee,
  Compass,
  Crown,
  Heart,
  Lightbulb,
  Lock,
  MessageCircle,
  MessageSquare,
  Scale,
  Shield,
  Tag,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface BadgeStyle {
  icon: LucideIcon;
  className: string;
}

// ---------------------------------------------------------------------------
// Prompt types — keyed by the raw `prompt.type` value (v2: informational /
// experience / competitive / discovery; v1 legacy: sentiment / visibility).
// ---------------------------------------------------------------------------
const TYPE_BADGES: Record<string, BadgeStyle> = {
  informational: { icon: BookOpen, className: "bg-sky-100 text-sky-800 border-sky-200" },
  experience: { icon: Users, className: "bg-amber-100 text-amber-800 border-amber-200" },
  competitive: { icon: Scale, className: "bg-purple-100 text-purple-800 border-purple-200" },
  discovery: { icon: Compass, className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  // v1 legacy types (existing clients)
  sentiment: { icon: Heart, className: "bg-blue-100 text-blue-800 border-blue-200" },
  visibility: { icon: Compass, className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
};

const DEFAULT_TYPE_BADGE: BadgeStyle = {
  icon: Tag,
  className: "bg-gray-100 text-gray-800 border-gray-200",
};

export const getTypeBadgeStyle = (rawType: string): BadgeStyle => {
  return TYPE_BADGES[rawType?.toLowerCase()] ?? DEFAULT_TYPE_BADGE;
};

// ---------------------------------------------------------------------------
// Themes — one distinct hue + icon per attribute. Legacy v1 theme names map to
// their v2 successor's style so e.g. "Security & perks" and "Job Security"
// read as the same topic across old and new clients.
// ---------------------------------------------------------------------------
interface ThemeBadgeDef extends BadgeStyle {
  // Normalized aliases (see normalizeThemeKey) that resolve to this style:
  // the v2 display name plus any v1 legacy theme names.
  aliases: string[];
}

const THEME_BADGES: ThemeBadgeDef[] = [
  {
    aliases: ["mission purpose impact", "mission purpose", "social impact"],
    icon: Heart,
    className: "bg-rose-100 text-rose-800 border-rose-200",
  },
  {
    aliases: ["compensation", "rewards recognition"],
    icon: Award,
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
  {
    aliases: ["company culture"],
    icon: Users,
    className: "bg-violet-100 text-violet-800 border-violet-200",
  },
  {
    aliases: ["leadership"],
    icon: Crown,
    className: "bg-indigo-100 text-indigo-800 border-indigo-200",
  },
  {
    aliases: ["job security", "security perks"],
    icon: Lock,
    className: "bg-teal-100 text-teal-800 border-teal-200",
  },
  {
    aliases: ["career opportunities"],
    icon: TrendingUp,
    className: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  {
    aliases: ["wellbeing balance"],
    icon: Coffee,
    className: "bg-cyan-100 text-cyan-800 border-cyan-200",
  },
  {
    aliases: ["inclusion"],
    icon: Shield,
    className: "bg-pink-100 text-pink-800 border-pink-200",
  },
  {
    aliases: ["innovation"],
    icon: Lightbulb,
    className: "bg-orange-100 text-orange-800 border-orange-200",
  },
  {
    aliases: ["application communication", "application process", "candidate communication"],
    icon: MessageSquare,
    className: "bg-blue-100 text-blue-800 border-blue-200",
  },
  {
    aliases: ["candidate feedback"],
    icon: MessageCircle,
    className: "bg-lime-100 text-lime-800 border-lime-200",
  },
  {
    aliases: ["interview experience"],
    icon: ClipboardList,
    className: "bg-purple-100 text-purple-800 border-purple-200",
  },
  {
    aliases: ["onboarding", "onboarding experience"],
    icon: UserCheck,
    className: "bg-sky-100 text-sky-800 border-sky-200",
  },
  {
    aliases: ["overall candidate experience"],
    icon: Briefcase,
    className: "bg-stone-100 text-stone-800 border-stone-200",
  },
];

const DEFAULT_THEME_BADGE: BadgeStyle = {
  icon: Tag,
  className: "bg-gray-100 text-gray-700 border-gray-200",
};

// "Mission, Purpose & Impact", "mission-purpose-impact" and "Mission & purpose"
// all normalize to comparable keys: lowercase, drop punctuation/'&', collapse
// separators to single spaces.
const normalizeThemeKey = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[&,/]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const THEME_BADGE_LOOKUP: Map<string, BadgeStyle> = new Map(
  THEME_BADGES.flatMap(({ aliases, icon, className }) =>
    aliases.map(alias => [alias, { icon, className }] as [string, BadgeStyle])
  )
);

export const getThemeBadgeStyle = (themeLabel: string): BadgeStyle => {
  const key = normalizeThemeKey(themeLabel || "");
  if (!key || key === "general") return DEFAULT_THEME_BADGE;
  const exact = THEME_BADGE_LOOKUP.get(key);
  if (exact) return exact;
  // Unknown theme: pick a stable palette entry from the label's hash so it
  // still gets a consistent (and usually unique) color instead of gray.
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const fallback = THEME_BADGES[Math.abs(hash) % THEME_BADGES.length];
  return { icon: Tag, className: fallback.className };
};
