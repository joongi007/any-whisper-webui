import { QueryClient } from "@tanstack/react-query";

/** Shared QueryClient singleton.
 *
 *  Extracted out of main.tsx so non-React modules (e.g. the pending-delete
 *  store) can invalidate queries after firing a mutation, without threading a
 *  client reference through props or context. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});
