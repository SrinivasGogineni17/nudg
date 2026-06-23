import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { sendRequestSchema, type SendRequestFormData } from '@/types/schemas';
import { ErrorCode } from '@/types';
import type { AppError } from '@/types';
import { useService } from '@/services';
import { formatPhoneNumber, normalizePhoneNumber } from '@/utils/phone';
import { withRetry } from '@/utils/retry';
import { useBusinessProfile } from '@/features/inbox/hooks/useBusinessProfile';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { SuccessIndicator } from '@/components/ui/SuccessIndicator';
import { ErrorIndicator } from '@/components/ui/ErrorIndicator';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SuccessState {
  phoneNumber: string;
  customerName?: string;
  serviceType?: string;
}

// ─── Send Request Screen ─────────────────────────────────────────────────────

/**
 * Send Review Request screen.
 *
 * Allows the business owner to send an SMS feedback request to a customer.
 * Uses React Hook Form with Zod validation. Auto-formats phone numbers
 * to (XXX) XXX-XXXX as the user types.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9, 8.3
 */
export default function SendRequestScreen() {
  const smsService = useService('sms');
  const { data: profile } = useBusinessProfile();
  const businessId = profile?.id;

  const [isSending, setIsSending] = useState(false);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSubmittedData, setLastSubmittedData] =
    useState<SendRequestFormData | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<SendRequestFormData>({
    resolver: zodResolver(sendRequestSchema),
    defaultValues: {
      phoneNumber: '',
      customerName: '',
      serviceType: '',
    },
    mode: 'onChange',
  });

  const phoneValue = watch('phoneNumber');
  const isPhoneValid = phoneValue
    ? normalizePhoneNumber(phoneValue).length === 10
    : false;

  // ─── Phone Auto-formatting ───────────────────────────────────────────────

  const handlePhoneChange = useCallback(
    (text: string, onChange: (value: string) => void) => {
      // Extract digits only
      const digits = text.replace(/\D/g, '');

      // Auto-format as user types
      let formatted = '';
      if (digits.length === 0) {
        formatted = '';
      } else if (digits.length <= 3) {
        formatted = `(${digits}`;
      } else if (digits.length <= 6) {
        formatted = `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
      } else {
        formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
      }

      onChange(formatted);
    },
    [],
  );

  // ─── Send Handler ────────────────────────────────────────────────────────

  const sendRequest = useCallback(
    async (data: SendRequestFormData, force = false) => {
      if (!businessId) {
        setErrorMessage('Business profile not loaded. Please try again.');
        return;
      }

      setIsSending(true);
      setErrorMessage(null);
      setLastSubmittedData(data);

      const result = await withRetry(() =>
        smsService.sendFeedbackRequest({
          phoneNumber: data.phoneNumber,
          customerName: data.customerName || undefined,
          serviceType: data.serviceType || undefined,
          businessId,
        }),
      );

      setIsSending(false);

      if (result.success) {
        // Check for duplicate warning — show dialog with the specific date
        if (result.data.duplicateWarning && !force) {
          const previousDate = result.data.previousRequestDate
            ? new Date(result.data.previousRequestDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })
            : 'recently';

          Alert.alert(
            'Previous Request Found',
            `You've already requested feedback from this customer on ${previousDate}.\n\nAre you sure you want to send another request?`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Send Anyway',
                style: 'destructive',
                onPress: () => sendRequest(data, true),
              },
            ],
          );
          return;
        }

        // Show success confirmation
        setSuccessState({
          phoneNumber: formatPhoneNumber(data.phoneNumber),
          customerName: data.customerName || undefined,
          serviceType: data.serviceType || undefined,
        });
        reset();
      } else {
        const error = result.error as AppError;

        if (error.code === ErrorCode.QUOTA_EXCEEDED) {
          // Navigate to subscription tier selection (Req 8.3)
          router.push({ pathname: '/subscription', params: { quotaExceeded: 'true' } });
          return;
        }

        setErrorMessage(
          error.message || 'Failed to send review request. Please try again.',
        );
      }
    },
    [businessId, smsService, reset],
  );

  const onSubmit = useCallback(
    (data: SendRequestFormData) => {
      sendRequest(data);
    },
    [sendRequest],
  );

  const handleRetry = useCallback(() => {
    if (lastSubmittedData) {
      sendRequest(lastSubmittedData);
    }
  }, [lastSubmittedData, sendRequest]);

  const handleSuccessDone = useCallback(() => {
    setSuccessState(null);
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-card-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header with back button */}
        <View className="flex-row items-center pt-14 pb-4">
          <Pressable
            onPress={() => router.back()}
            className="mr-3 p-2"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color="#0B1736" />
          </Pressable>
          <Text className="text-heading font-bold text-navy flex-1">
            Send Review Request
          </Text>
        </View>

        {/* Description */}
        <Text className="text-body text-navy/70 mb-8">
          We'll send a friendly text asking your customer for a 1-5 rating.
        </Text>

        {/* Success State */}
        {successState && (
          <View className="mb-6">
            <SuccessIndicator
              visible={true}
              message="Review request sent!"
              onDone={handleSuccessDone}
              duration={3000}
            />
            <View className="mt-3 bg-white rounded-2xl p-4 border border-light-gray">
              <Text className="text-caption text-navy/60 mb-1">Sent to</Text>
              <Text className="text-body font-medium text-navy">
                {successState.phoneNumber}
              </Text>
              {successState.customerName && (
                <>
                  <Text className="text-caption text-navy/60 mt-2 mb-1">
                    Customer
                  </Text>
                  <Text className="text-body font-medium text-navy">
                    {successState.customerName}
                  </Text>
                </>
              )}
              {successState.serviceType && (
                <>
                  <Text className="text-caption text-navy/60 mt-2 mb-1">
                    Service
                  </Text>
                  <Text className="text-body font-medium text-navy">
                    {successState.serviceType}
                  </Text>
                </>
              )}
            </View>
          </View>
        )}

        {/* Error State */}
        {errorMessage && (
          <View className="mb-6">
            <ErrorIndicator
              message={errorMessage}
              onRetry={handleRetry}
              onDismiss={() => setErrorMessage(null)}
            />
          </View>
        )}

        {/* Customer Name Input */}
        <View className="mb-5">
          <Text className="text-body font-medium text-navy mb-1">
            Customer Name (optional)
          </Text>
          <View className="flex-row items-center border border-light-gray rounded-2xl bg-white px-4">
            <Ionicons name="person-outline" size={20} color="#9CA3AF" />
            <Controller
              control={control}
              name="customerName"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="flex-1 ml-3 py-3 text-body text-navy"
                  placeholder="Jane Smith"
                  placeholderTextColor="#9CA3AF"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  maxLength={50}
                  autoCapitalize="words"
                  accessibilityLabel="Customer Name"
                />
              )}
            />
          </View>
          {errors.customerName?.message && (
            <Text className="text-caption text-red-500 mt-1">
              {errors.customerName.message}
            </Text>
          )}
        </View>

        {/* Phone Number Input */}
        <View className="mb-5">
          <Text className="text-body font-medium text-navy mb-1">
            Phone Number
          </Text>
          <View
            className={`flex-row items-center border rounded-2xl bg-white px-4 ${
              errors.phoneNumber ? 'border-red-500' : 'border-light-gray'
            }`}
          >
            <Ionicons name="call-outline" size={20} color="#9CA3AF" />
            <Controller
              control={control}
              name="phoneNumber"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="flex-1 ml-3 py-3 text-body text-navy"
                  placeholder="(555) 123-4567"
                  placeholderTextColor="#9CA3AF"
                  onBlur={onBlur}
                  onChangeText={(text) => handlePhoneChange(text, onChange)}
                  value={value}
                  keyboardType="phone-pad"
                  maxLength={14}
                  accessibilityLabel="Phone Number"
                />
              )}
            />
          </View>
          {errors.phoneNumber?.message && (
            <Text className="text-caption text-red-500 mt-1">
              {errors.phoneNumber.message}
            </Text>
          )}
        </View>

        {/* Service Type Input */}
        <View className="mb-5">
          <Text className="text-body font-medium text-navy mb-1">
            Service Type (optional)
          </Text>
          <View className="flex-row items-center border border-light-gray rounded-2xl bg-white px-4">
            <Ionicons name="construct-outline" size={20} color="#9CA3AF" />
            <Controller
              control={control}
              name="serviceType"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="flex-1 ml-3 py-3 text-body text-navy"
                  placeholder="e.g. Plumbing Repair"
                  placeholderTextColor="#9CA3AF"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  maxLength={50}
                  autoCapitalize="words"
                  accessibilityLabel="Service Type"
                />
              )}
            />
          </View>
          {errors.serviceType?.message && (
            <Text className="text-caption text-red-500 mt-1">
              {errors.serviceType.message}
            </Text>
          )}
        </View>

        {/* Sender Phone Info */}
        <View className="flex-row items-center mb-8 px-1">
          <Ionicons
            name="information-circle-outline"
            size={18}
            color="#6B7280"
          />
          <Text className="text-caption text-navy/60 ml-2">
            Your customer will receive a text from (833) 123-4567
          </Text>
        </View>

        {/* Send Button */}
        <Pressable
          onPress={handleSubmit(onSubmit)}
          disabled={!isPhoneValid || isSending}
          className={`rounded-2xl py-4 items-center flex-row justify-center ${
            !isPhoneValid || isSending
              ? 'bg-rocket-orange/50'
              : 'bg-rocket-orange'
          }`}
          accessibilityRole="button"
          accessibilityLabel="Send Text"
          accessibilityState={{ disabled: !isPhoneValid || isSending }}
        >
          {isSending ? (
            <LoadingIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons
                name="paper-plane"
                size={20}
                color="#FFFFFF"
                style={{ marginRight: 8 }}
              />
              <Text className="text-body font-bold text-white">Send Text</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
