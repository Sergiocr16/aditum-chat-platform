import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Aditum — Consola de soporte',
  description: 'Consola de agentes de Aditum',
  // PWA: instalada a pantalla de inicio abre standalone (sin barra de URL).
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Aditum Chat',
    // 'black-translucent': la app pinta los pixeles bajo el status bar de iOS
    // (franjas plum en Shell/ConversationView/paneles) y iOS dibuja la hora y
    // batería en BLANCO. Es el único modo que permite status bar con marca;
    // las franjas deben mantenerse OSCURAS o el texto blanco desaparece.
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [{ url: '/favicon.ico' }, { url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#2C1C2C',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
