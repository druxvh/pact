// "Now playing": who may see a person's current track, what a row may contain, the server's clock, the rate limit and the
// cleanup — tested as different users against the real migrations. Run with: bun supabase/tests/nowplaying.mjs
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
const dave = await addUser(db, 'dave@x.test');

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const setVisibility = (uid, v) => as(db, uid, `update public.profiles set now_playing_visibility = ${q(v)} where id = '${uid}'`);
const visibilityOf = async (uid) => (await as(db, uid, `select now_playing_visibility v from public.profiles where id = '${uid}'`))[0].v;

/** A valid Spotify row, with overrides. `null` values are written as SQL null. */
const row = (over = {}) => ({
  title: 'Night Drive',
  artist: 'The Tests',
  album: 'Fixtures',
  artwork_url: 'https://i.scdn.co/image/ab67616d00001e02',
  track_url: 'https://open.spotify.com/track/abc123',
  source: 'spotify',
  ...over,
});
const insertSql = (uid, r) => {
  const cols = Object.keys(r);
  return `insert into public.now_playing (user_id, ${cols.join(', ')}) values ('${uid}', ${cols.map((c) => (r[c] === null ? 'null' : q(r[c]))).join(', ')})`;
};
const put = (uid, over = {}) => as(db, uid, insertSql(uid, row(over)));
/** What `upsert` does on every heartbeat. */
const upsert = (uid, over = {}) => {
  const r = row(over);
  const set = Object.keys(r).map((c) => `${c} = excluded.${c}`);
  return as(db, uid, `${insertSql(uid, r)} on conflict (user_id) do update set user_id = excluded.user_id, ${set.join(', ')}`);
};
const mine = (uid) => as(db, uid, `select * from public.now_playing where user_id = '${uid}'`);
const seen = async (viewer, owner) => (await as(db, viewer, `select title from public.now_playing where user_id = '${owner}'`)).length;
/** Make the stored row look `interval` old without going through the guard (which stamps the server's time). */
const age = async (uid, interval) => {
  await db.exec('alter table public.now_playing disable trigger now_playing_guard_trg');
  await db.query(`update public.now_playing set updated_at = now() - interval '${interval}' where user_id = '${uid}'`);
  await db.exec('alter table public.now_playing enable trigger now_playing_guard_trg');
};
const wipe = () => db.exec('delete from public.now_playing; delete from private.now_playing_writes');

// alice + bob share a community
const cid = crypto.randomUUID();
await as(db, alice, `insert into public.communities (id, name) values ('${cid}', 'Pact Club')`);
await db.query(`insert into public.community_members (community_id, user_id) values ('${cid}', '${bob}')`);

console.log('sharing is off until chosen');
await t('every profile starts at "off"', async () => {
  for (const u of [alice, bob, carol, dave]) eq(await visibilityOf(u), 'off');
});
await t('nothing can be written while sharing is off — the database refuses, whatever the client does', async () => {
  await denied(put(alice), /row-level security/);
  eq((await db.query('select count(*)::int n from public.now_playing')).rows[0].n, 0);
});
await t('the setting only takes off / communities / everyone', async () => {
  await denied(setVisibility(alice, 'friends'), /profiles_now_playing_visibility|check/);
  await denied(setVisibility(alice, ''), /profiles_now_playing_visibility|check/);
  eq(await visibilityOf(alice), 'off');
});
await t('you can change only your own setting', async () => {
  eq((await as(db, bob, `update public.profiles set now_playing_visibility = 'everyone' where id = '${alice}' returning id`)).length, 0);
  eq(await visibilityOf(alice), 'off');
});
await t('with sharing on, you can write your own row — and only yours', async () => {
  await setVisibility(alice, 'communities');
  await put(alice);
  eq((await mine(alice)).length, 1);
  await denied(as(db, alice, insertSql(bob, row())), /row-level security/);
});

console.log('what a row may hold');
await t('a normal row is accepted; text is trimmed', async () => {
  await wipe();
  await put(alice, { title: '  Night Drive  ', artist: ' The Tests ' });
  const [r] = await mine(alice);
  eq([r.title, r.artist], ['Night Drive', 'The Tests']);
});
await t('title is required; artist and album may be empty', async () => {
  await wipe();
  await denied(put(alice, { title: '' }), /now_playing_title_length|check/);
  await denied(put(alice, { title: '   ' }), /now_playing_title_length|check/);
  await put(alice, { artist: '', album: '', artwork_url: null, track_url: null });
});
await t('length caps: 150 characters of title / artist / album', async () => {
  await wipe();
  await put(alice, { title: 'a'.repeat(150), artist: 'b'.repeat(150), album: 'c'.repeat(150) });
  await wipe();
  await denied(put(alice, { title: 'a'.repeat(151) }), /now_playing_title_length|check/);
  await denied(put(alice, { artist: 'b'.repeat(151) }), /now_playing_artist_length|check/);
  await denied(put(alice, { album: 'c'.repeat(151) }), /now_playing_album_length|check/);
});
await t('control characters, line breaks, zero-width characters and bidi overrides are refused', async () => {
  await wipe();
  const bad = [
    'a\nb',
    'a\tb',
    `a${String.fromCodePoint(0x1b)}b`,
    `a${String.fromCodePoint(0x202e)}b`, // right-to-left override
    `a${String.fromCodePoint(0x2066)}b`, // bidi isolate
    `a${String.fromCodePoint(0x200b)}b`, // zero-width space
    `a${String.fromCodePoint(0xfeff)}b`,
    `a${String.fromCodePoint(0x2028)}b`,
    `a${String.fromCodePoint(0x85)}b`, // C1 control
  ];
  for (const title of bad) await denied(put(alice, { title }), /now_playing_text_clean|check/);
  for (const field of ['artist', 'album']) await denied(put(alice, { [field]: `a${String.fromCodePoint(0x202e)}b` }), /now_playing_text_clean|check/);
  // ordinary non-Latin text and emoji are fine
  await put(alice, { title: 'Sür Ma Ruh — 夜に駆ける 🎧', artist: 'ירדן' });
});
await t('the source must be a known player', async () => {
  await wipe();
  for (const source of ['napster', 'Spotify', '', 'spotify ']) await denied(put(alice, { source }), /now_playing_source|check|now_playing_artwork|now_playing_track/);
  for (const source of ['spotify', 'youtube-music', 'soundcloud', 'apple-music', 'deezer', 'tidal']) {
    await wipe();
    await put(alice, { source, artwork_url: null, track_url: null });
  }
});

console.log('artwork and track links');
const art = (url, source = 'spotify') => put(alice, { artwork_url: url, source, track_url: null });
const link = (url, source = 'spotify') => put(alice, { track_url: url, source, artwork_url: null });
await t('artwork must be https on the player’s own image hosts — exact or a real subdomain', async () => {
  await wipe();
  for (const [source, url] of [
    ['spotify', 'https://i.scdn.co/image/abc'],
    ['spotify', 'https://image-cdn-ak.spotifycdn.com/image/abc'],
    ['spotify', 'https://scdn.co/x.jpg'],
    ['youtube-music', 'https://lh3.googleusercontent.com/abc=w544-h544'],
    ['youtube-music', 'https://i.ytimg.com/vi/x/hq720.jpg'],
    ['youtube-music', 'https://yt3.ggpht.com/abc'],
    ['soundcloud', 'https://i1.sndcdn.com/artworks-abc-large.jpg'],
    ['apple-music', 'https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg'],
    ['deezer', 'https://cdn-images.dzcdn.net/images/cover/x/500x500.jpg'],
    ['tidal', 'https://resources.tidal.com/images/x/640x640.jpg'],
    ['spotify', 'https://i.scdn.co:443/image/abc'],
    ['spotify', 'https://I.SCDN.CO/image/abc'],
  ]) {
    await wipe();
    await art(url, source);
  }
});
await t('…and nothing that merely contains the name, or any address a person could choose themselves', async () => {
  await wipe();
  const bad = [
    'https://evil.example/i.scdn.co/image/abc', // the trusted name in the PATH
    'https://i.scdn.co.evil.example/image/abc', // …as a prefix of someone else's host
    'https://evili.scdn.co.evil.example/x',
    'https://notscdn.co/x.jpg', // a longer name that ends the same way
    'https://i.scdn.co@evil.example/x.jpg', // credentials trick
    'https://user:pw@i.scdn.co/x.jpg',
    'https://i.scdn.co./x.jpg', // trailing dot
    'https://i.scdn.co:8443/x.jpg', // another port
    'http://i.scdn.co/x.jpg', // not https
    'ftp://i.scdn.co/x.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'blob:https://open.spotify.com/1234',
    '//i.scdn.co/x.jpg',
    'https://i.scdn.co/x.jpg y', // whitespace
    'https://i.scdn.co/x\n.jpg',
    'https://192.168.0.1/x.jpg',
    'https://localhost/x.jpg',
    `https://i.scdn.co/${'a'.repeat(500)}`, // too long
    'https://images.weserv.nl/?url=i.scdn.co/x', // a proxy that fetches anything
    'https://i.scdn.co.evil.example',
  ];
  for (const url of bad) await denied(art(url), /now_playing_artwork|check/);
});
await t('an image host of ANOTHER player doesn’t do (each source has its own list)', async () => {
  await wipe();
  await denied(art('https://i.ytimg.com/vi/x/hq720.jpg', 'spotify'), /now_playing_artwork|check/);
  await denied(art('https://i.scdn.co/image/abc', 'youtube-music'), /now_playing_artwork|check/);
});
await t('track links: the player’s own site only', async () => {
  await wipe();
  for (const [source, url] of [
    ['spotify', 'https://open.spotify.com/track/abc?si=123'],
    ['youtube-music', 'https://music.youtube.com/watch?v=abc'],
    ['soundcloud', 'https://soundcloud.com/artist/track'],
    ['soundcloud', 'https://m.soundcloud.com/artist/track'],
    ['apple-music', 'https://music.apple.com/us/album/x/1?i=2'],
    ['deezer', 'https://www.deezer.com/track/1'],
    ['tidal', 'https://listen.tidal.com/track/1'],
  ]) {
    await wipe();
    await link(url, source);
  }
  for (const [source, url] of [
    ['spotify', 'https://evil.example/open.spotify.com/track/abc'],
    ['spotify', 'https://open.spotify.com.evil.example/track/abc'],
    ['spotify', 'https://spotify.com.evil.example/track/abc'],
    ['spotify', 'http://open.spotify.com/track/abc'],
    ['spotify', 'https://music.youtube.com/watch?v=abc'], // another player
    ['youtube-music', 'https://www.youtube.com/watch?v=abc'], // YouTube itself isn't a music player here
    ['deezer', 'https://deezer.com.evil.example/'],
  ])
    await denied(link(url, source), /now_playing_track|check/);
});
await t('an empty address is stored as "none"', async () => {
  await wipe();
  await put(alice, { artwork_url: '  ', track_url: '' });
  const [r] = await mine(alice);
  eq([r.artwork_url, r.track_url], [null, null]);
});

console.log('the server decides the time, and how often you may write');
await t('updated_at isn’t something a client can send, on insert or update', async () => {
  await wipe();
  await denied(as(db, alice, `insert into public.now_playing (user_id, title, source, updated_at) values ('${alice}', 'x', 'spotify', now() + interval '1 day')`), /permission denied/);
  await put(alice);
  await denied(as(db, alice, `update public.now_playing set updated_at = now() + interval '1 day' where user_id = '${alice}'`), /permission denied/);
});
await t('even the table’s owner can’t back-date or forward-date a row through a normal write', async () => {
  await wipe();
  await db.query(`insert into public.now_playing (user_id, title, source, updated_at) values ('${alice}', 'x', 'spotify', now() - interval '1 day')`);
  const [r] = (await db.query(`select (now() - updated_at) < interval '1 minute' as fresh from public.now_playing`)).rows;
  eq(r.fresh, true);
});
await t('a heartbeat (upsert of the same track) refreshes the time and keeps one row', async () => {
  await wipe();
  await put(alice);
  await age(alice, '90 seconds');
  const before = (await db.query(`select extract(epoch from now() - updated_at)::int s from public.now_playing`)).rows[0].s;
  eq(before >= 89, true);
  await upsert(alice);
  eq((await mine(alice)).length, 1);
  const after = (await db.query(`select extract(epoch from now() - updated_at)::int s from public.now_playing`)).rows[0].s;
  eq(after < 5, true);
});
await t('the track can change under the same row', async () => {
  await upsert(alice, { title: 'Second song' });
  eq((await mine(alice))[0].title, 'Second song');
});
await t('you can’t move your row to someone else', async () => {
  await denied(as(db, alice, `update public.now_playing set user_id = '${bob}' where user_id = '${alice}'`), /row-level security|immutable_column/);
});
await t('at most 20 writes a minute per person; then it opens again, and nobody else is affected', async () => {
  await wipe();
  for (let i = 0; i < 20; i++) await upsert(alice, { title: `Song ${i}` });
  await denied(upsert(alice, { title: 'Song 21' }), /rate_limited/);
  await setVisibility(bob, 'communities');
  await put(bob); // another person is fine
  await db.query(`update private.now_playing_writes set window_start = now() - interval '2 minutes' where user_id = '${alice}'`);
  await upsert(alice, { title: 'Song 22' });
  eq((await mine(alice))[0].title, 'Song 22');
});
await t('the rate-limit bookkeeping isn’t readable or writable by people', async () => {
  await denied(as(db, alice, 'select * from private.now_playing_writes'), /permission denied/);
  await denied(as(db, alice, `delete from private.now_playing_writes where user_id = '${alice}'`), /permission denied/);
});

console.log('who can see it');
await t('the owner always sees their own row', async () => {
  await wipe();
  await put(alice);
  eq(await seen(alice, alice), 1);
});
await t('"communities": people who share a community see it; strangers, and everyone else, do not', async () => {
  eq(await visibilityOf(alice), 'communities');
  eq(await seen(bob, alice), 1);
  eq(await seen(carol, alice), 0);
  eq(await seen(dave, alice), 0);
});
await t('anonymous visitors see nothing, whatever the setting', async () => {
  await setVisibility(alice, 'everyone');
  await denied(as(db, null, 'select * from public.now_playing'), /permission denied/);
});
await t('"everyone": any signed-in person sees it', async () => {
  eq(await visibilityOf(alice), 'everyone');
  for (const v of [bob, carol, dave]) eq(await seen(v, alice), 1);
});
await t('changing "everyone" to "communities" hides it from strangers straight away — no new write needed', async () => {
  await setVisibility(alice, 'communities');
  eq(await seen(carol, alice), 0);
  eq(await seen(bob, alice), 1);
  eq((await mine(alice)).length, 1);
});
await t('leaving the community ends the access', async () => {
  await db.query(`delete from public.community_members where community_id = '${cid}' and user_id = '${bob}'`);
  eq(await seen(bob, alice), 0);
  await db.query(`insert into public.community_members (community_id, user_id) values ('${cid}', '${bob}')`);
  eq(await seen(bob, alice), 1);
});
await t('only FRESH rows are visible to others: older than 2 minutes counts as "not listening"', async () => {
  await age(alice, '119 seconds');
  eq(await seen(bob, alice), 1);
  await age(alice, '121 seconds');
  eq(await seen(bob, alice), 0);
  eq(await seen(alice, alice), 1); // the owner still sees their own row (the extension is about to refresh it)
  await upsert(alice);
  eq(await seen(bob, alice), 1);
});
await t('other people can’t change or delete your row', async () => {
  await setVisibility(alice, 'everyone');
  eq((await as(db, carol, `update public.now_playing set title = 'hijacked' where user_id = '${alice}' returning user_id`)).length, 0);
  eq((await as(db, carol, `delete from public.now_playing where user_id = '${alice}' returning user_id`)).length, 0);
  eq((await mine(alice))[0].title !== 'hijacked', true);
});
await t('you can delete your own row (what the extension does when music stops)', async () => {
  await as(db, alice, `delete from public.now_playing where user_id = '${alice}'`);
  eq((await mine(alice)).length, 0);
  eq(await seen(bob, alice), 0);
});

console.log('turning sharing off removes what was shared');
await t('setting the visibility to "off" deletes the row in the database', async () => {
  await wipe();
  await put(alice);
  eq(await seen(bob, alice), 1);
  await setVisibility(alice, 'off');
  eq((await db.query('select count(*)::int n from public.now_playing')).rows[0].n, 0);
  await denied(put(alice), /row-level security/); // …and it can't be written again until chosen
});
await t('switching between "communities" and "everyone" keeps it', async () => {
  await setVisibility(alice, 'communities');
  await put(alice);
  await setVisibility(alice, 'everyone');
  eq((await mine(alice)).length, 1);
});
await t('if sharing is turned off elsewhere, a heartbeat from a stale client is refused', async () => {
  await setVisibility(alice, 'off');
  await denied(upsert(alice), /row-level security/);
});

console.log('reading with ages (now_playing_for)');
await t('returns only what the caller may see, with the age by the server’s clock', async () => {
  await wipe();
  await setVisibility(alice, 'communities');
  await put(alice);
  await age(alice, '45 seconds');
  const [r] = await as(db, bob, `select * from public.now_playing_for(array['${alice}'::uuid, '${carol}'::uuid])`);
  eq([r.user_id, r.title, r.source], [alice, 'Night Drive', 'spotify']);
  eq(r.age_seconds >= 44 && r.age_seconds <= 50, true);
  eq((await as(db, carol, `select * from public.now_playing_for(array['${alice}'::uuid])`)).length, 0); // not in the community
});
await t('a stale row, or an empty / null list, returns nothing', async () => {
  await age(alice, '5 minutes');
  eq((await as(db, bob, `select * from public.now_playing_for(array['${alice}'::uuid])`)).length, 0);
  eq((await as(db, bob, `select * from public.now_playing_for(array[]::uuid[])`)).length, 0);
  eq((await as(db, bob, `select * from public.now_playing_for(null)`)).length, 0);
});
await t('it looks at no more than 100 ids', async () => {
  await wipe();
  await put(alice);
  const ids = Array.from({ length: 100 }, () => `'${crypto.randomUUID()}'::uuid`);
  eq((await as(db, bob, `select * from public.now_playing_for(array[${ids.join(',')}, '${alice}'::uuid])`)).length, 0); // alice is the 101st
  eq((await as(db, bob, `select * from public.now_playing_for(array[${ids.slice(0, 99).join(',')}, '${alice}'::uuid])`)).length, 1);
});
await t('it is closed to anon', async () => denied(as(db, null, `select * from public.now_playing_for(array['${alice}'::uuid])`), /permission denied/));

console.log('housekeeping');
await t('any new write sweeps rows nobody refreshed for ten minutes', async () => {
  await wipe();
  await setVisibility(carol, 'everyone');
  await put(carol);
  await age(carol, '11 minutes');
  await setVisibility(alice, 'communities');
  await put(alice);
  eq((await db.query(`select count(*)::int n from public.now_playing where user_id = '${carol}'`)).rows[0].n, 0);
  eq((await mine(alice)).length, 1);
});
await t('deleting the account deletes the row and the bookkeeping', async () => {
  await db.query(`delete from auth.users where id = '${alice}'`);
  eq((await db.query('select count(*)::int n from public.now_playing')).rows[0].n, 0);
  eq((await db.query(`select count(*)::int n from private.now_playing_writes where user_id = '${alice}'`)).rows[0].n, 0);
});
await t('RLS is on, nothing is open to anon, and the table is in the Realtime publication', async () => {
  eq((await db.query(`select relrowsecurity from pg_class where oid = 'public.now_playing'::regclass`)).rows[0].relrowsecurity, true);
  eq((await db.query(`select count(*)::int n from information_schema.role_table_grants where table_name = 'now_playing' and grantee = 'anon'`)).rows[0].n, 0);
  eq(
    (await db.query(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'now_playing'`)).rows[0].n,
    1,
  );
});
await t('the migration is safe to run twice (it is pasted into the SQL editor), and changes nothing', async () => {
  const sql = fs.readFileSync(new URL('../migrations/20261119100000_now_playing.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  await setVisibility(bob, 'everyone');
  await put(bob);
  eq(await seen(bob, bob), 1);
  eq((await db.query(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'now_playing'`)).rows[0].n, 1);
  eq((await db.query(`select count(*)::int n from pg_policies where tablename = 'now_playing'`)).rows[0].n, 5);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
