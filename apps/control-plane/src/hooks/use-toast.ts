'use client';

import * as React from 'react';

import type { ToastActionElement, ToastProps } from '@/components/ui/toast';

const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 1000000;

interface ToasterToast extends Omit<ToastProps, 'title'> {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
}

const ADD_TOAST = 'ADD_TOAST' as const;
const UPDATE_TOAST = 'UPDATE_TOAST' as const;
const DISMISS_TOAST = 'DISMISS_TOAST' as const;
const REMOVE_TOAST = 'REMOVE_TOAST' as const;

type Action =
  | {
      type: typeof ADD_TOAST;
      toast: ToasterToast;
    }
  | {
      type: typeof UPDATE_TOAST;
      toast: Partial<ToasterToast>;
    }
  | {
      type: typeof DISMISS_TOAST;
      toastId?: string;
    }
  | {
      type: typeof REMOVE_TOAST;
      toastId?: string;
    };

interface State {
  toasts: ToasterToast[];
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

let count = 0;

function genId(): string {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

const addToRemoveQueue = (toastId: string): void => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: REMOVE_TOAST,
      toastId: toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case ADD_TOAST:
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      };

    case DISMISS_TOAST: {
      const { toastId } = action;

      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      };
    }
    case REMOVE_TOAST:
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners: ((state: State) => void)[] = [];

let memoryState: State = { toasts: [] };

function dispatch(action: Action): void {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

type Toast = Omit<ToasterToast, 'id'>;

function toast({ ...props }: Toast): {
  id: string;
  dismiss: () => void;
  update: (props: ToasterToast) => void;
} {
  const id = genId();

  const update = (updateProps: ToasterToast): void => {
    dispatch({
      type: UPDATE_TOAST,
      toast: { ...updateProps, id },
    });
  };
  const dismiss = (): void => {
    dispatch({ type: DISMISS_TOAST, toastId: id });
  };

  dispatch({
    type: ADD_TOAST,
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  return {
    id: id,
    dismiss,
    update,
  };
}

interface UseToastReturn {
  toast: typeof toast;
  dismiss: (toastId?: string) => void;
  toasts: ToasterToast[];
}

/**
 * Hook to access and manage toast notifications.
 *
 * @returns Toast state and utility functions
 *
 * @example
 * const { toast } = useToast();
 * toast({ title: 'Saved!', description: 'Your changes have been saved.' });
 */
function useToast(): UseToastReturn {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => {
      if (toastId !== undefined) {
        dispatch({ type: DISMISS_TOAST, toastId });
      } else {
        dispatch({ type: DISMISS_TOAST });
      }
    },
  };
}

export { useToast, toast };
