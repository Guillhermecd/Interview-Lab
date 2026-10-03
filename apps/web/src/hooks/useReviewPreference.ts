import { useCallback, useState } from 'react';

const STORAGE_KEY = 'interview-lab:review-sql';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return false;
  }
}

// "Review the SQL before running it" (D-32): off by default, remembered in the
// browser.
export function useReviewPreference(): { review: boolean; setReview: (value: boolean) => void } {
  const [review, setReviewState] = useState(readStored);

  const setReview = useCallback((value: boolean) => {
    setReviewState(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // The preference simply is not remembered.
    }
  }, []);

  return { review, setReview };
}
