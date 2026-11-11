import {Icon} from '../icon';
import React,{useState} from 'react';
import {useNavigate} from '@tanstack/react-router';
import {useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {mutate} from '../api';

export function LoginPage(){const [secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(0);const navigate=useNavigate(),qc=useQueryClient();
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!secret)return;setBusy(true);setError('');setProgress(0);try{
  const {default:Cap}=await import('cap-widget');
  const widget=new Cap({apiEndpoint:'/api/auth/cap/'});widget.addEventListener('progress',e=>setProgress(Math.round(e.detail.progress)));
  const proof=await widget.solve();if(!proof.success||!proof.token)throw new Error('无法完成人机验证，请重试。');
  await mutate('/auth/login',{secret,capToken:proof.token});setSecret('');await qc.invalidateQueries({queryKey:['auth-session']});navigate({to:'/'});
 }catch(e){setError(e instanceof Error?e.message:'登录失败');}finally{setBusy(false);}};
 return <div className="login-page"><Card className="login-panel" padding={6}><div className="login-logo">R</div><h1>登录 Recalloom</h1><p className="muted">使用现有 OAuth 授权密钥访问管理控制台。</p><form onSubmit={submit} className="login-form"><TextInput label="授权密钥" type="password" value={secret} onChange={setSecret} isRequired autoComplete="off" placeholder="输入 MCP_AUTH_SECRET"/>{error&&<Banner status="error" container="section" title="登录失败" description={error}/>}<Button label={busy?'验证中…':'登录'} variant="primary" type="submit" width="100%" isDisabled={!secret||busy} isLoading={busy}/>{busy&&<p className="muted small">人机验证 {progress?progress+'%':'进行中'}，请勿关闭页面。</p>}</form><p className="login-foot"><Icon name="shield" size="sm"/>密钥仅用于登录，不会保存在浏览器中。登录后通过安全会话访问 API。</p></Card></div>;
}
