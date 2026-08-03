import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readWebPage, WebPageReadError } from "./web-page-reader";

const publicAddress = async () => [{ address: "93.184.216.34", family: 4 as const }];

function htmlResponse(html: string, contentType = "text/html; charset=utf-8"): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": contentType,
    },
  });
}

void describe("web page reader", () => {
  void it("extracts title, description, and main content", async () => {
    const result = await readWebPage("https://example.com/article", {
      lookup: publicAddress,
      fetch: async () =>
        htmlResponse(`
          <html>
            <head>
              <title>Example &amp; Guide</title>
              <meta name="description" content="A page description &amp; detail.">
            </head>
            <body>
              <nav>Ignore navigation</nav>
              <main><h1>Hello</h1><p>Read this &amp; that.</p><script>ignore()</script></main>
              <footer>Ignore footer</footer>
            </body>
          </html>
        `),
    });

    assert.equal(result.source, "host_page");
    assert.equal(result.requestedUrl, "https://example.com/article");
    assert.equal(result.finalUrl, "https://example.com/article");
    assert.equal(result.title, "Example & Guide");
    assert.equal(result.description, "A page description & detail.");
    assert.match(result.text, /Hello/);
    assert.match(result.text, /Read this & that\./);
    assert.doesNotMatch(result.text, /Ignore navigation|Ignore footer|ignore\(\)/);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.sources, [
      { type: "url", url: "https://example.com/article", title: "Example & Guide" },
    ]);
  });

  void it("falls back to body content and truncates long text", async () => {
    const result = await readWebPage("https://example.com/page", {
      lookup: publicAddress,
      fetch: async () => htmlResponse(`<body>${"word ".repeat(12_000)}</body>`),
    });

    assert.equal(result.text.length, 40_000);
    assert.equal(result.truncated, true);
  });

  void it("rejects non-HTML responses", async () => {
    await assert.rejects(
      () =>
        readWebPage("https://example.com/data.json", {
          lookup: publicAddress,
          fetch: async () => htmlResponse("{}", "application/json"),
        }),
      (error: unknown) =>
        error instanceof WebPageReadError && error.code === "invalid_content_type",
    );
  });

  void it("rejects responses that exceed the byte limit", async () => {
    await assert.rejects(
      () =>
        readWebPage("https://example.com/large", {
          lookup: publicAddress,
          fetch: async () =>
            new Response("<body>too large</body>", {
              status: 200,
              headers: {
                "content-type": "text/html",
                "content-length": String(2 * 1024 * 1024 + 1),
              },
            }),
        }),
      (error: unknown) => error instanceof WebPageReadError && error.code === "response_too_large",
    );
  });

  void it("rejects local and private addresses before fetching", async () => {
    let fetchCount = 0;
    await assert.rejects(
      () =>
        readWebPage("http://127.0.0.1:8080/", {
          fetch: async () => {
            fetchCount += 1;
            return htmlResponse("<body>blocked</body>");
          },
        }),
      (error: unknown) => error instanceof WebPageReadError && error.code === "blocked_address",
    );
    assert.equal(fetchCount, 0);

    await assert.rejects(
      () =>
        readWebPage("https://internal.example/page", {
          lookup: async () => [{ address: "192.168.1.10", family: 4 as const }],
          fetch: async () => htmlResponse("<body>blocked</body>"),
        }),
      (error: unknown) => error instanceof WebPageReadError && error.code === "blocked_address",
    );
  });

  void it("revalidates redirect targets", async () => {
    let fetchCount = 0;
    await assert.rejects(
      () =>
        readWebPage("https://example.com/start", {
          lookup: async (hostname) =>
            hostname === "example.com"
              ? [{ address: "93.184.216.34", family: 4 as const }]
              : [{ address: "10.0.0.5", family: 4 as const }],
          fetch: async () => {
            fetchCount += 1;
            return new Response(null, {
              status: 302,
              headers: { location: "http://internal.example/private" },
            });
          },
        }),
      (error: unknown) => error instanceof WebPageReadError && error.code === "blocked_address",
    );
    assert.equal(fetchCount, 1);
  });

  void it("limits public redirects", async () => {
    let fetchCount = 0;
    await assert.rejects(
      () =>
        readWebPage("https://example.com/start", {
          lookup: publicAddress,
          fetch: async () => {
            fetchCount += 1;
            return new Response(null, {
              status: 302,
              headers: { location: `https://example.com/step-${fetchCount}` },
            });
          },
        }),
      (error: unknown) => error instanceof WebPageReadError && error.code === "redirect_limit",
    );
    assert.equal(fetchCount, 4);
  });

  void it("rejects invalid URL protocols and credentials", async () => {
    await assert.rejects(
      () => readWebPage("file:///etc/passwd"),
      (error: unknown) => error instanceof WebPageReadError && error.code === "invalid_url",
    );
    await assert.rejects(
      () => readWebPage("https://user:pass@example.com/"),
      (error: unknown) => error instanceof WebPageReadError && error.code === "invalid_url",
    );
  });
});
