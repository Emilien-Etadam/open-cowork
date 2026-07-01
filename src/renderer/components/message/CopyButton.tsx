import { useState, memo, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  title?: string;
  className?: string;
}

export const CopyButton = memo(function CopyButton({
  text,
  title,
  className = 'w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-colors',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  }, [text]);

  return (
    <button type="button" onClick={handleCopy} className={className} title={title}>
      {copied ? (
        <Check className="w-3 h-3 text-success" />
      ) : (
        <Copy className="w-3 h-3 text-text-muted" />
      )}
    </button>
  );
});
