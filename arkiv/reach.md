# Reach

**Who it's for.** Anyone who shares sensitive files with people outside their organisation and doesn't want the
platform, or the public, to learn who got them:
- founders sending a data room to investors (the demo);
- lawyers and their clients exchanging drafts;
- journalists receiving documents from sources;
- DAOs sharing grant applications or security reports with reviewers.

**Would they use it?** The two things they get here and nowhere else: members no one else can identify, and access that
ends on its own, with new files locking automatically. The cost is learning one new step: an ENS name, which Haven
gives for free (`you.cloakroom.eth`) with no gas.

**Can they try it today?** Yes, on testnets: the website (with "Try it", no wallet needed), the installable phone app
and the Chrome extension. Sign-in is one wallet signature; there's no app to install and no gas to buy.

**Useful beyond Haven.** The public key directory (`cloak.keylog`) is a standalone piece: any chat, email or
file app that wants to encrypt to an ENS name can read a name's key and its signed history with one Arkiv query, no
API key from us and no Haven code (README, "One runnable Arkiv query"). The release log does the same for "is this
the published build of this website".

**Will we keep building?** Yes. Next: passkey sign-in (no wallet at all), groups with automatic key refresh, a Firefox
build, and moving to mainnet once ENSv2 launches there.
