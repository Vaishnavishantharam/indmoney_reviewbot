"use client";

import { useState } from "react";

export default function Home() {
  const [weeksBack, setWeeksBack] = useState(10);
  const [loading, setLoading] = useState(false);
  const [pulse, setPulse] = useState(null);
  const [themeLegend, setThemeLegend] = useState(null);
  const [error, setError] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [recipient, setRecipient] = useState("");
  const [recipientName, setRecipientName] = useState("");

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setPulse(null);
    setThemeLegend(null);
    try {
      const res = await fetch("/api/weekly-pulse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeksBack }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate pulse");
      setPulse(data.pulse ?? null);
      setThemeLegend(data.themeLegend ?? null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendEmail() {
    setEmailStatus(null);
    setError(null);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: recipient || undefined,
          recipientName: recipientName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send email");
      setEmailStatus(data.sent ? "Email sent successfully." : "Draft saved (dry-run).");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: 8 }}>
        GROWW Weekly Review Pulse
      </h1>
      <p style={{ color: "#a1a1aa", marginBottom: 24 }}>
        Generate a one-page weekly note from Play Store reviews and optionally send it by email.
      </p>

      <section style={{ marginBottom: 32 }}>
        <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
          Weeks back (reviews range)
        </label>
        <input
          type="number"
          min={8}
          max={12}
          value={weeksBack}
          onChange={(e) => setWeeksBack(Number(e.target.value))}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #3f3f46",
            background: "#18181b",
            color: "#e4e4e7",
            width: 80,
          }}
        />
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            marginLeft: 12,
            padding: "8px 20px",
            borderRadius: 6,
            border: "none",
            background: loading ? "#3f3f46" : "#2563eb",
            color: "#fff",
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Running…" : "Generate one-pager"}
        </button>
      </section>

      {error && (
        <p style={{ color: "#f87171", marginBottom: 16 }}>{error}</p>
      )}

      {pulse && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: "1.25rem", marginBottom: 12 }}>Weekly One-Page Note</h2>
          <div
            style={{
              padding: 16,
              background: "#18181b",
              borderRadius: 8,
              border: "1px solid #3f3f46",
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            {pulse}
          </div>
          <p style={{ marginTop: 8, fontSize: 13, color: "#a1a1aa" }}>
            Also saved to <code>output/weekly-pulse_*.md</code> and <code>*.txt</code>
          </p>
        </section>
      )}

      {themeLegend && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: "1.25rem", marginBottom: 12 }}>Theme legend</h2>
          <div
            style={{
              padding: 16,
              background: "#18181b",
              borderRadius: 8,
              border: "1px solid #3f3f46",
              whiteSpace: "pre-wrap",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {themeLegend}
          </div>
        </section>
      )}

      <section style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid #3f3f46" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: 16 }}>Send email</h2>
        <p style={{ color: "#a1a1aa", marginBottom: 12, fontSize: 14 }}>
          Optional: enter recipient and name for a personalised email. Uses EMAIL_RECIPIENT from .env if left blank.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <input
            type="email"
            placeholder="Recipient email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid #3f3f46",
              background: "#18181b",
              color: "#e4e4e7",
              width: 260,
            }}
          />
          <input
            type="text"
            placeholder="Recipient name (e.g. Vaishnavi)"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid #3f3f46",
              background: "#18181b",
              color: "#e4e4e7",
              width: 200,
            }}
          />
          <button
            onClick={handleSendEmail}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: "#16a34a",
              color: "#fff",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Send email to me
          </button>
        </div>
        {emailStatus && (
          <p style={{ color: "#86efac", fontSize: 14 }}>{emailStatus}</p>
        )}
      </section>
    </main>
  );
}
