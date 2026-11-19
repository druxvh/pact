// Profiles: unique usernames, the availability check, and profile pictures (storage policies + path format).
// Run with: bun run test:db
import { boot, as, addUser } from './setup.mjs';
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '→', e.message); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const denied = async (p, re = /./) => { try { await p; } catch (e) { if (re.test(e.message)) return; throw new Error('wrong error: ' + e.message); } throw new Error('was allowed (should be denied)'); };

const db = await boot();
const alice = await addUser(db, 'alice@x.test', { user_name: 'sam' });
const bob = await addUser(db, 'bob@x.test', { user_name: 'sam' }); // same provider handle → still unique
const carol = await addUser(db, 'carol@x.test');
const name = async (id) => (await as(db, id, `select username from public.profiles where id='${id}'`))[0].username;

console.log('usernames');
await t('two people can never end up with the same username', async () => {
  const [a, b] = [await name(alice), await name(bob)];
  if (a === b) throw new Error('duplicate ' + a);
  await denied(as(db, bob, `update public.profiles set username='${a}' where id='${bob}'`), /profiles_username_key|duplicate key/);
});
await t('usernames are lower-case only, so "Sam" and "sam" cannot coexist', async () => {
  await denied(as(db, carol, `update public.profiles set username='SamSam' where id='${carol}'`), /profiles_username_format|check/);
  await denied(as(db, carol, `update public.profiles set username='a b' where id='${carol}'`), /profiles_username_format|check/);
  await denied(as(db, carol, `update public.profiles set username='ab' where id='${carol}'`), /profiles_username_format|check/);
});
await t('username_available: taken, free, invalid, and your own current name', async () => {
  const taken = await name(alice);
  eq((await as(db, bob, `select public.username_available('${taken}') as ok`))[0].ok, false);
  eq((await as(db, bob, `select public.username_available('brand_new_handle') as ok`))[0].ok, true);
  eq((await as(db, bob, `select public.username_available('NOPE') as ok`))[0].ok, false);
  eq((await as(db, bob, `select public.username_available('x') as ok`))[0].ok, false);
  eq((await as(db, alice, `select public.username_available('${taken}') as ok`))[0].ok, true); // yours isn't "taken" from you
});
await t('username_available is closed to anon', async () => denied(as(db, null, `select public.username_available('whatever')`), /permission denied/));
await t('a taken name is released when it changes', async () => {
  const old = await name(alice);
  await as(db, alice, `update public.profiles set username='alice_new' where id='${alice}'`);
  eq((await as(db, bob, `select public.username_available('${old}') as ok`))[0].ok, true);
  await as(db, bob, `update public.profiles set username='${old}' where id='${bob}'`);
  eq(await name(bob), old);
});

console.log('profile pictures');
const file = (uid, n = 'abcdef12') => `${uid}/${n}.webp`;
await t('a profile picture is a path inside your own folder', async () => {
  await as(db, alice, `update public.profiles set avatar_path='${file(alice)}' where id='${alice}'`);
  eq((await as(db, alice, `select avatar_path from public.profiles where id='${alice}'`))[0].avatar_path, file(alice));
  await as(db, alice, `update public.profiles set avatar_path=null where id='${alice}'`);
});
await t('…never someone else’s, a URL, or an odd file name', async () => {
  for (const bad of [file(bob), 'https://evil.example/pixel.png', `${alice}/short.webp`, `${alice}/abcdef12.png`, `${alice}/../x.webp`, `${alice}/ABCDEF12.webp`, `${alice}/a/b.webp`]) {
    await denied(as(db, alice, `update public.profiles set avatar_path='${bad}' where id='${alice}'`), /profiles_avatar_path_format|check/);
  }
});
await t('uploads are allowed only into your own folder, as a .webp, with a sane name', async () => {
  await as(db, alice, `insert into storage.objects (bucket_id, name) values ('avatars', '${file(alice, 'one11111')}')`);
  for (const bad of [file(bob), `${alice}/x/y.webp`, `${alice}/short.webp`, `${alice}/abcdef12.png`, 'abcdef12.webp']) {
    await denied(as(db, alice, `insert into storage.objects (bucket_id, name) values ('avatars', '${bad}')`), /row-level security/);
  }
});
await t('you can list and remove your own pictures, but not anyone else’s', async () => {
  await as(db, bob, `insert into storage.objects (bucket_id, name) values ('avatars', '${file(bob, 'bob11111')}')`);
  eq((await as(db, alice, `select name from storage.objects where bucket_id='avatars'`)).map((r) => r.name), [file(alice, 'one11111')]);
  await as(db, alice, `delete from storage.objects where bucket_id='avatars' and name='${file(bob, 'bob11111')}'`);
  eq((await db.query(`select count(*)::int n from storage.objects where name='${file(bob, 'bob11111')}'`)).rows[0].n, 1);
  await as(db, alice, `delete from storage.objects where bucket_id='avatars' and name='${file(alice, 'one11111')}'`);
  eq((await db.query(`select count(*)::int n from storage.objects where name='${file(alice, 'one11111')}'`)).rows[0].n, 0);
});
await t('you can keep at most 6 pictures at a time', async () => {
  for (let i = 0; i < 6; i++) await as(db, carol, `insert into storage.objects (bucket_id, name) values ('avatars', '${file(carol, 'pic0000' + i)}')`);
  await denied(as(db, carol, `insert into storage.objects (bucket_id, name) values ('avatars', '${file(carol, 'pic00007')}')`), /row-level security/);
});
await t('the bucket is public, small and webp-only', async () => {
  const b = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='avatars'`)).rows[0];
  eq(b.public, true); eq(Number(b.file_size_limit), 524288); eq(b.allowed_mime_types, ['image/webp']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
