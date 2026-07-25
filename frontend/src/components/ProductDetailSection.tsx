import { useEffect, useState } from "react";
import { fetchProductDetail } from "../api";
import { DIET_TAGS } from "../constants";
import type { ProductDetail } from "../types";

interface ProductDetailSectionProps {
  productId: number;
  ean: string;
}

export function ProductDetailSection({ productId, ean }: ProductDetailSectionProps) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    fetchProductDetail(productId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (loading) {
    return (
      <>
        <div className="chart-title">Om produktet</div>
        <div className="product-detail-ean">Vare-ID hos butikken (EAN): {ean}</div>
        <div className="loading-state">Henter produktinformasjon…</div>
      </>
    );
  }

  if (error || !detail) {
    return (
      <>
        <div className="chart-title">Om produktet</div>
        <div className="product-detail-ean">Vare-ID hos butikken (EAN): {ean}</div>
        <div className="loading-state">Fant ikke produktinformasjon for dette produktet.</div>
      </>
    );
  }

  const containsAllergens = detail.allergens?.filter((a) => a.code === "JA") ?? [];
  const originText = [detail.countryOfOrigin, detail.productionCountry]
    .filter((v, i, arr) => v && arr.indexOf(v) === i)
    .join(" / ");

  return (
    <>
      <div className="chart-title">Om produktet</div>
      <div className="product-detail-ean">Vare-ID hos butikken (EAN): {ean}</div>
      <div className="product-detail">
        {detail.relevantInfo && <p className="product-detail-text">{detail.relevantInfo}</p>}

        <div className="product-detail-grid">
          {detail.packageSize && (
            <div>
              <span className="detail-label">Pakningsstørrelse</span>
              <span>{detail.packageSize}</span>
            </div>
          )}
          {originText && (
            <div>
              <span className="detail-label">Opprinnelse</span>
              <span>{originText}</span>
            </div>
          )}
        </div>

        {detail.ingredients && (
          <div className="product-detail-block">
            <span className="detail-label">Ingredienser</span>
            <p className="product-detail-text">{detail.ingredients}</p>
          </div>
        )}

        {containsAllergens.length > 0 && (
          <div className="product-detail-block">
            <span className="detail-label">Inneholder (allergener)</span>
            <div className="allergen-chips">
              {containsAllergens.map((a) => (
                <span key={a.name} className="chip active">
                  {a.displayName}
                </span>
              ))}
            </div>
          </div>
        )}

        {detail.dietFlags.length > 0 && (
          <div className="product-detail-block">
            <span className="detail-label">Kosthold (automatisk analysert, ikke offisielt)</span>
            <div className="allergen-chips">
              {detail.dietFlags.map((flag) => (
                <span key={flag} className="chip chip-exclude">
                  {DIET_TAGS.find((d) => d.key === flag)?.label ?? flag}
                </span>
              ))}
            </div>
          </div>
        )}
        {detail.dietParseStatus === "ok" && detail.dietFlags.length === 0 && (
          <div className="product-detail-block">
            <p className="product-detail-text diet-safe-note">
              Vår ingrediensanalyse fant ikke kjøtt, gelatin eller honning i dette produktet — men dette er en
              automatisk analyse, ikke en garanti.
            </p>
          </div>
        )}

        {detail.nutritionalContent && detail.nutritionalContent.length > 0 && (
          <div className="product-detail-block">
            <span className="detail-label">Næringsinnhold per 100 g/ml</span>
            <table className="nutrition-table">
              <tbody>
                {detail.nutritionalContent.map((n) => (
                  <tr key={n.name}>
                    <td>{n.displayName}</td>
                    <td className="nutrition-amount">
                      {n.amount} {n.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
