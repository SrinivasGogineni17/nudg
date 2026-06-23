/**
 * API request/response DTOs for Review Rocket.
 * These types define the contract between the app and backend services.
 */

import type { SubscriptionTier } from './domain';

// ─── Auth DTOs ───────────────────────────────────────────────────────────────

/** Parameters for creating a new business owner account. */
export interface SignUpParams {
  firstName: string;
  lastName: string;
  businessName: string;
  email: string;
  password: string;
  googleReviewUrl: string;
}

/** Parameters for logging in an existing user. */
export interface SignInParams {
  email: string;
  password: string;
}

/** Authenticated user identity returned after signup or session restore. */
export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

/** Active auth session containing tokens and user identity. */
export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
}

/** Callback unsubscribe function type. */
export type Unsubscribe = () => void;

// ─── Review Request DTOs ─────────────────────────────────────────────────────

/** DTO for creating a new review request record. */
export interface CreateReviewRequestDTO {
  businessId: string;
  customerPhone: string;
  customerName?: string;
  serviceType?: string;
}

/** Parameters for sending a feedback request SMS via the Edge Function. */
export interface SendSmsParams {
  phoneNumber: string;
  customerName?: string;
  serviceType?: string;
  businessId: string;
}

/** Result returned from the SMS sending operation. */
export interface SmsDeliveryResult {
  reviewRequestId: string;
  status: 'sent' | 'queued';
  duplicateWarning?: boolean;
  /** ISO date string of the previous request to this number (when duplicateWarning is true). */
  previousRequestDate?: string;
}

// ─── Feedback DTOs ───────────────────────────────────────────────────────────

/** DTO for creating a new feedback record. */
export interface CreateFeedbackDTO {
  reviewRequestId: string;
  businessId: string;
  rating: number;
  feedbackText?: string;
}

// ─── Notification DTOs ───────────────────────────────────────────────────────

/** Push notification permission status. */
export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

/** App notification payload received on the device. */
export interface AppNotification {
  id: string;
  title: string;
  body: string;
  data?: {
    type: 'negative_rating' | 'written_feedback' | 'quota_warning' | 'sms_failed';
    feedbackId?: string;
    reviewRequestId?: string;
  };
  receivedAt: Date;
}

// ─── Subscription DTOs ───────────────────────────────────────────────────────

/** Parameters for updating a subscription tier after IAP confirmation. */
export interface UpdateSubscriptionParams {
  businessId: string;
  tier: SubscriptionTier;
  transactionId: string;
}
