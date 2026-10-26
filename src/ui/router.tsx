/**
 * Minimal hash router. Hash routing keeps the static build working from any
 * host (or straight from disk) with no server rewrites.
 */
import { type AnchorHTMLAttributes, useEffect, useState } from 'react';

function current(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
}

export function useRoute(): { path: string; segments: string[]; query: URLSearchParams } {
  const [hash, setHash] = useState(current);
  useEffect(() => {
    const on = (): void => setHash(current());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [path, qs = ''] = hash.split('?');
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

export function navigate(to: string): void {
  window.location.hash = to;
}

export function Link({ to, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }): JSX.Element {
  return <a href={`#${to}`} {...rest} />;
}
