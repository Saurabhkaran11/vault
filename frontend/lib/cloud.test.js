import { describe, it, expect } from "vitest";
import { detectCloud, cloudTitle } from "./cloud";

describe("detectCloud", () => {
  it("recognises each supported provider by URL", () => {
    const cases = [
      ["https://docs.google.com/document/d/abc/edit", "gdoc"],
      ["https://docs.google.com/spreadsheets/d/abc/edit", "gsheet"],
      ["https://docs.google.com/presentation/d/abc/edit", "gslides"],
      ["https://docs.google.com/forms/d/abc/edit", "gform"],
      ["https://drive.google.com/file/d/abc/view", "gdrive"],
      ["https://www.dropbox.com/s/abc/report.pdf", "dropbox"],
      ["https://myteam.notion.so/Page-abc", "notion"],
    ];
    for (const [url, kind] of cases) {
      expect(detectCloud(url)?.kind, url).toBe(kind);
    }
  });

  it("orders Sheets/Slides/Forms ahead of the generic document match", () => {
    // spreadsheets/presentation/forms URLs also contain 'docs.google.com',
    // so the more specific kinds must win over gdoc.
    expect(detectCloud("https://docs.google.com/spreadsheets/d/x").kind).toBe("gsheet");
    expect(detectCloud("https://docs.google.com/presentation/d/x").kind).toBe("gslides");
  });

  it("returns null for non-http and unknown URLs", () => {
    expect(detectCloud("")).toBeNull();
    expect(detectCloud(null)).toBeNull();
    expect(detectCloud("ftp://docs.google.com/document/d/x")).toBeNull();
    expect(detectCloud("https://example.com/whatever")).toBeNull();
    expect(detectCloud("just some text")).toBeNull();
  });
});

describe("cloudTitle", () => {
  it("derives a readable title from a meaningful last path segment", () => {
    const url = "https://www.dropbox.com/s/x/Q3-financial-report.pdf";
    expect(cloudTitle(url, { label: "Dropbox" })).toBe("Q3 financial report");
  });

  it("falls back to '<label> (untitled)' when the slug is an opaque id or verb", () => {
    expect(cloudTitle("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQr/edit", { label: "Google Doc" }))
      .toBe("Google Doc (untitled)");
    expect(cloudTitle("https://drive.google.com/file/d/xxxxxxxxxxxxxxxxxxxx/view", { label: "Google Drive" }))
      .toBe("Google Drive (untitled)");
  });

  it("never throws on a malformed URL", () => {
    expect(() => cloudTitle("::::not a url", null)).not.toThrow();
  });
});
