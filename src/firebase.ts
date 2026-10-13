import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, getFirestore, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { guestAction, moderateSong } from './requests/store';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
export interface SongRequest { id: string; title: string; artist: string; votes: number; status: 'pending' | 'approved' | 'rejected' | 'played'; priority: number }
const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
export const firebaseConfigured = !!(config.apiKey && config.projectId && config.appId);
export const eventId: string = import.meta.env.VITE_EVENT_ID || 'wedding-2026-10-24';
let services: ReturnType<typeof createServices> | undefined;
function createServices() {
  const app = initializeApp(config);
  if (!window.dj && import.meta.env.VITE_RECAPTCHA_SITE_KEY) initializeAppCheck(app, {provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true});
  return {auth: getAuth(app), db: getFirestore(app)};
}
export function firebase() { if (!firebaseConfigured) throw Error('Guest requests are not configured.'); return services ??= createServices(); }
export async function guestSignIn() { const {auth} = firebase(); if (!auth.currentUser) await signInAnonymously(auth); }
export function listenRequests(next: (requests: SongRequest[], cached: boolean) => void, fail: (error: Error) => void) {
  return onSnapshot(query(collection(firebase().db, 'events', eventId, 'requests'), orderBy('createdAt', 'desc'), limit(200)), {includeMetadataChanges: true}, snapshot => {
    const requests = snapshot.docs.flatMap(doc => {
      const data = doc.data();
      if (typeof data.title !== 'string' || typeof data.artist !== 'string' || !Number.isFinite(data.votes) || !Number.isFinite(data.priority) || !['pending','approved','rejected','played'].includes(data.status)) return [];
      return [{id: doc.id, title: data.title.slice(0, 120), artist: data.artist.slice(0, 120), votes: data.votes, status: data.status, priority: data.priority} as SongRequest];
    });
    next(requests, snapshot.metadata.fromCache);
  }, fail);
}
export async function submitRequest(title: string, artist: string, honeypot: string) { await guestSignIn(); return guestAction(firebase().db, eventId, firebase().auth.currentUser!.uid, 'submit', {title, artist, honeypot}); }
export async function voteRequest(requestId: string) { await guestSignIn(); return guestAction(firebase().db, eventId, firebase().auth.currentUser!.uid, 'vote', {requestId}); }
export async function moderateRequest(requestId: string, status: SongRequest['status'], priority: number) { return moderateSong(firebase().db, eventId, requestId, status, priority); }
