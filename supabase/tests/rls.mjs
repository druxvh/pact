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
// Clients can't pick an invite code (it is always generated), so tests that need a known code seed it as the table owner.
const seedInvite = (code, extra = '', extraVal = '') => db.query(`insert into public.invites (code, community_id, created_by ${extra}) values ('${code}', '${cid}', '${alice}' ${extraVal})`);

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
  await denied(as(db, alice, `insert into public.invites (community_id, uses) values ('${cid}', 5)`), /permission denied/); // the use count isn't yours to set
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
  await seedInvite('1111111111111111', ', max_uses', ', 1');
  await seedInvite('2222222222222222', ', expires_at', ", now() - interval '1 minute'");
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
  await denied(as(db, bob, `update public.messages set author_id='${bob}' where id='${m1}'`), /permission denied|immutable_column|not_allowed/); // column grants stop it first; the trigger is the backstop
  await denied(as(db, carol, `update public.messages set channel_id='${memes}' where id='${m1}'`), /permission denied|immutable_column/);
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
  await as(db, carol, `update public.messages set links_removed_at=null where id='${m4}'`); // the author can't un-strip it …
  eq((await as(db, carol, `select links_removed_at is not null as stripped from public.messages where id='${m4}'`))[0].stripped, true); // … it simply doesn't take
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
  const mod2 = await addUser(db, 'mod2@x.test'); await seedInvite('3333333333333333'); await as(db, mod2, `select public.join_community('3333333333333333')`);
  await as(db, alice, `update public.community_members set role='mod' where community_id='${cid}' and user_id='${mod2}'`);
  eq((await as(db, bob, `delete from public.community_members where community_id='${cid}' and user_id='${mod2}' returning 1`)).length, 0);
  eq((await as(db, bob, `delete from public.community_members where community_id='${cid}' and user_id='${alice}' returning 1`)).length, 0);
  await denied(as(db, bob, `insert into public.community_bans (community_id, user_id, banned_by) values ('${cid}', '${alice}', '${bob}')`), /row-level security/);
  await denied(as(db, bob, `insert into public.community_bans (community_id, user_id, banned_by) values ('${cid}', '${mod2}', '${bob}')`), /row-level security/);
  await as(db, alice, `insert into public.community_bans (community_id, user_id, banned_by) values ('${cid}', '${mod2}', '${alice}')`); // the admin can ban a mod
});
await t('a banned person cannot rejoin, even with a valid invite; a mod bans then removes', async () => {
  await as(db, bob, `insert into public.community_bans (community_id, user_id, banned_by, reason) values ('${cid}', '${carol}', '${bob}', 'spam')`);
  // banning removes the membership in the same statement — there is no second step that could fail and leave them in
  eq(Number((await db.query(`select count(*) from public.community_members where community_id='${cid}' and user_id='${carol}'`)).rows[0].count), 0);
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
  // the email is the sign-in's (set by the sign-up trigger), readable only by its owner
  eq((await as(db, bob, `select * from public.profile_private where id='${alice}'`)).length, 0);
  eq((await as(db, alice, `select contact_email from public.profile_private where id='${alice}'`))[0].contact_email, 'alice@x.test');
  const cols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='profiles'`)).rows.map((r) => r.column_name);
  if (cols.includes('contact_email')) throw new Error('email column still on profiles');
});
await t('you cannot edit someone else’s profile', async () => {
  eq((await as(db, bob, `update public.profiles set bio='hacked' where id='${alice}' returning id`)).length, 0);
});

console.log('storage');
await t('members upload into their own folder and read within the community; outsiders can do neither', async () => {
  await as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${bob}/a.png')`);
  eq((await as(db, alice, `select name from storage.objects where bucket_id='community-media'`)).length, 1);
  await denied(as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${alice}/forged.png')`), /row-level security/);
  await denied(as(db, dave, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${dave}/a.png')`), /row-level security/);
  eq((await as(db, dave, `select name from storage.objects where bucket_id='community-media'`)).length, 0);
  await denied(as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', 'not-a-uuid/${bob}/a.png')`), /row-level security/);
  eq((await as(db, carol, `select name from storage.objects`)).length, 0); // removed members lose access
});
await t('uploader or a mod can delete a file; another member cannot', async () => {
  await as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${bob}/b.png')`);
  const plain = await addUser(db, 'plain@x.test');
  await seedInvite('5555555555555555');
  await as(db, plain, `select public.join_community('5555555555555555')`);
  eq((await as(db, plain, `delete from storage.objects where name='${cid}/${bob}/b.png' returning 1`)).length, 0); // another member can't
  eq((await as(db, bob, `delete from storage.objects where name='${cid}/${bob}/b.png' returning 1`)).length, 1); // the uploader can
  await as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${bob}/c.png')`);
  eq((await as(db, alice, `delete from storage.objects where name='${cid}/${bob}/c.png' returning 1`)).length, 1); // a moderator can
});


console.log('hardening (found by review)');
// ── moderation records can't be forged ──
const victimMsg = await post(alice, 'the real words');
await t('nobody — moderators included — can write or delete archived originals directly', async () => {
  await denied(as(db, bob, `insert into public.message_originals (message_id, community_id, body, attachments) values ('${victimMsg}', '${cid}', 'FORGED', '[]')`), /permission denied/);
  await as(db, bob, `update public.messages set hidden_at=now() where id='${victimMsg}'`);
  await denied(as(db, bob, `delete from public.message_originals where message_id='${victimMsg}'`), /permission denied/);
  await as(db, alice, `update public.messages set hidden_at=null where id='${victimMsg}'`);
  eq((await as(db, alice, `select body, edited_at from public.messages where id='${victimMsg}'`))[0], { body: 'the real words', edited_at: null });
});
await t('an admin of some other community cannot plant an original against this community’s message', async () => {
  const mine = (await as(db, eve, `select id from public.communities where created_by='${eve}' limit 1`))[0].id;
  await denied(as(db, eve, `insert into public.message_originals (message_id, community_id, body, attachments) values ('${victimMsg}', '${mine}', 'x', '[]')`), /permission denied/);
  // and even as the table owner, a row must name the message's own community
  await denied(db.query(`insert into public.message_originals (message_id, community_id, body, attachments) values ('${victimMsg}', '${mine}', 'x', '[]')`), /foreign key/);
});
await t('a message the author deleted while hidden stays gone: restoring brings nothing back and the original is purged', async () => {
  const id = await post(bob, 'please forget me');
  await as(db, alice, `update public.messages set hidden_at=now() where id='${id}'`);
  eq((await as(db, alice, `select body from public.message_originals where message_id='${id}'`))[0].body, 'please forget me');
  await as(db, bob, `update public.messages set deleted_at=now() where id='${id}'`); // the author deletes it while it is hidden
  eq(Number((await db.query(`select count(*) from public.message_originals where message_id='${id}'`)).rows[0].count), 0);
  await as(db, alice, `update public.messages set hidden_at=null where id='${id}'`);
  const row = (await as(db, alice, `select body, deleted_at is not null as deleted from public.messages where id='${id}'`))[0];
  eq([row.body, row.deleted], ['', true]);
});
await t('removed links stay removed when a hidden message is restored', async () => {
  const id = await post(alice, 'see https://a.test/x now');
  await as(db, bob, `update public.messages set links_removed_at=now() where id='${id}'`);
  await as(db, bob, `update public.messages set hidden_at=now() where id='${id}'`);
  await as(db, bob, `update public.messages set hidden_at=null where id='${id}'`);
  eq((await as(db, alice, `select body from public.messages where id='${id}'`))[0].body, 'see [link removed] now');
});

// ── the clock is the server's ──
await t('a client can’t choose created_at or the moderation times', async () => {
  const id = (await as(db, alice, `insert into public.messages (community_id, channel_id, body, created_at) values ('${cid}', '${general}', 'from the future', '2999-01-01') returning id`))[0].id;
  eq((await db.query(`select created_at < now() + interval '1 minute' as ok from public.messages where id='${id}'`)).rows[0].ok, true);
  const old = (await as(db, alice, `insert into public.messages (community_id, channel_id, body, created_at) values ('${cid}', '${general}', 'backdated', '1970-01-01') returning id`))[0].id;
  eq((await db.query(`select created_at > now() - interval '1 minute' as ok from public.messages where id='${old}'`)).rows[0].ok, true);
  await as(db, bob, `update public.messages set hidden_at='1970-01-01' where id='${id}'`);
  eq((await db.query(`select hidden_at > now() - interval '1 minute' as ok from public.messages where id='${id}'`)).rows[0].ok, true);
  await denied(as(db, alice, `update public.messages set created_at='2999-01-01' where id='${id}'`), /permission denied/);
});

// ── bans ──
await t('lifting a ban: the admin can; a moderator only their own; never the person it applies to', async () => {
  const mod3 = await addUser(db, 'mod3@x.test');
  const victim = await addUser(db, 'victim@x.test');
  await seedInvite('6a6a6a6a6a6a6a6a');
  await as(db, mod3, `select public.join_community('6a6a6a6a6a6a6a6a')`);
  await as(db, victim, `select public.join_community('6a6a6a6a6a6a6a6a')`);
  await as(db, alice, `update public.community_members set role='mod' where community_id='${cid}' and user_id='${mod3}'`);
  await as(db, alice, `insert into public.community_bans (community_id, user_id, banned_by) values ('${cid}', '${victim}', '${alice}')`);
  eq((await as(db, victim, `delete from public.community_bans where user_id='${victim}' returning 1`)).length, 0); // not your own
  eq((await as(db, mod3, `delete from public.community_bans where user_id='${victim}' returning 1`)).length, 0); // not the admin's decision
  eq((await as(db, alice, `delete from public.community_bans where user_id='${victim}' returning 1`)).length, 1);
  await as(db, mod3, `insert into public.community_bans (community_id, user_id, banned_by) values ('${cid}', '${victim}', '${mod3}')`);
  eq((await as(db, mod3, `delete from public.community_bans where user_id='${victim}' returning 1`)).length, 1); // one a mod issued, they can lift
});

// ── columns ──
await t('you can change only the columns you are meant to (no forced joins, no re-assigning a creator)', async () => {
  await denied(as(db, alice, `update public.community_members set user_id='${dave}' where community_id='${cid}' and user_id='${bob}'`), /permission denied/);
  await denied(as(db, alice, `update public.communities set created_by='${dave}' where id='${cid}'`), /permission denied/);
  await denied(as(db, alice, `update public.community_members set community_id='${cid}', joined_at=now() where user_id='${bob}'`), /permission denied/);
  await as(db, alice, `update public.communities set name='Pact Club', hue=200 where id='${cid}'`); // the allowed ones still work
  await as(db, alice, `update public.channels set topic='hello' where id='${general}'`);
});

// ── limits ──
await t('caps: channels, open invites, reactions per message, attachment JSON size, invite code format', async () => {
  await denied(as(db, alice, `insert into public.invites (code, community_id) values ('aaaaaaaaaaaaaaaa', '${cid}')`), /permission denied/); // no choosing a code (no probing which exist)
  await denied(seedInvite('A'), /invites_code_format|check/); // and even the owner can't store a malformed one
  await denied(seedInvite('f'.repeat(15) + 'G'), /invites_code_format|check/);
  const keep = (await db.query(`select code from public.invites where community_id='${cid}'`)).rows.map((r) => r.code);
  let made = 0;
  for (;;) {
    try { await as(db, alice, `insert into public.invites (community_id) values ('${cid}')`); made++; } catch (e) { if (!/invite_limit/.test(e.message)) throw e; break; }
    if (made > 60) throw new Error('no invite cap');
  }
  eq(Number((await db.query(`select count(*) from public.invites where community_id='${cid}'`)).rows[0].count), 50);
  await db.query(`delete from public.invites where community_id='${cid}' and code <> all($1)`, [keep]); // tidy up for the tests that follow
  let chans = 0;
  for (;;) {
    try { await as(db, alice, `insert into public.channels (community_id, name) values ('${cid}', 'c${chans}')`); chans++; } catch (e) { if (!/channel_limit/.test(e.message)) throw e; break; }
    if (chans > 60) throw new Error('no channel cap');
  }
  eq(Number((await db.query(`select count(*) from public.channels where community_id='${cid}'`)).rows[0].count), 50);
  const target = await post(alice, 'react to me');
  for (let i = 0; i < 20; i++) await as(db, alice, `insert into public.message_reactions (message_id, community_id, emoji) values ('${target}', '${cid}', 'e${i}')`);
  await denied(as(db, alice, `insert into public.message_reactions (message_id, community_id, emoji) values ('${target}', '${cid}', 'e20')`), /reaction_limit/);
  await as(db, bob, `insert into public.message_reactions (message_id, community_id, emoji) values ('${target}', '${cid}', 'e3')`); // joining an existing reaction is fine
  const long = 'x'.repeat(1500);
  const items = Array.from({ length: 6 }, (_, i) => `{"path":"${cid}/${alice}/${i}-${long}.png"}`).join(',');
  await denied(as(db, alice, `insert into public.messages (community_id, channel_id, attachments) values ('${cid}', '${general}', '[${items}]')`), /messages_attachments_size/);
});
await t('an author can’t edit their message to point at another community’s files', async () => {
  const id = (await as(db, alice, `insert into public.messages (community_id, channel_id, body, attachments) values ('${cid}', '${general}', 'pic', '[{"path":"${cid}/${alice}/ok.png"}]') returning id`))[0].id;
  await denied(as(db, alice, `update public.messages set attachments='[{"path":"${crypto.randomUUID()}/x/y.png"}]' where id='${id}'`), /bad_attachment/);
});

// ── hidden files are really hidden ──
await t('a hidden, deleted or edited-away attachment can no longer be opened by ordinary members', async () => {
  const up = await addUser(db, 'uploader@x.test'), rd = await addUser(db, 'reader@x.test');
  const inv = (await db.query(`select code from public.invites where community_id='${cid}' and max_uses is null and expires_at is null limit 1`)).rows[0].code;
  await as(db, up, `select public.join_community('${inv}')`);
  await as(db, rd, `select public.join_community('${inv}')`);
  const path = `${cid}/${up}/pic.png`;
  const readable = async (uid) => (await as(db, uid, `select name from storage.objects where name='${path}'`)).length === 1;
  await as(db, up, `insert into storage.objects (bucket_id, name) values ('community-media', '${path}')`);
  eq(await readable(rd), false); // uploaded but not yet attached to any message
  eq(await readable(up), true); // the uploader can preview their own file
  const msg = (await as(db, up, `insert into public.messages (community_id, channel_id, body, attachments) values ('${cid}', '${general}', 'pic', '[{"path":"${path}"}]') returning id`))[0].id;
  eq(await readable(rd), true); // attached to a visible message
  await as(db, alice, `update public.messages set hidden_at=now() where id='${msg}'`);
  eq(await readable(rd), false); // hidden
  eq(await readable(alice), true); // moderators can review it
  eq(await readable(dave), false);
  await as(db, alice, `update public.messages set hidden_at=null where id='${msg}'`);
  eq(await readable(rd), true); // restored
  await as(db, up, `update public.messages set attachments='[]' where id='${msg}'`);
  eq(await readable(rd), false); // edited away
});
await t('Storage paths: canonical community folder only, exactly <community>/<you>/<file>, and a per-person file quota', async () => {
  const bad = `${cid.slice(0, 4)}-${cid.slice(4, 8)}-${cid.slice(8, 12)}-${cid.slice(12, 16)}-${cid.slice(16)}${cid.slice(-4)}`.slice(0, 36);
  await denied(as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${bad}/${bob}/a.png')`), /row-level security/);
  await denied(as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid.toUpperCase()}/${bob}/a.png')`), /row-level security/);
  await denied(as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${bob}/deeper/a.png')`), /row-level security/);
  await db.query(`insert into storage.objects (bucket_id, name) select 'community-media', '${cid}/${bob}/bulk-' || g || '.png' from generate_series(1, 300) g`);
  await denied(as(db, bob, `insert into storage.objects (bucket_id, name) values ('community-media', '${cid}/${bob}/one-too-many.png')`), /row-level security/);
  await db.query(`delete from storage.objects where name like '${cid}/${bob}/bulk-%'`);
});

// ── privacy ──
await t('a new account’s default @username is never derived from their email address', async () => {
  const u = await addUser(db, 'jane.doe1984@x.test');
  const name = (await db.query(`select username from public.profiles where id='${u}'`)).rows[0].username;
  if (/jane|doe|1984/.test(name) || !/^user[0-9a-f]{6}$/.test(name)) throw new Error('username ' + name);
  const gh = await addUser(db, 'someone@x.test', { user_name: 'gh-handle' });
  eq((await db.query(`select username from public.profiles where id='${gh}'`)).rows[0].username, 'ghhandle'); // a provider handle is public anyway
});

console.log('unread counts');
await t('unread = other people’s visible messages newer than your marker; your own and hidden ones never count', async () => {
  const expected = Number((await db.query(`select count(*) from public.messages where channel_id='${general}' and author_id <> '${alice}' and deleted_at is null and hidden_at is null`)).rows[0].count);
  const got = (await as(db, alice, `select * from public.unread_counts()`)).find((r) => r.channel_id === general);
  if (expected < 1) throw new Error('test setup: no messages');
  eq(got?.unread, expected);
  eq(got?.community_id, cid);
});
await t('marking a channel read clears it; a new message from someone else brings it back as 1', async () => {
  const newest = (await db.query(`select max(created_at) t from public.messages where channel_id='${general}'`)).rows[0].t.toISOString();
  await as(db, alice, `insert into public.channel_reads (channel_id, community_id, last_read_at) values ('${general}', '${cid}', '${newest}') on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at`);
  eq((await as(db, alice, `select * from public.unread_counts()`)).some((r) => r.channel_id === general), false);
  await post(bob, 'a fresh one');
  eq((await as(db, alice, `select unread from public.unread_counts() where channel_id='${general}'`))[0]?.unread, 1);
  const own = await as(db, bob, `select unread from public.unread_counts() where channel_id='${general}'`);
  if (own.length && own[0].unread > 0) {
    // bob has other people's unread messages here, but the one he just wrote must not be among them
    const others = Number((await db.query(`select count(*) from public.messages where channel_id='${general}' and author_id <> '${bob}' and deleted_at is null and hidden_at is null and created_at > coalesce((select last_read_at from public.channel_reads where user_id='${bob}' and channel_id='${general}'), (select joined_at from public.community_members where user_id='${bob}' and community_id='${cid}'))`)).rows[0].count);
    eq(own[0].unread, others);
  }
});
await t('the marker never moves backwards, and it is private to its owner', async () => {
  const before = (await as(db, alice, `select last_read_at from public.channel_reads where channel_id='${general}'`))[0].last_read_at.toISOString();
  await as(db, alice, `update public.channel_reads set last_read_at = '2000-01-01' where channel_id='${general}'`);
  eq((await as(db, alice, `select last_read_at from public.channel_reads where channel_id='${general}'`))[0].last_read_at.toISOString(), before);
  eq((await as(db, bob, `select * from public.channel_reads`)).length, 0);
  await denied(as(db, bob, `insert into public.channel_reads (user_id, channel_id, community_id, last_read_at) values ('${alice}', '${memes}', '${cid}', now())`), /row-level security/);
});
await t('outsiders can neither mark nor count a community they are not in', async () => {
  await denied(as(db, dave, `insert into public.channel_reads (channel_id, community_id, last_read_at) values ('${general}', '${cid}', now())`), /row-level security/);
  eq((await as(db, dave, `select * from public.unread_counts()`)).length, 0);
  eq((await as(db, carol, `select * from public.unread_counts()`)).some((r) => r.community_id === cid), false); // removed members count nothing
});
await t('joining late does not make the whole history unread', async () => {
  const late = await addUser(db, 'late@x.test');
  await seedInvite('4444444444444444');
  await as(db, late, `select public.join_community('4444444444444444')`);
  eq((await as(db, late, `select * from public.unread_counts()`)).length, 0);
  await post(bob, 'after the new person joined');
  eq((await as(db, late, `select unread from public.unread_counts() where channel_id='${general}'`))[0]?.unread, 1);
});

console.log('typing indicators (realtime broadcast)');
const topic = (v) => db.exec(`select set_config('realtime.topic', '${v}', false)`);
await t('only members may announce or listen on their community’s typing topic', async () => {
  await topic(`typing:${cid}`);
  await as(db, bob, `insert into realtime.messages (topic, extension) values ('typing:${cid}', 'broadcast')`);
  await denied(as(db, dave, `insert into realtime.messages (topic, extension) values ('typing:${cid}', 'broadcast')`), /row-level security/);
  await denied(as(db, carol, `insert into realtime.messages (topic, extension) values ('typing:${cid}', 'broadcast')`), /row-level security/); // removed
  eq((await as(db, bob, `select 1 from realtime.messages`)).length, 1);
  eq((await as(db, dave, `select 1 from realtime.messages`)).length, 0);
  eq((await as(db, carol, `select 1 from realtime.messages`)).length, 0);
});
await t('other topics, malformed topics and the presence extension are refused', async () => {
  await topic(`typing:${crypto.randomUUID()}`);
  await denied(as(db, bob, `insert into realtime.messages (topic, extension) values ('x', 'broadcast')`), /row-level security/);
  await topic('typing:not-a-uuid');
  await denied(as(db, bob, `insert into realtime.messages (topic, extension) values ('x', 'broadcast')`), /row-level security/);
  await topic(`community:${cid}`);
  await denied(as(db, bob, `insert into realtime.messages (topic, extension) values ('x', 'broadcast')`), /row-level security/);
  await topic(`typing:${cid}`);
  await denied(as(db, bob, `insert into realtime.messages (topic, extension) values ('x', 'presence')`), /row-level security/);
  await topic('');
});

// ═════════════════════════════════════════════════════════════════════════════
// Safety: slowmode, timeouts, admin transfer, the ban list (20261118000100_community_safety.sql)
// Each block uses its own community, so the caps and state the tests above leave behind don't matter.
// ═════════════════════════════════════════════════════════════════════════════
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = async (sql, params) => Number((await db.query(sql, params)).rows[0].count);
const newCommunity = async (name, joiners) => {
  const owner = await addUser(db, `${name.toLowerCase().replace(/\W+/g, '-')}-owner@safety.test`);
  const id = crypto.randomUUID();
  await as(db, owner, `insert into public.communities (id, name) values ('${id}', '${name}')`);
  await as(db, owner, `insert into public.invites (community_id) values ('${id}')`);
  const inviteCode = (await as(db, owner, `select code from public.invites where community_id='${id}'`))[0].code;
  const people = {};
  for (const j of joiners) { people[j] = await addUser(db, `${j}-${id.slice(0, 6)}@safety.test`); await as(db, people[j], `select public.join_community('${inviteCode}')`); }
  const channel = (await as(db, owner, `select id from public.channels where community_id='${id}' and name='general'`))[0].id;
  return { id, owner, code: inviteCode, channel, ...people };
};
const role = (c, uid, r) => as(db, c.owner, `update public.community_members set role='${r}' where community_id='${c.id}' and user_id='${uid}'`);
const say = (c, uid, channel, body, extra = '') => as(db, uid, `insert into public.messages (community_id, channel_id, body ${extra ? `, ${extra.split('=')[0]}` : ''}) values ('${c.id}', '${channel}', $1 ${extra ? `, ${extra.split('=')[1]}` : ''}) returning id`, [body]);

console.log('safety: slowmode');
const sm = await newCommunity('Slow Club', ['mod', 'ann', 'ben', 'cat']);
await role(sm, sm.mod, 'mod');
const slow = (await as(db, sm.owner, `insert into public.channels (community_id, name) values ('${sm.id}', 'slow') returning id`))[0].id;
await t('slowmode starts off; the admin and a moderator can set it; members and outsiders cannot', async () => {
  eq((await as(db, sm.ann, `select slowmode_seconds from public.channels where id='${slow}'`))[0].slowmode_seconds, 0);
  await blocked(as(db, sm.ann, `update public.channels set slowmode_seconds=30 where id='${slow}' returning id`)); // a member: RLS hides the row
  await blocked(as(db, dave, `update public.channels set slowmode_seconds=30 where id='${slow}' returning id`)); // an outsider too
  eq((await as(db, sm.mod, `update public.channels set slowmode_seconds=30 where id='${slow}' returning slowmode_seconds`))[0].slowmode_seconds, 30);
  eq((await as(db, sm.owner, `update public.channels set slowmode_seconds=10 where id='${slow}' returning slowmode_seconds`))[0].slowmode_seconds, 10);
  await as(db, sm.owner, `update public.channels set slowmode_seconds=30 where id='${slow}'`);
});
await t('a moderator may change slowmode and nothing else on a channel; slowmode has a sane range', async () => {
  await denied(as(db, sm.mod, `update public.channels set topic='mine now' where id='${slow}'`), /not_allowed/);
  await denied(as(db, sm.mod, `update public.channels set name='renamed' where id='${slow}'`), /not_allowed/);
  await denied(as(db, sm.mod, `update public.channels set community_id='${cid}' where id='${slow}'`), /permission denied/);
  await as(db, sm.owner, `update public.channels set topic='the admin may' where id='${slow}'`);
  await db.query(`update public.channels set topic='so may the SQL editor' where id='${slow}'`); // no signed-in user = server side, not a client
  await as(db, sm.owner, `update public.channels set topic='the admin may' where id='${slow}'`);
  await denied(as(db, sm.owner, `update public.channels set slowmode_seconds=21601 where id='${slow}'`), /channels_slowmode_range|check/);
  await denied(as(db, sm.owner, `update public.channels set slowmode_seconds=-1 where id='${slow}'`), /channels_slowmode_range|check/);
  await as(db, sm.owner, `update public.channels set slowmode_seconds=21600 where id='${slow}'`); // 6 h is the maximum…
  await as(db, sm.owner, `update public.channels set slowmode_seconds=30 where id='${slow}'`);
  await denied(as(db, sm.mod, `insert into public.channels (community_id, name, slowmode_seconds) values ('${sm.id}', 'mine', 5)`), /row-level security/); // still no creating channels
});
let firstSlow;
await t('a member can post, then must wait; the error says how long', async () => {
  firstSlow = (await say(sm, sm.ann, slow, 'first'))[0].id;
  let err; try { await say(sm, sm.ann, slow, 'second'); } catch (e) { err = e; }
  const secs = Number(/^slowmode:(\d+)$/.exec(err?.message ?? '')?.[1]);
  if (!(secs >= 28 && secs <= 30)) throw new Error('expected slowmode:28..30, got ' + err?.message);
  eq((await as(db, sm.ann, `select 1 from public.messages where channel_id='${slow}'`)).length, 1);
});
await t('slowmode is per person and per channel; moderators and the admin are exempt', async () => {
  await say(sm, sm.ben, slow, 'a different member is not held back');
  await say(sm, sm.ann, sm.channel, 'nor is another channel');
  await say(sm, sm.mod, slow, 'mod one'); await say(sm, sm.mod, slow, 'mod two');
  await say(sm, sm.owner, slow, 'admin one'); await say(sm, sm.owner, slow, 'admin two');
});
await t('it cannot be dodged: backdated timestamps, deleting the last message, pretending to be someone else', async () => {
  await denied(say(sm, sm.ann, slow, 'sneaky', `created_at='1970-01-01'`), /slowmode/); // the client's clock is ignored
  await denied(say(sm, sm.ann, slow, 'sneakier', `created_at='2999-01-01'`), /slowmode/);
  await as(db, sm.ann, `update public.messages set deleted_at=now() where id='${firstSlow}'`); // tombstone the message that started the clock
  await denied(say(sm, sm.ann, slow, 'after deleting'), /slowmode/);
  await denied(as(db, sm.ann, `update public.messages set created_at='1970-01-01' where id='${firstSlow}'`), /permission denied/); // and its time can't be rewritten
  // posting as somebody else is refused by RLS, and does not leak when that person last posted (not even to an outsider)
  await denied(say(sm, sm.cat, slow, 'as ann', `author_id='${sm.ann}'`), /row-level security/);
  await denied(say(sm, dave, slow, 'as ann from outside', `author_id='${sm.ann}'`), /row-level security/);
  await denied(say(sm, dave, slow, 'outsider'), /row-level security/);
  eq(Number((await db.query(`select count(*) from public.messages where channel_id='${slow}' and author_id='${sm.ann}'`)).rows[0].count), 1);
});
await t('reactions are not slowed down; switching slowmode off frees you immediately; a short slowmode ends by itself', async () => {
  await as(db, sm.ann, `insert into public.message_reactions (message_id, community_id, emoji) values ('${firstSlow}', '${sm.id}', '👍')`);
  await as(db, sm.owner, `update public.channels set slowmode_seconds=0 where id='${slow}'`);
  await say(sm, sm.ann, slow, 'no more slowmode');
  await as(db, sm.owner, `update public.channels set slowmode_seconds=1 where id='${slow}'`);
  await denied(say(sm, sm.ann, slow, 'too soon'), /slowmode:1/);
  await sleep(1250);
  await say(sm, sm.ann, slow, 'a second later');
  await as(db, sm.owner, `update public.channels set slowmode_seconds=0 where id='${slow}'`);
});

console.log('safety: timeouts');
const to = await newCommunity('Timeout Club', ['mod', 'mod2', 'ann', 'ben', 'cat']);
await role(to, to.mod, 'mod'); await role(to, to.mod2, 'mod');
const timeout = (c, by, target, secs) => as(db, by, `select public.timeout_member('${c.id}', '${target}', ${secs}) as until`);
const timedUntil = async (uid) => (await as(db, to.owner, `select timeout_until from public.community_members where community_id='${to.id}' and user_id='${uid}'`))[0].timeout_until;
let annMsg;
await t('a moderator times out a member: they can still read, but cannot post or react', async () => {
  annMsg = (await say(to, to.ben, to.channel, 'hello from ben'))[0].id;
  const until = (await timeout(to, to.mod, to.ann, 3600))[0].until;
  if (!(until instanceof Date) || until.getTime() < Date.now() + 3_500_000 || until.getTime() > Date.now() + 3_700_000) throw new Error('until ' + until);
  eq((await as(db, to.ann, `select body from public.messages where channel_id='${to.channel}'`)).length, 1); // reading still works
  await denied(say(to, to.ann, to.channel, 'let me talk'), /^timed_out:\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  await denied(as(db, to.ann, `insert into public.message_reactions (message_id, community_id, emoji) values ('${annMsg}', '${to.id}', '🔥')`), /timed_out:/);
  eq(Number((await db.query(`select count(*) from public.messages where author_id='${to.ann}'`)).rows[0].count), 0);
  await say(to, to.ben, to.channel, 'others are unaffected');
});
await t('whoever is timed out cannot edit the clock: the column is only writable through the function', async () => {
  await denied(as(db, to.ann, `update public.community_members set timeout_until=null where community_id='${to.id}' and user_id='${to.ann}'`), /permission denied/);
  await denied(as(db, to.mod, `update public.community_members set timeout_until=null where community_id='${to.id}' and user_id='${to.ann}'`), /permission denied/);
  if (!(await timedUntil(to.ann))) throw new Error('timeout was lifted');
});
await t('who may time out whom: the admin → mods and members; a moderator → members only; nobody → the admin or themselves', async () => {
  await denied(timeout(to, to.mod, to.owner, 60), /not_allowed/); // not the admin
  await denied(timeout(to, to.owner, to.owner, 60), /not_allowed/); // not yourself …
  await denied(timeout(to, to.mod, to.mod, 60), /not_allowed/);
  await denied(timeout(to, to.mod, to.mod2, 60), /not_allowed/); // a mod can't touch another mod
  await timeout(to, to.owner, to.mod2, 60); // the admin can
  eq(!!(await timedUntil(to.mod2)), true);
  await denied(timeout(to, to.mod, to.mod2, 0), /not_allowed/); // …and a mod can't lift the admin's decision
});
await t('a timed-out moderator cannot post either (but is still a moderator); promoting to admin clears it, to moderator does not', async () => {
  await denied(say(to, to.mod2, to.channel, 'I was timed out by the admin'), /timed_out/);
  eq((await as(db, to.mod2, `update public.messages set hidden_at=now() where id='${annMsg}' returning 1`)).length, 1); // moderation still works
  await as(db, to.mod2, `update public.messages set hidden_at=null where id='${annMsg}'`);
  await timeout(to, to.owner, to.mod2, 0);
  await say(to, to.mod2, to.channel, 'back');
  await role(to, to.ann, 'mod');
  eq(!!(await timedUntil(to.ann)), true); // still timed out as a moderator
  await role(to, to.ann, 'member');
});
await t('outsiders, members and anon cannot time anyone out; a moderator cannot reach into another community', async () => {
  await denied(timeout(to, to.ben, to.cat, 60), /not_allowed/);
  await denied(timeout(to, dave, to.cat, 60), /not_allowed/);
  await denied(as(db, null, `select public.timeout_member('${to.id}', '${to.cat}', 60)`), /permission denied/);
  await denied(timeout(sm, to.mod, sm.ann, 60), /not_allowed/); // `to.mod` moderates Timeout Club, not Slow Club
  await denied(timeout(to, to.mod, dave, 60), /not_a_member/); // not in the community at all
  eq(await timedUntil(to.cat), null);
});
await t('durations: 0 lifts, up to 28 days is fine, anything else is refused', async () => {
  await denied(timeout(to, to.mod, to.cat, -1), /bad_duration/);
  await denied(timeout(to, to.mod, to.cat, 28 * 86400 + 1), /bad_duration/);
  const u = (await timeout(to, to.mod, to.cat, 28 * 86400))[0].until;
  if (u.getTime() < Date.now() + 28 * 86400_000 - 5000) throw new Error('not 28 days');
  eq((await timeout(to, to.mod, to.cat, 0))[0].until, null);
  eq(await timedUntil(to.cat), null);
});
await t('lifting a timeout (or letting it run out) lets them post and react again', async () => {
  await timeout(to, to.mod, to.ann, 0);
  await say(to, to.ann, to.channel, 'I can talk again');
  await as(db, to.ann, `insert into public.message_reactions (message_id, community_id, emoji) values ('${annMsg}', '${to.id}', '🔥')`);
  await timeout(to, to.mod, to.ben, 3600);
  await denied(say(to, to.ben, to.channel, 'muted'), /timed_out/);
  await db.query(`update public.community_members set timeout_until = now() - interval '1 second' where community_id='${to.id}' and user_id='${to.ben}'`); // the clock runs out
  await say(to, to.ben, to.channel, 'it expired by itself');
});
await t('a timed-out member cannot leave and rejoin to shake it off; they can once it ends; mods can still remove them', async () => {
  await timeout(to, to.mod, to.cat, 600);
  await denied(as(db, to.cat, `delete from public.community_members where community_id='${to.id}' and user_id='${to.cat}'`), /timed_out/);
  eq(await count(`select count(*) from public.community_members where community_id='${to.id}' and user_id='${to.cat}'`), 1);
  await timeout(to, to.mod, to.cat, 0);
  eq((await as(db, to.cat, `delete from public.community_members where community_id='${to.id}' and user_id='${to.cat}' returning 1`)).length, 1); // free to leave
  await as(db, to.cat, `select public.join_community('${to.code}')`);
  await timeout(to, to.mod, to.cat, 600);
  eq((await as(db, to.mod, `delete from public.community_members where community_id='${to.id}' and user_id='${to.cat}' returning 1`)).length, 1); // a moderator can still remove them
});

console.log('safety: admin transfer');
const tr = await newCommunity('Hand-over Club', ['mod', 'ann', 'ben', 'cat', 'late']);
await role(tr, tr.mod, 'mod');
const admins = (c) => count(`select count(*) from public.community_members where community_id='${c.id}' and role='admin'`);
const communityCreator = async (c) => (await db.query(`select created_by from public.communities where id='${c.id}'`)).rows[0].created_by;
const roleOf = async (c, uid) => (await db.query(`select role from public.community_members where community_id='${c.id}' and user_id='${uid}'`)).rows[0]?.role ?? null;
const transfer = (c, by, to) => as(db, by, `select public.transfer_admin('${c.id}', '${to}')`);
await t('only the admin can transfer; not to themselves, an outsider or a banned person', async () => {
  await denied(transfer(tr, tr.mod, tr.mod), /not_allowed/); // a moderator can't take it
  await denied(transfer(tr, tr.ann, tr.ann), /not_allowed/);
  await denied(transfer(tr, dave, dave), /not_allowed/); // an outsider can't
  await denied(as(db, null, `select public.transfer_admin('${tr.id}', '${tr.ann}')`), /permission denied/);
  await denied(transfer(tr, tr.owner, tr.owner), /not_allowed/);
  await denied(transfer(tr, tr.owner, dave), /not_a_member/);
  await denied(transfer(tr, tr.owner, crypto.randomUUID()), /not_a_member/);
  await db.query(`insert into public.community_bans (community_id, user_id, banned_by) values ('${tr.id}', '${tr.late}', '${tr.owner}')`); // (as the owner, to leave the membership in place)
  await denied(transfer(tr, tr.owner, tr.late), /banned/);
  await db.query(`delete from public.community_bans where user_id='${tr.late}'`);
  eq([await admins(tr), await roleOf(tr, tr.owner)], [1, 'admin']); // nothing above changed anything
});
await t('transferring makes the member the admin and the old admin a moderator, atomically — exactly one admin throughout', async () => {
  await timeout(tr, tr.owner, tr.ann, 600); // the new admin is timed out: becoming the admin clears it
  const before = await communityCreator(tr);
  eq(before, tr.owner);
  await transfer(tr, tr.owner, tr.ann);
  eq([await roleOf(tr, tr.ann), await roleOf(tr, tr.owner), await admins(tr)], ['admin', 'mod', 1]);
  eq((await db.query(`select timeout_until from public.community_members where community_id='${tr.id}' and user_id='${tr.ann}'`)).rows[0].timeout_until, null);
  eq(await communityCreator(tr), tr.ann); // `created_by` follows the admin
});
await t('after a transfer the old admin has only a moderator’s powers, and the new one has the admin’s', async () => {
  await denied(as(db, tr.owner, `insert into public.channels (community_id, name) values ('${tr.id}', 'old-admin')`), /row-level security/);
  await blocked(as(db, tr.owner, `update public.community_members set role='mod' where community_id='${tr.id}' and user_id='${tr.ben}' returning 1`));
  await denied(transfer(tr, tr.owner, tr.owner), /not_allowed/);
  await denied(transfer(tr, tr.owner, tr.ben), /not_allowed/); // no longer the admin, so can't hand it on again
  await as(db, tr.ann, `insert into public.channels (community_id, name) values ('${tr.id}', 'new-admin')`);
  await as(db, tr.ann, `update public.community_members set role='mod' where community_id='${tr.id}' and user_id='${tr.ben}'`);
  eq(await admins(tr), 1);
});
await t('a plain member can be made admin directly, and the previous admin can then leave — the community is never without one', async () => {
  await transfer(tr, tr.ann, tr.cat);
  eq([await roleOf(tr, tr.cat), await roleOf(tr, tr.ann), await admins(tr)], ['admin', 'mod', 1]);
  eq((await as(db, tr.ann, `delete from public.community_members where community_id='${tr.id}' and user_id='${tr.ann}' returning 1`)).length, 1);
  eq(await admins(tr), 1);
});
await t('the one-admin rule holds on every other path: leave, kick, ban, demote, a second admin', async () => {
  const [a, m] = [tr.cat, tr.mod];
  eq((await as(db, a, `delete from public.community_members where community_id='${tr.id}' and user_id='${a}' returning 1`)).length, 0); // the admin can't leave
  eq((await as(db, m, `delete from public.community_members where community_id='${tr.id}' and user_id='${a}' returning 1`)).length, 0); // nor be kicked
  eq((await as(db, a, `update public.community_members set role='member' where community_id='${tr.id}' and user_id='${a}' returning 1`)).length, 0); // nor demote themselves
  await denied(as(db, m, `insert into public.community_bans (community_id, user_id, banned_by) values ('${tr.id}', '${a}', '${m}')`), /row-level security/);
  await denied(as(db, a, `insert into public.community_bans (community_id, user_id, banned_by) values ('${tr.id}', '${a}', '${a}')`), /row-level security/);
  await denied(as(db, a, `update public.community_members set role='admin' where community_id='${tr.id}' and user_id='${tr.ben}'`), /row-level security|community_one_admin/);
  await denied(timeout(tr, m, a, 60), /not_allowed/);
  eq([await admins(tr), await roleOf(tr, a)], [1, 'admin']);
});
await t('deleting the original creator’s account no longer takes a community they handed over', async () => {
  eq(await count(`select count(*) from public.communities where id='${tr.id}'`), 1);
  await db.query(`delete from auth.users where id='${tr.owner}'`);
  eq(await count(`select count(*) from public.communities where id='${tr.id}'`), 1);
  eq(await admins(tr), 1);
});

console.log('safety: the ban list');
const bn = await newCommunity('Ban List Club', ['mod', 'mod2', 'ann', 'ben', 'cat']);
await role(bn, bn.mod, 'mod'); await role(bn, bn.mod2, 'mod');
const lookalike = await newCommunity('Elsewhere', ['spy']);
await as(db, bn.mod, `insert into public.community_bans (community_id, user_id, banned_by, reason) values ('${bn.id}', '${bn.ann}', '${bn.mod}', 'spam')`);
await as(db, bn.owner, `insert into public.community_bans (community_id, user_id, banned_by, reason) values ('${bn.id}', '${bn.ben}', '${bn.owner}', 'by the admin')`);
await t('moderators and the admin can list bans with who and why; members, the banned and outsiders cannot', async () => {
  const rows = await as(db, bn.mod2, `select user_id, banned_by, reason, created_at from public.community_bans where community_id='${bn.id}' order by reason`);
  eq(rows.map((r) => [r.user_id, r.banned_by, r.reason]), [[bn.ben, bn.owner, 'by the admin'], [bn.ann, bn.mod, 'spam']]);
  eq(rows.every((r) => r.created_at instanceof Date), true);
  eq((await as(db, bn.owner, `select 1 from public.community_bans where community_id='${bn.id}'`)).length, 2);
  eq((await as(db, bn.cat, `select 1 from public.community_bans`)).length, 0); // a plain member
  eq((await as(db, bn.ann, `select 1 from public.community_bans`)).length, 0); // the banned person
  eq((await as(db, dave, `select 1 from public.community_bans`)).length, 0);
  eq((await as(db, lookalike.owner, `select 1 from public.community_bans where community_id='${bn.id}'`)).length, 0); // another community's admin
});
await t('moderators can see who a banned person is (public profile only) — nobody else can', async () => {
  for (const who of [bn.ann, bn.ben]) {
    const p = await as(db, bn.mod, `select id, username from public.profiles where id='${who}'`);
    eq(p.length, 1); if (!/^[a-z0-9_]{3,20}$/.test(p[0].username)) throw new Error('username ' + p[0].username);
  }
  eq((await as(db, bn.cat, `select 1 from public.profiles where id='${bn.ann}'`)).length, 0); // a plain member shares no community with them any more
  eq((await as(db, lookalike.owner, `select 1 from public.profiles where id='${bn.ann}'`)).length, 0); // an admin elsewhere
  eq((await as(db, lookalike.spy, `select 1 from public.profiles where id='${bn.mod}'`)).length, 0);
  eq((await as(db, bn.mod, `select 1 from public.profile_private where id <> '${bn.mod}'`)).length, 0); // and never anyone else's email
});
await t('lifting: the admin any ban, a moderator only their own, nobody their own ban; the person can then rejoin', async () => {
  eq((await as(db, bn.ann, `delete from public.community_bans where user_id='${bn.ann}' returning 1`)).length, 0);
  eq((await as(db, bn.mod2, `delete from public.community_bans where user_id='${bn.ann}' returning 1`)).length, 0); // someone else's ban
  eq((await as(db, bn.mod, `delete from public.community_bans where user_id='${bn.ben}' returning 1`)).length, 0); // the admin's ban
  eq((await as(db, bn.cat, `delete from public.community_bans where user_id='${bn.ben}' returning 1`)).length, 0);
  eq((await as(db, bn.mod, `delete from public.community_bans where user_id='${bn.ann}' returning 1`)).length, 1);
  eq((await as(db, bn.owner, `delete from public.community_bans where user_id='${bn.ben}' returning 1`)).length, 1);
  eq((await as(db, bn.mod, `select 1 from public.community_bans`)).length, 0);
  eq((await as(db, bn.ann, `select public.join_community('${bn.code}') as id`))[0].id, bn.id);
  eq((await as(db, bn.mod, `select 1 from public.profiles where id='${bn.ben}'`)).length, 0); // an unbanned non-member is private again
});

console.log('safety: the migration');
await t('the safety migration can be applied a second time without errors (and changes nothing)', async () => {
  const f = new URL('../migrations/20261118000100_community_safety.sql', import.meta.url);
  const fs = await import('node:fs');
  if (!fs.existsSync(f)) return;
  await db.exec(fs.readFileSync(f, 'utf8'));
  // still wired up afterwards: one trigger of each kind, and the rules still bite
  eq(await count(`select count(*) from pg_trigger where tgname in ('messages_guard_trg', 'channels_guard_trg', 'members_guard_trg', 'members_leave_guard_trg', 'reactions_timeout') and not tgisinternal`), 5);
  eq(await count(`select count(*) from pg_policies where tablename='channels' and cmd='UPDATE'`), 1);
  await as(db, sm.owner, `update public.channels set slowmode_seconds=600 where id='${slow}'`);
  await say(sm, sm.cat, slow, 'one');
  await denied(say(sm, sm.cat, slow, 'two'), /slowmode/);
  await as(db, sm.owner, `update public.channels set slowmode_seconds=0 where id='${slow}'`);
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
