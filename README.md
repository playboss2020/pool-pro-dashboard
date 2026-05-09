# Pool Dashboard

Standalone React/Vite dashboard for the ESP32 pool automation hub.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use your Supabase anon key in `.env.local`. The app writes commands to `device_commands`; it does not directly edit relay state.

Default login created during setup:

```text
pooladmin@example.com
XCn0BELh8yOxuR3IjBKQ/ZmN
```

Change that password in Supabase Auth after first login.
