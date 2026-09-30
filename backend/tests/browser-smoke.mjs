import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
process.chdir(resolve(import.meta.dirname, '..'));
const SECRET='ywdj-browser-jwt-test-only-not-production-83175721';
const SETUP='ywdj-browser-setup-test-only-not-production-92351317';
const PASSWORD='ywdj-browser-test-password-371928';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1kAAAAASUVORK5CYII=','base64');
const dist=resolve('../frontend/dist'), artifacts=resolve('../test-results');
const temp=await mkdtemp(join(tmpdir(),'ywdj-browser-'));
await mkdir(artifacts,{recursive:true});
let browser,mf,page;const checks=[],errors=[],network=[],consoleErrors=[];
try {
  console.log('[browser] bundle worker');
  const bundle=await build({entryPoints:['src/index.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
  mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'ywdj-browser',modules:true,script:bundle.outputFiles[0].text,
    compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'browser-db'},r2Buckets:{R2:'browser-bucket'},
    bindings:{JWT_SECRET:SECRET,SETUP_KEY:SETUP,UPLOAD_LIMIT_MB:'10',BASE_URL:'',AUDIT_TIMEZONE:'Asia/Shanghai'},
    serviceBindings:{ASSETS:async request=>{
      const path=resolve(dist,'.'+decodeURIComponent(new URL(request.url).pathname));
      if(!path.startsWith(dist+'/')&&path!==dist)return new Response('Not found',{status:404});
      const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff','.webp':'image/webp'};
      try{return new Response(await readFile(path),{headers:{'Content-Type':types[extname(path)]||'application/octet-stream'}});}
      catch{return new Response(await readFile(join(dist,'index.html')),{headers:{'Content-Type':'text/html'}});}
    }},
  }]}));
  console.log('[browser] start temporary D1 and R2');
  const db=await mf.getD1Database('DB');
  for(const file of ['0001_v2.sql','0002_personal.sql','0003_ywdj.sql']){
    const triggers=[];const sql=(await readFile(`migrations/${file}`,'utf8')).replace(/--[^\n]*/g,'').replace(/CREATE TRIGGER[\s\S]*?END;/g,t=>{triggers.push(t);return '';});
    for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
    for(const trigger of triggers)await db.prepare(trigger).run();
  }
  console.log('[browser] schema ready');
  const origin=(await mf.ready).origin;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({locale:'zh-CN',viewport:{width:1280,height:900}});
  page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',err=>errors.push(err.message));page.on('response',r=>network.push([new URL(r.url()).pathname,r.status()]));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('dialog',dialog=>dialog.accept());
  console.log('[browser] open application');
  await page.goto(origin);
  await page.getByText('初始化密钥（Worker 的 SETUP_KEY）').waitFor();
  await page.locator('input[type="password"]').first().fill(SETUP);
  await page.locator('input[type="text"]').first().fill('browser-admin');
  await page.locator('input[type="password"]').last().fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.getByRole('heading',{name:'记录当前事项',exact:true}).waitFor();
  console.log('[browser] checkpoint passed'); checks.push('first-owner initialization and login redirect to audit edition');

  await page.getByRole('button',{name:'账号设置',exact:true}).click();
  await page.getByLabel('成员用户名',{exact:true}).fill('browser-member');
  await page.getByLabel('成员显示姓名',{exact:true}).fill('值班员');
  await page.getByLabel('成员初始密码',{exact:true}).fill(PASSWORD);
  await page.getByRole('button',{name:'创建成员',exact:true}).click();
  await page.getByText('成员已创建。请通过安全渠道交付初始密码。',{exact:true}).waitFor();
  console.log('[browser] checkpoint passed'); checks.push('admin creates an ordinary member through the UI');
  await page.getByRole('button',{name:'登记台账',exact:true}).click();
  await page.getByLabel('所属系统',{exact:true}).fill('支付服务');
  await page.getByLabel('登记标题',{exact:true}).fill('网页验收：支付请求连续超时');
  await page.getByLabel('登记详情',{exact:true}).fill('10:05 发现支付请求超时，已检查数据库连接。原始判断暂待验证。');
  await page.getByLabel('证据附件',{exact:true}).setInputFiles({name:'中文告警证据.png',mimeType:'image/png',buffer:PNG});
  await page.getByRole('button',{name:'移除草稿附件',exact:true}).waitFor();
  await page.getByRole('button',{name:'正式提交并锁定',exact:true}).click();
  await page.locator('article[data-record-id]').waitFor();
  const rootId=await page.locator('article[data-record-id]').first().getAttribute('data-record-id');
  await page.waitForFunction(()=>[...document.querySelectorAll('img[src*="/api/audit/files/"]')].some(image=>image.complete&&image.naturalWidth>0));
  assert.equal(await page.getByRole('button',{name:'编辑',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'删除',exact:true}).count(),0);
  console.log('[browser] checkpoint passed'); checks.push('Chinese record and original evidence submitted, locked and rendered');
  await page.getByRole('button',{name:'追加更正',exact:true}).first().click();
  await page.getByLabel('登记详情',{exact:true}).fill('更正：进一步排查指向应用连接池配置，而不是数据库故障。');
  await page.getByRole('button',{name:'正式提交并锁定',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('article[data-record-id]').length===2);
  assert.match(await page.locator(`[data-record-id="${rootId}"]`).innerText(),/原始判断暂待验证/);
  console.log('[browser] checkpoint passed'); checks.push('correction is appended to the same incident and never overwrites original content');
  await page.reload();
  await page.waitForFunction(()=>[...document.querySelectorAll('img[src*="/api/audit/files/"]')].some(image=>image.complete&&image.naturalWidth>0));
  console.log('[browser] checkpoint passed'); checks.push('reload preserves timeline and authenticated evidence access');
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出查询结果',exact:true}).click();
  const download=await downloadPromise;const downloadPath=join(temp,'query.json');await download.saveAs(downloadPath);
  assert.equal(JSON.parse(await readFile(downloadPath,'utf8')).records.length,2);
  console.log('[browser] checkpoint passed'); checks.push('browser exports the complete incident query');
  await page.screenshot({path:join(artifacts,'ywdj-desktop.png'),fullPage:true});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),`${width}px mobile layout overflows`);
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(artifacts,'ywdj-mobile.png'),fullPage:true});
  console.log('[browser] checkpoint passed'); checks.push('320px and 390px mobile layouts do not overflow');
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'操作审计',exact:true}).click();
  await page.getByRole('heading',{name:'系统操作审计',exact:true}).waitFor();
  await page.getByText('首次登记',{exact:true}).first().waitFor();
  console.log('[browser] checkpoint passed'); checks.push('admin can inspect automatically generated operation logs');
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await page.locator('input[type="text"]').first().fill('browser-member');
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
  // Previous admin tab can be preserved by the safe auth redirect; explicitly navigate to the ledger.
  await page.goto(`${origin}/audit?incident=${rootId}`);
  await page.getByRole('heading',{name:'记录当前事项',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'标记作废',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'操作审计',exact:true}).count(),0);
  const token=await page.evaluate(()=>localStorage.getItem('memos_access_token'));
  const denied=await context.request.delete(`${origin}/api/audit/records/${rootId}`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(denied.status(),403);
  console.log('[browser] checkpoint passed'); checks.push('ordinary member can read the team timeline but cannot edit/delete or access admin UI');
  let dropOnce=true;
  await page.route('**/api/audit/records',async route=>{
    if(route.request().method()==='POST'&&dropOnce){dropOnce=false;const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');}
    else await route.continue();
  });
  await page.getByLabel('所属系统',{exact:true}).fill('网络设备');
  await page.getByLabel('登记标题',{exact:true}).fill('丢失响应重试测试');
  await page.getByLabel('登记详情',{exact:true}).fill('模拟服务器已写入但浏览器未收到响应。');
  await page.getByRole('button',{name:'正式提交并锁定',exact:true}).click();
  await page.getByRole('button',{name:'原样重试确认提交',exact:true}).waitFor();
  assert.equal(await page.getByLabel('登记详情',{exact:true}).isDisabled(),true);
  await page.reload();
  await page.getByRole('button',{name:'原样重试确认提交',exact:true}).waitFor();
  await page.getByRole('button',{name:'原样重试确认提交',exact:true}).click();
  await page.getByText('已登记并锁定：丢失响应重试测试。',{exact:false}).waitFor();
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_record WHERE title='丢失响应重试测试'").first()).n,1);
  console.log('[browser] checkpoint passed'); checks.push('lost response, browser reload and retry create exactly one record');
  await page.getByRole('button',{name:'返回按日查询',exact:true}).click();
  await page.getByLabel('关键词查询',{exact:true}).fill('中文告警证据');
  await page.getByRole('button',{name:'查询记录',exact:true}).click();
  await page.locator(`[data-record-id="${rootId}"]`).waitFor();
  console.log('[browser] checkpoint passed'); checks.push('Chinese attachment filename search finds the incident');
  const output=join(temp,'portable-backup');
  await exec('python3',['../scripts/audit_backup.py','backup','--url',origin,'--output',output],{env:{...process.env,MEMOS_TOKEN:token},timeout:60000});
  const verified=await exec('python3',['../scripts/audit_backup.py','verify','--directory',output],{timeout:30000});
  assert.equal(JSON.parse(verified.stdout).attachments,1);assert.equal(JSON.parse(verified.stdout).records,3);
  const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
  assert.deepEqual(await readFile(join(output,Object.values(manifest.attachments)[0].backupPath)),PNG);
  console.log('[browser] checkpoint passed'); checks.push('portable record/original evidence backup and SHA-256 verification');
  const imageSrc=await page.locator('img[src*="/api/audit/files/"]').first().getAttribute('src');
  const anonymous=await browser.newContext();
  assert.equal((await anonymous.request.get(new URL(imageSrc,origin).href)).status(),401);await anonymous.close();
  console.log('[browser] checkpoint passed'); checks.push('anonymous browser cannot read evidence');
  assert.deepEqual(errors,[],'browser JavaScript errors');
  const result={status:'passed',checks};await writeFile(join(artifacts,'ywdj-browser-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}catch(error){
  console.error('Browser page errors:', JSON.stringify(errors));console.error('Console:', JSON.stringify(consoleErrors));console.error('Network:',JSON.stringify(network.slice(-30)));console.error('URL:',page?.url());
  if(page){await page.screenshot({path:join(artifacts,'ywdj-failure.png'),fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText().catch(()=>'' )).slice(0,6000));}
  console.error(error);process.exitCode=1;
}finally{await browser?.close();await mf?.dispose();await rm(temp,{recursive:true,force:true});}
