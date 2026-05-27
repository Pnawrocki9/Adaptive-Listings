/**
 * detectInquirySubmitSelector — deterministic DOM probe for inquiry/contact form
 * submit buttons.
 *
 * Runs a priority-ordered cascade of heuristics against a parsed HTML document.
 * Returns the first CSS selector that unambiguously identifies the inquiry form
 * submit button, or `null` when no reliable candidate is found.
 *
 * Priority ladder (L1 → L7):
 *  L1  [data-estalara-slot='inquiry-submit'] — our own Tier 3 Native marker (confidence 1.0)
 *  L2  button[type=submit] inside <form> whose action contains inquiry|contact|enquiry
 *  L3  [data-estalara-slot='inquiry-submit'] / [data-inquiry-submit] — any data attr
 *  L4  input[type=submit] inside a qualifying inquiry form
 *  L5  button whose text matches /(send|submit|inquire|contact|message|request|apply)/i
 *      that is inside a <form> containing an email input or textarea
 *  L6  button with class containing inquiry|contact|enquiry inside a contact form context
 *  L7  generic submit button of last resort: the first button[type=submit] on page that
 *      is inside a <form> also containing a textarea OR an email input — only used when
 *      L1–L6 found nothing and the page has exactly one qualifying form
 *
 * CRITICAL (TG-1 RETRO-017): this function NEVER returns an empty string.
 * When nothing is found it returns `null`. Callers must treat `null` as "no selector"
 * and omit the field from the schema entirely.
 *
 * @module @estalara/sdk/auto-detect/detect-inquiry-selector
 */

/**
 * Regex for action attribute keywords that identify inquiry/contact forms.
 * Deliberately broad to catch localised variants (enquiry, anfrage, consulta).
 */
const FORM_ACTION_RE = /inquiry|enquiry|contact|consult|anfrage|consulta|book|message/i;

/**
 * Regex for visible button text that identifies an inquiry-submit action.
 */
const BUTTON_TEXT_RE = /\b(send|submit|inquire|enquire|contact|message|request|apply|book)\b/i;

/**
 * Regex for class names associated with inquiry or contact submission.
 */
const BUTTON_CLASS_RE = /inquiry|enquiry|contact|submit|send|cta/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escape a string for use in a CSS id selector (#id).
 *
 * Uses the browser `CSS.escape()` API when available (jsdom, Chrome, Firefox).
 * Falls back to a conservative inline implementation for Node.js environments
 * that lack `CSS.escape`. Only escapes characters that would otherwise break
 * the selector — enough for common real-world id values.
 */
function cssEscapeId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  // Minimal fallback: escape any character that is not a word char, dash, or dot.
  return id.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~\s])/g, '\\$1');
}

/**
 * Return the normalized text content of an element (trimmed, collapsed whitespace).
 */
function elementText(el: Element): string {
  return el.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * Return true if the given form contains either an email input or a textarea —
 * the two most reliable signals that a <form> is a contact/inquiry form.
 */
function isInquiryForm(form: Element): boolean {
  const hasEmailInput = form.querySelector('input[type="email"], input[name*="email"]') !== null;
  const hasTextarea = form.querySelector('textarea') !== null;
  return hasEmailInput || hasTextarea;
}

/**
 * Build a stable CSS selector for a button element.
 *
 * Priority:
 *  1. data-estalara-slot attribute  →  [data-estalara-slot='<value>']
 *  2. id attribute                  →  #<id>
 *  3. type=submit + stable class    →  button.class-name[type=submit]
 *  4. type=submit only              →  button[type=submit]  (only when unambiguous)
 *
 * Never returns an empty string. Returns `null` when no stable selector is constructable.
 */
function buildButtonSelector(el: Element, doc: Document): string | null {
  // L1-priority: Estalara own marker
  const slot = el.getAttribute('data-estalara-slot');
  if (slot) return `[data-estalara-slot='${slot}']`;

  // id attribute — highly stable
  const id = el.getAttribute('id');
  if (id && id.length > 0 && !/^\d/.test(id)) {
    // id must start with a letter (CSS selector validity)
    return `#${cssEscapeId(id)}`;
  }

  // Stable class — avoid hash classes (CSS-in-JS)
  const tag = el.tagName.toLowerCase();
  for (const cls of el.classList) {
    if (/^[a-z][a-z0-9_-]{2,}$/i.test(cls) && cls.length < 40 && !/[A-Z]{3,}/.test(cls)) {
      const selector = `${tag}.${cls}`;
      // Verify uniqueness: only use this selector when it matches exactly one element
      if (doc.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }
  }

  // type=submit fallback — only when there is exactly one such button on the page
  if (el.getAttribute('type') === 'submit') {
    const allSubmitButtons = doc.querySelectorAll(`${tag}[type="submit"]`);
    if (allSubmitButtons.length === 1) {
      return `${tag}[type="submit"]`;
    }
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the CSS selector for the inquiry/contact form submit button.
 *
 * Accepts a raw HTML string (the same one passed to detection techniques 1–10).
 * Returns a CSS selector string when a reliable button is found, or `null`
 * when no inquiry submit button can be identified deterministically.
 *
 * The result is intended to be stored as `TenantSiteSchema.inquiry_submit_selector`.
 * The field MUST NOT be set to an empty string — only a non-empty string or absent.
 *
 * @param html - Raw HTML string of the page to analyse.
 * @returns CSS selector string, or null when no reliable candidate found.
 */
export function detectInquirySubmitSelector(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // ── L1: Estalara Tier 3 Native marker (confidence 1.0) ─────────────────────
  const esatalaraEl = doc.querySelector("[data-estalara-slot='inquiry-submit']");
  if (esatalaraEl) {
    return "[data-estalara-slot='inquiry-submit']";
  }

  // ── L2: data-inquiry-submit generic attr ───────────────────────────────────
  const dataAttrEl = doc.querySelector('[data-inquiry-submit]');
  if (dataAttrEl) {
    const sel = buildButtonSelector(dataAttrEl, doc);
    if (sel) return sel;
  }

  // ── L3: button[type=submit] inside a <form action*=inquiry|contact|enquiry> ─
  const allForms = doc.querySelectorAll('form');
  for (const form of allForms) {
    const action = form.getAttribute('action') ?? '';
    const formClass = form.className;
    const formId = form.getAttribute('id') ?? '';
    const formName = form.getAttribute('name') ?? '';
    const isActionMatch = FORM_ACTION_RE.test(action);
    const isAttrMatch =
      FORM_ACTION_RE.test(formClass) ||
      FORM_ACTION_RE.test(formId) ||
      FORM_ACTION_RE.test(formName);

    if ((isActionMatch || isAttrMatch) && isInquiryForm(form)) {
      const submitBtn =
        form.querySelector('button[type="submit"]') ?? form.querySelector('input[type="submit"]');
      if (submitBtn) {
        const sel = buildButtonSelector(submitBtn, doc);
        if (sel) return sel;
      }
    }
  }

  // ── L4: button text matches BUTTON_TEXT_RE inside an inquiry-context form ──
  for (const form of allForms) {
    if (!isInquiryForm(form)) continue;
    const buttons = form.querySelectorAll('button, input[type="submit"]');
    for (const btn of buttons) {
      const text = elementText(btn);
      if (BUTTON_TEXT_RE.test(text)) {
        const sel = buildButtonSelector(btn, doc);
        if (sel) return sel;
      }
    }
  }

  // ── L5: button class contains inquiry|contact keywords inside inquiry form ─
  for (const form of allForms) {
    if (!isInquiryForm(form)) continue;
    const buttons = form.querySelectorAll('button, input[type="submit"]');
    for (const btn of buttons) {
      const cls = btn.className;
      if (BUTTON_CLASS_RE.test(cls)) {
        const sel = buildButtonSelector(btn, doc);
        if (sel) return sel;
      }
    }
  }

  // ── L6: any button with text match outside a form but within a contact section
  //       (section/div whose id|class contains contact|inquiry|enquiry) ────────
  const contactSections = doc.querySelectorAll(
    '[id*="contact" i], [id*="inquiry" i], [id*="enquiry" i], ' +
      '[class*="contact" i], [class*="inquiry" i], [class*="enquiry" i]',
  );
  for (const section of contactSections) {
    const buttons = section.querySelectorAll('button, input[type="submit"]');
    for (const btn of buttons) {
      const text = elementText(btn);
      const cls = btn.className;
      if (BUTTON_TEXT_RE.test(text) || BUTTON_CLASS_RE.test(cls)) {
        const sel = buildButtonSelector(btn, doc);
        if (sel) return sel;
      }
    }
  }

  // ── L7: last resort — single inquiry form's only submit button ──────────────
  const qualifyingForms: Element[] = [];
  for (const form of allForms) {
    if (isInquiryForm(form)) qualifyingForms.push(form);
  }
  if (qualifyingForms.length === 1) {
    const form = qualifyingForms[0];
    if (!form) return null;
    const submitBtn =
      form.querySelector('button[type="submit"]') ?? form.querySelector('input[type="submit"]');
    if (submitBtn) {
      const sel = buildButtonSelector(submitBtn, doc);
      if (sel) return sel;
    }
  }

  return null;
}
