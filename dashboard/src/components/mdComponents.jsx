/**
 * Shared react-markdown component overrides for consistent styling.
 * Used by ResultsPanel, SwarmDetail.
 */
export const mdComponents = {
  h1: ({ children }) => <h1 className="text-base font-bold text-foreground mt-3 mb-1 first:mt-0">{children}</h1>,
  p: ({ children }) => <p className="leading-relaxed mb-1.5 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5 mb-1.5 last:mb-0">{children}</ol>,
  ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5 mb-1.5 last:mb-0">{children}</ul>,
  li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
  h2: ({ children }) => <h2 className="text-sm font-bold text-foreground mt-3 mb-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-[13px] font-semibold text-foreground mt-2.5 mb-0.5 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="text-xs font-semibold text-foreground mt-2 mb-0.5 first:mt-0">{children}</h4>,
  pre: ({ children }) => (
    <pre
      className="mb-1.5 overflow-x-auto rounded-md border border-border bg-background/60 p-3 text-[11px]"
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {children}
    </pre>
  ),
  code: ({ inline, children }) => {
    if (inline) {
      return (
        <code className="px-1 py-0.5 rounded bg-secondary/60 text-[11px] font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
          {children}
        </code>
      )
    }
    return (
      <code className="text-[11px] font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
        {children}
      </code>
    )
  },
  a: ({ href, children }) => (
    <a href={href} className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  hr: () => <hr className="my-2 border-border" />,
}
