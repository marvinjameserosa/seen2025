# Profile Management Flow

A step-by-step guide to viewing and updating your user profile in the Supabase-powered CTF platform.

---

## Table of Contents

1. [Prerequisites](#prerequisites)  
2. [Data Model & RLS](#data-model--rls)  
3. [Flow Overview](#flow-overview)  
4. [1. View My Profile](#1-view-my-profile)  
5. [2. Edit Profile Details](#2-edit-profile-details)  
   - [2.1 Change Display Name](#21-change-display-name)  
   - [2.2 Change Username](#22-change-username)  
   - [2.3 Change Contact Email](#23-change-contact-email)  
6. [3. Change Password](#3-change-password)  
7. [4. Email Verification & Reset](#4-email-verification--reset)  
8. [5. Best Practices & Error Handling](#5-best-practices--error-handling)  

---

## Prerequisites

- User is **authenticated** via Supabase Auth  
- A row in the `profiles` table exists with `id = auth.uid()`  
- RLS policies on `profiles` allow each user to read/update their own row  

---

## Data Model & RLS

```sql
-- profiles table
CREATE TABLE profiles (
  id            UUID PRIMARY KEY,             -- = auth.uid()
  team_id       UUID REFERENCES teams(id),
  username      VARCHAR(40)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  display_name  VARCHAR(80),
  ...
);

-- RLS: only allow user to read/update their own profile
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Self read" ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Self update" ON profiles
  FOR UPDATE USING (id = auth.uid());
```

## Flow Overview

- Fetch the current profile data from the profiles table
- Display in a form (username, display name, email)
- Submit changes via UPDATE profiles
- Change password via Supabase Auth API
- Handle email verification or reset workflows

## 1. View My Profile

Fetch your own profile data:

```ts
// supabase-js example
const { data: profile, error } = await supabase
  .from('profiles')
  .select('username, display_name, email')
  .eq('id', supabase.auth.user().id)
  .single();

if (error) throw error;
console.log(profile);
```

UI Tip: Disable the "Username" field if you don't allow username changes.

## 2. Edit Profile Details

All updates happen on the profiles table. RLS ensures users only touch their own row.

```ts
const uid = supabase.auth.user().id;
const updates = {
  display_name: 'Alice Wonderland',
  // optionally username or email
};

const { data, error } = await supabase
  .from('profiles')
  .update(updates)
  .eq('id', uid);

if (error) {
  console.error('Update failed:', error.message);
} else {
  console.log('Profile updated:', data);
}
```

### 2.1 Change Display Name

- Field: `display_name`
- Checks: length ≤ 80

### 2.2 Change Username

- Field: `username`
- Checks: unique, format rules (alphanumeric, no spaces)

```ts
await supabase
  .from('profiles')
  .update({ username: 'new_handle' })
  .eq('id', uid);
```

### 2.3 Change Contact Email

- Field: `email`
- Checks: unique, valid email format

Note: Changing email in profiles does not affect login—use Auth API.

```ts
await supabase
  .from('profiles')
  .update({ email: 'new@example.com' })
  .eq('id', uid);
```

## 3. Change Password

Use the Supabase Auth client to update the password for the logged-in user:

```ts
const { error } = await supabase.auth.updateUser({
  password: 'NewSecureP@ssw0rd'
});
if (error) console.error('Password change error:', error.message);
```

- Response: success or descriptive error
- Security: Supabase handles hashing and storage

## 4. Email Verification & Reset

### 4.1 Trigger Password Reset

```ts
const { error } = await supabase.auth.api.resetPasswordForEmail('alice@example.com');
if (error) console.error('Reset email error:', error.message);
```

### 4.2 Email Verification

- Supabase sends a verification link upon signup
- You can re-send via `supabase.auth.api.sendVerificationEmail(email)`

## 5. Best Practices & Error Handling

- Validate inputs on the client (length, format) before calling the API
- Handle common errors:
  - Uniqueness violation (username/email taken)
  - RLS violation (403, unauthorized)
  - Network timeouts
- Provide user feedback (toasts, inline errors)
- Log failures on the server for audit/troubleshooting