import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { chromium } from "playwright-core";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const SECRET = "browser-test-jwt-secret-only-not-for-production-29381";
const SETUP = "browser-test-setup-secret-only-not-for-production-93812";
const PASSWORD = "browser-test-password-371928";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1kAAAAASUVORK5CYII=", "base64");
const dist = resolve("../frontend/dist");
const artifacts = resolve("../test-results");
const temp = await mkdtemp(join(tmpdir(), "memos-browser-test-"));
await mkdir(artifacts, {recursive:true});
let browser, mf, page;
const checks = [], errors = [];
try {
  const bundled = await build({entryPoints:["src/index.ts"],bundle:true,format:"esm",platform:"browser",target:"es2022",write:false});
  mf = new Miniflare(convertV4MiniflareOptions({host:"127.0.0.1", port:0, workers:[{name:"memos-browser", modules:true,script:bundled.outputFiles[0].text,compatibilityDate:"2026-09-01",compatibilityFlags:["nodejs_compat"],
    d1Databases:{DB:"browser-database"},r2Buckets:{R2:"browser-bucket"},
    bindings:{JWT_SECRET:SECRET,SETUP_KEY:SETUP,UPLOAD_LIMIT_MB:"10",BASE_URL:""},
    serviceBindings:{ASSETS: async request => {
      const path = resolve(dist, "." + decodeURIComponent(new URL(request.url).pathname));
      if (!path.startsWith(dist + "/") && path !== dist) return new Response("Not found",{status:404});
      const types={".html":"text/html", ".js":"application/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".png":"image/png", ".woff2":"font/woff2", ".woff":"font/woff"};
      try { return new Response(await readFile(path), {headers:{"Content-Type":types[extname(path)] || "application/octet-stream"}}); }
      catch { return new Response(await readFile(join(dist,"index.html")), {headers:{"Content-Type":"text/html"}}); }
    }},
  }]}));
  const db=await mf.getD1Database("DB");
  for (const file of ["migrations/0001_v2.sql","migrations/0002_personal.sql"]) {
    const triggers=[];
    const sql=(await readFile(file,"utf8")).replace(/--[^\n]*/g,"").replace(/CREATE TRIGGER[\s\S]*?END;/g,t=>{triggers.push(t);return "";});
    for(const statement of sql.split(";").map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
    for(const trigger of triggers) await db.prepare(trigger).run();
  }
  const origin=(await mf.ready).origin;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:["--no-sandbox"]});
  const context=await browser.newContext({locale:"zh-CN", viewport:{width:1280,height:900}});
  page=await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto(origin);
  await page.getByText("初始化密钥（Worker 的 SETUP_KEY）").waitFor();
  await page.locator('input[type="password"]').first().fill(SETUP);
  await page.locator('input[type="text"]').first().fill("browser-owner");
  await page.locator('input[type="password"]').last().fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.getByRole("button",{name:"上传图片",exact:true}).waitFor();
  checks.push("browser first-owner setup and automatic login");
  await page.locator("textarea").first().fill("这是浏览器实测的中文图文笔记，之后整理剪辑资料。");
  await page.getByRole("button",{name:"待整理",exact:true}).last().click();
  assert.match(await page.locator("textarea").first().inputValue(), /#待整理/);
  await page.locator('input[type="file"][accept*="image/avif"]').setInputFiles({name:"浏览器中文截图.png",mimeType:"image/png",buffer:PNG});
  await page.getByRole("button",{name:/^(保存|Save)$/}).click();
  await page.locator('img[src*="/file/attachments/"]').first().waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('img[src*="/file/attachments/"]')].some(i=>i.complete&&i.naturalWidth>0));
  checks.push("native binary upload + Chinese filename + review tag + image rendering");
  await page.reload();
  await page.waitForFunction(()=>[...document.querySelectorAll('img[src*="/file/attachments/"]')].some(i=>i.complete&&i.naturalWidth>0));
  checks.push("private image loads after full browser refresh");
  await page.getByRole("button",{name:"图片",exact:true}).click();
  await page.locator('img[src*="/file/attachments/"]').first().waitFor();
  checks.push("image-only home filter");
  await page.screenshot({path:join(artifacts,"home-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:join(artifacts,"home-mobile.png"),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),"mobile page overflows horizontally");
  checks.push("390px mobile layout without horizontal overflow");
  const token=await page.evaluate(()=>localStorage.getItem("memos_access_token"));
  const output=join(temp,"portable-backup");
  await exec("python3",["../scripts/backup.py","backup","--url",origin,"--output",output],{env:{...process.env,MEMOS_TOKEN:token},timeout:60000});
  const verified=await exec("python3",["../scripts/backup.py","verify","--directory",output],{timeout:30000});
  assert.equal(JSON.parse(verified.stdout).attachments,1);
  const manifest=JSON.parse(await readFile(join(output,"manifest.json"),"utf8"));
  const attachment=Object.values(manifest.attachments)[0];
  assert.deepEqual(await readFile(join(output,attachment.backupPath)),PNG);
  checks.push("portable Markdown + original image backup, SHA-256 verification");
  const imageSrc=await page.locator('img[src*="/file/attachments/"]').first().getAttribute("src");
  const anon=await browser.newContext();
  const denied=await anon.request.get(new URL(imageSrc,origin).href);
  assert.equal(denied.status(),401);
  await anon.close();
  checks.push("new anonymous browser cannot retrieve private image");
  assert.deepEqual(errors,[],"browser raised JavaScript errors");
  console.log(JSON.stringify({status:"passed",checks},null,2));
} catch(error) {
  if(page) {
    await page.screenshot({path:join(artifacts,"failure.png"),fullPage:true}).catch(()=>{});
    console.error((await page.locator("body").innerText().catch(()=>"")).slice(0,3000));
  }
  console.error(error);
  process.exitCode=1;
} finally {
  await browser?.close(); await mf?.dispose(); await rm(temp,{recursive:true,force:true});
}
