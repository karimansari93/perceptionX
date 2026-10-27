import json, re, sys
src = open(sys.argv[1], encoding='utf-8').read()
parts = re.split(r'^## topic: (\w+)\s*$', src, flags=re.M)
topics = []
for i in range(1, len(parts), 2):
    key, body = parts[i], parts[i+1].strip('\n')
    topics.append((key, body))
titles = {
  'prioritise': 'Where the score can move and how to rank the work',
  'diagnose': 'Diagnosing a weak topic: four questions before recommending',
  'who_owns': 'Who at an employer owns what, and how fast it can change',
  'career_site': 'What a strong career site publishes',
  'job_posting': 'Where a block goes on a job posting, and what a strong posting contains',
  'ai_readability': 'AI readability: what AI assistants can and cannot read',
  'pay_transparency': 'Pay transparency law by region (check before acting)',
  'candidate_experience': 'Candidate experience: complaints, causes, levers and awards',
  'lists_awards': 'Employer lists and awards: what can be entered and what cannot',
  'levers': 'Levers that change what AI reads, and what not to recommend',
  'review_platforms': 'Review platform capabilities and rules',
  'writing_recommendations': 'How to write a recommendation',
}
EXECUTOR = """export const PLAYBOOK_TOPIC_SET: ReadonlySet<string> = new Set(PLAYBOOK_TOPICS);

// get_playbook: one topic, verbatim, with its as-of date. Unknown topic →
// no_data plus the topic list, so a host model can pick again. Never a
// measurement: the text is guidance, shared across organizations.
export function getPlaybook(topicInput: unknown): string {
  const topic = String(topicInput ?? '').trim().toLowerCase().replace(/[\\s-]+/g, '_');
  if (!PLAYBOOK_TOPIC_SET.has(topic)) {
    return JSON.stringify({
      topic: topic || null,
      topics: PLAYBOOK_TOPICS,
      as_of: PLAYBOOK_AS_OF,
      _coverage: {
        status: 'no_data',
        reason: `No playbook topic "${topic}". Pick one of: ${PLAYBOOK_TOPICS.join(', ')}.`,
      },
    });
  }
  const entry = PLAYBOOK[topic as PlaybookTopic];
  return JSON.stringify({
    topic,
    title: entry.title,
    as_of: PLAYBOOK_AS_OF,
    text: entry.text,
    _coverage: { status: 'found' },
    _meta: {
      methodology: [
        `This is PerceptionX playbook guidance as of ${PLAYBOOK_AS_OF}, not a measurement of the organization: take every figure about the organization from the data tools, and say which points are guidance.`,
        'Laws, platform features and list deadlines change: give the as-of date and tell the user to check before acting.',
      ],
    },
  });
}
"""

out = []
out.append("// ─── px-tools: the employer reputation playbook ──────────────────────────────")
out.append("// Source: docs/playbook/px-playbook-client-safe.md, one entry per")
out.append("// `## topic:` block, text verbatim (markdown kept). get_playbook returns")
out.append("// one topic at a time to the in-app chat and to Ask PerceptionX over MCP.")
out.append("//")
out.append("// Rules for this file (brief, 2026-10-27):")
out.append("//   * shared across every organization, so it carries no client names, no")
out.append("//     client data and no cross-client figures;")
out.append("//   * external facts carry their source and date, and anything marked")
out.append("//     \"check before acting\" (laws, platform features, list deadlines)")
out.append("//     changes often, so PLAYBOOK_AS_OF travels with every result;")
out.append("//   * no em dashes anywhere in the text (playbook_test.ts pins it).")
out.append("// To update: edit the markdown, regenerate this file, bump PLAYBOOK_AS_OF.")
out.append("")
out.append("export const PLAYBOOK_AS_OF = '2026-10-27';")
out.append("")
out.append("export const PLAYBOOK_TOPICS = [")
for k,_ in topics: out.append(f"  '{k}',")
out.append("] as const;")
out.append("export type PlaybookTopic = typeof PLAYBOOK_TOPICS[number];")
out.append("")
out.append("export const PLAYBOOK: Record<PlaybookTopic, { title: string; text: string }> = {")
for k, body in topics:
    out.append(f"  {k}: {{")
    out.append(f"    title: {json.dumps(titles[k])},")
    out.append(f"    text: {json.dumps(body, ensure_ascii=False)},")
    out.append("  },")
out.append("};")
out.append("")
# The executor lives here too, so regenerating the text never drops it
# (2026-10-27: a regeneration once overwrote a hand-appended executor and
# the deployed functions failed to boot).
out.append(EXECUTOR)
print("\n".join(out))
