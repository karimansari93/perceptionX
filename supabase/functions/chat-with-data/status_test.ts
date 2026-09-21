import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { statusLine } from './status.ts';

const labels = { get_attribute_themes: 'Analyzing themes by market', get_visibility: 'Measuring visibility', list_companies: 'Looking up companies' };

Deno.test('status line: one call keeps the plain label', () => {
  assertEquals(statusLine([{ name: 'get_visibility', input: { company_id: 'x', market: 'Germany' } }], labels), 'Measuring visibility...');
});

Deno.test('status line: parallel calls of one tool say what differed instead of repeating', () => {
  const calls = [
    { name: 'get_attribute_themes', input: { company_id: 'x', market: 'Germany' } },
    { name: 'get_attribute_themes', input: { company_id: 'x', market: 'United Kingdom' } },
    { name: 'list_companies', input: {} },
  ];
  assertEquals(statusLine(calls, labels), 'Analyzing themes by market (Germany, United Kingdom) + Looking up companies...');
});

Deno.test('status line: repeats with nothing distinguishing collapse to one label', () => {
  const calls = [
    { name: 'get_attribute_themes', input: { company_id: 'x' } },
    { name: 'get_attribute_themes', input: { company_id: 'y' } },
  ];
  assertEquals(statusLine(calls, labels), 'Analyzing themes by market...');
});

Deno.test('status line: a fan-out over many markets names three and counts the rest', () => {
  const markets = ['Germany', 'Brazil', 'Argentina', 'United Kingdom', 'Mexico', 'India', 'Thailand', 'Australia'];
  const calls = markets.map(market => ({ name: 'get_attribute_themes', input: { company_id: 'x', attribute: 'Job Security', market } }));
  assertEquals(statusLine(calls, labels), 'Analyzing themes by market (Germany, Brazil, Argentina + 5 more)...');
});

Deno.test('status line: unknown tools fall back to their name', () => {
  assertEquals(statusLine([{ name: 'mystery_tool', input: null }], labels), 'mystery_tool...');
});
