import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';

interface WhatsNewScreenProps {
  version: string;
  releaseNotes: string;
  onClose: () => void;
}

export default function WhatsNewScreen({ version, releaseNotes, onClose }: WhatsNewScreenProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="absolute left-0 right-0 bottom-0 top-9 z-[90] bg-black/98 backdrop-blur-md flex flex-col border-t border-[var(--theme-border)]"
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      <div className="h-12 px-3 border-b border-[var(--theme-border)] flex items-center justify-between">
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-control-bg)] transition-colors"
          title="Close What's New"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <X size={18} />
        </button>
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-text-dim)]">
          What&apos;s New
        </div>
        <div className="text-xs text-[var(--theme-text-dim)]">v{version}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-3xl mx-auto space-y-4 text-[var(--theme-text)]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="text-2xl font-bold text-[var(--theme-title)]">{children}</h1>,
              h2: ({ children }) => <h2 className="text-xl font-semibold text-[var(--theme-title)] mt-5">{children}</h2>,
              h3: ({ children }) => <h3 className="text-lg font-semibold text-[var(--theme-title)] mt-4">{children}</h3>,
              p: ({ children }) => <p className="leading-7 text-[var(--theme-text)]">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-6 space-y-1 text-[var(--theme-text)]">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-6 space-y-1 text-[var(--theme-text)]">{children}</ol>,
              li: ({ children }) => <li className="leading-6">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-[var(--theme-accent)]/70 pl-4 italic text-[var(--theme-text-dim)]">
                  {children}
                </blockquote>
              ),
              pre: ({ children }) => (
                <pre className="overflow-x-auto rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3 text-xs">
                  {children}
                </pre>
              ),
              code: ({ children }) => (
                <code className="rounded bg-[var(--theme-surface-soft)] px-1.5 py-0.5 text-[11px]">{children}</code>
              ),
            }}
          >
            {releaseNotes || 'Release notes unavailable.'}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
