import { Moon, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { IconButton } from '@/components/ui/IconButton';
import { useThemeStore } from '@/store/useThemeStore';

/** Sun/moon swap + circular page reveal originating from the button. */
export function ThemeToggle({ className }: { className?: string }) {
  const resolved = useThemeStore((s) => s.resolved);
  const toggle = useThemeStore((s) => s.toggle);
  return (
    <IconButton
      label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className={className}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={resolved}
          initial={{ rotate: -70, scale: 0.5, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 70, scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="grid place-items-center"
        >
          {resolved === 'dark' ? <Sun /> : <Moon />}
        </motion.span>
      </AnimatePresence>
    </IconButton>
  );
}
