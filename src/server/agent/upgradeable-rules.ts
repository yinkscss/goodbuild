/**
 * What the builder is told on every turn of an upgradeable project (D33). Injected through the
 * project context, so the system prompt stays the same for everyone else.
 */
export function upgradeableRules(live: Array<{ name: string; variables: string[] }> = []): string {
  const liveLines = live
    .filter((c) => c.variables.length)
    .map((c) => `- ${c.name} stores, in this exact order: ${c.variables.join(", ")}`)
    .join("\n");
  return `This project is UPGRADEABLE (a testnet trial). GoodBuild deploys each contract behind OpenZeppelin's proxy, so it can get new code later at the same address with its funds and data intact. These rules replace the normal ones where they differ:
- No constructor logic and no constructor arguments, because a constructor never runs on the proxy. Every contract has exactly this constructor:
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }
- Put everything a constructor would do in function initialize(...) external initializer. It runs once, in the transaction that creates the proxy. Inside it, msg.sender is the user's wallet. Call every parent's init, in inheritance order: __Ownable_init(msg.sender);, __ERC20_init("Name", "SYM");, and so on.
- Build on the upgradeable versions: import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol"; and ERC20Upgradeable, ERC721Upgradeable, ERC1155Upgradeable, ERC20BurnableUpgradeable, OwnableUpgradeable and PausableUpgradeable from "@openzeppelin/contracts-upgradeable/...". Never inherit the plain ERC20, ERC721, Ownable or Pausable. ReentrancyGuard stays "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; it has no upgradeable version and needs no init call. Interfaces and libraries (IERC20, SafeERC20, Math) stay as they are.
- No immutable variables and no initial values on state variables, because neither reaches the proxy. G$ is a normal variable: IERC20 public gd; set in initialize. constant is fine.
- contracts/deploy.json works the same, but its args are the parameters of initialize, by name. References like "\${Name.address}" mean the contract's permanent address. They only apply when a contract is first deployed, so changing them later does nothing to a live contract.
- Tests in contracts/test/ deploy through the proxy, because the bare contract can't be initialized: import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol"; then Name c = Name(address(new TransparentUpgradeableProxy(address(new Name()), address(this), abi.encodeCall(Name.initialize, (args))))). Contracts other than tests never import a proxy; GoodBuild supplies it.
- Never write @custom:oz- notes other than the one above, and never use reinitializer, delegatecall, assembly or StorageSlot.

Changing a contract that is already live:
- Keep every existing state variable, with the same name, the same type and the same order, including in parent contracts. Never rename, retype, reorder or delete one, even if it's now unused; leave it and stop using it. Add new variables only after all the existing ones. New struct fields go at the end of the struct, and new enum values at the end of the enum.
- New variables start at zero on the live contract, and initialize does not run again. Make zero a sensible starting value, or add an owner-only setter.
- Keep function names and arguments where you can, so an already published app keeps working until it's published again.
- Tell the user in your reply that the contract needs upgrading from their wallet, at the same address. If what they ask for can't keep the stored data readable, say so plainly: they can deploy it as a new contract at a new address instead, but the old contract's funds and data don't move across.${liveLines ? `\n\nStored variables of the live contracts, which you must keep:\n${liveLines}` : ""}`;
}
