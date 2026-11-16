/**
 * Runs the real migrations in a local PostgreSQL (PGlite) with stand-ins for the Supabase pieces they rely on
 * (the auth/storage schemas, auth.uid(), the anon/authenticated roles, the realtime publication) — so the security rules can be
 * tested without touching a hosted project. See rls.mjs.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const MIG = new URL('../migrations/', import.meta.url).pathname;
export async function boot() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language plpgsql immutable as $$ declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $$;
    create publication supabase_realtime;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant all on all tables in schema public to postgres;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    grant select, insert, update, delete on storage.objects to authenticated; grant select on storage.buckets to authenticated;
  `);
  for (const f of fs.readdirSync(MIG).filter((n) => n.endsWith('.sql')).sort()) {
    try { await db.exec(fs.readFileSync(MIG + f, 'utf8')); console.log('applied', f); }
    catch (e) { console.log('FAILED', f, '→', e.message); process.exit(1); }
  }
  return db;
}
/** Run `sql` as an authenticated user (or anon); returns rows or throws. */
export async function as(db, uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
export const addUser = async (db, email, meta = {}) => (await db.query(`insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), $1, $2::jsonb) returning id`, [email, JSON.stringify(meta)])).rows[0].id;
