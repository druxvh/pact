import { motion } from 'framer-motion';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';

export function KanbanView() {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Kanban</h2>
        <p className="text-xs text-muted-foreground">Drag, move, sync — per space. Personal board by default.</p>
      </div>
      <KanbanBoard />
    </motion.div>
  );
}
