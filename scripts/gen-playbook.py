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
print("\n".join(out))
