/**
 * send-sms Edge Function
 *
 * Sends an SMS feedback request to a customer on behalf of a business owner.
 * Validates quota, checks for duplicates, encrypts PII, sends via Twilio,
 * and handles failures by queuing for retry.
 *
 * Requirements: 3.1, 3.4, 3.7, 4.1, 4.2, 8.3, 10.4, 11.6
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createSupabaseClient,
  createSupabaseClientWithAuth,
  getBusinessProfile,
  getSmsUsage,
  incrementSmsUsage,
  writeAuditLog,
  queueSmsForRetry,
} from "../_shared/adapters/supabase.adapter.ts";
import { sendSms } from "../_shared/adapters/twilio.adapter.ts";
import { encrypt } from "../_shared/utils/encryption.ts";
import { hashPhone } from "../_shared/utils/hash.ts";
import { sanitizeForLogging } from "../_shared/utils/sanitize.ts";
import type { SendSmsPayload } from "../_shared/types/index.ts";

/** Request body shape for the send-sms function. */
interface SendSmsRequest {
  phoneNumber: string;
  customerName?: string;
  serviceType?: string;
  confirmDuplicate?: boolean;
}

/** Response shape for a successful SMS send. */
interface SendSmsResponse {
  reviewRequestId: string;
  status: "sent" | "queued";
  duplicateWarning?: boolean;
}

/**
 * Format the feedback request SMS message per requirements 4.1 and 4.2.
 *
 * With customer name:
 *   "Hi [Customer Name], Thank you for choosing [Business Name]. Small businesses
 *    like ours rely on customer feedback to grow and improve. On a scale of 1-5,
 *    how would you rate your experience today? Reply with a number from 1 to 5."
 *
 * Without customer name:
 *   "Thank you for choosing [Business Name]. Small businesses like ours rely on
 *    customer feedback to grow and improve. On a scale of 1-5, how would you rate
 *    your experience today? Reply with a number from 1 to 5."
 */
export function formatSmsMessage(
  businessName: string,
  customerName?: string,
): string {
  const greeting = customerName ? `Hi ${customerName}, ` : "";
  return `${greeting}Thank you for choosing ${businessName}. Small businesses like ours rely on customer feedback to grow and improve. On a scale of 1-5, how would you rate your experience today? Reply with a number from 1 to 5.\n\nReply STOP to opt out.`;
}

serve(async (req: Request): Promise<Response> => {
  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Method not allowed" } }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    );
  }

  // 1. Verify the request is authenticated
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: { code: "AUTH_ERROR", message: "Missing authorization header" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const userClient = createSupabaseClientWithAuth(authHeader);
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: { code: "AUTH_ERROR", message: "Invalid or expired token" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // 2. Parse request body
  let body: SendSmsRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { phoneNumber, customerName, serviceType, confirmDuplicate } = body;

  if (!phoneNumber) {
    return new Response(
      JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "phoneNumber is required" } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Use the service role client for database operations
  const serviceClient = createSupabaseClient();

  // 3. Get business profile for the authenticated user
  const profileResult = await getBusinessProfile(serviceClient, user.id);
  if (!profileResult.success) {
    console.error(
      "[send-sms] Failed to get business profile:",
      sanitizeForLogging({ userId: user.id, error: profileResult.error.message }),
    );
    return new Response(
      JSON.stringify({ error: { code: "NOT_FOUND", message: "Business profile not found" } }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const profile = profileResult.data;

  // 4. Check SMS quota: if used >= quota, return 403 with QUOTA_EXCEEDED
  const usageResult = await getSmsUsage(serviceClient, profile.id);
  if (!usageResult.success) {
    console.error(
      "[send-sms] Failed to get SMS usage:",
      sanitizeForLogging({ businessId: profile.id, error: usageResult.error.message }),
    );
    return new Response(
      JSON.stringify({ error: { code: "SERVER_ERROR", message: "Failed to check SMS quota" } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const { used, quota } = usageResult.data;
  if (used >= quota) {
    return new Response(
      JSON.stringify({
        error: {
          code: "QUOTA_EXCEEDED",
          message: "SMS quota exceeded. Please upgrade your subscription.",
          details: { used, quota },
        },
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // 5. Encrypt the phone number for storage and hash for lookups
  const encryptedPhone = await encrypt(phoneNumber);
  const phoneHash = await hashPhone(phoneNumber);

  // Check for duplicate within 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: duplicateData, error: duplicateError } = await serviceClient
    .from("review_requests")
    .select("id, sent_at")
    .eq("customer_phone_hash", phoneHash)
    .eq("business_id", profile.id)
    .gte("sent_at", twentyFourHoursAgo)
    .limit(1)
    .maybeSingle();

  if (duplicateError) {
    console.error(
      "[send-sms] Duplicate check failed:",
      sanitizeForLogging({ error: duplicateError.message }),
    );
    // Non-fatal: proceed without duplicate check
  }

  const isDuplicate = !!duplicateData;

  // If duplicate found and user hasn't confirmed, return warning
  if (isDuplicate && !confirmDuplicate) {
    return new Response(
      JSON.stringify({
        duplicateWarning: true,
        message: "A review request was already sent to this number within the last 24 hours. Confirm to send again.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // 6. Encrypt customer data for storage
  const encryptedName = customerName ? await encrypt(customerName) : null;

  // 7. Format the SMS message
  const smsBody = formatSmsMessage(profile.businessName, customerName);

  // 8. Send via Twilio adapter
  const smsPayload: SendSmsPayload = {
    to: phoneNumber,
    body: smsBody,
    businessId: profile.id,
    customerName: customerName,
  };

  const smsResult = await sendSms(smsPayload);

  if (smsResult.success) {
    // 9. Twilio succeeded: create review_request record, increment usage, write audit log

    // Create review_request record
    const { data: reviewRequest, error: insertError } = await serviceClient
      .from("review_requests")
      .insert({
        business_id: profile.id,
        customer_phone_encrypted: encryptedPhone,
        customer_phone_hash: phoneHash,
        customer_name_encrypted: encryptedName,
        service_type: serviceType || null,
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      console.error(
        "[send-sms] Failed to create review_request:",
        sanitizeForLogging({ error: insertError.message }),
      );
      return new Response(
        JSON.stringify({ error: { code: "SERVER_ERROR", message: "Failed to save review request" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Increment sms_used_this_period
    const incrementResult = await incrementSmsUsage(serviceClient, profile.id);
    if (!incrementResult.success) {
      console.error(
        "[send-sms] Failed to increment SMS usage:",
        sanitizeForLogging({ businessId: profile.id, error: incrementResult.error.message }),
      );
      // Non-fatal: SMS was sent, don't fail the request
    }

    // Write audit log entry for sms_sent event
    await writeAuditLog(serviceClient, {
      actorId: user.id,
      eventType: "sms_sent",
      resourceId: reviewRequest.id,
      metadata: {
        businessId: profile.id,
        serviceType: serviceType || undefined,
        isDuplicate,
      },
    });

    const response: SendSmsResponse = {
      reviewRequestId: reviewRequest.id,
      status: smsResult.data.status,
      ...(isDuplicate && { duplicateWarning: true }),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } else {
    // 10. Twilio failed: create review_request record with failed status and queue for retry

    console.error(
      "[send-sms] Twilio send failed:",
      sanitizeForLogging({ error: smsResult.error.message, code: smsResult.error.code }),
    );

    // Still create the review_request record so we can track the retry
    const { data: reviewRequest, error: insertError } = await serviceClient
      .from("review_requests")
      .insert({
        business_id: profile.id,
        customer_phone_encrypted: encryptedPhone,
        customer_phone_hash: phoneHash,
        customer_name_encrypted: encryptedName,
        service_type: serviceType || null,
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      console.error(
        "[send-sms] Failed to create review_request for retry:",
        sanitizeForLogging({ error: insertError.message }),
      );
      return new Response(
        JSON.stringify({ error: { code: "SERVER_ERROR", message: "SMS send failed and could not queue for retry" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Queue for retry via sms_queue table
    await queueSmsForRetry(serviceClient, {
      reviewRequestId: reviewRequest.id,
      payload: smsPayload,
    });

    // Increment SMS usage even for queued messages (will be delivered eventually)
    await incrementSmsUsage(serviceClient, profile.id);

    // Write audit log entry
    await writeAuditLog(serviceClient, {
      actorId: user.id,
      eventType: "sms_sent",
      resourceId: reviewRequest.id,
      metadata: {
        businessId: profile.id,
        serviceType: serviceType || undefined,
        isDuplicate,
        queued: true,
      },
    });

    const response: SendSmsResponse = {
      reviewRequestId: reviewRequest.id,
      status: "queued",
      ...(isDuplicate && { duplicateWarning: true }),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
