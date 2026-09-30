import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { CreateRecord, Evidence } from './api';
dayjs.extend(utc); dayjs.extend(timezone);
export interface Draft {
  requestId: string; kind: string; title: string; service: string; severity: string; content: string;
  time: string; eventDate: string; incidentId: string; targetId: string; attachments: Evidence[]; pending: CreateRecord | null;
}
export const freshDraft = (): Draft => ({ requestId:crypto.randomUUID(), kind:'ALERT', title:'', service:'', severity:'WARNING', content:'', time:'', eventDate:'', incidentId:'', targetId:'', attachments:[], pending:null });
export const draftKey = (userId: number) => `ywdj-draft-v1-${userId}`;
export function loadDraft(userId: number): Draft {
  const initial=freshDraft();
  try {
    const raw=localStorage.getItem(draftKey(userId));
    if (!raw || raw.length > 200000) return initial;
    const saved=JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || !Array.isArray(saved.attachments)) return initial;
    for (const field of ['requestId','kind','title','service','severity','content','time','incidentId','targetId']) if (typeof saved[field] !== 'string') return initial;
    return { ...initial, ...saved };
  } catch { return initial; }
}
export function eventTime(today: string, time: string, zone: string): string | undefined {
  if (!time) return undefined;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) throw new Error('事件时分格式不正确');
  const normalized = time.length === 5 ? `${time}:00` : time;
  const parsed = dayjs.tz(`${today} ${normalized}`, 'YYYY-MM-DD HH:mm:ss', zone);
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD HH:mm:ss') !== `${today} ${normalized}`) throw new Error('所选业务时区不存在这个时间');
  return parsed.toISOString();
}
