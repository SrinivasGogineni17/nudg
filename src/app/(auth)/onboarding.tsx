/**
 * Onboarding walkthrough screen.
 * Shows a 3-page swipeable intro after email verification, followed by
 * plan selection. Only shown once (flag stored in AsyncStorage).
 *
 * UX Improvements: Onboarding Flow, Plan Selection During Onboarding
 */

import { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useService } from '@/services';
import { useBusinessProfile } from '@/features/inbox/hooks/useBusinessProfile';
import { type SubscriptionTier, TIER_QUOTAS } from '@/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const ONBOARDING_COMPLETE_KEY = '@review_rocket/onboarding_complete';

interface OnboardingPage {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}

const PAGES: OnboardingPage[] = [
  {
    id: '1',
    icon: 'chatbubble-ellipses-outline',
    title: 'Send a Text',
    description:
      "After every job, enter your customer's phone number. We'll send them a friendly feedback request.",
  },
  {
    id: '2',
    icon: 'star-outline',
    title: 'Collect Ratings',
    description:
      'Customers reply with a simple 1-5 rating via text. No app download needed.',
  },
  {
    id: '3',
    icon: 'trending-up-outline',
    title: 'Grow Your Reviews',
    description:
      'Happy customers get your Google review link. Unhappy ones come directly to you.',
  },
];

// ─── Plan Selection Data ─────────────────────────────────────────────────────

interface PlanOption {
  tier: SubscriptionTier;
  name: string;
  price: string;
  smsLimit: number;
  recommended?: boolean;
  trialBadge?: string;
}

const PLANS: PlanOption[] = [
  {
    tier: 'starter',
    name: 'Starter',
    price: '$9.99/mo',
    smsLimit: TIER_QUOTAS.starter,
  },
  {
    tier: 'growth',
    name: 'Growth',
    price: '$29.99/mo',
    smsLimit: TIER_QUOTAS.growth,
    recommended: true,
    trialBadge: '14-day free trial',
  },
  {
    tier: 'pro',
    name: 'Pro',
    price: '$79.99/mo',
    smsLimit: TIER_QUOTAS.pro,
  },
];

// ─── Onboarding Screen ───────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showPlanSelection, setShowPlanSelection] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const businessProfileRepo = useService('businessProfile');
  const { data: profile, refetch: refetchProfile } = useBusinessProfile();

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleNext = () => {
    if (currentIndex < PAGES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    } else {
      // Last page — show plan selection
      setShowPlanSelection(true);
    }
  };

  const handleSelectPlan = async (tier: SubscriptionTier) => {
    // Save selected tier to mock business profile
    if (profile?.id) {
      await businessProfileRepo.updateSubscriptionTier(profile.id, tier);
      await refetchProfile();
    }
    await completeOnboarding();
  };

  const completeOnboarding = async () => {
    await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    router.replace('/(tabs)');
  };

  // ─── Plan Selection View ──────────────────────────────────────────────────

  if (showPlanSelection) {
    return (
      <SafeAreaView className="flex-1 bg-card-bg" edges={['top', 'bottom']}>
        <View className="flex-1 px-5 pt-8">
          <Text className="text-heading font-bold text-navy text-center mb-2">
            Choose Your Plan
          </Text>
          <Text className="text-body text-navy/60 text-center mb-8">
            Start growing your reviews today.
          </Text>

          {/* Plan Cards */}
          {PLANS.map((plan) => (
            <View
              key={plan.tier}
              className={`rounded-2xl border p-5 mb-4 ${
                plan.recommended
                  ? 'border-rocket-orange bg-rocket-orange/5'
                  : 'border-light-gray bg-white'
              }`}
            >
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center">
                  <Text
                    className={`text-body font-bold ${
                      plan.recommended ? 'text-rocket-orange' : 'text-navy'
                    }`}
                  >
                    {plan.name}
                  </Text>
                  {plan.trialBadge && (
                    <View className="ml-2 bg-rocket-orange/10 px-2 py-0.5 rounded-full">
                      <Text className="text-caption font-semibold text-rocket-orange">
                        {plan.trialBadge}
                      </Text>
                    </View>
                  )}
                </View>
                <Text className="text-body font-bold text-navy">{plan.price}</Text>
              </View>
              <View className="flex-row items-center mb-3">
                <Ionicons
                  name="chatbubble-outline"
                  size={14}
                  color={plan.recommended ? '#FF6B35' : '#6B7280'}
                />
                <Text
                  className={`text-caption ml-2 ${
                    plan.recommended ? 'text-rocket-orange/80' : 'text-navy/60'
                  }`}
                >
                  {plan.smsLimit.toLocaleString()} SMS messages per month
                </Text>
              </View>

              {plan.recommended && (
                <Pressable
                  onPress={() => handleSelectPlan(plan.tier)}
                  className="bg-rocket-orange rounded-xl py-3 items-center active:opacity-80"
                  accessibilityRole="button"
                  accessibilityLabel="Start Free Trial"
                >
                  <Text className="text-caption font-bold text-white">
                    Start Free Trial
                  </Text>
                </Pressable>
              )}
            </View>
          ))}

          {/* Secondary option */}
          <Pressable
            onPress={() => handleSelectPlan('starter')}
            className="mt-4 py-3 items-center"
            accessibilityRole="button"
            accessibilityLabel="Start with Starter"
          >
            <Text className="text-body font-medium text-navy/60">
              Start with Starter
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Walkthrough View ─────────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-card-bg" edges={['top', 'bottom']}>
      <FlatList
        ref={flatListRef}
        data={PAGES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <View
            style={{ width }}
            className="flex-1 items-center justify-center px-8"
          >
            <View className="w-24 h-24 rounded-full bg-rocket-orange/10 items-center justify-center mb-8">
              <Ionicons name={item.icon} size={48} color="#FF6B35" />
            </View>
            <Text className="text-heading font-bold text-navy text-center mb-4">
              {item.title}
            </Text>
            <Text className="text-body text-navy/70 text-center px-4">
              {item.description}
            </Text>
          </View>
        )}
      />

      {/* Pagination Dots */}
      <View className="flex-row items-center justify-center mb-6">
        {PAGES.map((_, i) => (
          <View
            key={i}
            className={`w-2 h-2 rounded-full mx-1 ${
              i === currentIndex ? 'bg-rocket-orange' : 'bg-light-gray'
            }`}
          />
        ))}
      </View>

      {/* Action Button */}
      <View className="px-5 pb-6">
        <Pressable
          onPress={handleNext}
          className="bg-rocket-orange rounded-2xl py-4 items-center active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel={currentIndex === PAGES.length - 1 ? 'Get Started' : 'Next'}
        >
          <Text className="text-body font-bold text-white">
            {currentIndex === PAGES.length - 1 ? 'Get Started' : 'Next'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
