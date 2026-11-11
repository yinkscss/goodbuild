import type { Kit } from "./registry";

/**
 * The game shop (D95): cars and skins, level ups and power packs, and a season pass, paid in G$ with
 * one transferAndCall each. A tested contract instead of one the model writes per game, because a shop
 * holds real money and the Neon Drift build spent a deploy on its own.
 *
 * The game's items live in the game's code (shopItems), drawn with the game's own drawings. The
 * contract only knows ids, prices and kinds; the owner puts the list on sale with one button after
 * deploying. Playing stays free: starter items cost nothing and need no wallet.
 */

const GAME_SHOP_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// A game's shop, paid in G$ with one transferAndCall:
///  - Unique items (a car, a skin) are owned once.
///  - Counted items (a level up, a power pack) add up; perPurchase is how many one purchase gives.
///  - The season pass belongs to the current season and ends with it.
/// The owner sets the price list and takes the takings out. Nobody else can move anyone's G$.
contract GameShop is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant UNIQUE = 0;
    uint8 public constant COUNTED = 1;
    uint8 public constant PASS = 2;
    uint256 public constant MAX_QUANTITY = 100;

    struct Item {
        uint256 id;
        uint256 price;
        uint8 kind;
        uint32 perPurchase;
        bool forSale;
    }

    IERC20 public immutable gd;
    bool public paused;
    uint256 public season;
    uint64 public seasonEnds;

    mapping(uint256 => Item) private items;
    uint256[] private itemIds;
    mapping(uint256 => bool) private listed;
    mapping(address => mapping(uint256 => uint256)) public owned;
    mapping(address => uint256) public passSeason;

    event ItemSet(uint256 indexed id, uint256 price, uint8 kind, uint32 perPurchase, bool forSale);
    event Bought(address indexed player, uint256 indexed id, uint256 quantity, uint256 paid);
    event SeasonStarted(uint256 indexed season, uint64 endsAt);
    event Withdrawn(address indexed to, uint256 amount);
    event PausedSet(bool paused);

    error ZeroAddress();
    error NotGoodDollar();
    error ShopPaused();
    error NotForSale(uint256 id);
    error BadQuantity();
    error WrongAmount(uint256 expected, uint256 paid);
    error AlreadyOwned(uint256 id);
    error NoSeason();
    error BadSeasonEnd();
    error BadItem();
    error LengthMismatch();

    constructor(IERC20 gd_) Ownable(msg.sender) {
        if (address(gd_) == address(0)) revert ZeroAddress();
        gd = gd_;
    }

    // --- The owner

    /// Put items on sale or change them, all in one transaction. Prices are in G$'s smallest unit.
    function setItems(uint256[] calldata ids, uint256[] calldata prices, uint8[] calldata kinds, uint32[] calldata perPurchase, bool[] calldata forSale) external onlyOwner {
        uint256 n = ids.length;
        if (prices.length != n || kinds.length != n || perPurchase.length != n || forSale.length != n) revert LengthMismatch();
        for (uint256 i = 0; i < n; i++) {
            if (kinds[i] > PASS || prices[i] == 0 || (kinds[i] == COUNTED && perPurchase[i] == 0)) revert BadItem();
            items[ids[i]] = Item(ids[i], prices[i], kinds[i], kinds[i] == COUNTED ? perPurchase[i] : 1, forSale[i]);
            if (!listed[ids[i]]) {
                listed[ids[i]] = true;
                itemIds.push(ids[i]);
            }
            emit ItemSet(ids[i], prices[i], kinds[i], perPurchase[i], forSale[i]);
        }
    }

    /// Start the next season. Passes from earlier seasons stop counting.
    function startSeason(uint64 endsAt) external onlyOwner {
        if (endsAt <= block.timestamp) revert BadSeasonEnd();
        season += 1;
        seasonEnds = endsAt;
        emit SeasonStarted(season, endsAt);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /// Take the takings out.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        gd.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    // --- Players

    /// G$ calls this inside transferAndCall(shop, price * quantity, abi.encode(itemId, quantity)).
    function onTokenTransfer(address from, uint256 amount, bytes calldata data) external nonReentrant returns (bool) {
        if (msg.sender != address(gd)) revert NotGoodDollar();
        (uint256 id, uint256 quantity) = abi.decode(data, (uint256, uint256));
        _buy(from, id, quantity, amount);
        return true;
    }

    function _buy(address player, uint256 id, uint256 quantity, uint256 paid) private {
        if (paused) revert ShopPaused();
        Item memory item = items[id];
        if (!item.forSale) revert NotForSale(id);
        if (quantity == 0 || quantity > MAX_QUANTITY || (item.kind != COUNTED && quantity != 1)) revert BadQuantity();
        uint256 expected = item.price * quantity;
        if (paid != expected) revert WrongAmount(expected, paid);
        if (item.kind == UNIQUE) {
            if (owned[player][id] != 0) revert AlreadyOwned(id);
            owned[player][id] = 1;
        } else if (item.kind == COUNTED) {
            owned[player][id] += quantity * item.perPurchase;
        } else {
            if (season == 0 || block.timestamp >= seasonEnds) revert NoSeason();
            if (passSeason[player] == season) revert AlreadyOwned(id);
            passSeason[player] = season;
            owned[player][id] = season;
        }
        emit Bought(player, id, quantity, paid);
    }

    // --- Reading

    function hasPass(address player) public view returns (bool) {
        return season != 0 && passSeason[player] == season && block.timestamp < seasonEnds;
    }

    function catalogue() external view returns (Item[] memory list) {
        list = new Item[](itemIds.length);
        for (uint256 i = 0; i < itemIds.length; i++) list[i] = items[itemIds[i]];
    }

    /// How many of each listed item the player has (1 for an owned car; the season number for a pass).
    function ownedBy(address player) external view returns (uint256[] memory ids, uint256[] memory counts) {
        ids = itemIds;
        counts = new uint256[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) counts[i] = owned[player][ids[i]];
    }
}
`;

const GAME_SHOP_TEST = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Actor} from "@goodbuild/Test.sol";
import {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";
import {GameShop} from "../GameShop.sol";

contract GameShopTest is Test {
    MockGoodDollar gd;
    GameShop shop;
    Actor alice;
    Actor mallory;

    uint256 constant CAR = 1;
    uint256 constant LEVEL = 2;
    uint256 constant PASS_ITEM = 3;

    function setUp() public {
        gd = new MockGoodDollar();
        shop = new GameShop(gd);
        alice = newActor();
        mallory = newActor();
        gd.mint(address(alice), 1_000e18);
        gd.mint(address(mallory), 1_000e18);
        uint256[] memory ids = new uint256[](3);
        uint256[] memory prices = new uint256[](3);
        uint8[] memory kinds = new uint8[](3);
        uint32[] memory per = new uint32[](3);
        bool[] memory sale = new bool[](3);
        (ids[0], prices[0], kinds[0], per[0], sale[0]) = (CAR, 50e18, 0, 1, true);
        (ids[1], prices[1], kinds[1], per[1], sale[1]) = (LEVEL, 10e18, 1, 1, true);
        (ids[2], prices[2], kinds[2], per[2], sale[2]) = (PASS_ITEM, 100e18, 2, 1, true);
        shop.setItems(ids, prices, kinds, per, sale);
        shop.startSeason(uint64(block.timestamp + 30 days));
    }

    function buy(Actor who, uint256 id, uint256 quantity, uint256 amount) internal {
        who.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(shop), amount, abi.encode(id, quantity))));
    }

    function buyReverts(Actor who, uint256 id, uint256 quantity, uint256 amount, string memory why) internal {
        expectRevert(who, address(gd), abi.encodeCall(gd.transferAndCall, (address(shop), amount, abi.encode(id, quantity))), why);
    }

    function testBuysACarOnce() public {
        buy(alice, CAR, 1, 50e18);
        assertEq(shop.owned(address(alice), CAR), 1, "alice owns the car");
        assertEq(gd.balanceOf(address(shop)), 50e18, "the shop holds the price");
        buyReverts(alice, CAR, 1, 50e18, "a car can't be bought twice");
    }

    function testLevelUpsAddUp() public {
        buy(alice, LEVEL, 3, 30e18);
        buy(alice, LEVEL, 1, 10e18);
        assertEq(shop.owned(address(alice), LEVEL), 4, "four level ups");
    }

    function testTheExactPriceOnly() public {
        buyReverts(alice, CAR, 1, 49e18, "too little is refused");
        buyReverts(alice, CAR, 1, 51e18, "too much is refused, so nobody overpays");
        buyReverts(alice, LEVEL, 0, 0, "nothing is not a purchase");
        buyReverts(alice, CAR, 2, 100e18, "two of a car is refused");
        assertEq(gd.balanceOf(address(alice)), 1_000e18, "a refused purchase costs nothing");
    }

    function testThePassBelongsToTheSeason() public {
        buy(alice, PASS_ITEM, 1, 100e18);
        assertTrue(shop.hasPass(address(alice)), "alice has this season's pass");
        buyReverts(alice, PASS_ITEM, 1, 100e18, "one pass a season");
        shop.startSeason(uint64(block.timestamp + 60 days));
        assertTrue(!shop.hasPass(address(alice)), "a new season needs a new pass");
        buy(alice, PASS_ITEM, 1, 100e18);
        assertTrue(shop.hasPass(address(alice)), "and can buy it");
    }

    function testUnlistedAndPausedItemsCantBeBought() public {
        buyReverts(alice, 99, 1, 1e18, "an item that isn't listed");
        shop.setPaused(true);
        buyReverts(alice, CAR, 1, 50e18, "nothing sells while paused");
        shop.setPaused(false);
        buy(alice, CAR, 1, 50e18);
    }

    function testCatalogueAndOwnedBy() public {
        buy(alice, LEVEL, 2, 20e18);
        GameShop.Item[] memory list = shop.catalogue();
        assertEq(list.length, 3, "three items listed");
        assertEq(list[1].price, 10e18, "prices are readable");
        (uint256[] memory ids, uint256[] memory counts) = shop.ownedBy(address(alice));
        assertEq(ids.length, 3, "one count per item");
        assertEq(counts[1], 2, "two level ups");
    }

    function testOwnerTakesTheTakings() public {
        buy(alice, CAR, 1, 50e18);
        shop.withdraw(address(this), 50e18);
        assertEq(gd.balanceOf(address(this)), 50e18, "the owner took the takings");
    }

    function testExploitUnauthorizedCall() public {
        buy(alice, CAR, 1, 50e18);
        expectRevert(mallory, address(shop), abi.encodeCall(shop.withdraw, (address(mallory), 50e18)), "a stranger can't take the takings");
        uint256[] memory ids = new uint256[](1);
        uint256[] memory prices = new uint256[](1);
        uint8[] memory kinds = new uint8[](1);
        uint32[] memory per = new uint32[](1);
        bool[] memory sale = new bool[](1);
        (ids[0], prices[0], kinds[0], per[0], sale[0]) = (CAR, 1, 0, 1, true);
        expectRevert(mallory, address(shop), abi.encodeCall(shop.setItems, (ids, prices, kinds, per, sale)), "a stranger can't change prices");
        expectRevert(mallory, address(shop), abi.encodeCall(shop.startSeason, (uint64(block.timestamp + 1 days))), "a stranger can't start a season");
        expectRevert(mallory, address(shop), abi.encodeCall(shop.setPaused, (true)), "a stranger can't pause the shop");
    }

    function testExploitFreeItemsByCallingTheHookDirectly() public {
        expectRevert(mallory, address(shop), abi.encodeCall(shop.onTokenTransfer, (address(mallory), 50e18, abi.encode(CAR, uint256(1)))), "only G$ can report a payment");
        assertEq(shop.owned(address(mallory), CAR), 0, "mallory got nothing for free");
    }

    function testExploitReentrancy() public {
        // The only way G$ leaves the shop is withdraw, which is owner-only and guarded; a buyer's hook can't re-enter a purchase.
        buy(alice, CAR, 1, 50e18);
        expectRevert(mallory, address(shop), abi.encodeCall(shop.withdraw, (address(mallory), 1)), "no one but the owner moves G$ out");
        assertEq(gd.balanceOf(address(shop)), 50e18, "the takings are all there");
    }
}
`;

const SHOP_TS = `import { useCallback, useEffect, useRef, useState } from "react";
import { encodeAbiParameters, formatUnits, parseUnits, type Abi, type Address } from "viem";

import { publicClient } from "../lib/chain";
import { errorMessage } from "../lib/format";
import { gdTokenAbi } from "../lib/tokens";
import { subscribeWallet, walletState } from "../lib/goodbuild/wallet";
import { sendGameTx } from "./chainTx";

/**
 * The game's shop, paid in G$ (contracts/GameShop.sol). The items are the game's own, described once:
 *   export const SHOP: ShopItem[] = [
 *     { id: 0, name: "Starter", kind: "car", price: "0" },                       // free: everyone has it
 *     { id: 1, name: "Neon GT", kind: "car", price: "50", detail: "Faster" },
 *     { id: 2, name: "Level up", kind: "count", price: "10", detail: "+5% speed" },
 *     { id: 3, name: "Nitro pack", kind: "count", price: "15", perPurchase: 3 },
 *     { id: 4, name: "Season pass", kind: "pass", price: "100", detail: "Double coins and the gold tier" },
 *   ];
 *   const shop = useShop(SHOP, GameShopAbi, GameShopAddress[chain.id]);
 * Then <Store shop={shop} draw={(item) => ...} /> from src/game/Store.tsx. After deploying, the owner
 * sees "Put these items on sale" in the store: one transaction with every price.
 */

export interface ShopItem {
  /** A whole number, the same forever: the contract stores purchases by it. */
  id: number;
  name: string;
  /** "car" (or any thing owned once: a skin), "count" (adds up: level ups, packs), "pass" (the season pass). */
  kind: "car" | "unique" | "count" | "pass";
  /** In G$, as people type it: "50". "0" is free and needs no wallet. */
  price: string;
  /** For a "count" item: how many one purchase gives. */
  perPurchase?: number;
  detail?: string;
}

const KIND = { car: 0, unique: 0, count: 1, pass: 2 } as const;

interface ChainItem {
  id: bigint;
  price: bigint;
  kind: number;
  perPurchase: number;
  forSale: boolean;
}

export type BuyResult = "bought" | "cancelled" | "failed";

/** True when a request failed because the person said no in their wallet. */
const cancelled = (e: unknown) => (e as { code?: unknown })?.code === 4001 || /user (rejected|denied)|rejected the request|cancel/i.test(String((e as Error)?.message ?? e));

export function useShop(items: ShopItem[], abi: Abi | readonly unknown[], address: Address | undefined) {
  const [account, setAccount] = useState<Address | null>(() => walletState().account ?? null);
  const [onChain, setOnChain] = useState<ChainItem[]>([]);
  const [owned, setOwned] = useState<Record<number, number>>({});
  const [pass, setPass] = useState(false);
  const [seasonEnds, setSeasonEnds] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [owner, setOwner] = useState<Address | null>(null);
  const [gd, setGd] = useState<Address | null>(null);
  const [loading, setLoading] = useState(Boolean(address));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "setup" | null>(null);

  useEffect(() => subscribeWallet(() => setAccount(walletState().account ?? null)), []);

  // What one wallet owns never shows for another: clear it the moment the wallet or the shop changes.
  useEffect(() => {
    setOwned({});
    setPass(false);
    setBalance(null);
  }, [account, address]);

  // Only the newest read may set state: an older one finishing late would show another wallet's things.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    const current = () => request === latest.current;
    if (!address) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const read = <T,>(functionName: string, args: unknown[] = []) => publicClient.readContract({ address, abi, functionName, args } as never) as Promise<T>;
      const [list, ownerAddress, gdAddress, ends] = await Promise.all([read<ChainItem[]>("catalogue"), read<Address>("owner"), read<Address>("gd"), read<bigint>("seasonEnds")]);
      if (!current()) return;
      setOnChain([...list]);
      setOwner(ownerAddress);
      setGd(gdAddress);
      setSeasonEnds(Number(ends) * 1000 || null);
      if (account) {
        const [[ids, counts], hasPass, gdBalance] = await Promise.all([
          read<readonly [readonly bigint[], readonly bigint[]]>("ownedBy", [account]),
          read<boolean>("hasPass", [account]),
          publicClient.readContract({ address: gdAddress, abi: gdTokenAbi, functionName: "balanceOf", args: [account] } as never) as Promise<bigint>,
        ]);
        if (!current()) return;
        setOwned(Object.fromEntries(ids.map((id, i) => [Number(id), Number(counts[i])])));
        setPass(hasPass);
        setBalance(gdBalance);
      } else {
        setOwned({});
        setPass(false);
        setBalance(null);
      }
    } catch (e) {
      if (current()) setError(errorMessage(e));
    } finally {
      if (current()) setLoading(false);
    }
  }, [address, abi, account]);

  useEffect(() => {
    void load();
  }, [load]);

  // The pass ends with the season, even while the game stays open past it: re-render then.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pass || !seasonEnds || seasonEnds <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(seasonEnds - Date.now() + 50, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [pass, seasonEnds, now]);
  const passNow = pass && seasonEnds !== null && seasonEnds > now;

  const priceOf = (item: ShopItem): bigint => onChain.find((c) => Number(c.id) === item.id)?.price ?? parseUnits(item.price, 18);
  const forSale = (item: ShopItem) => Boolean(onChain.find((c) => Number(c.id) === item.id)?.forSale);

  /** How many the player has: 1 for an owned car, the count for level ups and packs. Free items are always 1. */
  const count = (item: ShopItem): number => {
    if (Number(item.price) === 0) return 1;
    if (item.kind === "pass") return passNow ? 1 : 0;
    return owned[item.id] ?? 0;
  };
  const owns = (item: ShopItem) => count(item) > 0;

  /** Buy with one G$ payment (transferAndCall). Never throws: read the result and shop.error. */
  const buy = useCallback(
    async (item: ShopItem, quantity = 1): Promise<BuyResult> => {
      if (!address) {
        setError("The shop opens once the game's owner deploys it.");
        return "failed";
      }
      setBusy(item.id);
      setError(null);
      try {
        const token = gd ?? ((await publicClient.readContract({ address, abi, functionName: "gd" } as never)) as Address);
        const amount = priceOf(item) * BigInt(quantity);
        await sendGameTx({ address: token, abi: gdTokenAbi as unknown as Abi, functionName: "transferAndCall", args: [address, amount, encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(item.id), BigInt(quantity)])] });
        await load();
        return "bought";
      } catch (e) {
        if (cancelled(e)) return "cancelled";
        const text = errorMessage(e);
        setError(/insufficient|exceeds balance/i.test(text) ? "You don't have enough G$ for this. Playing stays free." : text);
        return "failed";
      } finally {
        setBusy(null);
      }
    },
    [address, abi, gd, onChain, load],
  );

  const isOwner = Boolean(account && owner && account.toLowerCase() === owner.toLowerCase());
  const paid = items.filter((i) => Number(i.price) > 0);
  /** Items whose price or sale isn't on the contract yet: the owner puts them on sale with setup(). */
  const notOnSale = paid.filter((i) => {
    const c = onChain.find((x) => Number(x.id) === i.id);
    const per = i.kind === "count" ? i.perPurchase ?? 1 : 1;
    return !c || !c.forSale || c.price !== parseUnits(i.price, 18) || c.kind !== KIND[i.kind] || Number(c.perPurchase) !== per;
  });

  /** The owner: put every paid item on sale at the prices in the code, in one transaction. */
  const setup = useCallback(async (): Promise<BuyResult> => {
    if (!address) return "failed";
    setBusy("setup");
    setError(null);
    try {
      await sendGameTx({
        address,
        abi: abi as Abi,
        functionName: "setItems",
        args: [paid.map((i) => BigInt(i.id)), paid.map((i) => parseUnits(i.price, 18)), paid.map((i) => KIND[i.kind]), paid.map((i) => (i.kind === "count" ? i.perPurchase ?? 1 : 1)), paid.map(() => true)],
      });
      await load();
      return "bought";
    } catch (e) {
      if (cancelled(e)) return "cancelled";
      setError(errorMessage(e));
      return "failed";
    } finally {
      setBusy(null);
    }
  }, [address, abi, items, load]);

  return {
    items,
    /** The shop's contract is deployed on this network. */
    open: Boolean(address),
    loading,
    error,
    busy,
    account,
    /** G$ the player holds, as a number to show, or null before a wallet connects. */
    balance: balance === null ? null : Number(formatUnits(balance, 18)),
    priceOf: (item: ShopItem) => Number(formatUnits(priceOf(item), 18)),
    forSale,
    count,
    owns,
    hasPass: passNow,
    /** When the season ends, as a time in milliseconds, or null when no season is running. */
    seasonEnds: seasonEnds && seasonEnds > Date.now() ? seasonEnds : null,
    buy,
    isOwner,
    notOnSale,
    setup,
    refresh: load,
  };
}

export type ShopState = ReturnType<typeof useShop>;
`;

const STORE_TSX = `import { useState, type ReactNode } from "react";
import { Lock, Check } from "lucide-react";

import { Button } from "../components/ui/button";
import { ConnectButton } from "../components/ConnectButton";
import type { ShopItem, ShopState } from "./shop";

/**
 * The store: one card per item with its drawing (pass draw, usually a Sprite of the game's own drawing),
 * its price in G$, and Buy, Owned or how many the player has. Free items are owned by everyone. The
 * owner sees one button to put the items on sale after deploying.
 */
export function Store({ shop, draw, selected, onSelect, className = "" }: { shop: ShopState; draw?: (item: ShopItem, owned: boolean) => ReactNode; selected?: number; onSelect?: (item: ShopItem) => void; className?: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <section className={"space-y-3 " + className} aria-label="Store">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{shop.balance === null ? "Buying needs your wallet and G$. Playing never does." : "You have " + shop.balance.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " G$"}</p>
        {!shop.account && shop.open && <ConnectButton />}
      </div>
      {!shop.open && <p className="rounded-lg bg-muted p-3 text-sm">The store opens once the game's owner deploys it. Free items work already.</p>}
      {shop.isOwner && shop.notOnSale.length > 0 && (
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">You own this shop. {shop.notOnSale.length} item{shop.notOnSale.length === 1 ? " isn't" : "s aren't"} on sale yet.</p>
          <Button className="mt-2 min-h-11" disabled={shop.busy === "setup"} onClick={async () => setSaid((await shop.setup()) === "bought" ? "Your items are on sale." : null)}>
            {shop.busy === "setup" ? "Waiting for your wallet…" : "Put these items on sale"}
          </Button>
        </div>
      )}
      {shop.error && (
        <p className="text-sm text-danger" role="alert">
          {shop.error}
        </p>
      )}
      {said && <p className="text-sm" role="status">{said}</p>}
      <ul className="grid grid-cols-2 gap-3">
        {shop.items.map((item) => {
          const free = Number(item.price) === 0;
          const have = shop.count(item);
          const owned = have > 0;
          const once = item.kind !== "count";
          const price = free ? "Free" : shop.priceOf(item).toLocaleString() + " G$";
          const canBuy = !free && shop.open && shop.forSale(item) && !(once && owned);
          return (
            <li key={item.id} className={"flex flex-col gap-2 rounded-xl border p-3 " + (selected === item.id ? "border-primary" : "border-border")}>
              <div className="relative grid min-h-24 place-items-center rounded-lg bg-muted">
                {draw?.(item, owned)}
                {!owned && !free && <Lock className="absolute right-2 top-2 size-4 text-muted-foreground" aria-hidden />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{item.name}</p>
                {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
                {item.kind === "pass" && shop.seasonEnds && <p className="text-xs text-muted-foreground">Season ends {new Date(shop.seasonEnds).toLocaleDateString()}</p>}
                {item.kind === "count" && have > 0 && <p className="text-xs">You have {have}</p>}
              </div>
              {owned && once ? (
                onSelect && item.kind !== "pass" ? (
                  <Button variant={selected === item.id ? "default" : "outline"} className="min-h-11" onClick={() => onSelect(item)}>
                    {selected === item.id ? (
                      <>
                        <Check className="size-4" /> Using
                      </>
                    ) : (
                      "Use"
                    )}
                  </Button>
                ) : (
                  <p className="text-sm font-medium">{item.kind === "pass" ? "Your pass is active" : "Owned"}</p>
                )
              ) : (
                <Button
                  className="min-h-11"
                  disabled={!canBuy || shop.busy === item.id}
                  onClick={async () => {
                    setSaid(null);
                    const r = await shop.buy(item);
                    if (r === "bought") setSaid(item.name + " is yours.");
                    else if (r === "cancelled") setSaid("Not bought. Nothing was taken.");
                  }}
                >
                  {shop.busy === item.id ? "Waiting for your wallet…" : free ? price : "Buy · " + price}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
`;

const GUIDE = `The game shop. Cars and skins, level ups and power packs, and a season pass, paid in G$. The contract is written and tested: contracts/GameShop.sol and contracts/test/GameShop.t.sol. Don't change them and don't write another shop contract.
- Describe the items once, in the game's code: export const SHOP: ShopItem[] (src/game/shop.ts shows the shape). Each id is a whole number that never changes. kind "car" (or "unique") is owned once, "count" adds up (level ups, packs; perPurchase for packs of several), "pass" is the season pass. price is in G$ as people type it ("50"). The starter car or skin costs "0": everyone owns it with no wallet, so the game is fully playable for free.
- const shop = useShop(SHOP, GameShopAbi, GameShopAddress[chain.id]) once in the game (GameShopAbi and GameShopAddress from the contracts folder, chain from src/lib/chain.ts). Show <Store shop={shop} draw={(item, owned) => <Sprite draw={...} width={96} height={96} />} selected={carId} onSelect={(item) => setCarId(item.id)} /> from src/game/Store.tsx. Draw each item with the game's own drawing function, so the store shows exactly what the race shows.
- In the game: shop.owns(item) unlocks a car; shop.count(levelUp) is the player's level (apply it, for example +5% speed each, with a cap); packs are a bank the player spends in runs (keep how many were used on the device, and never let it go below zero); shop.hasPass gives the pass rewards. Remember the chosen car on the device; fall back to the starter if it isn't owned (another wallet, or not connected).
- Add GameShop to contracts/deploy.json: {"name": "GameShop", "args": {"gd_": "\${GOODDOLLAR}"}}. After deploying, the owner opens the store and taps "Put these items on sale" (one transaction with every price), and starts a season from the contract's startSeason(endsAt) before selling passes: add a small owner-only control for it beside the store, behind shop.isOwner, with a date field.
- Fair play: anything bought is cosmetic or a convenience (a new look, a small boost with a cap). Never something that decides a leaderboard with prizes. Say in the store that playing is free.
- Wording: "G$" for prices, "Buy", "Owned", "Use". Show the player's G$ balance (shop.balance). When they don't have enough, say so and that playing stays free. In MiniPay the network fee is paid in a dollar coin (src/game/chainTx.ts does this), and G$ purchases work there (the owner tested it on a phone, 11 Nov 2026).
- Tell the owner in your reply: deploy the shop, then put the items on sale from the store, then start the first season.`;

/** Words that mean a game sells things (with the game kit on: see the runner). */
export const SHOP_WORDS = /\b(in[- ]app (?:store|shop|purchases?)|store|shop|season pass|battle pass|garage|level[- ]?ups?|skins?|buy (?:new )?(?:cars|skins|upgrades|items|power[- ]?ups)|purchases?)\b/i;

export const gameShop: Kit = {
  id: "game-shop",
  title: "Game shop (G$)",
  when: "a game that sells things for G$: cars, skins, level ups, power packs or a season pass",
  // Never by its words alone: a bookshop isn't a game. The runner turns it on for a game whose request says it sells things.
  keywords: /(?!)/,
  packages: {},
  files: {
    "contracts/GameShop.sol": GAME_SHOP_SOL,
    "contracts/test/GameShop.t.sol": GAME_SHOP_TEST,
    "src/game/shop.ts": SHOP_TS,
    "src/game/Store.tsx": STORE_TSX,
  },
  guide: GUIDE,
};
