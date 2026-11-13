import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { FACTORS, SOURCES } from "../src/data/reviewed";
import {
  API_DOCS_HTML, COPY_SCRIPT_HASH, LLMS_FULL_TXT, LLMS_TXT, renderPage, ROBOTS_TXT, SITEMAP_XML, TOOLS_HTML, type Locale,
} from "../src/site";
import { TOOLS } from "../src/tools";

const ENDPOINT = "https://carbon.taux.io/mcp";
const LOCALES: Locale[] = ["zh", "en", "ja"];
const LANG: Record<Locale, string> = { zh: "zh-Hant-TW", en: "en", ja: "ja" };
const PATH: Record<Locale, string> = { zh: "/", en: "/en", ja: "/ja" };
const PAGES: Record<Locale, string> = { zh: renderPage("zh"), en: renderPage("en"), ja: renderPage("ja") };

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const ALL_PAGES = [...Object.values(PAGES), TOOLS_HTML, API_DOCS_HTML];

describe("homepage", () => {
  it.each(LOCALES)("%s renders with the endpoint, one h1 and the right lang", (loc) => {
    const html = PAGES[loc];
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(ENDPOINT);
    expect(count(html, /<h1[ >]/g)).toBe(1);
    expect(html).toContain(`<html lang="${LANG[loc]}">`);
    expect(html).toContain(`<link rel="canonical" href="https://carbon.taux.io${PATH[loc]}">`);
  });

  it.each(LOCALES)("%s declares every hreflang alternate and x-default", (loc) => {
    const html = PAGES[loc];
    for (const [hreflang, path] of [["zh-Hant", "/"], ["en", "/en"], ["ja", "/ja"]] as const) {
      expect(html).toContain(`<link rel="alternate" hreflang="${hreflang}" href="https://carbon.taux.io${path}">`);
    }
    expect(html).toContain('hreflang="x-default" href="https://carbon.taux.io/"');
  });

  it("has Open Graph and Twitter meta with an absolute image URL and its size", () => {
    for (const html of Object.values(PAGES)) {
      expect(html).toContain('property="og:title"');
      expect(html).toContain('<meta property="og:image" content="https://carbon.taux.io/og.png">');
      expect(html).toContain('<meta property="og:image:width" content="1200">');
      expect(html).toContain('<meta property="og:image:height" content="630">');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(html).toContain('<meta name="twitter:image" content="https://carbon.taux.io/og.png">');
    }
  });

  it("links the privacy policy from every page and lists it in the sitemap", () => {
    for (const html of ALL_PAGES) expect(html).toContain('href="/privacy"');
    expect(SITEMAP_XML).toContain("<loc>https://carbon.taux.io/privacy</loc>");
  });

  it("links the favicon and touch icon on every page", () => {
    for (const html of [...Object.values(PAGES), TOOLS_HTML, API_DOCS_HTML]) {
      expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
      expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="48x48">');
      expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    }
  });

  it("gives the three locales the same structure", () => {
    const shape = (html: string) => ({
      sections: count(html, /<section[ >]/g),
      prompts: count(html, /class="copyable prompt"/g),
      faq: count(html, /<details class="faq"/g),
      sources: count(html, /<tr><td>[^<]*<\/td><td><a href=/g),
    });
    expect(shape(PAGES.zh).sections).toBe(10);
    expect(shape(PAGES.zh).prompts).toBe(6);
    expect(shape(PAGES.zh).faq).toBeGreaterThanOrEqual(5);
    expect(shape(PAGES.en)).toEqual(shape(PAGES.zh));
    expect(shape(PAGES.ja)).toEqual(shape(PAGES.zh));
  });

  it("generates the tool list and the source list from the data, not from retyped text", () => {
    for (const html of [...Object.values(PAGES), TOOLS_HTML, LLMS_TXT, LLMS_FULL_TXT]) {
      for (const tool of TOOLS) expect(html).toContain(tool.name);
    }
    for (const html of Object.values(PAGES)) {
      for (const s of SOURCES) expect(html).toContain(s.official_url);
    }
  });

  it("points to the live status for the API-synced source instead of claiming a state", () => {
    expect(SOURCES.some((s) => s.status === "pending_key")).toBe(true);
    expect(PAGES.zh).toContain("即時狀態見 /api/v1/status");
    expect(PAGES.en).toContain("live status at /api/v1/status");
    expect(PAGES.ja).toContain("最新の状態は /api/v1/status");
  });

  it("links the supporting pages and never claims AI crawling is guaranteed", () => {
    for (const html of Object.values(PAGES)) {
      for (const href of ["/tools", "/api/docs", "/llms.txt", "/llms-full.txt", "https://github.com/taux-io/carbon-mcp", "https://data.gov.tw/license"]) {
        expect(html).toContain(`href="${href}"`);
      }
    }
    expect(LLMS_TXT).not.toMatch(/guarantee[sd]? (to be )?(crawl|cit)/i);
  });
});

describe("script and CSP", () => {
  it.each(LOCALES)("%s has exactly one executable inline script and its hash matches", (loc) => {
    const scripts = [...PAGES[loc].matchAll(/<script(?![^>]*application\/ld\+json)([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.[1]).toBe("");
    const hash = createHash("sha256").update(scripts[0]?.[2] ?? "").digest("base64");
    expect(hash).toBe(COPY_SCRIPT_HASH);
  });

  it("uses the same single script on the doc pages and loads nothing external", () => {
    for (const html of ALL_PAGES) {
      expect(count(html, /<script(?![^>]*application\/ld\+json)/g)).toBe(1);
      expect(html).not.toMatch(/<script[^>]*\ssrc=/);
      expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/);
      expect(html).not.toMatch(/\son[a-z]+="/);
      expect(html).not.toContain("googletagmanager");
      expect(html).not.toContain("gtag(");
    }
  });

  it("parses every JSON-LD block", () => {
    for (const html of Object.values(PAGES)) {
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks.length).toBeGreaterThanOrEqual(2);
      const types = blocks.map((b) => (JSON.parse(b[1] ?? "") as { "@type": string })["@type"]);
      expect(types).toContain("FAQPage");
      expect(types).toContain("SoftwareApplication");
    }
  });
});

describe("no invented numbers", () => {
  const reviewed = new Set(FACTORS.map((f) => f.value).filter((v): v is string => v !== null));
  const FACTOR_LIKE = /(?<![\d.])0\.4\d\d(?!\d)/g;

  it("shows the three 2025 electricity values", () => {
    for (const v of ["0.466", "0.471", "0.467"]) {
      expect(reviewed.has(v)).toBe(true);
      for (const loc of LOCALES) expect(PAGES[loc]).toContain(v);
    }
  });

  it("contains no 0.4xx value that is not in reviewed.ts", () => {
    for (const html of [...ALL_PAGES, LLMS_TXT, LLMS_FULL_TXT]) {
      for (const m of html.match(FACTOR_LIKE) ?? []) expect(reviewed.has(m), m).toBe(true);
    }
  });
});

describe("machine-readable files", () => {
  it("lists all three homepages with hreflang alternates in the sitemap", () => {
    for (const path of ["/", "/en", "/ja"]) expect(SITEMAP_XML).toContain(`<loc>https://carbon.taux.io${path}</loc>`);
    for (const h of ["zh-Hant", "en", "ja", "x-default"]) expect(SITEMAP_XML).toContain(`hreflang="${h}"`);
  });

  it("points robots.txt at the sitemap and keeps the MCP endpoint out of the crawl", () => {
    expect(ROBOTS_TXT).toContain("Sitemap: https://carbon.taux.io/sitemap.xml");
    expect(ROBOTS_TXT).toContain("Disallow: /mcp");
  });

  it("documents every REST route and the worked example", () => {
    for (const route of [
      "/api/v1/sources", "/api/v1/factors", "/api/v1/factors/:id", "/api/v1/factors/:id/versions", "/api/v1/electricity",
      "/api/v1/calculate", "/api/v1/calculate/batch", "/api/v1/status", "/health",
    ]) {
      expect(API_DOCS_HTML).toContain(route);
      expect(LLMS_FULL_TXT).toContain(route);
    }
    expect(API_DOCS_HTML).toContain("tw-electricity-2025-industry-inventory");
    expect(API_DOCS_HTML).toContain("&quot;5592&quot;");
    expect(LLMS_FULL_TXT).toContain('"emissions_kg": "5592"');
  });

  it("documents the parameters of calculate_emissions on the tools page", () => {
    for (const p of ["factor_id", "quantity_unit", "optional_context.lower_heating_value.unit", "factor_version"]) {
      expect(TOOLS_HTML).toContain(p);
    }
  });

  it("includes the endpoint and the unofficial disclaimer in both llms files", () => {
    for (const txt of [LLMS_TXT, LLMS_FULL_TXT]) {
      expect(txt).toContain(ENDPOINT);
      expect(txt).toContain("Unofficial");
    }
    expect(LLMS_FULL_TXT.length).toBeGreaterThan(LLMS_TXT.length);
  });
});
