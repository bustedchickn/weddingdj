import {doc, increment, runTransaction, serverTimestamp, Timestamp, updateDoc, type Firestore} from 'firebase/firestore';

export function cleanSongText(value: string) {
  const text = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 120 || /https?:\/\//i.test(text) || !/[\p{L}\p{N}]/u.test(text)) throw Error('Enter a song title and artist using 1–120 characters, without links.');
  return text;
}
export async function songKey(title: string, artist: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${normalize(title)}\n${normalize(artist)}`));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
const epoch = Timestamp.fromMillis(0);
const initial = () => ({submissions: 0, votes: 0, lastSubmitAt: epoch, lastVoteAt: epoch});

export async function guestAction(db: Firestore, event: string, uid: string, action: 'submit' | 'vote', input: {title?: string; artist?: string; requestId?: string; honeypot?: string}) {
  if (!uid) throw Error('Reconnect before requesting a song.');
  if (input.honeypot) throw Error('Submission blocked.');
  const title = action === 'submit' ? cleanSongText(input.title || '') : '';
  const artist = action === 'submit' ? cleanSongText(input.artist || '') : '';
  const id = action === 'submit' ? await songKey(title, artist) : input.requestId;
  if (!id || !/^[a-zA-Z0-9_-]{43}$/.test(id)) throw Error('Invalid song request.');
  const song = doc(db, 'events', event, 'requests', id);
  const receipt = doc(db, 'events', event, 'votes', id, 'guests', uid);
  const participant = doc(db, 'events', event, 'participants', uid);
  try {
    return await runTransaction(db, async transaction => {
      const [songSnapshot, receiptSnapshot, participantSnapshot] = await Promise.all([transaction.get(song), transaction.get(receipt), transaction.get(participant)]);
      if (receiptSnapshot.exists()) throw Error('You have already requested or voted for this song.');
      const previous = participantSnapshot.exists() ? participantSnapshot.data() : initial();
      const field = action === 'submit' ? 'submissions' : 'votes';
      const maximum = action === 'submit' ? 5 : 50;
      if (previous[field] >= maximum) throw Error(`You have reached the ${maximum} ${action === 'submit' ? 'submission' : 'vote'} limit for this event.`);
      const last = action === 'submit' ? previous.lastSubmitAt : previous.lastVoteAt;
      if (Date.now() - last.toMillis() < (action === 'submit' ? 30_000 : 2_000)) throw Error('Please wait a moment before trying again.');
      if (songSnapshot.exists() && !['pending', 'approved'].includes(songSnapshot.data().status)) throw Error('This song has already been reviewed or played.');
      if (action === 'vote' && !songSnapshot.exists()) throw Error('This request no longer exists.');
      const now = serverTimestamp();
      if (songSnapshot.exists()) transaction.update(song, {votes: increment(1), updatedAt: now});
      else transaction.set(song, {title, artist, status: 'pending', priority: 0, votes: 1, createdAt: now, updatedAt: now});
      transaction.set(receipt, {createdAt: now});
      transaction.set(participant, {
        submissions: previous.submissions + (action === 'submit' ? 1 : 0), votes: previous.votes + (action === 'vote' ? 1 : 0),
        lastSubmitAt: action === 'submit' ? now : previous.lastSubmitAt, lastVoteAt: action === 'vote' ? now : previous.lastVoteAt,
        lastAt: now, lastKind: action, lastRequestId: id
      });
      return {id, duplicate: songSnapshot.exists()};
    });
  } catch (error) {
    if ((error as {code?: string}).code === 'permission-denied') throw Error('The request was not allowed. The event may be closed or a submission limit may apply.');
    throw error;
  }
}
export async function moderateSong(db: Firestore, event: string, id: string, status: string, priority: number) {
  if (!['pending', 'approved', 'rejected', 'played'].includes(status) || !Number.isInteger(priority) || priority < 0 || priority > 1000) throw Error('Invalid moderation change.');
  await updateDoc(doc(db, 'events', event, 'requests', id), {status, priority, moderatedAt: serverTimestamp(), updatedAt: serverTimestamp()});
}
