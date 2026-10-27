import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

const CONTAINER_SELECTOR = '[data-scroll-container]'
const positions = new Map<string, { window: number; container: number }>()

function getContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(CONTAINER_SELECTOR)
}

/**
 * Per-location scroll memory. PUSH/REPLACE navigations start at the top;
 * POP (back/forward) restores the position the page was last scrolled to.
 * Handles both the window scroll (desktop) and the inner scroll container
 * used by the mobile layout.
 */
const ScrollRestoration: React.FC = () => {
  const location = useLocation()
  const navType = useNavigationType()
  const currentKey = useRef(location.key)

  // Continuously record the scroll position under the current location key.
  useEffect(() => {
    const save = () => {
      positions.set(currentKey.current, {
        window: window.scrollY,
        container: getContainer()?.scrollTop ?? 0,
      })
    }
    window.addEventListener('scroll', save, { passive: true })
    const container = getContainer()
    container?.addEventListener('scroll', save, { passive: true })
    return () => {
      window.removeEventListener('scroll', save)
      container?.removeEventListener('scroll', save)
    }
  }, [location.key])

  // On navigation, restore the saved position (POP) or reset to top.
  useEffect(() => {
    currentKey.current = location.key
    const saved = positions.get(location.key)
    const frame = requestAnimationFrame(() => {
      setTimeout(() => {
        const container = getContainer()
        if (navType === 'POP' && saved) {
          window.scrollTo(0, saved.window)
          if (container) container.scrollTop = saved.container
        } else {
          window.scrollTo(0, 0)
          if (container) container.scrollTop = 0
        }
      }, 0)
    })
    return () => cancelAnimationFrame(frame)
  }, [location.key, navType])

  return null
}

export default ScrollRestoration
