export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type LogEntry = {
  timestampMs: number;
  level: Exclude<LogLevel, 'silent'>;
  namespace: string;
  message: string;
  data?: unknown;
};

export type LoggerDestination = (entry: LogEntry) => void;

export type LoggerOptions = {
  namespace: string;
  enabled?: boolean;
  level?: LogLevel;
  destination?: LoggerDestination;
  timeProvider?: () => number;
  staticContext?: Record<string, unknown>;
};

const levelOrder: Record<Exclude<LogLevel, 'silent'>, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function defaultConsoleDestination(entry: LogEntry): void
{
  const { level, namespace, message, data } = entry;

  const line = `[${namespace}] ${message}`;

  if (level === 'debug')
  {
    // eslint-disable-next-line no-console
    console.log(line, data ?? '');
  }
  else if (level === 'info')
  {
    // eslint-disable-next-line no-console
    console.info(line, data ?? '');
  }
  else if (level === 'warn')
  {
    // eslint-disable-next-line no-console
    console.warn(line, data ?? '');
  }
  else // 'error'
  {
    // eslint-disable-next-line no-console
    console.error(line, data ?? '');
  }
}

export class Logger
{
  private namespace: string;
  private enabled: boolean;
  private level: LogLevel;
  private destination: LoggerDestination;
  private timeProvider: () => number;
  private staticContext?: Record<string, unknown>;

  constructor(options: LoggerOptions)
  {
    this.namespace = options.namespace;
    this.enabled = options.enabled ?? false;
    this.level = options.level ?? 'debug';
    this.destination = options.destination ?? defaultConsoleDestination;
    this.timeProvider = options.timeProvider ?? (() => Date.now());
    this.staticContext = options.staticContext;
  }

  public setEnabled(isEnabled: boolean): void
  {
    this.enabled = isEnabled;
  }

  public setLevel(level: LogLevel): void
  {
    this.level = level;
  }

  public withStaticContext(extra: Record<string, unknown>): Logger
  {
    const merged = { ...(this.staticContext ?? {}), ...extra };
    return new Logger({
      namespace: this.namespace,
      enabled: this.enabled,
      level: this.level,
      destination: this.destination,
      timeProvider: this.timeProvider,
      staticContext: merged,
    });
  }

  public child(suffixNamespace: string): Logger
  {
    const childNamespace = `${this.namespace}:${suffixNamespace}`;
    return new Logger({
      namespace: childNamespace,
      enabled: this.enabled,
      level: this.level,
      destination: this.destination,
      timeProvider: this.timeProvider,
      staticContext: this.staticContext,
    });
  }

  public debug(message: string, data?: unknown): void
  {
    this.emit('debug', message, data);
  }

  public info(message: string, data?: unknown): void
  {
    this.emit('info', message, data);
  }

  public warn(message: string, data?: unknown): void
  {
    this.emit('warn', message, data);
  }

  public error(message: string, data?: unknown): void
  {
    this.emit('error', message, data);
  }

  public time<T extends string>(label: T): { end: (data?: unknown) => void }
  {
    const start = this.timeProvider();
    return {
      end: (data?: unknown) =>
      {
        const durationMs = this.timeProvider() - start;
        this.debug(`${label} completed`, { durationMs, ...(data ? { data } : {}) });
      },
    };
  }

  public async measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T>
  {
    const timer = this.time(label);
    try
    {
      const result = await fn();
      timer.end();
      return result;
    }
    catch (error)
    {
      timer.end({ error: (error as Error)?.message ?? String(error) });
      throw error;
    }
  }

  private emit(level: Exclude<LogLevel, 'silent'>, message: string, data?: unknown): void
  {
    if (!this.enabled)
    {
      return;
    }

    if (this.level === 'silent')
    {
      return;
    }

    if (levelOrder[level] < levelOrder[this.level as Exclude<LogLevel, 'silent'>])
    {
      return;
    }

    const timestampMs = this.timeProvider();
    const entry: LogEntry = {
      timestampMs,
      level,
      namespace: this.namespace,
      message,
      data: this.staticContext
        ? { ...this.staticContext, payload: data }
        : data,
    };

    try
    {
      this.destination(entry);
    }
    catch
    {
    }
  }
}

export function makeLogger(namespace: string, enabled: boolean = false, level: LogLevel = 'debug'): Logger
{
  return new Logger({ namespace, enabled, level });
}
