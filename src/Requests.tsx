import { useEffect, useState } from 'react';
import { Check, ChevronUp, QrCode, Search, Users, X } from 'lucide-react';
import QRCode from 'qrcode';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { firebase, firebaseConfigured, listenRequests, moderateRequest, type SongRequest } from './firebase';
export default function Requests({guestUrl, onSearch, onError}: {guestUrl: string; onSearch: (query: string) => void; onError: (message: string) => void}) {
  const [requests, setRequests] = useState<SongRequest[]>([]); const [status, setStatus] = useState(firebaseConfigured ? 'Sign in to moderate' : 'Optional · not connected');
  const [signedIn, setSignedIn] = useState(false); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [qr, setQR] = useState(''); const [showQR, setShowQR] = useState(false); const [busy, setBusy] = useState(false); const [filter, setFilter] = useState('pending');
  useEffect(() => {
    let canceled = false; setQR('');
    if (guestUrl) {
      try { const parsed = new URL(guestUrl); if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) return; QRCode.toDataURL(guestUrl, {width: 200, margin: 2, color: {dark: '#101217', light: '#ffffff'}}).then(data => { if (!canceled) setQR(data); }).catch(e => onError(String(e))); } catch {}
    }
    return () => { canceled = true; };
  }, [guestUrl]);
  useEffect(() => {
    if (!firebaseConfigured) return;
    try {
      return listenRequests((items, cached) => { setRequests(items); setStatus(cached ? 'Offline · showing cached requests' : 'Live requests connected'); }, error => { setStatus('Connection unavailable · local audio unaffected'); onError(`Guest requests: ${error.message}`); });
    } catch (error) {
      setStatus('Configuration unavailable · local audio unaffected');
      onError(`Guest requests could not initialize: ${String(error)}`);
    }
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const credential = await signInWithEmailAndPassword(firebase().auth, email, password);
      const token = await credential.user.getIdTokenResult(true);
      if (token.claims.dj !== true) { await signOut(firebase().auth); throw Error('This account does not have the DJ moderator claim. See setup instructions.'); }
      setSignedIn(true); setPassword('');
    } catch (e) { onError(`DJ sign-in failed: ${String(e)}`); } finally { setBusy(false); }
  }
  async function moderate(request: SongRequest, next: SongRequest['status'], priority = request.priority) {
    setBusy(true); try { await moderateRequest(request.id, next, priority); } catch (e) { onError(`Moderation failed: ${String(e)}`); } finally { setBusy(false); }
  }
  const visible = requests.filter(r => r.status === filter).sort((a,b) => b.priority - a.priority || b.votes - a.votes);
  return <section className="panel requests-panel"><div className="panel-heading"><h2><Users size={18}/> Guest requests <span className="count">{requests.filter(r => r.status === 'pending').length}</span></h2><button disabled={!qr} title={qr ? 'Show guest QR code' : 'Set an HTTPS guest webpage URL in settings'} onClick={() => setShowQR(!showQR)}><QrCode size={14}/> Guest QR</button></div><div className="request-status"><span className={`status-dot ${status.startsWith('Live') ? '' : 'dim'}`}/>{status}<select aria-label="Request status filter" value={filter} onChange={e => setFilter(e.target.value)}>{['pending','approved','played','rejected'].map(s => <option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>)}</select></div>{showQR && qr && <div className="qr-box"><img src={qr} alt="Scan to request a song"/><div><strong>Let your guests join the soundtrack</strong><p>Scan to request a song or vote.</p><small>{guestUrl}</small></div><button aria-label="Close QR" onClick={() => setShowQR(false)}><X size={14}/></button></div>}<div className="request-scroll">{visible.map(r => <div className="request-item" key={r.id}><span className="votes"><ChevronUp size={13}/>{r.votes}</span><div className="request-title"><strong>{r.title}</strong><small>{r.artist || 'Artist not specified'}{r.priority > 0 ? ` · Priority ${r.priority}` : ''}</small></div><div className="request-actions">{r.status === 'approved' && <button title="Find local music — add to queue manually" onClick={() => onSearch(r.title)}><Search size={14}/></button>}{signedIn && <><button disabled={busy} title={r.status === 'approved' ? 'Mark played' : 'Approve request'} onClick={() => void moderate(r, r.status === 'approved' ? 'played' : 'approved')}><Check size={14}/></button><button disabled={busy} title="Prioritize approved request" onClick={() => void moderate(r, r.status, r.priority + 1)}><ChevronUp size={14}/></button><button disabled={busy} title="Reject request" onClick={() => void moderate(r, 'rejected')}><X size={14}/></button></>}</div></div>)}{!visible.length && <div className="request-empty"><Users size={26}/><strong>{firebaseConfigured ? 'Waiting for your guests’ favorites' : 'The dance floor, by popular request'}</strong><p>{firebaseConfigured ? 'Requests appear here. Approval always stays with the DJ.' : 'Connect Firebase to receive requests and votes from guests.'}</p></div>}</div>{firebaseConfigured && !signedIn && <form className="moderator-login" onSubmit={login}><input aria-label="DJ email" type="email" placeholder="DJ email" value={email} onChange={e => setEmail(e.target.value)} required/><input aria-label="DJ password" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required/><button disabled={busy}>Sign in</button></form>}{signedIn && <div className="moderator-footer">DJ moderation active <button onClick={() => { void signOut(firebase().auth); setSignedIn(false); }}>Sign out</button></div>}<div className="request-footer">Approved requests are matched to your local library manually.</div></section>;
}
