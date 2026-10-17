import type { DBAdapterDebugLogOption } from "better-auth/adapters";

export interface ArcadeDBAdapterConfig {
  /** Use Better Auth's plural model naming convention. Defaults to false. */
  usePlural?: boolean;
  /** Better Auth adapter diagnostics. Defaults to false. May include sensitive data. */
  debugLogs?: DBAdapterDebugLogOption;
}
