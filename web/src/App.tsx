import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Send, Trash2, UserPlus } from "lucide-react";
import { api, NeedsSignIn, type Floor, type FloorRow, type Preview } from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

/** The department manager's floor: who is working, how they are doing, and one box to tell
 *  everyone what is on. Nothing here computes a number — the server does that from the same
 *  conversations the associates had, so the portal cannot disagree with the phone. */

function useFloor() {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const load = useCallback(async () => {
    try {
      setFloor(await api.floor());
      setNeedsSignIn(false);
      setError(null);
    } catch (problem) {
      if (problem instanceof NeedsSignIn) {
        setNeedsSignIn(true);
        setFloor(null);
        return;
      }
      setError(problem instanceof Error ? problem.message : "Could not reach the server.");
    }
  }, []);
  useEffect(() => {
    void load();
    // The floor changes while the manager is looking at it.
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);
  return { floor, error, needsSignIn, reload: load };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

function Floor({ floor, onChange }: { floor: Floor; onChange: () => void }) {
  const total = floor.rows.reduce((sum, row) => sum + row.conversations, 0);
  const cards = floor.rows.reduce((sum, row) => sum + row.homeCards, 0);
  const quiet = floor.rows.filter((row) => row.quiet).length;
  const guides = floor.rows.reduce((sum, row) => sum + row.guide, 0);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
          <CardDescription>Every conversation on the number in the last 12 hours.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Customers taken" value={String(total)} />
          <Stat label="Home cards made" value={String(cards)} hint="the step the store visits called our largest gap" />
          <Stat label={`Conversations at Guide (${floor.guide}+)`} value={String(guides)} />
          <Stat label="Quiet today" value={String(quiet)} hint={quiet ? "on the roster, no customers yet" : "everyone has served somebody"} />
        </CardContent>
      </Card>
      <AssociateTable floor={floor} onChange={onChange} />
    </>
  );
}

function AssociateTable({ floor, onChange }: { floor: Floor; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (phone: string, run: () => Promise<unknown>) => {
    setBusy(phone);
    try {
      await run();
      onChange();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your floor</CardTitle>
        <CardDescription>Strongest first, so the gap reads downwards.</CardDescription>
      </CardHeader>
      <CardContent>
        {floor.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nobody on the roster yet. Add your associates below and this fills as they work.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Associate</TableHead>
                <TableHead className="text-right">Customers</TableHead>
                <TableHead className="text-right">Home cards</TableHead>
                <TableHead className="text-right">Median /{floor.maxScore}</TableHead>
                <TableHead className="text-right">Guide</TableHead>
                <TableHead className="text-right">Home before price</TableHead>
                <TableHead className="text-right">Last seen</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {floor.rows.map((row) => (
                <AssociateRow key={row.phone} row={row} busy={busy === row.phone} act={act} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AssociateRow({
  row,
  busy,
  act,
}: {
  row: FloorRow;
  busy: boolean;
  act: (phone: string, run: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <TableRow className={row.quiet ? "text-muted-foreground" : undefined}>
      <TableCell className="font-medium">
        <span className="flex items-center gap-2">
          {row.name}
          {row.quiet ? <Badge variant="outline">quiet today</Badge> : null}
          {row.onRoster ? null : <Badge variant="secondary">not on the roster</Badge>}
        </span>
      </TableCell>
      <TableCell className="text-right">{row.conversations}</TableCell>
      <TableCell className="text-right">{row.homeCards}</TableCell>
      <TableCell className="text-right font-semibold">{row.median}</TableCell>
      <TableCell className="text-right">{row.guide}</TableCell>
      <TableCell className="text-right">
        {row.conversations ? `${row.homeBeforePrice} of ${row.conversations}` : "—"}
      </TableCell>
      <TableCell className="text-right">{row.lastSeenLabel}</TableCell>
      <TableCell className="text-right">
        {busy ? (
          <Loader2 className="ml-auto animate-spin" />
        ) : row.onRoster ? (
          <Button variant="link" size="sm" onClick={() => act(row.phone, () => api.removeAssociate(row.phone))}>
            <Trash2 /> remove
          </Button>
        ) : (
          <Button variant="link" size="sm" onClick={() => act(row.phone, () => api.addAssociate(row.name, row.phone))}>
            <UserPlus /> add
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function AddAssociate({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.addAssociate(name, phone);
      setName("");
      setPhone("");
      setError(null);
      onAdded();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add an associate</CardTitle>
        <CardDescription>
          Adding somebody here does not let the number message them on its own: WhatsApp only carries a message to a
          person who wrote to it in the last 24 hours, whoever is on the roster.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-wrap items-center gap-3" onSubmit={submit}>
          <Input
            className="w-44"
            placeholder="Name"
            maxLength={60}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            className="w-64"
            placeholder="WhatsApp number, e.g. 919820000001"
            maxLength={20}
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} Add
          </Button>
        </form>
        {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function TellTheFloor({ floor }: { floor: Floor }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (sent !== null)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Queued for {sent === 1 ? "1 associate" : `${sent} associates`}</CardTitle>
          <CardDescription>
            Each one is checked against the 24 hour window again as it leaves, so a window that closed a moment ago
            means that associate is skipped rather than failed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => {
              setSent(null);
              setPreview(null);
              setText("");
            }}
          >
            Write another
          </Button>
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tell the floor</CardTitle>
        <CardDescription>
          Today's offers, a stock change, anything everyone needs. It reaches the {floor.reachable}{" "}
          {floor.reachable === 1 ? "associate" : "associates"} who messaged the number in the last 24 hours — WhatsApp
          does not allow a free-form message to anyone else. You see exactly who before anything is sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Textarea
          maxLength={900}
          placeholder="e.g. TCL 55 inch is down to Rs 54,990 today only. Two LG 65 inch left."
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(null);
          }}
        />
        {preview ? (
          <>
            <div className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap">{preview.message}</div>
            <div className="flex flex-wrap gap-2">
              {preview.to.map((person) => (
                <Badge key={person.phone} variant="secondary">
                  {person.name}
                </Badge>
              ))}
            </div>
            {preview.rosterEmpty ? (
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>Nobody is on your roster</AlertTitle>
                <AlertDescription>
                  This goes to every number that has written to the agent today, whoever they are. Add your associates
                  and it will only ever go to them.
                </AlertDescription>
              </Alert>
            ) : null}
            {preview.unreachable.length ? (
              <Alert>
                <AlertTriangle />
                <AlertTitle>Will not get it</AlertTitle>
                <AlertDescription>
                  {preview.unreachable.map((person) => person.name).join(", ")} — WhatsApp only carries a message to
                  someone who wrote in the last 24 hours.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex gap-2">
              <Button
                disabled={busy || !preview.to.length}
                onClick={() =>
                  run(async () => {
                    const { queued } = await api.broadcast(text);
                    setSent(queued);
                  })
                }
              >
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Send to {preview.to.length}
              </Button>
              <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>
                Change it
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button
              disabled={busy || !text.trim()}
              onClick={() => run(async () => setPreview(await api.preview(text)))}
            >
              {busy ? <Loader2 className="animate-spin" /> : null} Preview
            </Button>
          </div>
        )}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.signIn(password);
      onDone();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Store IQ · manager</CardTitle>
          <CardDescription>The department manager's view of the floor.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <Input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" disabled={busy || !password}>
              {busy ? <Loader2 className="animate-spin" /> : null} Sign in
            </Button>
          </form>
          {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function App() {
  const { floor, error, needsSignIn, reload } = useFloor();
  if (needsSignIn) return <SignIn onDone={reload} />;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 pb-24">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Store IQ · manager</h1>
          <p className="text-muted-foreground text-sm">
            {floor ? floor.summary.split("\n")[0] : "Reading the floor…"}
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void reload()} aria-label="Refresh">
          <RefreshCw />
        </Button>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Cannot read the floor</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {floor ? (
        <>
          <Floor floor={floor} onChange={reload} />
          <AddAssociate onAdded={reload} />
          <TellTheFloor floor={floor} />
          <pre className="text-muted-foreground border-l-2 pl-3 text-xs whitespace-pre-wrap">{floor.summary}</pre>
        </>
      ) : (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="animate-spin" /> Reading the floor…
        </p>
      )}
    </div>
  );
}
