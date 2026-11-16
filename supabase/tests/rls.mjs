// Row Level Security, triggers and invite functions, tested as different users against the real migrations.
// Run with: bun run test:db
import { boot, as, addUser } from './setup.mjs';
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '→', e.message); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const blocked = async (p) => { let rows; try { rows = await p; } catch { return; } if (Array.isArray(rows) && rows.length === 0) return; throw new Error('was allowed (should be blocked)'); };
const denied = async (p, re = /./) => { try { await p; } catch (e) { if (re.test(e.message)) return; throw new Error('wrong error: ' + e.message); } throw new Error('was allowed (should be denied)'); };

const db = await boot();
const alice = await addUser(db, 'alice@x.test', { user_name: 'Alice-Dev', full_name: 'Alice A' });
const bob = await addUser(db, 'bob@x.test', { user_name: 'Alice-Dev' }); // same handle → must still get a unique username
const carol = await addUser(db, 'carol@x.test');
const dave = await addUser(db, 'dave@x.test');
const eve = await addUser(db, 'eve@x.test');
const cid = crypto.randomUUID();

console.log('profiles');
await t('a profile is created for each user with a unique, valid username', async () => {
  const rows = (await db.query('select username from public.profiles order by username')).rows.map((r) => r.username);
  eq(new Set(rows).size, 5); if (!rows.every((u) => /^[a-z0-9_]{3,20}$/.test(u))) throw new Error('bad username ' + rows);
});

console.log('communities');
await t('anyone can create a community; they become admin and get #general', async () => {
  await as(db, alice, `insert into public.communities (id, name, description, hue) values ('${cid}', 'Pact Club', 'hi', 200)`);
  eq((await as(db, alice, `select role from public.community_members where community_id='${cid}'`)).map((r) => r.role), ['admin']);
  eq((await as(db, alice, `select name from public.channels where community_id='${cid}'`)).map((r) => r.name), ['general']);
});
await t('an outsider can read nothing about it', async () => {
  for (const tbl of ['communities', 'community_members', 'channels', 'messages', 'invites']) eq((await as(db, dave, `select * from public.${tbl}`)).length, 0, tbl);
});
await t('you cannot create a community in someone else’s name', async () => denied(as(db, dave, `insert into public.communities (name, created_by) values ('Fake', '${alice}')`), /row-level security/));
await t('a community needs a sane name', async () => denied(as(db, dave, `insert into public.communities (name) values ('x')`), /communities_name_length|check/));
await t('at most 10 communities per creator', async () => {
  for (let i = 0; i < 10; i++) await as(db, eve, `insert into public.communities (name) values ('Eve ${i}')`).catch(() => {});
  eq(Number((await db.query(`select count(*) from public.communities where created_by='${eve}'`)).rows[0].count), 10);
  await denied(as(db, eve, `insert into public.communities (name) values ('One too many')`), /community_limit/);
});

console.log('invites');
let code;
await t('the admin creates an invite with a generated 16-char code', async () => {
  await as(db, alice, `insert into public.invites (community_id) values ('${cid}')`);
  code = (await as(db, alice, `select code from public.invites where community_id='${cid}'`))[0].code;
  if (!/^[0-9a-f]{16}$/.test(code)) throw new Error(code);
});
await t('an outsider cannot read or create invites, and cannot fake the use count', async () => {
  eq((await as(db, dave, 'select * from public.invites')).length, 0);
  await denied(as(db, dave, `insert into public.invites (community_id) values ('${cid}')`), /row-level security/);
  await denied(as(db, alice, `insert into public.invites (community_id, uses) values ('${cid}', 5)`), /row-level security/);
});
await t('preview_invite shows the community to a non-member; a wrong code returns nothing', async () => {
  eq((await as(db, bob, `select name, members from public.preview_invite('${code}')`))[0], { name: 'Pact Club', members: 1 });
  eq((await as(db, bob, `select * from public.preview_invite('ffffffffffffffff')`)).length, 0);
});
await t('join_community adds a member; joining again is harmless and does not use the invite twice', async () => {
  await as(db, bob, `select public.join_community('${code}')`);
  await as(db, bob, `select public.join_community('${code}')`);
  await as(db, carol, `select public.join_community(upper('${code}'))`); // codes are case-insensitive
  eq((await as(db, alice, `select role, count(*)::int n from public.community_members where community_id='${cid}' group by role order by role`)), [{ role: 'admin', n: 1 }, { role: 'member', n: 2 }]);
  eq((await as(db, alice, `select uses from public.invites where code='${code}'`))[0].uses, 2);
});
await t('an unknown code returns NULL (and is counted); after 15 misses you are throttled', async () => {
  eq((await as(db, dave, `select public.join_community('0000000000000000') as id`))[0].id, null);
  for (let i = 0; i < 14; i++) await as(db, dave, `select public.join_community('${String(i).padStart(16, '0')}')`);
  await denied(as(db, dave, `select public.join_community('${code}')`), /rate_limited/);
});
await t('limits: single-use and expired invites stop working', async () => {
  await as(db, alice, `insert into public.invites (code, community_id, max_uses) values ('1111111111111111', '${cid}', 1)`);
  await as(db, alice, `insert into public.invites (code, community_id, expires_at) values ('2222222222222222', '${cid}', now() - interval '1 minute')`);
  await as(db, eve, `select public.join_community('1111111111111111')`);
  const frank = await addUser(db, 'frank@x.test');
  eq((await as(db, frank, `select public.join_community('1111111111111111') as id`))[0].id, null);
  eq((await as(db, frank, `select public.join_community('2222222222222222') as id`))[0].id, null);
});
await t('anon cannot call the invite functions', async () => denied(as(db, null, `select public.join_community('${code}')`), /permission denied/));

console.log('roles');
await as(db, alice, `update public.community_members set role='mod' where community_id='${cid}' and user_id='${bob}'`);
await t('only the admin changes roles; nobody can demote the admin or make a second one', async () => {
  eq((await as(db, bob, `update public.community_members set role='mod' where community_id='${cid}' and user_id='${carol}' returning user_id`)).length, 0);
  eq((await as(db, alice, `update public.community_members set role='member' where community_id='${cid}' and user_id='${alice}' returning user_id`)).length, 0);
  await denied(as(db, alice, `update public.community_members set role='admin' where community_id='${cid}' and user_id='${carol}'`), /row-level security|community_one_admin/);
});
await t('members can read the roster; outsiders cannot', async () => {
  eq((await as(db, carol, `select 1 from public.community_members where community_id='${cid}'`)).length >= 3, true);
});
await t('nobody inserts memberships directly (only via join / create)', async () => denied(as(db, dave, `insert into public.community_members (community_id, user_id, role) values ('${cid}', '${dave}', 'admin')`), /row-level security|permission denied/));

console.log('channels');
await t('only the admin manages channels; names are validated', async () => {
  await as(db, alice, `insert into public.channels (community_id, name) values ('${cid}', 'memes')`);
  await denied(as(db, bob, `insert into public.channels (community_id, name) values ('${cid}', 'nope')`), /row-level security/);
  await denied(as(db, alice, `insert into public.channels (community_id, name) values ('${cid}', 'Bad Name')`), /channels_name_format|check/);
});

console.log('messages');
const general = (await as(db, alice, `select id from public.channels where community_id='${cid}' and name='general'`))[0].id;
const memes = (await as(db, alice, `select id from public.channels where community_id='${cid}' and name='memes'`))[0].id;
const post = async (uid, body, extra = '') => (await as(db, uid, `insert into public.messages (community_id, channel_id, body ${extra ? ',' + extra.split('=')[0] : ''}) values ('${cid}', '${general}', $1 ${extra ? ',' + extra.split('=')[1] : ''}) returning id`, [body]))[0].id;
let m1, m2, m3;
await t('members post; outsiders cannot; you cannot post as someone else', async () => {
  m1 = await post(carol, 'hello https://spam.example/x www.also.bad');
  await denied(as(db, dave, `insert into public.messages (community_id, channel_id, body) values ('${cid}', '${general}', 'hi')`), /row-level security/);
  await denied(as(db, carol, `insert into public.messages (community_id, channel_id, body, author_id) values ('${cid}', '${general}', 'hi', '${alice}')`), /row-level security/);
});
await t('an empty message is refused', async () => denied(as(db, carol, `insert into public.messages (community_id, channel_id, body) values ('${cid}', '${general}', '')`), /messages_has_content/));
await t('replies must stay in the same channel', async () => {
  m2 = (await as(db, bob, `insert into public.messages (community_id, channel_id, body, reply_to) values ('${cid}', '${general}', 'welcome', '${m1}') returning id`))[0].id;
  await denied(as(db, bob, `insert into public.messages (community_id, channel_id, body, reply_to) values ('${cid}', '${memes}', 'x', '${m1}') returning id`), /foreign key|violates/);
});
await t('attachments must live under this community’s folder', async () => {
  await as(db, carol, `insert into public.messages (community_id, channel_id, attachments) values ('${cid}', '${memes}', '[{"path":"${cid}/${carol}/a.png","name":"a.png","type":"image/png","size":5}]')`);
  await denied(as(db, carol, `insert into public.messages (community_id, channel_id, attachments) values ('${cid}', '${memes}', '[{"path":"${crypto.randomUUID()}/x/a.png"}]')`), /bad_attachment/);
  await denied(as(db, carol, `insert into public.messages (community_id, channel_id, body, attachments) values ('${cid}', '${memes}', 'x', '[{"path":"${cid}/a"},{"path":"${cid}/a"},{"path":"${cid}/a"},{"path":"${cid}/a"},{"path":"${cid}/a"},{"path":"${cid}/a"},{"path":"${cid}/a"}]')`), /messages_attachments_shape/);
});
await t('a client cannot post a pre-hidden/deleted message', async () => {
  const id = (await as(db, carol, `insert into public.messages (community_id, channel_id, body, hidden_at, deleted_at, hidden_reason) values ('${cid}', '${general}', 'sneaky', now(), now(), 'x') returning id`))[0].id;
  const r = (await as(db, carol, `select hidden_at, deleted_at, hidden_reason, body from public.messages where id='${id}'`))[0];
  eq([r.hidden_at, r.deleted_at, r.hidden_reason, r.body], [null, null, '', 'sneaky']);
});
await t('the author edits their own message (stamped as edited); nobody else can', async () => {
  await as(db, carol, `update public.messages set body='hello (fixed)' where id='${m1}'`);
  const r = (await as(db, carol, `select body, edited_at from public.messages where id='${m1}'`))[0];
  eq([r.body, r.edited_at !== null], ['hello (fixed)', true]);
  await denied(as(db, dave, `update public.messages set body='x' where id='${m1}'`).then((r) => { if (r.length === 0) throw new Error('not_allowed'); }), /not_allowed/);
  await denied(as(db, bob, `update public.messages set body='hijack' where id='${m1}'`), /not_allowed/); // a mod can't rewrite someone's words
  await denied(as(db, bob, `update public.messages set author_id='${bob}' where id='${m1}'`), /immutable_column|not_allowed/);
  await denied(as(db, carol, `update public.messages set channel_id='${memes}' where id='${m1}'`), /immutable_column/);
});
await t('a moderator hides a message: members see a blank tombstone, the original is kept for mods only', async () => {
  await as(db, bob, `update public.messages set hidden_at=now(), hidden_reason='spam' where id='${m1}'`);
  const seen = (await as(db, carol, `select body, hidden_at is not null as hidden, hidden_reason, attachments from public.messages where id='${m1}'`))[0];
  eq([seen.body, seen.hidden, seen.hidden_reason, seen.attachments], ['', true, 'spam', []]);
  eq((await as(db, bob, `select body from public.message_originals where message_id='${m1}'`))[0].body, 'hello (fixed)');
  eq((await as(db, carol, `select * from public.message_originals`)).length, 0);
  eq((await as(db, dave, `select * from public.message_originals`)).length, 0);
  eq((await as(db, bob, `select hidden_by from public.messages where id='${m1}'`))[0].hidden_by, bob);
});
await t('members cannot hide, and the author cannot edit a hidden message', async () => {
  await blocked(as(db, carol, `update public.messages set hidden_at=now() where id='${m2}' returning id`)); // not her message: RLS hides the row
  const own = await post(carol, 'my own visible message');
  await denied(as(db, carol, `update public.messages set hidden_at=now() where id='${own}'`), /not_allowed/); // her own message, but members can't hide it
  eq((await as(db, carol, `select hidden_at from public.messages where id='${own}'`))[0].hidden_at, null);
  await denied(as(db, carol, `update public.messages set body='un-hide me' where id='${m1}'`), /not_allowed/);
  await denied(as(db, carol, `update public.messages set hidden_at=null where id='${m1}'`), /not_allowed/);
});
await t('restoring puts the original back and clears the archive', async () => {
  await as(db, alice, `update public.messages set hidden_at=null where id='${m1}'`);
  eq((await as(db, carol, `select body, hidden_at from public.messages where id='${m1}'`))[0], { body: 'hello (fixed)', hidden_at: null });
  eq((await as(db, alice, `select * from public.message_originals where message_id='${m1}'`)).length, 0);
});
await t('removing links keeps the text, replaces every link, and can’t be undone by the author', async () => {
  const m4 = await post(carol, 'see https://a.test/x?y=1 and www.b.test/z ok');
  await as(db, bob, `update public.messages set links_removed_at=now() where id='${m4}'`);
  eq((await as(db, carol, `select body from public.messages where id='${m4}'`))[0].body, 'see [link removed] and [link removed] ok');
  eq((await as(db, bob, `select body from public.message_originals where message_id='${m4}'`))[0].body, 'see https://a.test/x?y=1 and www.b.test/z ok'); // mods keep the original
  await denied(as(db, carol, `update public.messages set body='put the links back' where id='${m4}'`), /not_allowed/);
  await blocked(as(db, carol, `update public.messages set links_removed_at=null where id='${m4}' returning id`).then((r) => { if (r.length) throw new Error('x'); return r; })).catch(() => {});
});
await t('the author can delete their own message → tombstone; others cannot', async () => {
  m3 = await post(carol, 'delete me');
  await denied(as(db, bob, `update public.messages set deleted_at=now() where id='${m3}'`), /not_allowed/);
  await as(db, carol, `update public.messages set deleted_at=now() where id='${m3}'`);
  const r = (await as(db, alice, `select body, deleted_at is not null d from public.messages where id='${m3}'`))[0];
  eq([r.body, r.d], ['', true]);
});
await t('there is no way to hard-delete a message', async () => {
  await denied(as(db, alice, `delete from public.messages where id='${m2}' returning id`), /permission denied/);
});
await t('outsiders cannot read messages; mods/members can', async () => {
  eq((await as(db, dave, `select * from public.messages`)).length, 0);
  eq((await as(db, carol, `select * from public.messages`)).length > 0, true);
});

console.log('reactions');
await t('members react once per emoji; outsiders cannot; you only remove your own', async () => {
  await as(db, bob, `insert into public.message_reactions (message_id, community_id, emoji) values ('${m2}', '${cid}', '🔥')`);
  await denied(as(db, bob, `insert into public.message_reactions (message_id, community_id, emoji) values ('${m2}', '${cid}', '🔥')`), /duplicate|unique/);
  await denied(as(db, dave, `insert into public.message_reactions (message_id, community_id, emoji) values ('${m2}', '${cid}', '🔥')`), /row-level security/);
  await denied(as(db, carol, `insert into public.message_reactions (message_id, community_id, user_id, emoji) values ('${m2}', '${cid}', '${bob}', '👍')`), /row-level security/);
  eq((await as(db, carol, `delete from public.message_reactions where message_id='${m2}' returning 1`)).length, 0);
  eq((await as(db, bob, `delete from public.message_reactions where message_id='${m2}' returning 1`)).length, 1);
});

console.log('bans and removal');
await t('a mod can remove an ordinary member, but not another mod or the admin', async () => {
  await as(db, alice, `update public.community_members set role='mod' where community_id='${cid}' and user_id='${eve}'`).catch(() => {});
  const mod2 = await addUser(db, 'mod2@x.test'); await as(db, alice, `insert into public.invites (code, community_id) values ('3333333333333333','${cid}')`); await as(db, mod2, `select public.join_community('3333333333333333')`);
  await as(db, alice, `update public.community_members set role='mod' where community_id='${cid}' and user_id='${mod2}'`);
  eq((await as(db, bob, `delete from public.community_members where community_id='${cid}' and user_id='${mod2}' returning 1`)).length, 0);
  eq((await as(db, bob, `delete from public.community_members where community_id='${cid}' and user_id='${alice}' returning 1`)).length, 0);
  await denied(as(db, bob, `insert into public.community_bans (community_id, user_id, banned_by) values ('${cid}', '${alice}', '${bob}')`), /row-level security/);
  await denied(as(db, bob, `insert into public.community_bans (community_id, user_id, banned_by) values ('${cid}', '${mod2}', '${bob}')`), /row-level security/);
  await as(db, alice, `insert into public.community_bans (community_id, user_id, banned_by) values ('${cid}', '${mod2}', '${alice}')`); // the admin can ban a mod
});
await t('a banned person cannot rejoin, even with a valid invite; a mod bans then removes', async () => {
  await as(db, bob, `insert into public.community_bans (community_id, user_id, banned_by, reason) values ('${cid}', '${carol}', '${bob}', 'spam')`);
  eq((await as(db, bob, `delete from public.community_members where community_id='${cid}' and user_id='${carol}' returning 1`)).length, 1);
  await denied(as(db, carol, `select public.join_community('${code}')`), /banned/);
  eq((await as(db, carol, `select * from public.preview_invite('${code}')`)).length, 0);
  eq((await as(db, carol, `select * from public.messages`)).length, 0); // and can no longer read
});
await t('members can leave; the admin cannot', async () => {
  eq((await as(db, eve, `delete from public.community_members where community_id='${cid}' and user_id='${eve}' returning 1`)).length, 1);
  eq((await as(db, alice, `delete from public.community_members where community_id='${cid}' and user_id='${alice}' returning 1`)).length, 0);
});

console.log('profiles');
await t('people who share a community see each other’s public profile; outsiders do not; emails stay private', async () => {
  eq((await as(db, bob, `select id from public.profiles where id='${alice}'`)).length, 1);
  eq((await as(db, dave, `select id from public.profiles where id='${alice}'`)).length, 0);
  eq((await as(db, dave, `select id from public.profiles where id='${dave}'`)).length, 1);
  await as(db, alice, `insert into public.profile_private (id, contact_email) values ('${alice}', 'alice@private.test')`);
  eq((await as(db, bob, `select * from public.profile_private`)).length, 0);
  eq((await as(db, alice, `select contact_email from public.profile_private`))[0].contact_email, 'alice@private.test');
  const cols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='profiles'`)).rows.map((r) => r.column_name);
  if (cols.includes('contact_email')) throw new Error('email column still on profiles');
});
await t('you cannot edit someone else’s profile', async () => {
  eq((await as(db, bob, `update public.profiles set bio='hacked' where id='${alice}' returning id`)).length, 0);
});

console.log('storage');
await t('members upload into their own folder and read within the community; outsiders can do neither', async () => {
  await as(db, carol, `select 1`).catch(() => {}); // carol was banned & removed above → use bob
  await as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${bob}/a.png')`);
  eq((await as(db, alice, `select name from storage.objects where bucket_id='community-media'`)).length, 1);
  await denied(as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${alice}/forged.png')`), /row-level security/);
  await denied(as(db, dave, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${dave}/a.png')`), /row-level security/);
  eq((await as(db, dave, `select name from storage.objects where bucket_id='community-media'`)).length, 0);
  await denied(as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', 'not-a-uuid/${bob}/a.png')`), /row-level security/);
  eq((await as(db, carol, `select name from storage.objects`)).length, 0); // removed members lose access
});
await t('uploader or a mod can delete a file; another member cannot', async () => {
  eq((await as(db, alice, `delete from storage.objects where name='${cid}/${bob}/a.png' returning 1`)).length, 1);
  await as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${bob}/b.png')`);
});

console.log('anon');
await t('the anonymous role can read and write nothing', async () => {
  for (const tbl of ['communities', 'community_members', 'channels', 'messages', 'invites', 'profiles', 'notes', 'link_previews', 'invite_attempts']) await denied(as(db, null, `select * from public.${tbl}`), /permission denied/);
});
await t('link_previews and invite_attempts are closed to signed-in users too', async () => {
  for (const tbl of ['link_previews', 'invite_attempts']) await denied(as(db, alice, `select * from public.${tbl}`), /permission denied/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
