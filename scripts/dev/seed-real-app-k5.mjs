#!/usr/bin/env node
/**
 * FOLLOW-1344 (K5 half) — the local data N3 needs on the real Estalara app, idempotent. Nothing here
 * runs against anything but this machine: the app's Postgres and Redis containers, local Keycloak on
 * `:8080`, the backend on `:8081`. It adds nothing under `packages/db/migrations`.
 *
 * What it ensures:
 * 1. One future LIVE presentation on the N3 listing (the app DB ships with zero `live_presentation`
 *    rows, so the page has no register button without it). Fixed uuid; a re-run moves its date. The
 *    listing's agent gets a role grant and the listing one amenity and its publishable fields: see
 *    `ensureLive()` for why.
 * 2. One buyer: a Keycloak user through the admin API, the path
 *    `infrastructure-master/dev/setup-keycloak.sh` uses, and the rows `AuthServiceImpl.register` would
 *    write (account, profile, wallet, agent details with no role grant, so not an active agent). Its
 *    generated password goes to a git-ignored file, mode 600, and is never printed.
 *
 * `--reset-buyer` also forgets the buyer's registrations and conversations and its conversation rate
 * limit, because the backend emits a conversion only for a NEW registration or a NEW buyer/agent pair
 * (README "Only a new pair converts"): without the reset a repeat run could read "no row" for the
 * wrong reason. `resetBuyer()` is what N3 calls between sessions.
 *
 * Usage: `node scripts/dev/seed-real-app-k5.mjs [--reset-buyer]`
 *
 * @module scripts/dev/seed-real-app-k5
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ESTALARA_ROOT =
  process.env.ESTALARA_ROOT ?? nodePath.join(homedir(), 'Projects/Estalara-gitlab-2026-08-17');
const KC_ORIGIN = process.env.N3_KEYCLOAK_ORIGIN ?? 'http://localhost:8080';
const KC_REALM = 'web_application_realm';
const APP_PG = process.env.N3_APP_PG_CONTAINER ?? 'estnew_postgres';
const APP_REDIS = process.env.N3_APP_REDIS_CONTAINER ?? 'estnew_redis';

/** The git-ignored file holding the buyer's login and generated password. */
export const BUYER_FILE =
  process.env.N3_BUYER_FILE ?? nodePath.join(REPO_ROOT, '.localhost-up/n3-buyer.json');
export const LISTING_UUID = process.env.N3_LISTING_UUID ?? '2ff85b1f-2884-4199-ad1f-15d4b6f86ff2';
export const LIVE_UUID = '13440000-0000-4000-8000-00000000000a';
const LIVE_CALENDAR_UUID = '13440000-0000-4000-8000-00000000000b';
const CITY_PLACE_UUID = '13440000-0000-4000-8000-00000000000c';
const BUYER_LOGIN = process.env.N3_BUYER_LOGIN ?? 'n3k5buyer';

/** One `psql -At` statement in the app's container; tuples only, `|` separated. */
export async function appSql(sql) {
  const { stdout } = await execFileAsync(
    'docker',
    [
      'exec',
      APP_PG,
      'psql',
      '-U',
      'myuser',
      '-d',
      'estalara',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      sql,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout.trim();
}

/** Plain literals only: every value here comes from this file or from the DB. */
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function ensureLive() {
  const owner = await appSql(
    `select id, owner_account_id from listing where uuid = ${lit(LISTING_UUID)}`,
  );
  if (!owner) throw new Error(`no listing ${LISTING_UUID} in the app DB`);
  const [listingId, accountId] = owner.split('|');
  const start = `now() + interval '14 days'`;
  await appSql(
    `insert into calendar_event (uuid, account_id, start_date, end_date, event_type, removed)
       values (${lit(LIVE_CALENDAR_UUID)}, ${accountId}, ${start}, ${start} + interval '1 hour',
               'LIVE_PRESENTATION', false)
     on conflict (uuid) do update set start_date = excluded.start_date,
       end_date = excluded.end_date, removed = false`,
  );
  await appSql(
    `insert into live_presentation
       (uuid, max_participants, calendar_event_id, listing_id, status, registration_cutoff_date)
     select ${lit(LIVE_UUID)}, 100000, id, ${listingId}, 'SCHEDULED', start_date
       from calendar_event where uuid = ${lit(LIVE_CALENDAR_UUID)}
     on conflict (uuid) do update set status = 'SCHEDULED',
       registration_cutoff_date = excluded.registration_cutoff_date`,
  );
  // The seed's agent has no role grant, so `isActiveAgent()` is false and a conversation with him
  // is buyer to buyer: no `inquiry.completed`, by design. A listing's agent has one in production.
  await appSql(
    `update agent_details set agent_role_grant_source = 'STANDARD_APPLICATION',
       agent_role_granted_at = now()
     where account_id = ${accountId} and agent_role_grant_source is null`,
  );
  // The seeded listings have no amenities, so the page renders no section for the `feature` slot.
  await appSql(
    `insert into listing_amenity (listing_id, amenity) values (${listingId}, 'SWIMMING_POOL')
     on conflict do nothing`,
  );
  // The seeded listing misses fields `validateListingCanBePublished` needs, so its agent's save is
  // refused (400) and no job is written. A listing that is really live has them.
  await appSql(
    `insert into place (id, uuid, google_place_id, type, country, latitude, longitude)
       values (nextval('seq_place_id'), ${lit(CITY_PLACE_UUID)}, 'n3-k5-palm-coast', 'CITY',
               'UNITED_STATES', 29.58, -81.2)
     on conflict (uuid) do nothing;
     update listing set rooms = coalesce(rooms, 3),
       market_type = coalesce(market_type, 'SECONDARY'),
       finishing_state = coalesce(finishing_state, 'READY_TO_MOVE'),
       city_place_id = coalesce(city_place_id,
         (select id from place where uuid = ${lit(CITY_PLACE_UUID)}))
     where id = ${listingId};
     update translated_property_details set street_name = 'Blackberry Pl'
     where listing_id = ${listingId} and coalesce(street_name, '') = '';`,
  );
  return { liveUuid: LIVE_UUID, listingId, agentAccountId: accountId };
}

/**
 * A default from `setup-keycloak.sh`, or its env override. The dev credentials live there; they are
 * read at run time, never copied into this repository and never printed.
 *
 * @param {string} name - the shell variable.
 */
export async function readSetupDefault(name) {
  if (process.env[name]) return process.env[name];
  const script = await readFile(
    nodePath.join(ESTALARA_ROOT, 'infrastructure-master/dev/setup-keycloak.sh'),
    'utf8',
  );
  return new RegExp(`${name}="\\$\\{${name}:-([^}]*)\\}"`).exec(script)?.[1] ?? '';
}

async function keycloakAdminToken() {
  const username = await readSetupDefault('KC_ADMIN_USER');
  const password = await readSetupDefault('KC_ADMIN_PASS');
  const res = await fetch(`${KC_ORIGIN}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: username ?? '',
      password: password ?? '',
      grant_type: 'password',
      client_id: 'admin-cli',
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Keycloak admin token: HTTP ${String(res.status)}`);
  return (await res.json()).access_token;
}

/**
 * `setup-keycloak.sh` creates the `agent` realm role and never grants it, so the seeded agent gets
 * 403 on every agent endpoint, the listing save among them.
 */
async function ensureAgentRole() {
  const login = await readSetupDefault('TEST_USER_USERNAME');
  const token = await keycloakAdminToken();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const base = `${KC_ORIGIN}/admin/realms/${KC_REALM}`;
  const get = (path) =>
    fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(30000) }).then((r) => r.json());
  const [user] = await get(`/users?username=${encodeURIComponent(login)}&exact=true`);
  const role = await get('/roles/agent');
  const res = await fetch(`${base}/users/${user.id}/role-mappings/realm`, {
    method: 'POST',
    headers,
    body: JSON.stringify([role]),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Keycloak role mapping: HTTP ${String(res.status)}`);
}

async function ensureBuyer() {
  const saved = await readFile(BUYER_FILE, 'utf8').then(JSON.parse, () => null);
  const exists = await appSql(`select id from account where login = ${lit(BUYER_LOGIN)}`);
  if (saved && exists) {
    await appSql(`update user_profile set is_verified = false
      where id = ${exists} and is_verified is null`);
    return { ...saved, accountId: exists };
  }
  if (exists) {
    throw new Error(
      `account ${BUYER_LOGIN} exists but ${BUYER_FILE} does not: delete the account or restore the file`,
    );
  }
  const buyer = {
    login: BUYER_LOGIN,
    email: `${BUYER_LOGIN}@n3.localhost.example`,
    password: `N3-${randomBytes(18).toString('base64url')}`,
  };
  // Not `POST /auth/register`: on this stack it answers 500 (its Keycloak admin client gets 401, see
  // the K5 report). The admin path setup-keycloak.sh uses, then the rows that endpoint would write.
  const token = await keycloakAdminToken();
  const created = await fetch(`${KC_ORIGIN}/admin/realms/${KC_REALM}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      username: buyer.login,
      email: buyer.email,
      firstName: 'N3',
      lastName: 'Buyer',
      enabled: true,
      emailVerified: true,
      requiredActions: [],
      credentials: [{ type: 'password', value: buyer.password, temporary: false }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (created.status !== 201) throw new Error(`Keycloak user: HTTP ${String(created.status)}`);
  await appSql(
    `with a as (
       insert into account (email, login, created_at, user_locale, slug, slug_from_name)
       values (${lit(buyer.email)}, ${lit(buyer.login)}, now(), 'EN', ${lit(buyer.login)}, false)
       returning id
     ), p as (
       insert into user_profile (id, uuid, is_verified) select id, gen_random_uuid(), false from a
     ), w as (
       insert into wallet (id, usd_balance_cents, eur_balance_cents, pln_balance_cents)
       select id, 0, 0, 0 from a
     )
     insert into agent_details (account_id, years_of_experience)
     select id, 'ONE_YEAR_OR_LESS' from a`,
  );
  await mkdir(nodePath.dirname(BUYER_FILE), { recursive: true });
  await writeFile(BUYER_FILE, JSON.stringify(buyer, null, 2), { mode: 0o600 });
  await chmod(BUYER_FILE, 0o600);
  const accountId = await appSql(`select id from account where login = ${lit(BUYER_LOGIN)}`);
  return { ...buyer, accountId };
}

/**
 * Make the buyer new again: no registration, no conversation, no conversation rate-limit window.
 *
 * @param {string} accountId - the buyer's `account.id`, from {@link ensureSeed}.
 * @param {string} login - the buyer's login.
 */
export async function resetBuyer(accountId, login) {
  const id = Number(accountId);
  if (!Number.isInteger(id)) throw new Error('resetBuyer: not an account id');
  await appSql(
    `delete from live_presentation_registration where participant_id = ${String(id)};
     delete from calendar_event where account_id = ${String(id)}
       and event_type = 'LIVE_PRESENTATION_REGISTRATION';
     delete from conversation where participant_low_id = ${String(id)}
       or participant_high_id = ${String(id)};`,
  );
  // The container's password is on its own command line; read it there, keep it out of this repo.
  const { stdout: cmd } = await execFileAsync('docker', [
    'inspect',
    APP_REDIS,
    '--format',
    '{{json .Config.Cmd}}',
  ]);
  const args = JSON.parse(cmd);
  const auth = args[args.indexOf('--requirepass') + 1] ?? '';
  const { stdout: deleted } = await execFileAsync('docker', [
    'exec',
    '-e',
    `REDISCLI_AUTH=${auth}`,
    APP_REDIS,
    'redis-cli',
    'DEL',
    `conv:rate:user:${login}:h`,
  ]);
  if (!/^\(?(integer\) )?\d+/.test(deleted.trim()))
    throw new Error('resetBuyer: Redis refused the DEL');
}

/** @returns {Promise<{login: string, password: string, accountId: string, liveUuid: string}>} */
export async function ensureSeed() {
  const live = await ensureLive();
  await ensureAgentRole();
  const buyer = await ensureBuyer();
  return { ...live, ...buyer };
}

if (
  globalThis.FOLLOW1344_IMPORT_ONLY !== true &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  const seed = await ensureSeed();
  if (process.argv.includes('--reset-buyer')) await resetBuyer(seed.accountId, seed.login);
  console.log(
    `seeded: live ${seed.liveUuid} on listing ${LISTING_UUID}; buyer ${seed.login} ` +
      `(account ${seed.accountId}), password in ${BUYER_FILE}`,
  );
}
