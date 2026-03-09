import "./globals.css";

export const metadata = {
  title: "GROWW Weekly Review Pulse",
  description: "Generate weekly one-pager and send email from Play Store reviews",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0f0f12", color: "#e4e4e7", minHeight: "100vh" }}>
        {children}
      </body>
    </html>
  );
}
