import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, AuditApiError, labels, post, type AuditMeta, type AuditRecord, type CreateRecord, type Evidence } from './api';
import { draftKey, eventTime, freshDraft, loadDraft, type Draft } from './draft';

export interface Selection { kind: string; record: AuditRecord }
interface Props { meta: AuditMeta; selection: Selection | null; onSelectionHandled: () => void; onSaved: (record: AuditRecord) => void }
export default function AuditComposer({ meta, selection, onSelectionHandled, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(() => loadDraft(meta.user.id));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const inFlight = useRef(false), formRef = useRef<HTMLFormElement>(null);
  const locked = busy || !!draft.pending;
  useEffect(() => {
    try { localStorage.setItem(draftKey(meta.user.id), JSON.stringify(draft)); setStorageWarning(''); }
    catch { setStorageWarning('本浏览器无法保存草稿。请勿刷新，提交前需要恢复浏览器本地存储。'); }
  }, [draft, meta.user.id]);
  useEffect(() => {
    if (!selection) return;
    if (inFlight.current || draft.pending) {
      setError('上一条提交结果尚未确认，请先原样重试。'); onSelectionHandled(); return;
    }
    if ((draft.content || draft.title || draft.attachments.length) && !window.confirm('切换关联记录会清空当前未提交草稿，是否继续？')) {
      onSelectionHandled(); return;
    }
    const { record, kind } = selection;
    setDraft({ ...freshDraft(), kind, service:record.service, severity:record.severity, incidentId:record.incidentId,
      targetId:['CORRECTION','VOID'].includes(kind) ? record.id : '', title:['CORRECTION','VOID'].includes(kind) ? `${labels[kind]}：${record.title}`.slice(0,160) : '' });
    setError(''); onSelectionHandled(); formRef.current?.scrollIntoView({ behavior:'smooth', block:'start' });
  }, [selection, draft.pending, draft.content, draft.title, draft.attachments.length, onSelectionHandled]);
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    let payload: CreateRecord | null = null;
    try {
      if (!draft.pending && !window.confirm('正式提交后正文、日期和附件都不能修改或删除。写错需另行追加更正，确认提交？')) return;
      const currentMeta = draft.pending ? meta : await api<AuditMeta>('/api/audit/meta');
      // Do not silently reinterpret a 23:59 form as tomorrow's event time.
      if (!draft.pending && draft.time && currentMeta.today !== draft.eventDate) throw new Error('业务日期已跨天，请刷新当天日期并重新选择事件时间；草稿仍保留。');
      payload = draft.pending || { requestId:draft.requestId, kind:draft.kind, title:draft.title, service:draft.service,
        severity:draft.severity, content:draft.content, occurredAt:eventTime(currentMeta.today,draft.time,currentMeta.timezone),
        incidentId:draft.incidentId || undefined, targetId:draft.targetId || undefined, attachmentIds:draft.attachments.map(file => file.id) };
      const pending = { ...draft, pending:payload };
      // Persist the exact idempotent request BEFORE sending it, to survive a lost response or refresh.
      localStorage.setItem(draftKey(meta.user.id),JSON.stringify(pending));
      setDraft(pending);
      const record = await post<AuditRecord>('/api/audit/records', payload);
      const fresh = freshDraft(); localStorage.setItem(draftKey(meta.user.id),JSON.stringify(fresh)); setDraft(fresh);
      onSaved(record);
    } catch (err) {
      if (err instanceof AuditApiError && [400,403,404,409,413,429].includes(err.status)) {
        // These responses did not accept this new submission; allow correction of the draft.
        setDraft(current => ({ ...current, pending:null }));
      }
      setError(err instanceof Error ? err.message : '提交失败');
    } finally { inFlight.current=false; setBusy(false); }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length || locked || inFlight.current) return;
    if (draft.attachments.length+files.length>20) { setError('每条记录最多 20 个附件'); return; }
    inFlight.current=true; setBusy(true); setError('');
    try {
      for (const file of Array.from(files)) {
        if (file.size>meta.uploadLimitBytes) throw new Error(`附件 ${file.name} 超过 ${meta.uploadLimitBytes/1024/1024} MiB`);
        const result=await api<Evidence>(`/api/audit/uploads?filename=${encodeURIComponent(file.name)}`, {
          method:'POST', headers:{'X-Upload-ID':crypto.randomUUID(),'Content-Type':'application/octet-stream'}, body:file });
        setDraft(current=>({...current, attachments:[...current.attachments,result]}));
      }
    } catch(err) { setError(err instanceof Error ? err.message : '上传失败'); }
    finally { inFlight.current=false; setBusy(false); }
  };
  const remove = async (file: Evidence) => {
    if (locked || inFlight.current) return;
    inFlight.current=true; setBusy(true); setError('');
    try {
      await api(`/api/audit/uploads/${file.id}`, {method:'DELETE'});
      setDraft(current=>({...current,attachments:current.attachments.filter(item=>item.id!==file.id)}));
    } catch(err) { setError(err instanceof Error ? err.message : '未能移除草稿附件'); }
    finally { inFlight.current=false; setBusy(false); }
  };
  const kinds = draft.incidentId ? ['ACTION','RECOVERY','REVIEW','CORRECTION', ...(meta.user.role==='ADMIN' ? ['VOID'] : [])] : ['ALERT','INCIDENT','ACTION'];
  return <section className="ywdj-panel" aria-labelledby="composer-heading">
    <div className="ywdj-section-head"><div><p className="ywdj-eyebrow">新增登记 · {meta.today}</p><h2 id="composer-heading">{draft.incidentId ? '追加到原事故' : '记录当前事项'}</h2></div>
      {draft.incidentId && <button type="button" className="ywdj-button secondary" disabled={locked} onClick={()=>{
        if ((!draft.content && !draft.title && !draft.attachments.length) || window.confirm('清空当前草稿，改为新事项？')) setDraft(freshDraft());
      }}>改为新事项</button>}
    </div>
    <p className="ywdj-muted">正式提交即锁定，当天也不能修改。尚未提交的草稿可修改；处置进展和更正用新记录补充。</p>
    {draft.incidentId && <p className="ywdj-context">关联事故：{draft.incidentId}{draft.targetId && <><br/>更正 / 作废对象：{draft.targetId}</>}</p>}
    <form ref={formRef} onSubmit={submit} className="ywdj-form">
      <fieldset disabled={locked} className="ywdj-fieldset">
        <div className="ywdj-grid">
          <label>记录类型<select aria-label="记录类型" value={draft.kind} onChange={e=>update({kind:e.target.value,targetId:['CORRECTION','VOID'].includes(e.target.value)?draft.targetId:''})}>{kinds.map(kind=><option key={kind} value={kind}>{labels[kind]}</option>)}</select></label>
          <label>所属系统<input aria-label="所属系统" required maxLength={120} value={draft.service} readOnly={!!draft.incidentId} placeholder="例如：支付服务 / 数据库" onChange={e=>update({service:e.target.value})}/></label>
          <label>严重程度<select aria-label="严重程度" value={draft.severity} onChange={e=>update({severity:e.target.value})}>{['INFO','WARNING','CRITICAL'].map(level=><option key={level} value={level}>{labels[level]}</option>)}</select></label>
          <label>发生时分（{meta.timezone}）<input aria-label="发生时分" type="time" value={draft.time} onChange={e=>update({time:e.target.value,eventDate:meta.today})}/><small>留空使用提交时刻，仅限 {meta.today}。</small></label>
        </div>
        <label>标题<input aria-label="登记标题" required maxLength={160} value={draft.title} placeholder="简要说明发生了什么" onChange={e=>update({title:e.target.value})}/></label>
        {['CORRECTION','VOID'].includes(draft.kind) && <label>原记录编号<input aria-label="原记录编号" required value={draft.targetId} placeholder="在原记录上点击“追加更正”会自动带入" onChange={e=>update({targetId:e.target.value})}/></label>}
        <label>详情 / 处置经过<textarea aria-label="登记详情" required maxLength={32768} rows={5} value={draft.content} placeholder="记录现象、影响范围、已做操作、证据和下一步。初报不要求填出尚未确认的根因。" onChange={e=>update({content:e.target.value})}/></label>
        <label>证据附件<input aria-label="证据附件" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/avif,application/pdf" onChange={e=>{void upload(e.target.files);e.target.value='';}}/><small>图片 / PDF，每个文件不超过 {meta.uploadLimitBytes/1024/1024} MiB，最多 20 个。日志片段可粘贴到正文。</small></label>
      </fieldset>
      {!!draft.attachments.length && <div className="ywdj-draft-files">{draft.attachments.map(file=><div key={file.id}><a href={file.url} target="_blank" rel="noreferrer">{file.filename}</a><button type="button" className="ywdj-text-button" disabled={locked} onClick={()=>void remove(file)}>移除草稿附件</button></div>)}</div>}
      {storageWarning && <p role="alert" className="ywdj-error">{storageWarning}</p>}
      {draft.pending && <p className="ywdj-warning">正在确认提交结果。网络中断时请原样重试，不要另外新建相同记录；原请求已保存在本浏览器。</p>}
      {error && <p role="alert" className="ywdj-error">{error}</p>}
      <div className="ywdj-form-footer"><span className="ywdj-muted">登记人和登记时间由服务器自动填写。草稿只保存在本浏览器。</span><button className="ywdj-button" type="submit" disabled={busy}>{busy?'处理中…':draft.pending?'原样重试确认提交':'正式提交并锁定'}</button></div>
    </form>
  </section>;
}
