#!/usr/bin/env bash
# Mutation check for contracts/src/DriveRegistry.sol: each mutant breaks one rule; some test must fail.
# Usage (from anywhere): contracts/test/mutation/mutate.sh <contracts dir> <test path>
#   e.g. contracts/test/mutation/mutate.sh contracts test/DriveRegistry.t.sol
# Restores src/DriveRegistry.sol on exit.
set -u
cd "$1" || exit 1
TEST="$2"
SRC=src/DriveRegistry.sol
BAK=$(mktemp)
cp "$SRC" "$BAK"
trap 'cp "$BAK" "$SRC"' EXIT

run() { # name, perl substitution
  cp "$BAK" "$SRC"
  perl -0pi -e "$2" "$SRC"
  if cmp -s "$BAK" "$SRC"; then echo "NOT APPLIED  $1"; return; fi
  out=$(forge test --match-path "$TEST" 2>&1)
  if echo "$out" | grep -q 'Compiler run failed'; then echo "NO COMPILE   $1"; return; fi
  fails=$(echo "$out" | grep -cE '^\[FAIL')
  if [ "$fails" -gt 0 ]; then echo "KILLED ($fails) $1"; else echo "SURVIVED     $1"; fi
}

run "no upgrade strip in _getRoles"        's/super\._getRoles\(resource, account\) & ~UPGRADE_ROLES;/super._getRoles(resource, account);/'
run "no expiry in _getRoles"               's/&& _isExpired\(account\)\) \{\n            roleBitmap &= ~ALL_DRIVE_ROLES;/&& false) {\n            roleBitmap &= ~ALL_DRIVE_ROLES;/'
run "expired roles not cleared on regrant" 's/if \(current != 0 && _isExpired\(account\)\) \{/if (false) {/'
run "no owner protection on revoke"        's/if \(account == _driveOwner && msg\.sender != account/if (false && account == _driveOwner && msg.sender != account/'
run "owner can be time-limited"            's/if \(account == _driveOwner\) revert OwnerAccessIsFixed\(\);//'
run "grant may outlive grantor"            's/if \(until > grantorEnd\) revert/if (false) revert/'
run "no caller check in grantRolesUntil"   's/_checkCanGrantRoles\(ROOT_RESOURCE, roleBitmap \| current, msg\.sender\);//'
run "caller check ignores existing roles"  's/_checkCanGrantRoles\(ROOT_RESOURCE, roleBitmap \| current, msg\.sender\);/_checkCanGrantRoles(ROOT_RESOURCE, roleBitmap, msg.sender);/'
run "wasAllowed end inclusive"             's/if \(t < \(iv\.endedAt == 0 \? iv\.until : iv\.endedAt\)\)/if (t <= (iv.endedAt == 0 ? iv.until : iv.endedAt))/'
run "wasAllowed ignores early end"         's/if \(t < \(iv\.endedAt == 0 \? iv\.until : iv\.endedAt\)\)/if (t < iv.until)/'
run "upgradeToAndCall not overridden"      's/revert UpgradesDisabled\(\);\n    \}/super.upgradeToAndCall(newImplementation, data);\n    }/; s/function upgradeToAndCall\(address, bytes memory\)/function upgradeToAndCall(address newImplementation, bytes memory data)/'
run "canUpgradeFrom true"                  's/returns \(bool\) \{\n        return false;/returns (bool) {\n        return true;/'
run "late close not capped at until"       's/uint64 ended = last\.until < nowTs \? last\.until : nowTs;/uint64 ended = nowTs;/'
run "stock grantRootRoles accepts drive"   's/if \(roleBitmap & ALL_DRIVE_ROLES != 0\) revert UseGrantRolesUntil\(\);//'
run "drive roles allowed on tokens"        's/if \(roleBitmap & ALL_DRIVE_ROLES != 0\) revert DriveRolesOnlyAtRoot\(\);//'
run "sweep before expiry"                  's/if \(stale == 0 \|\| !_isExpired\(account\)\) revert NotExpired/if (stale == 0) revert NotExpired/'
run "history not recorded on revoke"       's/if \(afterChange != before\) _onDriveChange\(account, before, afterChange\);\n    \}\n\n    \/\/\/ \@dev Closes/}\n\n    \/\/\/ \@dev Closes/'
run "until-only change not recorded"       's/_onDriveChange\(account, current, current\); \/\/ same roles, new end date//'
run "pack drops admin bits"                's/\| \(\(\(roles >> 168\) & 0x111\) << 12\)\);/);/'
