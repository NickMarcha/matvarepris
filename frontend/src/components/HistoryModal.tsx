import { useEffect, useState } from "react";
import { fetchProductHistory } from "../api";
import { useCart } from "../CartContext";
import type { ProductHistoryResponse } from "../types";
import { LineChart } from "./LineChart";
import { ProductDetailSection } from "./ProductDetailSection";

interface HistoryModalProps {
  productId: number;
  onClose: () => void;
}

export function HistoryModal({ productId, onClose }: HistoryModalProps) {
  const [data, setData] = useState<ProductHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addItem } = useCart();

  useEffect(() => {
    let cancelled = false;
    fetchProductHistory(productId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const pricePoints =
    data?.history
      .filter((h) => h.price !== null)
      .map((h) => ({ x: new Date(h.changedAt), y: h.price as number })) ?? [];

  const unitPricePoints =
    data?.history
      .filter((h) => h.comparePricePerUnit !== null)
      .map((h) => ({ x: new Date(h.changedAt), y: h.comparePricePerUnit as number })) ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{data?.product.title ?? "Loading…"}</h2>
            {data?.product.subtitle && <div className="product-subtitle">{data.product.subtitle}</div>}
            {data?.product.productUrl && (
              <a
                className="external-link-text"
                href={data.product.productUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Åpne hos {data.product.chain} ↗
              </a>
            )}
          </div>
          <button onClick={onClose}>Close</button>
        </div>

        {data && (
          <button className="add-to-cart-button" onClick={() => addItem(data.product)}>
            + Legg i handlekurv
          </button>
        )}

        {error && <div className="empty-state">Failed to load history: {error}</div>}

        {data && (
          <>
            <ProductDetailSection productId={data.product.id} ean={data.product.ean} />

            <div className="chart-title">Price over time (kr)</div>
            <LineChart points={pricePoints} color="var(--series-price)" unitLabel="kr" />

            {data.product.compareUnit && (
              <>
                <div className="chart-title">Unit price over time (kr/{data.product.compareUnit})</div>
                <LineChart points={unitPricePoints} color="var(--series-unit)" unitLabel={`kr/${data.product.compareUnit}`} />
              </>
            )}

            {data.history.length === 0 && (
              <div className="loading-state">
                No price changes recorded yet for this product — it will show a history after the catalog is
                refreshed a few times and the price actually changes.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
