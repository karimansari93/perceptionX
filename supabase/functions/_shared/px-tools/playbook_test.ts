// Offline tests for get_playbook and the registry additions of 2026-10-27:
//   cd supabase/functions && deno test _shared/px-tools/playbook_test.ts
//
// Pins what the brief asked for: every topic returns verbatim text with its
// as-of date and a found coverage; an unknown topic is no_data with the
// topic list; the playbook is client-safe (no client names) and free of em
// dashes, as are the new tool descriptions; both surfaces carry the new
// tools read-only; the rulebook says advice comes only from the playbook
// and the actions, actions go by title, and "what should we do" follows the
// expert's steps.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { anthropicTools, executeTool, mcpTools, PX_TOOLS } from './mod.ts';
import { PLAYBOOK, PLAYBOOK_AS_OF, PLAYBOOK_TOPICS, getPlaybook } from './playbook.ts';
import { PX_INSTRUCTIONS, PX_RULES } from '../px-tools/instructions.ts';
import { brandTokens } from './executors-drivers.ts';
import type { ToolContext } from './scope.ts';

const ctx: ToolContext = {
  admin: { from: () => { throw new Error('get_playbook must not read the database'); }, rpc: () => { throw new Error('no rpc'); } },
  organizationId: '00000000-0000-4000-8000-00000000000a',
  requestId: 'test',
};

Deno.test('get_playbook: every topic returns its text verbatim with the as-of date, no database read', async () => {
  assertEquals(PLAYBOOK_TOPICS.length, 12);
  for (const topic of PLAYBOOK_TOPICS) {
    const p = JSON.parse(await executeTool(ctx, 'get_playbook', { topic }));
    assertEquals(p._coverage.status, 'found');
    assertEquals(p.topic, topic);
    assertEquals(p.as_of, PLAYBOOK_AS_OF);
    assertEquals(p.text, PLAYBOOK[topic].text);
    assert(p.title.length > 0);
    assertStringIncludes(p._meta.methodology.join(' '), 'not a measurement');
  }
});

Deno.test('get_playbook: unknown topic is no_data with the topic list; spellings are forgiving', () => {
  const bad = JSON.parse(getPlaybook('salary bands'));
  assertEquals(bad._coverage.status, 'no_data');
  assertEquals(bad.topics, PLAYBOOK_TOPICS);
  assertStringIncludes(bad._coverage.reason, 'review_platforms');
  assertEquals(JSON.parse(getPlaybook('Review Platforms')).topic, 'review_platforms');
  assertEquals(JSON.parse(getPlaybook('job-posting')).topic, 'job_posting');
  assertEquals(JSON.parse(getPlaybook(undefined))._coverage.status, 'no_data');
});

Deno.test('playbook is client-safe and carries no em dashes', () => {
  const text = Object.values(PLAYBOOK).map(t => `${t.title}\n${t.text}`).join('\n');
  assert(!text.includes('—'), 'em dash in playbook text');
  for (const client of ['Ford', 'Netflix', 'CSL', 'PepsiCo', 'Thermo Fisher', 'Cloudera', 'GoFundMe']) {
    assert(!new RegExp(`\\b${client}\\b`).test(text), `client name "${client}" in the playbook`);
  }
  assertStringIncludes(PLAYBOOK.pay_transparency.text, 'Check before acting');
  assertStringIncludes(PLAYBOOK.pay_transparency.text, '45 days');
  assertStringIncludes(PLAYBOOK.job_posting.text, 'Only the job description text travels');
});

Deno.test('registry: 19 tools, the new ones on both surfaces, read-only, no em dashes in new descriptions', () => {
  assertEquals(PX_TOOLS.length, 19);
  for (const name of ['get_playbook', 'get_negative_drivers', 'get_report_actions']) {
    assert(anthropicTools.some(t => t.name === name), `${name} missing from the Anthropic registry`);
    const mcp = mcpTools.find(t => t.name === name)!;
    assertEquals(mcp.annotations.readOnlyHint, true);
    assertEquals(mcp.annotations.destructiveHint, false);
    assertEquals(mcp.annotations.openWorldHint, false);
    assert(!mcp.description.includes('—'), `em dash in ${name} description`);
  }
  const playbook = PX_TOOLS.find(t => t.name === 'get_playbook')!;
  assertEquals((playbook.input_schema as any).required, ['topic']);
  assertEquals((playbook.input_schema as any).properties.topic.enum, [...PLAYBOOK_TOPICS]);
  const actions = PX_TOOLS.find(t => t.name === 'get_report_actions')!;
  assert(!('action_number' in (actions.input_schema as any).properties), 'action_number is no longer advertised');
  assert('action' in (actions.input_schema as any).properties);
  // The old description listed numbered actions with timing and owner as
  // fields; the new one describes actions by title and gives no timing.
  for (const phrase of ['numbered', 'owner', 'action number', 'timing, what it lifts']) {
    assert(!actions.description.toLowerCase().includes(phrase), `get_report_actions description still says "${phrase}"`);
  }
  assertStringIncludes(actions.description, 'by their title');
  assertStringIncludes(actions.description, 'give no timing');
});

Deno.test('rulebook: thirteen rules; advice only from the playbook and actions; actions by title; the expert steps', () => {
  assertEquals(PX_RULES.length, 13);
  assertStringIncludes(PX_RULES[0], 'Advice on what to do comes ONLY from get_playbook and get_report_actions');
  assertStringIncludes(PX_RULES[10], 'by their title, never by number');
  assertStringIncludes(PX_RULES[10], 'give no timing');
  assertStringIncludes(PX_RULES[10], 'steps');
  assertStringIncludes(PX_RULES[12], 'first get_attribute_themes for X');
  assertStringIncludes(PX_RULES[12], 'then get_report_actions');
  assertStringIncludes(PX_RULES[12], 'then get_playbook');
  assertStringIncludes(PX_RULES[12], 'talent acquisition');
  assertStringIncludes(PX_INSTRUCTIONS, '13. ');
  assert(!PX_INSTRUCTIONS.includes('Name the action number'));
  for (const rule of [PX_RULES[0], PX_RULES[10], PX_RULES[12]]) assert(!rule.includes('—'), 'em dash in a new rule');
});

Deno.test('brand tokens come from the brand name, never a client list', () => {
  assertEquals(brandTokens('Ford'), ['ford']);
  assertEquals(brandTokens('Ford Business Solutions'), ['ford-business-solutions', 'ford']);
  assertEquals(brandTokens('CSL Behring'), ['csl-behring']);
  assertEquals(brandTokens('Ford España S.L.'), ['ford-espana-s-l', 'ford']);
  assertEquals(brandTokens(''), []);
});
