import type { Metadata } from 'next';
import './styles.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ArcPort wagmi Session Client',
  description: 'Reference Next + wagmi frontend for ArcPort session payments.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

