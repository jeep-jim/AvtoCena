"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="ru">
    <body style={{ margin: 0, background: "#07080d", color: "#fff", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <section style={{ width: "min(560px,100%)", padding: 32, borderRadius: 28, background: "#12151d", textAlign: "center" }}>
          <div style={{ color: "#ff4650", fontWeight: 900, fontSize: 12, letterSpacing: ".18em", textTransform: "uppercase" }}>АвтоЦена</div>
          <h1 style={{ margin: "14px 0 0", fontSize: 34, lineHeight: 1.05 }}>Сервис временно недоступен</h1>
          <p style={{ margin: "18px 0 0", color: "rgba(255,255,255,.58)", fontWeight: 600, lineHeight: 1.6 }}>Обновите страницу или вернитесь на главную. Техническая информация посетителям не показывается.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12, marginTop: 26 }}>
            <button type="button" onClick={reset} style={{ minHeight: 54, border: 0, borderRadius: 16, background: "#ff353d", color: "#fff", fontWeight: 900, cursor: "pointer" }}>Повторить</button>
            <a href="/" style={{ minHeight: 54, borderRadius: 16, background: "rgba(255,255,255,.08)", color: "#fff", fontWeight: 900, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>На главную</a>
          </div>
        </section>
      </main>
    </body>
  </html>;
}
