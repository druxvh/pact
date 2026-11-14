import { ArrowRight, AtSign, FileText, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, InputGroup, Label } from '@/components/ui';
import { profileStepError, suggestUsername } from '@/app/profileSetup';
import { useChatStore } from '@/features/chat/store';
import { useKanbanStore } from '@/features/kanban/store';
import { useNotesStore } from '@/features/notes/store';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { notify } from '@/lib/toast';
import { loadSampleWorkspace } from '@/store/demoServer';
import { normalizeUsername, useUserStore } from '@/store/useUserStore';

type Start = 'sample' | 'empty';

const OPTIONS: Array<{ id: Start; title: string; body: string; icon: typeof Sparkles }> = [
  { id: 'sample', title: 'Explore with samples', body: 'Example notes, a board, chats and two friends — so every page has something in it.', icon: Sparkles },
  { id: 'empty', title: 'Start fresh', body: 'An empty pact. Everything in it will be yours.', icon: FileText },
];

/**
 * First-run welcome. Shown once, only to someone with nothing in pact yet — an existing user who updates
 * is never greeted as a stranger (we quietly mark them as done instead).
 */
export function Onboarding() {
  const onboarded = useUserStore((s) => s.onboarded);
  const customised = useUserStore((s) => s.currentUser.displayName !== 'You');
  const hasContent = useNotesStore((s) => s.notes.length > 0) || useKanbanStore((s) => s.tasks.length > 0) || useChatStore((s) => s.messages.length > 0);
  const complete = useUserStore((s) => s.completeOnboarding);
  const existingUser = customised || hasContent;

  useEffect(() => {
    if (!onboarded && existingUser) complete({});
  }, [onboarded, existingUser, complete]);

  const nameRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<0 | 1>(0);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [role, setRole] = useState('');
  const [start, setStart] = useState<Start>('sample');

  const open = !onboarded && !existingUser;
  const error = profileStepError(name, username);
  const showUsernameError = usernameTouched && username !== '' ? error : null;

  const finish = () => {
    const displayName = name.trim() || 'You';
    complete({ displayName, username: normalizeUsername(username) || 'you', designation: role.trim() });
    if (start === 'sample') loadSampleWorkspace();
    notify.success(`Welcome to pact, ${displayName}`, start === 'sample' ? 'Sample data is loaded — poke around.' : 'Press ⌘K any time to jump anywhere.');
  };

  const onName = (value: string) => {
    setName(value);
    if (!usernameTouched) setUsername(suggestUsername(value));
  };

  return (
    // Closing the dialog any other way (Esc, backdrop) counts as "skip for now" — we never nag twice.
    <Dialog open={open} onOpenChange={(next) => !next && complete({})}>
      <DialogContent size="md" hideClose initialFocus={nameRef}>
        <DialogHeader>
          <DialogTitle>{step === 0 ? 'Welcome to pact' : 'How do you want to start?'}</DialogTitle>
          <DialogDescription>
            {step === 0 ? 'A new tab with notes, tasks, a focus timer, tiny tools and your people. Twenty seconds to set up.' : 'You can change your mind later in Settings.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <AnimatePresence mode="wait" initial={false}>
            {step === 0 ? (
              <motion.form
                key="profile"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.16 }}
                className="space-y-3.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!error) setStep(1);
                }}
              >
                <div>
                  <Label htmlFor="ob-name">What should we call you?</Label>
                  <Input id="ob-name" ref={nameRef} value={name} onChange={(e) => onName(e.target.value)} maxLength={40} placeholder="Your name" autoComplete="name" />
                </div>
                <div>
                  <Label htmlFor="ob-username">Username</Label>
                  <InputGroup
                    id="ob-username"
                    leading={<AtSign />}
                    value={username}
                    onChange={(e) => {
                      setUsernameTouched(true);
                      setUsername(e.target.value);
                    }}
                    maxLength={21}
                    placeholder="you"
                    autoComplete="username"
                    aria-invalid={showUsernameError ? true : undefined}
                    aria-describedby="ob-username-hint"
                  />
                  <p id="ob-username-hint" role={showUsernameError ? 'alert' : undefined} className={cn('mt-1 text-xs', showUsernameError ? 'text-destructive-text' : 'text-subtle-foreground')}>
                    {showUsernameError ?? 'How friends find you. Letters, numbers and underscores.'}
                  </p>
                </div>
                <div>
                  <Label htmlFor="ob-role">What do you do? (optional)</Label>
                  <Input id="ob-role" value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} placeholder="Student, designer, engineer…" />
                </div>
                {/* lets Enter submit the form */}
                <button type="submit" className="sr-only" tabIndex={-1}>
                  Continue
                </button>
              </motion.form>
            ) : (
              <motion.fieldset
                key="start"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.16 }}
                className="grid gap-2.5"
              >
                <legend className="sr-only">Starting point</legend>
                {OPTIONS.map((o) => {
                  const selected = start === o.id;
                  return (
                    <label
                      key={o.id}
                      className={cn(
                        'relative flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
                        'focus-within:ring-4 focus-within:ring-ring/15',
                        selected ? 'border-brand/60 bg-brand-soft' : 'hover:border-foreground/25 hover:bg-accent/50',
                      )}
                    >
                      <input type="radio" name="ob-start" value={o.id} checked={selected} onChange={() => setStart(o.id)} className="sr-only" />
                      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg transition-colors', selected ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground')}>
                        <o.icon className="size-[18px]" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{o.title}</span>
                        <span className="block text-[13px] leading-snug text-muted-foreground">{o.body}</span>
                      </span>
                      {selected && (
                        <motion.span layoutId="ob-check" transition={spring.snappy} className="absolute right-3 top-3 size-2 rounded-full bg-brand" aria-hidden="true" />
                      )}
                    </label>
                  );
                })}
              </motion.fieldset>
            )}
          </AnimatePresence>
        </DialogBody>

        <DialogFooter className="justify-between">
          <Button variant="ghost" onClick={() => (step === 0 ? complete({}) : setStep(0))}>
            {step === 0 ? 'Skip for now' : 'Back'}
          </Button>
          {step === 0 ? (
            <Button variant="primary" disabled={error !== null} onClick={() => setStep(1)}>
              Continue <ArrowRight />
            </Button>
          ) : (
            <Button variant="primary" onClick={finish}>
              Start using pact
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
