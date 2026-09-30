import type { Env } from '../types';
import type { AuthContext } from '../v2/auth';
import { invalidArgument } from '../v2/connect';

export const KINDS = ['ALERT', 'INCIDENT', 'ACTION', 'RECOVERY', 'REVIEW', 'CORRECTION', 'VOID'] as const;
export const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';
export const UID_PATTERN = /^[a-zA-Z0-9-]{1,80}$/;

export function timezone(env: Pick<Env, 'AUDIT_TIMEZONE'>): string {
  const value = env.AUDIT_TIMEZONE || DEFAULT_TIMEZONE;
  // Misconfiguration fails closed; never silently switch a deployment's business date.
  new Intl.DateTimeFormat('en', { timeZone: value }).format();
  return value;
}
export function businessDate(ms: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function occurredAt(value: unknown, now: number, zone: string): number {
  if (value === undefined || value === '') return now;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !validDate(value.slice(0, 10))) {
    throw invalidArgument('事件时间必须是带时区的 ISO 时间');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > now) throw invalidArgument('事件时间无效或晚于服务器当前时间');
  if (businessDate(parsed, zone) !== businessDate(now, zone)) throw invalidArgument('只能登记业务时区当天发生的事项；旧事故的新进展请用今天的时间追加');
  return parsed;
}
export function text(value: unknown, label: string, max: number, optional = false): string {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalidArgument(`${label}需要 1–${max} 个字符`);
  return value.trim();
}
export function identifier(value: unknown, label: string, optional = false): string {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !UID_PATTERN.test(value)) throw invalidArgument(`${label}格式不正确`);
  return value;
}
export async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export function logStatement(env: Env, auth: AuthContext | null, action: string, target: string, details: unknown = {}, outcome = 'SUCCESS', onlyIfChanged = false) {
  return env.DB.prepare(`INSERT INTO audit_log(created_at, actor_id, actor_username, action, target, outcome, details) ${onlyIfChanged ? 'SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1' : 'VALUES (?, ?, ?, ?, ?, ?, ?)'}`)
    .bind(Date.now(), auth?.userId ?? null, auth?.username ?? 'setup', action, target, outcome, JSON.stringify(details));
}
