import { Command, Info, Palette, Settings, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { AboutSection } from '@/features/settings/AboutSection';
import { AppearanceSection } from '@/features/settings/AppearanceSection';
import { CommandsSection } from '@/features/settings/CommandsSection';
import { DataSection } from '@/features/settings/DataSection';
import { HomeSection } from '@/features/settings/HomeSection';
import { activeSection } from '@/features/settings/nav';
import { ProfileSection } from '@/features/settings/ProfileSection';
import { cn } from '@/lib/cn';
import { fadeUp, stagger } from '@/lib/motion';
import { scrollToElement } from '@/lib/scroll';

const NAV = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'home', label: 'Home', icon: Sparkles },
  { id: 'commands', label: 'Commands', icon: Command },
  { id: 'data', label: 'Your data', icon: ShieldCheck },
  { id: 'about', label: 'About', icon: Info },
] as const;

/** On narrow screens the nav is a strip pinned to the top of the page, so sections must stop below it. */
const topInset = (bar: HTMLElement | null) => (bar && !window.matchMedia('(min-width: 1024px)').matches ? bar.offsetHeight : 0);

function SectionNav() {
  const [active, setActive] = useState<string>(NAV[0].id);
  const bar = useRef<HTMLElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  // After a click, the section you asked for stays highlighted — also when the page is too short to scroll it to the top —
  // until you scroll yourself. `settled` flips once the smooth scroll we started is over.
  const lock = useRef<{ id: string; settled: boolean; timer: number } | null>(null);

  useEffect(() => {
    const scroller = document.getElementById('main');
    const targets = NAV.map((n) => document.getElementById(n.id)).filter((el): el is HTMLElement => el !== null);
    if (!scroller || targets.length === 0) return;
    const update = () => {
      const box = scroller.getBoundingClientRect();
      const atBottom = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      setActive(
        activeSection(
          targets.map((t) => ({ id: t.id, top: t.getBoundingClientRect().top })),
          box.top + topInset(bar.current) + Math.min(96, scroller.clientHeight * 0.25),
          atBottom,
        ),
      );
    };
    const onScroll = () => {
      const l = lock.current;
      if (l && !l.settled) return; // our own smooth scroll is still running
      lock.current = null; // you took over
      update();
    };
    update();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
      if (lock.current) window.clearTimeout(lock.current.timer);
    };
  }, []);

  // In the narrow strip the active pill may be off to the side: slide the strip (only the strip — never the page) to show it.
  useEffect(() => {
    const ul = strip.current;
    const btn = ul?.querySelector<HTMLElement>(`[data-nav="${active}"]`);
    if (!ul || !btn || ul.scrollWidth <= ul.clientWidth) return;
    ul.scrollTo({ left: btn.offsetLeft - (ul.clientWidth - btn.offsetWidth) / 2, behavior: 'smooth' });
  }, [active]);

  const go = (id: string) => {
    setActive(id);
    if (lock.current) window.clearTimeout(lock.current.timer);
    const l = { id, settled: false, timer: 0 };
    l.timer = window.setTimeout(() => {
      l.settled = true;
    }, 800);
    lock.current = l;
    scrollToElement(document.getElementById(id), { behavior: 'smooth', block: 'start', offset: topInset(bar.current) + 8 });
  };

  return (
    <nav
      ref={bar}
      aria-label="Settings sections"
      className={cn(
        // narrow screens: a strip of pills that stays at the top of the page; wide screens: a column beside the content
        'sticky top-0 z-20 -mx-4 border-b bg-background/90 px-4 py-1.5 backdrop-blur-md md:-mx-8 md:px-8',
        'lg:top-6 lg:z-auto lg:mx-0 lg:self-start lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none',
      )}
    >
      <ul ref={strip} className="no-scrollbar relative -m-0.5 flex gap-1 overflow-x-auto p-0.5 lg:m-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:p-0">
        {NAV.map(({ id, label, icon: Icon }) => (
          <li key={id} className="shrink-0">
            <button
              type="button"
              data-nav={id}
              aria-current={active === id ? 'true' : undefined}
              onClick={() => go(id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium outline-offset-0 transition-colors',
                active === id ? 'bg-brand-soft text-brand-text' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SettingsView() {
  return (
    <motion.div variants={stagger(0.04)} initial="hidden" animate="show" className="relative w-full space-y-4">
      <motion.div variants={fadeUp}>
        <PageHeader icon={Settings} title="Settings" description="Profile, appearance, home page and your data" />
      </motion.div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-8 gap-y-4 lg:grid-cols-[152px_minmax(0,1fr)]">
        <SectionNav />
        <div className="max-w-3xl space-y-5 pb-8">
          <ProfileSection />
          <AppearanceSection />
          <HomeSection />
          <CommandsSection />
          <DataSection />
          <AboutSection />
        </div>
      </div>
    </motion.div>
  );
}
