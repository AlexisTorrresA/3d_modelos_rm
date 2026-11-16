import {useEffect,useState} from 'react';
import App from './App.jsx';

export default function AuthApp(){
 const [authorized,setAuthorized]=useState(null);
 const [password,setPassword]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
   fetch('/api/auth/me',{cache:'no-store'}).then(r=>setAuthorized(r.ok)).catch(()=>setAuthorized(false));
 },[]);
 async function login(e){
  e.preventDefault();setBusy(true);setError('');
  try{
   const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
   if(!res.ok){const body=await res.json();throw new Error(body.detail||'Acceso denegado');}
   setPassword('');setAuthorized(true);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function logout(){
  await fetch('/api/auth/logout',{method:'POST'});
  setAuthorized(false);
 }
 if(authorized===null)return <div className="auth-shell">Verificando acceso…</div>;
 if(authorized)return <><App/><button className="logout-button" onClick={logout}>Cerrar sesión</button></>;
 return <div className="auth-shell">
  <form className="auth-card" onSubmit={login}>
   <div className="auth-symbol">✦</div>
   <span className="auth-eyebrow">RESONANCIAS MAGNÉTICAS · VISOR SEGURO</span>
   <h1>RM Studio 3D</h1>
   <p>Accede a tus estudios DICOM e informes médicos.</p>
   <label htmlFor="admin-password">Contraseña de acceso</label>
   <input id="admin-password" autoFocus type="password" autoComplete="current-password"
     required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Introduce tu contraseña"/>
   {error&&<div className="auth-error" role="alert">{error}</div>}
   <button type="submit" disabled={busy}>{busy?'Validando…':'Ingresar al visor'}</button>
   <small>Los estudios médicos son privados. Uso exploratorio, no diagnóstico.</small>
  </form>
 </div>;
}
