import { useId } from 'react'

/**
 * Reusable toggle/switch.
 *
 * Props:
 *   checked   boolean
 *   onChange  (value: boolean) => void
 *   disabled  boolean (optional)
 *   size      'sm' | 'md' (optional, defaults to 'sm')
 *   className string (optional)
 */
export default function Toggle({ checked, onChange, disabled = false, size = 'sm', className }) {
  const uid = useId()
  const w = size === 'md' ? 32 : 28
  const h = size === 'md' ? 18 : 16
  const dot = size === 'md' ? 12 : 10
  const pad = 3
  const travel = w - dot - pad * 2

  return (
    <label
      htmlFor={uid}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: w,
        height: h,
        flexShrink: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <input
        id={uid}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      {/* Track */}
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: h,
          border: `1px solid ${checked ? 'rgba(139,171,143,0.4)' : 'rgba(255,255,255,0.06)'}`,
          background: checked ? 'rgba(139,171,143,0.16)' : 'transparent',
          transition: 'background 150ms ease, border-color 150ms ease',
        }}
      />
      {/* Dot */}
      <span
        style={{
          position: 'absolute',
          width: dot,
          height: dot,
          borderRadius: '50%',
          background: checked ? '#8bab8f' : 'rgba(107,108,120,0.5)',
          top: pad,
          left: pad,
          transform: checked ? `translateX(${travel}px)` : 'none',
          transition: 'transform 150ms ease, background 150ms ease',
          pointerEvents: 'none',
        }}
      />
    </label>
  )
}
