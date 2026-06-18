import './globals.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'Auto-Invest Agent',
  description: 'Live dashboard — idle USDC earns yield, redeemed just-in-time to pay for services.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
