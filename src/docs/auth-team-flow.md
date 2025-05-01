# Authentication & Team Management

This guide walks you through the **full signup/login flow**, plus how users can **create** or **join** teams in the Supabase‐backed CTF platform.

---

## Table of Contents

1. [Prerequisites](#prerequisites)  
2. [1. Sign Up](#1-sign-up)  
3. [2. Profile Creation](#2-profile-creation)  
4. [3. Log In](#3-log-in)  
5. [4. Create a Team](#4-create-a-team)  
6. [5. Join an Existing Team](#5-join-an-existing-team)  
7. [6. Whitelist & Approval](#6-whitelist--approval)  
8. [7. Sample supabase-js Code](#7-sample-supabase-js-code)  

---

## Prerequisites

- You have a Supabase project configured with the SQL schema  
- The `pgcrypto` extension is enabled  
- Tables & RPCs from the schema (including `profiles`, `teams`, `create_team()`, `join_team()`) are already created  

---

## 1. Sign Up

1. **Front-end** calls Supabase Auth:

   ```ts
   const { data, error } = await supabase.auth.signUp({
     email: 'alice@example.com',
     password: 'SuperSecret123!'
   });
   if (error) console.error('Signup error:', error.message);
   ```

2. Supabase sends verification email (optional, configurable).

## 2. Profile Creation

Once the user's account is created (and optionally confirmed), you must insert a row into the profiles table so your database has their metadata:

```ts
const uid = (await supabase.auth.getSession()).data.session?.user.id;
await supabase
  .from('profiles')
  .insert({
    id: uid,
    username: 'alice',
    email: 'alice@example.com',
    display_name: 'Alice Liddell'
  });
```

**Important**: profiles.id must exactly match auth.uid().

## 3. Log In

```ts
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'alice@example.com',
  password: 'SuperSecret123!'
});
if (error) console.error('Login failed:', error.message);
else console.log('Logged in as', data.user.id);
```

## 4. Create a Team

Only users not already on a team can call this RPC. It:

- Generates a team record with a random invite_code
- Sets the caller as captain
- Updates the caller's profiles.team_id

```ts
const { data: team, error } = await supabase.rpc('create_team', {
  team_name: 'RedPandas',
  max_size: 5   // optional; defaults to 5 (pero 4 ata)
});
if (error) {
  console.error('Create team error:', error.message);
} else {
  console.log('Team created:', team);
  console.log('Invite code:', team.invite_code);
}
```

Result:

```json
{
  "id": "uuid-of-new-team",
  "name": "GDG-Web-Dept",
  "invite_code": "AB2CD3EF4G",
  "max_size": 5,
  "is_whitelisted": false,
  "captain_id": "alice-profile-uuid",
  "created_at": "2025-05-01T08:00:00Z"
}
```

## 5. Join an Existing Team

Users not already on a team can join by invite code:

```ts
const { error } = await supabase.rpc('join_team', {
  invite_code_in: 'AB2CD3EF4G'
});
if (error) {
  console.error('Join team error:', error.message);
} else {
  console.log('Successfully joined team');
}
```

Checks:
- Invite code exists
- Team is not full (profiles count < teams.max_size)

After success, your profiles.team_id is set and the user appears on the team's roster.

## 6. Whitelist & Approval

By default, every new team's is_whitelisted = FALSE. An administrator must approve teams before they can submit flags or appear on leaderboards:

```sql
-- Approve one team in SQL Editor or Admin UI
UPDATE teams
   SET is_whitelisted = TRUE
 WHERE invite_code = 'AB2CD3EF4G';
```

Un-approved teams:
- Cannot submit flags (trigger will block)
- Do not appear on the scoreboard view

## 7. Sample supabase-js Code

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function signUp(email: string, password: string, username: string) {
  const { data: authData, error: signupError } = await supabase.auth.signUp({ email, password });
  if (signupError) throw signupError;

  const uid = authData.user?.id!;
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({ id: uid, username, email });
  if (profileError) throw profileError;
}

async function logIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function createTeam(name: string, maxSize = 5) {
  const { data: team, error } = await supabase.rpc('create_team', { team_name: name, max_size: maxSize });
  if (error) throw error;
  return team;
}

async function joinTeam(inviteCode: string) {
  const { error } = await supabase.rpc('join_team', { invite_code_in: inviteCode });
  if (error) throw error;
}

// Usage example
await signUp('alice@example.com', 'password123', 'alice');
await logIn('alice@example.com', 'password123');
const team = await createTeam('RedPandas');
console.log('Invite code:', team.invite_code);
// Later...
await joinTeam('AB2CD3EF4G');
```