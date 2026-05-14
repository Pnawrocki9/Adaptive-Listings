/**
 * Tier 1 Observer Sidebar Widget — persistent panel rendered inside Shadow DOM.
 *
 * Shows the current detected archetype, confidence, signal count, and any
 * adaptation directives previewed for this session. Uses vanilla DOM (no Preact)
 * to stay well under the 40KB gzip bundle budget.
 *
 * Visual behaviour:
 *   - Fixed to the right edge of the viewport (280px wide)
 *   - Initially hidden (display: none) — caller must call show()
 *   - Drag handle on the left edge allows vertical repositioning
 *   - Close button fires onClose callback and hides the panel
 *
 * CSS is fully scoped inside Shadow DOM — host page styles cannot bleed in
 * and widget styles cannot bleed out.
 *
 * @module @estalara/sdk/ui/sidebar-widget
 */

export interface SidebarWidgetOptions {
  /** Accent / brand colour — defaults to #0066ff. */
  accentColor?: string;
  /** UI language — defaults to 'en'. */
  language?: 'en' | 'pl' | 'es';
  /** Called when the user clicks the close button. */
  onClose?: () => void;
}

export interface TextDirective {
  slot: string;
  text: string;
}

export interface SidebarState {
  /** Human-readable archetype name, e.g. "Yield Hunter". */
  archetype: string;
  /** 0.0 – 1.0 confidence score. */
  confidence: number;
  /** Number of behavioral signals collected so far. */
  signalCount: number;
  /** Optional directives to preview in the sidebar body. Omit or pass undefined to hide the section. */
  directives?: TextDirective[] | undefined;
}

/** Controller returned by createSidebarWidget. */
export interface SidebarWidgetController {
  show(state: SidebarState): void;
  update(state: SidebarState): void;
  hide(): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Internationalisation labels
// ---------------------------------------------------------------------------

const LABELS = {
  en: {
    title: 'Personalizing for you',
    confidence: 'Confidence',
    signals: 'Signals collected',
    signalUnit: 'signals',
    directivesHeading: 'Tailored content preview',
    close: '×',
    closeAriaLabel: 'Close Estalara panel',
    dragAriaLabel: 'Drag to reposition',
  },
  pl: {
    title: 'Personalizujemy dla Ciebie',
    confidence: 'Pewność',
    signals: 'Zebrane sygnały',
    signalUnit: 'sygnałów',
    directivesHeading: 'Podgląd dopasowanej treści',
    close: '×',
    closeAriaLabel: 'Zamknij panel Estalara',
    dragAriaLabel: 'Przeciągnij, aby zmienić pozycję',
  },
  es: {
    title: 'Personalizando para ti',
    confidence: 'Confianza',
    signals: 'Señales recopiladas',
    signalUnit: 'señales',
    directivesHeading: 'Vista previa de contenido adaptado',
    close: '×',
    closeAriaLabel: 'Cerrar panel de Estalara',
    dragAriaLabel: 'Arrastrar para reposicionar',
  },
} as const;

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

function buildCSS(accentColor: string): string {
  return `
    .estalara-sidebar {
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 280px;
      max-height: 90vh;
      overflow-y: auto;
      background: #ffffff;
      border-left: 3px solid ${accentColor};
      box-shadow: -4px 0 16px rgba(0,0,0,0.12);
      border-radius: 8px 0 0 8px;
      display: none;
      flex-direction: column;
      z-index: 2147483647;
      pointer-events: auto;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      color: #111827;
      box-sizing: border-box;
    }
    .estalara-sidebar--visible {
      display: flex;
    }
    .estalara-sidebar__drag-handle {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 8px;
      cursor: ew-resize;
      background: transparent;
      border-radius: 8px 0 0 8px;
      flex-shrink: 0;
    }
    .estalara-sidebar__drag-handle:hover {
      background: rgba(0,0,0,0.06);
    }
    .estalara-sidebar__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 12px 10px 18px;
      border-bottom: 1px solid #f3f4f6;
      flex-shrink: 0;
    }
    .estalara-sidebar__title {
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0;
    }
    .estalara-sidebar__close {
      background: transparent;
      border: none;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      color: #9ca3af;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .estalara-sidebar__close:hover {
      background: #f3f4f6;
      color: #374151;
    }
    .estalara-sidebar__body {
      padding: 14px 14px 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .estalara-sidebar__archetype-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      background: ${accentColor};
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      width: fit-content;
      max-width: 100%;
      word-break: break-word;
    }
    .estalara-sidebar__confidence-badge {
      font-size: 11px;
      font-weight: 400;
      opacity: 0.85;
    }
    .estalara-sidebar__stat {
      font-size: 12px;
      color: #6b7280;
    }
    .estalara-sidebar__stat-value {
      font-weight: 600;
      color: #374151;
    }
    .estalara-sidebar__directives {
      border-top: 1px solid #f3f4f6;
      padding-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .estalara-sidebar__directives-heading {
      font-size: 11px;
      font-weight: 600;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0 0 4px;
    }
    .estalara-sidebar__directive-item {
      background: #f9fafb;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      color: #374151;
    }
    .estalara-sidebar__directive-slot {
      font-size: 10px;
      font-weight: 600;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      display: block;
      margin-bottom: 2px;
    }
  `;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function formatConfidence(confidence: number): string {
  return `${String(Math.round(confidence * 100))}%`;
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

/**
 * Create and mount the Tier 1 Observer sidebar panel inside an existing Shadow DOM root.
 *
 * The panel is initially hidden. Call show(state) to make it visible.
 * Call update(state) to re-render the content without toggling visibility.
 * Call hide() to collapse the panel. Call destroy() to remove all DOM and listeners.
 *
 * @param shadowRoot - The Shadow DOM root to render into (must already exist).
 * @param options    - Widget appearance and behaviour options.
 * @returns          - Controller with show / update / hide / destroy.
 */
export function createSidebarWidget(
  shadowRoot: ShadowRoot,
  options: SidebarWidgetOptions = {},
): SidebarWidgetController {
  const accentColor = options.accentColor ?? '#0066ff';
  const language = options.language ?? 'en';
  const onClose = options.onClose;

  const labels = LABELS[language];

  // ── Inject scoped <style> ────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = buildCSS(accentColor);
  shadowRoot.appendChild(styleEl);

  // ── Root panel element ──────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'estalara-sidebar';
  panel.setAttribute('data-estalara-sidebar', '');
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', labels.title);

  // ── Drag handle ─────────────────────────────────────────────────────────
  const dragHandle = document.createElement('div');
  dragHandle.className = 'estalara-sidebar__drag-handle';
  dragHandle.setAttribute('aria-label', labels.dragAriaLabel);
  panel.appendChild(dragHandle);

  // ── Header ──────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'estalara-sidebar__header';

  const titleEl = document.createElement('p');
  titleEl.className = 'estalara-sidebar__title';
  titleEl.textContent = labels.title;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'estalara-sidebar__close';
  closeBtn.textContent = labels.close;
  closeBtn.setAttribute('aria-label', labels.closeAriaLabel);
  closeBtn.setAttribute('type', 'button');

  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // ── Body ─────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'estalara-sidebar__body';

  const archetypeChip = document.createElement('div');
  archetypeChip.className = 'estalara-sidebar__archetype-chip';

  const archetypeLabel = document.createElement('span');
  archetypeLabel.className = 'estalara-sidebar__archetype-label';

  const confidenceBadge = document.createElement('span');
  confidenceBadge.className = 'estalara-sidebar__confidence-badge';

  archetypeChip.appendChild(archetypeLabel);
  archetypeChip.appendChild(confidenceBadge);

  const signalStat = document.createElement('div');
  signalStat.className = 'estalara-sidebar__stat';

  body.appendChild(archetypeChip);
  body.appendChild(signalStat);

  // Directives section — only rendered when directives are present
  const directivesSection = document.createElement('div');
  directivesSection.className = 'estalara-sidebar__directives';

  const directivesHeading = document.createElement('p');
  directivesHeading.className = 'estalara-sidebar__directives-heading';
  directivesHeading.textContent = labels.directivesHeading;
  directivesSection.appendChild(directivesHeading);

  panel.appendChild(body);
  shadowRoot.appendChild(panel);

  // ── State renderer ───────────────────────────────────────────────────────
  function renderState(state: SidebarState): void {
    archetypeLabel.textContent = state.archetype;
    confidenceBadge.textContent = formatConfidence(state.confidence);

    const sigValue = document.createElement('span');
    sigValue.className = 'estalara-sidebar__stat-value';
    sigValue.textContent = String(state.signalCount);

    signalStat.textContent = '';
    signalStat.appendChild(sigValue);
    signalStat.appendChild(document.createTextNode(` ${labels.signals} (${labels.signalUnit})`));

    // Remove directives section if already present
    if (directivesSection.parentNode === body) {
      body.removeChild(directivesSection);
    }

    const dirs = state.directives;
    if (dirs && dirs.length > 0) {
      // Remove old items (all children after the heading)
      while (directivesSection.children.length > 1) {
        const lastChild = directivesSection.lastChild;
        if (!lastChild) break;
        directivesSection.removeChild(lastChild);
      }

      dirs.forEach((d) => {
        const item = document.createElement('div');
        item.className = 'estalara-sidebar__directive-item';

        const slotLabel = document.createElement('span');
        slotLabel.className = 'estalara-sidebar__directive-slot';
        slotLabel.textContent = d.slot;

        const textNode = document.createElement('span');
        textNode.textContent = d.text;

        item.appendChild(slotLabel);
        item.appendChild(textNode);
        directivesSection.appendChild(item);
      });

      body.appendChild(directivesSection);
    }
  }

  // ── Drag behaviour ───────────────────────────────────────────────────────
  // Tracks the panel's current `top` offset as a px value.
  // We update panel.style.top directly; transform is reset to none once dragging begins.
  let isDragging = false;
  let dragStartY = 0;
  let panelStartTop = 0;

  function onMouseDown(e: MouseEvent): void {
    isDragging = true;
    dragStartY = e.clientY;

    // Resolve the current top offset in px from the computed style
    const computed = window.getComputedStyle(panel);
    panelStartTop = parseInt(computed.top, 10);

    // Remove the initial transform once dragging starts so `top` is sole positioner
    panel.style.transform = 'none';

    e.preventDefault();
  }

  function onMouseMove(e: MouseEvent): void {
    if (!isDragging) return;
    const delta = e.clientY - dragStartY;
    const newTop = panelStartTop + delta;
    const minTop = 0;
    const maxTop = window.innerHeight - panel.offsetHeight;
    panel.style.top = `${String(Math.min(Math.max(newTop, minTop), maxTop))}px`;
  }

  function onMouseUp(): void {
    isDragging = false;
  }

  dragHandle.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // ── Close button ─────────────────────────────────────────────────────────
  function handleClose(): void {
    panel.classList.remove('estalara-sidebar--visible');
    panel.style.display = 'none';
    onClose?.();
  }

  closeBtn.addEventListener('click', handleClose);

  // ── Controller ───────────────────────────────────────────────────────────
  function show(state: SidebarState): void {
    renderState(state);
    panel.classList.add('estalara-sidebar--visible');
  }

  function update(state: SidebarState): void {
    renderState(state);
  }

  function hide(): void {
    panel.classList.remove('estalara-sidebar--visible');
    panel.style.display = 'none';
  }

  function destroy(): void {
    closeBtn.removeEventListener('click', handleClose);
    dragHandle.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    try {
      panel.remove();
      styleEl.remove();
    } catch {
      // already removed — ignore
    }
  }

  return { show, update, hide, destroy };
}
