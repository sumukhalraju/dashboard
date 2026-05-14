import { useCallback, useEffect, useRef, useState } from "react";
import bs58 from "bs58";
import logo from "./assets/airchain-logo.svg";
import "./App.css";

const API_BASE = "https://airchain-server-c0cma4dcc6fgbhdd.centralindia-01.azurewebsites.net";
const FETCH_TIMEOUT = 30000;
const SIG_CONCURRENCY = 3;

function fetchWithTimeout(url, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchJSON(url) {
  const res = await fetchWithTimeout(url);
  const text = await res.text();
  try {
    return { ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: `Server returned invalid response (HTTP ${res.status})` };
  }
}

function parseAnchorValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!isNaN(n) && n.toString() === value.trim()) return n;
    return value;
  }
  if (typeof value === "object" && value !== null) {
    if (typeof value.toNumber === "function") return value.toNumber();
    if (value.words && Array.isArray(value.words)) {
      return parseAnchorValue(value.toString());
    }
    return Number(value);
  }
  return value;
}

function parseReadingTimestamp(timestamp) {
  const parsed = parseAnchorValue(timestamp);
  if (parsed === null) return null;
  if (typeof parsed === "number") {
    const seconds = parsed > 1e12 ? parsed / 1000 : parsed;
    return new Date(seconds * 1000).toISOString();
  }
  if (typeof parsed === "string") {
    const hexParsed = parseInt(parsed, 16);
    if (!isNaN(hexParsed) && /^[0-9a-fA-F]+$/.test(parsed)) {
      return new Date(hexParsed * 1000).toISOString();
    }
  }
  return null;
}

function getAQIStatus(aqi) {
  if (aqi === null || aqi === undefined) return { label: "N/A", color: "#555577" };
  const v = Number(aqi);
  if (isNaN(v)) return { label: "N/A", color: "#555577" };
  if (v <= 50) return { label: "Good", color: "#14F195" };
  if (v <= 100) return { label: "Moderate", color: "#FFC300" };
  if (v <= 150) return { label: "Unhealthy", color: "#FB8500" };
  return { label: "Hazardous", color: "#FF4444" };
}

function normalizeSolanaSignature(value) {
  if (!value || typeof value !== "string") return null;
  if (value === "no-signature") return null;
  if (/^[0-9a-fA-F]{128}$/.test(value)) {
    const bytes = value.match(/.{1,2}/g).map((pair) => Number.parseInt(pair, 16));
    return bs58.encode(Uint8Array.from(bytes));
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(value)) return value;
  return null;
}

function formatValue(val, decimals) {
  const n = parseAnchorValue(val);
  if (n === null || isNaN(n)) return "—";
  return Number(n).toFixed(decimals);
}

function StatCard({ label, value, unit, highlight }) {
  const status = highlight ? getAQIStatus(value) : null;
  const color = highlight ? status.color : "#9945FF";
  return (
    <div className="stat-card" style={{ borderLeftColor: color }}>
      <p className="stat-card-label">{label}</p>
      <p className="stat-card-value" style={{ color: highlight ? status.color : "#fff" }}>
        {highlight ? formatValue(value, 1) : value}{unit}
      </p>
      {highlight && (
        <p className="stat-card-status" style={{ color: status.color }}>{status.label}</p>
      )}
    </div>
  );
}

function ReadingRow({ reading, onTxClick }) {
  const status = getAQIStatus(reading.aqi);
  const normalizedTxSig = normalizeSolanaSignature(reading.txSignature);
  const shortSig = normalizedTxSig ? normalizedTxSig.slice(0, 8) + "..." : null;
  const txUrl = normalizedTxSig ? `https://solscan.io/tx/${normalizedTxSig}?cluster=devnet` : null;
  const timestamp = parseReadingTimestamp(reading.timestamp);
  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : "—";

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (onTxClick && reading.index !== undefined) {
        onTxClick(reading.index);
      }
    }
  };

  return (
    <tr>
      <td style={{ color: "#8888AA" }}>{timeStr}</td>
      <td className="node-id">{reading.nodeId}</td>
      <td>
        <span style={{ color: status.color, fontWeight: "bold" }}>{formatValue(reading.aqi, 1)}</span>
        <span style={{ color: status.color, fontSize: "11px", marginLeft: "6px" }}>{status.label}</span>
      </td>
      <td>{formatValue(reading.co2, 1)}</td>
      <td>{formatValue(reading.temperature, 1)}</td>
      <td>{formatValue(reading.humidity, 1)}</td>
      <td>
        {txUrl ? (
          <a
            href={txUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tx-link"
            aria-label={`View transaction ${shortSig} on Solscan (opens in new tab)`}
          >
            {shortSig}
          </a>
        ) : reading.txLoading ? (
          <span className="tx-loading">Looking up...</span>
        ) : reading.txLookupFailed ? (
          <span
            className="tx-verify"
            role="button"
            tabIndex={0}
            onClick={() => onTxClick && onTxClick(reading.index)}
            onKeyDown={handleKeyDown}
          >
            Retry
          </span>
        ) : (
          <span
            className="tx-verify"
            role="button"
            tabIndex={0}
            onClick={() => onTxClick && onTxClick(reading.index)}
            onKeyDown={handleKeyDown}
          >
            Verify
          </span>
        )}
      </td>
    </tr>
  );
}

export default function App() {
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [locality, setLocality] = useState(null);
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);
  const sigLookupRef = useRef(new Set());

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchTxSignature = useCallback(async (index) => {
    if (sigLookupRef.current.has(index)) return;
    sigLookupRef.current.add(index);

    setReadings((prev) =>
      prev.map((r) => (r.index === index ? { ...r, txLoading: true, txLookupFailed: false } : r))
    );
    try {
      const { data, error: jsonError } = await fetchJSON(`${API_BASE}/tx-signature/esp32_node_1/${index}`);
      if (!mountedRef.current) return;
      if (jsonError || !data) {
        setReadings((prev) =>
          prev.map((r) =>
            r.index === index ? { ...r, txLoading: false, txLookupFailed: true } : r
          )
        );
        return;
      }
      if (data.success && data.signature) {
        setReadings((prev) =>
          prev.map((r) =>
            r.index === index ? { ...r, txSignature: data.signature, txLoading: false } : r
          )
        );
      } else {
        setReadings((prev) =>
          prev.map((r) =>
            r.index === index ? { ...r, txLoading: false, txLookupFailed: true } : r
          )
        );
      }
    } catch {
      if (!mountedRef.current) return;
      setReadings((prev) =>
        prev.map((r) =>
          r.index === index ? { ...r, txLoading: false, txLookupFailed: true } : r
        )
      );
    }
  }, []);

  const autoLookupSignatures = useCallback((readingList) => {
    const missing = readingList
      .filter((r) => !r.txSignature && !r.txLoading && !r.txLookupFailed && !sigLookupRef.current.has(r.index))
      .map((r) => r.index);

    if (missing.length === 0) return;

    let i = 0;
    const next = () => {
      if (i >= missing.length || !mountedRef.current) return;
      const idx = missing[i++];
      fetchTxSignature(idx).finally(() => setTimeout(next, 200));
    };
    for (let j = 0; j < SIG_CONCURRENCY; j++) next();
  }, [fetchTxSignature]);

  const fetchReadings = useCallback(async (isInitial = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      if (isInitial) setLoading(true);
      setError(null);
      const { data, error: jsonError } = await fetchJSON(`${API_BASE}/readings/esp32_node_1`);
      if (!mountedRef.current) return;

      if (jsonError) {
        if (isInitial) setReadings([]);
        setError(jsonError);
        return;
      }

      if (data.success) {
        const sorted = data.readings
          .map((r, i) => ({
            ...r,
            index: i,
            txLoading: false,
            txLookupFailed: false,
          }))
          .reverse();
        if (!mountedRef.current) return;
        sigLookupRef.current.clear();
        setReadings(sorted);
        autoLookupSignatures(sorted);
      } else {
        if (!mountedRef.current) return;
        setReadings([]);
        setError(data.error || "Failed to fetch readings");
      }

      try {
        const { data: locData } = await fetchJSON(`${API_BASE}/locality/Bengaluru`);
        if (!mountedRef.current) return;
        if (locData && locData.success) {
          setLocality(locData.locality);
        }
      } catch {
        // locality is non-critical
      }

      if (!mountedRef.current) return;
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      if (!mountedRef.current) return;
      if (err.name === "AbortError") {
        setError("Request timed out. The server or network may be slow.");
      } else {
        setError(`Failed to connect to server: ${err.message || "unknown error"}`);
      }
      console.error("Error fetching readings:", err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      fetchingRef.current = false;
    }
  }, [autoLookupSignatures]);

  useEffect(() => {
    fetchReadings(true);
    const interval = setInterval(() => fetchReadings(false), 20000);
    return () => clearInterval(interval);
  }, [fetchReadings]);

  const latest = readings[0];

  return (
    <div className="app">
      <div className="header">
        <div className="header-row">
          <img src={logo} alt="Airchain logo" className="header-logo" />
          <h1 className="header-title">AirChain</h1>
        </div>
        <p className="header-subtitle">Decentralized Air Quality Monitor — Solana Devnet</p>
        {lastUpdated && (
          <p className="header-updated">Last updated: {lastUpdated}</p>
        )}
      </div>

      {locality && (
        <div className="locality-card">
          <div>
            <p className="locality-field-label">Locality</p>
            <p className="locality-field-value">{locality.name}</p>
          </div>
          <div>
            <p className="locality-field-label">Nodes</p>
            <p className="locality-field-value white">{locality.nodeCount}</p>
          </div>
          <div>
            <p className="locality-field-label">Avg AQI</p>
            <p className="locality-field-value green">{locality.averageAqi}</p>
          </div>
        </div>
      )}

      {latest && (
        <div className="stats-grid">
          <StatCard label="AQI" value={latest.aqi} unit="" highlight />
          <StatCard label="CO₂" value={formatValue(latest.co2, 1)} unit=" ppm" />
          <StatCard label="Temperature" value={formatValue(latest.temperature, 1)} unit="°C" />
          <StatCard label="Humidity" value={formatValue(latest.humidity, 1)} unit="%" />
        </div>
      )}

      <div className="readings-section">
        <h2 className="readings-title">Recent On-Chain Readings</h2>

        {loading && readings.length === 0 ? (
          <p className="loading-text">Fetching from Solana...</p>
        ) : error && readings.length === 0 ? (
          <div className="error-container">
            <p>{error}</p>
            <button
              className="retry-btn"
              onClick={() => {
                setLoading(true);
                setError(null);
                fetchingRef.current = false;
                fetchReadings(true);
              }}
            >
              Retry
            </button>
          </div>
        ) : readings.length === 0 && !loading ? (
          <p className="empty-text">No readings found yet.</p>
        ) : (
          <>
            {error && (
              <div className="error-banner">
                <span>{error}</span>
                <button className="error-dismiss" onClick={() => setError(null)} aria-label="Dismiss">x</button>
              </div>
            )}
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    {["Timestamp", "Node", "AQI", "CO₂ (ppm)", "Temp (°C)", "Humidity (%)", "Transaction"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => (
                    <ReadingRow key={r.index} reading={r} onTxClick={fetchTxSignature} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
