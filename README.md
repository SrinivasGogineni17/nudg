# Nudg

SMS-powered customer feedback and Google Review generation for small businesses.

## What It Does

Nudg helps business owners collect customer feedback via SMS and convert positive experiences into Google Reviews.

1. Business owner sends an SMS feedback request to a customer
2. Customer rates their experience (1–5)
3. Positive ratings (4–5) → customer is redirected to leave a Google Review
4. Negative ratings (1–3) → feedback goes to the owner's inbox for resolution
5. Dashboard tracks review opportunities, response rates, and items needing attention

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Expo SDK 56 · React Native 0.85 · React 19 |
| Routing | Expo Router (file-based, typed routes) |
| Styling | NativeWind v4 (Tailwind for React Native) |
| Backend | Supabase (Auth, PostgreSQL, Edge Functions) |
| State | TanStack React Query v5 |
| SMS | Twilio (via Supabase Edge Functions) |
| Monitoring | Sentry |
| Analytics | PostHog |
| Payments | Apple In-App Purchases (react-native-iap) |

## Quick Start

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start in mock mode (no backend needed)
npx expo start

# Run on iOS Simulator (full native build)
npx expo run:ios
```

The app runs in **mock mode** automatically when Supabase isn't configured — fully functional UI with fake data.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run start` | Start Metro bundler |
| `npm run start:clear` | Start with cleared cache |
| `npm run prebuild:clean` | Regenerate native project + clear cache |
| `npm run reset` | Nuclear cache wipe for cryptic errors |
| `npm run typecheck` | TypeScript compiler check |
| `npm run ios` | Build and run on iOS |
| `npm run db:new -- <name>` | Create a new database migration |
| `npm run db:migrate` | Validate and push migrations |

## Releasing

Production deployments are triggered by git tags:

```bash
git tag v1.2.0
git push origin main --tags
```

This triggers the CI/CD pipeline which builds, submits to TestFlight, and deploys backend changes. See `PRODUCTION_SETUP.md` for full details.

## Project Structure

```
src/
├── app/              # Expo Router screens (file-based routing)
├── components/ui/    # Atomic design system (Button, Input, Card, etc.)
├── features/         # Feature modules (auth, dashboard, inbox, send-request)
├── infrastructure/   # External service adapters (Supabase, Sentry, PostHog)
├── services/         # Service interfaces + dependency injection
├── types/            # Domain models and schemas
└── config/           # App configuration
```

## Environment Setup

Copy `.env.example` to `.env` and fill in your service credentials. The app works without them (mock mode) for local development.

## Documentation

- `PRODUCTION_SETUP.md` — Full production deployment guide, CI/CD architecture, secrets reference
- `.kiro/specs/` — Product requirements, design documents, implementation tasks

## License

This software is proprietary. See [LICENSE](./LICENSE) for terms.

© 2024-2026 Nudg. All Rights Reserved.
