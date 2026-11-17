// VibeParty's Realtime authorization: who may listen / announce on `party:<room code>`, tested against the real migrations.
// Run with: bun supabase/tests/party.mjs   (the lead wires it into `bun run test:db`)
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
const bob = await addUser(db, 'bob@x.test');

// What Realtime does for every join: it sets the topic, then runs the policy as the connecting role.
const topic = (v) => db.exec(`select set_config('realtime.topic', '${v}', false)`);
const announce = (uid, ext = 'broadcast') => as(db, uid, `insert into realtime.messages (topic, extension) values ('x', '${ext}')`);
const listen = (uid) => as(db, uid, 'select 1 from realtime.messages');

const ROOM = 'amber-lofi-k7q2x9dm';

console.log('party channels (realtime broadcast + presence)');

await t('the topic-shape helper accepts exactly what roomCode.ts accepts', async () => {
  const shape = async (v) => (await db.query('select private.party_topic($1) as ok', [v])).rows[0].ok;
  for (const good of [`party:${ROOM}`, 'party:abcd', 'party:a-b-c-d', `party:${'a'.repeat(32)}`, 'party:2fast-2furious']) eq(await shape(good), true, good);
  for (const bad of [
    'party:',
    'party:abc', // too short
    `party:${'a'.repeat(33)}`, // too long
    'party:Amber-Lofi', // upper case
    'party:amber_lofi', // underscore
    'party:amber--lofi', // double dash
    'party:-amber', // leading dash
    'party:amber-', // trailing dash
    'party:amber lofi',
    'party:amber/lofi',
    `party:${ROOM}\n`, // a trailing newline must not sneak past `$`
    `party:${ROOM}:x`,
    ` party:${ROOM}`,
    `PARTY:${ROOM}`,
    `typing:${ROOM}`,
    `xparty:${ROOM}`,
    'realtime:party:amber-lofi',
    '',
  ])
    eq(await shape(bad), false, JSON.stringify(bad));
  eq((await db.query('select private.party_topic(null) as ok')).rows[0].ok, false, 'null');
});

await t('a signed-in user may announce and listen on a well-formed party topic (broadcast and presence)', async () => {
  await topic(`party:${ROOM}`);
  await announce(alice, 'broadcast');
  await announce(bob, 'presence');
  eq((await listen(alice)).length, 2);
  eq((await listen(bob)).length, 2);
});

await t('there is no membership: any signed-in user with the code may join (the code is the password)', async () => {
  const stranger = await addUser(db, 'stranger@x.test');
  await topic('party:some-other-room-1234');
  await announce(stranger);
});

await t('the anonymous role can neither announce nor listen', async () => {
  await topic(`party:${ROOM}`);
  await denied(announce(null), /permission denied/);
  await denied(listen(null), /permission denied/);
});

await t('a request with no user behind it (null uid) is refused even under the authenticated role', async () => {
  await topic(`party:${ROOM}`);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role authenticated;`);
  try {
    await denied(db.query(`insert into realtime.messages (topic, extension) values ('x', 'broadcast')`), /row-level security/);
    eq((await db.query('select 1 from realtime.messages')).rows.length, 0);
  } finally {
    await db.exec('reset role');
  }
});

await t('any other topic shape is refused — the migration opens nothing else up', async () => {
  for (const bad of ['party:', 'party:abc', `party:${'a'.repeat(33)}`, 'party:Amber-Lofi', 'party:amber--lofi', `typing:${ROOM}`, 'lobby', `party:${ROOM}:extra`, 'community:amber-lofi']) {
    await topic(bad);
    await denied(announce(alice), /row-level security/);
    eq((await listen(alice)).length, 0, `listen on ${bad}`);
  }
  await topic('');
  await denied(announce(alice), /row-level security/);
});

await t('only the broadcast and presence extensions are covered', async () => {
  await topic(`party:${ROOM}`);
  await denied(announce(alice, 'postgres_changes'), /row-level security/);
  await denied(announce(alice, 'something_else'), /row-level security/);
});

await t('the community typing policies still work next to it, and party rules do not leak into them', async () => {
  await topic(`typing:${crypto.randomUUID()}`);
  await denied(announce(alice), /row-level security/); // not a member of that (nonexistent) community, and not a party topic
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
