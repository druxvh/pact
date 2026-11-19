// Activity: 24-hour notes, hearts, comments and the activity-message inbox — who may see and write what, the server's clock, the rate
// limits, the snapshot a like carries, forged messages, cleanup — tested as different users against the real migrations.
// Run with: bun supabase/tests/activity.mjs
import fs from 'node:fs';
import { addUser, as, boot } from './setup.mjs';

let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok  ', name);
  } catch (e) {
    fail++;
    console.log('  FAIL', name, '→', e.message);
  }
};
const eq = (a, b, m = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
};
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b, m = '') => eq(canon(a), canon(b), m);
const denied = async (p, re = /./) => {
  try {
    await p;
  } catch (e) {
    if (re.test(e.message)) return;
    throw new Error(`wrong error: ${e.message}`);
  }
  throw new Error('was allowed (should be denied)');
};

const db = await boot();
const alice = await addUser(db, 'alice@x.test');
const bob = await addUser(db, 'bob@x.test'); // shares a community with alice
const carol = await addUser(db, 'carol@x.test'); // shares nothing with alice
const dave = await addUser(db, 'dave@x.test'); // shares nothing with alice

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const val = (v) => (v === null ? 'null' : q(v));
const json = (o) => `${q(JSON.stringify(o))}::jsonb`;
const n = async (sql) => (await db.query(sql)).rows[0].n;

const setVis = (uid, col, v) => as(db, uid, `update public.profiles set ${col} = ${q(v)} where id = '${uid}'`);
const notesVis = (uid, v) => setVis(uid, 'notes_visibility', v);
const songVis = (uid, v) => setVis(uid, 'now_playing_visibility', v);

// alice + bob share a community
const cid = crypto.randomUUID();
await as(db, alice, `insert into public.communities (id, name) values ('${cid}', 'Pact Club')`);
await db.query(`insert into public.community_members (community_id, user_id) values ('${cid}', '${bob}')`);

// ── fixtures ──────────────────────────────────────────────────────────────────

const SONG = {
  track_title: 'Night Drive',
  track_artist: 'The Tests',
  track_album: 'Fixtures',
  track_artwork_url: 'https://i.scdn.co/image/ab67616d00001e02',
  track_url: 'https://open.spotify.com/track/abc123',
  track_source: 'spotify',
};
const NO_SONG = { track_title: null, track_artist: null, track_album: null, track_artwork_url: null, track_url: null, track_source: null };
const note = (over = {}) => ({ body: 'Studying for finals', ...NO_SONG, ...over });
const COLS = ['body', 'track_title', 'track_artist', 'track_album', 'track_artwork_url', 'track_url', 'track_source'];
/** What the app does to post: an upsert on the person's one row, always sending every column. */
const post = (uid, over = {}) => {
  const r = note(over);
  return as(
    db,
    uid,
    `insert into public.status_notes (user_id, ${COLS.join(', ')}) values ('${uid}', ${COLS.map((c) => val(r[c])).join(', ')})
     on conflict (user_id) do update set user_id = excluded.user_id, ${COLS.map((c) => `${c} = excluded.${c}`).join(', ')}
     returning id, created_at, expires_at`,
  );
};
const rawNote = (uid) => db.query(`select * from public.status_notes where user_id = '${uid}'`).then((r) => r.rows[0]);
const noteId = async (uid) => (await rawNote(uid)).id;
const seeNote = async (viewer, owner) => (await as(db, viewer, `select id from public.status_notes where user_id = '${owner}'`)).length;
/** Make a note look `interval` older without going through the guard (which stamps the server's time). */
const ageNote = async (uid, interval) => {
  await db.exec('alter table public.status_notes disable trigger status_notes_guard_trg');
  await db.query(`update public.status_notes set created_at = created_at - interval '${interval}', expires_at = expires_at - interval '${interval}' where user_id = '${uid}'`);
  await db.exec('alter table public.status_notes enable trigger status_notes_guard_trg');
};

const TRACK = { title: 'Night Drive', artist: 'The Tests', album: 'Fixtures', artworkUrl: 'https://i.scdn.co/image/ab67616d00001e02', trackUrl: null, source: 'spotify' };
const SONG_KEY = 'spotify|night drive|the tests';
/** What the database builds for a heart on that song (the server leaves out what is empty). */
const SNAP_SONG = { kind: 'listening', track: { title: 'Night Drive', artist: 'The Tests', album: 'Fixtures', artworkUrl: 'https://i.scdn.co/image/ab67616d00001e02', source: 'spotify' } };
const songCtx = (over = {}) => ({ kind: 'listening', track: { ...TRACK, ...over } });
/** A song being played right now (written the way Now playing writes it; the guard stamps the server's time). */
const playing = (uid) =>
  db.query(
    `insert into public.now_playing (user_id, title, artist, album, artwork_url, source)
     values ('${uid}', 'Night Drive', 'The Tests', 'Fixtures', 'https://i.scdn.co/image/ab67616d00001e02', 'spotify')
     on conflict (user_id) do update set title = excluded.title`,
  );
const ageSong = async (uid, interval) => {
  await db.exec('alter table public.now_playing disable trigger now_playing_guard_trg');
  await db.query(`update public.now_playing set updated_at = now() - interval '${interval}' where user_id = '${uid}'`);
  await db.exec('alter table public.now_playing enable trigger now_playing_guard_trg');
};

const likeSql = (owner, kind, key, ctx) =>
  `insert into public.activity_likes (owner_id, kind, subject_key, context) values ('${owner}', ${q(kind)}, ${q(key)}, ${json(ctx)})`;
const like = (actor, owner, kind, key, ctx) => as(db, actor, likeSql(owner, kind, key, ctx));
const likeNote = async (actor, owner, ctx = { kind: 'note' }) => like(actor, owner, 'note', await noteId(owner), ctx);
const unlike = (actor, owner, kind, key) =>
  as(db, actor, `delete from public.activity_likes where owner_id = '${owner}' and kind = ${q(kind)} and subject_key = ${q(key)} returning id`);
const comment = (author, owner, key, body) =>
  as(db, author, `insert into public.activity_comments (owner_id, subject_key, body) values ('${owner}', ${q(key)}, ${q(body)}) returning id`);
const commentNote = async (author, owner, body) => comment(author, owner, await noteId(owner), body);
const reply = (from, to, body, ctx = null) =>
  as(db, from, `insert into public.activity_messages (recipient_id, body, context) values ('${to}', ${q(body)}, ${ctx ? json(ctx) : 'null'}) returning id`);
const messages = (where = 'true') => db.query(`select * from public.activity_messages where ${where} order by created_at, id`).then((r) => r.rows);
const likeMessages = (from, to) => messages(`kind = 'like' and sender_id = '${from}' and recipient_id = '${to}'`);
const feed = (viewer, args = 'null, null') => as(db, viewer, `select * from public.activity_feed(${args})`);
const engagement = (viewer, refs) => as(db, viewer, `select * from public.activity_engagement(${json(refs)})`);
const ref = (owner, kind, key) => ({ owner_id: owner, kind, subject_key: key });
const wipe = () =>
  db.exec(`
    delete from public.activity_messages; delete from public.activity_likes; delete from public.activity_comments;
    delete from public.status_notes; delete from public.now_playing; delete from private.activity_limits;
    delete from private.now_playing_writes;`);
const clearLimits = () => db.exec('delete from private.activity_limits');
const FRESH = async () => {
  await wipe();
  await notesVis(alice, 'communities');
  await songVis(alice, 'off');
};

// ── the setting ───────────────────────────────────────────────────────────────

console.log('who may see notes (the setting)');
await t('notes start at "communities" for every profile', async () => {
  for (const u of [alice, bob, carol, dave]) eq((await as(db, u, `select notes_visibility v from public.profiles where id = '${u}'`))[0].v, 'communities');
});
await t('the setting only takes off / communities / everyone', async () => {
  await denied(notesVis(alice, 'friends'), /profiles_notes_visibility|check/);
  await denied(notesVis(alice, ''), /profiles_notes_visibility|check/);
});
await t('you can change only your own setting', async () => {
  eq((await as(db, bob, `update public.profiles set notes_visibility = 'everyone' where id = '${alice}' returning id`)).length, 0);
  eq((await as(db, alice, `select notes_visibility v from public.profiles where id = '${alice}'`))[0].v, 'communities');
});
await t('with notes off nothing can be posted — the database refuses, whatever the client does', async () => {
  await FRESH();
  await notesVis(carol, 'off');
  await denied(post(carol), /row-level security/);
  eq(await n('select count(*)::int n from public.status_notes'), 0);
  await notesVis(carol, 'communities');
});

// ── what a note may hold, and the server's clock ──────────────────────────────

console.log('a note: its shape, and the server decides the time');
await t('a note is accepted; the server stamps created_at and expires_at = created_at + 24 hours', async () => {
  await FRESH();
  const [r] = await post(alice);
  const row = (await db.query(`select (expires_at - created_at) = interval '24 hours' as ttl, (now() - created_at) < interval '1 minute' as fresh from public.status_notes where user_id = '${alice}'`)).rows[0];
  eq([row.ttl, row.fresh, typeof r.id], [true, true, 'string']);
});
await t('a client can’t send the id, the creation time or the expiry — on insert or update', async () => {
  await FRESH();
  for (const col of ['id', 'created_at', 'expires_at']) {
    await denied(
      as(db, alice, `insert into public.status_notes (user_id, body, ${col}) values ('${alice}', 'x', ${col === 'id' ? `'${crypto.randomUUID()}'` : `now() + interval '30 days'`})`),
      /permission denied/,
    );
  }
  await post(alice);
  await denied(as(db, alice, `update public.status_notes set expires_at = now() + interval '30 days' where user_id = '${alice}'`), /permission denied/);
  await denied(as(db, alice, `update public.status_notes set created_at = now() where user_id = '${alice}'`), /permission denied/);
  await denied(as(db, alice, `update public.status_notes set id = gen_random_uuid() where user_id = '${alice}'`), /permission denied/);
});
await t('even the table’s owner can’t back-date or forward-date a note through a normal write', async () => {
  await FRESH();
  await db.query(`insert into public.status_notes (user_id, body, created_at, expires_at) values ('${alice}', 'x', now() - interval '3 days', now() - interval '2 days')`);
  const r = (await db.query(`select expires_at > now() + interval '23 hours' as live from public.status_notes`)).rows[0];
  eq(r.live, true);
});
await t('text: at most 60 characters, trimmed, nothing empty unless a song is attached', async () => {
  await FRESH();
  await post(alice, { body: 'a'.repeat(60) });
  await denied(post(alice, { body: 'a'.repeat(61) }), /status_notes_body_length|check/);
  await post(alice, { body: '   hello  ' });
  eq((await rawNote(alice)).body, 'hello');
  await denied(post(alice, { body: '' }), /status_notes_not_empty|check/);
  await denied(post(alice, { body: '    ' }), /status_notes_not_empty|check/);
  await post(alice, { body: '', ...SONG }); // a song-only note
  eq((await rawNote(alice)).track_title, 'Night Drive');
});
await t('control characters, line breaks, zero-width characters and bidi overrides are refused', async () => {
  await FRESH();
  for (const body of ['a\nb', 'a\tb', `a${String.fromCodePoint(0x1b)}b`, `a${String.fromCodePoint(0x202e)}b`, `a${String.fromCodePoint(0x200b)}b`, `a${String.fromCodePoint(0xfeff)}b`, `a${String.fromCodePoint(0x2028)}b`]) {
    await denied(post(alice, { body }), /status_notes_body_clean|check/);
  }
  await post(alice, { body: 'Sür Ma Ruh — 夜に駆ける 🎧' }); // ordinary non-Latin text and emoji are fine
});
await t('a song is all or nothing: a title and a service, or none of the song columns', async () => {
  await FRESH();
  await denied(post(alice, { track_title: 'x' }), /status_notes_track_shape|check/);
  await denied(post(alice, { track_source: 'spotify' }), /status_notes_track_shape|check/);
  await denied(post(alice, { track_artist: 'only an artist' }), /status_notes_track_shape|check/);
  await denied(post(alice, { track_url: 'https://open.spotify.com/track/abc' }), /status_notes_track_shape|check/);
  await post(alice, { track_title: 'Just a title', track_source: 'spotify' }); // artist / album default to empty
  const r = await rawNote(alice);
  eq([r.track_artist, r.track_album], ['', '']);
});
await t('song text: title 1–150, artist / album ≤ 150, no hidden characters, a known service', async () => {
  await FRESH();
  await post(alice, { ...SONG, track_title: 'a'.repeat(150), track_artist: 'b'.repeat(150), track_album: 'c'.repeat(150) });
  await denied(post(alice, { ...SONG, track_title: 'a'.repeat(151) }), /status_notes_track_title|check/);
  await denied(post(alice, { ...SONG, track_artist: 'b'.repeat(151) }), /status_notes_track_artist|check/);
  await denied(post(alice, { ...SONG, track_album: 'c'.repeat(151) }), /status_notes_track_album|check/);
  await denied(post(alice, { ...SONG, track_title: `a${String.fromCodePoint(0x202e)}b` }), /status_notes_track_title|check/);
  await denied(post(alice, { ...SONG, track_artist: 'a\nb' }), /status_notes_track_artist|check/);
  await denied(post(alice, { ...SONG, track_source: 'napster' }), /status_notes_track_source|check/);
  await denied(post(alice, { ...SONG, track_source: 'Spotify' }), /status_notes_track_source|check/);
});
await t('the song’s image and link must be https on the service’s OWN hosts — nothing a person could choose themselves', async () => {
  await FRESH();
  for (const [src, art, link] of [
    ['spotify', 'https://i.scdn.co/image/abc', 'https://open.spotify.com/track/abc'],
    ['youtube-music', 'https://lh3.googleusercontent.com/abc', 'https://music.youtube.com/watch?v=abc'],
    ['soundcloud', 'https://i1.sndcdn.com/artworks-abc.jpg', 'https://soundcloud.com/a/b'],
    ['apple-music', 'https://is1-ssl.mzstatic.com/x.jpg', 'https://music.apple.com/us/album/x/1'],
    ['deezer', 'https://cdn-images.dzcdn.net/x.jpg', 'https://www.deezer.com/track/1'],
    ['tidal', 'https://resources.tidal.com/x.jpg', 'https://listen.tidal.com/track/1'],
  ]) {
    await post(alice, { ...SONG, track_source: src, track_artwork_url: art, track_url: link });
  }
  const badArt = [
    'https://evil.example/i.scdn.co/image/abc',
    'https://i.scdn.co.evil.example/image/abc',
    'https://notscdn.co/x.jpg',
    'https://i.scdn.co@evil.example/x.jpg',
    'http://i.scdn.co/x.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '//i.scdn.co/x.jpg',
    'https://i.scdn.co:8443/x.jpg',
    'https://192.168.0.1/x.jpg',
    'https://images.weserv.nl/?url=i.scdn.co/x',
    `https://i.scdn.co/${'a'.repeat(500)}`,
    'https://i.ytimg.com/vi/x/hq720.jpg', // another service's image host
  ];
  for (const u of badArt) await denied(post(alice, { ...SONG, track_artwork_url: u }), /status_notes_track_artwork|check/);
  for (const u of ['https://open.spotify.com.evil.example/track/abc', 'javascript:alert(1)', 'http://open.spotify.com/track/abc', 'https://music.youtube.com/watch?v=abc', 'https://evil.example/open.spotify.com/'])
    await denied(post(alice, { ...SONG, track_url: u }), /status_notes_track_link|check/);
});
await t('an empty address is stored as "none"; song text is trimmed', async () => {
  await FRESH();
  await post(alice, { ...SONG, track_artwork_url: '  ', track_url: '', track_title: '  Night Drive ' });
  const r = await rawNote(alice);
  eq([r.track_artwork_url, r.track_url, r.track_title], [null, null, 'Night Drive']);
});
await t('you can’t move your note to someone else, or write one for them', async () => {
  await FRESH();
  await post(alice);
  await denied(as(db, alice, `update public.status_notes set user_id = '${bob}' where user_id = '${alice}'`), /row-level security|immutable_column/);
  await denied(as(db, alice, `insert into public.status_notes (user_id, body) values ('${bob}', 'hi')`), /row-level security/);
});

console.log('posting again, and how often');
await t('a new posting replaces the old one: new id, a fresh 24 hours, one row — and a text-only repost drops the old song', async () => {
  await FRESH();
  await post(alice, { ...SONG });
  const first = await rawNote(alice);
  await ageNote(alice, '5 hours');
  await post(alice, { body: 'second' });
  const second = await rawNote(alice);
  eq(await n('select count(*)::int n from public.status_notes'), 1);
  eq(first.id === second.id, false);
  eq(second.track_title, null);
  eq((await db.query(`select (expires_at - now()) > interval '23 hours 59 minutes' as fresh from public.status_notes`)).rows[0].fresh, true);
});
await t('at most 10 postings an hour — an upsert counts once — and nobody else is affected', async () => {
  await FRESH();
  for (let i = 1; i <= 10; i++) await post(alice, { body: `note ${i}` });
  eq(await n(`select n from private.activity_limits where user_id = '${alice}' and bucket = 'note'`), 10);
  await denied(post(alice, { body: 'note 11' }), /rate_limited/);
  eq((await rawNote(alice)).body, 'note 10');
  await post(bob, { body: 'bob is fine' });
  await db.query(`update private.activity_limits set window_start = now() - interval '61 minutes' where user_id = '${alice}'`);
  await post(alice, { body: 'note 12' });
  eq((await rawNote(alice)).body, 'note 12');
});
await t('plain updates count too, so the limit can’t be dodged by editing instead of upserting', async () => {
  await FRESH();
  await post(alice);
  for (let i = 0; i < 9; i++) await as(db, alice, `update public.status_notes set body = 'edit ${i}' where user_id = '${alice}'`);
  await denied(as(db, alice, `update public.status_notes set body = 'one too many' where user_id = '${alice}'`), /rate_limited/);
});
await t('the rate-limit bookkeeping isn’t readable or writable by people', async () => {
  await denied(as(db, alice, 'select * from private.activity_limits'), /permission denied/);
  await denied(as(db, alice, `delete from private.activity_limits where user_id = '${alice}'`), /permission denied/);
  await denied(as(db, alice, `select private.act_rate('${alice}', 'note', 1, interval '1 hour')`), /permission denied/);
  await denied(as(db, alice, `select private.act_note_context('${alice}', 'x')`), /permission denied/);
});

// ── who can see a note: the matrix ────────────────────────────────────────────

console.log('who can see a note: off / communities / everyone × member / stranger / self');
await t('"communities": the owner and people who share a community see it; strangers do not', async () => {
  await FRESH();
  await notesVis(alice, 'communities');
  await post(alice);
  eq([await seeNote(alice, alice), await seeNote(bob, alice), await seeNote(carol, alice), await seeNote(dave, alice)], [1, 1, 0, 0]);
  eq([(await feed(alice)).length, (await feed(bob)).length, (await feed(carol)).length], [1, 1, 0]);
});
await t('"everyone": any signed-in person sees it', async () => {
  await notesVis(alice, 'everyone');
  eq([await seeNote(alice, alice), await seeNote(bob, alice), await seeNote(carol, alice), await seeNote(dave, alice)], [1, 1, 1, 1]);
  eq([(await feed(carol)).length, (await feed(dave)).length], [1, 1]);
});
await t('changing "everyone" back to "communities" hides it from strangers straight away — no new write needed', async () => {
  await notesVis(alice, 'communities');
  eq([await seeNote(carol, alice), await seeNote(bob, alice), await seeNote(alice, alice)], [0, 1, 1]);
});
await t('leaving the community ends the access; coming back restores it', async () => {
  await db.query(`delete from public.community_members where community_id = '${cid}' and user_id = '${bob}'`);
  eq(await seeNote(bob, alice), 0);
  await db.query(`insert into public.community_members (community_id, user_id) values ('${cid}', '${bob}')`);
  eq(await seeNote(bob, alice), 1);
});
await t('"off": the note is deleted in the database, with its comments and hearts — and can’t be posted again', async () => {
  await notesVis(alice, 'everyone');
  await likeNote(bob, alice);
  await commentNote(carol, alice, 'nice');
  eq([await n('select count(*)::int n from public.activity_likes'), await n('select count(*)::int n from public.activity_comments')], [1, 1]);
  await notesVis(alice, 'off');
  eq([await n('select count(*)::int n from public.status_notes'), await n('select count(*)::int n from public.activity_likes'), await n('select count(*)::int n from public.activity_comments')], [0, 0, 0]);
  await denied(post(alice), /row-level security/);
  await notesVis(alice, 'communities');
});
await t('"off" also refuses a stale client that still tries to update', async () => {
  await FRESH();
  await post(alice);
  await db.query(`update public.profiles set notes_visibility = 'off' where id = '${alice}'`);
  await denied(post(alice), /row-level security/);
  await notesVis(alice, 'communities');
});
await t('anonymous visitors see nothing and can call nothing', async () => {
  await FRESH();
  await post(alice);
  for (const tbl of ['status_notes', 'activity_likes', 'activity_comments', 'activity_messages']) await denied(as(db, null, `select * from public.${tbl}`), /permission denied/);
  await denied(as(db, null, 'select * from public.activity_feed(10, null)'), /permission denied/);
  await denied(as(db, null, `select * from public.activity_engagement('[]'::jsonb)`), /permission denied/);
  await denied(as(db, null, `insert into public.status_notes (user_id, body) values ('${alice}', 'x')`), /permission denied/);
  await denied(as(db, null, `select private.act_can_see('${alice}', 'note')`), /permission denied/);
});

console.log('a note expires after 24 hours, by the server’s clock');
await t('visible at 23h59m, gone at 24h01m — for others, for the owner, and in the feed', async () => {
  await FRESH();
  await post(alice);
  await ageNote(alice, '23 hours 59 minutes');
  eq([await seeNote(bob, alice), await seeNote(alice, alice), (await feed(bob)).length], [1, 1, 1]);
  await ageNote(alice, '2 minutes');
  eq([await seeNote(bob, alice), await seeNote(alice, alice), (await feed(bob)).length, (await feed(alice)).length], [0, 0, 0, 0]);
  eq(await n('select count(*)::int n from public.status_notes'), 1); // still there until the next posting sweeps it
});
await t('the next posting by anyone sweeps expired notes, with their comments and hearts', async () => {
  await FRESH();
  await post(alice);
  const key = await noteId(alice);
  await commentNote(bob, alice, 'hello');
  await likeNote(bob, alice);
  await ageNote(alice, '25 hours');
  await post(dave); // somebody else's posting
  eq(await n(`select count(*)::int n from public.status_notes where user_id = '${alice}'`), 0);
  eq([await n(`select count(*)::int n from public.activity_comments where subject_key = '${key}'`), await n(`select count(*)::int n from public.activity_likes where subject_key = '${key}'`)], [0, 0]);
});
await t('re-posting after your own note expired works (the expired row is swept first)', async () => {
  await FRESH();
  await post(alice);
  await ageNote(alice, '30 hours');
  const [r] = await post(alice, { body: 'back again' });
  eq((await rawNote(alice)).body, 'back again');
  eq(r.id === undefined, false);
  eq(await seeNote(bob, alice), 1);
});
await t('hearts and comments on an expired note are refused, and its comments can no longer be read', async () => {
  await FRESH();
  await post(alice);
  const key = await noteId(alice);
  await commentNote(bob, alice, 'early');
  await ageNote(alice, '25 hours');
  await denied(like(bob, alice, 'note', key, { kind: 'note' }), /row-level security/);
  await denied(comment(bob, alice, key, 'late'), /row-level security/);
  eq((await as(db, bob, `select * from public.activity_comments where subject_key = '${key}'`)).length, 0);
  eq((await as(db, alice, `select * from public.activity_comments where subject_key = '${key}'`)).length, 0); // not even the owner
});

// ── hearts ────────────────────────────────────────────────────────────────────

console.log('hearts on a note');
await t('a member can heart a note; the owner gets exactly one activity message carrying a snapshot of the note', async () => {
  await FRESH();
  await post(alice, { ...SONG });
  await likeNote(bob, alice);
  const m = await likeMessages(bob, alice);
  eq(m.length, 1);
  eq([m[0].kind, m[0].body, m[0].sender_id, m[0].recipient_id, m[0].read_at], ['like', '', bob, alice, null]);
  same(m[0].context, {
    kind: 'note',
    text: 'Studying for finals',
    track: { title: 'Night Drive', artist: 'The Tests', album: 'Fixtures', artworkUrl: SONG.track_artwork_url, trackUrl: SONG.track_url, source: 'spotify' },
  });
});
await t('the snapshot is the note itself — whatever context the client sent is replaced', async () => {
  await FRESH();
  await post(alice, { body: 'real text' });
  await likeNote(bob, alice, { kind: 'note', text: 'you are awful', track: TRACK });
  const l = (await db.query('select context from public.activity_likes')).rows[0];
  same(l.context, { kind: 'note', text: 'real text' });
  same((await likeMessages(bob, alice))[0].context, { kind: 'note', text: 'real text' });
});
await t('the message’s snapshot is the like’s, and it keeps its meaning after the note is gone', async () => {
  await FRESH();
  await post(alice, { body: 'will expire' });
  await likeNote(bob, alice);
  await ageNote(alice, '25 hours');
  await post(dave); // sweeps alice's note and the like on it
  eq(await n('select count(*)::int n from public.activity_likes'), 0);
  const [m] = await likeMessages(bob, alice);
  same(m.context, { kind: 'note', text: 'will expire' });
});
await t('hearting twice is refused (the app treats it as a no-op) and doesn’t notify again', async () => {
  await FRESH();
  await post(alice);
  await likeNote(bob, alice);
  await denied(likeNote(bob, alice), /duplicate key|activity_likes_once/);
  eq((await likeMessages(bob, alice)).length, 1);
  eq(await n('select count(*)::int n from public.activity_likes'), 1);
});
await t('taking a heart back and giving it again doesn’t notify again', async () => {
  const key = await noteId(alice);
  eq((await unlike(bob, alice, 'note', key)).length, 1);
  eq(await n('select count(*)::int n from public.activity_likes'), 0);
  eq((await likeMessages(bob, alice)).length, 1); // the first message stays
  await likeNote(bob, alice);
  eq(await n('select count(*)::int n from public.activity_likes'), 1);
  eq((await likeMessages(bob, alice)).length, 1);
});
await t('if the recipient deleted the message, a later re-like is a new interaction and notifies once more', async () => {
  const [m] = await likeMessages(bob, alice);
  eq((await as(db, alice, `delete from public.activity_messages where id = '${m.id}' returning id`)).length, 1);
  await unlike(bob, alice, 'note', await noteId(alice));
  await likeNote(bob, alice);
  eq((await likeMessages(bob, alice)).length, 1);
});
await t('no self-hearts', async () => {
  await FRESH();
  await post(alice);
  await denied(likeNote(alice, alice), /row-level security/);
  await denied(like(alice, alice, 'listening', SONG_KEY, songCtx()), /row-level security/);
});
await t('only notes you may see: a stranger is refused on "communities", allowed on "everyone"', async () => {
  await FRESH();
  await post(alice);
  await denied(likeNote(carol, alice), /row-level security/);
  await notesVis(alice, 'everyone');
  await likeNote(carol, alice);
  eq((await likeMessages(carol, alice)).length, 1);
  await notesVis(alice, 'communities');
});
await t('the key must be the owner’s current note id: an old id, a made-up id, a different case, a song key — all refused', async () => {
  await FRESH();
  await post(alice);
  const old = await noteId(alice);
  await post(alice, { body: 'newer' });
  await denied(like(bob, alice, 'note', old, { kind: 'note' }), /row-level security/); // the replaced posting
  await denied(like(bob, alice, 'note', crypto.randomUUID(), { kind: 'note' }), /row-level security/);
  const cur = await noteId(alice);
  await denied(like(bob, alice, 'note', cur.toUpperCase(), { kind: 'note' }), /row-level security/);
  await denied(like(bob, alice, 'note', SONG_KEY, { kind: 'note' }), /row-level security/);
  await denied(like(bob, dave, 'note', cur, { kind: 'note' }), /row-level security/); // right id, wrong owner
  await likeNote(bob, alice);
});
await t('hearts are only for the two kinds; the key is 1–200 plain characters', async () => {
  await FRESH();
  await songVis(alice, 'communities');
  await playing(alice);
  await denied(like(bob, alice, 'comment', 'x', { kind: 'note' }), /activity_likes_kind|invalid_context|check|row-level security/);
  await denied(like(bob, alice, 'listening', '', songCtx()), /activity_likes_key|check|row-level security/);
  await denied(like(bob, alice, 'listening', 'a'.repeat(201), songCtx()), /activity_likes_key|check/);
  await denied(like(bob, alice, 'listening', `a${String.fromCodePoint(0x202e)}b`, songCtx()), /activity_likes_key|check/);
  await like(bob, alice, 'listening', 'a'.repeat(200), songCtx());
});
await t('a heart on a note is deleted with a re-post of the note (the old posting is over)', async () => {
  await FRESH();
  await post(alice);
  await likeNote(bob, alice);
  await post(alice, { body: 'new posting' });
  eq(await n('select count(*)::int n from public.activity_likes'), 0);
  eq((await likeMessages(bob, alice)).length, 1); // the notification stays
  await likeNote(bob, alice); // the new note is a new subject: a new heart, a new notification
  eq((await likeMessages(bob, alice)).length, 2);
});

console.log('hearts on a song someone is listening to');
await t('needs the song’s own visibility: off → refused; communities → members only; everyone → anyone signed in', async () => {
  await FRESH();
  await playing(alice);
  await songVis(alice, 'off');
  await denied(like(bob, alice, 'listening', SONG_KEY, songCtx()), /row-level security/);
  await songVis(alice, 'communities');
  await playing(alice);
  await denied(like(carol, alice, 'listening', SONG_KEY, songCtx()), /row-level security/);
  await like(bob, alice, 'listening', SONG_KEY, songCtx());
  await songVis(alice, 'everyone');
  await like(carol, alice, 'listening', SONG_KEY, songCtx());
  eq((await likeMessages(carol, alice)).length, 1);
});
await t('the notes setting and the song setting are independent', async () => {
  await FRESH();
  await songVis(alice, 'everyone');
  await playing(alice);
  await notesVis(alice, 'off');
  await like(carol, alice, 'listening', SONG_KEY, songCtx()); // a song heart doesn't need notes
  await notesVis(alice, 'everyone');
  await songVis(alice, 'off');
  await post(alice);
  await denied(like(dave, alice, 'listening', SONG_KEY, songCtx()), /row-level security/); // …and a note setting doesn't open the song
  await likeNote(dave, alice);
  await notesVis(alice, 'communities');
});
await t('needs a song actually playing: no row, or a row older than 2 minutes, is refused', async () => {
  await FRESH();
  await songVis(alice, 'everyone');
  await denied(like(bob, alice, 'listening', SONG_KEY, songCtx()), /row-level security/); // nothing playing
  await playing(alice);
  await ageSong(alice, '3 minutes');
  await denied(like(bob, alice, 'listening', SONG_KEY, songCtx()), /row-level security/);
  await playing(alice); // the heartbeat
  await ageSong(alice, '1 minute');
  await like(bob, alice, 'listening', SONG_KEY, songCtx());
});
await t('the song snapshot travels with the heart and into the message', async () => {
  const m = await likeMessages(bob, alice);
  eq(m.length, 1);
  same(m[0].context, SNAP_SONG);
  same((await db.query('select context from public.activity_likes')).rows[0].context, SNAP_SONG);
});
await t('the snapshot is the song the owner is really playing — a client can’t make a heart claim another song', async () => {
  await FRESH();
  await songVis(alice, 'everyone');
  await playing(alice);
  await like(carol, alice, 'listening', 'whatever key', songCtx({ title: 'Something Cruel', artist: 'Nobody', artworkUrl: null }));
  same((await likeMessages(carol, alice))[0].context, SNAP_SONG);
  same((await db.query('select context from public.activity_likes')).rows[0].context, SNAP_SONG);
  // a song-less context is fine too — the server knows the song
  await like(dave, alice, 'listening', 'k2', { kind: 'listening' });
  same((await likeMessages(dave, alice))[0].context, SNAP_SONG);
});
await t('the context is validated: a hostile image host, javascript: links, hidden characters, over-long text, extra keys, a wrong kind', async () => {
  await FRESH();
  await songVis(alice, 'everyone');
  await playing(alice);
  const bad = [
    songCtx({ artworkUrl: 'https://evil.example/pixel.png' }),
    songCtx({ artworkUrl: 'https://i.scdn.co.evil.example/x.png' }),
    songCtx({ artworkUrl: 'javascript:alert(1)' }),
    songCtx({ artworkUrl: 'http://i.scdn.co/x.png' }),
    songCtx({ trackUrl: 'https://evil.example/open.spotify.com/track/x' }),
    songCtx({ trackUrl: 'javascript:alert(1)' }),
    songCtx({ title: `bad${String.fromCodePoint(0x202e)}title` }),
    songCtx({ title: 'bad\ntitle' }),
    songCtx({ title: 'a'.repeat(151) }),
    songCtx({ title: '' }),
    songCtx({ artist: 'a'.repeat(151) }),
    songCtx({ source: 'napster' }),
    songCtx({ source: undefined }),
    songCtx({ extra: 'x' }),
    { ...songCtx(), text: 'a'.repeat(61) },
    { ...songCtx(), text: `x${String.fromCodePoint(0x200b)}y` },
    { ...songCtx(), html: '<img src=x onerror=alert(1)>' },
    { ...songCtx(), kind: 'note' }, // a "note" context on a song heart
    { kind: 'listening', track: 'Night Drive' },
    { kind: 'listening', track: [TRACK] },
    { kind: 'something else', track: TRACK },
  ];
  for (const ctx of bad) await denied(like(bob, alice, 'listening', SONG_KEY, ctx), /invalid_context|activity_likes_|check|row-level security/);
  await denied(as(db, bob, `insert into public.activity_likes (owner_id, kind, subject_key, context) values ('${alice}', 'listening', 'k', '"just a string"'::jsonb)`), /invalid_context|activity_likes_context|check/);
  await denied(as(db, bob, `insert into public.activity_likes (owner_id, kind, subject_key, context) values ('${alice}', 'listening', 'k', '[1]'::jsonb)`), /invalid_context|activity_likes_context|check/);
  await denied(as(db, bob, `insert into public.activity_likes (owner_id, kind, subject_key) values ('${alice}', 'listening', 'k')`), /invalid_context|null value|not-null|activity_likes|row-level/);
  await denied(like(bob, alice, 'note', 'k', { kind: 'note', html: '<b>x</b>' }), /invalid_context|row-level security/);
  eq(await n('select count(*)::int n from public.activity_likes'), 0);
  eq(await n('select count(*)::int n from public.activity_messages'), 0);
  await like(bob, alice, 'listening', SONG_KEY, songCtx({ trackUrl: 'https://open.spotify.com/track/abc?si=1' })); // a good one still works
});
await t('the snapshot validator, directly: what it accepts and what it refuses', async () => {
  const ok = async (c) => (await as(db, bob, `select private.act_context_ok(${json(c)}) ok`))[0].ok;
  eq(await ok({ kind: 'note' }), true);
  eq(await ok({ kind: 'note', text: '' }), true);
  eq(await ok({ kind: 'note', text: 'hi', track: TRACK }), true);
  eq(await ok({ kind: 'listening', track: { title: 'x', source: 'tidal' } }), true);
  eq(await ok({}), false);
  eq(await ok({ text: 'no kind' }), false);
  eq(await ok({ kind: 'note', text: null }), false);
  eq(await ok({ kind: 'note', text: 5 }), false);
  eq(await ok({ kind: 'note', track: { ...TRACK, artist: null } }), false);
  eq(await ok({ kind: 'note', track: { ...TRACK, trackUrl: 5 } }), false);
  eq(await ok({ kind: 'note', track: { ...TRACK, album: 'a'.repeat(151) } }), false);
  eq((await as(db, bob, `select private.act_context_ok(null) ok`))[0].ok, false);
});
await t('at most 60 hearts an hour; then it opens again, and nobody else is affected', async () => {
  await FRESH();
  await songVis(alice, 'everyone');
  await playing(alice);
  for (let i = 0; i < 60; i++) await like(bob, alice, 'listening', `song ${i}`, songCtx());
  await denied(like(bob, alice, 'listening', 'song 60', songCtx()), /rate_limited/);
  eq(await n(`select count(*)::int n from public.activity_likes where actor_id = '${bob}'`), 60);
  await like(carol, alice, 'listening', 'song 0', songCtx());
  await db.query(`update private.activity_limits set window_start = now() - interval '61 minutes' where user_id = '${bob}'`);
  await like(bob, alice, 'listening', 'song 60', songCtx());
});

console.log('who can read hearts');
await t('only the person who gave a heart and the owner can read the row — nobody else, strangers included', async () => {
  await FRESH();
  await notesVis(alice, 'everyone');
  await post(alice);
  await likeNote(bob, alice);
  await likeNote(carol, alice);
  eq((await as(db, alice, 'select actor_id from public.activity_likes')).map((r) => r.actor_id).sort(), [bob, carol].sort()); // the owner sees who
  eq((await as(db, bob, 'select actor_id from public.activity_likes')).map((r) => r.actor_id), [bob]);
  eq((await as(db, carol, 'select actor_id from public.activity_likes')).map((r) => r.actor_id), [carol]);
  eq((await as(db, dave, 'select actor_id from public.activity_likes')).length, 0);
  await notesVis(alice, 'communities');
});
await t('you can take back only your own heart', async () => {
  const key = await noteId(alice);
  eq((await as(db, dave, `delete from public.activity_likes where subject_key = '${key}' returning id`)).length, 0);
  eq((await as(db, alice, `delete from public.activity_likes where subject_key = '${key}' returning id`)).length, 0); // not even the owner
  eq((await unlike(carol, alice, 'note', key)).length, 1);
  eq(await n('select count(*)::int n from public.activity_likes'), 1);
});
await t('a heart can’t be edited, or created in someone else’s name or with a made-up time', async () => {
  const key = await noteId(alice);
  await denied(as(db, bob, `update public.activity_likes set subject_key = 'x' where owner_id = '${alice}'`), /permission denied/);
  await denied(as(db, bob, `update public.activity_likes set context = '{"kind":"note","text":"edited"}'::jsonb where owner_id = '${alice}'`), /permission denied/);
  await denied(as(db, dave, `insert into public.activity_likes (actor_id, owner_id, kind, subject_key, context) values ('${bob}', '${alice}', 'note', '${key}', '{"kind":"note"}'::jsonb)`), /permission denied/);
  await denied(as(db, dave, `insert into public.activity_likes (owner_id, kind, subject_key, context, created_at) values ('${alice}', 'note', '${key}', '{"kind":"note"}'::jsonb, now() - interval '9 days')`), /permission denied/);
});

// ── comments ──────────────────────────────────────────────────────────────────

console.log('comments under a note');
await t('a member comments; the owner gets one activity message with the text and a snapshot of the note', async () => {
  await FRESH();
  await post(alice, { body: 'fresh note' });
  await commentNote(bob, alice, '  love this  ');
  const [c] = await db.query('select * from public.activity_comments').then((r) => r.rows);
  eq([c.body, c.author_id, c.owner_id], ['love this', bob, alice]);
  const m = await messages(`kind = 'comment'`);
  eq(m.length, 1);
  eq([m[0].body, m[0].sender_id, m[0].recipient_id], ['love this', bob, alice]);
  same(m[0].context, { kind: 'note', text: 'fresh note' });
});
await t('comments are public to whoever can see the note — and invisible to people who can’t', async () => {
  const key = await noteId(alice);
  const readers = async (u) => (await as(db, u, `select body from public.activity_comments where subject_key = '${key}'`)).length;
  eq([await readers(alice), await readers(bob), await readers(carol), await readers(dave)], [1, 1, 0, 0]);
  await notesVis(alice, 'everyone');
  eq([await readers(carol), await readers(dave)], [1, 1]);
  await notesVis(alice, 'communities');
  eq(await readers(carol), 0);
});
await t('only people who may see the note can comment', async () => {
  await denied(commentNote(carol, alice, 'let me in'), /row-level security/);
  await notesVis(alice, 'everyone');
  await commentNote(carol, alice, 'now I can');
  await notesVis(alice, 'communities');
  // having commented, carol still reads her own comment while the note lives, but can't write another once access ends
  await denied(commentNote(carol, alice, 'and again'), /row-level security/);
  const key = await noteId(alice);
  eq((await as(db, carol, `select body from public.activity_comments where subject_key = '${key}'`)).map((r) => r.body), ['now I can']);
});
await t('comments live only under a note: a song key, a made-up id, or someone else’s note id is refused', async () => {
  await denied(comment(bob, alice, SONG_KEY, 'on a song'), /row-level security/);
  await denied(comment(bob, alice, crypto.randomUUID(), 'on nothing'), /row-level security/);
  await denied(comment(bob, dave, await noteId(alice), 'wrong owner'), /row-level security/);
});
await t('text: 1–200 characters, trimmed, no hidden characters, nothing blank', async () => {
  await clearLimits();
  await commentNote(bob, alice, 'a'.repeat(200));
  await denied(commentNote(bob, alice, 'a'.repeat(201)), /activity_comments_body|check/);
  await denied(commentNote(bob, alice, ''), /activity_comments_body|check/);
  await denied(commentNote(bob, alice, '     '), /activity_comments_body|check/);
  await denied(commentNote(bob, alice, 'two\nlines'), /activity_comments_body|check/);
  await denied(commentNote(bob, alice, `evil${String.fromCodePoint(0x202e)}text`), /activity_comments_body|check/);
  await denied(commentNote(bob, alice, `zero${String.fromCodePoint(0x200b)}width`), /activity_comments_body|check/);
  await commentNote(bob, alice, '<script>alert(1)</script> 夜に駆ける 🎧'); // stored as inert text; the UI only ever renders text
});
await t('the author, the time and the id aren’t the client’s to choose; a comment can’t be edited', async () => {
  const key = await noteId(alice);
  await denied(as(db, bob, `insert into public.activity_comments (author_id, owner_id, subject_key, body) values ('${carol}', '${alice}', '${key}', 'as carol')`), /permission denied/);
  await denied(as(db, bob, `insert into public.activity_comments (owner_id, subject_key, body, created_at) values ('${alice}', '${key}', 'x', now() - interval '2 days')`), /permission denied/);
  await denied(as(db, bob, `insert into public.activity_comments (id, owner_id, subject_key, body) values (gen_random_uuid(), '${alice}', '${key}', 'x')`), /permission denied/);
  await denied(as(db, bob, `update public.activity_comments set body = 'edited' where author_id = '${bob}'`), /permission denied/);
});
await t('delete: the author their own, the note’s owner any comment on it, nobody else', async () => {
  await FRESH();
  await notesVis(alice, 'everyone');
  await post(alice);
  const [c1] = await commentNote(bob, alice, 'one');
  const [c2] = await commentNote(carol, alice, 'two');
  const [c3] = await commentNote(bob, alice, 'three');
  const del = (u, id) => as(db, u, `delete from public.activity_comments where id = '${id}' returning id`);
  eq((await del(dave, c1.id)).length, 0);
  eq((await del(carol, c1.id)).length, 0); // not someone else's
  eq((await del(bob, c1.id)).length, 1);
  eq((await del(alice, c2.id)).length, 1); // the owner, on her own note
  eq((await del(carol, c2.id)).length, 0); // already gone
  eq((await del(bob, c3.id)).length, 1);
  eq(await n('select count(*)::int n from public.activity_comments'), 0);
  eq(await n(`select count(*)::int n from public.activity_messages where kind = 'comment'`), 3); // the notifications stay
  await notesVis(alice, 'communities');
});
await t('the owner can comment on their own note, and that notifies nobody', async () => {
  await FRESH();
  await post(alice);
  await commentNote(alice, alice, 'a note to self');
  eq(await n('select count(*)::int n from public.activity_comments'), 1);
  eq(await n('select count(*)::int n from public.activity_messages'), 0);
});
await t('at most 30 comments an hour; then it opens again', async () => {
  await FRESH();
  await post(alice);
  for (let i = 0; i < 30; i++) await commentNote(bob, alice, `comment ${i}`);
  await denied(commentNote(bob, alice, 'comment 30'), /rate_limited/);
  await db.query(`update private.activity_limits set window_start = now() - interval '61 minutes' where user_id = '${bob}' and bucket = 'comment'`);
  await commentNote(bob, alice, 'comment 30');
});
await t('comments disappear with their note: re-post, delete, and the owner turning notes off', async () => {
  await FRESH();
  await post(alice);
  await commentNote(bob, alice, 'one');
  await post(alice, { body: 'a new posting' });
  eq(await n('select count(*)::int n from public.activity_comments'), 0);
  await commentNote(bob, alice, 'two');
  await as(db, alice, `delete from public.status_notes where user_id = '${alice}'`);
  eq(await n('select count(*)::int n from public.activity_comments'), 0);
  await post(alice);
  await commentNote(bob, alice, 'three');
  await notesVis(alice, 'off');
  eq(await n('select count(*)::int n from public.activity_comments'), 0);
  await notesVis(alice, 'communities');
  eq(await n(`select count(*)::int n from public.activity_messages where kind = 'comment'`), 3); // what was said to alice stays in her inbox
});

// ── engagement and the feed ───────────────────────────────────────────────────

console.log('engagement counts (without names)');
await t('a viewer who can see a note gets its counts and whether they liked — and nothing that names anyone', async () => {
  await FRESH();
  await notesVis(alice, 'everyone');
  await post(alice);
  const key = await noteId(alice);
  await likeNote(bob, alice);
  await likeNote(carol, alice);
  await commentNote(dave, alice, 'hi');
  const rows = await engagement(bob, [ref(alice, 'note', key)]);
  eq(rows.length, 1);
  eq(Object.keys(rows[0]).sort(), ['comments', 'kind', 'liked_by_me', 'likes', 'owner_id', 'subject_key']);
  eq([rows[0].likes, rows[0].comments, rows[0].liked_by_me], [2, 1, true]);
  eq((await engagement(dave, [ref(alice, 'note', key)]))[0].liked_by_me, false);
  eq((await engagement(alice, [ref(alice, 'note', key)]))[0].likes, 2); // the owner sees counts on their own note
  await notesVis(alice, 'communities');
});
await t('a stranger can’t count hearts or comments on a note they may not see — the subject is simply absent', async () => {
  const key = await noteId(alice);
  eq((await engagement(carol, [ref(alice, 'note', key)])).length, 0);
  eq((await engagement(dave, [ref(alice, 'note', key), ref(alice, 'note', crypto.randomUUID())])).length, 0);
  eq((await engagement(bob, [ref(alice, 'note', key)])).length, 1);
});
await t('expired notes and unknown subjects are absent for everyone', async () => {
  const key = await noteId(alice);
  eq((await engagement(bob, [ref(alice, 'note', crypto.randomUUID()), ref(dave, 'note', key)])).length, 0);
  await ageNote(alice, '25 hours');
  eq((await engagement(bob, [ref(alice, 'note', key)])).length, 0);
  eq((await engagement(alice, [ref(alice, 'note', key)])).length, 0);
});
await t('songs: counts only for a song the viewer may see and that is playing — and never who', async () => {
  await FRESH();
  await songVis(alice, 'communities');
  await playing(alice);
  await like(bob, alice, 'listening', SONG_KEY, songCtx());
  const r = (await engagement(bob, [ref(alice, 'listening', SONG_KEY)]))[0];
  eq([r.likes, r.comments, r.liked_by_me], [1, 0, true]);
  eq((await engagement(carol, [ref(alice, 'listening', SONG_KEY)])).length, 0); // not in alice's communities
  eq((await engagement(alice, [ref(alice, 'listening', SONG_KEY)]))[0].likes, 1);
  await ageSong(alice, '5 minutes');
  eq((await engagement(bob, [ref(alice, 'listening', SONG_KEY)])).length, 0); // nothing is playing: no probing of old songs
  await songVis(alice, 'off');
  await playing(alice).catch(() => {});
  eq((await engagement(bob, [ref(alice, 'listening', SONG_KEY)])).length, 0);
});
await t('malformed requests answer with nothing instead of failing: not an array, bad ids, missing fields, unknown kinds', async () => {
  await FRESH();
  await post(alice);
  const key = await noteId(alice);
  const asJson = (v) => as(db, bob, `select * from public.activity_engagement(${v})`);
  eq((await asJson(`'{}'::jsonb`)).length, 0);
  eq((await asJson(`'"x"'::jsonb`)).length, 0);
  eq((await asJson(`'null'::jsonb`)).length, 0);
  eq((await asJson('null')).length, 0);
  eq((await engagement(bob, [{ owner_id: 'not-a-uuid', kind: 'note', subject_key: key }, { owner_id: alice, subject_key: key }, { owner_id: alice, kind: 'note' }, 5, null, 'x', [1], { owner_id: alice, kind: 'comment', subject_key: key }])).length, 0);
  eq((await engagement(bob, [ref(alice, 'note', key), { owner_id: 'junk' }])).length, 1);
});
await t('it looks at no more than 100 subjects', async () => {
  const key = await noteId(alice);
  const filler = Array.from({ length: 100 }, () => ref(alice, 'note', crypto.randomUUID()));
  eq((await engagement(bob, [...filler, ref(alice, 'note', key)])).length, 0); // the real one is the 101st
  eq((await engagement(bob, [...filler.slice(0, 99), ref(alice, 'note', key)])).length, 1);
});

console.log('the feed');
await t('unexpired notes of the people the viewer may see, mine included, newest first — with counts', async () => {
  await FRESH();
  await notesVis(dave, 'everyone');
  await notesVis(carol, 'communities');
  await post(alice, { body: 'alice first' });
  await post(dave, { body: 'dave second' });
  await post(bob, { body: 'bob third', ...SONG });
  await post(carol, { body: 'carol hidden' }); // shares nothing with bob
  await likeNote(bob, alice);
  await commentNote(bob, alice, 'hey');
  const rows = await feed(bob);
  eq(rows.map((r) => r.body), ['bob third', 'dave second', 'alice first']);
  eq([rows[2].likes, rows[2].comments, rows[2].liked_by_me], [1, 1, true]);
  eq([rows[1].likes, rows[1].liked_by_me], [0, false]);
  eq([rows[0].track_title, rows[0].track_source, rows[0].user_id], ['Night Drive', 'spotify', bob]);
  eq((await feed(carol)).map((r) => r.body), ['carol hidden', 'dave second']);
});
await t('paging by `before` (the createdAt of the last note you have) and limits', async () => {
  const all = await feed(bob);
  eq((await feed(bob, `1, null`)).map((r) => r.body), ['bob third']);
  eq((await feed(bob, `10, '${new Date(all[0].created_at).toISOString()}'`)).map((r) => r.body), ['dave second', 'alice first']);
  eq((await feed(bob, `10, '${new Date(all[2].created_at).toISOString()}'`)).length, 0);
  eq((await feed(bob, `0, null`)).length, 1); // at least one
  eq((await feed(bob, `-5, null`)).length, 1);
  eq((await feed(bob, `null, null`)).length, 3); // the default page
});
await t('a page is never more than 50 notes, however much is asked for', async () => {
  await db.query(`insert into auth.users (id, email) select gen_random_uuid(), 'bulk' || i || '@x.test' from generate_series(1, 55) i`);
  await db.query(`update public.profiles set notes_visibility = 'everyone'`);
  await db.query(`insert into public.status_notes (user_id, body) select id, 'bulk' from public.profiles where id not in ('${alice}', '${bob}', '${carol}', '${dave}')`);
  eq((await feed(dave, '1000, null')).length, 50);
  eq((await feed(dave, '30, null')).length, 30);
  eq((await feed(dave, 'null, null')).length, 30);
  await db.query(`delete from auth.users where email like 'bulk%'`);
  await db.query(`update public.profiles set notes_visibility = 'communities'`);
});
await t('expired notes are not in the feed', async () => {
  await FRESH();
  await post(alice);
  await post(bob);
  await ageNote(alice, '25 hours');
  eq((await feed(bob)).map((r) => r.user_id), [bob]);
});

// ── activity messages: forging, replies, reading ──────────────────────────────

console.log('the visibility matrix: hearts, comments and replies × off / communities / everyone × member / stranger');
for (const [vis, who, label, allowed] of [
  ['communities', bob, 'a member', true],
  ['communities', carol, 'a stranger', false],
  ['everyone', bob, 'a member', true],
  ['everyone', carol, 'a stranger', true],
]) {
  await t(`notes "${vis}", ${label}: may heart, comment and reply = ${allowed}`, async () => {
    await FRESH();
    await notesVis(alice, vis);
    await post(alice);
    const key = await noteId(alice);
    const attempt = async (p) => {
      try {
        await p;
        return true;
      } catch (e) {
        if (!/row-level security/.test(e.message)) throw e;
        return false;
      }
    };
    eq(await attempt(like(who, alice, 'note', key, { kind: 'note' })), allowed, 'heart');
    eq(await attempt(comment(who, alice, key, 'a comment')), allowed, 'comment');
    eq(await attempt(reply(who, alice, 'a reply')), allowed, 'reply');
    eq((await feed(who)).filter((r) => r.user_id === alice).length, allowed ? 1 : 0, 'feed');
    eq((await engagement(who, [ref(alice, 'note', key)])).length, allowed ? 1 : 0, 'engagement');
  });
}
await t('notes "off": there is nothing to heart, comment on or reply to — old ids and replies are refused for everyone', async () => {
  await FRESH();
  await post(alice);
  const key = await noteId(alice);
  await notesVis(alice, 'off');
  for (const who of [bob, carol, alice]) {
    await denied(like(who, alice, 'note', key, { kind: 'note' }), /row-level security/);
    await denied(comment(who, alice, key, 'x'), /row-level security/);
  }
  for (const who of [bob, carol]) await denied(reply(who, alice, 'x'), /row-level security/);
  eq((await feed(bob)).length + (await feed(alice)).length, 0);
  await notesVis(alice, 'communities');
});

console.log('forged likes and comments are impossible');
await t('a client can’t insert a message of kind like / comment (the kind isn’t theirs to name)', async () => {
  await FRESH();
  await post(alice);
  const ctx = json({ kind: 'note', text: 'bob liked this, honest' });
  await denied(as(db, bob, `insert into public.activity_messages (recipient_id, kind, body, context) values ('${alice}', 'like', '', ${ctx})`), /permission denied/);
  await denied(as(db, bob, `insert into public.activity_messages (recipient_id, kind, body, context) values ('${alice}', 'comment', 'nice', ${ctx})`), /permission denied/);
  await denied(as(db, bob, `insert into public.activity_messages (recipient_id, kind, body) values ('${alice}', 'reply', 'x')`), /permission denied/);
});
await t('…and if the column were ever granted, the policy still refuses anything but a reply', async () => {
  await db.exec('grant insert (kind, sender_id, subject_kind, subject_key, created_at, read_at) on public.activity_messages to authenticated');
  try {
    await denied(as(db, bob, `insert into public.activity_messages (recipient_id, kind, body, context) values ('${alice}', 'like', '', '{"kind":"note"}'::jsonb)`), /row-level security/);
    await denied(as(db, bob, `insert into public.activity_messages (recipient_id, kind, body) values ('${alice}', 'comment', 'nice')`), /row-level security/);
    await denied(as(db, bob, `insert into public.activity_messages (sender_id, recipient_id, kind, body) values ('${carol}', '${alice}', 'reply', 'as carol')`), /row-level security/);
    // a reply's read_at / created_at are the server's even if they were named
    await reply(bob, alice, 'a reply');
    await as(db, bob, `insert into public.activity_messages (recipient_id, body, created_at, read_at) values ('${alice}', 'dated', now() - interval '9 days', now())`);
    const row = (await messages(`body = 'dated'`))[0];
    eq([row.read_at, new Date(row.created_at) > new Date(Date.now() - 60000)], [null, true]);
  } finally {
    await db.exec('revoke insert (kind, sender_id, subject_kind, subject_key, created_at, read_at) on public.activity_messages from authenticated');
  }
  await wipe();
});
await t('the sender can’t be named, nor the time, nor the id', async () => {
  await denied(as(db, bob, `insert into public.activity_messages (sender_id, recipient_id, body) values ('${carol}', '${alice}', 'x')`), /permission denied/);
  await denied(as(db, bob, `insert into public.activity_messages (recipient_id, body, created_at) values ('${alice}', 'x', now())`), /permission denied/);
  await denied(as(db, bob, `insert into public.activity_messages (recipient_id, body, read_at) values ('${alice}', 'x', now())`), /permission denied/);
  await denied(as(db, bob, `insert into public.activity_messages (id, recipient_id, body) values (gen_random_uuid(), '${alice}', 'x')`), /permission denied/);
});
await t('a message’s content can never be changed afterwards — not by the recipient, not by the sender', async () => {
  await FRESH();
  await post(alice);
  await likeNote(bob, alice);
  for (const col of ['body', 'context', 'kind', 'sender_id', 'recipient_id', 'created_at', 'subject_key']) {
    const v = { body: `'x'`, context: `'{"kind":"note"}'::jsonb`, kind: `'comment'`, sender_id: `'${carol}'`, recipient_id: `'${carol}'`, created_at: 'now()', subject_key: `'x'` }[col];
    await denied(as(db, alice, `update public.activity_messages set ${col} = ${v}`), /permission denied/);
    await denied(as(db, bob, `update public.activity_messages set ${col} = ${v}`), /permission denied/);
  }
  // …and if a column were ever granted, the guard trigger still refuses the change
  await db.exec('grant update (body, kind, context) on public.activity_messages to authenticated');
  try {
    await denied(as(db, alice, `update public.activity_messages set body = 'x'`), /immutable_column/);
    await denied(as(db, alice, `update public.activity_messages set kind = 'comment'`), /immutable_column/);
    await denied(as(db, alice, `update public.activity_messages set context = '{"kind":"note"}'::jsonb`), /immutable_column/);
  } finally {
    await db.exec('revoke update (body, kind, context) on public.activity_messages from authenticated');
  }
});
await t('a like can only come from a real like row, and a comment only from a real comment', async () => {
  eq(await n(`select count(*)::int n from public.activity_messages where kind = 'like'`), 1);
  await commentNote(bob, alice, 'real comment');
  eq(await n(`select count(*)::int n from public.activity_messages where kind = 'comment'`), 1);
  // the trigger functions aren't callable by people
  await denied(as(db, bob, `select private.activity_likes_notify()`), /permission denied/);
  await denied(as(db, bob, `select private.activity_comments_notify()`), /permission denied/);
});

console.log('private replies');
await t('you may reply to someone whose live note you can see — and to nobody else', async () => {
  await FRESH();
  await post(alice);
  await reply(bob, alice, 'nice note!', { kind: 'note', text: 'Studying for finals' });
  const [m] = await messages(`kind = 'reply'`);
  eq([m.kind, m.body, m.sender_id, m.recipient_id, m.read_at], ['reply', 'nice note!', bob, alice, null]);
  await denied(reply(carol, alice, 'hello stranger'), /row-level security/);
  await denied(reply(bob, dave, 'dave has no note'), /row-level security/);
  await denied(reply(bob, carol, 'carol has no note'), /row-level security/);
});
await t('…or a song you can see (a fresh row, a visibility that lets you)', async () => {
  await FRESH();
  await songVis(alice, 'communities');
  await playing(alice);
  await reply(bob, alice, 'great song');
  await denied(reply(carol, alice, 'stranger'), /row-level security/);
  await ageSong(alice, '5 minutes');
  await denied(reply(bob, alice, 'too late'), /row-level security/);
  await songVis(alice, 'off');
});
await t('…or someone who already wrote to you, even once their note has gone', async () => {
  await FRESH();
  await notesVis(alice, 'everyone');
  await post(alice);
  await likeNote(dave, alice); // dave, a stranger, hearts alice's note
  await ageNote(alice, '25 hours');
  await reply(alice, dave, 'thanks for the heart!'); // alice replies: dave wrote to her first
  await denied(reply(carol, alice, 'I never wrote to her'), /row-level security/);
  await denied(reply(alice, carol, 'carol never wrote to me'), /row-level security/);
  await notesVis(alice, 'communities');
});
await t('once the note has expired and nothing else connects you, a reply is refused', async () => {
  await FRESH();
  await post(alice);
  await ageNote(alice, '25 hours');
  await denied(reply(bob, alice, 'too late'), /row-level security/);
});
await t('the audience follows the setting: "off" notes can’t be replied to; lowering "everyone" cuts strangers off', async () => {
  await FRESH();
  await notesVis(alice, 'everyone');
  await post(alice);
  await reply(carol, alice, 'as a stranger');
  await notesVis(alice, 'communities');
  await denied(reply(carol, alice, 'second try'), /row-level security/);
  await reply(bob, alice, 'a member still can');
  await notesVis(alice, 'off'); // deletes the note
  await denied(reply(bob, alice, 'nothing to reply to'), /row-level security/);
  await notesVis(alice, 'communities');
});
await t('no messages to yourself, to nobody, or to an account that doesn’t exist', async () => {
  await FRESH();
  await post(alice);
  await denied(reply(alice, alice, 'to myself'), /row-level security|activity_messages_no_self/);
  await denied(reply(bob, crypto.randomUUID(), 'to nobody'), /row-level security|foreign key/);
  await denied(as(db, bob, `insert into public.activity_messages (body) values ('x')`), /row-level security|null value|not-null|recipient_id/);
});
await t('text: 1–500 characters, trimmed, no hidden characters; the snapshot is validated like a like’s', async () => {
  await FRESH();
  await post(alice);
  await reply(bob, alice, 'a'.repeat(500));
  await denied(reply(bob, alice, 'a'.repeat(501)), /activity_messages_body|check/);
  await denied(reply(bob, alice, ''), /activity_messages_body|check/);
  await denied(reply(bob, alice, '   '), /activity_messages_body|check/);
  await denied(reply(bob, alice, 'two\nlines'), /activity_messages_body|check/);
  await denied(reply(bob, alice, `bidi${String.fromCodePoint(0x202e)}text`), /activity_messages_body|check/);
  await reply(bob, alice, '   padded  ');
  eq((await messages(`body = 'padded'`)).length, 1);
  await reply(bob, alice, 'with a song', songCtx());
  for (const ctx of [songCtx({ artworkUrl: 'https://evil.example/x.png' }), { kind: 'note', text: 'a'.repeat(61) }, { kind: 'x' }, { text: 'no kind' }, 'string'])
    await denied(reply(bob, alice, 'hostile', ctx), /activity_messages_context|check/);
});
await t('at most 30 replies an hour; then it opens again', async () => {
  await FRESH();
  await post(alice);
  for (let i = 0; i < 30; i++) await reply(bob, alice, `reply ${i}`);
  await denied(reply(bob, alice, 'reply 30'), /rate_limited/);
  await db.query(`update private.activity_limits set window_start = now() - interval '61 minutes' where user_id = '${bob}' and bucket = 'reply'`);
  await reply(bob, alice, 'reply 30');
});
await t('replies, hearts and comments each have their own allowance', async () => {
  await FRESH();
  await post(alice);
  for (let i = 0; i < 30; i++) await reply(bob, alice, `reply ${i}`);
  await commentNote(bob, alice, 'comments are separate');
  await likeNote(bob, alice);
});

console.log('reading, marking read, deleting');
await t('the sender and the recipient read a message; nobody else does', async () => {
  await FRESH();
  await post(alice);
  await reply(bob, alice, 'hi alice');
  eq([(await as(db, alice, 'select id from public.activity_messages')).length, (await as(db, bob, 'select id from public.activity_messages')).length], [1, 1]);
  eq([(await as(db, carol, 'select id from public.activity_messages')).length, (await as(db, dave, 'select id from public.activity_messages')).length], [0, 0]);
});
await t('only the recipient can mark it read — and only read_at changes, stamped by the server, once', async () => {
  const id = (await messages())[0].id;
  eq((await as(db, bob, `update public.activity_messages set read_at = now() where id = '${id}' returning id`)).length, 0); // the sender can't
  eq((await as(db, carol, `update public.activity_messages set read_at = now() where id = '${id}' returning id`)).length, 0);
  eq((await messages())[0].read_at, null);
  const forward = `now() + interval '5 days'`;
  eq((await as(db, alice, `update public.activity_messages set read_at = ${forward} where id = '${id}' returning id`)).length, 1);
  const first = (await messages())[0].read_at;
  eq(new Date(first) < new Date(Date.now() + 60000), true); // not the date the client sent
  await new Promise((r) => setTimeout(r, 20));
  await as(db, alice, `update public.activity_messages set read_at = now() where id = '${id}'`);
  eq(new Date((await messages())[0].read_at).getTime(), new Date(first).getTime()); // set once
  await as(db, alice, `update public.activity_messages set read_at = null where id = '${id}'`);
  eq((await messages())[0].read_at !== null, true); // can't be taken back
});
await t('only the recipient can delete a message', async () => {
  const id = (await messages())[0].id;
  eq((await as(db, bob, `delete from public.activity_messages where id = '${id}' returning id`)).length, 0);
  eq((await as(db, carol, `delete from public.activity_messages where id = '${id}' returning id`)).length, 0);
  eq((await as(db, alice, `delete from public.activity_messages where id = '${id}' returning id`)).length, 1);
  eq(await n('select count(*)::int n from public.activity_messages'), 0);
});
await t('likes and comments land in the recipient’s inbox, unread, in order — the sender can read them too', async () => {
  await FRESH();
  await post(alice);
  await likeNote(bob, alice);
  await commentNote(bob, alice, 'and a comment');
  await reply(bob, alice, 'and a reply');
  const got = await as(db, alice, 'select kind, body, read_at from public.activity_messages order by created_at');
  eq(got.map((r) => [r.kind, r.body, r.read_at]), [['like', '', null], ['comment', 'and a comment', null], ['reply', 'and a reply', null]]);
  eq((await as(db, bob, 'select id from public.activity_messages')).length, 3);
});

// ── account deletion, structure, idempotency ──────────────────────────────────

console.log('cleanup and structure');
await t('deleting an account deletes everything of theirs: note, hearts, comments, messages (sent and received), bookkeeping', async () => {
  await FRESH();
  await notesVis(alice, 'everyone');
  await post(alice);
  await post(bob);
  await songVis(alice, 'everyone');
  await playing(alice);
  await likeNote(bob, alice);
  await likeNote(alice, bob);
  await like(bob, alice, 'listening', SONG_KEY, songCtx());
  await commentNote(bob, alice, 'from bob');
  await commentNote(alice, bob, 'from alice');
  await reply(bob, alice, 'private');
  await db.query(`delete from auth.users where id = '${bob}'`);
  for (const [tbl, col] of [['status_notes', 'user_id'], ['activity_likes', 'actor_id'], ['activity_likes', 'owner_id'], ['activity_comments', 'author_id'], ['activity_comments', 'owner_id'], ['activity_messages', 'sender_id'], ['activity_messages', 'recipient_id'], ['private.activity_limits', 'user_id']]) {
    eq(await n(`select count(*)::int n from ${tbl.includes('.') ? tbl : `public.${tbl}`} where ${col} = '${bob}'`), 0, `${tbl}.${col}`);
  }
  eq(await n(`select count(*)::int n from public.status_notes where user_id = '${alice}'`), 1);
  await db.query(`delete from auth.users where id = '${alice}'`);
  for (const tbl of ['status_notes', 'activity_likes', 'activity_comments', 'activity_messages']) eq(await n(`select count(*)::int n from public.${tbl}`), 0, tbl);
  eq(await n('select count(*)::int n from private.activity_limits'), 0);
});
await t('RLS is on for every table, nothing is open to anon, and no function is executable by anon', async () => {
  for (const tbl of ['status_notes', 'activity_likes', 'activity_comments', 'activity_messages'])
    eq((await db.query(`select relrowsecurity from pg_class where oid = 'public.${tbl}'::regclass`)).rows[0].relrowsecurity, true, tbl);
  eq(await n(`select count(*)::int n from information_schema.role_table_grants where table_name in ('status_notes', 'activity_likes', 'activity_comments', 'activity_messages') and grantee = 'anon'`), 0);
  eq(await n(`select count(*)::int n from information_schema.column_privileges where table_name in ('status_notes', 'activity_likes', 'activity_comments', 'activity_messages') and grantee = 'anon'`), 0);
  const fns = (await db.query(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where (s.nspname = 'private' and p.proname like 'act\\_%' escape '\\') or p.proname in ('activity_feed', 'activity_engagement', 'status_notes_guard', 'activity_likes_guard', 'activity_messages_guard')`)).rows;
  eq(fns.length >= 15, true);
  for (const { f } of fns) eq((await db.query(`select has_function_privilege('anon', '${f}', 'execute') ok`)).rows[0].ok, false, f);
});
await t('the tables that clients subscribe to are published to Realtime; comments are not', async () => {
  const pub = (await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`)).rows.map((r) => r.tablename);
  for (const tbl of ['status_notes', 'activity_messages', 'activity_likes']) eq(pub.includes(tbl), true, tbl);
  eq(pub.includes('activity_comments'), false);
});
await t('a client holds no grant it shouldn’t: no update on notes’ times, no insert of ids, kinds or senders', async () => {
  const cols = async (tbl, priv) =>
    (await db.query(`select column_name c from information_schema.column_privileges where table_name = '${tbl}' and grantee = 'authenticated' and privilege_type = '${priv}' order by 1`)).rows.map((r) => r.c);
  eq(await cols('status_notes', 'INSERT'), ['body', 'track_album', 'track_artist', 'track_artwork_url', 'track_source', 'track_title', 'track_url', 'user_id']);
  eq(await cols('status_notes', 'UPDATE'), ['body', 'track_album', 'track_artist', 'track_artwork_url', 'track_source', 'track_title', 'track_url', 'user_id']);
  eq(await cols('activity_likes', 'INSERT'), ['context', 'kind', 'owner_id', 'subject_key']);
  eq(await cols('activity_likes', 'UPDATE'), []);
  eq(await cols('activity_comments', 'INSERT'), ['body', 'owner_id', 'subject_key']);
  eq(await cols('activity_comments', 'UPDATE'), []);
  eq(await cols('activity_messages', 'INSERT'), ['body', 'context', 'recipient_id']);
  eq(await cols('activity_messages', 'UPDATE'), ['read_at']);
});
await t('the migration is safe to run twice (it is pasted into the SQL editor), and changes nothing', async () => {
  const sql = fs.readFileSync(new URL('../migrations/20261120000000_activity.sql', import.meta.url), 'utf8');
  const shape = async () => ({
    policies: (await db.query(`select tablename, count(*)::int n from pg_policies where tablename in ('status_notes', 'activity_likes', 'activity_comments', 'activity_messages') group by 1 order by 1`)).rows,
    triggers: (await db.query(`select tgrelid::regclass::text t, count(*)::int n from pg_trigger where not tgisinternal and tgrelid::regclass::text in ('public.status_notes', 'public.activity_likes', 'public.activity_comments', 'public.activity_messages', 'public.profiles') group by 1 order by 1`)).rows,
    pub: (await db.query(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('status_notes', 'activity_messages', 'activity_likes')`)).rows[0].n,
    constraints: (await db.query(`select count(*)::int n from pg_constraint where conrelid in ('public.status_notes'::regclass, 'public.activity_likes'::regclass, 'public.activity_comments'::regclass, 'public.activity_messages'::regclass)`)).rows[0].n,
  });
  const before = await shape();
  await db.exec(sql);
  await db.exec(sql);
  eq(await shape(), before);
  eq(before.policies, [{ tablename: 'activity_comments', n: 3 }, { tablename: 'activity_likes', n: 3 }, { tablename: 'activity_messages', n: 4 }, { tablename: 'status_notes', n: 4 }]);
  eq(before.pub, 3);
  // …and it still works afterwards (alice and bob were deleted above: two new people who share a community)
  const erin = await addUser(db, 'erin@x.test');
  const frank = await addUser(db, 'frank@x.test');
  const c2 = crypto.randomUUID();
  await as(db, erin, `insert into public.communities (id, name) values ('${c2}', 'Second Club')`);
  await db.query(`insert into public.community_members (community_id, user_id) values ('${c2}', '${frank}')`);
  await wipe();
  await post(erin);
  await likeNote(frank, erin);
  await commentNote(frank, erin, 'after the rerun');
  eq(await n('select count(*)::int n from public.activity_messages'), 2);
  eq((await feed(frank))[0].likes, 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
