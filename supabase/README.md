# Pool Automation Supabase Setup

This folder contains the database schema and Edge Functions for the ESP32 pool hub.

## 1. Create The Database Tables

Run the migration in Supabase SQL Editor:

```sql
-- paste contents of:
-- supabase/migrations/202605070001_pool_automation_schema.sql
```

Then create your first device after you have a Supabase Auth user:

```sql
insert into public.devices (user_id, device_id, name)
values ('YOUR_AUTH_USER_UUID', 'pool-hub-001', 'Pool Hub');

insert into public.device_secrets (device_id, secret_hash)
values ('pool-hub-001', crypt('YOUR_LONG_RANDOM_DEVICE_SECRET', gen_salt('bf')));
```

Use the plain secret only on the ESP32. Supabase stores the hash.

## 2. Deploy Edge Functions

Install the Supabase CLI, log in, link your project, then deploy:

```bash
supabase functions deploy device-state
supabase functions deploy device-history
supabase functions deploy device-command-poll
supabase functions deploy device-command-complete
supabase functions deploy device-command-failed
supabase functions deploy device-schedules
supabase functions deploy send-device-command
```

The functions use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the Supabase Edge Runtime. Do not put the service role key in the React app or ESP32 firmware.

## 3. Configure The ESP32

In `pool_code_hub_V5.ino`, set:

```cpp
constexpr bool CLOUD_ENABLED = true;
constexpr char SUPABASE_URL[] = "https://YOUR_PROJECT_REF.supabase.co";
constexpr char SUPABASE_ANON_KEY[] = "YOUR_SUPABASE_ANON_KEY";
constexpr char DEVICE_ID[] = "pool-hub-001";
constexpr char DEVICE_SECRET[] = "YOUR_LONG_RANDOM_DEVICE_SECRET";
```

The firmware sends:

- latest state to `device-state` every 30 seconds
- history to `device-history` every 5 minutes
- command polls to `device-command-poll` every 10 seconds
- schedule syncs to `device-schedules`

Schedules remain local-first: the ESP32 saves synced schedules in NVS and continues running them when cloud is unavailable.

## 4. App Command Flow

The React app should insert rows into `device_commands` instead of directly editing relay state:

```ts
await supabase.from("device_commands").insert({
  user_id: user.id,
  device_id: "pool-hub-001",
  command_type: "pump_on",
  payload: {},
});
```

The ESP32 polls pending commands, executes them locally over LoRa, then marks them `completed` or `failed`.

## Production Notes

Production-ready:

- tables for devices, commands, schedules, history, and alerts
- row level security for user-owned app data
- hashed device secrets
- Edge Functions that verify `device_id` and `device_secret`
- local-first firmware behavior

MVP placeholders:

- ESP32 JSON parsing is intentionally lightweight
- Edge Functions do not rate limit devices yet
- offline status should eventually be maintained by a scheduled server job
- schedule conflict validation belongs in the app or another Edge Function

## Pro / Multi-Property Accounts

Run:

```sql
-- paste contents of:
-- supabase/migrations/202605080009_pro_organizations.sql
```

The Pro app uses these tables:

- `organizations`
- `organization_members`
- `devices.organization_id`
- device property fields: `property_name`, `address`, `city`, `state`, `zip`, `property_notes`

Create the Pro login normally in Supabase Auth or from the app. Use a real email address you control:

```text
Email: YOUR_REAL_PRO_EMAIL
Password: WorkflowPro123!
```

After the user exists, copy its Auth UUID and run the test setup block at the bottom of `202605080009_pro_organizations.sql`. That links the login to a Pro organization and assigns `pool-hub-001` as the first property.

## Optional MQTT Fast Commands

MQTT is the fast wake path for commands. Supabase remains the database and backup polling path.

Set these Edge Function secrets after creating a broker:

```bash
supabase secrets set MQTT_URL=mqtts://YOUR_MQTT_HOST:8883
supabase secrets set MQTT_USERNAME=YOUR_MQTT_USERNAME
supabase secrets set MQTT_PASSWORD=YOUR_MQTT_PASSWORD
supabase functions deploy send-device-command
```

Then update the ESP32 sketch:

```cpp
constexpr bool MQTT_ENABLED = true;
constexpr char MQTT_HOST[] = "YOUR_MQTT_HOST";
constexpr uint16_t MQTT_PORT = 8883;
constexpr char MQTT_USERNAME[] = "YOUR_MQTT_USERNAME";
constexpr char MQTT_PASSWORD[] = "YOUR_MQTT_PASSWORD";
```

The app calls `send-device-command`. That function:

- verifies the logged-in user owns the device
- creates a `device_commands` row
- publishes MQTT to `pool/devices/{device_id}/commands`

If MQTT secrets are missing, the function still creates the command row and the ESP32 Supabase polling backup can pick it up.
