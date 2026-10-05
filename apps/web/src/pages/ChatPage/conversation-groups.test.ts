import type { Conversation } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import { filterConversations, groupConversations } from './conversation-groups';

// Local time, as the browser sees it: the groups follow the user's calendar.
const NOW = new Date(2026, 9, 5, 15, 30);

function conversation(title: string | null, updatedAt: Date): Conversation {
  return {
    id: title ?? 'sem-titulo',
    title,
    createdAt: updatedAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

function titlesByGroup(conversations: Conversation[]): Record<string, (string | null)[]> {
  return Object.fromEntries(
    groupConversations(conversations, NOW).map((group) => [
      group.label,
      group.conversations.map((item) => item.title),
    ]),
  );
}

describe('groupConversations', () => {
  it('splits the list by calendar day, keeping the order the server sent', () => {
    const list = [
      conversation('agora', new Date(2026, 9, 5, 15, 0)),
      conversation('meia-noite', new Date(2026, 9, 5, 0, 0)),
      conversation('ontem à noite', new Date(2026, 9, 4, 23, 59)),
      conversation('ontem cedo', new Date(2026, 9, 4, 0, 0)),
      conversation('anteontem', new Date(2026, 9, 3, 23, 59)),
      conversation('sete dias', new Date(2026, 8, 28, 0, 0)),
      conversation('oito dias', new Date(2026, 8, 27, 23, 59)),
      conversation('ano passado', new Date(2025, 0, 1)),
    ];

    expect(titlesByGroup(list)).toEqual({
      Hoje: ['agora', 'meia-noite'],
      Ontem: ['ontem à noite', 'ontem cedo'],
      'Últimos 7 dias': ['anteontem', 'sete dias'],
      Anteriores: ['oito dias', 'ano passado'],
    });
  });

  it('shows the groups in order of recency and leaves out the empty ones', () => {
    const groups = groupConversations(
      [
        conversation('velha', new Date(2026, 0, 1)),
        conversation('de hoje', new Date(2026, 9, 5, 9, 0)),
      ],
      NOW,
    );

    expect(groups.map((group) => group.label)).toEqual(['Hoje', 'Anteriores']);
  });

  it('keeps a conversation with an unreadable date, among the oldest', () => {
    const broken = { ...conversation('quebrada', NOW), updatedAt: 'não é data' };

    expect(titlesByGroup([broken])).toEqual({ Anteriores: ['quebrada'] });
  });

  it('answers nothing for an empty list', () => {
    expect(groupConversations([], NOW)).toEqual([]);
  });
});

describe('filterConversations', () => {
  const list = [
    conversation('Faturamento por região', NOW),
    conversation('Estoque crítico', NOW),
    conversation(null, NOW),
  ];

  it('keeps everything when nothing was typed', () => {
    expect(filterConversations(list, '   ')).toBe(list);
  });

  it('finds a title whatever the case or the accents typed', () => {
    expect(filterConversations(list, 'REGIAO').map((item) => item.title)).toEqual([
      'Faturamento por região',
    ]);
    expect(filterConversations(list, ' crítico ').map((item) => item.title)).toEqual([
      'Estoque crítico',
    ]);
  });

  it('never matches a conversation without a title', () => {
    expect(filterConversations(list, 'sem título')).toEqual([]);
  });
});
