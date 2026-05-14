import { useCallback, useEffect, useState } from "react";
import bs58 from "bs58";
import logo from "./assets/airchain-logo.svg";
import "./App.css";

const API_BASE = "https://airchain-server-c0cma4dcc6fgbhdd.centralindia-01.azurewebsites.net";
const FETCH_TIMEOUT = 15000;

function fetchWithTimeout(url, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
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
  const hexParsed = parseInt(parsed, 16);
  if (!isNaN(hexParsed)) {
    return new Date(hexParsed * 1000).toISOString();
  }
  const numParsed = Number(parsed);
  if (!isNaN(numParsed)) {
    const seconds = numParsed > 1e12 ? numParsed / 1000 : numParsed;
    return new Date(seconds * 1000).toISOString();
  }
  return null;
}

function getAQIStatus(aqi) {
  const v = parseFloat(aqi) || 0;
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
        {value}{unit}
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

  const handleTxClick = (e) => {
    e.preventDefault();
    if (onTxClick && reading.index !== undefined) {
      onTxClick(reading.index);
    }
  };

  return (
    <tr>
      <td style={{ color: "#8888AA" }}>
        {timestamp ? new Date(timestamp).toLocaleTimeString() : "—"}
      </td>
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
          <a href={txUrl} target="_blank" rel="noopener noreferrer" className="tx-link">
            {shortSig}
          </a>
        ) : reading.txLoading ? (
          <span className="tx-loading">Looking up...</span>
        ) : (
          <span className="tx-loading" style={{ cursor: "pointer" }} onClick={handleTxClick}>
            {shortSig || "Verify"}
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

  const fetchTxSignature = useCallback(async (index) => {
    setReadings((prev) =>
      prev.map((r) => (r.index === index ? { ...r, txLoading: true } : r))
    );
    try {
      const res = await fetchWithTimeout(`${API_BASE}/tx-signature/esp32_node_1/${index}`, 8000);
      const data = await res.json();
      if (data.success && data.signature) {
        setReadings((prev) =>
          prev.map((r) =>
            r.index === index ? { ...r, txSignature: data.signature, txLoading: false } : r
          )
        );
      } else {
        setReadings((prev) =>
          prev.map((r) => (r.index === index ? { ...r, txLoading: false } : r))
        );
      }
    } catch {
      setReadings((prev) =>
        prev.map((r) => (r.index === index ? { ...r, txLoading: false } : r))
      );
    }
  }, []);

  const fetchReadings = useCallback(async () => {
    try {
      setError(null);
      const response = await fetchWithTimeout(`${API_BASE}/readings/esp32_node_1`);
      const data = await response.json();

      if (data.success) {
        const sorted = data.readings
          .map((r, i) => ({
            ...r,
            index: i,
            txLoading: false,
          }))
          .reverse();
        setReadings(sorted);
      } else {
        setReadings([]);
        setError(data.error || "Failed to fetch readings");
      }

      try {
        const localityRes = await fetchWithTimeout(`${API_BASE}/locality/Bengaluru`);
        const localityData = await localityRes.json();
        if (localityData.success) {
          setLocality(localityData.locality);
        }
      } catch {
        // locality is non-critical
      }

      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      if (err.name === "AbortError") {
        setError("Request timed out. The server or network may be slow.");
      } else {
        setError("Failed to connect to the server. Please check your connection.");
      }
      console.error("Error fetching readings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReadings();
    const interval = setInterval(fetchReadings, 20000);
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
          <StatCard label="AQI" value={formatValue(latest.aqi, 1)} unit="" highlight />
          <StatCard label="CO2" value={formatValue(latest.co2, 1)} unit=" ppm" />
          <StatCard label="Temperature" value={formatValue(latest.temperature, 1)} unit="°C" />
          <StatCard label="Humidity" value={formatValue(latest.humidity, 1)} unit="%" />
        </div>
      )}

      <div className="readings-section">
        <h2 className="readings-title">Recent On-Chain Readings</h2>

        {loading ? (
          <p className="loading-text">Fetching from Solana...</p>
        ) : error ? (
          <div className="error-container">
            <p>{error}</p>
            <button
              className="retry-btn"
              onClick={() => {
                setLoading(true);
                setError(null);
                fetchReadings();
              }}
            >
              Retry
            </button>
          </div>
        ) : readings.length === 0 ? (
          <p className="empty-text">No readings found yet.</p>
        ) : (
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
        )}
      </div>
    </div>
  );
}
