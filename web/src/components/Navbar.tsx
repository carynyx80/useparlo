import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { ArrowUpRight } from 'lucide-react'

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Parlo home">
      <span className="logo-mark">
        <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden>
          <path d="M5 23 L12 14 L18 19 L27 8" stroke="#C6FF3D" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      Parlo
    </Link>
  )
}

export default function Navbar({ app = false }: { app?: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <header className={`nav ${scrolled || app ? 'scrolled' : ''}`}>
      <div className="container nav-inner" style={app ? { maxWidth: 1480 } : undefined}>
        <Logo />
        {!app && (
          <nav className="nav-links">
            <a href="#how">How it works</a>
            <a href="#privacy">Privacy</a>
            <a href="#markets">Markets</a>
            <a href="#vault">Vault</a>
            <a href="#faq">FAQ</a>
          </nav>
        )}
        <div className="nav-right">
          {!app && (
            <Link to="/app" className="btn btn-ghost btn-sm nav-launch">
              Launch app <ArrowUpRight size={15} />
            </Link>
          )}
          <ConnectButton
            chainStatus={app ? 'icon' : 'none'}
            accountStatus={{ smallScreen: 'avatar', largeScreen: 'address' }}
            showBalance={false}
            label="Connect"
          />
        </div>
      </div>
    </header>
  )
}
