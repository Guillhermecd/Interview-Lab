import type { ContextMessage, ConversationContext } from '../ask/prompts.js';

// D-27: the most recent messages are given to the LLM in full...
export const RECENT_MESSAGES_KEPT = 6;
// ...and once this many older messages are still outside the summary, the
// summary is regenerated to include them.
export const SUMMARIZE_THRESHOLD = 6;

export interface StoredMessage extends ContextMessage {
  id: string;
}

export interface ConversationMemory {
  summary: string | undefined;
  // Messages newer than the summary, oldest first.
  unsummarized: StoredMessage[];
}

// The messages that should move into the summary now: everything but the most
// recent ones, and only when there are enough of them to be worth an LLM call.
export function selectMessagesToSummarize(unsummarized: StoredMessage[]): StoredMessage[] {
  const outsideRecentWindow = unsummarized.slice(
    0,
    Math.max(0, unsummarized.length - RECENT_MESSAGES_KEPT),
  );
  return outsideRecentWindow.length >= SUMMARIZE_THRESHOLD ? outsideRecentWindow : [];
}

// What the LLM receives as conversation history: the summary plus every
// message it does not cover yet. Bounded by the rule above to fewer than
// RECENT_MESSAGES_KEPT + SUMMARIZE_THRESHOLD messages after each refresh.
export function toConversationContext(memory: ConversationMemory): ConversationContext {
  return {
    ...(memory.summary !== undefined && { summary: memory.summary }),
    recent: memory.unsummarized.map(({ role, content, sql }) => ({
      role,
      content,
      ...(sql !== undefined && { sql }),
    })),
  };
}
