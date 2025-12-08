import { useState, useEffect } from 'react';
import { logger } from '@/lib/utils';

/**
 * Custom hook that persists state to sessionStorage
 * @param key - Unique key for sessionStorage
 * @param initialValue - Initial value if nothing is stored
 * @returns [state, setState] - Same API as useState
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // Initialize state from sessionStorage or use initial value
  const [state, setState] = useState<T>(() => {
    try {
      const item = sessionStorage.getItem(key);
      if (item === null) {
        return initialValue;
      }
      // Try to parse JSON, fallback to string if it fails
      try {
        return JSON.parse(item);
      } catch {
        // If parsing fails, return as string (for backward compatibility)
        return item as unknown as T;
      }
    } catch (error) {
      logger.warn(`Error reading from sessionStorage for key "${key}":`, error);
      return initialValue;
    }
  });

  // Update sessionStorage whenever state changes
  useEffect(() => {
    try {
      if (state === null || state === undefined) {
        sessionStorage.removeItem(key);
      } else {
        // Handle functions and objects
        if (typeof state === 'string') {
          sessionStorage.setItem(key, state);
        } else {
          sessionStorage.setItem(key, JSON.stringify(state));
        }
      }
    } catch (error) {
      logger.warn(`Error writing to sessionStorage for key "${key}":`, error);
    }
  }, [key, state]);

  return [state, setState];
}

