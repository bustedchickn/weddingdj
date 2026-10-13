import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { eventKey, text, requestKey, checkQuota } from './validation';
initializeApp(); const db = getFirestore();
const options = {region: 'us-central1', maxInstances: 5, enforceAppCheck: true};
function guest(uid: string | undefined) { if (!uid) throw new HttpsError('unauthenticated', 'Please reconnect and try again.'); return uid; }
function validate<T>(fn: () => T): T { try { return fn(); } catch (e) { throw new HttpsError('invalid-argument', (e as Error).message); } }
async function openEvent(event: string) {
  const snap = await db.doc(`events/${event}`).get();
  if (!snap.exists || snap.data()?.open !== true) throw new HttpsError('failed-precondition', 'Requests are closed for this event.');
}
export const submitRequest = onCall(options, async request => {
  const uid = guest(request.auth?.uid); const event = validate(() => eventKey(request.data?.eventId));
  const title = validate(() => text(request.data?.title)); const artist = validate(() => text(request.data?.artist));
  if (request.data?.honeypot) throw new HttpsError('invalid-argument', 'Submission blocked.');
  await openEvent(event);
  const id = requestKey(title, artist); const base = `events/${event}`;
  const ref = db.doc(`${base}/requests/${id}`); const vote = db.doc(`${base}/votes/${id}/guests/${uid}`); const quotaRef = db.doc(`${base}/quotas/${uid}`);
  return db.runTransaction(async tx => {
    const [song, voted, quota] = await Promise.all([tx.get(ref), tx.get(vote), tx.get(quotaRef)]);
    const now = Date.now();
    try { checkQuota(quota.data()?.submissions, now, 5, 30_000); } catch (e) { throw new HttpsError('resource-exhausted', (e as Error).message); }
    if (song.exists && ['rejected','played'].includes(song.data()?.status)) throw new HttpsError('failed-precondition', 'This song has already been reviewed or played.');
    if (voted.exists) throw new HttpsError('already-exists', 'You have already requested or voted for this song.');
    if (song.exists) tx.update(ref, {votes: FieldValue.increment(1)});
    else tx.create(ref, {title, artist, votes: 1, status: 'pending', priority: 0, createdAt: FieldValue.serverTimestamp()});
    tx.create(vote, {createdAt: FieldValue.serverTimestamp()});
    tx.set(quotaRef, {submissions: {count: (quota.data()?.submissions?.count || 0) + 1, lastAt: now}}, {merge: true});
    return {id, duplicate: song.exists};
  });
});
export const voteRequest = onCall(options, async request => {
  const uid = guest(request.auth?.uid); const event = validate(() => eventKey(request.data?.eventId));
  const id = request.data?.requestId;
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new HttpsError('invalid-argument', 'Invalid request.');
  await openEvent(event); const base = `events/${event}`;
  return db.runTransaction(async tx => {
    const ref = db.doc(`${base}/requests/${id}`); const vote = db.doc(`${base}/votes/${id}/guests/${uid}`); const quotaRef = db.doc(`${base}/quotas/${uid}`);
    const [song, voted, quota] = await Promise.all([tx.get(ref), tx.get(vote), tx.get(quotaRef)]);
    if (!song.exists || ['rejected','played'].includes(song.data()?.status)) throw new HttpsError('failed-precondition', 'This request is not open for voting.');
    if (voted.exists) throw new HttpsError('already-exists', 'You have already voted for this song.');
    const now = Date.now();
    try { checkQuota(quota.data()?.votes, now, 50, 2000); } catch (e) { throw new HttpsError('resource-exhausted', (e as Error).message); }
    tx.create(vote, {createdAt: FieldValue.serverTimestamp()}); tx.update(ref, {votes: FieldValue.increment(1)});
    tx.set(quotaRef, {votes: {count: (quota.data()?.votes?.count || 0) + 1, lastAt: now}}, {merge: true}); return {ok: true};
  });
});
// Desktop moderation uses email/password + a server-issued custom claim, not App Check.
export const moderateRequest = onCall({region: 'us-central1', maxInstances: 3}, async request => {
  if (request.auth?.token.dj !== true) throw new HttpsError('permission-denied', 'DJ moderator access required.');
  const event = validate(() => eventKey(request.data?.eventId));
  const {requestId: id, status, priority} = request.data || {};
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || !['pending','approved','rejected','played'].includes(status) || !Number.isInteger(priority) || priority < 0 || priority > 1000) throw new HttpsError('invalid-argument', 'Invalid moderation change.');
  try {
    await db.doc(`events/${event}/requests/${id}`).update({status, priority, moderatedAt: FieldValue.serverTimestamp()});
  } catch (error) {
    if ((error as {code?: number})?.code === 5) throw new HttpsError('not-found', 'This song request no longer exists. Refresh the request list.');
    throw error;
  }
  return {ok: true};
});
