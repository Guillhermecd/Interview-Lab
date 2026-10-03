import type { Conversation } from '@interview-lab/shared';
import { useCallback, useEffect, useState } from 'react';
import { toApiError } from '../../api/modules/api';
import { ConversationService } from '../../api/modules/conversation.service';

interface ConversationListState {
  conversations: Conversation[];
  isLoading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
}

interface ListResult {
  conversations: Conversation[];
  error?: string;
}

async function loadConversations(): Promise<ListResult> {
  try {
    return { conversations: await ConversationService.list() };
  } catch (error) {
    return { conversations: [], error: toApiError(error).message };
  }
}

export function useConversationList(): ConversationListState {
  const [result, setResult] = useState<ListResult>();

  useEffect(() => {
    let active = true;
    void loadConversations().then((loaded) => {
      if (active) {
        setResult(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setResult(await loadConversations());
  }, []);

  return {
    conversations: result?.conversations ?? [],
    isLoading: result === undefined,
    error: result?.error,
    refresh,
  };
}
