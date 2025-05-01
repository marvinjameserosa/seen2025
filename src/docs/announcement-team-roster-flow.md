# Announcements & Feed Flow

Keep your participants in the loop with global messages that update in real time.

---

## 1. Data Model

```sql
CREATE TABLE IF NOT EXISTS announcements (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title     VARCHAR(120) NOT NULL,
  message   TEXT         NOT NULL,
  posted_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

- `id` – unique announcement ID
- `title`, `message` – content displayed to all users
- `posted_at` – timestamp for ordering

## 2. Initial Fetch

Load the existing announcements on page load:

```ts
const { data: announcements, error } = await supabase
  .from('announcements')
  .select('id, title, message, posted_at')
  .order('posted_at', { ascending: false });
if (error) console.error(error);
else renderAnnouncements(announcements);
```

## 3. Real-Time Updates

Subscribe to insertion events so new announcements appear instantly:

```ts
supabase
  .from<Announcement>('announcements')
  .on('INSERT', payload => {
    // payload.new contains the new announcement row
    prependAnnouncement(payload.new);
  })
  .subscribe();
```

- `.on('INSERT', …)` fires whenever an admin adds a row
- `prependAnnouncement()` should update your feed UI

## 4. Admin Posting

Administrators (with RLS policies or roles) insert new announcements:

```sql
INSERT INTO announcements (title, message)
VALUES ('CTF Starts in 1 Hour', 'Get ready—flag submission opens at 12:00 UTC!');
```

Or via supabase-js in an admin interface:

```ts
await supabase.from('announcements').insert({
  title: 'CTF Over',
  message: 'Thanks for playing! Final scores are now available.'
});
```

# Team Roster & Invitations Flow

Manage who's on each team, let captains invite members, and allow voluntary leave.

## 1. Data Model

- `teams` has `id`, `name`, `invite_code`, `captain_id`, `is_whitelisted`
- `profiles` has `id`, `team_id`, `username`, `email`, …

Your existing tables cover team membership; no new tables needed.

## 2. View Team Roster

Fetch all profiles on your team:

```ts
const teamId = currentProfile.team_id;
const { data: members, error } = await supabase
  .from('profiles')
  .select('id, username, display_name')
  .eq('team_id', teamId)
  .order('joined_at', { ascending: true });
if (error) console.error(error);
else renderRoster(members);
```

Highlight the captain: compare each id to the team's captain_id (fetched separately).

```ts
const { data: team } = await supabase
  .from('teams')
  .select('captain_id')
  .eq('id', teamId)
  .single();
```

## 3. Invite by Link or Email

### 3.1 Display Invite Code / Link

```ts
const { data: team } = await supabase
  .from('teams')
  .select('invite_code')
  .eq('id', teamId)
  .single();

const inviteLink = `${appUrl}/join?code=${team.invite_code}`;
showInviteCode(team.invite_code, inviteLink);
```

Invite code can be copied or embedded in a link

### 3.2 Email Invitation (optional)

Use your own email service (e.g. SendGrid) to send:

```
Subject: [CTF] Join my team "${teamName}"!
Body:
  Hi there,

  Use this link to join my CTF team:
  ${inviteLink}

  See you on the leaderboard!
```

## 4. Join Team (as member)

User follows link or enters code in UI, triggering the RPC:

```ts
const { error } = await supabase.rpc('join_team', {
  invite_code_in: typedCode
});
if (error) alert(error.message);
else navigateToDashboard();
```

Validates code, checks max_size, updates profiles.team_id.

## 5. Leave Team

If you allow members to leave:

```ts
const uid = supabase.auth.user().id;
const { error } = await supabase
  .from('profiles')
  .update({ team_id: null })
  .eq('id', uid);
if (error) alert(error.message);
else navigateToTeamSelection();
```

Captains should transfer leadership first:
- Call an admin RPC or direct SQL to set a new captain_id on teams.
- Then leave.

## 6. Permissions & RLS

RLS on profiles: users can only update their own team_id.

RLS on teams: only captains (or admins) can update captain_id, is_whitelisted.

Example policy to let only captains transfer leadership:

```sql
CREATE POLICY "Teams: captain update" ON teams
  FOR UPDATE OF captain_id USING (captain_id = auth.uid());
```

## 7. UI Considerations

- Only show "Create Team" if profiles.team_id is NULL.
- Only show "Leave Team" if profiles.team_id is not NULL.
- Only captains see the invite code and "Transfer Captain" controls.
- Disable Join/Create when is_whitelisted = FALSE (show "Awaiting approval").