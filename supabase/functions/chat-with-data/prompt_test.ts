// Pins "one rulebook": the chat prompt carries the MCP instructions verbatim
// and adds only persona and response style. Run with:
//   cd supabase/functions && deno test chat-with-data/
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { PX_INSTRUCTIONS, PX_RULES, PX_RULES_TEXT } from '../_shared/px-tools/instructions.ts';
import { buildSystemPrompt } from './prompt.ts';

Deno.test('rulebook: eleven numbered rules, the phrases the eval pins', () => {
  assertEquals(PX_RULES.length, 11);
  for (let i = 1; i <= 11; i++) assertStringIncludes(PX_RULES_TEXT, `\n${i}. `.replace(/^\n1\. $/, '1. '));
  assertStringIncludes(PX_INSTRUCTIONS, '_coverage');
  assertStringIncludes(PX_INSTRUCTIONS, 'never describe it as missing');
  assertStringIncludes(PX_INSTRUCTIONS, 'sample_size');
  assertStringIncludes(PX_INSTRUCTIONS, 'There is no cross-customer data');
  assertStringIncludes(PX_INSTRUCTIONS, 'top_pages');
  assertStringIncludes(PX_INSTRUCTIONS, 'by_job_function');
});

Deno.test('chat prompt embeds the rulebook word for word, adds only persona and style', () => {
  const prompt = buildSystemPrompt('Ford Motor Company');
  assertStringIncludes(prompt, PX_INSTRUCTIONS);
  // Exactly one copy of the rules, no paraphrased second copy.
  assertEquals(prompt.split('Rules for using these tools:').length, 2);
  // Persona names the org; nothing volatile (dates, ids) is interpolated.
  assertStringIncludes(prompt, 'senior employer brand analyst for Ford Motor Company');
  assert(!/\d{4}-\d{2}-\d{2}/.test(prompt));
  // Byte-stable per org: the cache prefix is the same on every call.
  assertEquals(prompt, buildSystemPrompt('Ford Motor Company'));
  // Presentation rules the brief keeps.
  assertStringIncludes(prompt, 'ChatGPT, Perplexity, Google AI Overviews, Google AI Mode');
  assertStringIncludes(prompt, 'EPS = 50% sentiment + 30% visibility + 20% relevance');
  assertStringIncludes(prompt, 'association');
  // Chat voice: no process narration, answer first.
  assertStringIncludes(prompt, 'Never narrate your process');
  assert(!/excluded models|excludes? (claude|gemini|deepseek)/i.test(prompt));
});
