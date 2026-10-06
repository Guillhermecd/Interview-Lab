import type { Conversation } from '@interview-lab/shared';

export interface ConversationGroup {
  label: string;
  conversations: Conversation[];
}

const TODAY = 'Hoje';
const YESTERDAY = 'Ontem';
const LAST_WEEK = 'Últimos 7 dias';
const OLDER = 'Anteriores';
const GROUP_ORDER = [TODAY, YESTERDAY, LAST_WEEK, OLDER];

const WEEK_DAYS = 7;

// Midnight of the day `date` falls on, in the time zone of the browser.
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function groupOf(updatedAt: string, now: Date): string {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) {
    return OLDER;
  }
  const today = startOfDay(now);
  const day = startOfDay(updated);
  if (day >= today) {
    return TODAY;
  }
  // Calendar days, so a change of daylight saving time does not move a day.
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (day >= yesterday) {
    return YESTERDAY;
  }
  const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - WEEK_DAYS).getTime();
  return day >= weekAgo ? LAST_WEEK : OLDER;
}

// Text typed in the search, compared without case or accents.
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

// The conversations whose title contains the text searched. Only the titles
// already loaded are searched: it is a filter of the list, not of the messages.
export function filterConversations(conversations: Conversation[], search: string): Conversation[] {
  const wanted = normalize(search);
  return wanted === ''
    ? conversations
    : conversations.filter((conversation) => normalize(conversation.title ?? '').includes(wanted));
}

// Splits the list, which the server already sorts by last activity, into the
// periods shown as headings. Only how the list is displayed: nothing is decided.
export function groupConversations(conversations: Conversation[], now: Date): ConversationGroup[] {
  const groups = new Map<string, Conversation[]>();
  for (const conversation of conversations) {
    const label = groupOf(conversation.updatedAt, now);
    groups.set(label, [...(groups.get(label) ?? []), conversation]);
  }
  return GROUP_ORDER.flatMap((label) => {
    const items = groups.get(label);
    return items ? [{ label, conversations: items }] : [];
  });
}
