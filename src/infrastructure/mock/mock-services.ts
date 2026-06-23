/**
 * Mock service implementations for local development without external services.
 * Returns realistic test data so the UI can be explored without Supabase, Twilio, etc.
 */

import type { ServiceRegistry } from '@/services';
import type { IAuthService } from '@/services/interfaces/auth.service';
import type {
  IReviewRequestRepository,
  IFeedbackRepository,
  IBusinessProfileRepository,
} from '@/services/interfaces/database.service';
import type { ISmsService } from '@/services/interfaces/sms.service';
import type { INotificationService } from '@/services/interfaces/notification.service';
import type { IMonitoringService } from '@/services/interfaces/monitoring.service';
import type { IAnalyticsService } from '@/services/interfaces/analytics.service';
import type {
  Result,
  AuthUser,
  AuthSession,
  SignUpParams,
  SignInParams,
  Unsubscribe,
  ReviewRequest,
  FeedbackRecord,
  BusinessProfile,
  SubscriptionTier,
  CreateReviewRequestDTO,
  SendSmsParams,
  SmsDeliveryResult,
  CreateFeedbackDTO,
  NotificationPermissionStatus,
  AppNotification,
} from '@/types';
import { TIER_QUOTAS } from '@/types';

// ─── Fake Data ───────────────────────────────────────────────────────────────

const FAKE_USER_ID = 'test-user-123';
const FAKE_BUSINESS_ID = 'biz-001';
const FAKE_EMAIL = 'alex@smithplumbing.com';

const FAKE_SESSION: AuthSession = {
  user: {
    id: FAKE_USER_ID,
    email: FAKE_EMAIL,
    emailVerified: true,
  },
  accessToken: 'mock-access-token-xyz',
  refreshToken: 'mock-refresh-token-xyz',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};

const FAKE_BUSINESS_PROFILE: BusinessProfile = {
  id: FAKE_BUSINESS_ID,
  authUserId: FAKE_USER_ID,
  firstName: 'Alex',
  lastName: 'Smith',
  businessName: 'Smith Plumbing Co.',
  email: FAKE_EMAIL,
  googleReviewUrl: 'https://google.com/maps/place/smith-plumbing',
  subscriptionTier: 'growth',
  smsUsedThisPeriod: 23,
  billingPeriodStart: new Date('2024-01-01'),
  createdAt: new Date('2023-06-15'),
  updatedAt: new Date('2024-01-10'),
};

function generateFakeReviewRequests(): ReviewRequest[] {
  const customers = [
    { name: 'Sarah Johnson', rating: 5, status: 'rating_received' as const },
    { name: 'Mike Davis', rating: 4, status: 'rating_received' as const },
    { name: 'Emily Thompson', rating: 2, status: 'feedback_received' as const },
    { name: 'John Williams', rating: 5, status: 'rating_received' as const },
    { name: 'Lisa Chen', rating: 1, status: 'feedback_received' as const },
    { name: 'Robert Garcia', rating: 5, status: 'rating_received' as const },
    { name: 'Amanda Foster', rating: 3, status: 'rating_received' as const },
    { name: 'David Park', rating: 4, status: 'rating_received' as const },
  ];

  return customers.map((c, i) => ({
    id: `rr-${String(i + 1).padStart(3, '0')}`,
    businessId: FAKE_BUSINESS_ID,
    customerPhone: `+1555010${String(i).padStart(4, '0')}`,
    customerName: c.name,
    serviceType: ['Plumbing Repair', 'Drain Cleaning', 'Water Heater Install', 'Pipe Replacement'][i % 4],
    status: c.status,
    rating: c.rating,
    sentAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000),
    feedbackReceivedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
    createdAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000),
  }));
}

function generateFakeFeedbackRecords(): FeedbackRecord[] {
  return [
    {
      id: 'fb-001',
      reviewRequestId: 'rr-003',
      businessId: FAKE_BUSINESS_ID,
      rating: 2,
      feedbackText: "Technician arrived late and I wasn't updated.",
      isResolved: false,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
    {
      id: 'fb-002',
      reviewRequestId: 'rr-005',
      businessId: FAKE_BUSINESS_ID,
      rating: 1,
      feedbackText: 'Pricing was higher than expected.',
      isResolved: false,
      createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    },
    {
      id: 'fb-003',
      reviewRequestId: 'rr-007',
      businessId: FAKE_BUSINESS_ID,
      rating: 3,
      feedbackText: 'Work was fine but communication could be better.',
      isResolved: true,
      resolvedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    },
    {
      id: 'fb-004',
      reviewRequestId: 'rr-008',
      businessId: FAKE_BUSINESS_ID,
      rating: 2,
      feedbackText: 'Had to call back for a follow-up repair.',
      isResolved: true,
      resolvedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    },
  ];
}

// ─── Mock Auth Service ───────────────────────────────────────────────────────

class MockAuthService implements IAuthService {
  private _session: AuthSession | null = FAKE_SESSION;
  private _listeners: Array<(session: AuthSession | null) => void> = [];

  async signUp(_params: SignUpParams): Promise<Result<AuthUser>> {
    return {
      success: true,
      data: { id: FAKE_USER_ID, email: FAKE_EMAIL, emailVerified: true },
    };
  }

  async signIn(_params: SignInParams): Promise<Result<AuthSession>> {
    this._session = FAKE_SESSION;
    this._notifyListeners();
    return { success: true, data: FAKE_SESSION };
  }

  async signOut(): Promise<Result<void>> {
    this._session = null;
    this._notifyListeners();
    return { success: true, data: undefined };
  }

  async refreshSession(): Promise<Result<AuthSession>> {
    return { success: true, data: FAKE_SESSION };
  }

  async requestPasswordReset(_email: string): Promise<Result<void>> {
    return { success: true, data: undefined };
  }

  async getSession(): Promise<AuthSession | null> {
    return this._session;
  }

  onAuthStateChange(callback: (session: AuthSession | null) => void): Unsubscribe {
    this._listeners.push(callback);
    // Fire immediately with current session (mimics Supabase behavior)
    setTimeout(() => callback(this._session), 0);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== callback);
    };
  }

  private _notifyListeners(): void {
    for (const listener of this._listeners) {
      listener(this._session);
    }
  }
}

// ─── Mock Business Profile Repository ────────────────────────────────────────

class MockBusinessProfileRepository implements IBusinessProfileRepository {
  private _profile = { ...FAKE_BUSINESS_PROFILE };

  async getByOwnerId(_ownerId: string): Promise<Result<BusinessProfile>> {
    return { success: true, data: { ...this._profile } };
  }

  async updateSubscriptionTier(
    _businessId: string,
    tier: SubscriptionTier,
  ): Promise<Result<BusinessProfile>> {
    this._profile.subscriptionTier = tier;
    this._profile.updatedAt = new Date();
    return { success: true, data: { ...this._profile } };
  }

  async incrementSmsUsage(_businessId: string): Promise<Result<number>> {
    this._profile.smsUsedThisPeriod += 1;
    return { success: true, data: this._profile.smsUsedThisPeriod };
  }

  async resetSmsUsage(_businessId: string): Promise<Result<void>> {
    this._profile.smsUsedThisPeriod = 0;
    return { success: true, data: undefined };
  }

  async getSmsUsage(_businessId: string): Promise<Result<{ used: number; quota: number }>> {
    return {
      success: true,
      data: {
        used: this._profile.smsUsedThisPeriod,
        quota: TIER_QUOTAS[this._profile.subscriptionTier],
      },
    };
  }
}

// ─── Mock Review Request Repository ──────────────────────────────────────────

class MockReviewRequestRepository implements IReviewRequestRepository {
  private _requests = generateFakeReviewRequests();

  async create(request: CreateReviewRequestDTO): Promise<Result<ReviewRequest>> {
    const newRequest: ReviewRequest = {
      id: `rr-${Date.now()}`,
      businessId: request.businessId,
      customerPhone: request.customerPhone,
      customerName: request.customerName,
      serviceType: request.serviceType,
      status: 'sent',
      sentAt: new Date(),
      createdAt: new Date(),
    };
    this._requests.unshift(newRequest);
    return { success: true, data: newRequest };
  }

  async findByPhoneNumberWithin24Hours(
    _phone: string,
    _businessId: string,
  ): Promise<Result<ReviewRequest | null>> {
    return { success: true, data: null };
  }

  async getRecentByBusiness(_businessId: string, limit: number): Promise<Result<ReviewRequest[]>> {
    return { success: true, data: this._requests.slice(0, limit) };
  }

  async getMonthlyCount(_businessId: string, _monthStart: Date): Promise<Result<number>> {
    return { success: true, data: 17 };
  }

  async getPreviousMonthCount(
    _businessId: string,
    _prevMonthStart: Date,
    _prevMonthEnd: Date,
  ): Promise<Result<number>> {
    return { success: true, data: 12 };
  }

  async updateWithRating(id: string, rating: number): Promise<Result<ReviewRequest>> {
    const request = this._requests.find((r) => r.id === id);
    if (request) {
      request.rating = rating;
      request.status = 'rating_received';
      request.feedbackReceivedAt = new Date();
    }
    return {
      success: true,
      data: request ?? { ...this._requests[0], id, rating },
    };
  }
}

// ─── Mock Feedback Repository ────────────────────────────────────────────────

class MockFeedbackRepository implements IFeedbackRepository {
  private _records = generateFakeFeedbackRecords();

  async create(feedback: CreateFeedbackDTO): Promise<Result<FeedbackRecord>> {
    const newRecord: FeedbackRecord = {
      id: `fb-${Date.now()}`,
      reviewRequestId: feedback.reviewRequestId,
      businessId: feedback.businessId,
      rating: feedback.rating,
      feedbackText: feedback.feedbackText,
      isResolved: false,
      createdAt: new Date(),
    };
    this._records.unshift(newRecord);
    return { success: true, data: newRecord };
  }

  async getUnresolved(_businessId: string): Promise<Result<FeedbackRecord[]>> {
    return {
      success: true,
      data: this._records.filter((r) => !r.isResolved),
    };
  }

  async getAll(_businessId: string): Promise<Result<FeedbackRecord[]>> {
    return { success: true, data: [...this._records] };
  }

  async markResolved(id: string): Promise<Result<FeedbackRecord>> {
    const record = this._records.find((r) => r.id === id);
    if (record) {
      record.isResolved = true;
      record.resolvedAt = new Date();
    }
    return {
      success: true,
      data: record ?? { ...this._records[0], id, isResolved: true, resolvedAt: new Date() },
    };
  }

  async updateFeedbackText(id: string, text: string): Promise<Result<FeedbackRecord>> {
    const record = this._records.find((r) => r.id === id);
    if (record) {
      record.feedbackText = text;
    }
    return {
      success: true,
      data: record ?? { ...this._records[0], id, feedbackText: text },
    };
  }

  async getUnresolvedCount(_businessId: string): Promise<Result<number>> {
    return {
      success: true,
      data: this._records.filter((r) => !r.isResolved).length,
    };
  }
}

// ─── Mock SMS Service ────────────────────────────────────────────────────────

class MockSmsService implements ISmsService {
  private _sentNumbers = new Map<string, string>(); // phone → ISO date

  async sendFeedbackRequest(params: SendSmsParams): Promise<Result<SmsDeliveryResult>> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const normalizedPhone = params.phoneNumber.replace(/\D/g, '');

    // Check if we've already sent to this number (simulate duplicate detection)
    const previousDate = this._sentNumbers.get(normalizedPhone);
    if (previousDate) {
      return {
        success: true,
        data: {
          reviewRequestId: `rr-${Date.now()}`,
          status: 'sent',
          duplicateWarning: true,
          previousRequestDate: previousDate,
        },
      };
    }

    // Record this send
    this._sentNumbers.set(normalizedPhone, new Date().toISOString());

    return {
      success: true,
      data: {
        reviewRequestId: `rr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        status: 'sent',
      },
    };
  }
}

// ─── Mock Notification Service ───────────────────────────────────────────────

class MockNotificationService implements INotificationService {
  async registerDevice(_token: string, _userId: string): Promise<Result<void>> {
    console.log('[MockNotifications] registerDevice called');
    return { success: true, data: undefined };
  }

  async requestPermission(): Promise<NotificationPermissionStatus> {
    console.log('[MockNotifications] requestPermission called');
    return 'granted';
  }

  async getPermissionStatus(): Promise<NotificationPermissionStatus> {
    return 'granted';
  }

  onNotificationReceived(_callback: (notification: AppNotification) => void): Unsubscribe {
    // No-op in mock mode
    return () => {};
  }
}

// ─── Mock Monitoring Service ─────────────────────────────────────────────────

class MockMonitoringService implements IMonitoringService {
  captureException(error: Error, context?: Record<string, unknown>): void {
    console.log('[MockMonitoring] captureException:', error.message, context);
  }

  setUser(userId: string): void {
    console.log('[MockMonitoring] setUser:', userId);
  }

  clearUser(): void {
    console.log('[MockMonitoring] clearUser');
  }

  addBreadcrumb(breadcrumb: { category: string; message: string }): void {
    console.log('[MockMonitoring] breadcrumb:', breadcrumb.category, breadcrumb.message);
  }
}

// ─── Mock Analytics Service ──────────────────────────────────────────────────

class MockAnalyticsService implements IAnalyticsService {
  trackEvent(event: { name: string; properties?: Record<string, unknown> }): void {
    console.log('[MockAnalytics] trackEvent:', event.name, event.properties);
  }

  trackScreenView(screenName: string): void {
    console.log('[MockAnalytics] trackScreenView:', screenName);
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    console.log('[MockAnalytics] identify:', userId, traits);
  }

  reset(): void {
    console.log('[MockAnalytics] reset');
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Singleton mock auth service so useAuth and ServiceProvider share the same instance. */
const mockAuthService = new MockAuthService();

/**
 * Creates a complete ServiceRegistry with mock implementations.
 * All services return realistic test data and succeed immediately.
 */
export function createMockServiceRegistry(): ServiceRegistry {
  return {
    auth: mockAuthService,
    reviewRequests: new MockReviewRequestRepository(),
    feedback: new MockFeedbackRepository(),
    businessProfile: new MockBusinessProfileRepository(),
    sms: new MockSmsService(),
    notifications: new MockNotificationService(),
    monitoring: new MockMonitoringService(),
    analytics: new MockAnalyticsService(),
  };
}

/**
 * Returns the singleton mock auth service instance.
 * Used for the useAuth hook which needs the same instance as the registry.
 */
export function getMockAuthService(): IAuthService {
  return mockAuthService;
}
