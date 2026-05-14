import * as React from "react";
import { motion } from "framer-motion";
import { Plus, Upload, Command as CommandIcon } from "lucide-react";
import { Button, Kbd } from "../ui/primitives.tsx";
import { modKeyLabel } from "../lib/format.ts";

export function Hero({
  onNew,
  onImport,
  onOpenPalette,
}: {
  onNew: () => void | Promise<void>;
  onImport: () => void | Promise<void>;
  onOpenPalette: () => void;
}): React.ReactElement {
  const mod = modKeyLabel();
  const words = ["prototype,", "without", "writing", "JSX"];
  return (
    <section className="relative pt-16 pb-12">
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[680px] h-[420px] pointer-events-none">
        <div className="absolute inset-0 rounded-full opacity-25 blur-[80px] bg-[radial-gradient(circle,var(--accent),transparent_70%)]" />
      </div>

      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-3 mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-caret-blink" />
        beaver · designus
      </p>

      <h1 className="font-display text-[44px] leading-[1.04] tracking-[-0.035em] font-semibold text-ink-0 max-w-[640px] text-balance">
        {words.map((w, i) => (
          <motion.span
            key={i}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.04 + i * 0.06, duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            className="inline-block mr-[0.28em]"
          >
            {w}
          </motion.span>
        ))}
        <span aria-hidden className="caret-bar align-text-bottom" />
      </h1>

      <motion.p
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.36, duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
        className="mt-4 text-[15px] text-ink-2 max-w-[560px] leading-relaxed"
      >
        Local-first, LLM-orchestrated UI prototyping. Trees are built exclusively
        from your configured design systems' real components — never JSX strings.
      </motion.p>

      <motion.div
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.44, duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
        className="mt-7 flex flex-wrap items-center gap-2"
      >
        <Button variant="primary" size="lg" onClick={() => onNew()} className="gap-2">
          <Plus size={15} /> New prototype
        </Button>
        <Button variant="secondary" size="lg" onClick={() => onImport()} className="gap-2">
          <Upload size={15} /> Import…
        </Button>
        <Button variant="ghost" size="lg" onClick={onOpenPalette} className="gap-2 ml-auto sm:ml-3">
          <CommandIcon size={14} /> Command palette
          <span className="flex items-center gap-1 ml-1"><Kbd>{mod}</Kbd><Kbd>K</Kbd></span>
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55, duration: 0.42 }}
        className="mt-7 flex flex-wrap items-center gap-4 font-mono text-[11px] text-ink-3"
      >
        <span className="flex items-center gap-1.5"><Kbd>{mod}</Kbd><Kbd>N</Kbd> new</span>
        <span className="flex items-center gap-1.5"><Kbd>{mod}</Kbd><Kbd>I</Kbd> import</span>
        <span className="flex items-center gap-1.5"><Kbd>{mod}</Kbd><Kbd>K</Kbd> palette</span>
        <span className="flex items-center gap-1.5"><Kbd>?</Kbd> shortcuts</span>
      </motion.div>
    </section>
  );
}
