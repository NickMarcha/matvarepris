import { useState } from "react";
import { useCart } from "../CartContext";
import type { CartItem } from "../types";

interface CartDrawerProps {
  onClose: () => void;
}

const CHAIN_LABELS: Record<string, string> = { meny: "Meny", spar: "Spar", joker: "Joker" };

function openProductPages(items: CartItem[]): { opened: number; blocked: number } {
  const urls = Array.from(new Set(items.map((i) => i.productUrl).filter((u): u is string => Boolean(u))));
  let opened = 0;
  let blocked = 0;
  for (const url of urls) {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (win) {
      opened++;
    } else {
      blocked++;
    }
  }
  return { opened, blocked };
}

export function CartDrawer({ onClose }: CartDrawerProps) {
  const { items, removeItem, setQuantity, clear, totalPrice, subtotalsByChain } = useCart();
  const [popupWarning, setPopupWarning] = useState(false);

  function handleOpen(chainItems: CartItem[]) {
    const { blocked } = openProductPages(chainItems);
    if (blocked > 0) setPopupWarning(true);
  }

  const itemsWithUrl = items.filter((i) => i.productUrl);
  const uniqueUrlCount = new Set(itemsWithUrl.map((i) => i.productUrl)).size;
  const missingUrlCount = items.length - itemsWithUrl.length;

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
              {items.map((item) => (
                <div key={item.productId} className="cart-item">
                  {item.imageUrl && <img className="product-thumb" src={item.imageUrl} alt="" />}
                  <div className="cart-item-info">
                    <div className="product-title">{item.title}</div>
                    {item.subtitle && <div className="product-subtitle">{item.subtitle}</div>}
                    <div className="cart-item-meta">
                      <span className="chain-badge">{item.chain}</span>
                      {item.price !== null && <span>{item.price.toFixed(2)} kr</span>}
                      {item.comparePricePerUnit !== null && item.compareUnit && (
                        <span className="price-unit">
                          {item.comparePricePerUnit.toFixed(2)} kr/{item.compareUnit}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="cart-item-qty">
                    <button onClick={() => setQuantity(item.productId, item.quantity - 1)}>−</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => setQuantity(item.productId, item.quantity + 1)}>+</button>
                  </div>
                  <div className="cart-item-total">
                    {item.price !== null ? `${(item.price * item.quantity).toFixed(2)} kr` : "—"}
                  </div>
                  <button className="link-button" onClick={() => removeItem(item.productId)}>
                    Fjern
                  </button>
                </div>
              ))}
            </div>

            <div className="cart-subtotals">
              {subtotalsByChain.map((s) => {
                const chainItems = itemsWithUrl.filter((i) => i.chain === s.chain);
                return (
                  <div key={s.chain} className="cart-subtotal-row">
                    <span>
                      {CHAIN_LABELS[s.chain] ?? s.chain} ({s.count} stk)
                    </span>
                    <span className="cart-subtotal-right">
                      {s.total.toFixed(2)} kr
                      {chainItems.length > 0 && (
                        <button className="link-button" onClick={() => handleOpen(chainItems)}>
                          Åpne {chainItems.length} sider ↗
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="cart-total-row">
              <span>Totalt</span>
              <span>{totalPrice.toFixed(2)} kr</span>
            </div>
            <div className="cart-footnote">Eks. frakt/pakkegebyr — se hos butikken ved bestilling.</div>

            <button
              className="add-to-cart-button cart-open-all-button"
              disabled={uniqueUrlCount === 0}
              onClick={() => handleOpen(itemsWithUrl)}
            >
              Åpne alle produktsider ({uniqueUrlCount}) ↗
            </button>
            <div className="cart-footnote">
              Åpner hvert produkt i en ny fane hos riktig butikk, slik at du kan legge dem i handlekurven der selv
              — dette nettstedet bestiller ikke noe for deg.
              {missingUrlCount > 0 && ` (${missingUrlCount} vare(r) mangler produktlenke.)`}
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
