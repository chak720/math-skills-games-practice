import { useRef, useState } from 'react';
import { clearAll, exportAll, importAll } from '@/shared/storage/store';
import { Button, Panel } from './core';

/** Export, import and reset of everything stored in this browser. */
export function DataPanel(): JSX.Element {
  const [msg, setMsg] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = (): void => {
    const blob = new Blob([exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `quant-trainer-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg('Progress exported.');
  };

  const doImport = async (f: File): Promise<void> => {
    try {
      const n = importAll(await f.text(), 'replace');
      setMsg(`Imported ${n} records. Reloading…`);
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}. Choose a file exported from Quant Trainer.`);
    }
  };

  return (
    <Panel title="Your data">
      <p className="text-paper-muted mb-4">Everything is stored in this browser only. Export regularly so you never lose your history; import a file to move it to another browser.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={doExport}>Export progress</Button>
        <Button onClick={() => fileRef.current?.click()}>Import progress</Button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />
        {!confirmReset ? (
          <Button variant="ghost" onClick={() => setConfirmReset(true)}>
            Reset all data
          </Button>
        ) : (
          <>
            <Button
              variant="danger"
              onClick={() => {
                clearAll();
                window.location.reload();
              }}
            >
              Delete all stats, history and settings
            </Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Keep my data
            </Button>
          </>
        )}
      </div>
      {msg && (
        <p className="mt-3 text-sm text-paper-muted" role="status">
          {msg}
        </p>
      )}
    </Panel>
  );
}
