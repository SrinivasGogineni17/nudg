/**
 * DashboardMetrics component.
 * Displays the primary "Review Opportunities Created" card and
 * three metric boxes (Positive Responses, Needs Attention, Requests Sent).
 *
 * Requirements: 5.2, 5.3, 5.4
 */

import React from 'react';
import { View, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { DashboardMetrics as DashboardMetricsData } from '@/types';

export interface DashboardMetricsProps {
  metrics: DashboardMetricsData;
}

export function DashboardMetrics({ metrics }: DashboardMetricsProps) {
  const {
    reviewOpportunities,
    monthOverMonthChange,
    positiveResponses,
    needsAttention,
    responseRate,
  } = metrics;

  // Format month-over-month display
  const momDisplay =
    monthOverMonthChange === null
      ? 'N/A'
      : `${monthOverMonthChange >= 0 ? '+' : ''}${monthOverMonthChange}%`;

  const momColor =
    monthOverMonthChange === null
      ? 'text-navy/50'
      : monthOverMonthChange >= 0
        ? 'text-success-green'
        : 'text-red-500';

  return (
    <View>
      {/* Primary Card — Review Opportunities Created */}
      <View className="bg-white rounded-2xl p-5 mb-4 shadow-sm shadow-black/5 border border-light-gray">
        <Text className="text-caption font-medium text-navy/60 uppercase tracking-wide mb-2">
          Review Opportunities Created
        </Text>
        <View className="flex-row items-end justify-between">
          <View>
            <Text className="text-[40px] font-bold text-navy leading-tight">
              {reviewOpportunities}
            </Text>
            <Text className="text-caption text-navy/50 mt-1">
              {reviewOpportunities === 1 ? '1 this month' : `${reviewOpportunities} this month`}
            </Text>
          </View>
          <View className="flex-row items-center bg-card-bg rounded-xl px-3 py-1.5">
            {monthOverMonthChange !== null && (
              <Ionicons
                name={monthOverMonthChange >= 0 ? 'trending-up' : 'trending-down'}
                size={14}
                color={monthOverMonthChange >= 0 ? '#22C55E' : '#EF4444'}
                style={{ marginRight: 4 }}
              />
            )}
            <Text className={`text-caption font-semibold ${momColor}`}>
              {momDisplay} vs last month
            </Text>
          </View>
        </View>
      </View>

      {/* Three Metric Boxes Row */}
      <View className="flex-row gap-3">
        {/* Positive Responses */}
        <View className="flex-1 bg-white rounded-2xl p-4 border border-light-gray">
          <View className="w-8 h-8 rounded-full bg-success-green/10 items-center justify-center mb-2">
            <Ionicons name="thumbs-up" size={16} color="#22C55E" />
          </View>
          <Text className="text-[22px] font-bold text-navy">
            {positiveResponses}
          </Text>
          <Text className="text-caption text-navy/50 mt-0.5">
            Positive{'\n'}Responses
          </Text>
        </View>

        {/* Needs Attention */}
        <View className="flex-1 bg-white rounded-2xl p-4 border border-light-gray">
          <View className="w-8 h-8 rounded-full bg-orange-100 items-center justify-center mb-2">
            <Ionicons name="alert-circle" size={16} color="#F97316" />
          </View>
          <Text className="text-[22px] font-bold text-navy">
            {needsAttention}
          </Text>
          <Text className="text-caption text-navy/50 mt-0.5">
            Needs{'\n'}Attention
          </Text>
        </View>

        {/* Response Rate */}
        <View className="flex-1 bg-white rounded-2xl p-4 border border-light-gray">
          <View className="w-8 h-8 rounded-full bg-blue-100 items-center justify-center mb-2">
            <Ionicons name="pulse" size={16} color="#3B82F6" />
          </View>
          <Text className="text-[22px] font-bold text-navy">
            {responseRate === null ? '\u2014' : `${responseRate}%`}
          </Text>
          <Text className="text-caption text-navy/50 mt-0.5">
            Response{'\n'}Rate
          </Text>
        </View>
      </View>
    </View>
  );
}

