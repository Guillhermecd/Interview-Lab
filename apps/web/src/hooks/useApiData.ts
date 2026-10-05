import { useEffect, useState } from 'react';
import { toApiError } from '../api/modules/api';

export interface ApiData<Data> {
  // The last answer received; kept on screen while a newer one loads.
  data: Data | undefined;
  isLoading: boolean;
  error: string | undefined;
}

interface Settled<Data> {
  key: string;
  data?: Data;
  error?: string;
}

// Loads data from the API and loads it again whenever `key` changes. An answer
// that arrives after the key changed is dropped, and its request aborted.
// `load` must depend only on what `key` describes.
export function useApiData<Data>(
  key: string,
  load: (signal: AbortSignal) => Promise<Data>,
): ApiData<Data> {
  const [settled, setSettled] = useState<Settled<Data>>();
  const [lastData, setLastData] = useState<Data>();

  useEffect(() => {
    const abort = new AbortController();
    load(abort.signal)
      .then((data) => {
        if (!abort.signal.aborted) {
          setSettled({ key, data });
          setLastData(data);
        }
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          setSettled({ key, error: toApiError(error).message });
        }
      });
    return () => {
      abort.abort();
    };
    // `load` is described by `key`: a new closure with the same key is the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = settled?.key === key ? settled : undefined;
  return {
    data: current?.data ?? lastData,
    isLoading: current === undefined,
    error: current?.error,
  };
}
