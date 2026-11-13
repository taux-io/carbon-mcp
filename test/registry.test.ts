import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import pkg from "../package.json";
import { registryProblems } from "../scripts/check-registry.mjs";
import server from "../server.json";
import { PRIVACY_HTML } from "../src/site";

describe("server.json", () => {
  it("carries the same version as package.json", () => {
    expect(server.version).toBe(pkg.version);
  });

  it("points the registry at the live endpoint and this repository", () => {
    expect(server.name).toBe("io.github.taux-io/carbon-mcp");
    expect(server.remotes).toEqual([{ type: "streamable-http", url: "https://carbon.taux.io/mcp" }]);
    expect(server.repository.url).toBe("https://github.com/taux-io/carbon-mcp");
  });

  it("keeps the description within the registry's 100 characters and says it is unofficial", () => {
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.description).toMatch(/^Unofficial\./);
  });
});

describe("registry comparison", () => {
  const entry = { name: server.name, version: "0.2.2", remotes: server.remotes };

  it("accepts an entry that matches", () => {
    expect(registryProblems(entry, server)).toEqual([]);
  });

  it("reports an entry whose endpoint was changed", () => {
    const tampered = { ...entry, remotes: [{ type: "streamable-http", url: "https://evil.example/mcp" }] };
    expect(registryProblems(tampered, server)[0]).toContain("evil.example");
  });

  it("reports a different or missing entry", () => {
    expect(registryProblems({ ...entry, name: "io.github.someone/else" }, server).length).toBe(1);
    expect(registryProblems(undefined, server).length).toBe(1);
  });
});

// 隱私權政策描述的是實際行為。下面兩項檢查在行為改變時失敗，提醒同時修改 /privacy。
describe("privacy policy matches what the service does", () => {
  it("states the log retention, no cookies, and what GET query strings expose", () => {
    expect(PRIVACY_HTML).toContain("最長 7 天");
    expect(PRIVACY_HTML).toContain("不設定任何 Cookie");
    expect(PRIVACY_HTML).toContain("查詢參數");
    expect(PRIVACY_HTML).toContain("at most 7 days");
  });

  it("logs only the three things the policy lists: tool errors, API errors and scheduled job results", () => {
    const dir = join(fileURLToPath(import.meta.url), "../../src");
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
    const calls = files.flatMap((f) => (readFileSync(join(dir, f), "utf8").match(/console\.(log|error|warn|info|debug)\(/g) ?? []).map(() => f));
    expect(calls.sort()).toEqual(["api.ts", "server.ts", "server.ts"]);
  });

  it("sets no cookies and loads nothing from another origin", () => {
    expect(PRIVACY_HTML).not.toMatch(/document\.cookie|<script[^>]+src=|googletagmanager/);
  });
});
