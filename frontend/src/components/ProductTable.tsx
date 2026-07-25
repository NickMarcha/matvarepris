import type { Product, SortKey, SortOrder } from "../types";
import { chainColorStyle } from "../chainColors";

interface ProductTableProps {
  items: Product[];
  sort: SortKey;
  order: SortOrder;
  onSortChange: (sort: SortKey) => void;
  onSelect: (product: Product) => void;
  onAddToCart: (product: Product) => void;
  showNutritionColumns: boolean;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Produkt" },
  { key: "category", label: "Kategori" },
  { key: "price", label: "Pris" },
  { key: "unitPrice", label: "Enhetspris" },
  { key: "discountPercent", label: "Rabatt %" },
  { key: "discountAmount", label: "Rabatt kr" },
];

const NUTRITION_COLUMNS: { key: SortKey; label: string; unit: string; get: (p: Product) => number | null }[] = [
  { key: "calories", label: "Kalorier", unit: "kcal", get: (p) => p.nutrition.energyKcal },
  { key: "carbs", label: "Karbo", unit: "g", get: (p) => p.nutrition.carbs },
  { key: "carbsPercent", label: "Karbo %", unit: "%", get: (p) => p.nutrition.carbsPercent },
  { key: "netCarbs", label: "Netto karbo", unit: "g", get: (p) => p.nutrition.netCarbs },
  { key: "sugar", label: "Sukker", unit: "g", get: (p) => p.nutrition.sugars },
  { key: "fiber", label: "Fiber", unit: "g", get: (p) => p.nutrition.fiber },
  { key: "fat", label: "Fett", unit: "g", get: (p) => p.nutrition.fat },
  { key: "fatPercent", label: "Fett %", unit: "%", get: (p) => p.nutrition.fatPercent },
  { key: "saturatedFat", label: "hvorav mettet", unit: "g", get: (p) => p.nutrition.saturatedFat },
  { key: "protein", label: "Protein", unit: "g", get: (p) => p.nutrition.protein },
  { key: "proteinPercent", label: "Protein %", unit: "%", get: (p) => p.nutrition.proteinPercent },
  { key: "salt", label: "Salt", unit: "g", get: (p) => p.nutrition.salt },
];

export function ProductTable({
  items,
  sort,
  order,
  onSortChange,
  onSelect,
  onAddToCart,
  showNutritionColumns,
}: ProductTableProps) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} className="sortable" onClick={() => onSortChange(col.key)}>
                {col.label}
                {sort === col.key && <span className="sort-arrow">{order === "asc" ? "▲" : "▼"}</span>}
              </th>
            ))}
            {showNutritionColumns &&
              NUTRITION_COLUMNS.map((col) => (
                <th key={col.key} className="sortable" onClick={() => onSortChange(col.key)}>
                  {col.label}
                  {sort === col.key && <span className="sort-arrow">{order === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            <th>Kjede</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={`${p.chain}-${p.id}`}>
              <td>
                <div className="product-cell">
                  {p.imageUrl && <img className="product-thumb" src={p.imageUrl} alt="" loading="lazy" />}
                  <div>
                    <div className="product-title">
                      {p.title}
                      {p.productUrl && (
                        <a
                          className="external-link"
                          href={p.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Åpne hos ${p.chain}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          ↗
                        </a>
                      )}
                    </div>
                    {p.subtitle && <div className="product-subtitle">{p.subtitle}</div>}
                  </div>
                </div>
              </td>
              <td>{p.category ?? "—"}</td>
              <td>
                {p.originalPrice !== null && (
                  <div className="price-original">{p.originalPrice.toFixed(2)} kr</div>
                )}
                <div className="price-main">{p.price !== null ? `${p.price.toFixed(2)} kr` : "—"}</div>
              </td>
              <td>
                <div className="price-unit">
                  {p.comparePricePerUnit !== null && p.compareUnit
                    ? `${p.comparePricePerUnit.toFixed(2)} kr/${p.compareUnit}`
                    : "—"}
                </div>
              </td>
              <td>
                {p.discountPercent !== null ? (
                  <span className="discount-percent">−{p.discountPercent}%</span>
                ) : (
                  "—"
                )}
              </td>
              <td>
                {p.discountAmount !== null ? (
                  <span className="discount-amount">−{p.discountAmount.toFixed(2)} kr</span>
                ) : (
                  "—"
                )}
              </td>
              {showNutritionColumns &&
                NUTRITION_COLUMNS.map((col) => {
                  const value = col.get(p);
                  return (
                    <td key={col.key} className="nutrition-cell">
                      {value !== null ? (col.unit === "%" ? `${value}%` : `${value} ${col.unit}`) : "—"}
                    </td>
                  );
                })}
              <td>
                <span className="chain-badge" style={chainColorStyle(p.chain)}>
                  {p.chain}
                </span>
              </td>
              <td>
                {p.isOffer && <span className="badge-offer">TILBUD</span>}{" "}
                {p.isOutOfStock && <span className="badge-oos">UTSOLGT</span>}
              </td>
              <td>
                <div className="row-actions">
                  <button className="details-button" onClick={() => onSelect(p)}>
                    Detaljer
                  </button>
                  <button className="add-to-cart-button" onClick={() => onAddToCart(p)}>
                    + Kurv
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
