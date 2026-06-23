/**
 * Hook to fetch dashboard metrics for the current calendar month.
 * Fetches review opportunities, month-over-month change, positive responses,
 * needs attention count, and total requests sent.
 *
 * Requirements: 5.2, 5.3, 5.4
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useService } from '@/services';
import { useBusinessProfile } from '@/features/inbox/hooks/useBusinessProfile';
import { calculateMonthOverMonth } from '@/utils/metrics';
import type { DashboardMetrics } from '@/types';

function getMonthBoundaries() {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return { currentMonthStart, prevMonthStart, prevMonthEnd };
}

export function useDashboardMetrics() {
  const reviewRequestRepo = useService('reviewRequests');
  const feedbackRepo = useService('feedback');
  const { data: profile } = useBusinessProfile();
  const businessId = profile?.id;

  return useQuery<DashboardMetrics>({
    queryKey: ['dashboard-metrics', businessId],
    queryFn: async () => {
      if (!businessId) {
        return {
          reviewOpportunities: 0,
          monthOverMonthChange: null,
          positiveResponses: 0,
          needsAttention: 0,
          requestsSent: 0,
          responseRate: null,
        };
      }

      const { currentMonthStart, prevMonthStart, prevMonthEnd } = getMonthBoundaries();

      // Fetch current month count (review opportunities = requests sent this month)
      const currentCountResult = await reviewRequestRepo.getMonthlyCount(businessId, currentMonthStart);
      const currentCount = currentCountResult.success ? currentCountResult.data : 0;

      // Fetch previous month count for comparison
      const prevCountResult = await reviewRequestRepo.getPreviousMonthCount(
        businessId,
        prevMonthStart,
        prevMonthEnd,
      );
      const prevCount = prevCountResult.success ? prevCountResult.data : 0;

      // Calculate month-over-month change
      const monthOverMonthChange = calculateMonthOverMonth(currentCount, prevCount);

      // Get feedback records to compute positive/needs attention
      const feedbackResult = await feedbackRepo.getAll(businessId);
      const allFeedback = feedbackResult.success ? feedbackResult.data : [];

      // Filter feedback for current month
      const currentMonthFeedback = allFeedback.filter(
        (f) => new Date(f.createdAt) >= currentMonthStart,
      );

      const positiveResponses = currentMonthFeedback.filter((f) => f.rating >= 4).length;
      const needsAttention = currentMonthFeedback.filter((f) => f.rating <= 3).length;

      // Calculate response rate: (total responses / total requests sent) * 100
      const totalResponses = currentMonthFeedback.length;
      const responseRate = currentCount > 0
        ? Math.round((totalResponses / currentCount) * 100)
        : null;

      return {
        reviewOpportunities: currentCount,
        monthOverMonthChange,
        positiveResponses,
        needsAttention,
        requestsSent: currentCount,
        responseRate,
      };
    },
    enabled: !!businessId,
    staleTime: 30_000, // 30 seconds
  });
}

