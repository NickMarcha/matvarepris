import { Fragment, useState } from "react";
import type { Product, ProductGroup, SortKey, SortOrder } from "../types";
import { chainColorStyle, sortByChainOrder } from "../chainColors";

interface GroupedProductTableProps {
  groups: ProductGroup[];
  sort: SortKey;
  order: SortOrder;
  onSortChange: (sort: SortKey) => void;
  onSelect: (group: ProductGroup) => void;
  onAddToCart: (group: ProductGroup) => void;
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

function nutritionCells(product: Product) {
  return NUTRITION_COLUMNS.map((col) => {
    const value = col.get(product);
    return (
      <td key={col.key} className="nutrition-cell">
        {value !== null ? (col.unit === "%" ? `${value}%` : `${value} ${col.unit}`) : "—"}
      </td>
    );
  });
}

function priceCell(product: Product) {
  return (
    <td>
      {product.originalPrice !== null && <div className="price-original">{product.originalPrice.toFixed(2)} kr</div>}
      <div className="price-main">{product.price !== null ? `${product.price.toFixed(2)} kr` : "—"}</div>
    </td>
  );
}

function unitPriceCell(product: Product) {
  return (
    <td>
      <div className="price-unit">
        {product.comparePricePerUnit !== null && product.compareUnit
          ? `${product.comparePricePerUnit.toFixed(2)} kr/${product.compareUnit}`
          : "—"}
      </div>
    </td>
  );
}

function discountCells(product: Product) {
  return (
    <>
      <td>
        {product.discountPercent !== null ? (
          <span className="discount-percent">−{product.discountPercent}%</span>
        ) : (
          "—"
        )}
      </td>
      <td>
        {product.discountAmount !== null ? (
          <span className="discount-amount">−{product.discountAmount.toFixed(2)} kr</span>
        ) : (
          "—"
        )}
      </td>
    </>
  );
}

function statusCell(product: Product) {
  return (
    <td>
      {product.isOffer && <span className="badge-offer">TILBUD</span>}{" "}
      {product.isOutOfStock && <span className="badge-oos">UTSOLGT</span>}
    </td>
  );
}

export function GroupedProductTable({
  groups,
  sort,
  order,
  onSortChange,
  onSelect,
  onAddToCart,
  showNutritionColumns,
}: GroupedProductTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(ean: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ean)) next.delete(ean);
      else next.add(ean);
      return next;
    });
  }

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
          {groups.map((group) => {
            const headline = group.members[0];
            const isMulti = group.memberCount > 1;
            const isExpanded = expanded.has(group.ean);

            return (
              <Fragment key={group.ean}>
                <tr>
                  <td>
                    <div className="product-cell">
                      {isMulti && (
                        <button
                          className="expand-toggle"
                          onClick={() => toggleExpanded(group.ean)}
                          title={isExpanded ? "Skjul butikker" : "Vis butikker"}
                        >
                          {isExpanded ? "▾" : "▸"}
                        </button>
                      )}
                      {headline.imageUrl && (
                        <img className="product-thumb" src={headline.imageUrl} alt="" loading="lazy" />
                      )}
                      <div>
                        <div className="product-title">
                          {headline.title}
                          {group.hasDataMismatch && (
                            <span className="mismatch-flag" title={group.mismatchNote ?? undefined}>
                              {" "}
                              ⚠
                            </span>
                          )}
                          {headline.productUrl && (
                            <a
                              className="external-link"
                              href={headline.productUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Åpne hos ${headline.chain}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              ↗
                            </a>
                          )}
                        </div>
                        {headline.subtitle && <div className="product-subtitle">{headline.subtitle}</div>}
                      </div>
                    </div>
                  </td>
                  <td>{headline.category ?? "—"}</td>
                  {isMulti ? (
                    <>
                      <td>
                        <div className="price-main">
                          {group.cheapestPrice !== null ? `fra ${group.cheapestPrice.toFixed(2)} kr` : "—"}
                        </div>
                      </td>
                      <td>
                        <div className="price-unit">
                          {group.cheapestUnitPrice !== null && headline.compareUnit
                            ? `fra ${group.cheapestUnitPrice.toFixed(2)} kr/${headline.compareUnit}`
                            : "—"}
                        </div>
                      </td>
                      <td>
                        {group.bestDiscountPercent !== null ? (
                          <span className="discount-percent">−{group.bestDiscountPercent}%</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {group.bestDiscountAmount !== null ? (
                          <span className="discount-amount">−{group.bestDiscountAmount.toFixed(2)} kr</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      {priceCell(headline)}
                      {unitPriceCell(headline)}
                      {discountCells(headline)}
                    </>
                  )}
                  {showNutritionColumns && nutritionCells(group.representative)}
                  <td>
                    <div className="chain-badge-group">
                      {sortByChainOrder(group.members, (m) => m.chain).map((m) => (
                        <span key={m.chain} className="chain-badge" style={chainColorStyle(m.chain)}>
                          {m.chain}
                        </span>
                      ))}
                    </div>
                  </td>
                  {isMulti ? (
                    <td>
                      {group.anyOnOffer && <span className="badge-offer">TILBUD</span>}{" "}
                      {!group.anyInStock && <span className="badge-oos">UTSOLGT</span>}
                    </td>
                  ) : (
                    statusCell(headline)
                  )}
                  <td>
                    <div className="row-actions">
                      <button className="details-button" onClick={() => onSelect(group)}>
                        Detaljer
                      </button>
                      <button className="add-to-cart-button" onClick={() => onAddToCart(group)}>
                        + Kurv
                      </button>
                    </div>
                  </td>
                </tr>
                {isMulti &&
                  isExpanded &&
                  group.members.map((member) => (
                    <tr key={`${group.ean}-${member.chain}-${member.id}`} className="product-subrow">
                      <td>
                        <div className="product-cell product-subrow-cell">
                          <div>
                            <div className="product-title">
                              {member.title}
                              {member.productUrl && (
                                <a
                                  className="external-link"
                                  href={member.productUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={`Åpne hos ${member.chain}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  ↗
                                </a>
                              )}
                            </div>
                            {member.subtitle && <div className="product-subtitle">{member.subtitle}</div>}
                          </div>
                        </div>
                      </td>
                      <td>{member.category ?? "—"}</td>
                      {priceCell(member)}
                      {unitPriceCell(member)}
                      {discountCells(member)}
                      {showNutritionColumns && nutritionCells(member)}
                      <td>
                        <span className="chain-badge" style={chainColorStyle(member.chain)}>
                          {member.chain}
                        </span>
                      </td>
                      {statusCell(member)}
                      <td></td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
