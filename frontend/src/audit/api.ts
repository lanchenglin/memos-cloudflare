import { getRequestToken, refreshAccessToken } from '@/connect';

export interface Evidence { id: string; filename: string; type: string; size: number; sha256: string; url: string }
export interface AuditRecord {
  id: string; sequence: number; incidentId: string; targetId: string | null; kind: string;
  title: string; service: string; severity: string; content: string; occurredAt: string; occurredDate: string;
  recordedAt: string; recordedDate: string; timezone: string; voided: boolean;
  actor: { id: number; username: string; displayName: string }; attachments: Evidence[];
}
export interface AuditMeta {
  today: string; timezone: string; serverTime: string; uploadLimitBytes: number;
  user: { id: number; username: string; role: string };
}
export interface Page<T> { items: T[]; nextCursor: string; snapshotMaxId: number; timezone?: string }
export interface CreateRecord {
  requestId: string; kind: string; title: string; service: string; severity: string; content: string;
  occurredAt?: string; incidentId?: string; targetId?: string; attachmentIds: string[];
}
export interface AuditLog { id: number; createdAt: string; actor_username: string; action: string; target: string; outcome: string; details: Record<string, unknown> }
export class AuditApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const send = async () => {
    const headers = new Headers(options.headers);
    const token = await getRequestToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(path, { ...options, headers, credentials: 'same-origin' });
  };
  let response = await send();
  if (response.status === 401) {
    try { await refreshAccessToken(); response = await send(); } catch { /* Return the actual unauthorized result below. */ }
  }
  let data: unknown;
  try { data = await response.json(); } catch { throw new AuditApiError(response.status, '服务器未返回有效数据，请保留原稿并重试'); }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data ? String(data.message) : `请求失败（${response.status}）`;
    throw new AuditApiError(response.status, message);
  }
  return data as T;
}
export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const rpc = <T,>(service: string, method: string, body: unknown) => post<T>(`/memos.api.v1.${service}/${method}`, body);
export const labels: Record<string, string> = { ALERT:'告警', INCIDENT:'事故初报', ACTION:'处置 / 操作', RECOVERY:'恢复确认', REVIEW:'复盘', CORRECTION:'更正说明', VOID:'作废说明', INFO:'一般', WARNING:'警告', CRITICAL:'严重' };
export function displayTime(value: string, zone: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' }).format(new Date(value));
}
export async function exportRecords(query: string): Promise<{ schemaVersion: string; exportedAt: string; snapshotMaxId: number; records: AuditRecord[] }> {
  const records: AuditRecord[] = []; let after = '', snapshot: number | undefined;
  do {
    const params = new URLSearchParams(query);
    if (after) params.set('after', after);
    if (snapshot !== undefined) params.set('until', String(snapshot));
    const page = await api<Page<AuditRecord>>(`/api/audit/export?${params}`);
    if (snapshot === undefined) snapshot = page.snapshotMaxId;
    records.push(...page.items);
    if (page.nextCursor && Number(page.nextCursor) <= Number(after || 0)) throw new Error('导出分页未推进，已中止');
    after = page.nextCursor;
  } while (after);
  return { schemaVersion:'ywdj-1', exportedAt:new Date().toISOString(), snapshotMaxId:snapshot ?? 0, records };
}
