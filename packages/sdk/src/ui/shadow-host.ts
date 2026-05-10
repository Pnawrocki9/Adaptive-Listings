/**
 * Shadow DOM host — creates an isolated container for all Estalara UI elements.
 *
 * Uses open shadow root so devtools can inspect it, but CSS is fully isolated.
 * Injected as the last child of <body> with z-index management.
 */

export interface ShadowHost {
  root: ShadowRoot;
  container: HTMLElement;
  destroy: () => void;
}

/**
 * Base CSS injected into every Shadow DOM — resets box-sizing,
 * sets font stack, z-index layer.
 */
export const SHADOW_BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  :host { all: initial; font-family: system-ui, sans-serif; }
  .estalara-root { position: fixed; z-index: 2147483647; pointer-events: none; }
  .estalara-widget { pointer-events: auto; }
`;

/**
 * Create and attach the Estalara Shadow DOM host to the page.
 * Returns null in non-browser environments.
 */
export function createShadowHost(): ShadowHost | null {
  try {
    if (typeof document === 'undefined') {
      return null;
    }

    const container = document.createElement('div');
    container.setAttribute('data-estalara-host', '');

    const root = container.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = SHADOW_BASE_CSS;
    root.appendChild(style);

    const inner = document.createElement('div');
    inner.className = 'estalara-root';
    root.appendChild(inner);

    document.body.appendChild(container);

    return {
      root,
      container,
      destroy() {
        try {
          container.remove();
        } catch {
          // ignore — element may already be gone
        }
      },
    };
  } catch {
    return null;
  }
}
