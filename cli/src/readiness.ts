// Recovery is available only after setup completed and its readiness wait failed.
export class ScenarioReadiness {
  /** Retained when the wait fails so recovery never replays setup actions. */
  pending: string | null = null;
  invalidate(): void {
    this.pending = null;
  }
  async check(name: string, wait: () => Promise<unknown>): Promise<string> {
    this.pending = name;
    await wait();
    this.pending = null;
    return name;
  }
  async recover(wait: (name: string) => Promise<unknown>): Promise<string> {
    const name = this.pending;
    if (!name)
      throw new Error('No completed scenario setup awaits readiness; reset and select a scenario.');
    await wait(name);
    this.pending = null;
    return name;
  }
}
