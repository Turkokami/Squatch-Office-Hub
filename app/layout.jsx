import "./globals.css";

export const metadata = {
  title: "Squatch-Bot Dispatch",
  description: "Where the bots file reports and the office acts on them.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
