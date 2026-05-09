# Pool Pro Dashboard

Desktop-first Pro dashboard for companies that manage multiple ESP32 pool automation hubs.

This repo starts from the current homeowner dashboard and adds a Pro fleet front door. A normal user still logs in the normal way. If their Supabase user is listed in `organization_members`, the app opens the Pro dashboard first. Selecting a property opens the same full pool dashboard, schedules, history, alerts, and settings for that device.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use your Supabase anon key in `.env.local`. The app writes commands to `device_commands`; it does not directly edit relay state.

## Pro Test Login

Create this account normally in Supabase Auth or from the app. Use a real email address you control:

```text
Email: YOUR_REAL_PRO_EMAIL
Password: WorkflowPro123!
```

Then connect it to a Pro organization by running the setup SQL at the bottom of:

```text
supabase/migrations/202605080009_pro_organizations.sql
```

Replace `YOUR_PRO_USER_UUID` with the UUID from Supabase Auth.

## Routing

- User has no organization membership: opens homeowner dashboard.
- User belongs to an organization: opens Pro fleet dashboard.
- Pro user selects a property: opens that device's full dashboard.
- Home icon inside the device dashboard returns to the Pro fleet dashboard.
