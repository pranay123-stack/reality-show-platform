import { z } from 'zod';

import { TEXT_LIMITS } from '../constants';
import { ROLES, USER_STATUSES } from '../enums';

/**
 * Auth contracts shared by the API and the web client, so a form and its
 * endpoint can never disagree about what is valid.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Enter a valid email address')
  .max(254)
  .email('Enter a valid email address');

/**
 * Length is the dominant factor in password strength, so the floor is 10
 * characters rather than a set of character-class rules that mostly produce
 * `Password1!`. A small block-list catches the obvious ones.
 */
export const passwordSchema = z
  .string()
  .min(TEXT_LIMITS.PASSWORD_MIN, `Use at least ${TEXT_LIMITS.PASSWORD_MIN} characters`)
  .max(TEXT_LIMITS.PASSWORD_MAX)
  .refine((value) => !/^\s|\s$/.test(value), 'Password cannot start or end with a space')
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    'That password is too common — pick something less predictable',
  );

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd123',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'iloveyou123',
  'letmein1234',
  'welcome1234',
  'adminadmin1',
]);

export const displayNameSchema = z
  .string()
  .trim()
  .min(TEXT_LIMITS.DISPLAY_NAME_MIN, 'Display name is too short')
  .max(TEXT_LIMITS.DISPLAY_NAME_MAX, 'Display name is too long')
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/,
    'Use letters, numbers, spaces, dots, underscores or hyphens',
  );

/** E.164, e.g. +919876543210. Optional throughout — the phone flow is a placeholder. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Enter a phone number in international format, e.g. +919876543210');

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  /// Explicit, unbundled consent. Not pre-ticked anywhere in the UI.
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You need to accept the terms to create an account' }),
  }),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(TEXT_LIMITS.PASSWORD_MAX),
  rememberMe: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, 'This reset link is not valid'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(20, 'This verification link is not valid'),
});

export const resendVerificationSchema = z.object({ email: emailSchema });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  bio: z.string().trim().max(TEXT_LIMITS.BIO_MAX).nullable().optional(),
  country: z.string().trim().max(64).nullable().optional(),
  timezone: z.string().trim().max(64).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const startPhoneVerificationSchema = z.object({ phone: phoneSchema });
export const confirmPhoneVerificationSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const sessionIdParamSchema = z.object({ sessionId: z.string().min(1) });

// --- response shapes -------------------------------------------------------

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  status: z.enum(USER_STATUSES),
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  country: z.string().nullable(),
  timezone: z.string(),
  pointsBalance: z.number(),
  lifetimePoints: z.number(),
  createdAt: z.string(),
  permissions: z.array(z.string()),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}
