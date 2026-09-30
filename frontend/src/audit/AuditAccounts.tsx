import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { rpc, type AuditMeta } from './api';
import { useAuth } from '@/contexts/AuthContext';
interface Member { name: string; username: string; displayName?: string; role: string; state: string }
async function members() {
  const result: Member[]=[]; let pageToken='';
  do {
    const page=await rpc<{users:Member[];nextPageToken?:string}>('UserService','ListUsers',{showDeleted:true,pageSize:50,pageToken});
    result.push(...page.users); pageToken=page.nextPageToken || '';
  } while(pageToken);
  return result;
}
export default function AuditAccounts({meta}:{meta:AuditMeta}) {
  const {logout}=useAuth(), client=useQueryClient();
  const admin=meta.user.role==='ADMIN';
  const list=useQuery({queryKey:['audit','members'],queryFn:members,enabled:admin});
  const [username,setUsername]=useState(''), [displayName,setDisplayName]=useState(''), [password,setPassword]=useState(''), [role,setRole]=useState('USER');
  const [ownPassword,setOwnPassword]=useState(''), [busy,setBusy]=useState(false), [message,setMessage]=useState(''), [error,setError]=useState('');
  const createMember=async(e:FormEvent)=>{
    e.preventDefault(); if(busy)return; setBusy(true);setError('');setMessage('');
    try {
      await rpc('UserService','CreateUser',{user:{username,displayName,password,role}});
      setPassword('');setUsername('');setDisplayName('');setMessage('成员已创建。请通过安全渠道交付初始密码。');
      await client.invalidateQueries({queryKey:['audit','members']});
    } catch(err){setError(err instanceof Error?err.message:'创建失败');} finally{setBusy(false);}
  };
  const toggle=async(member:Member)=>{
    if(busy || !window.confirm(`确认${member.state==='NORMAL'?'停用':'启用'}账号 ${member.username}？已有登记记录会永久保留。`))return;
    setBusy(true);setError('');setMessage('');
    try{
      await rpc('UserService','UpdateUser',{user:{name:member.name,state:member.state==='NORMAL'?'ARCHIVED':'NORMAL'},updateMask:'state'});
      await client.invalidateQueries({queryKey:['audit','members']}); setMessage('账号状态已更新，已有记录未改变。');
    }catch(err){setError(err instanceof Error?err.message:'更新失败');}finally{setBusy(false);}
  };
  const changePassword=async(e:FormEvent)=>{
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      await rpc('UserService','UpdateUser',{user:{name:`users/${meta.user.username}`,password:ownPassword},updateMask:'password'});
      setOwnPassword(''); await logout();
    }catch(err){setError(err instanceof Error?err.message:'密码修改失败');}finally{setBusy(false);}
  };
  return <section className="ywdj-panel">
    <h2>账号与访问权限</h2><p className="ywdj-muted">第一版为单团队共享台账：所有启用的成员可以查看本实例正式记录。普通用户不能新增账号；停用账号不会删除历史记录。</p>
    {error && <p role="alert" className="ywdj-error">{error}</p>}{message && <p role="status" className="ywdj-success">{message}</p>}
    <h3>修改我的密码</h3><form className="ywdj-inline-form" onSubmit={changePassword}>
      <label>新密码<input aria-label="我的新密码" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={ownPassword} onChange={e=>setOwnPassword(e.target.value)}/></label>
      <button className="ywdj-button secondary" disabled={busy}>修改并重新登录</button>
    </form>
    {admin && <>
      <h3>添加成员</h3><form className="ywdj-form" onSubmit={createMember}>
        <div className="ywdj-grid"><label>用户名<input aria-label="成员用户名" required maxLength={80} pattern="(?:[a-zA-Z0-9]|-)+" value={username} onChange={e=>setUsername(e.target.value)} placeholder="字母、数字和连字符"/></label>
          <label>显示姓名<input aria-label="成员显示姓名" maxLength={80} value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>
          <label>初始密码<input aria-label="成员初始密码" type="password" required autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label>
          <label>权限<select aria-label="成员权限" value={role} onChange={e=>setRole(e.target.value)}><option value="USER">普通用户</option><option value="ADMIN">管理员</option></select></label></div>
        <div><button className="ywdj-button" disabled={busy}>创建成员</button></div>
      </form>
      <h3>成员列表</h3>{list.isLoading && <p>正在读取成员…</p>}{list.error && <p role="alert" className="ywdj-error">{list.error.message}</p>}
      <div className="ywdj-members">{list.data?.map(member=><div key={member.name}>
        <div><strong>{member.displayName||member.username}</strong><span className="ywdj-muted"> {member.username} · {member.role==='ADMIN'?'管理员':'普通用户'} · {member.state==='NORMAL'?'已启用':'已停用'}</span></div>
        <button className="ywdj-button secondary" disabled={busy||member.username===meta.user.username} onClick={()=>void toggle(member)}>{member.state==='NORMAL'?'停用':'启用'}</button>
      </div>)}</div>
    </>}
  </section>;
}
