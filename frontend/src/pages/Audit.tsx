import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AuditComposer, { type Selection } from '@/audit/AuditComposer';
import AuditAccounts from '@/audit/AuditAccounts';
import { api, displayTime, exportRecords, labels, type AuditLog, type AuditMeta, type AuditRecord, type Page } from '@/audit/api';
import '@/audit/audit.css';

function RecordCard({record,admin,onAction,onTimeline}:{record:AuditRecord;admin:boolean;onAction:(kind:string,record:AuditRecord)=>void;onTimeline:(id:string)=>void}) {
  return <article className="ywdj-record" data-record-id={record.id}>
    <div className="ywdj-record-top"><span className={`ywdj-badge type-${record.kind}`}>{labels[record.kind]}</span><span className={`ywdj-badge severity-${record.severity}`}>{labels[record.severity]}</span><span className="ywdj-service">{record.service}</span>{record.voided && <span className="ywdj-badge type-VOID">已标记作废 · 原文保留</span>}<span className="ywdj-lock">已锁定</span></div>
    <h3>{record.title}</h3>
    <div className="ywdj-meta"><span>登记：{displayTime(record.recordedAt,record.timezone)}</span><span>发生：{displayTime(record.occurredAt,record.timezone)}</span><span>{record.actor.displayName}（{record.actor.username}）</span></div>
    {record.targetId && <p className="ywdj-context">{record.kind==='VOID'?'作废对象':'更正对象'}：{record.targetId}</p>}
    <div className="ywdj-content">{record.content}</div>
    {!!record.attachments.length && <div className="ywdj-evidence">{record.attachments.map(file=><a key={file.id} href={file.url} target="_blank" rel="noreferrer" title={`SHA-256: ${file.sha256}`}>
      {file.type.startsWith('image/') && <img src={file.url} alt={file.filename} loading="lazy"/>}<span>{file.filename}</span><small>{Math.ceil(file.size/1024)} KiB · 查看原件</small>
    </a>)}</div>}
    <div className="ywdj-record-footer"><span className="ywdj-record-id">记录：{record.id}</span><div className="ywdj-actions">
      <button className="ywdj-text-button" onClick={()=>onTimeline(record.incidentId)}>查看完整事故链</button>
      <button className="ywdj-text-button" onClick={()=>onAction('ACTION',record)}>追加进展</button>
      <button className="ywdj-text-button" onClick={()=>onAction('CORRECTION',record)}>追加更正</button>
      {admin && <button className="ywdj-text-button danger" onClick={()=>onAction('VOID',record)}>标记作废</button>}
    </div></div>
  </article>;
}
function Filters({params,today,onSearch}:{params:URLSearchParams;today:string;onSearch:(params:URLSearchParams)=>void}) {
  const [date,setDate]=useState(params.get('date')||today), [all,setAll]=useState(params.get('all')==='1');
  const [field,setField]=useState(params.get('dateField')||'recorded'), [kind,setKind]=useState(params.get('kind')||'');
  const [service,setService]=useState(params.get('service')||''), [actor,setActor]=useState(params.get('actor')||'');
  const [q,setQ]=useState(params.get('q')||''), [severity,setSeverity]=useState(params.get('severity')||'');
  const submit=(event:FormEvent)=>{
    event.preventDefault(); const next=new URLSearchParams();
    if(all)next.set('all','1');else next.set('date',date);
    next.set('dateField',field);
    for(const [key,value]of Object.entries({kind,service:service.trim(),actor:actor.trim(),q:q.trim(),severity}))if(value)next.set(key,value);
    onSearch(next);
  };
  return <form className="ywdj-filters" onSubmit={submit}>
    <div className="ywdj-grid"><label>日期维度<select aria-label="日期维度" value={field} onChange={e=>setField(e.target.value)}><option value="recorded">登记日期</option><option value="occurred">发生日期</option></select></label>
      <label>查询日期<input aria-label="查询日期" type="date" required={!all} disabled={all} value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label>记录类型筛选<select aria-label="记录类型筛选" value={kind} onChange={e=>setKind(e.target.value)}><option value="">全部类型</option>{['ALERT','INCIDENT','ACTION','RECOVERY','REVIEW','CORRECTION','VOID'].map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
      <label>程度筛选<select aria-label="程度筛选" value={severity} onChange={e=>setSeverity(e.target.value)}><option value="">全部程度</option>{['INFO','WARNING','CRITICAL'].map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
    </div><div className="ywdj-grid filters-bottom"><label>所属系统（精确）<input aria-label="系统筛选" value={service} onChange={e=>setService(e.target.value)}/></label>
      <label>登记用户名（精确）<input aria-label="登记人筛选" value={actor} onChange={e=>setActor(e.target.value)}/></label>
      <label>关键词 / 编号 / 附件名称<input aria-label="关键词查询" value={q} maxLength={200} onChange={e=>setQ(e.target.value)} placeholder="支持中文，正文或证据文件名"/></label>
    </div><div className="ywdj-filter-actions"><label className="ywdj-checkbox"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/>全部日期</label><button className="ywdj-button secondary" type="button" onClick={()=>onSearch(new URLSearchParams())}>回到今天</button><button className="ywdj-button" type="submit">查询记录</button></div>
  </form>;
}
const logLabels:Record<string,string>={CREATE_RECORD:'首次登记',APPEND_RECORD:'追加记录',VOID_RECORD:'作废说明',UPLOAD_EVIDENCE:'上传证据',DELETE_DRAFT_UPLOAD:'移除草稿附件',EXPORT_RECORDS:'导出记录',CREATE_USER:'创建账号',UPDATE_USER:'变更账号',BLOCK_RECORD_MUTATION:'拦截改删',BLOCK_EVIDENCE_DELETE:'拦截删除证据',BLOCK_LEGACY_ENDPOINT:'拦截旧接口',BLOCK_VOID:'拦截普通用户作废'};
function Logs({zone}:{zone:string}) {
  const [target,setTarget]=useState(''),[filter,setFilter]=useState('');
  const logs=useInfiniteQuery({queryKey:['audit','logs',filter],initialPageParam:{after:'',until:undefined as number|undefined},
    queryFn:({pageParam})=>{
      const q=new URLSearchParams();if(filter)q.set('target',filter);if(pageParam.after)q.set('after',pageParam.after);if(pageParam.until!==undefined)q.set('until',String(pageParam.until));
      return api<Page<AuditLog>>(`/api/audit/logs?${q}`);
    },getNextPageParam:page=>page.nextCursor?{after:page.nextCursor,until:page.snapshotMaxId}:undefined});
  return <section className="ywdj-panel"><h2>系统操作审计</h2><p className="ywdj-muted">由系统自动生成，不能手工编辑。这里记录登记、证据、导出、账号变更及被拦截的关键操作，不记录密码或完整请求正文。</p>
    <form className="ywdj-inline-form" onSubmit={e=>{e.preventDefault();setFilter(target.trim());}}><label>按目标编号查找<input aria-label="审计目标编号" value={target} onChange={e=>setTarget(e.target.value)} placeholder="记录编号、附件编号或 users/用户名"/></label><button className="ywdj-button secondary">查询日志</button><button type="button" className="ywdj-button secondary" onClick={()=>void logs.refetch()}>刷新</button></form>
    {logs.isLoading&&<p>正在读取审计记录…</p>}{logs.error&&<p role="alert" className="ywdj-error">{logs.error.message}</p>}
    <div className="ywdj-logs">{logs.data?.pages.flatMap(page=>page.items).map(log=><article key={log.id}><div><strong>{logLabels[log.action]||log.action}</strong><span className={`ywdj-badge ${log.outcome==='DENIED'?'type-VOID':''}`}>{log.outcome==='DENIED'?'已拒绝':'成功'}</span></div><p className="ywdj-muted">{displayTime(log.createdAt,zone)} · {log.actor_username}</p><p className="ywdj-record-id">目标：{log.target}</p><details><summary>详细信息</summary><pre>{JSON.stringify(log.details,null,2)}</pre></details></article>)}</div>
    {logs.hasNextPage&&<button className="ywdj-button secondary" disabled={logs.isFetchingNextPage} onClick={()=>void logs.fetchNextPage()}>加载更多审计日志</button>}
  </section>;
}
export default function Audit() {
  const {logout}=useAuth(), client=useQueryClient();
  const [params,setParams]=useSearchParams();
  const [selection,setSelection]=useState<Selection|null>(null),[notice,setNotice]=useState(''),[exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
  const handled=useCallback(()=>setSelection(null),[]);
  const metadata=useQuery({queryKey:['audit','meta'],queryFn:()=>api<AuditMeta>('/api/audit/meta'),refetchInterval:60000});
  const meta=metadata.data, view=params.get('view')||'records', incident=params.get('incident')||'';
  const query=new URLSearchParams(params);query.delete('view');
  if(incident){for(const key of ['date','all','kind','severity','service','actor','q'])query.delete(key);}
  else if(!query.has('date')&&!query.has('all'))query.set('date',meta?.today||'');
  const queryText=query.toString();
  const records=useInfiniteQuery({queryKey:['audit','records',queryText],enabled:!!meta&&view==='records',initialPageParam:{after:'',until:undefined as number|undefined},
    queryFn:({pageParam})=>{
      const q=new URLSearchParams(queryText);if(pageParam.after)q.set('after',pageParam.after);if(pageParam.until!==undefined)q.set('until',String(pageParam.until));
      return api<Page<AuditRecord>>(`/api/audit/records?${q}`);
    },getNextPageParam:page=>page.nextCursor?{after:page.nextCursor,until:page.snapshotMaxId}:undefined});
  const onTimeline=(id:string)=>setParams(new URLSearchParams({incident:id}));
  const onSaved=(record:AuditRecord)=>{
    setNotice(`已登记并锁定：${record.title}。登记日期 ${record.recordedDate}，可在下方查看完整经过。`);
    void client.invalidateQueries({queryKey:['audit']});onTimeline(record.incidentId);
  };
  const exportCurrent=async()=>{
    setExporting(true);setExportError('');
    try{
      const data=await exportRecords(queryText);const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`ywdj-${meta?.today||'records'}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      setNotice(`已导出 ${data.records.length} 条记录。JSON 包含附件清单和校验值，不包含原始图片 / PDF。`);
    }catch(err){setExportError(err instanceof Error?err.message:'导出失败');}finally{setExporting(false);}
  };
  return <div className="ywdj-app"><header className="ywdj-header"><div className="ywdj-brand"><span className="ywdj-mark">记</span><div><h1>运维登记</h1><p>提交锁定 · 追加留痕 · 事故溯源</p></div></div><div className="ywdj-header-user"><span>{meta?.user.username}</span><button className="ywdj-button secondary" onClick={()=>void logout()}>退出登录</button></div></header>
    <main className="ywdj-main"><nav className="ywdj-tabs" aria-label="运维登记导航">{[['records','登记台账'],['accounts','账号设置'],...(meta?.user.role==='ADMIN'?[['logs','操作审计']]:[])].map(([key,label])=><button key={key} aria-current={view===key?'page':undefined} onClick={()=>{const next=new URLSearchParams(params);if(key==='records')next.delete('view');else next.set('view',key);setParams(next);}}>{label}</button>)}</nav>
      {metadata.isLoading&&<section className="ywdj-panel">正在连接登记台账…</section>}{metadata.error&&<section role="alert" className="ywdj-panel ywdj-error">{metadata.error.message}<button className="ywdj-button secondary" onClick={()=>void metadata.refetch()}>重试</button></section>}
      {meta&&<><div className="ywdj-business-date"><span>业务日期 <strong>{meta.today}</strong> · {meta.timezone}</span><span>单团队共享 · 仅限登录成员</span></div>
        {notice&&<p role="status" className="ywdj-success">{notice}</p>}
        {view==='records'&&<>
          <AuditComposer key={meta.user.id} meta={meta} selection={selection} onSelectionHandled={handled} onSaved={onSaved}/>
          <section className="ywdj-panel" aria-labelledby="records-heading"><div className="ywdj-section-head"><div><p className="ywdj-eyebrow">查阅与追溯</p><h2 id="records-heading">{incident?'完整事故链（包含跨天追加）':'按日查询记录'}</h2></div><div className="ywdj-actions"><button className="ywdj-button secondary" onClick={()=>void records.refetch()}>刷新记录</button><button className="ywdj-button secondary" disabled={exporting||records.isLoading} onClick={()=>void exportCurrent()}>{exporting?'导出中…':'导出查询结果'}</button></div></div>
            {incident?<div className="ywdj-context"><p>事故编号：{incident}</p><p>按实际登记顺序呈现，原文和后续更正都保留；所有时间均显示业务时区。</p><button className="ywdj-text-button" onClick={()=>setParams(new URLSearchParams())}>返回按日查询</button></div>:<Filters key={`${params.toString()}-${meta.today}`} params={params} today={meta.today} onSearch={setParams}/>}
            {!incident&&params.get('date')&&params.get('date')!==meta.today&&<p className="ywdj-warning">正在查阅历史记录。上方新增表单仍只会登记到今天，不会倒填到查询日期。</p>}
            {exportError&&<p role="alert" className="ywdj-error">{exportError}</p>}
            {records.isLoading&&<p>正在读取记录…</p>}{records.error&&<p role="alert" className="ywdj-error">{records.error.message}</p>}
            {!records.isLoading&&!records.error&&records.data?.pages.every(page=>!page.items.length)&&<div className="ywdj-empty">当前条件下没有记录。可以调整日期、关键词或所属系统。</div>}
            <div className="ywdj-record-list">{records.data?.pages.flatMap(page=>page.items).map(record=><RecordCard key={record.id} record={record} admin={meta.user.role==='ADMIN'} onAction={(kind,item)=>setSelection({kind,record:item})} onTimeline={onTimeline}/>)}</div>
            {records.hasNextPage&&<button className="ywdj-button secondary" disabled={records.isFetchingNextPage} onClick={()=>void records.fetchNextPage()}>{records.isFetchingNextPage?'正在加载…':'加载更多记录'}</button>}
            <p className="ywdj-muted ywdj-small">查询按登记先后排序，不隐藏已作废原文。导出会获取全部匹配页，不仅是当前已加载的记录。</p>
          </section>
        </>}
        {view==='accounts'&&<AuditAccounts meta={meta}/>}
        {view==='logs'&&(meta.user.role==='ADMIN'?<Logs zone={meta.timezone}/>:<p className="ywdj-error">仅管理员可以查看系统操作日志。</p>)}
      </>}
      <footer className="ywdj-footer">ywdj · 应用侧运维登记版 · 基于 Memos / Allhuo Cloudflare 移植版二次开发。不是数据库级防篡改或合规认证产品。</footer>
    </main>
  </div>;
}
