import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CartItem, ProductGroup } from "./types";

const STORAGE_KEY = "matvarepris_cart";

interface CartContextValue {
  items: CartItem[];
  addItem: (group: ProductGroup) => void;
  removeItem: (ean: string) => void;
  setQuantity: (ean: string, quantity: number) => void;
  clear: () => void;
  totalCount: number;
}

const CartContext = createContext<CartContextValue | null>(null);

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => loadCart());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  function addItem(group: ProductGroup) {
    setItems((prev) => {
      const existing = prev.find((i) => i.ean === group.ean);
      if (existing) {
        return prev.map((i) => (i.ean === group.ean ? { ...i, quantity: i.quantity + 1 } : i));
      }
      // Cheapest member as the display headline — same convention
      // GroupedProductTable already uses for a merged product's title/image.
      const headline = group.members[0];
      const newItem: CartItem = {
        ean: group.ean,
        title: headline.title,
        subtitle: headline.subtitle,
        imageUrl: headline.imageUrl,
        quantity: 1,
      };
      return [...prev, newItem];
    });
  }

  function removeItem(ean: string) {
    setItems((prev) => prev.filter((i) => i.ean !== ean));
  }

  function setQuantity(ean: string, quantity: number) {
    if (quantity <= 0) {
      removeItem(ean);
      return;
    }
    setItems((prev) => prev.map((i) => (i.ean === ean ? { ...i, quantity } : i)));
  }

  function clear() {
    setItems([]);
  }

  const totalCount = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, setQuantity, clear, totalCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
