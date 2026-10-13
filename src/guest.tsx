import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Heart, Music2, ChevronUp, Check } from 'lucide-react';
import { firebaseConfigured, guestSignIn, listenRequests, submitRequest, voteRequest, type SongRequest } from './firebase';
import './styles.css';
import RotatingPhrase from './RotatingPhrase';
function Guest() {
  const live = firebaseConfigured && import.meta.env.VITE_GUEST_PREVIEW !== 'true';
  const [requests, setRequests] = useState<SongRequest[]>([]); const [title, setTitle] = useState(''); const [artist, setArtist] = useState(''); const [website, setWebsite] = useState('');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [offline, setOffline] = useState(false); const [voted, setVoted] = useState<string[]>([]);
  useEffect(() => {
    if (!live) return;
    let stop: (() => void) | undefined; let canceled = false;
    guestSignIn().then(() => { if (!canceled) stop = listenRequests((items, cached) => { setRequests(items.filter(r => r.status !== 'rejected')); setOffline(cached); }, e => { setMessage(`Requests are unavailable: ${e.message}`); setOffline(true); }); }).catch(() => { setMessage('Could not connect. Please try again when you have internet access.'); setOffline(true); });
    return () => { canceled = true; stop?.(); };
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!live) { setMessage('This is a page preview. Song submissions and voting are not enabled.'); return; }
    setBusy(true); setMessage('');
    try { const result = await submitRequest(title, artist, website); setVoted(old => [...old, result.id]); setMessage('Your request is in! The DJ will review it. If it already exists, we added your vote.'); setTitle(''); setArtist(''); }
    catch (e) { setMessage(`Could not submit: ${String(e)}`); } finally { setBusy(false); }
  }
  async function vote(id: string) { setBusy(true); try { await voteRequest(id); setVoted(old => [...old, id]); setMessage('Vote added. Thank you!'); } catch (e) { setMessage(`Could not vote: ${String(e)}`); } finally { setBusy(false); } }
  return <div className="guest-shell">
    <div className="guest-brand"><Heart size={22}/> October 24, 2026</div>
    <h1 aria-label="Make it a night to remember."><span aria-hidden="true">Make it <RotatingPhrase/><span className="remember-line">to <em>remember.</em></span></span></h1>
    <p className="guest-intro">A favorite song. A full dance floor.<br/>Help us soundtrack the celebration.</p>
    {!live && <div className="guest-message preview-banner" role="status"><strong>Guest page preview</strong><br/>Explore the layout below. Song submissions, votes, and DJ moderation are not connected in this free hosting-only deployment.</div>}
    <form className="guest-form" onSubmit={submit}>
      <h2><Music2 size={20}/> What would you love to hear?</h2>
      <label>Song title<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="That one song you can’t sit still to"/></label>
      <label>Artist<input required maxLength={120} value={artist} onChange={e => setArtist(e.target.value)} placeholder="Who sings it?"/></label>
      <div className="honeypot" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)}/></label></div>
      <button className="guest-submit" disabled={!live || busy || offline}>{!live ? 'Requests not enabled' : busy ? 'One moment…' : 'Send to the DJ'} <span>→</span></button>
      <small>{live ? 'No account needed · 5 submissions per guest · Please keep it reception-friendly.' : 'Preview only · nothing entered here is sent or saved.'}</small>
    </form>
    {message && <div className="guest-message" role="status">{message}</div>}
    {offline && <p className="guest-message">Connection unavailable. Votes and requests need internet access.</p>}
    <div className="guest-list-heading"><h2>On the wish list</h2><span>{requests.length} requests</span></div>
    <p className="guest-list-hint">{live ? 'See your favorite? Give it a vote.' : 'Live requests will appear here when the backend is enabled.'}</p>
    <div className="guest-list">{[...requests].sort((a,b) => b.votes-a.votes).map(r => <div className="guest-request" key={r.id}>
      <div><strong>{r.title}</strong><p>{r.artist}</p><small>{r.status === 'approved' ? 'DJ approved' : r.status === 'played' ? 'Played with love' : 'Awaiting DJ review'}</small></div>
      <button aria-label={`Vote for ${r.title}`} disabled={!live || busy || offline || voted.includes(r.id) || r.status === 'played'} onClick={() => void vote(r.id)}>{voted.includes(r.id) ? <Check size={18}/> : <ChevronUp size={18}/>} {r.votes}</button>
    </div>)}{live && !requests.length && <p className="guest-list-hint">Be the first to request a favorite.</p>}</div>
    <footer className="guest-footer">Made for a celebration. Chosen with love.<br/>Song requests are suggestions; the DJ makes the final call.</footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Guest/>);
