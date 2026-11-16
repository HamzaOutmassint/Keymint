import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { prisma } from "@/lib/prisma";
import { sendTransactionalEmail } from "@/server/email";
import {
  hashPassword,
  verifyPassword,
} from "@/server/security/password-hashing";
import { isRegistrationEnabled } from "@/lib/registration";
import {
  DISABLED_AUTH_PATHS,
  TRUST_DEVICE_MAX_AGE_SECONDS,
  trustedProxyIpPolicy,
} from "@/lib/security-policy";
import {
  revokeUserAccessAfterTwoFactorChange,
  revokeVerificationStateAfterPasswordReset,
} from "@/server/security/auth-lifecycle";
import { resolveServerSecurityEnvironment } from "@/lib/server-env";
import { reserveTotpStep } from "@/server/security/totp";
import { notifySecurityChange } from "@/server/security/security-notifications";
import { assertPasskeyUserVerified } from "@/server/security/passkeys";

const securityEnvironment = resolveServerSecurityEnvironment();
export const auth = betterAuth({
  appName: "Keymint",
  secret: securityEnvironment.authSecret,
  baseURL: securityEnvironment.authUrl,
  trustedOrigins: [securityEnvironment.appUrl],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  disabledPaths: [...DISABLED_AUTH_PATHS],
  verification: { storeIdentifier: "hashed" },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendTransactionalEmail({
        to: user.email,
        subject: "Verify your Keymint email address",
        html: `
          <p>Verify this email address to finish creating your Keymint account.</p>
          <p><a href="${url}">Verify email address</a></p>
          <p>This link expires in one hour. If you did not create this account, ignore this email.</p>
        `,
      });
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: !isRegistrationEnabled(),
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => {
      await revokeVerificationStateAfterPasswordReset(user.id);
    },
    password: { hash: hashPassword, verify: verifyPassword },
    sendResetPassword: async ({ user, url }) => {
      await sendTransactionalEmail({
        to: user.email,
        subject: "Reset your Keymint sign-in password",
        html: `
          <p>We received a request to reset your Keymint sign-in password.</p>
          <p><a href="${url}">Reset your sign-in password</a></p>
          <p>This link expires in one hour. If you did not request it, you can safely ignore this email.</p>
          <p>Your encrypted vault and Master Password will not be changed.</p>
        `,
      });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 5 * 60,
  },
  advanced: {
    cookiePrefix: "keymint",
    ipAddress: trustedProxyIpPolicy(),
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path !== "/two-factor/verify-totp") return;
      // Enrollment uses Keymint's pending-factor endpoint. This hook applies to
      // sign-in challenges only and claims a matching step before session issue.
      if (context.context.session) return;
      const body = context.body as { code?: unknown } | undefined;
      if (typeof body?.code !== "string") return;
      const cookie = context.context.createAuthCookie("two_factor");
      const challengeId = await context.getSignedCookie(
        cookie.name,
        context.context.secret,
      );
      if (!challengeId) return;
      const challenge = await context.context.internalAdapter.findVerificationValue(
        challengeId,
      );
      if (!challenge) return;
      const result = await reserveTotpStep(challenge.value, body.code);
      if (result === "replayed") {
        throw APIError.from("UNAUTHORIZED", {
          code: "TOTP_REPLAYED",
          message: "This authentication code has already been used",
        });
      }
    }),
    after: createAuthMiddleware(async (context) => {
      const authenticatedSession = context.context.session;
      if (authenticatedSession) {
        const events = {
          "/two-factor/disable": "totp-disabled",
          "/two-factor/generate-backup-codes": "recovery-codes-regenerated",
          "/passkey/verify-registration": "passkey-added",
        } as const;
        const event = events[context.path as keyof typeof events];
        if (event) {
          await revokeUserAccessAfterTwoFactorChange(
            authenticatedSession.user.id,
            authenticatedSession.session.token,
          );
          notifySecurityChange(authenticatedSession.user.id, event);
        }
        if (
          context.path === "/revoke-session" ||
          context.path === "/revoke-other-sessions" ||
          context.path === "/revoke-sessions"
        ) {
          notifySecurityChange(authenticatedSession.user.id, "sessions-revoked");
        }
      }

      if (context.path === "/two-factor/verify-backup-code") {
        const returned = context.context.returned as
          | { user?: { id?: string } }
          | undefined;
        if (returned?.user?.id) {
          notifySecurityChange(returned.user.id, "recovery-code-used");
        }
      }
    }),
  },
  plugins: [
    twoFactor({
      issuer: "Keymint",
      trustDeviceMaxAge: TRUST_DEVICE_MAX_AGE_SECONDS,
    }),
    passkey({
      rpName: "Keymint",
      rpID: new URL(securityEnvironment.authUrl).hostname,
      origin: securityEnvironment.authUrl,
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      registration: {
        requireSession: true,
        afterVerification: async ({ verification }) => {
          assertPasskeyUserVerified(
            verification.registrationInfo?.userVerified,
          );
        },
      },
      authentication: {
        afterVerification: async ({ verification }) => {
          assertPasskeyUserVerified(
            verification.authenticationInfo.userVerified,
          );
        },
      },
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
