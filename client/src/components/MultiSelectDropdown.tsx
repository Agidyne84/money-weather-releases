import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'

interface Option {
  id: string
  label: string
  note?: string
}

interface MultiSelectDropdownProps {
  options: Option[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  options,
  selected,
  onChange,
  placeholder = 'Select…',
  className = '',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return
    const reposition = () => {
      if (!buttonRef.current) return
      const rect = buttonRef.current.getBoundingClientRect()
      const panelHeight = 200
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow >= panelHeight || spaceBelow >= rect.top
        ? rect.bottom + window.scrollY
        : rect.top + window.scrollY - panelHeight
      setDropdownStyle({
        position: 'absolute',
        top,
        left: rect.left + window.scrollX,
        width: rect.width,
        zIndex: 9999,
      })
    }
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  const handleOpen = () => {
    if (disabled) return
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const panelHeight = 200
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow >= panelHeight || spaceBelow >= rect.top
        ? rect.bottom + window.scrollY
        : rect.top + window.scrollY - panelHeight
      setDropdownStyle({
        position: 'absolute',
        top,
        left: rect.left + window.scrollX,
        width: rect.width,
        zIndex: 9999,
      })
    }
    setOpen(o => !o)
  }

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }

  const displayLabel = () => {
    if (selected.length === 0) return placeholder
    if (selected.length === 1) return options.find(o => o.id === selected[0])?.label ?? selected[0]
    if (selected.length === options.length) return 'All accounts'
    return `${selected.length} accounts`
  }

  const panel = open ? ReactDOM.createPortal(
    <div
      ref={panelRef}
      style={dropdownStyle}
      className="bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto"
    >
      {options.length === 0 ? (
        <div className="px-3 py-2 text-xs text-gray-400">No options</div>
      ) : (
        options.map(opt => (
          <label
            key={opt.id}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.includes(opt.id)}
              onChange={() => toggle(opt.id)}
              className="rounded shrink-0"
            />
            <span className="text-gray-800">{opt.label}</span>
            {opt.note && <span className="text-xs text-gray-400 ml-auto">{opt.note}</span>}
          </label>
        ))
      )}
    </div>,
    document.body
  ) : null

  return (
    <div className={className}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`form-input text-sm py-1 w-full text-left flex items-center justify-between gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={selected.length === 0 ? 'text-gray-400' : 'text-gray-800'}>
          {displayLabel()}
        </span>
        <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {panel}
    </div>
  )
}

export default MultiSelectDropdown
