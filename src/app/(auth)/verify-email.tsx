import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";

/**
 * Email verification confirmation screen.
 * Displayed after successful signup, instructing the user to check their email.
 */
export default function VerifyEmailScreen() {
  return (
    <View className="flex-1 bg-card-bg justify-center items-center px-6">
      {/* Envelope/Check Icon */}
      <View className="w-20 h-20 rounded-full bg-success-green/10 items-center justify-center mb-6">
        <Text className="text-[40px]">✉️</Text>
      </View>

      {/* Heading */}
      <Text className="text-heading font-bold text-navy mb-3 text-center">
        Check your email
      </Text>

      {/* Instructions */}
      <Text className="text-body text-navy/70 text-center mb-8 px-4">
        We've sent a verification link to your email address. Please verify your
        email before logging in.
      </Text>

      {/* Continue to Onboarding Button */}
      <Pressable
        onPress={() => router.replace("/(auth)/onboarding")}
        className="bg-rocket-orange rounded-lg py-4 px-8 items-center"
        accessibilityRole="button"
        accessibilityLabel="Continue"
      >
        <Text className="text-body font-bold text-white">Continue</Text>
      </Pressable>
    </View>
  );
}
