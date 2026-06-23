/**
 * Domain models for Review Rocket.
 * These types represent the core business entities.
 */

/** Subscription tier levels with corresponding SMS quotas. */
export type SubscriptionTier = 'starter' | 'growth' | 'pro';

/** Monthly SMS quotas per subscription tier. */
export const TIER_QUOTAS: Record<SubscriptionTier, number> = {
  starter: 250,
  growth: 1000,
  pro: 5000,
};

/** Business owner profile linked to an auth user. */
export interface BusinessProfile {
  id: string;
  authUserId: string;
  firstName: string;
  lastName: string;
  businessName: string;
  email: string;
  googleReviewUrl: string;
  subscriptionTier: SubscriptionTier;
  smsUsedThisPeriod: number;
  billingPeriodStart: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Status lifecycle for a review request SMS. */
export type ReviewRequestStatus =
  | 'sent'
  | 'delivered'
  | 'rating_received'
  | 'feedback_received'
  | 'failed'
  | 'expired';

/** A single SMS feedback request sent to a customer. */
export interface ReviewRequest {
  id: string;
  businessId: string;
  customerPhone: string;
  customerName?: string;
  serviceType?: string;
  status: ReviewRequestStatus;
  rating?: number;
  sentAt: Date;
  feedbackReceivedAt?: Date;
  createdAt: Date;
}

/** A customer's rating and optional written feedback. */
export interface FeedbackRecord {
  id: string;
  reviewRequestId: string;
  businessId: string;
  rating: number;
  feedbackText?: string;
  isResolved: boolean;
  resolvedAt?: Date;
  createdAt: Date;
}

/** Event types tracked in the audit log. */
export type AuditEventType =
  | 'login'
  | 'sms_sent'
  | 'feedback_received'
  | 'feedback_resolved'
  | 'record_deleted';

/** A single audit log entry for security and compliance. */
export interface AuditLogEntry {
  id: string;
  actorId: string;
  eventType: AuditEventType;
  resourceId: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/** Aggregated metrics displayed on the Dashboard. */
export interface DashboardMetrics {
  reviewOpportunities: number;
  monthOverMonthChange: number | null; // null = N/A (previous month had zero requests)
  positiveResponses: number;
  needsAttention: number;
  requestsSent: number;
  responseRate: number | null; // null = no requests sent yet
}

/** A single item in the Recent Activity Feed. */
export interface ActivityItem {
  id: string;
  customerName?: string;
  rating: number;
  createdAt: Date;
}
