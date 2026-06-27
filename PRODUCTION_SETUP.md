# Nudg — Production Deployment Guide

Complete step-by-step guide to deploy Nudg to production.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          DEPLOYMENT PIPELINE                              │
│                                                                          │
│   Developer: git tag v1.2.0 && git push origin v1.2.0                   │
│                              │                                           │
│                              ▼                                           │
│              ┌───────────────────────────────┐                           │
│              │    GitHub Actions Runner       │                           │
│              │    (deploy-production.yml)     │                           │
│              └───────────────┬───────────────┘                           │
│                              │                                           │
│                 ┌────────────┴────────────┐                              │
│                 ▼                         ▼                              │
│    ┌─────────────────────┐   ┌─────────────────────┐                    │
│    │   EAS Build (iOS)   │   │  Supabase Deploy    │                    │
│    │   • Prebuild clean  │   │  • DB migrations    │                    │
│    │   • Source maps     │   │  • Edge functions   │                    │
│    │   • Code sign       │   │  • RLS verification │                    │
│    └──────────┬──────────┘   └─────────────────────┘                    │
│               │                                                          │
│               ▼                                                          │
│    ┌─────────────────────┐                                               │
│    │  App Store Connect  │                                               │
│    │  (Phased 7-day)     │                                               │
│    │  1%→2%→5%→10%→20%   │                                               │
│    │  →50%→100%          │                                               │
│    └─────────────────────┘                                               │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key Principles

- **Tag-triggered deployments**: Production releases are initiated by pushing a semantic version git tag (`v1.0.0`). Branch pushes never deploy to production.
- **Immutable binaries**: Once an iOS binary is on a user's device, it cannot be rolled back. This is why we use phased rollouts and the 426 version gate.
- **Parallel backend + app deploy**: Database migrations and edge functions deploy simultaneously with the app build. Migrations land before users receive the new binary.
- **Single version source of truth**: Build numbers are managed remotely by EAS (`appVersionSource: "remote"`), preventing race conditions between developers.

---

## Quick Reference — Developer Workflow

### Daily Development

```bash
npm run start              # Start Metro bundler
npm run start:clear        # Start with cache cleared
npm run prebuild:clean     # After changing native deps (MMKV, SSL pinning, etc.)
npm run reset              # Nuclear cache wipe for cryptic Metro errors
npm run typecheck          # Run TypeScript compiler check
```

### Creating a Database Migration

```bash
npm run db:new -- add_column_name     # Creates timestamped migration file
# Edit the new .sql file in supabase/migrations/
npm run db:migrate                     # Validate + push to linked project
```

### Releasing to Production

```bash
# 1. Bump version in app.json
# 2. Commit the version bump
git add -A && git commit -m "release: v1.2.0"

# 3. Tag and push — this triggers the full deployment pipeline
git tag v1.2.0
git push origin main --tags
```

The pipeline will:
1. Validate (type check, secret scan, migration collision check)
2. Build the iOS binary on EAS and auto-submit to TestFlight
3. Deploy database migrations and edge functions to Supabase
4. Notify the team via Slack

### Preview Builds (Internal Testing)

```bash
git push origin develop    # Triggers preview build automatically
```

---

## CI/CD Pipeline Files

| File | Trigger | Purpose |
|------|---------|---------|
| `.github/workflows/deploy-production.yml` | `git tag v*.*.*` | Full production deployment |
| `.github/workflows/eas-build.yml` | PR or push to `develop` | Validation + preview builds |

### Required GitHub Secrets

| Secret | Source | Used By |
|--------|--------|---------|
| `EXPO_TOKEN` | [expo.dev](https://expo.dev/settings/access-tokens) | EAS authentication |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens | Source map uploads |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI `supabase login` | CLI authentication |
| `PROD_SUPABASE_PROJECT_REF` | Supabase → Settings → General | Project linking |
| `SLACK_WEBHOOK_URL` | Slack → Incoming Webhooks | Deploy notifications |

### Required EAS Secrets (set via `eas secret:create`)

| Secret | Purpose |
|--------|---------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase API endpoint |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase public key |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry error reporting |
| `EXPO_PUBLIC_POSTHOG_API_KEY` | PostHog analytics |
| `EXPO_PUBLIC_POSTHOG_HOST` | PostHog endpoint |
| `SENTRY_AUTH_TOKEN` | Source map upload during build |

---

## Post-Deployment Verification Checklist

After the pipeline completes (green in GitHub Actions + Slack notification):

- [ ] **Sentry**: New release tag visible → source maps resolve to TypeScript
- [ ] **Supabase**: All user tables show RLS enabled (pipeline checks this automatically)
- [ ] **426 Gate**: Hit a protected endpoint with `X-App-Version: 0.0.1` → receives 426
- [ ] **App Store Connect**: Binary shows "Processing" → enable **Phased Release**
- [ ] **TestFlight**: Internal testers can install and launch the app

---

## 1. Supabase (Backend)

Supabase handles authentication, database, and edge functions.

### Step 1.1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/log in
2. Click **New Project**
3. Choose an organization (or create one)
4. Set:
   - **Project name**: `nudg`
   - **Database password**: (save this somewhere secure)
   - **Region**: Choose the closest to your users (e.g., `us-east-1`)
5. Click **Create new project** — wait ~2 minutes for provisioning

### Step 1.2: Get Your API Keys

Once the project is ready:

1. Go to **Settings → API**
2. Copy:
   - **Project URL** → This is your `EXPO_PUBLIC_SUPABASE_URL`
   - **anon public key** → This is your `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role secret key** → This is your `SUPABASE_SERVICE_ROLE_KEY` (for edge functions only, never expose in the app)

### Step 1.3: Production Database Configuration

1. **Enable Point-in-Time Recovery (PITR)**: Settings → Database → Enable PITR
2. **Enable Database Webhooks** if needed for cache invalidation
3. **Network Restrictions**: Settings → Database → Network → restrict to known IPs if connecting externally

### Step 1.4: Run Database Migrations

Install the Supabase CLI:

```bash
brew install supabase/tap/supabase
```

Link to your remote project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

(Find your project ref in Settings → General → Reference ID)

Push the migrations to production:

```bash
supabase db push
```

This runs the 3 migration files in order:
- `20240101000000_initial_schema.sql` — Creates all 6 tables
- `20240101000001_rls_and_indexes.sql` — Enables RLS + performance indexes
- `20240101000002_add_invalid_response_count.sql` — Adds phone hash + invalid response tracking

### Step 1.5: Configure Auth Settings

In the Supabase Dashboard:

1. Go to **Authentication → Providers**
2. Ensure **Email** is enabled with:
   - ✅ Enable email confirmations
   - ✅ Enable email signup
3. Go to **Authentication → URL Configuration**
4. Set:
   - **Site URL**: `nudg://` (your app's scheme for deep links)
   - **Redirect URLs**: Add `nudg://` and `com.nudg.app://`
5. Go to **Authentication → Email Templates**
   - Customize the confirmation email to match your brand

### Step 1.6: Configure Email (SMTP)

Default Supabase email rate limits are very low (3/hour). For production:

1. Go to **Settings → Authentication → SMTP Settings**
2. Enable custom SMTP
3. Use a provider like **Resend**, **SendGrid**, or **Postmark**:
   - Host: `smtp.resend.com`
   - Port: `465`
   - User: `resend`
   - Password: your API key
   - Sender email: `noreply@yourdomain.com`

### Step 1.7: Deploy Edge Functions

Set the required secrets:

```bash
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
supabase secrets set TWILIO_AUTH_TOKEN=your_twilio_auth_token
supabase secrets set TWILIO_FROM_NUMBER=+1234567890
supabase secrets set ENCRYPTION_KEY=$(openssl rand -hex 32)
supabase secrets set SCHEDULER_SECRET=$(openssl rand -hex 16)
supabase secrets set APP_REVIEW_BYPASS_TOKEN=$(openssl rand -hex 16)
```

> ⚠️ **SAVE YOUR ENCRYPTION_KEY** — if you lose it, all encrypted customer data becomes unrecoverable.

> 💡 **APP_REVIEW_BYPASS_TOKEN** — used by the App Store reviewer account to bypass the 426 version gate during review.

Deploy all functions:

```bash
supabase functions deploy send-sms
supabase functions deploy twilio-webhook
supabase functions deploy appstore-webhook
supabase functions deploy sms-queue-retry
supabase functions deploy decrypt-data
supabase functions deploy delete-customer
```

### Step 1.8: Set Up SMS Queue Retry (Cron)

The `sms-queue-retry` function needs to run every 5 minutes. Set this up using Supabase's pg_cron:

1. Go to **SQL Editor** in the Dashboard
2. Run:

```sql
SELECT cron.schedule(
  'sms-queue-retry',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/sms-queue-retry',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_SCHEDULER_SECRET',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Replace `YOUR_PROJECT_REF` and `YOUR_SCHEDULER_SECRET`.

### Step 1.9: Create Auth Trigger for Business Profile

When a user signs up, automatically create their `business_owners` row. Run in SQL Editor:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.business_owners (
    auth_user_id,
    first_name,
    last_name,
    business_name,
    email,
    google_review_url
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'firstName', ''),
    COALESCE(NEW.raw_user_meta_data->>'lastName', ''),
    COALESCE(NEW.raw_user_meta_data->>'businessName', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'googleReviewUrl', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### Step 1.10: Create App Store Reviewer Test Account

Create a dedicated user in Supabase Auth for Apple's review team:

1. Go to **Authentication → Users → Add User**
2. Create: `appreviewer@nudg.app` / a secure password
3. Manually insert a business profile for this user in the `business_owners` table with mock data
4. Share these credentials in App Store Connect → App Review → App Review Information

---

## 2. Twilio (SMS)

### Step 2.1: Create a Twilio Account

1. Go to [twilio.com](https://www.twilio.com) and sign up
2. Verify your phone number

### Step 2.2: Get a Phone Number

1. In the Twilio Console → **Phone Numbers → Buy a Number**
2. Choose a number with **SMS capability**
3. Note the number (include country code, e.g., `+12025551234`)

### Step 2.3: Get API Credentials

1. Go to **Account → API keys & tokens**
2. Copy:
   - **Account SID** → `TWILIO_ACCOUNT_SID`
   - **Auth Token** → `TWILIO_AUTH_TOKEN`
   - The phone number you bought → `TWILIO_FROM_NUMBER`

### Step 2.4: Configure Webhook for Inbound SMS

When customers reply to your SMS, Twilio needs to forward it to your edge function:

1. Go to **Phone Numbers → Manage → Active Numbers**
2. Click on your number
3. Under **Messaging → A MESSAGE COMES IN**:
   - Set to **Webhook**
   - URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/twilio-webhook`
   - Method: **HTTP POST**
4. Save

### Step 2.5: Upgrade from Trial (Important)

On the trial account:
- You can only send to verified numbers
- Messages have a "Sent from your Twilio trial" prefix

To go live:
1. Go to **Account → Billing**
2. Add a payment method
3. Upgrade from trial ($20 minimum top-up)

Costs: ~$0.0079 per outbound SMS (US), ~$0.0075 per inbound.

---

## 3. Sentry (Error Monitoring)

### Step 3.1: Create a Sentry Project

1. Go to [sentry.io](https://sentry.io) and sign up
2. Create an organization named `nudg`
3. Create a project:
   - Platform: **React Native**
   - Project name: `nudg-mobile`
4. Copy the **DSN** from the setup page → `EXPO_PUBLIC_SENTRY_DSN`

### Step 3.2: Configure Source Maps

For readable stack traces in production crashes:

1. In Sentry → **Settings → Organization → Auth Tokens**
2. Create an auth token with `project:releases` and `org:read` scopes
3. Set as EAS secret: `eas secret:create --name SENTRY_AUTH_TOKEN --value "sntrys_xxx"`

The `@sentry/react-native/expo` plugin automatically uploads source maps during EAS Build.

### Step 3.3: Configure Alert Rules

Set up these alerts in Sentry → Alerts:

| Alert | Condition | Action |
|-------|-----------|--------|
| SSL Pinning Failure | New issue with fingerprint `ssl-pinning-failure-group` | PagerDuty P1 |
| Crash Rate Drop | Crash-free sessions < 99% for 1 hour | PagerDuty P2 |
| Rate Limit Spike | `subsystem:network.ratelimit` > 10 events in 5 min | Slack |
| Cache Purge Storm | `subsystem:storage` > 5 events in 1 hour | Slack |

---

## 4. PostHog (Product Analytics)

### Step 4.1: Create a PostHog Project

1. Go to [posthog.com](https://posthog.com) and sign up (free tier: 1M events/month)
2. Create a project (or use the default one)
3. Go to **Settings → Project → API Key**
4. Copy:
   - **Project API Key** → `EXPO_PUBLIC_POSTHOG_API_KEY`
   - **Host** → `https://app.posthog.com` (or your EU instance: `https://eu.posthog.com`)

### Step 4.2: Event Sampling Note

Performance metrics are sampled at 10% to control costs. Security events are always sent at 100%. When building dashboards for sampled events, multiply counts by 10 for absolute numbers.

---

## 5. Apple Developer Account & In-App Purchases

### Step 5.1: Apple Developer Account

1. Go to [developer.apple.com](https://developer.apple.com)
2. Enroll in the Apple Developer Program ($99/year)
3. Wait for approval (usually 24-48 hours)

### Step 5.2: Create App ID

1. Go to **Certificates, Identifiers & Profiles → Identifiers**
2. Click **+** to register a new identifier
3. Select **App IDs → App**
4. Set:
   - Description: `Nudg`
   - Bundle ID: `com.nudg.app` (Explicit)
5. Enable capabilities:
   - ✅ Push Notifications
   - ✅ In-App Purchase
6. Register

### Step 5.3: Create App in App Store Connect

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. **My Apps → + → New App**
3. Set:
   - Platform: iOS
   - Name: Nudg
   - Bundle ID: `com.nudg.app`
   - SKU: `nudg-ios`
4. Create

### Step 5.4: Configure In-App Purchase Subscriptions

1. In App Store Connect → Your app → **Subscriptions**
2. Create a **Subscription Group** named "Nudg Plans"
3. Create 3 auto-renewable subscriptions:

| Product ID | Name | Price |
|---|---|---|
| `com.nudg.starter.monthly` | Starter | $9.99/month |
| `com.nudg.growth.monthly` | Growth | $29.99/month |
| `com.nudg.pro.monthly` | Pro | $79.99/month |

4. Set each subscription's duration to **1 Month**
5. Add localized display names and descriptions

### Step 5.5: Configure App Store Server Notifications

1. In App Store Connect → Your app → **General → App Information**
2. Scroll to **App Store Server Notifications**
3. Set:
   - **Production URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/appstore-webhook`
   - **Sandbox URL**: Same URL (it handles both)
   - **Version**: V2
4. Save

### Step 5.6: Push Notification Key

1. In [developer.apple.com](https://developer.apple.com) → **Keys**
2. Create a new key:
   - Name: `Nudg Push Key`
   - ✅ Apple Push Notifications service (APNs)
3. Download the `.p8` file and note the **Key ID**
4. EAS handles push notification configuration automatically with your Apple credentials

### Step 5.7: Enable Phased Release

After your app is approved:
1. App Store Connect → Your App → iOS App version
2. Under **Release This Version** → select **"Phased release over 7 days"**
3. Rollout: Day 1: 1%, Day 2: 2%, Day 3: 5%, Day 4: 10%, Day 5: 20%, Day 6: 50%, Day 7: 100%
4. You can **pause** at any point if Sentry shows crash rate spikes

---

## 6. Environment & Secrets Configuration

### Local Development (`.env` file — gitignored)

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
EXPO_PUBLIC_SENTRY_DSN=https://abc123@o12345.ingest.sentry.io/67890
EXPO_PUBLIC_POSTHOG_API_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

> ⚠️ The `.env` file is **gitignored**. It exists only on your local machine. Production builds get secrets from EAS Secrets. Never commit this file.

### EAS Secrets (Production builds)

```bash
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://xxx.supabase.co" --scope project
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "eyJ..." --scope project
eas secret:create --name EXPO_PUBLIC_SENTRY_DSN --value "https://xxx@sentry.io/123" --scope project
eas secret:create --name EXPO_PUBLIC_POSTHOG_API_KEY --value "phc_xxx" --scope project
eas secret:create --name EXPO_PUBLIC_POSTHOG_HOST --value "https://app.posthog.com" --scope project
eas secret:create --name SENTRY_AUTH_TOKEN --value "sntrys_xxx" --scope project
```

### Supabase Edge Function Secrets

```bash
supabase secrets set TWILIO_ACCOUNT_SID=ACxxx
supabase secrets set TWILIO_AUTH_TOKEN=xxx
supabase secrets set TWILIO_FROM_NUMBER=+1234567890
supabase secrets set ENCRYPTION_KEY=<64-char-hex>
supabase secrets set SCHEDULER_SECRET=<random-hex>
supabase secrets set APP_REVIEW_BYPASS_TOKEN=<random-hex>
supabase secrets set MINIMUM_CLIENT_VERSION=1.0.0
```

---

## 7. Production Checklist

### Infrastructure

- [ ] Supabase production project created (separate from dev/staging)
- [ ] PITR (Point-in-Time Recovery) enabled
- [ ] Database migrations applied (`supabase db push`)
- [ ] Auth trigger created for automatic business profile creation
- [ ] All 6 edge functions deployed
- [ ] Edge function secrets configured (Twilio, Encryption Key, Scheduler, Review Bypass)
- [ ] SMS retry cron job configured (pg_cron, every 5 min)
- [ ] Twilio upgraded from trial + inbound webhook configured

### Monitoring & Analytics

- [ ] Sentry project created + DSN configured
- [ ] Sentry auth token set as EAS secret (source map uploads)
- [ ] Sentry alert rules configured (SSL, crash rate, rate limits)
- [ ] PostHog project created + API key configured

### Apple & Distribution

- [ ] Apple Developer account approved
- [ ] App ID registered with Push + IAP capabilities
- [ ] App created in App Store Connect
- [ ] 3 subscription products created (starter, growth, pro)
- [ ] App Store Server Notifications V2 webhook URL configured
- [ ] App Store reviewer test account created in Supabase
- [ ] EAS project initialized (`eas init`)
- [ ] EAS secrets configured (all `EXPO_PUBLIC_*` + `SENTRY_AUTH_TOKEN`)
- [ ] `ITSAppUsesNonExemptEncryption: false` set in app.json (avoids export compliance questionnaire)

### CI/CD

- [ ] GitHub secrets configured (EXPO_TOKEN, SENTRY_AUTH_TOKEN, SUPABASE_ACCESS_TOKEN, etc.)
- [ ] GitHub environments created (`preview`, `production` with required reviewers)
- [ ] Slack webhook configured for deploy notifications
- [ ] First production build tested via `git tag v1.0.0 && git push origin v1.0.0`

### Security

- [ ] Auth tokens stored in iOS Keychain (expo-secure-store)
- [ ] React Query cache encrypted via MMKV + Keychain-backed key
- [ ] PII telemetry sanitizer active on both Sentry and PostHog
- [ ] 426 version gate tested end-to-end
- [ ] Privacy Manifest (`PrivacyInfo.xcprivacy`) covers all collected data types
- [ ] Privacy policy URL set in App Store Connect

---

## 8. Force Update & Version Gate

### How the 426 Gate Works

The app sends `X-App-Version` header with every API request. Supabase edge functions check this against `MINIMUM_CLIENT_VERSION`:

- Version OK → request proceeds normally
- Version too old → responds with `426 Upgrade Required`
- App shows non-dismissible "Update Required" alert

### Forcing an Update

When you ship a breaking API change:

```bash
# Set the minimum version to the new release
supabase secrets set MINIMUM_CLIENT_VERSION=1.2.0
```

All clients below v1.2.0 will immediately receive 426 on their next API call.

### Excluded from 426 Check

These endpoints bypass the version gate (they're called by external services, not the app):
- `twilio-webhook` (called by Twilio)
- `appstore-webhook` (called by Apple)
- `sms-queue-retry` (called by pg_cron scheduler)

The App Store reviewer account also bypasses via `APP_REVIEW_BYPASS_TOKEN`.

---

## 9. Project Structure (for new developers)

```
ReviewRocket2/
├── .github/workflows/          # CI/CD pipelines
│   ├── deploy-production.yml   # Tag-triggered production deploy
│   └── eas-build.yml           # PR validation + preview builds
├── .kiro/specs/                # Project specs (requirements, design, tasks)
├── supabase/
│   ├── config.toml             # Local Supabase dev config
│   ├── migrations/             # Sequential SQL migration files
│   └── functions/              # Deno edge functions
│       ├── send-sms/
│       ├── twilio-webhook/
│       ├── appstore-webhook/
│       ├── sms-queue-retry/
│       ├── decrypt-data/
│       ├── delete-customer/
│       └── _shared/            # Shared adapters, types, middleware
├── src/
│   ├── app/                    # Expo Router file-based routes
│   ├── components/ui/          # Atomic design system components
│   ├── features/               # Feature modules (auth, dashboard, inbox, etc.)
│   ├── infrastructure/         # External service adapters
│   │   ├── supabase/           # Supabase client + repositories
│   │   ├── sentry/             # Error monitoring
│   │   ├── posthog/            # Analytics
│   │   ├── notifications/      # Push notifications
│   │   ├── storage/            # Keychain-backed secure storage
│   │   ├── network/            # SSL pinning, request interceptor
│   │   ├── cache/              # Encrypted MMKV, offline cache
│   │   ├── monitoring/         # Telemetry sanitizer, production monitoring
│   │   └── mock/               # Mock services for development
│   ├── services/               # Service interfaces + DI registry
│   ├── types/                  # Domain models, DTOs, Zod schemas
│   ├── theme/                  # Design tokens
│   ├── config/                 # React Query config, performance utils
│   └── utils/                  # Shared utilities
├── app.json                    # Expo app config
├── eas.json                    # EAS Build profiles
├── .env.example                # Template for local environment variables
└── ios/                        # Generated by prebuild (gitignored)
```

---

## Cost Estimate (Monthly)

| Service | Free Tier | Typical Production |
|---------|-----------|-------------------|
| Supabase | 500MB DB, 2GB bandwidth | $25/mo (Pro plan with PITR) |
| Twilio | None (pay per use) | ~$50/mo (5000 SMS) |
| Sentry | 5K errors/mo | Free |
| PostHog | 1M events/mo | Free |
| Apple Developer | — | $99/year |
| EAS Build | 30 builds/mo | Free |
| **Total** | | **~$83/mo + $99/year** |
