import { useCallback } from 'react';
import type { Dispatch } from 'react';
import type { ApiConfigAction } from './api-config-types';

export interface ApiConfigMessageActions {
  clearError: () => void;
  showErrorKey: (key: string, values?: Record<string, string | number>) => void;
  showErrorText: (text: string) => void;
  clearSuccessMessage: () => void;
  showSuccessKey: (key: string, values?: Record<string, string | number>) => void;
  showSuccessText: (text: string) => void;
}

export function useApiConfigMessages(dispatch: Dispatch<ApiConfigAction>): ApiConfigMessageActions {
  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, [dispatch]);

  const showErrorKey = useCallback(
    (key: string, values?: Record<string, string | number>) => {
      dispatch({ type: 'SET_ERROR_KEY', key, values });
    },
    [dispatch]
  );

  const showErrorText = useCallback(
    (text: string) => {
      dispatch({ type: 'SET_ERROR_TEXT', text });
    },
    [dispatch]
  );

  const clearSuccessMessage = useCallback(() => {
    dispatch({ type: 'CLEAR_SUCCESS' });
  }, [dispatch]);

  const showSuccessKey = useCallback(
    (key: string, values?: Record<string, string | number>) => {
      dispatch({ type: 'SET_SUCCESS_KEY', key, values });
    },
    [dispatch]
  );

  const showSuccessText = useCallback(
    (text: string) => {
      dispatch({ type: 'SET_SUCCESS_TEXT', text });
    },
    [dispatch]
  );

  return {
    clearError,
    showErrorKey,
    showErrorText,
    clearSuccessMessage,
    showSuccessKey,
    showSuccessText,
  };
}
