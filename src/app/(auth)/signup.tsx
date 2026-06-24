import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";

import { signUpSchema, type SignUpFormData } from "@/types/schemas";
import { useService } from "@/services";
import { ErrorCode } from "@/types";

/**
 * Signup screen for new business owner registration.
 * Uses React Hook Form with Zod schema validation.
 * Preserves form data on error so the user can retry without re-entering.
 */
export default function SignupScreen() {
  const authService = useService("auth");
  const [serverError, setServerError] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      businessName: "",
      email: "",
      password: "",
      googleReviewUrl: "",
    },
  });

  const onSubmit = async (data: SignUpFormData) => {
    setServerError(null);

    const result = await authService.signUp(data);

    if (result.success) {
      router.replace("/(auth)/verify-email");
    } else {
      // Map error codes to user-friendly messages
      if (result.error.code === ErrorCode.CONFLICT) {
        setServerError("An account with this email already exists.");
      } else if (result.error.code === ErrorCode.NETWORK_ERROR) {
        setServerError(
          "Unable to connect. Please check your internet connection and try again."
        );
      } else if (result.error.code === ErrorCode.SERVER_ERROR) {
        setServerError(
          "Something went wrong on our end. Please try again in a moment."
        );
      } else {
        setServerError(
          result.error.message || "Signup could not be completed. Please try again."
        );
      }
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-card-bg"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Text className="text-heading font-bold text-navy mb-2">
          Create your account
        </Text>
        <Text className="text-body text-navy/70 mb-8">
          Start collecting Google reviews for your business.
        </Text>

        {/* Server Error Banner */}
        {serverError && (
          <View className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <Text className="text-body text-red-700">{serverError}</Text>
          </View>
        )}

        {/* First Name */}
        <FormField
          label="First Name"
          error={errors.firstName?.message}
          control={control}
          name="firstName"
          placeholder="Jane"
          autoCapitalize="words"
        />

        {/* Last Name */}
        <FormField
          label="Last Name"
          error={errors.lastName?.message}
          control={control}
          name="lastName"
          placeholder="Smith"
          autoCapitalize="words"
        />

        {/* Business Name */}
        <FormField
          label="Business Name"
          error={errors.businessName?.message}
          control={control}
          name="businessName"
          placeholder="Smith Plumbing Co."
          autoCapitalize="words"
        />

        {/* Email */}
        <FormField
          label="Email"
          error={errors.email?.message}
          control={control}
          name="email"
          placeholder="jane@smithplumbing.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />

        {/* Password */}
        <View className="mb-5">
          <Text className="text-body font-medium text-navy mb-1">Password</Text>
          <View className="flex-row items-center border border-light-gray rounded-lg bg-white">
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="flex-1 px-4 py-3 text-body text-navy"
                  placeholder="Minimum 8 characters"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry={!passwordVisible}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  accessibilityLabel="Password"
                  accessibilityHint="Must contain uppercase, lowercase, number, and special character"
                />
              )}
            />
            <Pressable
              onPress={() => setPasswordVisible(!passwordVisible)}
              className="px-4 py-3"
              accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
              accessibilityRole="button"
            >
              <Text className="text-body text-rocket-orange font-medium">
                {passwordVisible ? "Hide" : "Show"}
              </Text>
            </Pressable>
          </View>
          {errors.password?.message && (
            <Text className="text-caption text-red-500 mt-1">
              {errors.password.message}
            </Text>
          )}
        </View>

        {/* Google Review URL */}
        <FormField
          label="Google Review URL"
          error={errors.googleReviewUrl?.message}
          control={control}
          name="googleReviewUrl"
          placeholder="Paste your Google review link here"
          autoCapitalize="none"
        />

        {/* Submit Button */}
        <Pressable
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          className={`rounded-lg py-4 items-center mt-4 ${
            isSubmitting ? "bg-rocket-orange/60" : "bg-rocket-orange"
          }`}
          accessibilityRole="button"
          accessibilityLabel="Create Account"
          accessibilityState={{ disabled: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-body font-bold text-white">Create Account</Text>
          )}
        </Pressable>

        {/* Login Link */}
        <View className="flex-row justify-center mt-6">
          <Text className="text-body text-navy/70">Already have an account? </Text>
          <Pressable
            onPress={() => router.replace("/(auth)/login")}
            accessibilityRole="link"
          >
            <Text className="text-body text-rocket-orange font-medium">
              Log in
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── FormField Component ─────────────────────────────────────────────────────

interface FormFieldProps {
  label: string;
  error?: string;
  control: ReturnType<typeof useForm<SignUpFormData>>["control"];
  name: keyof SignUpFormData;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "url";
  autoCapitalize?: "none" | "words" | "sentences";
  autoComplete?: string;
}

function FormField({
  label,
  error,
  control,
  name,
  placeholder,
  keyboardType = "default",
  autoCapitalize = "sentences",
  autoComplete,
}: FormFieldProps) {
  return (
    <View className="mb-5">
      <Text className="text-body font-medium text-navy mb-1">{label}</Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            className={`border rounded-lg px-4 py-3 text-body text-navy bg-white ${
              error ? "border-red-500" : "border-light-gray"
            }`}
            placeholder={placeholder}
            placeholderTextColor="#9CA3AF"
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            autoComplete={autoComplete as any}
            accessibilityLabel={label}
          />
        )}
      />
      {error && (
        <Text className="text-caption text-red-500 mt-1">{error}</Text>
      )}
    </View>
  );
}
