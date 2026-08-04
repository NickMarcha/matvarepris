import { useEffect, useState } from "react";
import { fetchCartPricing } from "../api";
import { useCart } from "../CartContext";
import { chainColorStyle, sortByChainOrder } from "../chainColors";
import type { CartItem, CartPricingEntry, Chain, CartPricingResponse } from "../types";

interface CartDrawerProps {
  onClose: () => void;
  chains: Chain[];
  hiddenChains: string[];
}

interface StoreTotal {
  chain: string;
  displayName: string;
  total: number;
  missingCount: number;
  urls: string[];
}

function isAvailable(e: CartPricingEntry): boolean {
  return e.price !== null && !e.isOutOfStock && e.isForSale;
}

// Every entry currently on offer for this item, restricted to chains the
// user hasn't hidden in Settings.
function availableEntries(item: CartItem, pricing: CartPricingResponse | null, visibleChains: Chain[]): CartPricingEntry[] {
  const visibleKeys = new Set(visibleChains.map((c) => c.key));
  return (pricing?.items[item.ean] ?? []).filter((e) => visibleKeys.has(e.chain) && isAvailable(e));
}

function cheapest(entries: CartPricingEntry[]): CartPricingEntry | null {
  return entries.reduce<CartPricingEntry | null>(
    (best, e) => (best === null || (e.price as number) < (best.price as number) ? e : best),
    null,
  );
}

// All non-empty subsets of a small array (chain count is always tiny — at
// most a handful of NorgesGruppen chains), smallest subsets first so callers
// can stop at the first size that satisfies a coverage requirement.
function nonEmptySubsets<T>(arr: T[]): T[][] {
  const result: T[][] = [];
  for (let mask = 1; mask < 1 << arr.length; mask++) {
    const subset: T[] = [];
    for (let i = 0; i < arr.length; i++) if (mask & (1 << i)) subset.push(arr[i]);
    result.push(subset);
  }
  return result.sort((a, b) => a.length - b.length);
}

export function CartDrawer({ onClose, chains, hiddenChains }: CartDrawerProps) {
  const { items, removeItem, setQuantity, clear } = useCart();
  const [pricing, setPricing] = useState<CartPricingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [popupWarning, setPopupWarning] = useState(false);

  const visibleChains = chains.filter((c) => !hiddenChains.includes(c.key));
  const eansKey = items.map((i) => i.ean).join(",");
  const chainsKey = visibleChains.map((c) => c.key).join(",");

  useEffect(() => {
    if (items.length === 0) {
      setPricing(null);
      return;
    }
    setLoading(true);
    fetchCartPricing(
      items.map((i) => i.ean),
      visibleChains.map((c) => c.key),
    )
      .then((res) => {
        setPricing(res);
        setError(null);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eansKey, chainsKey]);

  // "What would my whole basket cost at each store" — only counts items that
  // store actually has in stock/for sale; missingCount tracks the rest so a
  // low total from a store that can't fulfill most of the cart doesn't read
  // as a false bargain.
  const storeTotals: StoreTotal[] = visibleChains.map((chain) => {
    let total = 0;
    let missingCount = 0;
    const urls: string[] = [];
    for (const item of items) {
      const entry = availableEntries(item, pricing, visibleChains).find((e) => e.chain === chain.key);
      if (entry) {
        total += (entry.price as number) * item.quantity;
        if (entry.productUrl) urls.push(entry.productUrl);
      } else {
        missingCount++;
      }
    }
    return { chain: chain.key, displayName: chain.displayName, total, missingCount, urls };
  });

  const sortedTotals = [...storeTotals].sort((a, b) => {
    const aFull = a.missingCount === 0 ? 0 : 1;
    const bFull = b.missingCount === 0 ? 0 : 1;
    if (aFull !== bFull) return aFull - bFull;
    return a.total - b.total;
  });

  const noSingleStoreCoversEverything = pricing !== null && !sortedTotals.some((s) => s.missingCount === 0);

  // Cheapest way to cover the whole cart using as few stores as possible —
  // group subsets by size, find the smallest size where at least one subset
  // covers every cart item, then keep the cheapest subset of that size
  // (buying each item at whichever store in the subset is cheaper for it).
  let minStoreCombo: { subset: Chain[]; total: number } | null = null;
  if (pricing && noSingleStoreCoversEverything && visibleChains.length > 1) {
    const subsetsBySize = new Map<number, Chain[][]>();
    for (const subset of nonEmptySubsets(visibleChains)) {
      if (subset.length < 2) continue; // size 1 is already covered by storeTotals above
      (subsetsBySize.get(subset.length) ?? subsetsBySize.set(subset.length, []).get(subset.length)!).push(subset);
    }
    for (const size of Array.from(subsetsBySize.keys()).sort((a, b) => a - b)) {
      const covering = subsetsBySize.get(size)!.filter((subset) =>
        items.every((item) => availableEntries(item, pricing, visibleChains).some((e) => subset.some((c) => c.key === e.chain))),
      );
      if (covering.length === 0) continue;
      for (const subset of covering) {
        let total = 0;
        for (const item of items) {
          const entries = availableEntries(item, pricing, visibleChains).filter((e) => subset.some((c) => c.key === e.chain));
          total += (cheapest(entries)!.price as number) * item.quantity;
        }
        if (minStoreCombo === null || total < minStoreCombo.total) minStoreCombo = { subset, total };
      }
      break; // found the minimum covering size — larger sizes aren't "minimum stores" anymore
    }
  }

  // Absolute floor: cheapest available price per item, wherever it is, with
  // no constraint on how many different stores that ends up requiring.
  let theoreticalMinimum: { total: number; chainsUsed: Set<string> } | null = null;
  if (pricing && visibleChains.length > 1) {
    let total = 0;
    const chainsUsed = new Set<string>();
    for (const item of items) {
      const best = cheapest(availableEntries(item, pricing, visibleChains));
      if (!best) continue;
      total += (best.price as number) * item.quantity;
      chainsUsed.add(best.chain);
    }
    theoreticalMinimum = { total, chainsUsed };
  }

  function handleOpen(urls: string[]) {
    let blocked = 0;
    for (const url of Array.from(new Set(urls))) {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) blocked++;
    }
    if (blocked > 0) setPopupWarning(true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal cart-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Handlekurv</h2>
          <button onClick={onClose}>Lukk</button>
        </div>

        {items.length === 0 && <div className="empty-state">Handlekurven er tom.</div>}

        {items.length > 0 && (
          <>
            <div className="cart-items">
              {items.map((item) => {
                const entries = availableEntries(item, pricing, visibleChains);
                const cheapestEntry = cheapest(entries);
                const cheapestUnit = entries.reduce<CartPricingEntry | null>(
                  (best, e) =>
                    e.compareUnitPrice !== null && (best === null || (e.compareUnitPrice as number) < (best.compareUnitPrice as number))
                      ? e
                      : best,
                  null,
                );
                return (
                  <div key={item.ean} className="cart-item">
                    {item.imageUrl && <img className="product-thumb" src={item.imageUrl} alt="" />}
                    <div className="cart-item-info">
                      <div className="product-title">{item.title}</div>
                      {item.subtitle && <div className="product-subtitle">{item.subtitle}</div>}
                      {pricing && (
                        <div className="cart-item-pricing">
                          {cheapestEntry && (
                            <span className="cart-item-price">fra {cheapestEntry.price!.toFixed(2)} kr</span>
                          )}
                          {cheapestUnit && cheapestUnit.compareUnit && (
                            <span className="cart-item-unit-price">
                              fra {cheapestUnit.compareUnitPrice!.toFixed(2)} kr/{cheapestUnit.compareUnit}
                            </span>
                          )}
                          <span className="chain-badge-group">
                            {entries.length === 0 && <span className="cart-missing-note">ikke tilgjengelig</span>}
                            {sortByChainOrder(entries, (e) => e.chain).map((e) => (
                              <span key={e.chain} className="chain-badge" style={chainColorStyle(e.chain)}>
                                {e.chain}
                              </span>
                            ))}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="cart-item-qty">
                      <button onClick={() => setQuantity(item.ean, item.quantity - 1)}>−</button>
                      <span>{item.quantity}</span>
                      <button onClick={() => setQuantity(item.ean, item.quantity + 1)}>+</button>
                    </div>
                    <button className="link-button" onClick={() => removeItem(item.ean)}>
                      Fjern
                    </button>
                  </div>
                );
              })}
            </div>

            {loading && <div className="loading-state">Henter priser…</div>}
            {error && <div className="empty-state">Klarte ikke å hente priser: {error}</div>}

            {!loading && pricing && (
              <div className="cart-subtotals">
                <div className="nutrition-filters-title">Totalt per butikk</div>
                {sortedTotals.map((s, i) => (
                  <div key={s.chain} className="cart-subtotal-row">
                    <span>
                      <span className="chain-badge" style={chainColorStyle(s.chain)}>
                        {s.chain}
                      </span>{" "}
                      {i === 0 && s.missingCount === 0 && <span className="cart-cheapest-tag">billigst</span>}
                      {s.missingCount > 0 && (
                        <span className="cart-missing-note">
                          {" "}
                          (mangler {s.missingCount} vare{s.missingCount === 1 ? "" : "r"})
                        </span>
                      )}
                    </span>
                    <span className="cart-subtotal-right">
                      {s.total.toFixed(2)} kr
                      {s.urls.length > 0 && (
                        <button className="link-button" onClick={() => handleOpen(s.urls)}>
                          Åpne {s.urls.length} sider ↗
                        </button>
                      )}
                    </span>
                  </div>
                ))}

                {minStoreCombo && (
                  <>
                    <div className="nutrition-filters-title cart-combo-title">
                      Billigst med færrest mulig butikker ({minStoreCombo.subset.length} butikker)
                    </div>
                    <div className="cart-subtotal-row">
                      <span className="chain-badge-group">
                        {sortByChainOrder(minStoreCombo.subset, (c) => c.key).map((c) => (
                          <span key={c.key} className="chain-badge" style={chainColorStyle(c.key)}>
                            {c.key}
                          </span>
                        ))}
                      </span>
                      <span className="cart-subtotal-right">{minStoreCombo.total.toFixed(2)} kr</span>
                    </div>
                  </>
                )}

                {theoreticalMinimum && (
                  <>
                    <div className="nutrition-filters-title cart-combo-title">
                      Teoretisk minimum (billigst per vare, {theoreticalMinimum.chainsUsed.size} butikker)
                    </div>
                    <div className="cart-subtotal-row">
                      <span className="chain-badge-group">
                        {sortByChainOrder(Array.from(theoreticalMinimum.chainsUsed), (k) => k).map((chainKey) => (
                          <span key={chainKey} className="chain-badge" style={chainColorStyle(chainKey)}>
                            {chainKey}
                          </span>
                        ))}
                      </span>
                      <span className="cart-subtotal-right">{theoreticalMinimum.total.toFixed(2)} kr</span>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="cart-footnote">
              Prisene hentes live fra siste datainnsamling, ikke lagret fra da du la varen i kurven. Eks.
              frakt/pakkegebyr — se hos butikken ved bestilling. Dette nettstedet bestiller ikke noe for deg — bruk
              «Åpne sider» for å legge varene i handlekurven hos riktig butikk selv.
            </div>

            {popupWarning && (
              <div className="popup-warning">
                Nettleseren blokkerte noen av fanene. Klikk sprettoppvindu-ikonet i adressefeltet (til høyre i
                søkefeltet) og velg <strong>«Alltid tillat sprettoppvinduer fra denne siden»</strong>, trykk
                deretter på knappen igjen — da åpnes alle fanene.
                <button className="link-button" onClick={() => setPopupWarning(false)}>
                  Skjul
                </button>
              </div>
            )}

            <button className="cart-clear-button" onClick={clear}>
              Tøm handlekurv
            </button>
          </>
        )}
      </div>
    </div>
  );
}
