import { useMemo, useState, useEffect } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { BarChart3, Globe, Users, Lightbulb, MessageSquare, Download } from "lucide-react";
import { PromptData, CitationCount } from "@/types/dashboard";
import { ATTRIBUTES } from "@/config/attributes";
import { useSeedTabSearch } from "@/contexts/TabSearchSeedContext";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Navigate to a dashboard section (route-based, owned by the Dashboard). */
  onNavigate: (section: string) => void;
  promptsData?: PromptData[];
  topCompetitors?: { company: string; count: number }[];
  topCitations?: CitationCount[];
}

const SECTIONS: { section: string; label: string; icon: typeof BarChart3 }[] = [
  { section: "overview", label: "Overview", icon: BarChart3 },
  { section: "prompts", label: "Prompts", icon: MessageSquare },
  { section: "sources", label: "Sources", icon: Globe },
  { section: "competitors", label: "Competitors", icon: Users },
  { section: "thematic", label: "Themes", icon: Lightbulb },
  { section: "reports", label: "Reports", icon: Download },
];

// Cap per group so typing stays snappy even on orgs with thousands of prompts.
const RESULT_CAP = 6;

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  promptsData = [],
  topCompetitors = [],
  topCitations = [],
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const seedTabSearch = useSeedTabSearch();
  const q = query.trim().toLowerCase();

  // Clear the query each time the palette opens for a fresh search.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const sections = useMemo(
    () => (q ? SECTIONS.filter(s => s.label.toLowerCase().includes(q)) : SECTIONS),
    [q]
  );

  const promptMatches = useMemo(() => {
    if (!q) return [];
    const out: string[] = [];
    for (const p of promptsData) {
      if (p.prompt && p.prompt.toLowerCase().includes(q)) {
        out.push(p.prompt);
        if (out.length >= RESULT_CAP) break;
      }
    }
    return out;
  }, [q, promptsData]);

  const competitorMatches = useMemo(() => {
    if (!q) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of topCompetitors) {
      const name = c.company;
      const key = name?.toLowerCase();
      if (name && key.includes(q) && !seen.has(key)) {
        seen.add(key);
        out.push(name);
        if (out.length >= RESULT_CAP) break;
      }
    }
    return out;
  }, [q, topCompetitors]);

  const sourceMatches = useMemo(() => {
    if (!q) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of topCitations) {
      const d = c.domain;
      const key = d?.toLowerCase();
      if (d && key.includes(q) && !seen.has(key)) {
        seen.add(key);
        out.push(d);
        if (out.length >= RESULT_CAP) break;
      }
    }
    return out;
  }, [q, topCitations]);

  const themeMatches = useMemo(() => {
    if (!q) return [];
    return ATTRIBUTES.filter(a => a.name.toLowerCase().includes(q))
      .slice(0, RESULT_CAP)
      .map(a => a.name);
  }, [q]);

  const go = (section: string, seedQuery?: string) => {
    if (seedQuery) seedTabSearch(section, seedQuery);
    onNavigate(section);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      title="Search"
      description="Search prompts, competitors, sources and themes"
    >
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search prompts, competitors, sources, themes…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {sections.length > 0 && (
          <CommandGroup heading={q ? "Go to" : "Jump to"}>
            {sections.map(s => (
              <CommandItem key={s.section} value={`go-${s.section}`} onSelect={() => go(s.section)}>
                <s.icon className="text-gray-500" />
                <span>{s.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {competitorMatches.length > 0 && (
          <CommandGroup heading="Competitors">
            {competitorMatches.map(name => (
              <CommandItem key={`c-${name}`} value={`competitor-${name}`} onSelect={() => go("competitors", name)}>
                <Users className="text-gray-500" />
                <span className="truncate">{name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sourceMatches.length > 0 && (
          <CommandGroup heading="Sources">
            {sourceMatches.map(d => (
              <CommandItem key={`s-${d}`} value={`source-${d}`} onSelect={() => go("sources", d)}>
                <Globe className="text-gray-500" />
                <span className="truncate">{d}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {themeMatches.length > 0 && (
          <CommandGroup heading="Themes">
            {themeMatches.map(name => (
              <CommandItem key={`t-${name}`} value={`theme-${name}`} onSelect={() => go("thematic", name)}>
                <Lightbulb className="text-gray-500" />
                <span className="truncate">{name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {promptMatches.length > 0 && (
          <CommandGroup heading="Prompts">
            {promptMatches.map((text, i) => (
              <CommandItem key={`p-${i}`} value={`prompt-${i}`} onSelect={() => go("prompts", text)}>
                <MessageSquare className="text-gray-500" />
                <span className="truncate">{text}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
