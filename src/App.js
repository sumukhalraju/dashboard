import { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";

const WALLET_ADDRESS = "BxaE4QnHqtKdLHvSi22KN574k8PNLSZvWAkq8fnC7sWz";
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

function getAQIStatus(aqi) {
  if (aqi <= 50) return { label: "Good", color: "#14F195" };
  if (aqi <= 100) return { label: "Moderate", color: "#FFC300" };
  if (aqi <= 150) return { label: "Unhealthy", color: "#FB8500" };
  return { label: "Hazardous", color: "#FF4444" };
}

function StatCard({ label, value, unit, highlight }) {
  const status = highlight ? getAQIStatus(value) : null;
  const color = highlight ? status.color : "#9945FF";
  return (
    <div style={{ background: "#1E1E35", borderRadius: "12px", padding: "20px", borderLeft: "4px solid " + color }}>
      <p style={{ color: "#8888AA", fontSize: "12px", margin: "0 0 8px 0" }}>{label}</p>
      <p style={{ fontSize: "28px", fontWeight: "bold", margin: "0", color: highlight ? status.color : "white" }}>
        {value}{unit}
      </p>
      {highlight && (
        <p style={{ color: status.color, fontSize: "12px", margin: "4px 0 0 0" }}>{status.label}</p>
      )}
    </div>
  );
}

function ReadingRow({ r, i }) {
  const status = getAQIStatus(r.aqi);
  const shortSig = r.signature ? r.signature.slice(0, 8) + "..." : "N/A";
  const txUrl = "https://solscan.io/tx/" + r.signature + "?cluster=devnet";
  return (
    <tr style={{ borderBottom: "1px solid #2A2A4A" }}>
      <td style={{ padding: "10px 12px", color: "#8888AA" }}>
        {new Date(r.timestamp).toLocaleTimeString()}
      </td>
      <td style={{ padding: "10px 12px", color: "#9945FF" }}>{r.node_id}</td>
      <td style={{ padding: "10px 12px" }}>
        <span style={{ color: status.color, fontWeight: "bold" }}>{r.aqi}</span>
        <span style={{ color: status.color, fontSize: "11px", marginLeft: "6px" }}>{status.label}</span>
      </td>
      <td style={{ padding: "10px 12px" }}>{r.co2}</td>
      <td style={{ padding: "10px 12px" }}>{r.temperature}</td>
      <td style={{ padding: "10px 12px" }}>{r.humidity}</td>
      <td style={{ padding: "10px 12px" }}>
        <a href={txUrl} target="_blank" rel="noreferrer" style={{ color: "#14F195", fontSize: "11px" }}>
          {shortSig}
        </a>
      </td>
    </tr>
  );
}

export default function App() {
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  async function fetchReadings() {
    try {
      const pubkey = new PublicKey(WALLET_ADDRESS);
      const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 10 });
      const results = [];

      for (const sig of signatures) {
        const tx = await connection.getParsedTransaction(sig.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!tx) continue;

        try {
          const instructions = tx.transaction.message.instructions;
          for (const ix of instructions) {
            // Parsed memo transactions have a parsed field with info
            if (ix.parsed) {
              const jsonStart = ix.parsed.indexOf("{");
              const jsonEnd = ix.parsed.lastIndexOf("}");
              if (jsonStart !== -1 && jsonEnd !== -1) {
                const data = JSON.parse(ix.parsed.slice(jsonStart, jsonEnd + 1));
                if (data.node_id) {
                  results.push({ ...data, signature: sig.signature });
                }
              }
            }
          }
        } catch (e) {}
      }

      setReadings(results);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReadings();
    const interval = setInterval(fetchReadings, 20000);
    return () => clearInterval(interval);
  }, []);

  const latest = readings[0];

  return (
    <div style={{ background: "#0D0D1A", minHeight: "100vh", color: "white", fontFamily: "monospace", padding: "24px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ color: "#9945FF", fontSize: "28px", margin: 0 }}>AirChain</h1>
        <p style={{ color: "#8888AA", margin: "4px 0 0 0" }}>Decentralized Air Quality Monitor — Solana Devnet</p>
        {lastUpdated && (
          <p style={{ color: "#555577", fontSize: "12px", margin: "4px 0 0 0" }}>Last updated: {lastUpdated}</p>
        )}
      </div>

      {latest && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" }}>
          <StatCard label="AQI" value={latest.aqi} unit="" highlight={true} />
          <StatCard label="CO2" value={latest.co2} unit=" ppm" highlight={false} />
          <StatCard label="Temperature" value={latest.temperature} unit="°C" highlight={false} />
          <StatCard label="Humidity" value={latest.humidity} unit="%" highlight={false} />
        </div>
      )}

      <div style={{ background: "#1E1E35", borderRadius: "12px", padding: "20px" }}>
        <h2 style={{ color: "#14F195", fontSize: "14px", margin: "0 0 16px 0", letterSpacing: "1px" }}>
          RECENT ON-CHAIN READINGS
        </h2>

        {loading ? (
          <p style={{ color: "#8888AA" }}>Fetching from Solana...</p>
        ) : readings.length === 0 ? (
          <p style={{ color: "#8888AA" }}>No readings found yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ color: "#8888AA", borderBottom: "1px solid #2A2A4A" }}>
                {["Timestamp", "Node", "AQI", "CO2 (ppm)", "Temp (°C)", "Humidity (%)", "Transaction"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontWeight: "normal" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {readings.map((r, i) => (
                <ReadingRow key={i} r={r} i={i} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}