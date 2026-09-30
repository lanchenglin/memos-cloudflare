import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/connect',()=>({getRequestToken:vi.fn(async()=> 'test-token'),refreshAccessToken:vi.fn(async()=>{})}));
import { api, exportRecords } from '@/audit/api';
import { draftKey, eventTime, freshDraft, loadDraft } from '@/audit/draft';

afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});
describe('ywdj browser utilities',()=>{
  it('converts business-zone time independently of the browser timezone',()=>{
    expect(eventTime('2026-09-30','09:30','Asia/Shanghai')).toBe('2026-09-30T01:30:00.000Z');
    expect(eventTime('2026-09-30','09:30','America/Los_Angeles')).toBe('2026-09-30T16:30:00.000Z');
    expect(eventTime('2026-09-30','','Asia/Shanghai')).toBeUndefined();
  });
  it('rejects invalid or nonexistent wall-clock times',()=>{
    expect(()=>eventTime('2026-09-30','25:10','Asia/Shanghai')).toThrow();
    expect(()=>eventTime('2026-03-08','02:30','America/Los_Angeles')).toThrow();
  });
  it('isolates local drafts by account and preserves an exact pending request',()=>{
    const draft=freshDraft();draft.content='尚未提交';draft.pending={requestId:draft.requestId,kind:'ALERT',title:'测试',service:'系统',severity:'INFO',content:draft.content,attachmentIds:[]};
    localStorage.setItem(draftKey(1),JSON.stringify(draft));
    expect(loadDraft(1).pending).toEqual(draft.pending);expect(loadDraft(2).content).toBe('');
  });
  it('recovers safely from a malformed browser draft',()=>{
    localStorage.setItem(draftKey(1),'invalid');expect(loadDraft(1).content).toBe('');
  });
  it('exports all pages with a fixed snapshot rather than only the visible page',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({items:[{id:'first'}],nextCursor:'50',snapshotMaxId:80})))
      .mockResolvedValueOnce(new Response(JSON.stringify({items:[{id:'last'}],nextCursor:'',snapshotMaxId:80})));
    vi.stubGlobal('fetch',fetcher);
    const result=await exportRecords('date=2026-09-30');expect(result.records.map(r=>r.id)).toEqual(['first','last']);
    expect(fetcher.mock.calls[1][0]).toContain('until=80');expect(fetcher.mock.calls[1][0]).toContain('after=50');
  });
  it('stops a broken export cursor rather than looping or silently truncating',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({items:[],nextCursor:'1',snapshotMaxId:5}))));
    await expect(exportRecords('all=1')).rejects.toThrow('分页未推进');
  });
  it('retries an expired session once and sends credentials only to the same origin',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({message:'expired'}),{status:401}))
      .mockResolvedValueOnce(new Response(JSON.stringify({ok:true})));
    vi.stubGlobal('fetch',fetcher);expect(await api('/api/audit/meta')).toEqual({ok:true});expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1].credentials).toBe('same-origin');
  });
});
