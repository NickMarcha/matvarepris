import { useEffect, useState } from "react";
import { fetchStats } from "./api";
import type { Stats } from "./types";

const POLL_INTERVAL_MS = 5000;
const AVG_CRAWL_DELAY_MS = 2500; // matches backend NUTRITION_CRAWL_DELAY_MS default + half the jitter

function formatEta(remaining: number): string {
  if (remaining === 0) return "ferdig";
  const totalMinutes = Math.round((remaining * AVG_CRAWL_DELAY_MS) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `~${minutes} min`;
  return `~${hours} t ${minutes} min`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "aldri";
  return new Date(iso).toLocaleString("no-NO");
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function load() {
      fetchStats()
        .then((s) => {
          setStats(s);
          setError(null);
        })
        .catch((err) => setError(String(err)));
    }
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Statistikk</h1>
          <div className="subtitle">Datastatus og bakgrunnsjobber for MatvarePris</div>
        </div>
        <a className="back-link" href="/">
          ← Tilbake til produkter
        </a>
      </header>

      {error && <div className="empty-state">Feil: {error}</div>}
      {!stats && !error && <div className="loading-state">Laster…</div>}

      {stats && (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <div className="stat-tile-value">{stats.catalog.totalProducts.toLocaleString("no-NO")}</div>
              <div className="stat-tile-label">Produkter totalt</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-value">{stats.catalog.onOfferCount.toLocaleString("no-NO")}</div>
              <div className="stat-tile-label">På tilbud</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-value">
                {stats.catalog.avgDiscountPercent !== null ? `${stats.catalog.avgDiscountPercent}%` : "—"}
              </div>
              <div className="stat-tile-label">Snittrabatt</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-value">{stats.catalog.categoryCount}</div>
              <div className="stat-tile-label">Kategorier (rå, per kjede)</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-value">{stats.catalog.priceHistoryCount.toLocaleString("no-NO")}</div>
              <div className="stat-tile-label">Prisendringer sporet</div>
            </div>
          </div>

          <div className="stats-section">
            <h2>Næringsinnhold-crawler</h2>
            <div className="crawl-progress">
              <div className="crawl-progress-track">
                <div
                  className="crawl-progress-fill"
                  style={{
                    width: `${Math.min(
                      100,
                      (stats.nutritionCrawl.crawled / Math.max(1, stats.nutritionCrawl.totalProducts)) * 100,
                    )}%`,
                  }}
                />
              </div>
              <div className="crawl-progress-label">
                {stats.nutritionCrawl.crawled.toLocaleString("no-NO")} /{" "}
                {stats.nutritionCrawl.totalProducts.toLocaleString("no-NO")} produkter (
                {Math.round(
                  (stats.nutritionCrawl.crawled / Math.max(1, stats.nutritionCrawl.totalProducts)) * 100,
                )}
                %)
              </div>
            </div>
            <div className="stats-note">
              {stats.nutritionCrawl.remaining.toLocaleString("no-NO")} gjenstår, kjører kontinuerlig i
              bakgrunnen (~1 produkt hvert 2.-3. sekund) — estimert tid igjen: {formatEta(stats.nutritionCrawl.remaining)}
            </div>
          </div>

          <div className="stats-section">
            <h2>Kjeder</h2>
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Kjede</th>
                  <th>Produkter</th>
                  <th>Sist oppdatert</th>
                </tr>
              </thead>
              <tbody>
                {stats.chains.map((c) => (
                  <tr key={c.key}>
                    <td>{c.displayName}</td>
                    <td>{c.productCount.toLocaleString("no-NO")}</td>
                    <td>{formatDate(c.lastCheckedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stats-section">
            <h2>Siste katalogoppdatering</h2>
            {stats.ingest.running && <div className="stats-note">Kjører nå…</div>}
            {!stats.ingest.running && !stats.ingest.lastRun && (
              <div className="stats-note">Ingen fullført kjøring registrert ennå.</div>
            )}
            {stats.ingest.lastRun && (
              <>
                <div className="stats-note">
                  Startet {formatDate(stats.ingest.lastRun.startedAt)}, fullført{" "}
                  {formatDate(stats.ingest.lastRun.finishedAt)}
                </div>
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Kjede</th>
                      <th>Sett</th>
                      <th>Nye</th>
                      <th>Endret</th>
                      <th>Uendret</th>
                      <th>Feil</th>
                      <th>Tid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.ingest.lastRun.summaries.map((s) => (
                      <tr key={s.chain}>
                        <td>{s.chain}</td>
                        <td>{s.totalSeen.toLocaleString("no-NO")}</td>
                        <td>{s.inserted.toLocaleString("no-NO")}</td>
                        <td>{s.changed.toLocaleString("no-NO")}</td>
                        <td>{s.unchanged.toLocaleString("no-NO")}</td>
                        <td>{s.errors}</td>
                        <td>{formatDuration(s.durationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
