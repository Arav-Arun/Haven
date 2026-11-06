# How AI was used

Haven was built by two people, each working with a Claude coding agent (Claude Code) on their own laptop, on
separate branches merged later.

**Planning (both).** The design in `docs/plan/` was written with Claude from the prize briefs and the partners' docs.
An outside review found eight flaws (editor key leaks, stealth funding that linked members, rooms linked to owners,
traffic not routed privately, and more). Claude rewrote the plan to fix each one; section 22 maps every finding to its
fix. The humans chose the idea, the three partners, the name and every trade-off.

**Person A (Aarav Bhatia): contracts and core.** Claude wrote `DriveRegistry.sol` and its Foundry tests (unit, fuzz,
invariant, fork tests against live Sepolia ENSv2), and the core building blocks (keys, epochs, stealth shares, Arkiv
schemas, the validator, Swarm uploads, naming), following the plan step by step. The feasibility checks (for example,
that ENSv2's role hooks can't be overridden) were run, and their results recorded in `docs/checks-a.md`.

**Person B (Arav Arun): apps, then the client and API.** Claude wrote the platform package (Anon-RPC wiring for web
and extension, encrypted storage), the UI package, the website and phone app, and the extension. After merging A's
branch, at Arav's request, Claude also wrote the API (`apps/api`), `createDriveClient` and the bootstrap and
end-to-end scripts. Results are recorded in `docs/checks-b.md`.

**Rules the agents followed** (`CLAUDE.md`): no mocks, seeded data or fake values (every value shown is read live);
no third-party scripts or analytics; keys never committed; addresses only from the ENS docs, never guessed.

**What humans did:** accounts, faucets and funding, keys, deploys, testing on real phones and in Chrome, the demo
video, and every decision about scope.
