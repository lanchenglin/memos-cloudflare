// Real browser layout/gesture checks using only synthetic fixtures (no production data).
import { createServer } from "vite";
import { chromium, webkit } from "../../backend/node_modules/playwright-core/index.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const audit = process.argv.includes("--audit");
const engine = process.env.MOBILE_BROWSER || "chromium";
const out = resolve("../test-results/mobile-" + (audit ? "before" : engine));
await mkdir(out, { recursive: true });
const server = await createServer({
  configFile: resolve("vite.config.mts"),
  server: { host: "127.0.0.1", port: 0, open: false },
  plugins: [
    {
      name: "mobile-fixture-only",
      configureServer(s) {
        s.middlewares.use("/__mobile_fixture__", async (req, res, next) => {
          try {
            const html = (await readFile("index.html", "utf8")).replace("/src/main.tsx", "/tests/mobile-fixture.tsx");
            res.setHeader("Content-Type", "text/html");
            res.end(await s.transformIndexHtml("/__mobile_fixture__", html));
          } catch (e) {
            next(e);
          }
        });
      },
    },
  ],
});
let browser;
const results = [];
const errors = [];
try {
  await server.listen();
  const port = server.httpServer.address().port;
  const type = engine === "webkit" ? webkit : chromium;
  browser = await type.launch({
    headless: true,
    ...(engine === "chromium" ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {}),
  });
  for (const size of [
    { width: 320, height: 568 },
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
  ]) {
    const c = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, deviceScaleFactor: 1, locale: "zh-CN" });
    const p = await c.newPage();
    p.setDefaultTimeout(20000);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${port}/__mobile_fixture__`);
    await p.getByRole("button", { name: "Close preview", exact: true }).waitFor();
    await p.waitForFunction(() => [...document.querySelectorAll("img")].some((i) => i.complete && i.naturalHeight > 0));
    await p.waitForTimeout(250);
    const dimensions = await p.evaluate(() => {
      const rect = (e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        innerWidth,
        innerHeight,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        dialog: rect(document.querySelector('[role="dialog"]')),
        controls: [...document.querySelectorAll('[role="dialog"] button')]
          .filter((e) => e.getClientRects().length)
          .map((e) => ({ label: e.getAttribute("aria-label"), ...rect(e) })),
      };
    });
    results.push({ engine, size, dimensions });
    await p.screenshot({ path: resolve(out, `${size.width}x${size.height}-preview.png`) });
    if (!audit) {
      assert.ok(dimensions.innerWidth <= size.width + 2, "layout viewport expanded beyond device width");
      assert.ok(dimensions.dialog.left >= -1 && dimensions.dialog.right <= size.width + 1, "dialog exceeds device width");
      assert.ok(dimensions.dialog.top >= -1 && dimensions.dialog.bottom <= size.height + 1, "dialog exceeds visible viewport height");
      for (const b of dimensions.controls) {
        assert.ok(
          b.left >= 0 && b.right <= size.width + 1 && b.top >= 0 && b.bottom <= size.height + 1,
          `${size.width}: ${b.label} off-screen`,
        );
        assert.ok(b.width >= 43 && b.height >= 43, `${b.label} touch target too small`);
      }
      await p.getByRole("button", { name: "Zoom in", exact: true }).tap();
      await p.getByText("120%", { exact: true }).waitFor();
      const image = p.getByAltText("Preview image 1 of 2");
      // Synthetic pointer sequence still runs in a real browser; hardware pinch is not claimed.
      const stage = p.getByTestId("preview-zoom-surface");
      const box = await stage.boundingBox();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const fire = async (type, id, x, y) =>
        stage.dispatchEvent(type, {
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 1,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: x,
          clientY: y,
          bubbles: true,
        });
      await fire("pointerdown", 1, point.x, point.y);
      await fire("pointermove", 1, point.x, point.y + 80);
      await fire("pointerup", 1, point.x, point.y + 80);
      const transform = await image.evaluate((i) => i.style.transform);
      assert.ok(!transform.startsWith("translate3d(0px, 0px,"), "zoomed image did not pan");
      await p.getByRole("button", { name: "Reset zoom", exact: true }).tap();
      await fire("pointerdown", 1, point.x - 30, point.y);
      await fire("pointerdown", 2, point.x + 30, point.y);
      await fire("pointermove", 2, point.x + 90, point.y);
      await fire("pointerup", 2, point.x + 90, point.y);
      await fire("pointerup", 1, point.x - 30, point.y);
      await p.getByText("200%", { exact: true }).waitFor();
      await p.getByRole("button", { name: "Reset zoom", exact: true }).tap();
      await fire("pointerdown", 1, point.x + 50, point.y);
      await fire("pointermove", 1, point.x - 60, point.y);
      await fire("pointerup", 1, point.x - 60, point.y);
      await p.getByAltText("Preview image 2 of 2").waitFor();
      await p.getByRole("button", { name: "Close preview", exact: true }).tap();
      await p.getByRole("button", { name: "Open form", exact: true }).tap();
      await p.getByText("Mobile form fixture", { exact: true }).waitFor();
      await p.waitForTimeout(250);
      assert.ok(
        await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
        "form causes document overflow",
      );
      const body = p.locator('[role="dialog"]');
      await body.getByRole("button", { name: "Save fixture", exact: true }).scrollIntoViewIfNeeded();
      await p.getByRole("button", { name: "Save fixture", exact: true }).tap();
      results[results.length - 1].gestures = "zoom, pan, pinch, reset, swipe and close passed";
    }
    await c.close();
  }
  assert.deepEqual(errors, [], "browser JavaScript errors");
  await writeFile(resolve(out, "report.json"), JSON.stringify({ engine, audit, results }, null, 2));
  console.log(JSON.stringify({ engine, audit, results }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
