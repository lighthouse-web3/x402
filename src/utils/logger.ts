import * as winston from "winston";
import TransportStream from "winston-transport";
import config from "../config.js";

const SERVICE_NAME = config.serviceName;

interface LogInfo {
  level: string;
  message: string;
  timestamp?: string;
  service?: string;
  environment?: string;
  error?: Error;
  [key: string]: unknown;
}

const formatError = (error: Error) => {
  return {
    message: error.message,
    stack: error.stack,
    name: error.name,
  };
};

const formatLogEntry = (info: LogInfo) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { level, message, timestamp, service, environment, error, ...rest } = info;

  const logEntry: Record<string, unknown> = {
    _time: new Date().toISOString(),
    _msg: message,
    level: level,
    service: SERVICE_NAME,
    environment: config.nodeEnv,
    ...rest,
  };

  if (error && error instanceof Error) {
    logEntry.error = formatError(error);
  }

  return logEntry;
};

const handleVictoriaLogsError = (error: unknown) => {
  if (config.nodeEnv === "development") {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Failed to send log to Victoria Logs:", msg);
  }
};

const sendToVictoriaLogs = async (
  victoriaLogsUrl: string,
  token: string,
  logEntry: Record<string, unknown>
) => {
  const jsonLine = JSON.stringify(logEntry) + "\n";

  try {
    await fetch(victoriaLogsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/stream+json",
        Authorization: `Bearer ${token}`,
      },
      body: jsonLine,
      signal: AbortSignal.timeout(5000),
    });
  } catch (error: unknown) {
    handleVictoriaLogsError(error);
  }
};

let victoriaLogsConfig: {
  url: string;
  token: string;
  enabled: boolean;
  transport: TransportStream | null;
} = {
  url: "",
  token: "",
  enabled: false,
  transport: null,
};

const victoriaLogsLogHandler = (info: LogInfo, callback: () => void) => {
  const { url, token, enabled, transport } = victoriaLogsConfig;

  if (transport) {
    setImmediate(() => {
      transport.emit("logged", info);
    });
  }

  if (enabled) {
    const logEntry = formatLogEntry(info);
    sendToVictoriaLogs(url, token, logEntry);
  }

  callback();
};

const createVictoriaLogsTransport = (opts: {
  victoriaLogsUrl: string;
  victoriaLogsToken: string;
  enabled: boolean;
}) => {
  const victoriaLogsUrl = opts.victoriaLogsUrl || "";
  const victoriaLogsToken = opts.victoriaLogsToken || "";
  const enabled = opts.enabled !== false && !!victoriaLogsUrl;

  const transport = new TransportStream({
    log: victoriaLogsLogHandler,
  });

  victoriaLogsConfig = {
    url: victoriaLogsUrl,
    token: victoriaLogsToken,
    enabled,
    transport,
  };

  return transport;
};

const formatConsoleMessage = (info: winston.Logform.TransformableInfo) => {
  const { timestamp, level, message, ...meta } = info;
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(meta).length > 0) {
    msg += ` ${JSON.stringify(meta)}`;
  }
  return msg;
};

const createConsoleTransport = () => {
  return new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.colorize(),
      winston.format.printf(formatConsoleMessage)
    ),
  });
};

const buildTransports = (): winston.transport[] => {
  const transports: winston.transport[] = [createConsoleTransport()];

  if (config.victoriaLogsUrl) {
    transports.push(
      createVictoriaLogsTransport({
        victoriaLogsUrl: config.victoriaLogsUrl,
        victoriaLogsToken: config.victoriaLogsToken,
        enabled: true,
      })
    );
  }

  return transports;
};

const createLogger = () => {
  return winston.createLogger({
    level: config.logLevel,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: {
      service: SERVICE_NAME,
      environment: config.nodeEnv,
    },
    transports: buildTransports(),
  });
};

const logger = createLogger();

const writeMorganLog = (message: string) => {
  logger.info(message.trim());
};

export const morganStream = {
  write: writeMorganLog,
};

export default logger;
