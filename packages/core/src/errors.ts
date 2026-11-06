// Turns viem and contract errors into DriveError codes the UI can act on.

import { DriveError, type DriveErrorCode } from "@haven/types";
import { BaseError, ContractFunctionRevertedError, HttpRequestError, TimeoutError } from "viem";

/** Custom errors from DriveRegistry and the ENSv2 contracts it inherits. */
const REVERT_CODES: Record<string, DriveErrorCode> = {
  EACUnauthorizedAccountRoles: "NOT_AUTHORIZED",
  EACCannotGrantRoles: "NOT_AUTHORIZED",
  EACCannotRevokeRoles: "NOT_AUTHORIZED",
  GrantOutlivesGrantor: "NOT_AUTHORIZED",
  OwnerAccessIsFixed: "NOT_AUTHORIZED",
  DriveRolesOnlyAtRoot: "NOT_AUTHORIZED",
  UseGrantRolesUntil: "NOT_AUTHORIZED",
  UpgradesDisabled: "NOT_AUTHORIZED",
  LabelAlreadyRegistered: "NAME_TAKEN",
  LabelAlreadyReserved: "NAME_TAKEN",
  InvalidUntil: "EXPIRED",
  NotExpired: "NOT_AUTHORIZED",
  LabelExpired: "EXPIRED",
  CannotSetPastExpiry: "EXPIRED",
  EACMaxAssignees: "RATE_LIMITED",
};

/** The DriveError code for a custom error name. */
export function revertCode(errorName: string): DriveErrorCode {
  return REVERT_CODES[errorName] ?? "UNKNOWN";
}

export function toDriveError(error: unknown, context?: string): DriveError {
  if (error instanceof DriveError) return error;
  const prefix = context ? `${context}: ` : "";
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? reverted.reason ?? "reverted";
      return new DriveError(REVERT_CODES[name] ?? "UNKNOWN", `${prefix}${name}`);
    }
    if (error.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError)) {
      return new DriveError("NETWORK", `${prefix}${error.shortMessage}`);
    }
    return new DriveError("UNKNOWN", `${prefix}${error.shortMessage}`);
  }
  return new DriveError("UNKNOWN", `${prefix}${error instanceof Error ? error.message : String(error)}`);
}
