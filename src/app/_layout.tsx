import "../../global.css";

import React, { useEffect, useMemo } from "react";
import { Slot, useNavigationContainerRef } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";

import { ServiceProvider, useService } from "@/services";
import type { ServiceRegistry } from "@/services";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { AuthProvider } from "@/features/auth/context/AuthContext";
import { useProtectedRoute } from "@/features/auth/hooks/useProtectedRoute";
import {
  queryClient,
  setGlobalErrorHandler,
  clearGlobalErrorHandler,
} from "@/config/queryClientConfig";
import { useSentryUserSync } from "@/features/analytics/useSentryUserSync";

// ─── Mock Mode Detection ─────────────────────────────────────────────────────

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";

/**
 * Determines whether the app should run in mock mode.
 * Mock mode is active when the Supabase URL is missing, empty, or set to a
 * known placeholder value.
 */
const IS_MOCK_MODE =
  !SUPABASE_URL ||
  SUPABASE_URL === "https://your-project-id.supabase.co" ||
  SUPABASE_URL === "https://mock.supabase.co";

// ─── Conditional Imports (real vs mock) ──────────────────────────────────────

// Only import real adapters when NOT in mock mode to avoid Supabase client errors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realAuthService: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realMonitoringService: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realAnalyticsService: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let initSentry: (() => void) | null = null;

if (!IS_MOCK_MODE) {
  // Real service imports — only executed when Supabase is configured
  const {
    SupabaseAuthAdapter,
  } = require("@/infrastructure/supabase/auth.adapter");
  const {
    initSentry: realInitSentry,
    SentryMonitoringAdapter,
  } = require("@/infrastructure/sentry/sentry.adapter");
  const {
    PostHogAnalyticsAdapter,
  } = require("@/infrastructure/posthog/posthog.adapter");
  const {
    SupabaseBusinessProfileRepository,
  } = require("@/infrastructure/supabase/repositories/business-profile.repository");
  const {
    SupabaseReviewRequestRepository,
  } = require("@/infrastructure/supabase/repositories/review-request.repository");
  const {
    SupabaseFeedbackRecordRepository,
  } = require("@/infrastructure/supabase/repositories/feedback-record.repository");
  const {
    ExpoNotificationAdapter,
  } = require("@/infrastructure/notifications/notification.adapter");

  realAuthService = new SupabaseAuthAdapter();
  realMonitoringService = new SentryMonitoringAdapter();
  realAnalyticsService = new PostHogAnalyticsAdapter();
  initSentry = realInitSentry;

  // Initialize Sentry at module level
  realInitSentry();

  // Store repository constructors for lazy creation
  (globalThis as any).__RR_REAL_REPOS = {
    BusinessProfile: SupabaseBusinessProfileRepository,
    ReviewRequest: SupabaseReviewRequestRepository,
    FeedbackRecord: SupabaseFeedbackRecordRepository,
    Notification: ExpoNotificationAdapter,
  };
}

// Mock services import
import {
  createMockServiceRegistry,
  getMockAuthService,
} from "@/infrastructure/mock/mock-services";

// ─── Service Registry Factory ────────────────────────────────────────────────

function createRealServiceRegistry(): ServiceRegistry {
  const repos = (globalThis as any).__RR_REAL_REPOS;

  return {
    auth: realAuthService,
    reviewRequests: new repos.ReviewRequest(),
    feedback: new repos.FeedbackRecord(),
    businessProfile: new repos.BusinessProfile(),
    sms: {
      async sendFeedbackRequest(params: any) {
        const { data: { session } } = await require('@/infrastructure/supabase/client').supabase.auth.getSession();
        if (!session?.access_token) {
          return { success: false, error: { code: 'AUTH_ERROR', message: 'Not authenticated' } };
        }
        try {
          const response = await fetch(
            'https://lbecvdpvxjllrzrxscly.supabase.co/functions/v1/send-sms',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
              },
              body: JSON.stringify(params),
            }
          );
          const data = await response.json();
          if (!response.ok) {
            return { success: false, error: data.error || { code: 'SERVER_ERROR', message: 'SMS send failed' } };
          }
          if (data.duplicateWarning && !data.reviewRequestId) {
            return { success: true, data: { reviewRequestId: '', status: 'sent' as const, duplicateWarning: true, previousRequestDate: data.previousRequestDate } };
          }
          return { success: true, data: { reviewRequestId: data.reviewRequestId, status: data.status, duplicateWarning: data.duplicateWarning, previousRequestDate: data.previousRequestDate } };
        } catch (err: any) {
          return { success: false, error: { code: 'NETWORK_ERROR', message: err.message || 'Network error sending SMS' } };
        }
      },
    } as ServiceRegistry["sms"],
    notifications: new repos.Notification(),
    monitoring: realMonitoringService,
    analytics: realAnalyticsService,
  };
}

// ─── Global Error Handler Wiring ─────────────────────────────────────────────

function MonitoringErrorBridge() {
  const monitoring = useService("monitoring");

  useEffect(() => {
    setGlobalErrorHandler((error: Error) => {
      monitoring.captureException(error, {
        extra: { source: "react-query-mutation" },
      });
    });

    return () => {
      clearGlobalErrorHandler();
    };
  }, [monitoring]);

  return null;
}

// ─── Root Layout ─────────────────────────────────────────────────────────────

export default function RootLayout() {
  const services = useMemo(
    () => (IS_MOCK_MODE ? createMockServiceRegistry() : createRealServiceRegistry()),
    [],
  );

  const authService = IS_MOCK_MODE ? getMockAuthService() : realAuthService;
  const authState = useAuth(authService);
  const navigationRef = useNavigationContainerRef();

  // Connect monitoring to navigation state for breadcrumbs
  useEffect(() => {
    if (!navigationRef || IS_MOCK_MODE) return;

    const unsubscribe = navigationRef.addListener("state", () => {
      const currentRoute = navigationRef.getCurrentRoute() as
        | { name: string; params?: Record<string, unknown> }
        | undefined;
      if (currentRoute?.name) {
        realMonitoringService?.addBreadcrumb({
          category: "navigation",
          message: `Navigated to ${currentRoute.name}`,
          level: "info",
          data: { route: currentRoute.name, params: currentRoute.params },
        });
      }
    });

    return unsubscribe;
  }, [navigationRef]);

  if (IS_MOCK_MODE) {
    console.log("[ReviewRocket] 🧪 Running in MOCK MODE — no external services");
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ServiceProvider services={services}>
        <MonitoringErrorBridge />
        <AuthProvider value={authState}>
          {!IS_MOCK_MODE && <SentryUserSyncBridge />}
          <RootNavigator />
        </AuthProvider>
      </ServiceProvider>
    </QueryClientProvider>
  );
}

// ─── Sentry User Sync Bridge ─────────────────────────────────────────────────

function SentryUserSyncBridge() {
  useSentryUserSync();
  return null;
}

// ─── Root Navigator ──────────────────────────────────────────────────────────

function RootNavigator() {
  useProtectedRoute();
  return <Slot />;
}
