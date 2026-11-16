import { APIError } from "better-auth/api";

/** The UV bit is covered by the verified WebAuthn signature. */
export function assertPasskeyUserVerified(userVerified: boolean | undefined) {
  if (userVerified === true) return;
  throw APIError.from("UNAUTHORIZED", {
    code: "USER_VERIFICATION_REQUIRED",
    message: "This passkey did not verify the user",
  });
}

