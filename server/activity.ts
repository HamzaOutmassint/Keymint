import { prisma } from "@/lib/prisma";
import { getIP } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import { trustedProxyIpPolicy } from "@/lib/security-policy";
import { enforceUserActivityRetention } from "@/server/retention";

export const ACTIVITY_DESCRIPTIONS = {
  LOGIN: "Signed in to Keymint.",
  LOGOUT: "Signed out of Keymint.",
  PASSWORD_VIEWED: "Viewed a vault credential.",
  PASSWORD_COPIED: "Copied a vault credential.",
  PASSWORD_CREATED: "Created a vault credential.",
  PASSWORD_EDITED: "Updated a vault credential.",
  PASSWORD_DELETED: "Deleted a vault credential.",
  CATEGORY_CREATED: "Created a vault category.",
  CATEGORY_DELETED: "Deleted a vault category.",
  SETTINGS_CHANGED: "Updated account security preferences.",
  EMAIL_CHANGE_REQUESTED: "Requested an account email change.",
  EMAIL_CHANGED: "Changed the account email address.",
  EMAIL_CHANGE_CANCELLED: "Cancelled a pending account email change.",
  VAULT_EXPORTED: "Exported the encrypted vault.",
  VAULT_IMPORTED: "Imported an encrypted vault.",
} as const;

export type ActivityAction = keyof typeof ACTIVITY_DESCRIPTIONS;

export const activityPublicSelect = {
  id: true,
  timestamp: true,
  device: true,
  browser: true,
  os: true,
  ip: true,
  action: true,
  description: true,
} as const;

function coarseNetwork(ip: string | null) {
  if (!ip) return "Unavailable";
  const ipv4 = ip.split(".");
  if (ipv4.length === 4) return `${ipv4.slice(0, 3).join(".")}.0/24`;
  const ipv6 = ip.split(":");
  if (ipv6.length === 8) return `${ipv6.slice(0, 3).join(":")}::/48`;
  return "Unavailable";
}

function clientInfo(request: Request) {
  const ua = request.headers.get("user-agent") ?? "Unknown";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Unknown";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown";
  const device = /Mobile|Android|iPhone/.test(ua) ? "Mobile" : "Desktop";
  const proxyPolicy = trustedProxyIpPolicy();
  const ip = coarseNetwork(getIP(request, {
    advanced: { ipAddress: { ...proxyPolicy, ipv6Subnet: 48 } },
  } as BetterAuthOptions));
  return { browser, os, device, ip };
}

export function activityRecordData(
  request: Request,
  userId: string,
  action: ActivityAction,
) {
  return {
    userId,
    action,
    description: ACTIVITY_DESCRIPTIONS[action],
    ...clientInfo(request),
  };
}

export async function logActivity(
  request: Request,
  userId: string,
  action: ActivityAction,
) {
  await enforceUserActivityRetention(userId);
  await prisma.activityLog.create({
    data: activityRecordData(request, userId, action),
  });
}
