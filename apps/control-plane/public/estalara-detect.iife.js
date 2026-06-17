'use strict';
var __EStalaraDetectBundle = (() => {
  function H(e, t) {
    return Promise.resolve(ve(e, t));
  }
  function ve(e, t) {
    let r = new DOMParser().parseFromString(e, 'text/html'),
      a = r.querySelector('[data-estalara-listing-id]') !== null,
      c = r.querySelector('[data-estalara-slot]') !== null;
    if (!a && !c) return null;
    let i = [],
      n = r.querySelector('[data-estalara-slot="listing-grid"]')
        ? '[data-estalara-slot="listing-grid"]'
        : void 0,
      o = r.querySelectorAll('[data-estalara-listing-id]'),
      s = new Set();
    for (let N of o)
      for (let M of N.querySelectorAll('[data-estalara-slot]')) {
        let D = M.getAttribute('data-estalara-slot');
        D && s.add(D);
      }
    let l = {};
    (s.has('headline') &&
      (l.headline = { primary: "[data-estalara-slot='headline']", fallbacks: [], type: 'text' }),
      s.has('price') &&
        (l.price = {
          primary: "[data-estalara-slot='price']",
          fallbacks: [],
          type: 'currency',
          currency: 'EUR',
        }),
      s.has('photo') &&
        (l.image = { primary: "[data-estalara-slot='photo']", fallbacks: [], type: 'url' }),
      s.has('bedrooms') &&
        (l.bedrooms = {
          primary: "[data-estalara-slot='bedrooms']",
          fallbacks: [],
          type: 'number',
        }),
      s.has('area') &&
        (l.area = {
          primary: "[data-estalara-slot='area']",
          fallbacks: [],
          type: 'number',
          unit: 'sqm',
        }));
    let d = {
      price: {
        primary: "[data-estalara-slot='price']",
        fallbacks: [],
        type: 'currency',
        currency: 'EUR',
      },
      bedrooms: { primary: "[data-estalara-slot='bedrooms']", fallbacks: [], type: 'number' },
    };
    s.has('area') &&
      (d.area_sqm = {
        primary: "[data-estalara-slot='area']",
        fallbacks: [],
        type: 'number',
        unit: 'sqm',
      });
    let u = {},
      m = s.has('cta-live')
        ? "[data-estalara-slot='cta-live']"
        : s.has('cta')
          ? "[data-estalara-slot='cta']"
          : void 0;
    m && (u.cta_primary = { primary: m, fallbacks: [], type: 'text' });
    let f = r.querySelector('h1')?.textContent ?? '',
      b = /[€$£₴₺]\s*[\d,]+|[\d,]+\s*[€$£₴₺]/.test(f);
    b &&
      (i.push('h1 appears to contain a price value \u2014 h1_is_price set to true'),
      (u.tagline = {
        primary: '[data-estalara-slot="tagline"]',
        fallbacks: ['h1 + *', 'h1 ~ p:first-of-type'],
        type: 'text',
      }));
    let _;
    r.querySelector('body')?.hasAttribute('data-sveltekit-preload-data')
      ? (_ = 'svelte')
      : (r.querySelector('[data-next-page]') !== null || e.includes('__NEXT_DATA__')) &&
        (_ = 'nextjs');
    let h = Me(t),
      S = Z(t),
      E = S ? [`${S.origin}/**`, `${S.origin}/listings*`] : ['/**'],
      P = S ? [`${S.origin}/listing/*`, `${S.origin}/property/*`] : ['/listing/*'],
      F = { primary: "[data-estalara-slot='headline']", fallbacks: ['h1'], type: 'text' },
      L = {
        url_patterns: E,
        listing_card_selector: '[data-estalara-listing-id]',
        card_field_mappings: l,
        data_extractors_per_card: d,
        reorder_capable: !1,
      };
    n && (L.container_selector = n);
    let C = { url_patterns: P, slot_selectors: { headline: F, ...u }, data_extractors: {} };
    b && (C.h1_is_price = !0);
    let v = {
      tenant_id: 'pending',
      domain: h,
      detected_at: new Date().toISOString(),
      detection_source: 'data_estalara',
      detection_confidence: 1,
      index_schema: L,
      detail_schema: C,
      archetype_hints: [],
    };
    return (
      _ && (v.framework_hint = _),
      { schema: v, confidence: 1, technique: 'data_estalara', warnings: i }
    );
  }
  function Me(e) {
    let t = Z(e);
    return t ? t.hostname : e;
  }
  function Z(e) {
    try {
      return new URL(e);
    } catch {
      return null;
    }
  }
  var we = /[A-Z][a-zA-Z]*_[a-zA-Z]+__[a-z0-9]{4,8}/,
    $e = /-sc-[a-f0-9]{8}-\d+/,
    J = /^([A-Z][a-z]+[A-Z][a-zA-Z]+)/;
  function g(e) {
    if (!e) return null;
    let t = e.parentElement;
    return !t || t.tagName === 'BODY' || t.tagName === 'HTML' ? null : Te(t);
  }
  function Te(e) {
    let t = e.tagName.toLowerCase();
    if (e.id && !/^\d/.test(e.id)) return `${t}#${e.id}`;
    for (let r of e.attributes)
      if (r.name === 'data-testid' || r.name === 'data-cy') return `${t}[${r.name}='${r.value}']`;
    for (let r of e.classList) {
      if (we.test(r)) {
        let a = J.exec(r);
        if (a?.[1]) return `${t}[class*='${a[1]}']`;
        continue;
      }
      if ($e.test(r)) {
        let a = J.exec(r);
        if (a?.[1]) return `${t}[class*='${a[1]}']`;
        continue;
      }
      if (!(r.startsWith('_ngcontent') || r.startsWith('ng-tns'))) return `${t}.${r}`;
    }
    return t;
  }
  var Fe = new Set([
    'RealEstateListing',
    'SingleFamilyResidence',
    'Apartment',
    'Residence',
    'House',
    'LandmarkedResidence',
    'ItemList',
  ]);
  function Y(e, t) {
    return Promise.resolve(Ne(e, t));
  }
  function Ne(e, t) {
    let r = new DOMParser().parseFromString(e, 'text/html'),
      a = [];
    if (
      r.querySelector('meta[property="og:type"]')?.getAttribute('content') === 'product' &&
      r.querySelectorAll('script[type="application/ld+json"]').length === 0
    )
      return null;
    let i = r.querySelectorAll('script[type="application/ld+json"]');
    if (i.length === 0) return null;
    let p = null,
      n = !1,
      o;
    for (let A of i) {
      let B;
      try {
        B = JSON.parse(A.textContent ?? '');
      } catch {
        a.push('Failed to parse JSON-LD block \u2014 skipping');
        continue;
      }
      let z = B,
        W = z['@type'],
        G = typeof W == 'string' ? W : '';
      if (Fe.has(G)) {
        if (((p = z), G === 'ItemList')) {
          n = !0;
          let j = z.itemListElement;
          Array.isArray(j) && (o = j.length);
        }
        break;
      }
    }
    if (!p) return null;
    let s = Ie(t),
      l = X(t),
      d = l ? [`${l.origin}/**`] : ['/**'],
      u = l ? [`${l.origin}/property/*`, `${l.origin}/listing/*`] : ['/property/*'],
      m = p.offers,
      y = m?.priceCurrency ?? 'EUR',
      f = ze(y),
      b = m?.lowPrice !== void 0 ? 'offers.lowPrice' : 'offers.price',
      _ = {
        primary: 'span[itemprop="price"]',
        fallbacks: ['[class*="price"]', '[class*="Price"]'],
        json_ld_path: b,
        type: 'currency',
        currency: f,
      },
      k = {
        primary: '[itemprop="streetAddress"]',
        fallbacks: ['[itemprop="address"]', '[class*="address"]', '[class*="Address"]'],
        json_ld_path: 'address.streetAddress',
        type: 'text',
      },
      h = {
        primary: '[itemprop="description"]',
        fallbacks: ['[class*="description"]', '[class*="Description"]'],
        json_ld_path: 'description',
        type: 'text',
      },
      S = {
        primary: '[itemprop="image"]',
        fallbacks: ['img[src*="listing"]', 'img[src*="property"]'],
        json_ld_path: 'image',
        type: 'url',
      },
      E = {
        primary: '[itemprop="numberOfRooms"]',
        fallbacks: ['[class*="beds"]', '[class*="Beds"]', '[class*="bedroom"]', '[class*="rooms"]'],
        json_ld_path: 'numberOfRooms',
        type: 'number',
      },
      P = {
        primary: '[itemprop="floorSize"]',
        fallbacks: ['[class*="area"]', '[class*="size"]', '[class*="sqm"]', '[class*="floor"]'],
        json_ld_path: 'floorSize.value',
        type: 'number',
        unit: 'sqm',
      },
      F = { headline: k, price: _, image: S, bedrooms: E, area: P },
      L = { price: _, bedrooms: E, area_sqm: P },
      C = '[itemtype*="RealEstateListing"]';
    if (n) {
      let A = r.querySelector('li[itemtype], article[itemtype], div[itemtype]');
      (A && (C = `${A.tagName.toLowerCase()}[itemtype]`),
        a.push(`ItemList detected with ${o !== void 0 ? String(o) : 'unknown'} items`));
    }
    let v = {
        headline: {
          primary: 'h1[itemprop="name"]',
          fallbacks: ['h1', '[class*="title"]'],
          json_ld_path: 'name',
          type: 'text',
        },
        description: {
          primary: h.primary,
          fallbacks: h.fallbacks,
          json_ld_path: 'description',
          type: 'text',
        },
        cta_primary: {
          primary: 'a[href*="contact"]',
          fallbacks: ['button[class*="contact"]', 'a[class*="cta"]'],
          type: 'text',
        },
      },
      N = r.querySelector(C),
      M = g(N),
      D = {
        url_patterns: d,
        listing_card_selector: C,
        card_field_mappings: F,
        data_extractors_per_card: L,
        reorder_capable: !1,
      };
    return (
      o !== void 0 && (D.listing_count_expected = o),
      M !== null && (D.container_selector = M),
      {
        schema: {
          tenant_id: 'pending',
          domain: s,
          detected_at: new Date().toISOString(),
          detection_source: 'json_ld',
          detection_confidence: 0.95,
          index_schema: D,
          detail_schema: {
            url_patterns: u,
            slot_selectors: v,
            data_extractors: { address: k, description: h },
          },
          archetype_hints: [],
        },
        confidence: 0.95,
        technique: 'json_ld',
        warnings: a,
      }
    );
  }
  function ze(e) {
    return { EUR: 'EUR', USD: 'USD', GBP: 'GBP', PLN: 'PLN', AED: 'AED' }[e.toUpperCase()] ?? 'EUR';
  }
  function Ie(e) {
    let t = X(e);
    return t ? t.hostname : e;
  }
  function X(e) {
    try {
      return new URL(e);
    } catch {
      return null;
    }
  }
  var Oe = [
      {
        selector: "[data-cy='l-card']",
        source: 'data_cy',
        cardFieldMappings: {
          headline: {
            primary: "h3[data-cy='listing-item-title']",
            fallbacks: ['h3', '[data-cy*="title"]'],
            type: 'text',
          },
          price: {
            primary: "[data-cy='ad-price']",
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'PLN',
          },
          image: {
            primary: "img[data-cy='listing-item-thumb']",
            fallbacks: ['img[src*="media"]', 'img'],
            type: 'url',
          },
          bedrooms: {
            primary: "[data-testid='rooms-value']",
            fallbacks: ['[class*="rooms"]'],
            type: 'number',
          },
          area: {
            primary: "[data-testid='area-value']",
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
        dataExtractors: {
          price: {
            primary: "[data-cy='ad-price']",
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'PLN',
          },
          bedrooms: {
            primary: "[data-testid='rooms-value']",
            fallbacks: ['[class*="rooms"]'],
            type: 'number',
          },
          area_sqm: {
            primary: "[data-testid='area-value']",
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
      },
      {
        selector: "[data-testid='listing-container']",
        source: 'data_testid',
        cardFieldMappings: {
          headline: {
            primary: "h2[data-testid='listing-title']",
            fallbacks: ['h2', '[data-testid*="title"]'],
            type: 'text',
          },
          price: {
            primary: "p[data-testid='listing-price']",
            fallbacks: ['[data-testid*="price"]', '[class*="price"]'],
            type: 'currency',
            currency: 'GBP',
          },
          image: {
            primary: "img[data-testid='listing-photo']",
            fallbacks: ['img[src*="listing"]', 'img'],
            type: 'url',
          },
          bedrooms: {
            primary: "span[data-testid='beds-label']",
            fallbacks: ['[data-testid*="bed"]'],
            type: 'number',
          },
          area: {
            primary: "span[data-testid='floor-area']",
            fallbacks: ['[data-testid*="area"]'],
            type: 'number',
            unit: 'sqft',
          },
        },
        dataExtractors: {
          price: {
            primary: "p[data-testid='listing-price']",
            fallbacks: ['[data-testid*="price"]'],
            type: 'currency',
            currency: 'GBP',
          },
          bedrooms: {
            primary: "span[data-testid='beds-label']",
            fallbacks: ['[data-testid*="bed"]'],
            type: 'number',
          },
          area_sqm: {
            primary: "span[data-testid='floor-area']",
            fallbacks: ['[data-testid*="area"]'],
            type: 'number',
            unit: 'sqft',
          },
        },
      },
      {
        selector: "[data-testid='listing-card-content']",
        source: 'data_testid',
        cardFieldMappings: {
          headline: { primary: "h2[data-testid='listing-title']", fallbacks: ['h2'], type: 'text' },
          price: {
            primary: "[data-testid='listing-price']",
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'GBP',
          },
          image: { primary: "img[data-testid='listing-photo']", fallbacks: ['img'], type: 'url' },
          bedrooms: {
            primary: "span[data-testid='beds-label']",
            fallbacks: ['[data-testid*="bed"]'],
            type: 'number',
          },
        },
        dataExtractors: {
          price: {
            primary: "[data-testid='listing-price']",
            fallbacks: [],
            type: 'currency',
            currency: 'GBP',
          },
          bedrooms: { primary: "span[data-testid='beds-label']", fallbacks: [], type: 'number' },
        },
      },
      {
        selector: "[data-testid='propertyCard']",
        source: 'data_testid',
        cardFieldMappings: {
          headline: {
            primary: 'h2.propertyCard-title a',
            fallbacks: ['h2 a', '[data-testid*="title"]'],
            type: 'text',
          },
          price: {
            primary: "div[data-testid='price'] span",
            fallbacks: ["span[data-testid='price']", '[class*="price"]'],
            type: 'currency',
            currency: 'GBP',
          },
          image: {
            primary: 'img.propertyCard-img',
            fallbacks: ['img[src*="rightmove"]', 'img'],
            type: 'url',
          },
          bedrooms: {
            primary: "span[data-testid='beds']",
            fallbacks: ['[data-testid*="bed"]'],
            type: 'number',
          },
          area: {
            primary: "span[data-testid='size']",
            fallbacks: ['[data-testid*="area"]', '[data-testid*="size"]'],
            type: 'number',
            unit: 'sqft',
          },
        },
        dataExtractors: {
          price: {
            primary: "div[data-testid='price'] span",
            fallbacks: ["span[data-testid='price']"],
            type: 'currency',
            currency: 'GBP',
          },
          bedrooms: { primary: "span[data-testid='beds']", fallbacks: [], type: 'number' },
          area_sqm: {
            primary: "span[data-testid='size']",
            fallbacks: [],
            type: 'number',
            unit: 'sqft',
          },
        },
      },
      {
        selector: "[data-testid='property-card']",
        source: 'data_testid',
        cardFieldMappings: {
          headline: {
            primary: '[data-testid*="address"]',
            fallbacks: ['[data-testid*="addr"]', 'address', 'h2', 'h3', '[class*="address"]'],
            type: 'text',
          },
          price: {
            primary: "[data-testid='property-price']",
            fallbacks: [
              "span[data-testid='price']",
              "[data-testid='card-price']",
              '[data-testid*="price"]',
              '[class*="price"]',
            ],
            type: 'currency',
            currency: 'GBP',
          },
          image: {
            primary: "[data-testid='property-image']",
            fallbacks: ['[data-testid*="img"]', 'img'],
            type: 'url',
          },
          bedrooms: {
            primary: "[data-testid='beds-value']",
            fallbacks: ["[data-testid='beds']", '[data-testid*="bed"]', '[class*="beds"]'],
            type: 'number',
          },
          area: {
            primary: "[data-testid='size-value']",
            fallbacks: [
              "[data-testid='size']",
              "[data-testid='sqft']",
              '[data-testid*="sqft"]',
              '[data-testid*="size"]',
              '[data-testid*="surface"]',
              '[class*="sqft"]',
              '[class*="area"]',
            ],
            type: 'number',
            unit: 'sqft',
          },
        },
        dataExtractors: {
          price: {
            primary: "[data-testid='property-price']",
            fallbacks: [
              "span[data-testid='price']",
              "[data-testid='card-price']",
              '[data-testid*="price"]',
              '[class*="price"]',
            ],
            type: 'currency',
            currency: 'GBP',
          },
          bedrooms: {
            primary: "[data-testid='beds-value']",
            fallbacks: ["[data-testid='beds']", '[data-testid*="bed"]', '[class*="beds"]'],
            type: 'number',
          },
          area_sqm: {
            primary: "[data-testid='size-value']",
            fallbacks: [
              "[data-testid='size']",
              "[data-testid='sqft']",
              '[data-testid*="sqft"]',
              '[data-testid*="size"]',
              '[data-testid*="surface"]',
              '[class*="sqft"]',
              '[class*="area"]',
            ],
            type: 'number',
            unit: 'sqft',
          },
        },
      },
      {
        selector: "[data-cy='listing-item']",
        source: 'data_cy',
        cardFieldMappings: {
          headline: {
            primary: 'h2[class*="title"]',
            fallbacks: ['h2', '[class*="title"]'],
            type: 'text',
          },
          price: {
            primary: 'span[class*="price"]',
            fallbacks: ['[class*="Price"]'],
            type: 'currency',
            currency: 'AED',
          },
          image: {
            primary: 'img[class*="ListingImage"]',
            fallbacks: ['img[class*="Image"]', 'img'],
            type: 'url',
          },
          bedrooms: {
            primary: 'span[aria-label*="Beds"]',
            fallbacks: ['[class*="beds"]'],
            type: 'number',
          },
          area: {
            primary: 'span[aria-label*="Area"]',
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqft',
          },
        },
        dataExtractors: {
          price: {
            primary: 'span[class*="price"]',
            fallbacks: ['[class*="Price"]'],
            type: 'currency',
            currency: 'AED',
          },
          bedrooms: { primary: 'span[aria-label*="Beds"]', fallbacks: [], type: 'number' },
          area_sqm: {
            primary: 'span[aria-label*="Area"]',
            fallbacks: [],
            type: 'number',
            unit: 'sqft',
          },
        },
      },
      {
        selector: "[data-testid='l-card']",
        source: 'data_testid',
        cardFieldMappings: {
          headline: {
            primary: '[data-testid*="title"]',
            fallbacks: ['h3', 'h2', '[data-testid*="ad-card-title"]'],
            type: 'text',
          },
          price: {
            primary: "[data-testid='price']",
            fallbacks: ['[data-testid*="price"]', "[data-testid='ad-price']", '[class*="price"]'],
            type: 'currency',
            currency: 'PLN',
          },
          image: {
            primary: 'img',
            fallbacks: ['[data-testid*="photo"]', '[data-testid*="img"]'],
            type: 'url',
          },
          bedrooms: {
            primary: "[data-testid='rooms-value']",
            fallbacks: ['[data-testid*="rooms"]', '[class*="rooms"]'],
            type: 'number',
          },
          area: {
            primary: "[data-testid='surface-value']",
            fallbacks: [
              '[data-testid*="surface"]',
              "[data-testid='area-value']",
              '[data-testid*="area"]',
              '[class*="area"]',
            ],
            type: 'number',
            unit: 'sqm',
          },
        },
        dataExtractors: {
          price: {
            primary: "[data-testid='price']",
            fallbacks: ['[data-testid*="price"]', "[data-testid='ad-price']", '[class*="price"]'],
            type: 'currency',
            currency: 'PLN',
          },
          bedrooms: {
            primary: "[data-testid='rooms-value']",
            fallbacks: ['[data-testid*="rooms"]', '[class*="rooms"]'],
            type: 'number',
          },
          area_sqm: {
            primary: "[data-testid='surface-value']",
            fallbacks: [
              '[data-testid*="surface"]',
              "[data-testid='area-value']",
              '[data-testid*="area"]',
              '[class*="area"]',
            ],
            type: 'number',
            unit: 'sqm',
          },
        },
      },
    ],
    Be = 2;
  function V(e, t) {
    return Promise.resolve(We(e, t));
  }
  function We(e, t) {
    let r = new DOMParser().parseFromString(e, 'text/html'),
      a = [];
    for (let c of Oe) {
      let i = r.querySelectorAll(c.selector);
      if (i.length < Be) continue;
      let p = Ge(t),
        n = K(t),
        o = n ? [`${n.origin}/**`] : ['/**'],
        s = n ? [`${n.origin}/property/*`, `${n.origin}/listing/*`] : ['/property/*'],
        l = {
          headline: {
            primary: 'h1',
            fallbacks: ['[class*="title"]', '[class*="address"]'],
            type: 'text',
          },
          description: {
            primary: '[class*="description"]',
            fallbacks: ['p[class*="desc"]'],
            type: 'text',
          },
          cta_primary: {
            primary: 'a[href*="contact"]',
            fallbacks: ['button[class*="contact"]'],
            type: 'text',
          },
        },
        d = {
          tenant_id: 'pending',
          domain: p,
          detected_at: new Date().toISOString(),
          detection_source: c.source,
          detection_confidence: 0.92,
          index_schema: {
            url_patterns: o,
            listing_card_selector: c.selector,
            listing_count_expected: i.length,
            card_field_mappings: c.cardFieldMappings,
            data_extractors_per_card: c.dataExtractors,
            reorder_capable: !0,
            ...(() => {
              let u = g(i[0] ?? null);
              return u !== null ? { container_selector: u } : {};
            })(),
          },
          detail_schema: { url_patterns: s, slot_selectors: l, data_extractors: {} },
          archetype_hints: [],
        };
      return (
        i.length < 5 &&
          a.push(
            `Only ${String(i.length)} cards matched \u2014 page may be a detail page or paginated list`,
          ),
        { schema: d, confidence: 0.92, technique: c.source, warnings: a }
      );
    }
    return null;
  }
  function Ge(e) {
    let t = K(e);
    return t ? t.hostname : e;
  }
  function K(e) {
    try {
      return new URL(e);
    } catch {
      return null;
    }
  }
  var je = ['article.MuiPaper-root', 'div.MuiPaper-root', 'li.MuiPaper-root'],
    ee = /[€$£₴₺]|USD|EUR|GBP|AED|PLN/,
    Q = 2;
  function te(e, t) {
    return Promise.resolve(He(e, t));
  }
  function He(e, t) {
    let r = new DOMParser().parseFromString(e, 'text/html'),
      a = [],
      c = null,
      i = 0;
    for (let b of je) {
      let _ = r.querySelectorAll(b);
      if (_.length < Q) continue;
      let k = 0;
      for (let h of _) {
        let S = [...h.querySelectorAll('span')].some((P) => ee.test(P.textContent || '')),
          E = h.querySelector('img') !== null;
        S && E && k++;
      }
      if (k >= Q) {
        ((c = b), (i = k));
        break;
      }
    }
    if (!c) return null;
    let p = Ze(r, c),
      n = Xe(t),
      o = re(t),
      s = o ? [`${o.origin}/**`] : ['/**'],
      l = o ? [`${o.origin}/property/*`, `${o.origin}/properties/*`] : ['/property/*'],
      d = Ye(n),
      u = {
        headline: {
          primary: 'h2[data-testid*="address"]',
          fallbacks: ['h2', 'h3', '[class*="title"]', '[class*="address"]'],
          type: 'text',
        },
        price: {
          primary: p,
          fallbacks: ['span[class*="price"]', 'span[class*="Price"]'],
          type: 'currency',
          currency: d,
        },
        image: { primary: 'img', fallbacks: [], type: 'url' },
        bedrooms: {
          primary: 'span[data-testid*="bed"]',
          fallbacks: ['span[class*="bed"]', 'span[aria-label*="bed"]'],
          type: 'number',
        },
        area: {
          primary: 'span[data-testid*="size"]',
          fallbacks: ['span[class*="size"]', 'span[class*="area"]'],
          type: 'number',
          unit: 'sqft',
        },
      },
      m = {
        price: { primary: p, fallbacks: ['span[class*="price"]'], type: 'currency', currency: d },
        bedrooms: {
          primary: 'span[data-testid*="bed"]',
          fallbacks: ['span[class*="bed"]'],
          type: 'number',
        },
        area_sqm: {
          primary: 'span[data-testid*="size"]',
          fallbacks: ['span[class*="size"]'],
          type: 'number',
          unit: 'sqft',
        },
      },
      y = {
        headline: {
          primary: 'h1[class*="MuiTypography"]',
          fallbacks: ['h1', '.MuiTypography-h1'],
          type: 'text',
        },
        description: {
          primary: 'p[class*="MuiTypography"]',
          fallbacks: ['[class*="description"]'],
          type: 'text',
        },
        cta_primary: {
          primary: 'button[class*="MuiButton"]',
          fallbacks: ['a[class*="MuiButton"]'],
          type: 'text',
        },
      };
    return (
      i < 5 && a.push(`Only ${String(i)} qualifying MUI cards found \u2014 may be a detail page`),
      {
        schema: {
          tenant_id: 'pending',
          domain: n,
          detected_at: new Date().toISOString(),
          detection_source: 'mui',
          detection_confidence: 0.88,
          framework_hint: 'react',
          index_schema: {
            url_patterns: s,
            listing_card_selector: c,
            listing_count_expected: i,
            card_field_mappings: u,
            data_extractors_per_card: m,
            reorder_capable: !0,
            ...(() => {
              let b = g(r.querySelector(c));
              return b !== null ? { container_selector: b } : {};
            })(),
          },
          detail_schema: { url_patterns: l, slot_selectors: y, data_extractors: {} },
          archetype_hints: [],
        },
        confidence: 0.88,
        technique: 'mui',
        warnings: a,
      }
    );
  }
  function Ze(e, t) {
    let r = e.querySelector(t);
    if (!r) return 'span[class*="price"]';
    for (let a of r.querySelectorAll('span'))
      if (ee.test(a.textContent ?? '')) {
        let c = a.getAttribute('data-testid');
        if (c) return `span[data-testid='${c}']`;
        let i = Je(a.className);
        if (i) return `span[class*='${i}']`;
      }
    return 'span[class*="price"]';
  }
  function Je(e) {
    let t = e.trim().split(/\s+/);
    for (let r of t)
      if (
        !(r.startsWith('Mui') || /^[a-z0-9]{5,}$/i.test(r)) &&
        (r.toLowerCase().includes('price') || r.toLowerCase().includes('Price'))
      )
        return r;
    return null;
  }
  function Ye(e) {
    return e.endsWith('.co.uk') ||
      e.endsWith('.uk') ||
      (e.endsWith('.com') && e.includes('foxtons'))
      ? 'GBP'
      : e.endsWith('.ae') || e.includes('bayut')
        ? 'AED'
        : e.endsWith('.pl')
          ? 'PLN'
          : e.endsWith('.com')
            ? 'USD'
            : 'EUR';
  }
  function Xe(e) {
    let t = re(e);
    return t ? t.hostname : e;
  }
  function re(e) {
    try {
      return new URL(e);
    } catch {
      return null;
    }
  }
  var Ve = [
      {
        classMatch: 'item',
        selector: 'article.item',
        cardFieldMappings: {
          headline: { primary: 'a.item-link span', fallbacks: ['h3', '.item-title'], type: 'text' },
          price: {
            primary: 'span.item-price',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          image: {
            primary: 'img.item-multimedia-image',
            fallbacks: ['img[src*="idealista"]', 'img'],
            type: 'url',
          },
          bedrooms: {
            primary: 'span.item-detail[data-rooms]',
            fallbacks: ['[class*="rooms"]', '[class*="bed"]'],
            type: 'number',
          },
          area: {
            primary: 'span.item-detail[data-area]',
            fallbacks: ['[class*="area"]', '[class*="size"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
        dataExtractors: {
          price: {
            primary: 'span.item-price',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          bedrooms: {
            primary: 'span.item-detail[data-rooms]',
            fallbacks: ['[class*="rooms"]'],
            type: 'number',
          },
          area_sqm: {
            primary: 'span.item-detail[data-area]',
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
      },
      {
        classMatch: 'js-list-item',
        selector: 'article.js-list-item',
        cardFieldMappings: {
          headline: {
            primary: 'h3.list-item-title a',
            fallbacks: ['h3 a', '.list-item-title'],
            type: 'text',
          },
          price: {
            primary: 'span.item-price',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          image: { primary: 'img.item-image', fallbacks: ['img'], type: 'url' },
          bedrooms: {
            primary: 'span.item-detail-char.room',
            fallbacks: ['[class*="room"]'],
            type: 'number',
          },
          area: {
            primary: 'span.item-detail-char.surface',
            fallbacks: ['[class*="surface"]', '[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
        dataExtractors: {
          price: { primary: 'span.item-price', fallbacks: [], type: 'currency', currency: 'EUR' },
          bedrooms: { primary: 'span.item-detail-char.room', fallbacks: [], type: 'number' },
          area_sqm: {
            primary: 'span.item-detail-char.surface',
            fallbacks: [],
            type: 'number',
            unit: 'sqm',
          },
        },
      },
      {
        classMatch: 'block',
        selector: 'article.block',
        cardFieldMappings: {
          headline: {
            primary: 'h2.block-title a',
            fallbacks: ['h2 a', '.listing-title'],
            type: 'text',
          },
          price: {
            primary: 'span.price',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'GBP',
          },
          image: {
            primary: 'img.thumbnail',
            fallbacks: ['img[src*="onthemarket"]', 'img'],
            type: 'url',
          },
          bedrooms: {
            primary: 'li.bedrooms span',
            fallbacks: ['[class*="bedroom"]'],
            type: 'number',
          },
          area: {
            primary: 'li.floor-area span',
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqft',
          },
        },
        dataExtractors: {
          price: {
            primary: 'span.price',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'GBP',
          },
          bedrooms: { primary: 'li.bedrooms span', fallbacks: [], type: 'number' },
          area_sqm: { primary: 'li.floor-area span', fallbacks: [], type: 'number', unit: 'sqft' },
        },
      },
    ],
    Ke = ['property', 'listing', 'card', 'result'],
    se = /[€$£₴₺]\s*[\d,.']+|[\d,.']+\s*[€$£₴₺]|(USD|EUR|GBP|AED|PLN)\s*[\d,.']+/,
    R = 2;
  function ie(e, t) {
    return Promise.resolve(Qe(e, t));
  }
  function Qe(e, t) {
    let r = new DOMParser().parseFromString(e, 'text/html'),
      a = [],
      c = r.querySelectorAll('article');
    if (c.length < R) return null;
    let i = [];
    for (let d of c) {
      let u = se.test(d.textContent || ''),
        m = d.querySelector('img') !== null;
      u && m && i.push(d);
    }
    if (i.length < R) return null;
    let p = rt(t),
      n = ne(t),
      o = n ? [`${n.origin}/**`] : ['/**'],
      s = n ? [`${n.origin}/property/*`, `${n.origin}/listing/*`] : ['/property/*'];
    for (let d of Ve) {
      let u = i.filter((m) => m.classList.contains(d.classMatch));
      if (u.length >= R)
        return {
          schema: I(
            p,
            o,
            s,
            d.selector,
            d.cardFieldMappings,
            d.dataExtractors,
            u.length,
            u[0] ?? null,
          ),
          confidence: 0.85,
          technique: 'article_tag',
          warnings: a,
        };
    }
    for (let d of Ke) {
      let u = i.filter((y) => [...y.classList].some((f) => f.toLowerCase().includes(d))),
        m = u[0];
      if (u.length >= R && m !== void 0) {
        let y = [...m.classList].find((h) => h.toLowerCase().includes(d)),
          f = y ? `article.${y}` : 'article',
          { cardFieldMappings: b, dataExtractors: _ } = ae(m, p);
        return (
          a.push(`Generic article class match: ${f}`),
          {
            schema: I(p, o, s, f, b, _, u.length, m),
            confidence: 0.85,
            technique: 'article_tag',
            warnings: a,
          }
        );
      }
    }
    let l = i[0];
    if (i.length >= R && l !== void 0) {
      let { cardFieldMappings: d, dataExtractors: u } = ae(l, p);
      return (
        a.push('Falling back to plain article selector \u2014 no known class pattern matched'),
        {
          schema: I(p, o, s, 'article', d, u, i.length, l),
          confidence: 0.85,
          technique: 'article_tag',
          warnings: a,
        }
      );
    }
    return null;
  }
  function I(e, t, r, a, c, i, p, n) {
    let o = g(n ?? null),
      s = {
        headline: {
          primary: 'h1',
          fallbacks: ['[class*="title"]', '[class*="address"]'],
          type: 'text',
        },
        description: {
          primary: '[class*="description"]',
          fallbacks: ['[class*="desc"]', 'p'],
          type: 'text',
        },
        cta_primary: {
          primary: 'a[href*="contact"]',
          fallbacks: ['button[class*="contact"]', 'a[class*="cta"]'],
          type: 'text',
        },
      };
    return {
      tenant_id: 'pending',
      domain: e,
      detected_at: new Date().toISOString(),
      detection_source: 'article_tag',
      detection_confidence: 0.85,
      index_schema: {
        url_patterns: t,
        listing_card_selector: a,
        listing_count_expected: p,
        card_field_mappings: c,
        data_extractors_per_card: i,
        reorder_capable: !0,
        ...(o !== null ? { container_selector: o } : {}),
      },
      detail_schema: { url_patterns: r, slot_selectors: s, data_extractors: {} },
      archetype_hints: [],
    };
  }
  function ae(e, t) {
    let r = tt(t),
      a = 'span[class*="price"]';
    for (let p of e.querySelectorAll('span, p, div'))
      if (se.test(p.textContent || '')) {
        let n = et(p);
        if (n) {
          a = n;
          break;
        }
      }
    return {
      cardFieldMappings: {
        headline: {
          primary: 'h2 a',
          fallbacks: ['h3 a', 'h2', 'h3', '[class*="title"]'],
          type: 'text',
        },
        price: {
          primary: a,
          fallbacks: ['[class*="price"]', '[class*="Price"]'],
          type: 'currency',
          currency: r,
        },
        image: { primary: 'img', fallbacks: [], type: 'url' },
        bedrooms: { primary: '[class*="bed"]', fallbacks: ['[class*="room"]'], type: 'number' },
      },
      dataExtractors: {
        price: { primary: a, fallbacks: ['[class*="price"]'], type: 'currency', currency: r },
        bedrooms: { primary: '[class*="bed"]', fallbacks: ['[class*="room"]'], type: 'number' },
      },
    };
  }
  function et(e) {
    let t = e.tagName.toLowerCase();
    for (let r of e.classList) if (/^[a-z][a-z-]+$/i.test(r) && r.length < 30) return `${t}.${r}`;
    return null;
  }
  function tt(e) {
    return e.endsWith('.co.uk') || e.endsWith('.uk')
      ? 'GBP'
      : e.endsWith('.pl')
        ? 'PLN'
        : e.endsWith('.ae')
          ? 'AED'
          : e.endsWith('.com')
            ? 'USD'
            : 'EUR';
  }
  function rt(e) {
    let t = ne(e);
    return t ? t.hostname : e;
  }
  function ne(e) {
    try {
      return new URL(e);
    } catch {
      return null;
    }
  }
  var at = /^[A-Z][a-zA-Z]+_[a-zA-Z]+__[a-zA-Z0-9]{4,8}$/,
    st = [
      {
        prefix: 'PropertyCard_',
        cardFieldMappings: {
          headline: {
            primary: "h2[class*='PropertyCard_']",
            fallbacks: ['h2', '[class*="propertyCard-title"]'],
            partial_match: 'PropertyCard_',
            type: 'text',
          },
          price: {
            primary: "[class*='PropertyCard_price']",
            fallbacks: ["[data-testid='price'] span", '[class*="price"]'],
            partial_match: 'PropertyCard_price',
            type: 'currency',
            currency: 'GBP',
          },
          image: {
            primary: "img[class*='PropertyCard_']",
            fallbacks: ['img'],
            partial_match: 'PropertyCard_',
            type: 'url',
          },
          bedrooms: {
            primary: "[class*='PropertyCard_beds']",
            fallbacks: ["span[data-testid='beds']"],
            partial_match: 'PropertyCard_beds',
            type: 'number',
          },
        },
        dataExtractors: {
          price: {
            primary: "[class*='PropertyCard_price']",
            fallbacks: ["[data-testid='price'] span"],
            partial_match: 'PropertyCard_price',
            type: 'currency',
            currency: 'GBP',
          },
          bedrooms: {
            primary: "[class*='PropertyCard_beds']",
            fallbacks: ["span[data-testid='beds']"],
            partial_match: 'PropertyCard_beds',
            type: 'number',
          },
          area_sqm: {
            primary: "[class*='PropertyCard_size']",
            fallbacks: ["span[data-testid='size']"],
            partial_match: 'PropertyCard_size',
            type: 'number',
            unit: 'sqft',
          },
        },
        framework: 'react',
      },
      {
        prefix: 'HomeCard_',
        cardFieldMappings: {
          headline: {
            primary: "[class*='homeAddress']",
            fallbacks: ['[class*="HomeCard_address"]', 'address'],
            partial_match: 'homeAddress',
            type: 'text',
          },
          price: {
            primary: "[class*='homecardV2Price']",
            fallbacks: ['[class*="HomeCard_price"]', '[class*="price"]'],
            partial_match: 'homecardV2Price',
            type: 'currency',
            currency: 'USD',
          },
          image: {
            primary: "[class*='homeImage']",
            fallbacks: ['img[class*="HomeCard"]', 'img'],
            partial_match: 'homeImage',
            type: 'url',
          },
          bedrooms: {
            primary: "[class*='beds']",
            fallbacks: ['[class*="HomeCard_beds"]'],
            partial_match: 'beds',
            type: 'number',
          },
          area: {
            primary: "[class*='sqft']",
            fallbacks: ['[class*="HomeCard_sqft"]'],
            partial_match: 'sqft',
            type: 'number',
            unit: 'sqft',
          },
        },
        dataExtractors: {
          price: {
            primary: "[class*='homecardV2Price']",
            fallbacks: ['[class*="price"]'],
            partial_match: 'homecardV2Price',
            type: 'currency',
            currency: 'USD',
          },
          bedrooms: {
            primary: "[class*='beds']",
            fallbacks: [],
            partial_match: 'beds',
            type: 'number',
          },
          area_sqm: {
            primary: "[class*='sqft']",
            fallbacks: [],
            partial_match: 'sqft',
            type: 'number',
            unit: 'sqft',
          },
        },
        framework: 'nextjs',
      },
      {
        prefix: 'Listings_',
        cardFieldMappings: {
          headline: {
            primary: "[class*='Listings_title']",
            fallbacks: ['h2', 'h3'],
            partial_match: 'Listings_title',
            type: 'text',
          },
          price: {
            primary: "[class*='Listings_price']",
            fallbacks: ['[class*="price"]'],
            partial_match: 'Listings_price',
            type: 'currency',
            currency: 'EUR',
          },
          image: {
            primary: "[class*='Listings_image']",
            fallbacks: ['img'],
            partial_match: 'Listings_image',
            type: 'url',
          },
          bedrooms: {
            primary: "[class*='Listings_beds']",
            fallbacks: ['[class*="beds"]'],
            partial_match: 'Listings_beds',
            type: 'number',
          },
        },
        dataExtractors: {
          price: {
            primary: "[class*='Listings_price']",
            fallbacks: [],
            partial_match: 'Listings_price',
            type: 'currency',
            currency: 'EUR',
          },
          bedrooms: {
            primary: "[class*='Listings_beds']",
            fallbacks: [],
            partial_match: 'Listings_beds',
            type: 'number',
          },
        },
      },
      {
        prefix: 'listing-card_',
        cardFieldMappings: {
          headline: {
            primary: "[class*='listing-card_title']",
            fallbacks: ['h2', 'h3'],
            partial_match: 'listing-card_title',
            type: 'text',
          },
          price: {
            primary: "[class*='listing-card_price']",
            fallbacks: ['[class*="price"]'],
            partial_match: 'listing-card_price',
            type: 'currency',
            currency: 'EUR',
          },
          image: {
            primary: "[class*='listing-card_image']",
            fallbacks: ['img'],
            partial_match: 'listing-card_image',
            type: 'url',
          },
          bedrooms: {
            primary: "[class*='listing-card_beds']",
            fallbacks: ['[class*="beds"]'],
            partial_match: 'listing-card_beds',
            type: 'number',
          },
        },
        dataExtractors: {
          price: {
            primary: "[class*='listing-card_price']",
            fallbacks: [],
            partial_match: 'listing-card_price',
            type: 'currency',
            currency: 'EUR',
          },
          bedrooms: {
            primary: "[class*='listing-card_beds']",
            fallbacks: [],
            partial_match: 'listing-card_beds',
            type: 'number',
          },
        },
      },
    ],
    ce = 2;
  function pe(e, t) {
    return Promise.resolve(it(e, t));
  }
  function it(e, t) {
    let r = new DOMParser().parseFromString(e, 'text/html'),
      a = [],
      c = new Set();
    for (let s of r.querySelectorAll('[class]'))
      for (let l of s.classList)
        if (at.test(l) && l.lastIndexOf('__') > 0) {
          let u = l.slice(0, l.indexOf('_') + 1);
          u && c.add(u);
        }
    if (c.size === 0) return null;
    let i = ct(t),
      p = de(t),
      n = p ? [`${p.origin}/**`] : ['/**'],
      o = p ? [`${p.origin}/property/*`, `${p.origin}/listing/*`] : ['/property/*'];
    for (let s of st) {
      if (!c.has(s.prefix)) continue;
      let l = le(r, s.prefix);
      if (!l) {
        a.push(`Prefix ${s.prefix} found but could not derive card selector`);
        continue;
      }
      let d = r.querySelectorAll(l);
      if (d.length < ce) {
        a.push(`Prefix ${s.prefix}: only ${String(d.length)} cards matched '${l}'`);
        continue;
      }
      let u = {
        tenant_id: 'pending',
        domain: i,
        detected_at: new Date().toISOString(),
        detection_source: 'css_modules',
        detection_confidence: 0.82,
        index_schema: {
          url_patterns: n,
          listing_card_selector: l,
          listing_count_expected: d.length,
          card_field_mappings: s.cardFieldMappings,
          data_extractors_per_card: s.dataExtractors,
          reorder_capable: !1,
          ...(() => {
            let m = g(d[0] ?? null);
            return m !== null ? { container_selector: m } : {};
          })(),
        },
        detail_schema: { url_patterns: o, slot_selectors: oe(s.prefix), data_extractors: {} },
        archetype_hints: [],
      };
      return (
        s.framework && (u.framework_hint = s.framework),
        { schema: u, confidence: 0.82, technique: 'css_modules', warnings: a }
      );
    }
    for (let s of c) {
      let l = le(r, s);
      if (!l) continue;
      let d = r.querySelectorAll(l);
      if (d.length < ce) continue;
      a.push(`Unknown CSS Modules prefix '${s}' \u2014 generic schema generated`);
      let u = nt(i),
        m = {
          headline: {
            primary: `[class*='${s}title'], [class*='${s}Title']`,
            fallbacks: ['h2', 'h3'],
            partial_match: `${s}title`,
            type: 'text',
          },
          price: {
            primary: `[class*='${s}price'], [class*='${s}Price']`,
            fallbacks: ['[class*="price"]'],
            partial_match: `${s}price`,
            type: 'currency',
            currency: u,
          },
          image: { primary: 'img', fallbacks: [], type: 'url' },
          bedrooms: {
            primary: `[class*='${s}beds'], [class*='${s}Beds']`,
            fallbacks: ['[class*="bed"]'],
            partial_match: `${s}beds`,
            type: 'number',
          },
        },
        y = {
          price: {
            primary: `[class*='${s}price'], [class*='${s}Price']`,
            fallbacks: [],
            partial_match: `${s}price`,
            type: 'currency',
            currency: u,
          },
          bedrooms: {
            primary: `[class*='${s}beds'], [class*='${s}Beds']`,
            fallbacks: [],
            partial_match: `${s}beds`,
            type: 'number',
          },
        };
      return {
        schema: {
          tenant_id: 'pending',
          domain: i,
          detected_at: new Date().toISOString(),
          detection_source: 'css_modules',
          detection_confidence: 0.82,
          index_schema: {
            url_patterns: n,
            listing_card_selector: l,
            listing_count_expected: d.length,
            card_field_mappings: m,
            data_extractors_per_card: y,
            reorder_capable: !1,
            ...(() => {
              let b = g(d[0] ?? null);
              return b !== null ? { container_selector: b } : {};
            })(),
          },
          detail_schema: { url_patterns: o, slot_selectors: oe(s), data_extractors: {} },
          archetype_hints: [],
        },
        confidence: 0.82,
        technique: 'css_modules',
        warnings: a,
      };
    }
    return null;
  }
  function le(e, t) {
    let r = t.toLowerCase();
    for (let a of e.querySelectorAll(`[class*='${t}']`)) {
      if (![...a.classList].join(' ').toLowerCase().includes(r)) continue;
      let i = t.endsWith('_') ? t.slice(0, -1) : t,
        p = a.tagName.toLowerCase();
      return [...a.classList].find(
        (o) => o.startsWith(t) && /card|item|listing|property|result/i.test(o.slice(t.length)),
      )
        ? `${p}[class*='${t}']`
        : `[class*='${i}']`;
    }
    return null;
  }
  function oe(e) {
    return {
      headline: {
        primary: `[class*='${e}title'], h1`,
        fallbacks: ['h1', '[class*="title"]'],
        partial_match: `${e}title`,
        type: 'text',
      },
      description: {
        primary: `[class*='${e}description'], [class*='${e}desc']`,
        fallbacks: ['[class*="description"]', 'p'],
        partial_match: `${e}description`,
        type: 'text',
      },
      cta_primary: {
        primary: `[class*='${e}cta'], [class*='${e}button']`,
        fallbacks: ['a[href*="contact"]', 'button'],
        partial_match: `${e}cta`,
        type: 'text',
      },
    };
  }
  function nt(e) {
    return e.endsWith('.co.uk') || e.endsWith('.uk')
      ? 'GBP'
      : e.endsWith('.pl')
        ? 'PLN'
        : e.endsWith('.ae')
          ? 'AED'
          : e.endsWith('.com')
            ? 'USD'
            : 'EUR';
  }
  function ct(e) {
    let t = de(e);
    return t ? t.hostname : e;
  }
  function de(e) {
    try {
      return new URL(e);
    } catch {
      return null;
    }
  }
  var lt = /^([A-Z][a-zA-Z]+)-sc-[a-f0-9]{8}-\d+$/,
    ot = /^([A-Z][a-z]+[A-Z][a-zA-Z]+)(?:-|$)/,
    ue = 2,
    pt = /[€$£₴₺]|USD|EUR|GBP|AED|PLN/;
  function me(e, t) {
    return Promise.resolve(dt(e, t));
  }
  function dt(e, t) {
    let r = new DOMParser().parseFromString(e, 'text/html'),
      a = [],
      c = new Map();
    for (let l of r.querySelectorAll('[class]'))
      for (let d of l.classList) {
        let u = ut(d);
        u && c.set(u, (c.get(u) ?? 0) + 1);
      }
    if (c.size === 0) return null;
    let i = [...c.entries()].sort((l, d) => d[1] - l[1]),
      p = yt(t),
      n = ye(t),
      o = n ? [`${n.origin}/**`] : ['/**'],
      s = n ? [`${n.origin}/property/*`, `${n.origin}/listing/*`] : ['/property/*'];
    for (let [l] of i) {
      let d = `[class*='${l}']`,
        u = r.querySelectorAll(d);
      if (u.length < ue) continue;
      let m = 0;
      for (let h of u) {
        let S = pt.test(h.textContent || ''),
          E = h.querySelector('img') !== null;
        S && E && m++;
      }
      if (m < ue) continue;
      a.push(`CSS-in-JS stable selector: ${d} \u2014 volatile hash classes excluded from selector`);
      let y = mt(p),
        f = {
          headline: {
            primary: `h2[class*='${l}'], h3[class*='${l}']`,
            fallbacks: ['h2', 'h3', '[class*="title"]'],
            partial_match: l,
            type: 'text',
          },
          price: {
            primary: `[class*='${l}'][class*='price'], [class*='price']`,
            fallbacks: ['span[class*="price"]', 'div[class*="price"]'],
            partial_match: l,
            type: 'currency',
            currency: y,
          },
          image: {
            primary: `img[class*='${l}'], img`,
            fallbacks: ['img'],
            partial_match: l,
            type: 'url',
          },
          bedrooms: {
            primary: `[class*='${l}'][class*='room'], [class*='${l}'][class*='bed']`,
            fallbacks: ['[class*="rooms"]', '[class*="beds"]'],
            partial_match: l,
            type: 'number',
          },
          area: {
            primary: `[class*='${l}'][class*='area'], [class*='${l}'][class*='size']`,
            fallbacks: ['[class*="area"]'],
            partial_match: l,
            type: 'number',
            unit: 'sqm',
          },
        },
        b = {
          price: {
            primary: `[class*='${l}'][class*='price'], [class*='price']`,
            fallbacks: ['span[class*="price"]'],
            partial_match: l,
            type: 'currency',
            currency: y,
          },
          bedrooms: {
            primary: `[class*='${l}'][class*='room'], [class*='${l}'][class*='bed']`,
            fallbacks: ['[class*="rooms"]'],
            partial_match: l,
            type: 'number',
          },
          area_sqm: {
            primary: `[class*='${l}'][class*='area']`,
            fallbacks: ['[class*="area"]'],
            partial_match: l,
            type: 'number',
            unit: 'sqm',
          },
        },
        _ = {
          headline: {
            primary: 'h1',
            fallbacks: ['[class*="title"]', '[class*="address"]'],
            type: 'text',
          },
          description: {
            primary: '[class*="description"]',
            fallbacks: ['[class*="desc"]', 'p'],
            type: 'text',
          },
          cta_primary: {
            primary: 'a[href*="contact"]',
            fallbacks: ['button[class*="contact"]'],
            type: 'text',
          },
        };
      return {
        schema: {
          tenant_id: 'pending',
          domain: p,
          detected_at: new Date().toISOString(),
          detection_source: 'css_in_js',
          detection_confidence: 0.75,
          framework_hint: 'react',
          index_schema: {
            url_patterns: o,
            listing_card_selector: d,
            listing_count_expected: m,
            card_field_mappings: f,
            data_extractors_per_card: b,
            reorder_capable: !1,
            ...(() => {
              let h = g(r.querySelector(d));
              return h !== null ? { container_selector: h } : {};
            })(),
          },
          detail_schema: { url_patterns: s, slot_selectors: _, data_extractors: {} },
          archetype_hints: [],
        },
        confidence: 0.75,
        technique: 'css_in_js',
        warnings: a,
      };
    }
    return null;
  }
  function ut(e) {
    let r = lt.exec(e)?.[1];
    if (r) return r;
    let c = ot.exec(e)?.[1];
    return c || null;
  }
  function mt(e) {
    return e.endsWith('.co.uk') || e.endsWith('.uk')
      ? 'GBP'
      : e.endsWith('.pl')
        ? 'PLN'
        : e.endsWith('.ae')
          ? 'AED'
          : e.endsWith('.com')
            ? 'USD'
            : 'EUR';
  }
  function yt(e) {
    let t = ye(e);
    return t ? t.hostname : e;
  }
  function ye(e) {
    try {
      return new URL(e);
    } catch {
      return null;
    }
  }
  var ft = [
      'PropertyCard',
      'property-card',
      'ListingCard',
      'listing-card',
      'PropertyItem',
      'property-item',
      'ListingItem',
      'listing-item',
      'property',
      'listing',
      'card',
      'result',
    ],
    fe = /[€$£₴₺]|USD|EUR|GBP|AED|PLN|\d[\d,.']{3,}/,
    O = 2;
  function be(e, t) {
    return Promise.resolve(gt(e, t));
  }
  function gt(e, t) {
    let r = new DOMParser().parseFromString(e, 'text/html'),
      a = [];
    if (!bt(r)) return null;
    a.push('Angular app detected \u2014 _ngcontent-* and ng-tns-* attributes ignored');
    let c = _t(t),
      i = he(t),
      p = i ? [`${i.origin}/**`] : ['/**'],
      n = i ? [`${i.origin}/property/*`, `${i.origin}/properties/*`] : ['/property/*'],
      o = ht(c);
    for (let u of ft) {
      let m = `[class*='${u}']`,
        y = r.querySelectorAll(m);
      if (y.length < O) continue;
      let f = 0;
      for (let _ of y) {
        let k = fe.test(_.textContent || ''),
          h = _.querySelector('img') !== null;
        k && h && f++;
      }
      if (f < O) continue;
      return {
        schema: ge(c, p, n, m, u, o, f, y[0] ?? null),
        confidence: 0.7,
        technique: 'angular',
        warnings: a,
      };
    }
    let s = 'div:has(img):has([class*="price"])',
      l = (() => {
        try {
          return r.querySelectorAll(s);
        } catch {
          return [];
        }
      })(),
      d = [...l].filter((u) => fe.test(u.textContent || '')).length;
    return d >= O
      ? (a.push('Angular structural fallback used: div:has(img):has([class*="price"])'),
        {
          schema: ge(c, p, n, s, 'price', o, d, l[0] ?? null),
          confidence: 0.7,
          technique: 'angular',
          warnings: a,
        })
      : (a.push('Angular detected but no stable listing card pattern found'), null);
  }
  function bt(e) {
    let t = e.createTreeWalker(e.documentElement, 1),
      r = t.nextNode();
    for (; r; ) {
      let i = r.attributes;
      for (let p = 0; p < i.length; p++) {
        let n = i.item(p)?.name;
        if (n?.startsWith('_nghost-') || n?.startsWith('_ngcontent-')) return !0;
      }
      r = t.nextNode();
    }
    return !!(
      e.querySelector('app-root') ||
      e
        .querySelector('meta[name="generator"]')
        ?.getAttribute('content')
        ?.toLowerCase()
        .includes('angular') ||
      e.querySelector('meta[name="ng-version"]')
    );
  }
  function ge(e, t, r, a, c, i, p, n) {
    let o = g(n ?? null),
      s = {
        headline: {
          primary: `h2[class*='${c}'], h3[class*='${c}']`,
          fallbacks: ['h2', 'h3', '[class*="address"]', '[class*="title"]'],
          partial_match: c,
          type: 'text',
        },
        price: {
          primary: "span[class*='price'], div[class*='price']",
          fallbacks: ['[class*="Price"]'],
          type: 'currency',
          currency: i,
        },
        image: { primary: 'img', fallbacks: [], type: 'url' },
        bedrooms: {
          primary: "span[class*='bedrooms'], span[class*='beds']",
          fallbacks: ['[class*="room"]'],
          type: 'number',
        },
        area: {
          primary: "span[class*='area'], span[class*='size']",
          fallbacks: ['[class*="floor"]'],
          type: 'number',
          unit: 'sqft',
        },
      },
      l = {
        price: {
          primary: "span[class*='price'], div[class*='price']",
          fallbacks: ['[class*="Price"]'],
          type: 'currency',
          currency: i,
        },
        bedrooms: {
          primary: "span[class*='bedrooms'], span[class*='beds']",
          fallbacks: ['[class*="room"]'],
          type: 'number',
        },
        area_sqm: {
          primary: "span[class*='area']",
          fallbacks: ['[class*="size"]'],
          type: 'number',
          unit: 'sqft',
        },
      },
      d = {
        headline: {
          primary: 'h1',
          fallbacks: ['[class*="title"]', '[class*="address"]'],
          type: 'text',
        },
        description: { primary: '[class*="description"]', fallbacks: ['p'], type: 'text' },
        cta_primary: {
          primary: 'a[href*="contact"]',
          fallbacks: ['button[class*="contact"]'],
          type: 'text',
        },
      };
    return {
      tenant_id: 'pending',
      domain: e,
      detected_at: new Date().toISOString(),
      detection_source: 'angular',
      detection_confidence: 0.7,
      framework_hint: 'angular',
      index_schema: {
        url_patterns: t,
        listing_card_selector: a,
        listing_count_expected: p,
        card_field_mappings: s,
        data_extractors_per_card: l,
        reorder_capable: !0,
        ...(o !== null ? { container_selector: o } : {}),
      },
      detail_schema: { url_patterns: r, slot_selectors: d, data_extractors: {} },
      archetype_hints: [],
    };
  }
  function ht(e) {
    return e.endsWith('.co.uk') || e.endsWith('.uk')
      ? 'GBP'
      : e.endsWith('.pl')
        ? 'PLN'
        : e.endsWith('.ae')
          ? 'AED'
          : e.endsWith('.com')
            ? 'USD'
            : 'EUR';
  }
  function _t(e) {
    let t = he(e);
    return t ? t.hostname : e;
  }
  function he(e) {
    try {
      return new URL(e);
    } catch {
      return null;
    }
  }
  var _e = 2,
    St = [
      {
        name: 'houzez',
        cardSelector: 'div.item-listing-wrap',
        confidence: 0.92,
        cardFieldMappings: {
          headline: {
            primary: 'h4.item-title a',
            fallbacks: ['h4 a', '.item-title', 'h3 a'],
            type: 'text',
          },
          price: {
            primary: 'span.item-price',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          image: {
            primary: 'img.wp-post-image',
            fallbacks: ['img[class*="attachment"]', 'img'],
            type: 'url',
          },
          bedrooms: {
            primary: 'li.houzez-beds strong',
            fallbacks: ['[class*="houzez-bed"]', '[class*="beds"]'],
            type: 'number',
          },
          area: {
            primary: 'li.houzez-property-size strong',
            fallbacks: ['[class*="houzez-size"]', '[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
        dataExtractors: {
          price: {
            primary: 'span.item-price',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          bedrooms: {
            primary: 'li.houzez-beds strong',
            fallbacks: ['[class*="beds"]'],
            type: 'number',
          },
          area_sqm: {
            primary: 'li.houzez-property-size strong',
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
      },
      {
        name: 'realhomes',
        cardSelector: 'article.property',
        confidence: 0.88,
        cardFieldMappings: {
          headline: {
            primary: 'h3.rh_prop_card__title a',
            fallbacks: ['h3 a', '.property-title', 'h2 a'],
            type: 'text',
          },
          price: {
            primary: 'span.rh_prop_card__price',
            fallbacks: ['[class*="rh_prop_card__price"]', '[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          image: {
            primary: 'img.rh_prop_card__image',
            fallbacks: ['img[class*="prop-img"]', 'img'],
            type: 'url',
          },
          bedrooms: {
            primary: 'li.rh_prop_card__meta_beds span',
            fallbacks: ['[class*="beds"]'],
            type: 'number',
          },
          area: {
            primary: 'li.rh_prop_card__meta_area span',
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
        dataExtractors: {
          price: {
            primary: 'span.rh_prop_card__price',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          bedrooms: {
            primary: 'li.rh_prop_card__meta_beds span',
            fallbacks: ['[class*="beds"]'],
            type: 'number',
          },
          area_sqm: {
            primary: 'li.rh_prop_card__meta_area span',
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
      },
      {
        name: 'wp_residence',
        cardSelector: 'article.property-item',
        confidence: 0.88,
        cardFieldMappings: {
          headline: {
            primary: 'h5.title_listing a',
            fallbacks: ['h5 a', '.property-title', 'h4 a'],
            type: 'text',
          },
          price: {
            primary: 'div.listing_unit_price_wrapper span',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          image: { primary: 'img.wp-post-image', fallbacks: ['img'], type: 'url' },
          bedrooms: {
            primary: 'div.listing_unit_value[data-type="bedrooms"]',
            fallbacks: ['[class*="beds"]'],
            type: 'number',
          },
          area: {
            primary: 'div.listing_unit_value[data-type="sqft"]',
            fallbacks: ['[class*="area"]', '[class*="size"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
        dataExtractors: {
          price: {
            primary: 'div.listing_unit_price_wrapper span',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          bedrooms: {
            primary: 'div.listing_unit_value[data-type="bedrooms"]',
            fallbacks: ['[class*="beds"]'],
            type: 'number',
          },
          area_sqm: {
            primary: 'div.listing_unit_value[data-type="sqft"]',
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
      },
    ],
    kt = [
      'article.property',
      'div.property-item',
      'li.listing',
      'div.listing-item',
      'article.listing',
    ];
  function ke(e, t) {
    return Promise.resolve(xt(e, t));
  }
  function xt(e, t) {
    let r = new DOMParser().parseFromString(e, 'text/html'),
      a = [];
    if (!Et(r)) return null;
    a.push('WordPress detected');
    let c = qt(t),
      i = xe(t),
      p = i ? [`${i.origin}/**`] : ['/**'],
      n = i ? [`${i.origin}/property/*`, `${i.origin}/listing/*`] : ['/property/*'],
      o = Pt(r);
    o && a.push(`WordPress theme detected: ${o}`);
    let s = o ? St.find((l) => l.name === o) : null;
    if (s) {
      let l = r.querySelectorAll(s.cardSelector);
      if (l.length >= _e)
        return {
          schema: Se(
            c,
            p,
            n,
            s.cardSelector,
            s.cardFieldMappings,
            s.dataExtractors,
            l.length,
            s.confidence,
            l[0] ?? null,
          ),
          confidence: s.confidence,
          technique: 'wordpress',
          warnings: a,
        };
      a.push(
        `Theme ${String(o)} detected but only ${String(r.querySelectorAll(s.cardSelector).length)} cards matched '${s.cardSelector}'`,
      );
    }
    for (let l of kt) {
      let d = r.querySelectorAll(l);
      if (d.length >= _e) {
        a.push(`Generic WordPress selector used: ${l}`);
        let u = Dt(c),
          { cardFieldMappings: m, dataExtractors: y } = Ct(u);
        return {
          schema: Se(c, p, n, l, m, y, d.length, 0.8, d[0] ?? null),
          confidence: 0.8,
          technique: 'wordpress',
          warnings: a,
        };
      }
    }
    return (a.push('WordPress detected but no listing card pattern found'), null);
  }
  function Et(e) {
    if (
      e
        .querySelector('meta[name="generator"]')
        ?.getAttribute('content')
        ?.toLowerCase()
        .startsWith('wordpress')
    )
      return !0;
    let r = e.querySelectorAll('link[href], script[src]');
    for (let c of r) {
      let i = c.getAttribute('href') ?? c.getAttribute('src') ?? '';
      if (i.includes('wp-content/themes/') || i.includes('wp-content/plugins/')) return !0;
    }
    let a = e.body;
    return !!(
      a.classList.contains('wp-custom-logo') ||
      a.classList.contains('wordpress') ||
      a.classList.contains('houzez') ||
      a.classList.contains('real-homes') ||
      a.classList.contains('residence-page')
    );
  }
  function Pt(e) {
    return e.body.classList.contains('houzez') ||
      e.querySelector('div.houzez-card') !== null ||
      U(e, 'houzez')
      ? 'houzez'
      : e.body.classList.contains('real-homes') ||
          e.querySelector('div.property-item.rh_list_card') !== null ||
          U(e, 'realhomes') ||
          U(e, 'real-homes')
        ? 'realhomes'
        : e.body.classList.contains('residence-page') ||
            e.querySelector('div.property_listing') !== null ||
            U(e, 'WpResidence') ||
            U(e, 'wp-residence')
          ? 'wp_residence'
          : null;
  }
  function U(e, t) {
    for (let r of e.querySelectorAll('link[href]'))
      if (r.getAttribute('href')?.includes(t)) return !0;
    return !1;
  }
  function Ct(e) {
    return {
      cardFieldMappings: {
        headline: {
          primary: 'h2 a, h3 a, h4 a',
          fallbacks: ['h2', 'h3', '[class*="title"]'],
          type: 'text',
        },
        price: {
          primary: 'span[class*="price"], div[class*="price"]',
          fallbacks: ['[class*="Price"]'],
          type: 'currency',
          currency: e,
        },
        image: {
          primary: 'img.wp-post-image',
          fallbacks: ['img[class*="attachment"]', 'img'],
          type: 'url',
        },
        bedrooms: {
          primary: '[class*="beds"], [class*="bedrooms"]',
          fallbacks: ['[class*="room"]'],
          type: 'number',
        },
        area: {
          primary: '[class*="area"], [class*="size"]',
          fallbacks: [],
          type: 'number',
          unit: 'sqm',
        },
      },
      dataExtractors: {
        price: {
          primary: 'span[class*="price"], div[class*="price"]',
          fallbacks: [],
          type: 'currency',
          currency: e,
        },
        bedrooms: { primary: '[class*="beds"]', fallbacks: ['[class*="room"]'], type: 'number' },
        area_sqm: {
          primary: '[class*="area"]',
          fallbacks: ['[class*="size"]'],
          type: 'number',
          unit: 'sqm',
        },
      },
    };
  }
  function Se(e, t, r, a, c, i, p, n, o) {
    let s = g(o ?? null),
      l = {
        headline: { primary: 'h1.entry-title, h1', fallbacks: ['[class*="title"]'], type: 'text' },
        description: {
          primary: 'div.entry-content, div[class*="description"]',
          fallbacks: ['[class*="desc"]', 'p'],
          type: 'text',
        },
        cta_primary: {
          primary: 'a[href*="contact"]',
          fallbacks: ['button[class*="contact"]', '.contact-btn'],
          type: 'text',
        },
      };
    return {
      tenant_id: 'pending',
      domain: e,
      detected_at: new Date().toISOString(),
      detection_source: 'wordpress',
      detection_confidence: n,
      framework_hint: 'wordpress',
      index_schema: {
        url_patterns: t,
        listing_card_selector: a,
        listing_count_expected: p,
        card_field_mappings: c,
        data_extractors_per_card: i,
        reorder_capable: !0,
        ...(s !== null ? { container_selector: s } : {}),
      },
      detail_schema: { url_patterns: r, slot_selectors: l, data_extractors: {} },
      archetype_hints: [],
    };
  }
  function Dt(e) {
    return e.endsWith('.co.uk') || e.endsWith('.uk')
      ? 'GBP'
      : e.endsWith('.pl')
        ? 'PLN'
        : e.endsWith('.ae')
          ? 'AED'
          : e.endsWith('.com')
            ? 'USD'
            : 'EUR';
  }
  function qt(e) {
    let t = xe(e);
    return t ? t.hostname : e;
  }
  function xe(e) {
    try {
      return new URL(e);
    } catch {
      return null;
    }
  }
  var Ee = 2,
    At = 3,
    Rt = [
      {
        id: 'bazaraki',
        cardSelector: 'div.advert',
        dotThousands: !0,
        currency: 'EUR',
        cardFieldMappings: {
          headline: {
            primary: 'a.advert-title',
            fallbacks: ['h3 a', '[class*="advert-title"]'],
            type: 'text',
          },
          price: {
            primary: 'div.advert-price',
            fallbacks: ['span.advert-price', '[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          image: {
            primary: 'img.advert-image',
            fallbacks: ['img[class*="advert"]', 'img'],
            type: 'url',
          },
          bedrooms: { primary: 'span.advert-beds', fallbacks: ['[class*="beds"]'], type: 'number' },
          area: {
            primary: 'span.advert-area',
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
        dataExtractors: {
          price: {
            primary: 'div.advert-price',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          bedrooms: { primary: 'span.advert-beds', fallbacks: [], type: 'number' },
          area_sqm: { primary: 'span.advert-area', fallbacks: [], type: 'number', unit: 'sqm' },
        },
      },
      {
        id: 'habitaclia',
        cardSelector: 'article.js-list-item',
        dotThousands: !1,
        currency: 'EUR',
        cardFieldMappings: {
          headline: { primary: 'h3.list-item-title a', fallbacks: ['h3 a'], type: 'text' },
          price: {
            primary: 'span.item-price',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          image: { primary: 'img.item-image', fallbacks: ['img'], type: 'url' },
          bedrooms: {
            primary: 'span.item-detail-char.room',
            fallbacks: ['[class*="room"]'],
            type: 'number',
          },
          area: {
            primary: 'span.item-detail-char.surface',
            fallbacks: ['[class*="area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
        dataExtractors: {
          price: { primary: 'span.item-price', fallbacks: [], type: 'currency', currency: 'EUR' },
          bedrooms: { primary: 'span.item-detail-char.room', fallbacks: [], type: 'number' },
          area_sqm: {
            primary: 'span.item-detail-char.surface',
            fallbacks: [],
            type: 'number',
            unit: 'sqm',
          },
        },
      },
      {
        id: 'generic_listing_item',
        cardSelector: 'div.listing-item',
        dotThousands: !1,
        currency: 'EUR',
        cardFieldMappings: {
          headline: { primary: 'h3 a, h2 a', fallbacks: ['[class*="title"]'], type: 'text' },
          price: {
            primary: '[class*="price"]',
            fallbacks: ['[class*="Price"]'],
            type: 'currency',
            currency: 'EUR',
          },
          image: { primary: 'img', fallbacks: [], type: 'url' },
          bedrooms: {
            primary: '[class*="beds"], [class*="bedrooms"]',
            fallbacks: [],
            type: 'number',
          },
        },
        dataExtractors: {
          price: { primary: '[class*="price"]', fallbacks: [], type: 'currency', currency: 'EUR' },
          bedrooms: { primary: '[class*="beds"]', fallbacks: [], type: 'number' },
        },
      },
      {
        id: 'generic_property_item',
        cardSelector: 'div.property-item',
        dotThousands: !1,
        currency: 'EUR',
        cardFieldMappings: {
          headline: { primary: 'h3 a, h2 a', fallbacks: ['[class*="title"]'], type: 'text' },
          price: { primary: '[class*="price"]', fallbacks: [], type: 'currency', currency: 'EUR' },
          image: { primary: 'img', fallbacks: [], type: 'url' },
          bedrooms: { primary: '[class*="beds"]', fallbacks: [], type: 'number' },
        },
        dataExtractors: {
          price: { primary: '[class*="price"]', fallbacks: [], type: 'currency', currency: 'EUR' },
          bedrooms: { primary: '[class*="beds"]', fallbacks: [], type: 'number' },
        },
      },
    ];
  function Pe(e, t) {
    return Promise.resolve(Ut(e, t));
  }
  function Ut(e, t) {
    let r = new DOMParser().parseFromString(e, 'text/html'),
      a = [],
      c = wt(t),
      i = De(t),
      p = i ? [`${i.origin}/**`] : ['/**'],
      n = i
        ? [`${i.origin}/node/*`, `${i.origin}/property/*`, `${i.origin}/listing/*`]
        : ['/property/*'];
    if (Lt(r)) {
      a.push('Drupal CMS detected');
      let o = vt(r, c, p, n, a);
      if (o) return o;
    }
    for (let o of Rt) {
      let s = r.querySelectorAll(o.cardSelector);
      if (s.length < Ee) continue;
      return (
        o.dotThousands &&
          a.push(
            'PHP portal using dot as thousands separator detected (price_format: dot_thousands). Example: \u20AC335.000 = 335,000 EUR. Use price-parser.ts to handle this format.',
          ),
        {
          schema: Ce(
            c,
            p,
            n,
            o.cardSelector,
            o.cardFieldMappings,
            o.dataExtractors,
            s.length,
            0.85,
            'php_classic',
            'php',
            s[0] ?? null,
          ),
          confidence: 0.85,
          technique: 'php_classic',
          warnings: a,
        }
      );
    }
    return null;
  }
  function Lt(e) {
    if (
      e
        .querySelector('meta[name="generator"]')
        ?.getAttribute('content')
        ?.toLowerCase()
        .includes('drupal') ||
      e.body.hasAttribute('data-path')
    )
      return !0;
    let r = 0;
    for (let a of e.querySelectorAll('[class]'))
      for (let c of a.classList) if (c.startsWith('field--name-') && (r++, r >= At)) return !0;
    return !1;
  }
  function vt(e, t, r, a, c) {
    let i = Mt(t),
      p = [
        'div[class*="field--name-field-listing"]',
        'article.node--type-listing',
        'article.node--type-property',
        'article[class*="node--type-"]',
      ];
    for (let n of p) {
      let o = e.querySelectorAll(n);
      if (o.length < Ee) continue;
      let s = {
          headline: {
            primary: 'div.field--name-title a, h2.node-title a',
            fallbacks: ['h2 a', 'h3 a', '[class*="field--name-title"]'],
            type: 'text',
          },
          price: {
            primary: 'div.field--name-field-price span',
            fallbacks: ['[class*="field--name-field-price"]', '[class*="price"]'],
            type: 'currency',
            currency: i,
          },
          image: {
            primary: 'img.field__item',
            fallbacks: ['img[class*="field"]', 'img'],
            type: 'url',
          },
          bedrooms: {
            primary: 'div.field--name-field-bedrooms span',
            fallbacks: ['[class*="field--name-field-bedroom"]'],
            type: 'number',
          },
          area: {
            primary: 'div.field--name-field-area span',
            fallbacks: ['[class*="field--name-field-area"]'],
            type: 'number',
            unit: 'sqm',
          },
        },
        l = {
          price: {
            primary: 'div.field--name-field-price span',
            fallbacks: ['[class*="price"]'],
            type: 'currency',
            currency: i,
          },
          bedrooms: {
            primary: 'div.field--name-field-bedrooms span',
            fallbacks: [],
            type: 'number',
          },
          area_sqm: {
            primary: 'div.field--name-field-area span',
            fallbacks: [],
            type: 'number',
            unit: 'sqm',
          },
        };
      return (
        c.push(`Drupal listing selector: ${n}`),
        {
          schema: Ce(t, r, a, n, s, l, o.length, 0.9, 'drupal', 'drupal', o[0] ?? null),
          confidence: 0.9,
          technique: 'drupal',
          warnings: c,
        }
      );
    }
    return null;
  }
  function Ce(e, t, r, a, c, i, p, n, o, s, l) {
    let d = g(l ?? null),
      u = {
        headline: {
          primary: 'h1',
          fallbacks: ['[class*="title"]', '[class*="field--name-title"]'],
          type: 'text',
        },
        description: {
          primary: 'div.field--name-body, div[class*="description"]',
          fallbacks: ['[class*="desc"]', 'p'],
          type: 'text',
        },
        cta_primary: {
          primary: 'a[href*="contact"]',
          fallbacks: ['button[class*="contact"]'],
          type: 'text',
        },
      };
    return {
      tenant_id: 'pending',
      domain: e,
      detected_at: new Date().toISOString(),
      detection_source: o,
      detection_confidence: n,
      framework_hint: s,
      index_schema: {
        url_patterns: t,
        listing_card_selector: a,
        listing_count_expected: p,
        card_field_mappings: c,
        data_extractors_per_card: i,
        reorder_capable: !0,
        ...(d !== null ? { container_selector: d } : {}),
      },
      detail_schema: { url_patterns: r, slot_selectors: u, data_extractors: {} },
      archetype_hints: [],
    };
  }
  function Mt(e) {
    return e.endsWith('.co.uk') || e.endsWith('.uk')
      ? 'GBP'
      : e.endsWith('.pl')
        ? 'PLN'
        : e.endsWith('.ae')
          ? 'AED'
          : e.endsWith('.com')
            ? 'USD'
            : 'EUR';
  }
  function wt(e) {
    let t = De(e);
    return t ? t.hostname : e;
  }
  function De(e) {
    try {
      return new URL(e);
    } catch {
      return null;
    }
  }
  var $t = [
      {
        pattern: /rental[\s-]?yield|\broi\b|\binvestment\b|\binvestor\b/i,
        archetype: 'yield_hunter',
        boost: 0.15,
        signal: 'rental yield / investment language detected',
      },
      {
        pattern: /off[\s-]?plan|handover\s*Q[1-4]/i,
        archetype: 'yield_hunter',
        boost: 0.2,
        signal: 'off-plan / handover terminology detected',
      },
      {
        pattern: /price[\s-]?trend|similar[\s-]?transaction|capital[\s-]?growth/i,
        archetype: 'yield_hunter',
        boost: 0.1,
        signal: 'investment performance language detected',
      },
      {
        pattern: /buy[\s-]?to[\s-]?let|yield[\s-]?calculator/i,
        archetype: 'yield_hunter',
        boost: 0.15,
        signal: 'buy-to-let / yield calculator detected',
      },
      {
        pattern:
          /golden[\s-]?visa|residency[\s-]?by[\s-]?investment|citizenship[\s-]?by[\s-]?investment/i,
        archetype: 'golden_visa_buyer',
        boost: 0.25,
        signal: 'golden visa / residency by investment language',
      },
      {
        pattern: /regulatory[\s-]?information|permit[\s-]?number|\bRERA\b|\bDLD\b/i,
        archetype: 'golden_visa_buyer',
        boost: 0.2,
        signal: 'regulatory / permit language (UAE pattern)',
      },
      {
        pattern: /\bfreehold\b|leasehold[\s-]?ownership/i,
        archetype: 'golden_visa_buyer',
        boost: 0.1,
        signal: 'freehold ownership language (UAE/Cyprus pattern)',
      },
      {
        pattern: /vacation[\s-]?rental|\bairbnb\b|short[\s-]?term[\s-]?rental|holiday[\s-]?let/i,
        archetype: 'vacation_rental_investor',
        boost: 0.15,
        signal: 'vacation rental / Airbnb language',
      },
      {
        pattern: /\bfurnished\b|ready[\s-]?to[\s-]?rent|turnkey[\s-]?rental/i,
        archetype: 'vacation_rental_investor',
        boost: 0.1,
        signal: 'furnished / ready-to-rent listing',
      },
      {
        pattern:
          /\brenovation\b|below[\s-]?market[\s-]?value|motivated[\s-]?seller|fix[\s-]?and[\s-]?flip/i,
        archetype: 'flip_investor',
        boost: 0.15,
        signal: 'renovation / below market value language',
      },
      {
        pattern:
          /school[\s-]?district|school[\s-]?catchment|\bofsted\b|\bkindergarten\b|\bplayground\b/i,
        archetype: 'family_buyer',
        boost: 0.15,
        signal: 'school / family amenities language',
      },
      {
        pattern: /family[\s-]?home|family[\s-]?friendly|safe[\s-]?neighbourhood/i,
        archetype: 'family_buyer',
        boost: 0.1,
        signal: 'family home / safe neighbourhood language',
      },
      {
        pattern:
          /first[\s-]?time[\s-]?buyer|stamp[\s-]?duty[\s-]?(relief|exemption|calculator)|help[\s-]?to[\s-]?buy|shared[\s-]?ownership/i,
        archetype: 'first_time_buyer',
        boost: 0.2,
        signal: 'first-time buyer scheme / stamp duty language',
      },
      {
        pattern: /mortgage[\s-]?calculator|monthly[\s-]?payment|\baffordability\b/i,
        archetype: 'first_time_buyer',
        boost: 0.1,
        signal: 'mortgage calculator / affordability tool detected',
      },
      {
        pattern:
          /\bexclusive\b|off[\s-]?market|\bpenthouse\b|prime[\s-]?location|private[\s-]?viewing/i,
        archetype: 'luxury_buyer',
        boost: 0.1,
        signal: 'luxury / exclusive property language',
      },
      {
        pattern:
          /dedicated[\s-]?office|home[\s-]?office|fibre[\s-]?broadband|fast[\s-]?internet|co[\s-]?working[\s-]?nearby/i,
        archetype: 'remote_worker',
        boost: 0.15,
        signal: 'home office / fast internet language',
      },
      {
        pattern: /expat[\s-]?community|international[\s-]?school|english[\s-]?speaking|\brelocat/i,
        archetype: 'lifestyle_expat',
        boost: 0.2,
        signal: 'expat community / international school language',
      },
      {
        pattern: /airport[\s-]?transfer|non[\s-]?resident|foreign[\s-]?buyer/i,
        archetype: 'lifestyle_expat',
        boost: 0.1,
        signal: 'non-resident / foreign buyer language',
      },
      {
        pattern:
          /\bretire\b|retirement[\s-]?living|second[\s-]?home[\s-]?abroad|\bpeaceful\b|countryside[\s-]?retreat/i,
        archetype: 'retiree_relocator',
        boost: 0.15,
        signal: 'retirement / second home abroad language',
      },
      {
        pattern:
          /healthcare[\s-]?nearby|medical[\s-]?centre|\baccessible\b|ground[\s-]?floor|lift[\s-]?access/i,
        archetype: 'retiree_relocator',
        boost: 0.1,
        signal: 'healthcare / accessibility language',
      },
      {
        pattern: /buy[\s-]?from[\s-]?abroad|remote[\s-]?purchase|\bdiaspora\b|overseas[\s-]?buyer/i,
        archetype: 'diaspora_buyer',
        boost: 0.2,
        signal: 'buy from abroad / overseas buyer language',
      },
      {
        pattern:
          /holiday[\s-]?home|weekend[\s-]?retreat|second[\s-]?residence|\bcoastal\b|\bbeachfront\b|ski[\s-]?chalet/i,
        archetype: 'second_home_buyer',
        boost: 0.15,
        signal: 'holiday home / second residence language',
      },
      {
        pattern:
          /near[\s-]?university|student[\s-]?accommodation|purpose[\s-]?built[\s-]?student|\bPBSA\b/i,
        archetype: 'student_parent',
        boost: 0.2,
        signal: 'near university / student accommodation language',
      },
    ],
    Tt = [
      {
        pattern: /\.ae(\/|$|:)|bayut\.com|propertyfinder\.ae/,
        boosts: [
          { archetype: 'golden_visa_buyer', boost: 0.2 },
          { archetype: 'yield_hunter', boost: 0.15 },
        ],
        signal: 'UAE / Gulf market URL signal (golden visa + yield)',
      },
      {
        pattern: /\.es(\/|$|:)|idealista|kyero/,
        boosts: [
          { archetype: 'lifestyle_expat', boost: 0.15 },
          { archetype: 'vacation_rental_investor', boost: 0.1 },
        ],
        signal: 'Spain market URL signal (expat + vacation rental)',
      },
      {
        pattern: /\.cy(\/|$|:)|bazaraki|zyprus/,
        boosts: [
          { archetype: 'golden_visa_buyer', boost: 0.15 },
          { archetype: 'lifestyle_expat', boost: 0.1 },
        ],
        signal: 'Cyprus market URL signal (golden visa + expat)',
      },
      {
        pattern: /\.pl(\/|$|:)|otodom/,
        boosts: [
          { archetype: 'family_buyer', boost: 0.1 },
          { archetype: 'first_time_buyer', boost: 0.1 },
        ],
        signal: 'Poland market URL signal (family + first-time buyer)',
      },
      {
        pattern: /rightmove|zoopla/,
        boosts: [
          { archetype: 'family_buyer', boost: 0.1 },
          { archetype: 'first_time_buyer', boost: 0.1 },
          { archetype: 'upsizer', boost: 0.05 },
        ],
        signal: 'UK mainstream portal URL signal (family / FTB / upsizer)',
      },
      {
        pattern: /knight-frank|knightfrank|engelvoelkers|engel-volkers|lucas-fox|lucasfox/,
        boosts: [{ archetype: 'luxury_buyer', boost: 0.25 }],
        signal: 'Luxury brokerage URL signal',
      },
      {
        pattern: /\.com\/.*\b(redfin|zillow|realtor)\b|redfin\.com|zillow\.com|realtor\.com/,
        boosts: [
          { archetype: 'family_buyer', boost: 0.1 },
          { archetype: 'first_time_buyer', boost: 0.1 },
        ],
        signal: 'US mainstream portal URL signal (family + FTB)',
      },
    ];
  function x(e, t, r, a) {
    let c = e.get(t);
    c
      ? ((c.rawBoost += r), c.signals.push({ label: a, boost: r }))
      : e.set(t, { archetype: t, rawBoost: r, signals: [{ label: a, boost: r }] });
  }
  function Ft(e, t) {
    if (e) for (let r of $t) r.pattern.test(e) && x(t, r.archetype, r.boost, r.signal);
  }
  function Nt(e, t) {
    let r = e.index_schema.card_field_mappings.price?.currency;
    (r === 'AED' &&
      (x(t, 'yield_hunter', 0.15, 'AED currency detected (Dubai market signal)'),
      x(t, 'golden_visa_buyer', 0.2, 'AED currency detected (Dubai market signal)'),
      x(t, 'vacation_rental_investor', 0.1, 'AED currency detected (Dubai market signal)')),
      r === 'EUR' &&
        x(t, 'luxury_buyer', 0.05, 'EUR currency signal (refine with HTML / luxury keyword)'),
      e.detection_source === 'json_ld' &&
        x(t, 'yield_hunter', 0.05, 'JSON-LD structured data \u2014 investor-savvy platform signal'),
      e.detection_source === 'wordpress' &&
        (x(t, 'family_buyer', 0.1, 'WordPress theme \u2014 local family market signal'),
        x(t, 'first_time_buyer', 0.05, 'WordPress theme \u2014 local FTB market signal')),
      (e.detection_source === 'drupal' || e.detection_source === 'php_classic') &&
        x(
          t,
          'family_buyer',
          0.08,
          'Drupal/PHP classic platform \u2014 local family market signal',
        ));
  }
  function zt(e, t) {
    if (!e) return;
    let r = e.toLowerCase();
    for (let a of Tt)
      if (a.pattern.test(r)) for (let { archetype: c, boost: i } of a.boosts) x(t, c, i, a.signal);
  }
  function It(e) {
    let r = [...e.signals]
      .sort((c, i) => i.boost - c.boost)
      .slice(0, 2)
      .map((c) => c.label);
    return Array.from(new Set(r)).join(' + ');
  }
  function w(e, t, r) {
    if (e.detection_source === 'data_estalara') return [];
    let a = new Map();
    (Ft(t, a), Nt(e, a), zt(r, a));
    let c = [];
    for (let i of a.values()) {
      let p = Math.min(i.rawBoost, 0.3);
      p <= 0.05 || c.push({ archetype_id: i.archetype, signal: It(i), confidence_boost: p });
    }
    return (c.sort((i, p) => p.confidence_boost - i.confidence_boost), c);
  }
  var $ = /inquiry|enquiry|contact|consult|anfrage|consulta|book|message/i,
    qe = /\b(send|submit|inquire|enquire|contact|message|request|apply|book)\b/i,
    Ae = /inquiry|enquiry|contact|submit|send|cta/i;
  function Ot(e) {
    return typeof CSS < 'u' && typeof CSS.escape == 'function'
      ? CSS.escape(e)
      : e.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~\s])/g, '\\$1');
  }
  function Re(e) {
    return e.textContent.replace(/\s+/g, ' ').trim();
  }
  function T(e) {
    let t = e.querySelector('input[type="email"], input[name*="email"]') !== null,
      r = e.querySelector('textarea') !== null;
    return t || r;
  }
  function q(e, t) {
    let r = e.getAttribute('data-estalara-slot');
    if (r) return `[data-estalara-slot='${r}']`;
    let a = e.getAttribute('id');
    if (a && a.length > 0 && !/^\d/.test(a)) return `#${Ot(a)}`;
    let c = e.tagName.toLowerCase();
    for (let i of e.classList)
      if (/^[a-z][a-z0-9_-]{2,}$/i.test(i) && i.length < 40 && !/[A-Z]{3,}/.test(i)) {
        let p = `${c}.${i}`;
        if (t.querySelectorAll(p).length === 1) return p;
      }
    return e.getAttribute('type') === 'submit' &&
      t.querySelectorAll(`${c}[type="submit"]`).length === 1
      ? `${c}[type="submit"]`
      : null;
  }
  function Ue(e) {
    let t = new DOMParser().parseFromString(e, 'text/html');
    if (t.querySelector("[data-estalara-slot='inquiry-submit']"))
      return "[data-estalara-slot='inquiry-submit']";
    let a = t.querySelector('[data-inquiry-submit]');
    if (a) {
      let n = q(a, t);
      if (n) return n;
    }
    let c = t.querySelectorAll('form');
    for (let n of c) {
      let o = n.getAttribute('action') ?? '',
        s = n.className,
        l = n.getAttribute('id') ?? '',
        d = n.getAttribute('name') ?? '',
        u = $.test(o),
        m = $.test(s) || $.test(l) || $.test(d);
      if ((u || m) && T(n)) {
        let y = n.querySelector('button[type="submit"]') ?? n.querySelector('input[type="submit"]');
        if (y) {
          let f = q(y, t);
          if (f) return f;
        }
      }
    }
    for (let n of c) {
      if (!T(n)) continue;
      let o = n.querySelectorAll('button, input[type="submit"]');
      for (let s of o) {
        let l = Re(s);
        if (qe.test(l)) {
          let d = q(s, t);
          if (d) return d;
        }
      }
    }
    for (let n of c) {
      if (!T(n)) continue;
      let o = n.querySelectorAll('button, input[type="submit"]');
      for (let s of o) {
        let l = s.className;
        if (Ae.test(l)) {
          let d = q(s, t);
          if (d) return d;
        }
      }
    }
    let i = t.querySelectorAll(
      '[id*="contact" i], [id*="inquiry" i], [id*="enquiry" i], [class*="contact" i], [class*="inquiry" i], [class*="enquiry" i]',
    );
    for (let n of i) {
      let o = n.querySelectorAll('button, input[type="submit"]');
      for (let s of o) {
        let l = Re(s),
          d = s.className;
        if (qe.test(l) || Ae.test(d)) {
          let u = q(s, t);
          if (u) return u;
        }
      }
    }
    let p = [];
    for (let n of c) T(n) && p.push(n);
    if (p.length === 1) {
      let n = p[0];
      if (!n) return null;
      let o = n.querySelector('button[type="submit"]') ?? n.querySelector('input[type="submit"]');
      if (o) {
        let s = q(o, t);
        if (s) return s;
      }
    }
    return null;
  }
  var Bt = 0.7;
  async function Le(e, t, r) {
    let a = [],
      c = [H, Y, V, te, ke, Pe, ie, pe, me, be];
    for (let i of c) {
      let p;
      try {
        p = await i(e, t);
      } catch (n) {
        a.push(`Technique failed: ${n instanceof Error ? n.message : String(n)}`);
        continue;
      }
      if (p !== null && p.confidence >= Bt) {
        let n = null;
        if (p.schema) {
          ((n = { ...p.schema, tenant_id: r }), (n.archetype_hints = w(n, e, t)));
          let o = Ue(e);
          o !== null && (n.inquiry_submit_selector = o);
        }
        return { ...p, schema: n, warnings: [...a, ...p.warnings] };
      }
    }
    return {
      schema: null,
      confidence: 0,
      technique: 'ai_vision',
      warnings: [
        ...a,
        'No deterministic technique matched confidence threshold \u2014 AI Vision fallback should be invoked server-side.',
      ],
    };
  }
  globalThis.__EStalaraDetect = { detectSiteSchema: Le, extractArchetypeHints: w };
})();
