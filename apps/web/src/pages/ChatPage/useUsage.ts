import type { UsageSummary } from '@interview-lab/shared';
import { useCallback, useEffect, useState } from 'react';
import { AuthService } from '../../api/modules/auth.service';

// Today's token usage, as reported by the server. A failure only hides the
// indicator: it is not essential to use the chat.
export function useUsage(): { usage: UsageSummary | undefined; refresh: () => Promise<void> } {
  const [usage, setUsage] = useState<UsageSummary>();

  const refresh = useCallback(async () => {
    try {
      setUsage(await AuthService.usage());
    } catch {
      setUsage(undefined);
    }
  }, []);

  useEffect(() => {
    let active = true;
    AuthService.usage()
      .then((summary) => {
        if (active) {
          setUsage(summary);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return { usage, refresh };
}
