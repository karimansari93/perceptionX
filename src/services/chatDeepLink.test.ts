import { describe, expect, it } from 'vitest';
import { conversationIdFromSearch, conversationPath } from './chatService';

describe('chat deep links', () => {
  const id = '2d96c4e2-92ac-479e-9bab-183a96a8e542';

  it('builds and parses the thread address', () => {
    expect(conversationPath(id)).toBe(`/chat?c=${id}`);
    expect(conversationIdFromSearch(`?c=${id}`)).toBe(id);
    expect(conversationIdFromSearch(new URLSearchParams({ c: id, q: 'ignored' }))).toBe(id);
  });

  it('ignores anything that is not a conversation id', () => {
    expect(conversationIdFromSearch('')).toBeNull();
    expect(conversationIdFromSearch('?c=')).toBeNull();
    expect(conversationIdFromSearch('?c=not-an-id')).toBeNull();
    expect(conversationIdFromSearch("?c=' or 1=1")).toBeNull();
  });
});
