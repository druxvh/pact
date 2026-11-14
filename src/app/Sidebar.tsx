import { LayoutGroup, motion } from 'motion/react';
import { ProfileMenu } from '@/app/ProfileMenu';
import { SECTIONS, type SectionMeta } from '@/app/routes';
import { Logo } from '@/components/Logo';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { type Section, useNavStore } from '@/store/useNavStore';

type Badges = Partial<Record<Section, number | 'dot'>>;

function RailItem({ item, active, badge, onSelect }: { item: SectionMeta; active: boolean; badge?: number | 'dot'; onSelect: () => void }) {
  const Icon = item.icon;
  return (
    <Tooltip content={item.label} shortcut={`G ${item.hotkey.toUpperCase()}`} side="right">
      <button
        type="button"
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        onClick={onSelect}
        className={cn(
          'group relative grid size-10 place-items-center rounded-xl outline-offset-2 transition-colors duration-150 active:scale-95',
          active ? 'text-brand-text' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        {active && (
          <motion.span
            layoutId="rail-pill"
            transition={spring.layout}
            className="absolute inset-0 rounded-xl bg-brand-soft shadow-[inset_0_0_0_1px_var(--brand-glow)]"
          >
            <span className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand shadow-[0_0_10px_var(--brand-glow)]" />
          </motion.span>
        )}
        <Icon className="relative size-[19px] transition-transform duration-200 ease-out-expo group-hover:scale-110" />
        {badge ? (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[9px] font-bold leading-4 text-brand-foreground ring-2 ring-background">
            {badge === 'dot' ? '' : badge}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

/** Desktop rail (≥ md). */
export function Sidebar({ badges = {} }: { badges?: Badges }) {
  const section = useNavStore((s) => s.section);
  const go = useNavStore((s) => s.go);
  const main = SECTIONS.filter((s) => s.id !== 'settings');
  const settings = SECTIONS.find((s) => s.id === 'settings');

  return (
    <aside aria-label="Primary" className="hidden w-[68px] shrink-0 flex-col items-center border-r bg-background/70 py-3 md:flex">
      <Tooltip content="pact" side="right">
        <button type="button" aria-label="pact home" onClick={() => go('home')} className="mb-4 rounded-xl outline-offset-4">
          <Logo />
        </button>
      </Tooltip>

      <LayoutGroup id="rail">
        <nav aria-label="Sections" className="flex flex-1 flex-col items-center gap-1">
          {main.map((item) => (
            <RailItem key={item.id} item={item} active={section === item.id} badge={badges[item.id]} onSelect={() => go(item.id)} />
          ))}
        </nav>

        <div className="flex flex-col items-center gap-2">
          {settings && <RailItem item={settings} active={section === 'settings'} onSelect={() => go('settings')} />}
          <ProfileMenu />
        </div>
      </LayoutGroup>
    </aside>
  );
}

/** Bottom tab bar for narrow windows (< md). */
export function MobileNav({ badges = {} }: { badges?: Badges }) {
  const section = useNavStore((s) => s.section);
  const go = useNavStore((s) => s.go);
  return (
    <nav aria-label="Sections" className="surface-glass flex shrink-0 items-center justify-around border-t px-1 pb-[env(safe-area-inset-bottom)] md:hidden">
      {SECTIONS.map((item) => {
        const Icon = item.icon;
        const active = section === item.id;
        const badge = badges[item.id];
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            onClick={() => go(item.id)}
            className={cn(
              'relative grid h-12 flex-1 place-items-center transition-colors active:scale-95',
              active ? 'text-brand-text' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-5" />
            {active && <span className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-brand" />}
            {badge ? <span className="absolute right-1/4 top-2 size-2 rounded-full bg-brand ring-2 ring-background" /> : null}
          </button>
        );
      })}
    </nav>
  );
}
