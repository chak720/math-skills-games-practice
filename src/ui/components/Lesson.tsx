import type { ReactNode } from 'react';
import { Disclosure } from './core';

/** Textbook-style lesson block (serif body, formulas set apart). */
export function Lesson({ title, children, open }: { title: string; children: ReactNode; open?: boolean }): JSX.Element {
  return (
    <Disclosure summary={<span className="text-paper font-medium">{title}</span>} defaultOpen={open}>
      <div className="prose-math pt-1">{children}</div>
    </Disclosure>
  );
}

export function F({ children }: { children: ReactNode }): JSX.Element {
  return <div className="formula">{children}</div>;
}

export function Example({ children }: { children: ReactNode }): JSX.Element {
  return <div className="border-l-2 border-info/60 pl-3 my-3 text-paper-muted">{children}</div>;
}
