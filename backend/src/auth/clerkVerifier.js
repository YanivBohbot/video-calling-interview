import { verifyToken, createClerkClient } from "@clerk/express";

// The only file that talks to Clerk. Everything else depends on this small shape:
//   verify(token)       → { clerkId } | null   (signature, expiry, authorized party)
//   fetchUser(clerkId)  → { name, email, profileImage }
// Tests inject a fake with the same shape, so they never reach the network.
export const createClerkVerifier = ({ secretKey, authorizedParties }) => {
  const clerk = createClerkClient({ secretKey });

  const verify = async (token) => {
    try {
      const result = await verifyToken(token, { secretKey, authorizedParties });
      // Depending on the SDK version the payload is returned directly or as { data, errors }.
      const payload = result?.data ?? result;
      if (result?.errors?.length || !payload?.sub) return null;
      return { clerkId: payload.sub };
    } catch {
      return null;
    }
  };

  const fetchUser = async (clerkId) => {
    const user = await clerk.users.getUser(clerkId);
    const primary = user.emailAddresses?.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses?.[0];
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "New user";
    return { name, email: primary?.emailAddress ?? null, profileImage: user.imageUrl ?? null };
  };

  return { verify, fetchUser };
};
