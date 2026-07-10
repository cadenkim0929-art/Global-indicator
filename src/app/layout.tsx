import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EP Industry Monitor',
  description: '엔지니어링 플라스틱 산업 뉴스 누적·분류 대시보드',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
