import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CartItem, Product } from "./types";

const STORAGE_KEY = "matvarepris_cart";

interface CartContextValue {
  items: CartItem[];
  addItem: (product: Product) => void;
  removeItem: (productId: number) => void;
  setQuantity: (productId: number, quantity: number) => void;
  clear: () => void;
  totalCount: number;
  totalPrice: number;
  subtotalsByChain: { chain: string; total: number; count: number }[];
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

  function addItem(product: Product) {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) => (i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      const newItem: CartItem = {
        productId: product.id,
        chain: product.chain,
        ean: product.ean,
        title: product.title,
        subtitle: product.subtitle,
        price: product.price,
        compareUnit: product.compareUnit,
        comparePricePerUnit: product.comparePricePerUnit,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
        quantity: 1,
      };
      return [...prev, newItem];
    });
  }

  function removeItem(productId: number) {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  function setQuantity(productId: number, quantity: number) {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, quantity } : i)));
  }

  function clear() {
    setItems([]);
  }

  const totalCount = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);
  const totalPrice = useMemo(
    () => items.reduce((sum, i) => sum + (i.price ?? 0) * i.quantity, 0),
    [items],
  );
  const subtotalsByChain = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const i of items) {
      const entry = map.get(i.chain) ?? { total: 0, count: 0 };
      entry.total += (i.price ?? 0) * i.quantity;
      entry.count += i.quantity;
      map.set(i.chain, entry);
    }
    return Array.from(map.entries()).map(([chain, v]) => ({ chain, ...v }));
  }, [items]);

  return (
    <CartContext.Provider
      value={{ items, addItem, removeItem, setQuantity, clear, totalCount, totalPrice, subtotalsByChain }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
