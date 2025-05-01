# Supabase CTF Platform Schema

This repository contains the complete PostgreSQL schema, triggers, views, and helper functions to power a team-based Capture-The-Flag (CTF) platform on Supabase. Key features include:

- **UUID primary keys** and secure random invite codes  
- **"Profiles"** table instead of "users" (maps 1:1 to `auth.uid()`)  
- **Dynamic scoring**: points decay as more teams solve  
- **Team whitelist**: only approved teams can participate  
- **Materialized `solves` view** + fast `scoreboard`  
- **RPC helpers** for team creation & joining  
- **Row-Level Security** on profiles  

---

## Table of Contents

1. [Requirements](#requirements)  
2. [Installation](#installation)  
3. [Schema Walk-Through](#schema-walk-through)  
   1. [0. Extension](#0-extension)  
   2. [1. Global Config (`config`)](#1-global-config-config)  
   3. [2. Invite-Code Generator](#2-invite-code-generator)  
   4. [3. Teams (`teams`)](#3-teams-teams)  
   5. [4. Profiles (`profiles`)](#4-profiles-profiles)  
   6. [5. Categories (`categories`)](#5-categories-categories)  
   7. [6. Challenges & Assets](#6-challenges--assets)  
   8. [7. Submissions (`submissions`)](#7-submissions-submissions)  
   9. [8. Triggers & Functions](#8-triggers--functions)  
      - [8.1 Copy `team_id`](#81-copy-team_id-to-submissions)  
      - [8.2 Enforce Team Size](#82-enforce-max-team-size)  
      - [8.3 Captain Membership](#83-captain-membership)  
      - [8.4 Dynamic Scoring](#84-dynamic-scoring)  
      - [8.5 Whitelist Enforcement](#85-whitelist-enforcement)  
   10. [9. Materialized View: `solves`](#9-materialized-view-solves)  
   11. [10. Scoreboard View: `scoreboard`](#10-scoreboard-view-scoreboard)  
   12. [11. Announcements (`announcements`)](#11-announcements-announcements)  
   13. [12. RPC Helpers](#12-rpc-helpers)  
      - [12.1 `create_team()`](#121-create_team)  
      - [12.2 `join_team()`](#122-join_team)  
   14. [13. Seed Data](#13-seed-data)  
   15. [14. Row-Level Security (RLS)](#14-row-level-security-rls)  

---

## Requirements

- Supabase project with SQL Editor  
- PostgreSQL 15 (Supabase default)  
- `pgcrypto` extension (UUIDs & secure bytes)  

---

## Installation

1. Open **Supabase → SQL Editor**  
2. Copy the entire `schema.sql` (below) into a new query  
3. Run the script to provision all tables, functions, triggers, views, and policies  

Optionally, schedule the RPC `rpc_refresh_solves()` to run every minute during the contest.

---

## Schema Walk-Through

### 0. Extension

Enable UUID and crypto functions:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 1. Global Config (`config`)

Stores contest-wide settings in a single row:

| Column | Type | Description |
|--------|------|-------------|
| id | boolean | Always TRUE, allows easy upserts. |
| ctf_name | text | Human-readable contest name. |
| start_at | timestamptz | CTF start time. |
| end_at | timestamptz | CTF end time. |
| freeze_at | timestamptz | If set, hides solve times after this point. |

```sql
CREATE TABLE IF NOT EXISTS config (
  id        BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
  ctf_name  TEXT        NOT NULL DEFAULT 'My CTF',
  start_at  TIMESTAMPTZ NOT NULL,
  end_at    TIMESTAMPTZ NOT NULL,
  freeze_at TIMESTAMPTZ
);

INSERT INTO config(start_at,end_at)
VALUES ('2025-06-01 12:00+00','2025-06-03 12:00+00')
ON CONFLICT(id) DO NOTHING;
```

### 2. Invite-Code Generator

Generates secure 10-char base-32 codes for team invites:

```sql
CREATE OR REPLACE FUNCTION random_invite_code()
RETURNS CHAR(10) LANGUAGE plpgsql AS $$
DECLARE raw BYTEA := gen_random_bytes(7);
BEGIN
  RETURN substr(upper(encode(raw,'base32')),1,10);
END $$;
```

### 3. Teams (`teams`)

Holds team metadata and whitelist status:

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK (generated). |
| name | varchar(120) | Unique team name. |
| max_size | int | Maximum members allowed. |
| invite_code | char(10) | Join code (auto). |
| is_whitelisted | boolean | Must be TRUE to participate. |
| captain_id | uuid | FK → profiles.id (one per team). |
| created_at | timestamptz | Creation timestamp. |

```sql
CREATE TABLE IF NOT EXISTS teams (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(120) NOT NULL UNIQUE,
  max_size       INT     NOT NULL DEFAULT 5,
  invite_code    CHAR(10) NOT NULL UNIQUE DEFAULT random_invite_code(),
  is_whitelisted BOOLEAN NOT NULL DEFAULT FALSE,
  captain_id     UUID    UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE teams
  ADD CONSTRAINT fk_captain_is_member
  FOREIGN KEY(captain_id) REFERENCES profiles(id)
  DEFERRABLE INITIALLY DEFERRED;
```

### 4. Profiles (`profiles`)

One row per signed-in user; id must equal auth.uid():

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK; Supabase auth.uid(). |
| team_id | uuid | FK → teams.id (nullable). |
| username | varchar(40) | Unique handle. |
| email | varchar(255) | Unique email. |
| display_name | varchar(80) | Optional display name. |
| is_admin | boolean | Admin flag. |
| joined_at | timestamptz | Signup timestamp. |
| last_login_at | timestamptz | Updated on login. |

```sql
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY,
  team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
  username      VARCHAR(40)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  display_name  VARCHAR(80),
  is_admin      BOOLEAN      NOT NULL DEFAULT FALSE,
  joined_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
```

### 5. Categories (`categories`)

Lookup table for challenge types (e.g. "web", "crypto"):

```sql
CREATE TABLE IF NOT EXISTS categories (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(60) NOT NULL UNIQUE
);
```

### 6. Challenges & Assets

#### challenges

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK. |
| category_id | uuid | FK → categories.id. |
| title | varchar(120) | Challenge title. |
| description | text | Markdown content. |
| flag_hash | bytea | SHA-256 of canonical flag. |
| points_base | int | Starting score. |
| points_floor | int | Minimum score after decay. |
| released_at | timestamptz | Go-live timestamp (optional). |
| max_attempts | int | NULL = unlimited guesses. |
| created_at | timestamptz | Timestamp. |

```sql
CREATE TABLE IF NOT EXISTS challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID REFERENCES categories(id),
  title         VARCHAR(120) NOT NULL,
  description   TEXT,
  flag_hash     BYTEA NOT NULL,
  points_base   INT NOT NULL,
  points_floor  INT NOT NULL,
  released_at   TIMESTAMPTZ,
  max_attempts  INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### challenge_files

```sql
CREATE TABLE IF NOT EXISTS challenge_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
  filename     VARCHAR(255) NOT NULL,
  storage_path TEXT NOT NULL,
  filesize     BIGINT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### hints

```sql
CREATE TABLE IF NOT EXISTS hints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
  sequence     INT NOT NULL,
  text         TEXT NOT NULL,
  cost_points  INT NOT NULL DEFAULT 0,
  released_at  TIMESTAMPTZ
);
```

### 7. Submissions (`submissions`)

Logs every flag attempt:

```sql
CREATE TABLE IF NOT EXISTS submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id    UUID REFERENCES challenges(id),
  profile_id      UUID REFERENCES profiles(id),
  team_id         UUID,               -- populated by trigger
  submitted_flag  TEXT,
  is_correct      BOOLEAN,
  points_awarded  INT,
  attempt_no      INT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address      INET
);

CREATE INDEX ix_sub_chal_team ON submissions(challenge_id, team_id);
CREATE INDEX ix_sub_pro_chal ON submissions(profile_id, challenge_id);
```

### 8. Triggers & Functions

#### 8.1 Copy `team_id` to Submissions

```sql
CREATE FUNCTION trg_set_submission_team_id() RETURNS TRIGGER AS $$
BEGIN
  NEW.team_id := (SELECT team_id FROM profiles WHERE id = NEW.profile_id);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER set_team_on_submission
BEFORE INSERT ON submissions
FOR EACH ROW EXECUTE FUNCTION trg_set_submission_team_id();
```

#### 8.2 Enforce Max Team Size

```sql
CREATE FUNCTION trg_check_team_size() RETURNS TRIGGER AS $$
DECLARE
  current_ct INT; limit_sz INT;
BEGIN
  IF NEW.team_id IS NULL THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO current_ct
    FROM profiles WHERE team_id = NEW.team_id AND id <> NEW.id;
  SELECT max_size INTO limit_sz FROM teams WHERE id = NEW.team_id;

  IF current_ct + 1 > limit_sz THEN
    RAISE EXCEPTION 'Team % is full (%/% members)', NEW.team_id, current_ct+1, limit_sz;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_team_size
BEFORE INSERT OR UPDATE OF team_id ON profiles
FOR EACH ROW EXECUTE FUNCTION trg_check_team_size();
```

#### 8.3 Captain Membership

```sql
CREATE FUNCTION trg_captain_is_member() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.captain_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = NEW.captain_id AND team_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Captain (profile %) is not a member of team %', NEW.captain_id, NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER captain_membership
BEFORE INSERT OR UPDATE OF captain_id ON teams
FOR EACH ROW EXECUTE FUNCTION trg_captain_is_member();
```

#### 8.4 Dynamic Scoring

```sql
CREATE FUNCTION trg_award_dynamic_points() RETURNS TRIGGER AS $$
DECLARE
  solves_before INT;
  base          INT;
  floor         INT;
  k             INT := 4;
  log10         NUMERIC;
BEGIN
  IF NOT NEW.is_correct THEN RETURN NEW; END IF;

  SELECT COUNT(DISTINCT team_id) INTO solves_before
    FROM submissions
   WHERE challenge_id = NEW.challenge_id AND is_correct;

  SELECT points_base, points_floor INTO base, floor
    FROM challenges WHERE id = NEW.challenge_id;

  SELECT ln(1 + solves_before)/ln(10) INTO log10;

  NEW.points_awarded := GREATEST(
    floor,
    ROUND(base * (1 - log10 / k))
  );
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER dynamic_points
BEFORE INSERT ON submissions
FOR EACH ROW WHEN (NEW.is_correct)
EXECUTE FUNCTION trg_award_dynamic_points();
```

#### 8.5 Whitelist Enforcement

```sql
CREATE FUNCTION trg_ensure_team_whitelisted() RETURNS TRIGGER AS $$
BEGIN
  IF NOT (
       SELECT is_whitelisted FROM teams WHERE id = NEW.team_id
     ) THEN
    RAISE EXCEPTION 'Team % is not approved to participate', NEW.team_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_whitelist
BEFORE INSERT OR UPDATE ON submissions
FOR EACH ROW EXECUTE FUNCTION trg_ensure_team_whitelisted();
```

### 9. Materialized View: `solves`

Snapshot of first correct solve per team & challenge:

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS solves AS
SELECT DISTINCT ON (p.team_id, s.challenge_id)
       s.id            AS submission_id,
       p.team_id,
       s.profile_id,
       s.challenge_id,
       s.points_awarded,
       s.submitted_at,
       (ROW_NUMBER() OVER (
          PARTITION BY s.challenge_id ORDER BY s.submitted_at
        ) = 1) AS first_blood
  FROM submissions s
  JOIN profiles p ON p.id = s.profile_id
 WHERE s.is_correct;

CREATE UNIQUE INDEX IF NOT EXISTS mv_solves_pk ON solves(submission_id);

CREATE FUNCTION rpc_refresh_solves() RETURNS VOID LANGUAGE SQL SECURITY DEFINER AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY solves;
$$;
GRANT EXECUTE ON FUNCTION rpc_refresh_solves() TO authenticated;
```

### 10. Scoreboard View: `scoreboard`

Aggregates points, respects freeze and whitelist:

```sql
CREATE OR REPLACE VIEW scoreboard AS
WITH bounds AS (SELECT start_at, end_at, freeze_at FROM config)
SELECT
  s.team_id,
  SUM(s.points_awarded)             AS total_points,
  MAX(s.submitted_at)               AS last_solve,
  RANK() OVER (
    ORDER BY SUM(s.points_awarded) DESC,
             MAX(s.submitted_at)
  ) AS place
FROM solves s
JOIN teams t ON t.id = s.team_id AND t.is_whitelisted
CROSS JOIN bounds b
WHERE s.submitted_at BETWEEN b.start_at
                        AND COALESCE(b.freeze_at, b.end_at)
GROUP BY s.team_id;
```

### 11. Announcements (`announcements`)

Broadcast messages for all participants:

```sql
CREATE TABLE IF NOT EXISTS announcements (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title     VARCHAR(120) NOT NULL,
  message   TEXT         NOT NULL,
  posted_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### 12. RPC Helpers

#### 12.1 `create_team()`

Creates a team, auto-sets invite code, makes caller captain & member:

```sql
CREATE FUNCTION create_team(
  team_name TEXT,
  max_size  INT DEFAULT 5
) RETURNS teams LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  uid      UUID := auth.uid();
  new_team teams;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Must be logged in'; END IF;
  IF EXISTS(SELECT 1 FROM profiles WHERE id=uid AND team_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Already on a team';
  END IF;

  INSERT INTO teams(name, max_size, captain_id)
       VALUES(team_name, max_size, uid)
     RETURNING * INTO new_team;

  UPDATE profiles SET team_id=new_team.id WHERE id=uid;
  RETURN new_team;
END $$;

GRANT EXECUTE ON FUNCTION create_team(TEXT, INT) TO authenticated;
```

#### 12.2 `join_team()`

Joins caller to an existing team by invite code:

```sql
CREATE FUNCTION join_team(invite_code_in CHAR(10))
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  uid  UUID := auth.uid();
  tgt  teams;
  cnt  INT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Must be logged in'; END IF;
  IF EXISTS(SELECT 1 FROM profiles WHERE id=uid AND team_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Already on a team';
  END IF;

  SELECT * INTO tgt FROM teams WHERE invite_code = invite_code_in;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invite code'; END IF;

  SELECT COUNT(*) INTO cnt FROM profiles WHERE team_id = tgt.id;
  IF cnt >= tgt.max_size THEN RAISE EXCEPTION 'Team is full'; END IF;

  UPDATE profiles SET team_id = tgt.id WHERE id = uid;
END $$;

GRANT EXECUTE ON FUNCTION join_team(CHAR(10)) TO authenticated;
```

### 13. Seed Data

Populate standard categories:

```sql
INSERT INTO categories(name)
VALUES ('web'), ('crypto'), ('pwn'), ('rev')
ON CONFLICT DO NOTHING;
```

### 14. Row-Level Security (RLS)

Ensure profiles can only read/update their own row:

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: self read"
  ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles: self update"
  ON profiles FOR UPDATE
  USING (id = auth.uid());
```

## Usage Notes

- Refresh solves MV via `rpc_refresh_solves()` periodically or after each accepted flag.
- Approve teams by setting `teams.is_whitelisted = TRUE`.
- Call `create_team()` & `join_team()` from your front-end (e.g. supabase-js).
- Expose minimal admin UI to toggle `is_whitelisted` and view announcements.
