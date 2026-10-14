// Per-run state lives in a work dir (default `.library-build/<ID>/`, `--fake` runs in
// `.library-build/<ID>-fake/`), gitignored. Every step reads its inputs from there and writes its
// outputs atomically, so steps can be re-run, resumed and polled.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AiGateway,
  StaticTaskConfigSource,
  type AiProvider,
  type TaskConfigSource,
} from '@vionx/ai';
import { AnthropicProvider } from '@vionx/ai/anthropic';
import { FakeBuildProvider } from './ai/fake.ts';
import { connectDb, FileAiRunStore, PgAiRunStore, PgTaskConfigSource } from './ai/runs.ts';
import { readJsonIf, writeJson } from './lib/jsonl.ts';
import type { BuildProfile } from './profile.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
export const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');

export interface BuildOptions {
  fake: boolean;
  force: boolean;
  topic?: string;
  workDir?: string;
  /** Minutes to keep polling a batch before exiting (re-run the step to poll again). */
  waitMinutes: number;
  pollSeconds: number;
  /** Fixture directory for --fake (default fixtures/<profile>/fake). */
  fakeFixtures?: string;
  /** Remaining `--name value` / `--flag` arguments for the step. */
  args: Record<string, string | true>;
}

export interface StepState {
  status: 'done' | 'pending';
  at: string;
  note?: string;
  [key: string]: unknown;
}

export interface BuildState {
  profile: string;
  fake: boolean;
  steps: Record<string, StepState>;
}

export class BuildContext {
  readonly dir: string;
  readonly runs: FileAiRunStore;
  private gatewayInstance?: AiGateway;
  /** The provider behind the gateway (tests inspect the fake one's requests). */
  provider?: AiProvider;
  private stateCache?: BuildState;
  readonly out: string[] = [];

  constructor(
    readonly profile: BuildProfile,
    readonly opts: BuildOptions,
  ) {
    this.dir = resolve(
      opts.workDir ??
        join(REPO_ROOT, '.library-build', opts.fake ? `${profile.id}-fake` : profile.id),
    );
    mkdirSync(this.dir, { recursive: true });
    const dbUrl = opts.fake ? undefined : process.env.VIONX_DB_URL;
    this.runs = new FileAiRunStore(
      this.path('ai_runs.jsonl'),
      dbUrl ? new PgAiRunStore(connectDb(dbUrl)) : undefined,
    );
  }

  path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  has(...parts: string[]): boolean {
    return existsSync(this.path(...parts));
  }

  arg(name: string): string | undefined {
    const v = this.opts.args[name];
    return typeof v === 'string' ? v : undefined;
  }

  flag(name: string): boolean {
    return this.opts.args[name] !== undefined;
  }

  log(message: string): void {
    this.out.push(message);
    console.log(message);
  }

  /** The AiGateway (CONTRACT §6): fake fixtures with --fake, Claude only with AI_LIVE=1. */
  get gateway(): AiGateway {
    if (!this.gatewayInstance) {
      let provider: AiProvider;
      let config: TaskConfigSource = new StaticTaskConfigSource();
      if (this.opts.fake) {
        provider = new FakeBuildProvider(
          this.opts.fakeFixtures ?? join(FIXTURES_DIR, this.profile.id, 'fake'),
        );
      } else {
        const key = process.env.ANTHROPIC_API_KEY?.trim();
        if (process.env.AI_LIVE !== '1' || !key) {
          throw new Error(
            'This step calls Claude. Run it with AI_LIVE=1 and ANTHROPIC_API_KEY set, or add --fake ' +
              'to use the recorded fixtures.',
          );
        }
        provider = new AnthropicProvider({ apiKey: key });
        if (process.env.VIONX_DB_URL)
          config = new PgTaskConfigSource(connectDb(process.env.VIONX_DB_URL));
        else
          this.log(
            '  model per task: packages/ai DEFAULT_TASK_CONFIG (set VIONX_DB_URL to read ops.ai_task_config)',
          );
      }
      this.provider = provider;
      this.gatewayInstance = new AiGateway({ provider, config, runs: this.runs });
    }
    return this.gatewayInstance;
  }

  state(): BuildState {
    this.stateCache ??= readJsonIf<BuildState>(this.path('state.json')) ?? {
      profile: this.profile.id,
      fake: this.opts.fake,
      steps: {},
    };
    return this.stateCache;
  }

  markStep(step: string, status: StepState['status'], extra: Record<string, unknown> = {}): void {
    const state = this.state();
    state.steps[step] = { status, at: new Date().toISOString(), ...extra };
    writeJson(this.path('state.json'), state);
  }

  requireStep(step: string, hint = `run \`pnpm library:build ${this.profile.id} ${step}\` first`) {
    if (this.state().steps[step]?.status !== 'done')
      throw new Error(`${step} is not done: ${hint}`);
  }

  /** `--topic CODE`: a domain, topic or skill code prefix. */
  inTopic(skillCode: string): boolean {
    const t = this.opts.topic;
    return !t || skillCode === t || skillCode.startsWith(`${t}.`);
  }
}
