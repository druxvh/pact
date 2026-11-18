// Identity rules: username fixed after onboarding, email read-only and taken from sign-in, social links validated.
import { boot, as, addUser } from './setup.mjs';
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '→', e.message); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const denied = async (p, re = /./) => { try { await p; } catch (e) { if (re.test(e.message)) return; throw new Error('wrong error: ' + e.message); } throw new Error('was allowed (should be denied)'); };

const db = await boot();
const alice = await addUser(db, 'alice@x.test', { user_name: 'alice' });
const bob = await addUser(db, 'bob@x.test');
const setLinks = (uid, links) => as(db, uid, `update public.profiles set links = '${JSON.stringify(links).replace(/'/g, "''")}'::jsonb where id='${uid}'`);

console.log('username');
await t('the username can be chosen while onboarding, together with the onboarded flag', async () => {
  await as(db, alice, `update public.profiles set username='alice_real', onboarded=true where id='${alice}'`);
  eq((await as(db, alice, `select username from public.profiles where id='${alice}'`))[0].username, 'alice_real');
});
await t('…and is then fixed: no more changes, however it is sent', async () => {
  await denied(as(db, alice, `update public.profiles set username='alice_two' where id='${alice}'`), /username_locked/);
  await denied(as(db, alice, `update public.profiles set username='alice_two', bio='x' where id='${alice}'`), /username_locked/);
  eq((await as(db, alice, `select username from public.profiles where id='${alice}'`))[0].username, 'alice_real');
});
await t('other fields stay editable after the lock', async () => {
  await as(db, alice, `update public.profiles set display_name='Alice', bio='hi' where id='${alice}'`);
});
await t('someone who has not finished onboarding can still pick their name', async () => {
  await as(db, bob, `update public.profiles set username='bobby' where id='${bob}'`);
});

console.log('email');
await t('a new account’s email comes from the sign-in', async () => {
  eq((await as(db, alice, `select contact_email from public.profile_private where id='${alice}'`))[0].contact_email, 'alice@x.test');
});
await t('it can’t be written or changed by the person (insert or update)', async () => {
  await denied(as(db, alice, `update public.profile_private set contact_email='evil@x.test' where id='${alice}'`), /permission denied/);
  await denied(as(db, alice, `insert into public.profile_private (id, contact_email) values (gen_random_uuid(), 'a@b.c')`), /permission denied/);
  eq((await as(db, alice, `select contact_email from public.profile_private where id='${alice}'`))[0].contact_email, 'alice@x.test');
});
await t('nobody can read someone else’s email', async () => {
  eq((await as(db, bob, `select * from public.profile_private where id='${alice}'`)).length, 0);
});

console.log('social links');
const L = (kind, url) => ({ kind, url });
await t('up to five links on known platforms are accepted', async () => {
  await setLinks(alice, [L('instagram', 'https://instagram.com/alice'), L('x', 'https://x.com/alice'), L('github', 'https://github.com/alice'), L('youtube', 'https://www.youtube.com/@alice'), L('website', 'https://alice.dev')]);
  eq((await as(db, alice, `select jsonb_array_length(links) n from public.profiles where id='${alice}'`))[0].n, 5);
});
await t('a sixth is refused', async () => denied(setLinks(alice, [1, 2, 3, 4, 5, 6].map((i) => L('website', `https://site${i}.dev`))), /invalid_links/));
await t('the address must belong to the platform', async () => {
  for (const bad of [L('instagram', 'https://evil.example/instagram.com/alice'), L('instagram', 'https://instagram.com.evil.example/a'), L('github', 'https://notgithub.com/a'), L('x', 'https://x.com.evil.io/a')]) await denied(setLinks(alice, [bad]), /invalid_links/);
});
await t('https only, no credentials, no scripts, no unknown platforms or extra keys', async () => {
  for (const bad of [L('website', 'http://alice.dev'), L('website', 'javascript:alert(1)'), L('website', 'https://user:pw@alice.dev'), L('myspace', 'https://myspace.com/a'), { kind: 'website', url: 'https://alice.dev', extra: 1 }, L('website', 'https://alice.dev/' + 'a'.repeat(300))])
    await denied(setLinks(alice, [bad]), /invalid_links/);
});
await t('links must be a JSON array', async () => denied(as(db, alice, `update public.profiles set links='{"a":1}'::jsonb where id='${alice}'`), /invalid_links/));
await t('an outsider cannot read someone’s profile (links included)', async () => {
  eq((await as(db, bob, `select links from public.profiles where id='${alice}'`)).length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
