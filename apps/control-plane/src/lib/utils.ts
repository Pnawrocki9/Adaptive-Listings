import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines class names using clsx and resolves Tailwind conflicts with tailwind-merge.
 *
 * @param inputs - Class values to merge (strings, arrays, objects, conditionals)
 * @returns Merged class string with Tailwind conflicts resolved
 *
 * @example
 * cn('px-2 py-1', 'px-4') // → 'py-1 px-4'
 * cn('text-red-500', isError && 'text-red-700') // conditional
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
