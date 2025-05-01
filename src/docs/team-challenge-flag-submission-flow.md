# Team Challenge & Flag Submission Flow

This document describes how teams browse challenges, download assets, view hints, and submit flags in the Supabase-backed CTF platform.

---

## Table of Contents

1. [Prerequisites](#prerequisites)  
2. [Data Model](#data-model)  
3. [Flow Overview](#flow-overview)  
4. [1. Browse Challenges](#1-browse-challenges)  
5. [2. View Challenge Details](#2-view-challenge-details)  
6. [3. Download Challenge Files](#3-download-challenge-files)  
7. [4. View & Purchase Hints](#4-view--purchase-hints)  
8. [5. Submit Flag](#5-submit-flag)  
9. [6. Handle Submission Response](#6-handle-submission-response)  
10. [7. Live Scoreboard Update](#7-live-scoreboard-update)  
11. [8. Sample supabase-js Code](#8-sample-supabase-js-code)  
12. [Best Practices](#best-practices)  

---

## Prerequisites

- User is **authenticated** and has a row in `profiles` (`profiles.id = auth.uid()`)  
- User's `profiles.team_id` is set and the team's `is_whitelisted = TRUE`  
- The schema (tables, triggers, views, RPCs) from `schema.sql` is applied  

---

## Data Model

```sql
-- challenges
challenges(id, category_id, title, description, points_base, points_floor, released_at, …)

-- challenge_files
challenge_files(challenge_id, filename, storage_path, …)

-- hints
hints(challenge_id, sequence, text, cost_points, released_at)

-- submissions
submissions(challenge_id, profile_id, team_id /*auto*/, submitted_flag,
            is_correct /*triggered*/, points_awarded /*triggered*/, attempt_no, …)

-- solves (MV) & scoreboard (view)
solves(team_id, challenge_id, points_awarded, first_blood, …)
scoreboard(team_id, total_points, last_solve, place)
```

Key triggers/functions:

- `trg_award_dynamic_points` calculates points_awarded based on how many teams have already solved
- `trg_ensure_team_whitelisted` blocks submissions from un-approved teams

## Flow Overview

- List available challenges
- Select a challenge to see details, files, hints
- Download any associated files
- Purchase hints (if implemented)
- Submit your flag
- Process response: correct/incorrect, points awarded
- View updated scoreboard

## 1. Browse Challenges

Query all released challenges:

```ts
const { data: challenges, error } = await supabase
  .from('challenges')
  .select('id, title, points_base, points_floor, released_at')
  .lte('released_at', new Date().toISOString())
  .order('points_base', { ascending: true });
```

- Filter by `released_at ≤ now()`
- Display `points_base` & `points_floor` (front-end can estimate current value if desired)

## 2. View Challenge Details

Fetch full description and metadata:

```ts
const { data: chal, error } = await supabase
  .from('challenges')
  .select(`
    id,
    title,
    description,
    points_base,
    points_floor,
    released_at
  `)
  .eq('id', selectedId)
  .single();
```

- Render description as Markdown
- Show base/floor values and number of solves (via a separate query on solves)

## 3. Download Challenge Files

List and download any files:

```ts
const { data: files } = await supabase
  .from('challenge_files')
  .select('filename, storage_path')
  .eq('challenge_id', selectedId);

files.forEach(f => {
  const url = supabase.storage.from('ctf-files').getPublicUrl(f.storage_path);
  // render a download link
});
```

## 4. View & Purchase Hints

List released hints:

```ts
const { data: hints } = await supabase
  .from('hints')
  .select('sequence, cost_points, text')
  .eq('challenge_id', selectedId)
  .lte('released_at', new Date().toISOString());
```

If you implement a "purchase" RPC:

```ts
await supabase.rpc('buy_hint', {
  challenge_id: selectedId,
  hint_sequence: 1
});
```

Deduct `cost_points` from the team's score (implement via trigger or RPC).

## 5. Submit Flag

Insert a new submission row:

```ts
const uid = supabase.auth.user().id;
const { data, error } = await supabase
  .from('submissions')
  .insert([{
    challenge_id: selectedId,
    profile_id: uid,
    submitted_flag: userFlag
  }])
  .select('is_correct, points_awarded, attempt_no');
```

- RLS should allow authenticated users to insert into submissions
- Trigger `trg_ensure_team_whitelisted` runs first
- Trigger `trg_award_dynamic_points` runs on correct flags

## 6. Handle Submission Response

```ts
if (error) {
  if (error.message.includes('not approved')) {
    alert('Your team is not yet whitelisted.');
  } else {
    alert('Submission error: ' + error.message);
  }
} else {
  const result = data[0];
  if (result.is_correct) {
    alert(`Correct! You earned ${result.points_awarded} points.`);
  } else {
    alert('Incorrect flag, try again.');
  }
}
```

- `is_correct` tells you success
- `points_awarded` is the decayed score for this solve
- `attempt_no` indicates how many tries you've used

## 7. Live Scoreboard Update

After each correct submission, call the RPC to refresh:

```ts
await supabase.rpc('rpc_refresh_solves');
```

Then fetch the updated leaderboard:

```ts
const { data: board } = await supabase
  .from('scoreboard')
  .select('team_id, total_points, place, last_solve')
  .order('place', { ascending: true });
```

## 8. Sample supabase-js Code

```ts
// Submit flag and refresh scoreboard
async function submitFlag(challengeId: string, flag: string) {
  const uid = supabase.auth.user().id;
  const { data, error } = await supabase
    .from('submissions')
    .insert([{ challenge_id: challengeId, profile_id: uid, submitted_flag: flag }])
    .select('is_correct, points_awarded, attempt_no');
  if (error) throw error;
  if (data[0].is_correct) {
    await supabase.rpc('rpc_refresh_solves');
  }
  return data[0];
}
```

## Best Practices

- Debounce flag submissions to prevent accidental spamming
- Cache challenge list; poll for new releases instead of refetching constantly
- Graceful errors: display inline messages for each field
- Secure RLS: lock down submissions to only allow inserts by authenticated users
- Audit: use the raw submissions table for anti-cheat monitoring