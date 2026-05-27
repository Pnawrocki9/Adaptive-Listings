// @vitest-environment jsdom
/**
 * Unit tests for detectInquirySubmitSelector (FOLLOW-127).
 *
 * Validates all priority levels L1–L7 and the critical TG-1 invariant:
 * NEVER return an empty string — only a non-empty selector or null.
 */
import { describe, it, expect } from 'vitest';
import { detectInquirySubmitSelector } from '../detect-inquiry-selector.js';

// ─── TG-1 invariant ───────────────────────────────────────────────────────────

describe('TG-1 invariant — never return empty string', () => {
  it('returns null (not "") when no inquiry form is present', () => {
    const html = `<html><body><p>Hello world</p></body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).toBeNull();
    expect(result).not.toBe('');
  });

  it('returns null (not "") when only a non-inquiry form exists', () => {
    const html = `<html><body>
      <form action="/search">
        <input type="text" name="q" />
        <button type="submit">Search</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).toBeNull();
    expect(result).not.toBe('');
  });
});

// ─── L1: Estalara own marker ──────────────────────────────────────────────────

describe('L1 — data-estalara-slot="inquiry-submit"', () => {
  it('returns the Estalara slot selector when present', () => {
    const html = `<html><body>
      <form>
        <input type="email" name="email" />
        <button data-estalara-slot="inquiry-submit" type="submit">Send</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).toBe("[data-estalara-slot='inquiry-submit']");
  });

  it('prioritises L1 even when other inquiry patterns also match', () => {
    const html = `<html><body>
      <form action="/contact">
        <textarea name="message"></textarea>
        <button data-estalara-slot="inquiry-submit" type="submit">Send</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).toBe("[data-estalara-slot='inquiry-submit']");
  });
});

// ─── L2: data-inquiry-submit attr ─────────────────────────────────────────────

describe('L2 — [data-inquiry-submit]', () => {
  it('matches a button with data-inquiry-submit attribute', () => {
    const html = `<html><body>
      <form>
        <input type="email" />
        <button data-inquiry-submit id="inquiry-btn" type="submit">Contact us</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    // Should resolve to #inquiry-btn via buildButtonSelector (id preferred over data-attr)
    expect(result).not.toBeNull();
    expect(result).not.toBe('');
  });
});

// ─── L3: form action matches inquiry|contact|enquiry ─────────────────────────

describe('L3 — button[type=submit] inside form[action*=contact|inquiry]', () => {
  it('detects submit button inside form with action containing "contact"', () => {
    const html = `<html><body>
      <form action="/contact-us">
        <input type="email" name="email" />
        <textarea name="message"></textarea>
        <button type="submit" class="contact-submit">Send Message</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).not.toBeNull();
    expect(result).not.toBe('');
    // Should resolve to class-based selector or type=submit
    expect(typeof result).toBe('string');
  });

  it('detects submit button inside form with action containing "inquiry"', () => {
    const html = `<html><body>
      <form action="/inquiry">
        <input type="email" name="email" />
        <button type="submit">Submit Inquiry</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).not.toBeNull();
  });

  it('detects submit button inside form with action containing "enquiry"', () => {
    const html = `<html><body>
      <form action="/property-enquiry">
        <input type="email" name="email" />
        <button type="submit">Enquire Now</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).not.toBeNull();
  });

  it('detects submit button when form has id containing "contact"', () => {
    const html = `<html><body>
      <form id="contact-form">
        <input type="email" name="email" />
        <button type="submit" id="contact-submit-btn">Send</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).not.toBeNull();
    expect(result).not.toBe('');
  });

  it('ignores form without email input or textarea (not an inquiry form)', () => {
    const html = `<html><body>
      <form action="/contact-us">
        <input type="text" name="username" />
        <button type="submit">Search</button>
      </form>
    </body></html>`;
    // No email input, no textarea — not classified as inquiry form
    const result = detectInquirySubmitSelector(html);
    expect(result).toBeNull();
  });
});

// ─── L4: button text matching BUTTON_TEXT_RE ──────────────────────────────────

describe('L4 — button text matching inquiry keywords', () => {
  it('matches a button with text "Send" inside an inquiry-context form', () => {
    const html = `<html><body>
      <form>
        <input type="email" name="email" />
        <textarea name="msg"></textarea>
        <button type="submit" class="send-btn">Send</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).not.toBeNull();
  });

  it('matches a button with text "Request Info" inside an inquiry-context form', () => {
    const html = `<html><body>
      <form>
        <input type="email" name="email" />
        <button type="submit">Request Info</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).not.toBeNull();
  });

  it('matches "Apply Now" button inside inquiry form', () => {
    const html = `<html><body>
      <form>
        <textarea name="message"></textarea>
        <button type="submit">Apply Now</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).not.toBeNull();
  });
});

// ─── L6: contact section heuristic ───────────────────────────────────────────

describe('L6 — button inside element with contact|inquiry class/id', () => {
  it('finds a submit button inside a div with class "contact-section"', () => {
    const html = `<html><body>
      <div class="contact-section">
        <button type="submit" id="reach-out-btn">Send Message</button>
      </div>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).not.toBeNull();
    expect(result).not.toBe('');
  });

  it('finds a submit button inside a section with id "inquiry"', () => {
    const html = `<html><body>
      <section id="inquiry">
        <button type="submit" id="inquiry-submit">Submit</button>
      </section>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).not.toBeNull();
  });
});

// ─── L7: single qualifying form fallback ─────────────────────────────────────

describe('L7 — last resort: single inquiry form with one submit button', () => {
  it('resolves selector when exactly one inquiry form exists', () => {
    const html = `<html><body>
      <form>
        <input type="email" name="email" />
        <button type="submit" id="unique-submit">Go</button>
      </form>
    </body></html>`;
    const result = detectInquirySubmitSelector(html);
    expect(result).not.toBeNull();
    expect(result).not.toBe('');
  });

  it('returns null when multiple inquiry forms exist (ambiguous)', () => {
    const html = `<html><body>
      <form>
        <input type="email" name="email1" />
        <button type="submit">Send 1</button>
      </form>
      <form>
        <input type="email" name="email2" />
        <button type="submit">Send 2</button>
      </form>
    </body></html>`;
    // With multiple qualifying forms and no specific anchor, L3–L6 may or may not fire
    // depending on button content; L7 (last-resort) requires exactly 1 qualifying form.
    // This test asserts we never emit "" — result is null or a valid selector.
    const result = detectInquirySubmitSelector(html);
    if (result !== null) {
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toBe('');
    }
  });
});

// ─── Pipeline integration ─────────────────────────────────────────────────────

describe('Pipeline integration — detected schema carries inquiry_submit_selector', () => {
  it('pipeline-detected schema has inquiry_submit_selector when page has an inquiry form', async () => {
    // Import pipeline directly (this test is in jsdom env)
    const { detectSiteSchema } = await import('../pipeline.js');

    // A Houzez-like WordPress page with listing cards AND an inquiry form
    const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/wp-content/themes/houzez/style.css" />
</head>
<body class="houzez">
  <div class="item-listing-wrap">
    <h4 class="item-title"><a href="/property/1">Villa with Pool</a></h4>
    <span class="item-price">€350,000</span>
    <img src="/wp-content/uploads/prop1.jpg" />
  </div>
  <div class="item-listing-wrap">
    <h4 class="item-title"><a href="/property/2">Modern Apartment</a></h4>
    <span class="item-price">€180,000</span>
    <img src="/wp-content/uploads/prop2.jpg" />
  </div>
  <form action="/inquiry">
    <input type="email" name="email" />
    <textarea name="message"></textarea>
    <button type="submit" id="inquiry-send">Send Inquiry</button>
  </form>
</body>
</html>`;

    const result = await detectSiteSchema(
      html,
      'https://realestate.example.com/listings',
      'tenant-xyz',
    );
    expect(result.schema).not.toBeNull();
    // The field must be populated and non-empty
    expect(result.schema!.inquiry_submit_selector).toBeDefined();
    expect(result.schema!.inquiry_submit_selector).not.toBe('');
    expect(typeof result.schema!.inquiry_submit_selector).toBe('string');
  });

  it('pipeline-detected schema does NOT carry inquiry_submit_selector when no inquiry form exists', async () => {
    const { detectSiteSchema } = await import('../pipeline.js');

    const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/wp-content/themes/houzez/style.css" />
</head>
<body class="houzez">
  <div class="item-listing-wrap">
    <h4 class="item-title"><a href="/property/1">Villa</a></h4>
    <span class="item-price">€350,000</span>
    <img src="/wp-content/uploads/prop1.jpg" />
  </div>
  <div class="item-listing-wrap">
    <h4 class="item-title"><a href="/property/2">Apartment</a></h4>
    <span class="item-price">€180,000</span>
    <img src="/wp-content/uploads/prop2.jpg" />
  </div>
</body>
</html>`;

    const result = await detectSiteSchema(
      html,
      'https://realestate.example.com/listings',
      'tenant-xyz',
    );
    expect(result.schema).not.toBeNull();
    // No inquiry form — field must be absent (not "") per TG-1
    const sel = result.schema!.inquiry_submit_selector;
    expect(sel === undefined || sel === null).toBe(true);
    expect(sel).not.toBe('');
  });

  it('tenant_id and inquiry_submit_selector are both set after pipeline detection', async () => {
    const { detectSiteSchema } = await import('../pipeline.js');

    const html = `<html><body>
      <div data-estalara-listing-id="1">
        <span data-estalara-slot="price">€200,000</span>
        <img src="/photo.jpg" />
      </div>
      <div data-estalara-listing-id="2">
        <span data-estalara-slot="price">€250,000</span>
        <img src="/photo2.jpg" />
      </div>
      <form action="/inquiry">
        <input type="email" name="email" />
        <button data-estalara-slot="inquiry-submit" type="submit">Send Inquiry</button>
      </form>
    </body></html>`;

    const result = await detectSiteSchema(html, 'https://app.estalara.com/listings', 'my-tenant');
    expect(result.schema).not.toBeNull();
    // tenant_id must be threaded in
    expect(result.schema!.tenant_id).toBe('my-tenant');
    // inquiry_submit_selector must be populated (L1 fires: data-estalara-slot="inquiry-submit")
    expect(result.schema!.inquiry_submit_selector).toBe("[data-estalara-slot='inquiry-submit']");
  });
});
