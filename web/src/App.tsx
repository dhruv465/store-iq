import { useCallback, useEffect, useRef, useState } from "react";
import { applyTheme, savedTheme, type Theme } from "./theme.ts";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  ChevronUp,
  Clock,
  Download,
  ReceiptIndianRupee,
  Upload,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Loader2,
  MessageSquare,
  Package,
  Monitor,
  Moon,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Sun,
  Trash2,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import {
  api,
  NeedsSignIn,
  type FeedItem,
  type Charges,
  type FollowUp,
  type Floor,
  type ObjectionInsight,
  type OpenQuestion,
  type Preview,
  type ProductInsight,
  type SentBroadcast,
  type VideoBriefView,
} from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** The department manager's floor: who is working, how they are doing, real-time floor activity,
 *  customer objections, and broadcast notices. Nothing here computes a number — the server does
 *  that from the same conversations the associates had, so the portal cannot disagree with the phone. */

function useFloor() {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const load = useCallback(async () => {
    try {
      setFloor(await api.floor());
      setUpdatedAt(new Date());
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
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);
  // The server has already ended the session; the portal drops what it was showing, without a reload.
  const signedOut = useCallback(() => {
    setFloor(null);
    setNeedsSignIn(true);
  }, []);
  return { floor, error, needsSignIn, updatedAt, reload: load, signedOut };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-4">
      <span className="text-muted-foreground text-[13px]">{label}</span>
      <span className="text-[28px] leading-tight font-semibold tracking-tight">{value}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

/** The shift board: the six numbers a floor manager glances at, in one panel. */
function TodayOverview({ floor }: { floor: Floor }) {
  const total = floor.rows.reduce((sum, row) => sum + row.conversations, 0);
  const cards = floor.rows.reduce((sum, row) => sum + row.homeCards, 0);
  const quiet = floor.rows.filter((row) => row.quiet).length;
  const guides = floor.rows.reduce((sum, row) => sum + row.guide, 0);
  const homeFirst = floor.rows.reduce((sum, row) => sum + row.homeBeforePrice, 0);
  const homeFirstPercent = total > 0 ? Math.round((homeFirst / total) * 100) : 100;

  return (
    <section aria-label="Today on the floor" className="bg-card overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="text-sm font-semibold">Today on the floor</h2>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span className="bg-brand size-2 rounded-full motion-safe:animate-pulse" /> Live, last 12 hours
        </span>
      </div>
      <div className="grid grid-cols-2 divide-y sm:grid-cols-3 sm:divide-y-0 xl:grid-cols-6 xl:divide-x [&>*]:border-border sm:[&>*:nth-child(n+4)]:border-t xl:[&>*:nth-child(n+4)]:border-t-0">
        <Stat label="Customers taken" value={String(total)} hint="conversations started" />
        <Stat
          label="Home cards made"
          value={String(cards)}
          hint={total > 0 ? `${Math.round((cards / total) * 100)}% of customers` : "none yet today"}
        />
        <Stat label={`Reached Guide (${floor.guide}+)`} value={String(guides)} hint="out of 14 on the scale" />
        <Stat
          label="Home before price"
          value={`${homeFirstPercent}%`}
          hint={total > 0 ? `${homeFirst} of ${total} conversations` : "store visits saw 6 of 6 price first"}
        />
        <Stat
          label="Quiet associates"
          value={String(quiet)}
          hint={quiet ? "no customers yet" : "everyone has served"}
        />
        <Stat
          label="Model cost today"
          value={floor.spend ? usd(floor.spend.today) : "—"}
          hint={
            floor.spend
              ? `${usd(floor.spend.total)} in all${floor.spend.since ? ` since ${shortDay(floor.spend.since)}` : ""}` +
                (total > 0 ? ` · ${usd(floor.spend.today / total)} a customer` : "")
              : "fal is not set up"
          }
        />
      </div>
    </section>
  );
}

/** Dollars as fal bills them: a turn costs a fraction of a cent, so small amounts keep four places. */
function usd(amount: number): string {
  return amount === 0 ? "$0" : amount < 1 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}

function shortDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function ScoreBadge({ score }: { score: number }) {
  if (score >= 1.8)
    return (
      <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">{score.toFixed(1)}/2</span>
    );
  if (score >= 1.0)
    return (
      <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">{score.toFixed(1)}/2</span>
    );
  return (
    <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
      {score.toFixed(1)}/2
    </span>
  );
}

function AssociateTable({ floor, onChange }: { floor: Floor; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const act = async (phone: string, run: () => Promise<unknown>) => {
    setBusy(phone);
    try {
      await run();
      onChange();
    } finally {
      setBusy(null);
    }
  };

  const toggleExpand = (phone: string) => {
    setExpanded((curr) => (curr === phone ? null : phone));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Floor scorecard</CardTitle>
            <CardDescription>
              Ranked strongest first. Click an associate to inspect their 7-step coaching marks.
            </CardDescription>
          </div>
          <span className="text-muted-foreground text-xs">Target: Guide ≥ 11 of {floor.maxScore}</span>
        </div>
      </CardHeader>
      <CardContent>
        {floor.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nobody on the roster yet. Add your associates below and this fills as they work.
          </p>
        ) : (
          <div className="space-y-2">
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
                  <TableHead className="text-right">Coaching</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {floor.rows.map((row) => (
                  <>
                    <TableRow key={row.phone} className={row.quiet ? "text-muted-foreground" : undefined}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <Avatar seed={row.phone} />
                          {row.name}
                          {row.quiet ? <Badge variant="outline">quiet today</Badge> : null}
                          {row.onRoster ? null : <Badge variant="secondary">not on roster</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{row.conversations}</TableCell>
                      <TableCell className="text-right">{row.homeCards}</TableCell>
                      <TableCell className="text-right font-semibold">
                        <span className={row.median >= floor.guide ? "text-success" : ""}>{row.median}</span>
                      </TableCell>
                      <TableCell className="text-right">{row.guide}</TableCell>
                      <TableCell className="text-right">
                        {row.conversations ? (
                          <span className={row.homeBeforePrice === row.conversations ? "text-success" : "text-warning"}>
                            {row.homeBeforePrice} of {row.conversations}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">{row.lastSeenLabel}</TableCell>
                      <TableCell className="text-right">
                        {row.conversations > 0 && row.stepMarks ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => toggleExpand(row.phone)}
                          >
                            {expanded === row.phone ? (
                              <ChevronUp className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            )}
                            7 steps
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {busy === row.phone ? (
                          <Loader2 className="ml-auto animate-spin size-4" />
                        ) : row.onRoster ? (
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => act(row.phone, () => api.removeAssociate(row.phone))}
                          >
                            <Trash2 className="size-3.5" /> remove
                          </Button>
                        ) : (
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => act(row.phone, () => api.addAssociate(row.name, row.phone))}
                          >
                            <UserPlus className="size-3.5" /> add
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded === row.phone && row.stepMarks ? (
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={9} className="py-3">
                          <div className="flex flex-col gap-2 px-2">
                            <span className="text-xs font-semibold text-muted-foreground">
                              7-Step Store Visit Scorecard Breakdown for {row.name} (avg out of 2.0 per step):
                            </span>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-7 text-xs">
                              <div className="flex flex-col gap-1 rounded bg-background p-2 border">
                                <span className="text-muted-foreground">1. Assess</span>
                                <ScoreBadge score={row.stepMarks.assess ?? 0} />
                                <span className="text-[10px] text-muted-foreground">Card & readback</span>
                              </div>
                              <div className="flex flex-col gap-1 rounded bg-background p-2 border">
                                <span className="text-muted-foreground">2. Validate</span>
                                <ScoreBadge score={row.stepMarks.validate ?? 0} />
                                <span className="text-[10px] text-muted-foreground">Confirm then correct</span>
                              </div>
                              <div className="flex flex-col gap-1 rounded bg-background p-2 border">
                                <span className="text-muted-foreground">3. Translate</span>
                                <ScoreBadge score={row.stepMarks.translate ?? 0} />
                                <span className="text-[10px] text-muted-foreground">Spec to home life</span>
                              </div>
                              <div className="flex flex-col gap-1 rounded bg-background p-2 border">
                                <span className="text-muted-foreground">4. Demonstrate</span>
                                <ScoreBadge score={row.stepMarks.demonstrate ?? 0} />
                                <span className="text-[10px] text-muted-foreground">Demo difference cue</span>
                              </div>
                              <div className="flex flex-col gap-1 rounded bg-background p-2 border">
                                <span className="text-muted-foreground">5. Complete</span>
                                <ScoreBadge score={row.stepMarks.complete ?? 0} />
                                <span className="text-[10px] text-muted-foreground">Itemised & full finance</span>
                              </div>
                              <div className="flex flex-col gap-1 rounded bg-background p-2 border">
                                <span className="text-muted-foreground">6. Close</span>
                                <ScoreBadge score={row.stepMarks.close ?? 0} />
                                <span className="text-[10px] text-muted-foreground">Consent & site check</span>
                              </div>
                              <div className="flex flex-col gap-1 rounded bg-background p-2 border">
                                <span className="text-muted-foreground">7. Follow Through</span>
                                <ScoreBadge score={row.stepMarks.follow_through ?? 0} />
                                <span className="text-[10px] text-muted-foreground">Owner & task handover</span>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LiveFloorFeed({ feed }: { feed?: FeedItem[] }) {
  if (!feed || !feed.length)
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Live floor stream</CardTitle>
          <CardDescription>Real-time customer interaction feed as associates talk on the floor.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No live interactions recorded yet today. Interactions appear here as associates use the number.
          </p>
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Live floor stream</CardTitle>
            <CardDescription>Recent customer interactions, active stage, and pricing discipline.</CardDescription>
          </div>
          <Badge variant="outline" className="text-xs">
            {feed.length} {feed.length === 1 ? "interaction" : "interactions"} today
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {feed.slice(0, 10).map((item) => (
            <div key={item.interactionId} className="flex flex-col gap-2 rounded-lg border p-3 text-sm bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{item.associate}</span>
                  <Badge variant="secondary" className="capitalize text-xs">
                    {item.step}
                  </Badge>
                  {item.score >= 11 ? (
                    <Badge variant="outline" className="bg-success/10 text-success border-transparent text-xs">
                      Guide ({item.score}/14)
                    </Badge>
                  ) : item.score > 0 ? (
                    <Badge variant="outline" className="text-xs">
                      {item.score}/14
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {item.pricedBeforeHome ? (
                    <Badge variant="outline" className="border-destructive/40 text-destructive flex items-center gap-1">
                      <ShieldAlert className="size-3" /> Price quoted first
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-success/40 text-success flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> Home first
                    </Badge>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {new Date(item.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>

              {/* Home requirements collected */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Home:</span>
                {item.room ? <Badge variant="outline">{item.room}</Badge> : null}
                {item.distance ? <Badge variant="outline">{item.distance}</Badge> : null}
                {item.budget ? <Badge variant="outline">Budget: Rs {item.budget.toLocaleString("en-IN")}</Badge> : null}
                {item.selectionSku ? (
                  <Badge variant="outline" className="bg-info/10 text-info border-transparent">
                    Selected: {item.selectionSku}
                  </Badge>
                ) : item.shortlist.length ? (
                  <Badge variant="secondary">Pitched: {item.shortlist.join(", ")}</Badge>
                ) : null}
                {item.consent ? (
                  <Badge variant="outline" className="text-success border-success/40">
                    Consent given
                  </Badge>
                ) : null}
                {item.siteChecked ? (
                  <Badge variant="outline" className="text-info border-info/40">
                    Site checked
                  </Badge>
                ) : null}
              </div>

              {item.lastLine ? (
                <div className="rounded bg-muted/50 p-2 text-xs text-muted-foreground font-mono truncate">
                  {item.lastLine}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ObjectionHeatmap({ objections }: { objections?: ObjectionInsight[] }) {
  if (!objections || !objections.length) return null;

  const totalObjections = objections.reduce((sum, o) => sum + o.count, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Customer objections and what to say</CardTitle>
            <CardDescription>
              Customer pushback raised today, with exact counter-arguments from the data pack for shift briefings.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs">
            {totalObjections} {totalObjections === 1 ? "objection" : "objections"} heard
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {objections.map((obj) => (
            <div key={obj.claim} className="rounded-lg border p-3 text-sm flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">"{obj.claim}"</span>
                </div>
                <Badge variant={obj.count > 0 ? "default" : "secondary"} className="shrink-0">
                  {obj.count} {obj.count === 1 ? "time today" : "times today"}
                </Badge>
              </div>

              {obj.associates.length > 0 ? (
                <div className="text-xs text-muted-foreground">
                  Encountered by: <span className="font-medium text-foreground">{obj.associates.join(", ")}</span>
                </div>
              ) : null}

              {obj.confirm || obj.correct ? (
                <div className="rounded bg-muted/60 p-2.5 text-xs flex flex-col gap-1 border-l-2 border-primary">
                  <span className="font-semibold text-primary">What to say:</span>
                  {obj.confirm ? (
                    <div>
                      <span className="text-muted-foreground">1. Confirm what's true: </span>"{obj.confirm}"
                    </div>
                  ) : null}
                  {obj.correct ? (
                    <div>
                      <span className="text-muted-foreground">2. Correct with facts: </span>"{obj.correct}"
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ProductDemandTable({ products }: { products?: ProductInsight[] }) {
  if (!products || !products.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Product demand</CardTitle>
            <CardDescription>
              Which sets associates are shortlisting and closing against current floor stock.
            </CardDescription>
          </div>
          <Package className="text-muted-foreground size-4" />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product / SKU</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead className="text-right">Floor Price</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Pitched</TableHead>
              <TableHead className="text-right">Selected</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.sku}>
                <TableCell className="font-medium">
                  <div>{p.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{p.sku}</div>
                </TableCell>
                <TableCell>{p.brand}</TableCell>
                <TableCell className="text-right">Rs {p.price.toLocaleString("en-IN")}</TableCell>
                <TableCell className="text-right">
                  <span className={p.stock <= 2 ? "text-warning font-semibold" : ""}>{p.stock} units</span>
                </TableCell>
                <TableCell className="text-right">{p.shortlistedCount}</TableCell>
                <TableCell className="text-right font-semibold">
                  {p.selectedCount > 0 ? (
                    <Badge variant="outline" className="bg-success/10 text-success border-transparent">
                      {p.selectedCount}
                    </Badge>
                  ) : (
                    "0"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** An Indian mobile as people read it, "+91 98200 00001"; anything else as it came. */
function phoneLabel(phone: string): string {
  return /^91\d{10}$/.test(phone) ? `+91 ${phone.slice(2, 7)} ${phone.slice(7)}` : `+${phone}`;
}

function OpenEscalations({ questions, onResolved }: { questions?: OpenQuestion[]; onResolved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);

  if (!questions || !questions.length)
    return sent ? (
      <Alert>
        <CheckCircle2 />
        <AlertTitle>{sent}</AlertTitle>
      </Alert>
    ) : null;

  const act = async (ref: string, run: () => Promise<unknown>) => {
    setBusy(ref);
    setErrors((all) => ({ ...all, [ref]: "" }));
    try {
      await run();
      onResolved();
    } catch (error) {
      setErrors((all) => ({ ...all, [ref]: (error as Error).message }));
    } finally {
      setBusy(null);
    }
  };
  const answer = (q: OpenQuestion) =>
    act(q.reference, async () => {
      const result = await api.answerQuestion(q.reference, drafts[q.reference] ?? "");
      setDrafts((all) => ({ ...all, [q.reference]: "" }));
      const who = q.associate ?? phoneLabel(q.phone);
      setSent(
        result.delivered === "sent"
          ? `Answer to ${q.reference} sent to ${who} on WhatsApp.`
          : `Answer to ${q.reference} saved. ${who} gets it the next time they write (WhatsApp's 24-hour window).`,
      );
    });

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="text-warning size-5" />
          <div>
            <CardTitle>Waiting for an expert ({questions.length})</CardTitle>
            <CardDescription>
              Questions associates could not answer on the floor. Write the answer and it goes to the associate who
              asked, on WhatsApp.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {sent && (
          <Alert className="mb-3">
            <CheckCircle2 />
            <AlertTitle>{sent}</AlertTitle>
          </Alert>
        )}
        <div className="space-y-3">
          {questions.map((q) => (
            <div key={q.reference} className="bg-background flex flex-col gap-3 rounded-lg border p-3 text-sm">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono font-semibold">
                    {q.reference}
                  </Badge>
                  <Badge variant="secondary" className="text-xs capitalize">
                    {q.area}
                  </Badge>
                  <span className="text-muted-foreground text-xs">Owner: {q.owner}</span>
                </div>
                {q.question ? <p className="text-foreground mt-1 text-sm font-medium">"{q.question}"</p> : null}
                <span className="text-muted-foreground text-xs">
                  Asked by {q.associate ? `${q.associate} · ` : ""}
                  <a className="underline" href={`tel:+${q.phone}`}>
                    {phoneLabel(q.phone)}
                  </a>
                  {q.asked_at
                    ? ` · ${new Date(q.asked_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`
                    : ""}
                </span>
              </div>
              <Textarea
                rows={3}
                maxLength={900}
                aria-label={`Answer to ${q.reference}`}
                placeholder="Write the answer for the associate…"
                value={drafts[q.reference] ?? ""}
                onChange={(event) => setDrafts((all) => ({ ...all, [q.reference]: event.target.value }))}
              />
              {errors[q.reference] ? <p className="text-destructive text-xs">{errors[q.reference]}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy === q.reference || !(drafts[q.reference] ?? "").trim()}
                  onClick={() => answer(q)}
                >
                  {busy === q.reference ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  Send answer
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === q.reference}
                  onClick={() => act(q.reference, () => api.resolveQuestion(q.reference))}
                >
                  <CheckCircle2 className="text-success size-3.5" />
                  Mark answered without a reply
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** After the sale. In October the installer left because nobody asked about the wall, and nobody
 *  checked the AC worked; these are the check-backs, and who owes each one. */
function AfterSales({
  followUps,
  onDone,
  dueOnly = false,
}: {
  followUps?: FollowUp[] | undefined;
  onDone: () => void;
  dueOnly?: boolean;
}) {
  const [closing, setClosing] = useState<number | null>(null);
  if (!followUps) return null;
  if (dueOnly && !followUps.length) return null;

  const done = async (id: number) => {
    setClosing(id);
    try {
      await api.doneFollowUp(id);
      onDone();
    } finally {
      setClosing(null);
    }
  };
  const overdue = followUps.filter((row) => row.overdue).length;

  return (
    <Card className={overdue ? "border-warning/40 bg-warning/5" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ClipboardList className={cn("size-5", overdue ? "text-warning" : "text-muted-foreground")} />
          <div>
            <CardTitle>
              {dueOnly ? "After-sales due today" : "After-sales follow-ups"} ({followUps.length})
            </CardTitle>
            <CardDescription>
              {overdue ? `${overdue} overdue. ` : ""}Delivery, the installer's call, and that it works, each with its
              owner.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!followUps.length ? (
          <p className="text-muted-foreground text-sm">Nothing open. Each sale adds its check-backs here.</p>
        ) : (
          <div className="space-y-3">
            {followUps.map((row) => (
              <div
                key={row.id}
                className="bg-background flex flex-col items-start justify-between gap-3 rounded-lg border p-3 text-sm sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={row.overdue ? "destructive" : row.due ? "secondary" : "outline"}>
                      {row.overdue ? "Overdue" : row.due ? "Due today" : "Upcoming"} · {row.due_on}
                    </Badge>
                    <span className="text-muted-foreground text-xs">Owner: {row.associate}</span>
                  </div>
                  <p className="text-foreground font-medium">{row.what}</p>
                </div>
                <Button variant="outline" size="sm" disabled={closing === row.id} onClick={() => done(row.id)}>
                  {closing === row.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="text-success size-3.5" />
                  )}
                  Done
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The delivery and installation charges the floor quotes. The store visits found the best associate
 *  keeping this list on paper; here the manager keeps it, and every phone quotes the same one. */
function ChargesCard() {
  const [charges, setCharges] = useState<Charges | null>(null);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.charges().then(setCharges, (failed: Error) => setError(failed.message));
  }, []);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
    setSaved(false);
    setError(null);
  };
  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      setCharges(await api.uploadCharges(csv));
      setCsv("");
      setSaved(true);
    } catch (failed) {
      setError((failed as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!charges) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([charges.csv], { type: "text/csv" }));
    link.download = "store-iq-charges.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const rupees = (amount: number) => (amount ? `Rs ${amount.toLocaleString("en-IN")}` : "Free");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Charges the floor quotes</CardTitle>
          <CardDescription>
            Delivery and installation for heavy products. "On every bill" charges go on the breakdown at the pick; the
            rest are offered if the home needs them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!charges ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            charges.categories.map((category) => (
              <div key={category.kind} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold capitalize">{category.kind}</h3>
                  <Badge variant={category.sample ? "outline" : "secondary"}>
                    {category.sample ? "Sample rates" : "Store's list"}
                  </Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Charge</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">On every bill</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {category.charges.map((charge) => (
                      <TableRow key={charge.title}>
                        <TableCell className="whitespace-normal">
                          {charge.title}
                          {charge.per_metre_beyond !== null && (
                            <span className="text-muted-foreground"> · per metre past {charge.per_metre_beyond} m</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{rupees(charge.amount_rupees)}</TableCell>
                        <TableCell className="text-right">{charge.every ? "Yes" : "If needed"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Upload the store's list</CardTitle>
          <CardDescription>
            Download the current list, change the amounts in Excel or Sheets, save as CSV and upload it. A category in
            the file replaces its sample rates; one left out keeps what it has.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" size="sm" onClick={download} disabled={!charges}>
            <Download className="size-3.5" />
            Download CSV
          </Button>
          <Input type="file" accept=".csv,text/csv" onChange={(event) => choose(event.target.files?.[0])} />
          <Textarea
            rows={8}
            className="font-mono text-xs"
            placeholder={
              "category,charge,amount,on every bill,per metre beyond\nrefrigerator,Delivery within 5 km,0,yes,"
            }
            value={csv}
            onChange={(event) => {
              setCsv(event.target.value);
              setSaved(false);
            }}
          />
          {error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Not saved</AlertTitle>
              <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
            </Alert>
          )}
          {saved && (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>Saved</AlertTitle>
              <AlertDescription>Every associate quotes these from their next message.</AlertDescription>
            </Alert>
          )}
          <Button onClick={upload} disabled={busy || !csv.trim()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Upload charges
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** Adding an associate, opened from the header wherever the manager is. */
function AddAssociateDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  const close = () => {
    setName("");
    setPhone("");
    setError(null);
    onClose();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.addAssociate(name, phone);
      onAdded();
      close();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="add-associate-title"
      onClose={close}
      // A click on the dimmed backdrop lands on the dialog itself, outside its padded content.
      onClick={(event) => event.target === dialog.current && close()}
      className="bg-card text-card-foreground m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border p-0 backdrop:bg-black/50"
    >
      <form className="flex flex-col gap-4 p-5" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <h2 id="add-associate-title" className="font-semibold">
            Add an associate
          </h2>
          <p className="text-muted-foreground text-sm">
            They join the roster now. WhatsApp only carries a message to someone who wrote to the number in the last 24
            hours, so they get notices once they first write.
          </p>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Name
          <Input maxLength={60} required autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          WhatsApp number
          <Input
            placeholder="e.g. 919820000001"
            inputMode="tel"
            maxLength={20}
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} Add associate
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/** Who a floor message reaches now, and who it is held for, shown before anything is sent. */
function Recipients({ preview }: { preview: Omit<Preview, "message"> }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {preview.to.map((person) => (
          <Badge key={person.phone} variant="secondary">
            <Avatar seed={person.phone} className="size-5 text-xs" />
            {person.name}
          </Badge>
        ))}
      </div>
      {preview.rosterEmpty ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Nobody is on your roster</AlertTitle>
          <AlertDescription>
            This goes to every number that has written to the agent today, whoever they are. Add your associates and it
            will only ever go to them.
          </AlertDescription>
        </Alert>
      ) : null}
      {preview.unreachable.length ? (
        <Alert>
          <Clock />
          <AlertTitle>Held until they next write</AlertTitle>
          <AlertDescription>
            {preview.unreachable.map((person) => person.name).join(", ")} — WhatsApp only carries a message to someone
            who wrote in the last 24 hours, so theirs waits and goes out the moment they message the number. It expires
            at the end of the shift rather than arriving tomorrow.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

function SentCard({ sent, onAgain }: { sent: { queued: number; waiting: number }; onAgain: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Sent to {sent.queued === 1 ? "1 associate" : `${sent.queued} associates`}
          {sent.waiting ? `, waiting for ${sent.waiting} more` : ""}
        </CardTitle>
        <CardDescription>
          {sent.waiting
            ? `The ${sent.waiting === 1 ? "one who has" : `${sent.waiting} who have`} not written today will get it the moment they next message the number, which is what lets WhatsApp carry it. Nobody is dropped.`
            : "Each one is checked against the 24 hour window again as it leaves, so a window that closed a moment ago means that associate is skipped rather than failed."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={onAgain}>
          Write another
        </Button>
      </CardContent>
    </Card>
  );
}

/** Everything sent from one page, newest first, so the manager can see what the floor was told. */
function History({ kind, version }: { kind: SentBroadcast["kind"]; version: number }) {
  const [sent, setSent] = useState<SentBroadcast[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .history(kind)
      .then((body) => setSent(body.sent))
      .catch((problem) => setError(problem instanceof Error ? problem.message : "Could not read the history."));
  }, [kind, version]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sent before</CardTitle>
        <CardDescription>
          {kind === "notice" ? "Every notice you sent to the floor." : "Every morning brief you approved and sent."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : !sent ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Reading…
          </p>
        ) : !sent.length ? (
          <p className="text-muted-foreground text-sm">Nothing sent yet. What you send appears here.</p>
        ) : (
          <ol className="flex flex-col divide-y">
            {sent.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
                  <time dateTime={row.sent_at}>
                    {new Date(row.sent_at).toLocaleString([], {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <span>
                    Sent to {row.queued}
                    {row.waiting ? `, held for ${row.waiting}` : ""}
                  </span>
                </div>
                {row.video ? (
                  <video
                    src={row.video}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-64 w-36 rounded-md bg-black"
                  />
                ) : null}
                <p className="text-sm whitespace-pre-wrap">{row.body}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function TellTheFloor({ floor, onSent }: { floor: Floor; onSent: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sent, setSent] = useState<{ queued: number; waiting: number } | null>(null);
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
      <SentCard
        sent={sent}
        onAgain={() => {
          setSent(null);
          setPreview(null);
          setText("");
        }}
      />
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Write a notice</CardTitle>
        <CardDescription>
          Today's offers, a stock change, anything everyone needs. It goes straight to the {floor.reachable}{" "}
          {floor.reachable === 1 ? "associate" : "associates"} who messaged the number in the last 24 hours; anyone else
          on the roster gets it the moment they next write. You see exactly who before anything is sent.
          {floor.waiting ? ` ${floor.waiting} still waiting to be picked up.` : ""}
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
            <Recipients preview={preview} />
            <div className="flex gap-2">
              <Button
                disabled={busy || !(preview.to.length + preview.unreachable.length)}
                onClick={() =>
                  run(async () => {
                    setSent(await api.broadcast(text));
                    onSent();
                  })
                }
              >
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Send to{" "}
                {preview.to.length + preview.unreachable.length}
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

const MAKING: Record<string, string> = {
  scripting: "Writing the script…",
  rendering: "Filming the presenter, a piece at a time. This takes two or three minutes; you can leave this tab open.",
  checking: "Checking that the presenter said only what is in the script…",
};

/** Today's brief as a short video: the manager writes it roughly, the server scripts, voices and
 *  renders it, and it is watched here before a separate, explicit tap sends it to the floor. */
function VideoBriefCard({ onSent }: { onSent: () => void }) {
  const [brief, setBrief] = useState("");
  const [view, setView] = useState<VideoBriefView | null>(null);
  const [sent, setSent] = useState<{ queued: number; waiting: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const job = view?.job ?? null;
  const making = !!job && job.status in MAKING;

  const refresh = useCallback(async () => setView(await api.videoBrief()), []);
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(() => refresh().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [making, refresh]);

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
  const make = (text: string) =>
    run(async () => {
      await api.makeVideoBrief(text);
      await refresh();
    });
  const discard = () =>
    run(async () => {
      await api.discardVideoBrief();
      await refresh();
    });

  if (sent !== null)
    return (
      <SentCard
        sent={sent}
        onAgain={() => {
          setSent(null);
          setBrief("");
          refresh().catch(() => {});
        }}
      />
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Make the morning brief</CardTitle>
        <CardDescription>
          Write today's brief roughly. The agent writes a 20 second script from it, using only the figures you wrote,
          and the store's presenter reads it on video. You watch it here first; nothing goes out until you approve it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!job || job.status === "failed" ? (
          <>
            <Textarea
              maxLength={900}
              placeholder="e.g. Diwali offers today: LG 55 inch OLED at Rs 54,990, 10% off Samsung soundbars, push the exchange offer on TVs."
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
            />
            {job?.status === "failed" ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>No video this time</AlertTitle>
                <AlertDescription>{job.error}</AlertDescription>
              </Alert>
            ) : null}
            <div>
              <Button disabled={busy || !brief.trim()} onClick={() => make(brief)}>
                {busy ? <Loader2 className="animate-spin" /> : <Video />} Make the video
              </Button>
            </div>
          </>
        ) : making ? (
          <>
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="animate-spin" /> {MAKING[job.status]}
            </p>
            {job.script ? (
              <div className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap">{job.script}</div>
            ) : null}
            <div>
              <Button variant="outline" onClick={discard} disabled={busy}>
                Discard
              </Button>
            </div>
          </>
        ) : (
          <>
            <video src={job.video} controls playsInline className="max-h-[28rem] w-full max-w-sm rounded-md bg-black" />
            <div className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap">{view?.caption}</div>
            {job.heard ? (
              <details className="text-muted-foreground text-xs">
                <summary className="cursor-pointer">
                  <CheckCircle2 className="mr-1 inline size-3.5 text-success" />
                  Checked: he says nothing that is not in the script
                </summary>
                <p className="mt-2 border-l-2 pl-3 whitespace-pre-wrap">{job.heard}</p>
              </details>
            ) : null}
            <p className="text-muted-foreground text-xs">This video cost ${job.cost.toFixed(2)} to make.</p>
            {view?.to ? <Recipients preview={view as Omit<Preview, "message">} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !((view?.to?.length ?? 0) + (view?.unreachable?.length ?? 0))}
                onClick={() =>
                  run(async () => {
                    setSent(await api.sendVideoBrief(job.video!));
                    onSent();
                  })
                }
              >
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Approve and send to{" "}
                {(view?.to?.length ?? 0) + (view?.unreachable?.length ?? 0)}
              </Button>
              <Button variant="outline" onClick={() => make(job.brief)} disabled={busy}>
                <RefreshCw /> Make it again
              </Button>
              <Button variant="ghost" onClick={discard} disabled={busy}>
                <Trash2 /> Discard
              </Button>
            </div>
          </>
        )}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.signIn(username, password);
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
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-label="Username"
              placeholder="manager"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <Input
              type="password"
              autoComplete="current-password"
              aria-label="Password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" disabled={busy || !username || !password}>
              {busy ? <Loader2 className="animate-spin" /> : null} Sign in
            </Button>
          </form>
          {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

type Section = "overview" | "floor" | "feed" | "experts" | "aftersales" | "charges" | "objections" | "notify" | "brief";

const SECTIONS: { id: Section; label: string; icon: typeof Users; about: string; group?: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, about: "" },
  { id: "floor", label: "Associates", icon: Users, about: "Scores, customers taken and who is quiet today." },
  { id: "feed", label: "Live floor", icon: Radio, about: "Conversations as the associates have them." },
  {
    id: "experts",
    label: "Expert questions",
    icon: HelpCircle,
    about: "What associates could not answer on the floor. Answer here and it goes to them on WhatsApp.",
  },
  {
    id: "aftersales",
    label: "After-sales",
    icon: ClipboardList,
    about: "Every check-back after a sale: delivery, the installer's call, that it works.",
  },
  {
    id: "charges",
    label: "Charges",
    icon: ReceiptIndianRupee,
    about: "The delivery and installation charges every associate quotes.",
  },
  {
    id: "objections",
    label: "Objections",
    icon: MessageSquare,
    about: "What customers push back on, and how to coach it.",
  },
  {
    id: "notify",
    label: "Notify associates",
    icon: Send,
    about: "A text notice to every associate on the floor.",
    group: "Broadcast",
  },
  {
    id: "brief",
    label: "Morning brief",
    icon: Video,
    about: "A short presenter video, watched here before it goes out.",
    group: "Broadcast",
  },
];

function count(floor: Floor | null, section: Section): number | undefined {
  if (!floor) return undefined;
  if (section === "floor") return floor.rows.length;
  if (section === "feed") return floor.feed?.length;
  if (section === "objections") return floor.objections?.length;
  if (section === "experts") return floor.openQuestions?.length;
  if (section === "aftersales") return floor.followUps?.filter((row) => row.due).length;
  return undefined;
}

const THEMES = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "Same as this device", icon: Monitor },
] as const satisfies readonly { id: Theme; label: string; icon: unknown }[];

function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  return (
    <div role="group" aria-label="Theme" className="bg-muted inline-flex rounded-md p-0.5">
      {THEMES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={theme === id}
          onClick={() => {
            applyTheme(id);
            setTheme(id);
          }}
          className={cn(
            "focus-visible:ring-ring flex size-7 items-center justify-center rounded-[5px] outline-none focus-visible:ring-2",
            theme === id ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="bg-brand flex size-8 items-center justify-center rounded-md text-[13px] font-bold text-white">
        IQ
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">Store IQ</span>
        <span className="text-muted-foreground block text-xs">Reliance Digital</span>
      </span>
    </div>
  );
}

function NavItem({
  section,
  active,
  badge,
  onSelect,
  compact,
}: {
  section: (typeof SECTIONS)[number];
  active: boolean;
  badge?: number | undefined;
  onSelect: () => void;
  compact?: boolean;
}) {
  const Icon = section.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-visible:ring-ring flex shrink-0 items-center gap-2.5 rounded-md text-sm transition-colors outline-none focus-visible:ring-2",
        compact ? "px-3 py-1.5" : "w-full px-3 py-2",
        active
          ? "bg-brand-soft text-foreground font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4", active && "text-brand")} />
      <span className="flex-1 text-left">{section.label}</span>
      {badge !== undefined && !compact ? <span className="text-muted-foreground text-xs">{badge}</span> : null}
    </button>
  );
}

export default function App() {
  const { floor, error, needsSignIn, updatedAt, reload, signedOut } = useFloor();
  const [active, setActive] = useState<Section>("overview");
  const [adding, setAdding] = useState(false);
  const [sentVersion, setSentVersion] = useState(0);
  const onSent = () => setSentVersion((version) => version + 1);
  const signOut = () =>
    void api
      .signOut()
      .catch(() => {})
      .then(signedOut);

  if (needsSignIn) return <SignIn onDone={reload} />;

  const section = SECTIONS.find((item) => item.id === active)!;
  const escalations = floor?.openQuestions?.length ?? 0;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="bg-card hidden border-r lg:block">
        <div className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
          <div className="border-b px-5 py-4">
            <Brand />
          </div>
          <nav aria-label="Sections" className="flex flex-col gap-0.5 p-3">
            {SECTIONS.map((item, index) => (
              <div key={item.id} className="contents">
                {item.group && item.group !== SECTIONS[index - 1]?.group ? (
                  <p className="text-muted-foreground px-3 pt-4 pb-1 text-xs font-medium">{item.group}</p>
                ) : null}
                <NavItem
                  section={item}
                  active={item.id === active}
                  badge={count(floor, item.id)}
                  onSelect={() => setActive(item.id)}
                />
              </div>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-3 border-t p-5 text-xs">
            {escalations ? (
              <button
                type="button"
                onClick={() => setActive("experts")}
                className="text-brand flex items-center gap-2 text-left font-medium"
              >
                <HelpCircle className="size-4" /> {escalations}{" "}
                {escalations === 1 ? "question waits" : "questions wait"} for an expert
              </button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground justify-start gap-2 px-2"
              onClick={signOut}
            >
              <LogOut className="size-4" /> Log out
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="bg-background/90 sticky top-0 z-10 border-b backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-4 py-3 lg:hidden">
            <Brand />
            <div className="flex items-center gap-2">
              <ThemeSwitch />
              <Button variant="outline" size="sm" onClick={() => setAdding(true)} aria-label="Add associate">
                <UserPlus className="size-3.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => void reload()} aria-label="Refresh">
                <RefreshCw className="size-3.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={signOut} aria-label="Log out">
                <LogOut className="size-3.5" />
              </Button>
            </div>
          </div>
          <nav aria-label="Sections" className="flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden">
            {SECTIONS.map((item) => (
              <NavItem
                key={item.id}
                section={item}
                active={item.id === active}
                onSelect={() => setActive(item.id)}
                compact
              />
            ))}
          </nav>
          <div className="hidden items-center justify-between gap-4 px-8 py-4 lg:flex">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">{section.label}</h1>
              <p className="text-muted-foreground truncate text-sm">
                {section.about || (floor ? floor.summary.split("\n")[0] : "Reading the floor…")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {updatedAt ? (
                <span className="text-muted-foreground text-xs">
                  Updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              ) : null}
              <ThemeSwitch />
              <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="gap-1.5">
                <UserPlus className="size-3.5" /> Add associate
              </Button>
              <Button variant="outline" size="sm" onClick={() => void reload()} className="gap-1.5">
                <RefreshCw className="size-3.5" /> Refresh
              </Button>
            </div>
          </div>
        </header>

        <main className="flex flex-col gap-6 px-4 py-6 pb-24 lg:px-8">
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Cannot read the floor</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {!floor ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="animate-spin" /> Reading the floor…
            </p>
          ) : active === "overview" ? (
            <>
              <TodayOverview floor={floor} />
              <OpenEscalations questions={floor.openQuestions} onResolved={reload} />
              <AfterSales followUps={floor.followUps?.filter((row) => row.due)} onDone={reload} dueOnly />
              <AssociateTable floor={floor} onChange={reload} />
              <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
                <ProductDemandTable products={floor.products} />
                <LiveFloorFeed feed={floor.feed} />
              </div>
              <ObjectionHeatmap objections={floor.objections} />
            </>
          ) : active === "floor" ? (
            <AssociateTable floor={floor} onChange={reload} />
          ) : active === "feed" ? (
            <LiveFloorFeed feed={floor.feed} />
          ) : active === "experts" ? (
            <>
              <OpenEscalations questions={floor.openQuestions} onResolved={reload} />
              {!floor.openQuestions?.length && (
                <p className="text-muted-foreground text-sm">
                  No question is waiting. When an associate asks something the agent cannot answer, it comes here.
                </p>
              )}
            </>
          ) : active === "aftersales" ? (
            <AfterSales followUps={floor.followUps} onDone={reload} />
          ) : active === "charges" ? (
            <ChargesCard />
          ) : active === "objections" ? (
            <ObjectionHeatmap objections={floor.objections} />
          ) : active === "notify" ? (
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <TellTheFloor floor={floor} onSent={onSent} />
              <History kind="notice" version={sentVersion} />
            </div>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <VideoBriefCard onSent={onSent} />
              <History kind="video" version={sentVersion} />
            </div>
          )}
        </main>
      </div>
      <AddAssociateDialog open={adding} onClose={() => setAdding(false)} onAdded={reload} />
    </div>
  );
}
