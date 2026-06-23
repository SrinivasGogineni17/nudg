/**
 * Customer History screen.
 * Shows ALL review requests (not just the last 10) sorted by most recent first.
 * Each row displays: customer name, rating (if replied), status, and date.
 *
 * UX Improvement: Customer History Screen (View All)
 */

import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useService } from '@/services';
import { useBusinessProfile } from '@/features/inbox/hooks/useBusinessProfile';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import type { ReviewRequest } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getStatusLabel(request: ReviewRequest): { text: string; color: string } {
  if (request.rating != null) {
    return { text: 'Replied', color: 'text-success-green' };
  }
  if (request.status === 'sent' || request.status === 'delivered') {
    return { text: 'Sent', color: 'text-navy/50' };
  }
  if (request.status === 'expired') {
    return { text: 'No response', color: 'text-navy/40' };
  }
  if (request.status === 'failed') {
    return { text: 'Failed', color: 'text-red-500' };
  }
  return { text: 'Sent', color: 'text-navy/50' };
}

function renderStars(rating: number) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Ionicons
        key={i}
        name={i <= rating ? 'star' : 'star-outline'}
        size={14}
        color={rating >= 4 ? '#22C55E' : '#F97316'}
      />,
    );
  }
  return stars;
}

// ─── History Screen ──────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const reviewRequestRepo = useService('reviewRequests');
  const { data: profile } = useBusinessProfile();
  const businessId = profile?.id;

  const { data: requests, isLoading } = useQuery<ReviewRequest[]>({
    queryKey: ['all-review-requests', businessId],
    queryFn: async () => {
      if (!businessId) return [];
      const result = await reviewRequestRepo.getRecentByBusiness(businessId, 100);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      // Sort by most recent first
      return [...result.data].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
    enabled: !!businessId,
    staleTime: 30_000,
  });

  const allRequests = requests ?? [];

  return (
    <SafeAreaView className="flex-1 bg-card-bg" edges={['top']}>
      {/* Header with back button */}
      <View className="flex-row items-center px-5 pt-4 pb-4">
        <Pressable
          onPress={() => router.back()}
          className="mr-3 p-2"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color="#0B1736" />
        </Pressable>
        <Text className="text-heading font-bold text-navy flex-1">
          Request History
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <LoadingIndicator size="large" />
        </View>
      ) : allRequests.length === 0 ? (
        <View className="flex-1 items-center justify-center px-5">
          <View className="bg-white rounded-2xl p-6 border border-light-gray items-center">
            <Ionicons name="document-text-outline" size={32} color="#E5E7EB" />
            <Text className="text-body text-navy/40 mt-3 text-center">
              No requests yet
            </Text>
            <Text className="text-caption text-navy/30 mt-1 text-center">
              Send your first review request to see history here
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pb-12"
          showsVerticalScrollIndicator={false}
        >
          <View className="bg-white rounded-2xl border border-light-gray overflow-hidden">
            {allRequests.map((request, index) => {
              const status = getStatusLabel(request);
              return (
                <View
                  key={request.id}
                  className={`flex-row items-center px-4 py-3 ${
                    index < allRequests.length - 1 ? 'border-b border-light-gray' : ''
                  }`}
                >
                  {/* Customer Avatar */}
                  <View className="w-9 h-9 rounded-full bg-card-bg items-center justify-center mr-3">
                    <Ionicons name="person" size={18} color="#9CA3AF" />
                  </View>

                  {/* Customer Info */}
                  <View className="flex-1">
                    <Text className="text-body font-medium text-navy" numberOfLines={1}>
                      {request.customerName || 'Customer'}
                    </Text>
                    <View className="flex-row items-center mt-0.5">
                      {request.rating != null ? (
                        <View className="flex-row items-center">
                          {renderStars(request.rating)}
                        </View>
                      ) : (
                        <Text className={`text-caption ${status.color}`}>
                          {status.text}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Date */}
                  <Text className="text-caption text-navy/40">
                    {formatDate(request.createdAt)}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
