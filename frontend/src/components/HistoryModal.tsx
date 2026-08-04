import { useEffect, useState } from "react";
import { fetchEanHistory } from "../api";
import { useCart } from "../CartContext";
import { CHAIN_COLORS, chainColorStyle } from "../chainColors";
import type { EanHistoryResponse, ProductGroup } from "../types";
import { LineChart, type ChartSeries } from "./LineChart";
import { ProductDetailSection } from "./ProductDetailSection";

interface HistoryModalProps {
  group: ProductGroup;
  onClose: () => void;
}

export function HistoryModal({ group, onClose }: HistoryModalProps) {
  const [data, setData] = useState<EanHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addItem } = useCart();

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    // Scope history to the same chains already shown in the accordion
    // (group.members) rather than re-deriving "visible chains" separately —
    // these are exactly the stores the user is currently seeing this
    // product from.
    fetchEanHistory(
      group.ean,
      group.members.map((m) => m.chain),
    )
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [group.ean, group.members]);

  function buildSeries(pick: (points: EanHistoryResponse["chains"][number]["points"][number]) => number | null): ChartSeries[] {
    if (!data) return [];
    return data.chains.map((c) => ({
      label: c.chain,
      color: CHAIN_COLORS[c.chain]?.primary ?? "gray",
      points: c.points
        .map((p) => ({ x: new Date(p.changedAt), y: pick(p) }))
        .filter((p): p is { x: Date; y: number } => p.y !== null),
    }));
  }

  const pricePoints = buildSeries((p) => p.price);
  const unitPricePoints = buildSeries((p) => p.comparePricePerUnit);
  const anyCompareUnit = data?.chains.find((c) => c.compareUnit)?.compareUnit ?? null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{group.members[0].title}</h2>
            {group.hasDataMismatch && <div className="mismatch-note">⚠ {group.mismatchNote}</div>}
          </div>
          <button onClick={onClose}>Lukk</button>
        </div>

        <button className="add-to-cart-button" onClick={() => addItem(group)}>
          + Legg i handlekurv
        </button>

        <div className="store-price-list">
          {group.members.map((m) => (
            <div key={`${m.chain}-${m.id}`} className="store-price-row">
              <span className="chain-badge" style={chainColorStyle(m.chain)}>
                {m.chain}
              </span>
              <div className="store-price-info">
                <div className="product-subtitle">{m.subtitle}</div>
                <div className="price-main">{m.price !== null ? `${m.price.toFixed(2)} kr` : "—"}</div>
              </div>
              {m.productUrl && (
                <a
                  className="external-link-text"
                  href={m.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Åpne hos {m.chain} ↗
                </a>
              )}
            </div>
          ))}
        </div>

        {error && <div className="empty-state">Klarte ikke å hente prishistorikk: {error}</div>}

        <ProductDetailSection productId={group.representative.id} ean={group.representative.ean} />

        {data && (
          <>
            <div className="chart-title">Pris over tid (kr)</div>
            <LineChart series={pricePoints} unitLabel="kr" />

            {anyCompareUnit && (
              <>
                <div className="chart-title">Enhetspris over tid (kr/{anyCompareUnit})</div>
                <LineChart series={unitPricePoints} unitLabel={`kr/${anyCompareUnit}`} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
